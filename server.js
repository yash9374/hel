const path = require("path");
const http = require("http");

const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const { URL } = require("url");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  path: "/ws",
  verifyClient: (info, done) => {
    try {
      const role = String(new URL(info.req.url, "http://placeholder").searchParams.get("role") || "");
      if (role !== "candidate") return done(true);

      const keys = parseUrls(process.env.SEB_BROWSER_EXAM_KEYS || process.env.SEB_ALLOWED_BEK);
      if (!keys.length) return done(true);

      const host = String(info.req.headers.host || "");
      if (!host) return done(false, 403, "Missing Host");

      const protoHeader = String(info.req.headers["x-forwarded-proto"] || "");
      const proto = protoHeader ? protoHeader.split(",")[0].trim() : "http";
      const fullUrl = `${proto}://${host}${info.req.url}`;

      const got = String(info.req.headers["x-safeexambrowser-requesthash"] || "");
      if (!got) return done(false, 403, "Missing SEB header");

      if (!matchesSebRequestHash(fullUrl, keys, got)) return done(false, 403, "SEB check failed");
      return done(true);
    } catch {
      return done(false, 403, "SEB check failed");
    }
  }
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const MAX_PEERS_PER_ROOM = Number(process.env.MAX_PEERS_PER_ROOM || 2);
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 1000 * 60 * 30);

function parseUrls(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildIceServers() {
  const stunUrls = parseUrls(process.env.STUN_URLS);
  const turnUrls = parseUrls(process.env.TURN_URLS);

  const iceServers = [];

  const defaultStun = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun2.l.google.com:19302"
  ];

  iceServers.push({ urls: stunUrls.length ? stunUrls : defaultStun });

  if (turnUrls.length) {
    const username = process.env.TURN_USERNAME || "";
    const credential = process.env.TURN_CREDENTIAL || "";
    if (username && credential) {
      iceServers.push({ urls: turnUrls, username, credential });
    }
  }

  return iceServers;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256Base64(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("base64");
}

function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function matchesSebRequestHash(fullUrl, browserExamKeys, provided) {
  const got = String(provided || "").trim();
  if (!got) return false;
  for (const bek of browserExamKeys) {
    const input = `${fullUrl}${bek}`;
    const expectedHex = sha256Hex(input);
    if (timingSafeEqualString(expectedHex, got.toLowerCase())) return true;

    const expectedBase64 = sha256Base64(input);
    if (timingSafeEqualString(expectedBase64, got)) return true;
  }
  return false;
}

function fullUrlFromReq(req) {
  const protoHeader = String(req.headers["x-forwarded-proto"] || "");
  const proto = protoHeader ? protoHeader.split(",")[0].trim() : req.protocol || "http";
  const host = String(req.get("host") || "");
  return `${proto}://${host}${req.originalUrl}`;
}

function sebGate(req, res, next) {
  const browserExamKeys = parseUrls(process.env.SEB_BROWSER_EXAM_KEYS || process.env.SEB_ALLOWED_BEK);
  if (!browserExamKeys.length) return next();

  const got = String(req.get("x-safeexambrowser-requesthash") || "");
  if (!got) return res.status(403).send("SEB required");

  const fullUrl = fullUrlFromReq(req);
  if (!matchesSebRequestHash(fullUrl, browserExamKeys, got)) return res.status(403).send("SEB check failed");
  return next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/candidate", sebGate, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/ice", (req, res) => {
  const role = String(req.query.role || "");
  const respond = () => res.json({ iceServers: buildIceServers() });
  if (role === "candidate") return sebGate(req, res, respond);
  return respond();
});

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function roomState(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { sockets: new Set(), updatedAt: Date.now() });
  }
  return rooms.get(roomId);
}

function broadcastToRoom(roomId, sender, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.updatedAt = Date.now();
  const text = JSON.stringify(payload);
  for (const ws of room.sockets) {
    if (ws !== sender && ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (data) => {
    const message = safeJsonParse(data.toString("utf8"));
    if (!message || typeof message.type !== "string") return;

    if (message.type === "join") {
      const roomId = String(message.roomId || "").trim();
      if (!roomId) return;

      if (ws.roomId) {
        const prev = rooms.get(ws.roomId);
        if (prev) prev.sockets.delete(ws);
      }

      const room = roomState(roomId);
      if (room.sockets.size >= MAX_PEERS_PER_ROOM) {
        ws.send(JSON.stringify({ type: "room-full", roomId, max: MAX_PEERS_PER_ROOM }));
        try {
          ws.close();
        } catch {
          return;
        }
        return;
      }

      ws.roomId = roomId;
      room.sockets.add(ws);
      room.updatedAt = Date.now();

      ws.send(
        JSON.stringify({
          type: "joined",
          roomId,
          peerCount: room.sockets.size
        })
      );

      broadcastToRoom(roomId, ws, { type: "peer-joined", peerCount: room.sockets.size });
      return;
    }

    if (!ws.roomId) return;

    if (message.type === "signal") {
      broadcastToRoom(ws.roomId, ws, { type: "signal", data: message.data });
      return;
    }

    if (message.type === "leave") {
      const room = rooms.get(ws.roomId);
      if (room) {
        room.sockets.delete(ws);
        room.updatedAt = Date.now();
        broadcastToRoom(ws.roomId, ws, { type: "peer-left", peerCount: room.sockets.size });
        if (room.sockets.size === 0) rooms.delete(ws.roomId);
      }
      ws.roomId = null;
    }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room.sockets.delete(ws);
    room.updatedAt = Date.now();
    broadcastToRoom(ws.roomId, ws, { type: "peer-left", peerCount: room.sockets.size });
    if (room.sockets.size === 0) rooms.delete(ws.roomId);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.sockets.size > 0) continue;
    if (now - room.updatedAt > ROOM_IDLE_TTL_MS) rooms.delete(roomId);
  }
}, 15_000).unref();

const port = Number(process.env.PORT || 5173);
server.listen(port, () => {
  console.log(`WebInter running on port ${port}`);
});
