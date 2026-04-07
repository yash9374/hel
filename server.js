import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sessionSecret = process.env.SESSION_SECRET;

const hasSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = hasSupabase ? createClient(supabaseUrl, supabaseServiceKey) : null;

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeToString(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64").toString("utf8");
}

function signToken(payload) {
  if (!sessionSecret) return null;
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest();
  return `${body}.${base64UrlEncode(sig)}`;
}

function verifyToken(token) {
  if (!sessionSecret) return null;
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto.createHmac("sha256", sessionSecret).update(body).digest();
  const expectedEncoded = base64UrlEncode(expected);
  if (expectedEncoded.length !== sig.length) return null;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(expectedEncoded), Buffer.from(sig))) return null;
  } catch {
    return null;
  }

  try {
    const json = base64UrlDecodeToString(body);
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value.includes("@") || value.length < 5 || value.length > 254) return null;
  return value;
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "student" || r === "interviewer") return r;
  return null;
}

function requireSupabase(req, res, next) {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase not configured" });
  return next();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const payload = verifyToken(token);
  if (!payload?.email || !payload?.role) return res.status(401).json({ ok: false, error: "Unauthorized" });
  req.user = { email: payload.email, role: payload.role };
  return next();
}

app.post("/api/login", requireSupabase, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const requestedRole = normalizeRole(req.body?.role);
  if (!email) return res.status(400).json({ ok: false, error: "Invalid email" });
  if (!sessionSecret) return res.status(500).json({ ok: false, error: "Server not configured" });

  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("users")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();

  if (existingError) return res.status(500).json({ ok: false, error: "Database error" });

  if (!existing) {
    if (!requestedRole) return res.status(200).json({ ok: false, needsRole: true });

    const { error: insertError } = await supabase
      .from("users")
      .insert({ email, role: requestedRole, created_at: now, last_seen_at: now });
    if (insertError) return res.status(500).json({ ok: false, error: "Database error" });

    const token = signToken({ email, role: requestedRole, iat: Date.now() });
    if (!token) return res.status(500).json({ ok: false, error: "Server not configured" });
    return res.status(200).json({ ok: true, token, user: { email, role: requestedRole }, created: true });
  }

  const role = normalizeRole(existing.role);
  if (!role) return res.status(500).json({ ok: false, error: "Role missing in database" });

  const { error: updateError } = await supabase
    .from("users")
    .update({ last_seen_at: now })
    .eq("email", email);
  if (updateError) return res.status(500).json({ ok: false, error: "Database error" });

  const token = signToken({ email, role, iat: Date.now() });
  if (!token) return res.status(500).json({ ok: false, error: "Server not configured" });
  return res.status(200).json({ ok: true, token, user: { email, role }, created: false });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.status(200).json({ ok: true, user: req.user });
});

function generateMeetingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

app.post("/api/create-meeting", requireSupabase, requireAuth, async (req, res) => {
  if (req.user.role !== "interviewer") return res.status(403).json({ ok: false, error: "Forbidden" });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateMeetingCode();

    const { data: existing, error: existsError } = await supabase
      .from("meetings")
      .select("code")
      .eq("code", code)
      .maybeSingle();
    if (existsError) return res.status(500).json({ ok: false, error: "Database error" });
    if (existing) continue;

    const { error: insertError } = await supabase
      .from("meetings")
      .insert({ code, created_by: req.user.email, created_at: new Date().toISOString() });
    if (insertError) return res.status(500).json({ ok: false, error: "Database error" });

    return res.status(200).json({ ok: true, code });
  }

  return res.status(500).json({ ok: false, error: "Failed to create meeting" });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = verifyToken(token);
  if (!payload?.email || !payload?.role) return next(new Error("unauthorized"));
  socket.data.user = { email: payload.email, role: payload.role };
  return next();
});

io.on("connection", (socket) => {
  socket.on("join-room", async ({ roomCode }, ack) => {
    if (typeof roomCode !== "string" || roomCode.trim().length === 0) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid code" });
      return;
    }

    const normalized = roomCode.trim().toUpperCase();
    const room = `room:${normalized}`;

    if (supabase) {
      const { data: meeting, error } = await supabase
        .from("meetings")
        .select("code")
        .eq("code", normalized)
        .maybeSingle();
      if (error || !meeting) {
        if (typeof ack === "function") ack({ ok: false, error: "Meeting not found" });
        return;
      }
    }

    socket.join(room);

    const peerIds = Array.from(io.sockets.adapter.rooms.get(room) ?? []).filter(
      (id) => id !== socket.id
    );

    socket.emit("existing-peers", { peerIds, roomCode: normalized });
    socket.to(room).emit("peer-joined", { peerId: socket.id });

    socket.data.room = room;
    socket.data.roomCode = normalized;

    if (typeof ack === "function") ack({ ok: true, peerIds, roomCode: normalized });
  });

  socket.on("signal", ({ to, payload }) => {
    if (typeof to !== "string") return;
    io.to(to).emit("signal", { from: socket.id, payload });
  });

  const leave = () => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit("peer-left", { peerId: socket.id });
    socket.leave(room);
    socket.data.room = undefined;
    socket.data.roomCode = undefined;
  };

  socket.on("leave-room", leave);
  socket.on("disconnect", leave);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on ${port}`);
});
