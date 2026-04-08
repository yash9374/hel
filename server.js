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
const sebBrowserExamKey = process.env.SEB_BROWSER_EXAM_KEY;
const sebConfigKey = process.env.SEB_CONFIG_KEY;

const hasSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = hasSupabase ? createClient(supabaseUrl, supabaseServiceKey) : null;
const sebSessions = new Map();

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

function isSafeExamBrowserUserAgent(userAgent) {
  const ua = String(userAgent || "");
  return /safeexambrowser|seb/i.test(ua);
}

function shouldRequireSebKeyCheck() {
  return Boolean(sebBrowserExamKey);
}

function getRequestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

function getFullRequestUrl(req) {
  const origin = getRequestOrigin(req);
  if (!origin) return null;
  return `${origin}${req.originalUrl || ""}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function verifySebHeaders({ headers, requestUrl }) {
  if (!shouldRequireSebKeyCheck()) return true;
  if (!requestUrl) return false;

  const requestHash = String(headers["x-safeexambrowser-requesthash"] || "").trim().toLowerCase();
  const configHash = String(headers["x-safeexambrowser-configkeyhash"] || "").trim().toLowerCase();

  const expectedRequestHash = sha256Hex(`${requestUrl}${sebBrowserExamKey}`);
  if (!requestHash || requestHash !== expectedRequestHash) return false;

  if (sebConfigKey) {
    const expectedConfigHash = sha256Hex(`${requestUrl}${sebConfigKey}`);
    if (!configHash || configHash !== expectedConfigHash) return false;
  }

  return true;
}

function requireSebForStudents(req, res, next) {
  if (!shouldRequireSebKeyCheck()) return next();
  if (req.user?.role !== "student") return next();
  const requestUrl = getFullRequestUrl(req);
  const ok = verifySebHeaders({ headers: req.headers, requestUrl });
  if (!ok) return res.status(403).json({ ok: false, error: "Students must use the provided exam browser configuration (.seb)" });
  return next();
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
  req.authToken = token;
  return next();
}

function normalizeIp(ip) {
  const v = String(ip || "").trim();
  if (v.startsWith("::ffff:")) return v.slice("::ffff:".length);
  return v;
}

app.post("/api/login", requireSupabase, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: "Invalid email" });
  if (!sessionSecret) return res.status(500).json({ ok: false, error: "Server not configured" });

  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("users")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();

  if (existingError) return res.status(500).json({ ok: false, error: "Database error" });

  if (!existing) return res.status(404).json({ ok: false, error: "Account not found" });

  const role = normalizeRole(existing.role);
  if (!role) return res.status(500).json({ ok: false, error: "Role missing in database" });

  const { error: updateError } = await supabase
    .from("users")
    .update({ last_seen_at: now })
    .eq("email", email);
  if (updateError) return res.status(500).json({ ok: false, error: "Database error" });

  const token = signToken({ email, role, iat: Date.now() });
  if (!token) return res.status(500).json({ ok: false, error: "Server not configured" });
  return res.status(200).json({ ok: true, token, user: { email, role } });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.status(200).json({ ok: true, user: req.user });
});

app.post("/api/seb-check", requireAuth, requireSebForStudents, (req, res) => {
  if (req.authToken) {
    sebSessions.set(req.authToken, { ip: normalizeIp(req.ip), at: Date.now() });
  }
  res.status(200).json({ ok: true });
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
  socket.data.authToken = token;
  const proto = String(socket.handshake.headers?.["x-forwarded-proto"] || (socket.request?.connection?.encrypted ? "https" : "http"))
    .split(",")[0]
    .trim();
  const host = String(socket.handshake.headers?.["x-forwarded-host"] || socket.handshake.headers?.host || "")
    .split(",")[0]
    .trim();
  const requestUrl = host ? `${proto}://${host}${socket.handshake.url || ""}` : null;
  socket.data.sebOk = verifySebHeaders({ headers: socket.handshake.headers || {}, requestUrl });
  return next();
});

io.on("connection", (socket) => {
  socket.on("join-room", async ({ roomCode }, ack) => {
    if (typeof roomCode !== "string" || roomCode.trim().length === 0) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid code" });
      return;
    }

    if (socket.data.user?.role === "student") {
      const userAgent = socket.handshake.headers?.["user-agent"];
      if (!isSafeExamBrowserUserAgent(userAgent)) {
        if (typeof ack === "function") ack({ ok: false, error: "Students must join from the exam app" });
        return;
      }

      if (shouldRequireSebKeyCheck()) {
        const token = socket.data.authToken;
        const entry = token ? sebSessions.get(token) : null;
        const socketIp = normalizeIp(socket.handshake.address || socket.request?.socket?.remoteAddress || socket.request?.connection?.remoteAddress);
        const recentlyValidated = Boolean(
          entry && entry.ip && socketIp && entry.ip === socketIp && Date.now() - entry.at < 10 * 60 * 1000
        );

        if (!recentlyValidated && !socket.data.sebOk) {
          if (typeof ack === "function") {
            ack({ ok: false, error: "Students must use the provided exam browser configuration (.seb)" });
          }
          return;
        }
      }
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
