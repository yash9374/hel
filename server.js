import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

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

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomCode }) => {
    if (typeof roomCode !== "string" || roomCode.trim().length === 0) return;

    const normalized = roomCode.trim().toUpperCase();
    const room = `room:${normalized}`;

    socket.join(room);

    const peerIds = Array.from(io.sockets.adapter.rooms.get(room) ?? []).filter(
      (id) => id !== socket.id
    );

    socket.emit("existing-peers", { peerIds, roomCode: normalized });
    socket.to(room).emit("peer-joined", { peerId: socket.id });

    socket.data.room = room;
    socket.data.roomCode = normalized;
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
