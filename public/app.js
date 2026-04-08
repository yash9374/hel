const statusEl = document.getElementById("status");
const authEl = document.getElementById("auth");
const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("emailInput");
const authBtn = document.getElementById("authBtn");
const authError = document.getElementById("authError");
const lobbyEl = document.getElementById("lobby");
const meetingEl = document.getElementById("meeting");
const createBtn = document.getElementById("createBtn");
const joinForm = document.getElementById("joinForm");
const logoutBtn = document.getElementById("logoutBtn");
const codeInput = document.getElementById("codeInput");
const meetingInfo = document.getElementById("meetingInfo");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const localVideo = document.getElementById("localVideo");
const localCard = document.getElementById("localCard");
const localOff = document.getElementById("localOff");
const remoteVideos = document.getElementById("remoteVideos");
const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const leaveBtn = document.getElementById("leaveBtn");

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

let socket;
let roomCode;
let localStream;
let cameraStream;
let screenStream;
let isScreenSharing = false;
let micEnabled = true;
let cameraEnabled = true;
let authToken = localStorage.getItem("authToken") || "";
let currentUser = null;

const peers = new Map();
const remoteMedia = new Map();

function setStatus(text) {
  statusEl.textContent = text;
}

function setLobbyVisible(visible) {
  lobbyEl.classList.toggle("hidden", !visible);
  meetingEl.classList.toggle("hidden", visible);
}

function setAuthed(isAuthed) {
  authEl.classList.toggle("hidden", isAuthed);
  lobbyEl.classList.toggle("hidden", !isAuthed);
  meetingEl.classList.toggle("hidden", true);
}

function isSafeExamBrowser() {
  const ua = String(navigator.userAgent || "");
  return /safeexambrowser|seb/i.test(ua);
}

function getExamAppAuth() {
  const examAppId = String(window.__EXAM_APP_ID__ || "").trim();
  const examAppSig = String(window.__EXAM_APP_SIG__ || "").trim();
  return { examAppId, examAppSig, ok: Boolean(examAppId && examAppSig) };
}

function applyStudentJoinPolicy() {
  const isStudent = currentUser?.role === "student";
  const { ok: hasExamAppAuth } = getExamAppAuth();
  const allowed = !isStudent || (isSafeExamBrowser() && hasExamAppAuth);

  codeInput.disabled = !allowed;
  const joinBtn = joinForm.querySelector('button[type="submit"]');
  if (joinBtn) joinBtn.disabled = !allowed;

  if (!allowed) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Students must open this link in the exam app to join a meeting.";
  }
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(path, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok && body?.ok, status: res.status, body };
}

async function ensureCamera() {
  if (cameraStream) return cameraStream;
  cameraStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  for (const track of cameraStream.getAudioTracks()) track.enabled = micEnabled;
  for (const track of cameraStream.getVideoTracks()) track.enabled = cameraEnabled;
  localStream = cameraStream;
  localVideo.srcObject = localStream;
  syncControlUI();
  return cameraStream;
}

function syncControlUI() {
  micBtn.classList.toggle("off", !micEnabled);
  camBtn.classList.toggle("off", !cameraEnabled);

  micBtn.textContent = micEnabled ? "Mic on" : "Mic off";
  camBtn.textContent = cameraEnabled ? "Camera on" : "Camera off";

  localOff.classList.toggle("hidden", cameraEnabled || isScreenSharing);
  screenShareBtn.textContent = isScreenSharing ? "Stop share" : "Share screen";
}

function setMicEnabled(enabled) {
  micEnabled = Boolean(enabled);
  if (cameraStream) {
    for (const track of cameraStream.getAudioTracks()) track.enabled = micEnabled;
  }
  syncControlUI();
}

function setCameraEnabled(enabled) {
  cameraEnabled = Boolean(enabled);
  if (cameraStream) {
    for (const track of cameraStream.getVideoTracks()) track.enabled = cameraEnabled;
  }
  syncControlUI();
}

function ensureSocket() {
  if (socket) return socket;
  const { examAppId, examAppSig } = getExamAppAuth();
  socket = window.io({
    auth: { token: authToken, examAppId, examAppSig }
  });

  socket.on("connect", () => setStatus(`Connected (${socket.id})`));
  socket.on("disconnect", () => setStatus("Disconnected"));
  socket.on("connect_error", () => setStatus("Connection error"));

  socket.on("existing-peers", async ({ peerIds, roomCode: rc }) => {
    roomCode = rc;
    roomCodeLabel.textContent = roomCode;
    for (const peerId of peerIds) createPeerConnection(peerId, true);
  });

  socket.on("peer-joined", ({ peerId }) => {
    createPeerConnection(peerId, false);
  });

  socket.on("peer-left", ({ peerId }) => {
    cleanupPeer(peerId);
  });

  socket.on("signal", async ({ from, payload }) => {
    const pc = createPeerConnection(from, false);
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "sdp" && payload.description) {
      await pc.setRemoteDescription(payload.description);
      if (payload.description.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit("signal", { to: from, payload: { type: "sdp", description: pc.localDescription } });
      }
      return;
    }

    if (payload.type === "ice" && payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        return;
      }
    }
  });

  return socket;
}

function createRemoteCard(peerId) {
  const card = document.createElement("div");
  card.className = "videoCard";
  card.id = `remote-${peerId}`;

  const label = document.createElement("div");
  label.className = "videoLabel";
  label.textContent = peerId.slice(0, 6);

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  card.appendChild(label);
  card.appendChild(video);
  remoteVideos.appendChild(card);

  return { card, video };
}

function ensureRemoteStream(peerId) {
  let stream = remoteMedia.get(peerId);
  if (stream) return stream;
  stream = new MediaStream();
  remoteMedia.set(peerId, stream);
  const { video } = createRemoteCard(peerId);
  video.srcObject = stream;
  return stream;
}

function createPeerConnection(peerId, initiator) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, pc);

  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    ensureSocket().emit("signal", { to: peerId, payload: { type: "ice", candidate: event.candidate } });
  };

  pc.ontrack = (event) => {
    const stream = ensureRemoteStream(peerId);
    if (!stream.getTracks().some((t) => t.id === event.track.id)) stream.addTrack(event.track);
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) cleanupPeer(peerId);
  };

  if (initiator) {
    (async () => {
      await pc.setLocalDescription(await pc.createOffer());
      ensureSocket().emit("signal", { to: peerId, payload: { type: "sdp", description: pc.localDescription } });
    })().catch(() => {});
  }

  return pc;
}

function cleanupPeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) {
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    } catch {
      return;
    }
  }

  peers.delete(peerId);
  remoteMedia.delete(peerId);
  const el = document.getElementById(`remote-${peerId}`);
  if (el) el.remove();
}

async function join(code) {
  if (currentUser?.role === "student") {
    const { ok: hasExamAppAuth } = getExamAppAuth();
    if (!isSafeExamBrowser() || !hasExamAppAuth) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = "Students must open this link in the exam app to join a meeting.";
      return;
    }
  }

  roomCode = normalizeCode(code);
  if (!roomCode) return;

  codeInput.value = roomCode;
  setLobbyVisible(false);
  setStatus("Requesting camera/mic…");

  await ensureCamera();

  setStatus("Joining room…");
  const joinResult = await new Promise((resolve) => {
    ensureSocket().emit("join-room", { roomCode }, (ack) => resolve(ack || { ok: true }));
  });

  if (!joinResult.ok) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = joinResult.error || "Failed to join meeting";
    setLobbyVisible(true);
    return;
  }

  roomCodeLabel.textContent = roomCode;
  const url = new URL(window.location.href);
  url.searchParams.set("code", roomCode);
  window.history.replaceState({}, "", url.toString());
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

async function startScreenShare() {
  if (isScreenSharing) return;
  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const screenTrack = screenStream.getVideoTracks()[0];
  if (!screenTrack) return;

  isScreenSharing = true;
  syncControlUI();

  const audioTrack = localStream?.getAudioTracks()[0] ?? null;
  localVideo.srcObject = new MediaStream([screenTrack, ...(audioTrack ? [audioTrack] : [])]);

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(screenTrack);
  }

  screenTrack.onended = () => {
    stopScreenShare().catch(() => {});
  };
}

async function stopScreenShare() {
  if (!isScreenSharing) return;
  isScreenSharing = false;
  syncControlUI();

  stopStream(screenStream);
  screenStream = undefined;

  await ensureCamera();
  const cameraTrack = cameraStream.getVideoTracks()[0];
  localVideo.srcObject = localStream;

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }
}

async function leave() {
  if (socket && socket.connected) socket.emit("leave-room");

  if (isScreenSharing) {
    isScreenSharing = false;
    syncControlUI();
    stopStream(screenStream);
    screenStream = undefined;
  }

  for (const peerId of Array.from(peers.keys())) cleanupPeer(peerId);

  stopStream(cameraStream);

  cameraStream = undefined;
  localStream = undefined;
  localVideo.srcObject = null;
  micEnabled = true;
  cameraEnabled = true;
  syncControlUI();

  setLobbyVisible(true);
  setStatus("Not connected");

  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  window.history.replaceState({}, "", url.toString());
}

createBtn.addEventListener("click", async () => {
  if (!currentUser || currentUser.role !== "interviewer") {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Only interviewers can start a meeting.";
    return;
  }

  meetingInfo.classList.add("hidden");
  const res = await api("/api/create-meeting", { method: "POST" });
  if (!res.ok) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = res.body?.error || "Failed to create meeting";
    return;
  }

  const code = res.body.code || generateCode();
  meetingInfo.classList.remove("hidden");
  meetingInfo.textContent = `Meeting code: ${code}`;
  await join(code);
});

joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await join(codeInput.value);
});

screenShareBtn.addEventListener("click", async () => {
  if (isScreenSharing) await stopScreenShare();
  else await startScreenShare();
});

micBtn.addEventListener("click", () => {
  setMicEnabled(!micEnabled);
});

camBtn.addEventListener("click", () => {
  setCameraEnabled(!cameraEnabled);
});

leaveBtn.addEventListener("click", () => {
  leave().catch(() => {});
});

logoutBtn.addEventListener("click", () => {
  leave().catch(() => {});

  authToken = "";
  localStorage.removeItem("authToken");
  currentUser = null;

  if (socket) {
    try {
      socket.disconnect();
    } catch {
    }
    socket = undefined;
  }

  setAuthed(false);
  setStatus("Not connected");
  emailInput.value = "";
});

window.addEventListener("beforeunload", () => {
  if (socket && socket.connected) socket.emit("leave-room");
});

setLobbyVisible(true);
setStatus("Not connected");
syncControlUI();

async function initAuth() {
  setAuthed(false);
  authBtn.textContent = "Check account";

  if (authToken) {
    const res = await api("/api/me");
    if (res.ok) {
      currentUser = res.body.user;
      setAuthed(true);
      if (currentUser?.role !== "interviewer") createBtn.classList.add("hidden");
      else createBtn.classList.remove("hidden");
      setStatus(`Logged in as ${currentUser.role}`);
      applyStudentJoinPolicy();
      const urlCode = new URL(window.location.href).searchParams.get("code");
      if (urlCode) join(urlCode).catch(() => {});
      return;
    }
  }

  authToken = "";
  localStorage.removeItem("authToken");
  currentUser = null;
  setAuthed(false);
  authBtn.textContent = "Check account";
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authError.textContent = "";

  const email = String(emailInput.value || "").trim();

  const res = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email })
  });

  if (!res.ok) {
    authError.classList.remove("hidden");
    authError.textContent = res.body?.error || "Account check failed";
    return;
  }

  authToken = res.body.token;
  localStorage.setItem("authToken", authToken);
  currentUser = res.body.user;
  setAuthed(true);
  authBtn.textContent = "Check account";
  if (currentUser?.role !== "interviewer") createBtn.classList.add("hidden");
  else createBtn.classList.remove("hidden");
  setStatus(`Logged in as ${currentUser.role}`);
  applyStudentJoinPolicy();
});

initAuth().catch(() => {});
