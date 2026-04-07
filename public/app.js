const joinPanel = document.getElementById("joinPanel");
const callStage = document.getElementById("callStage");

const roomIdInput = document.getElementById("roomId");
const roleSelect = document.getElementById("role");
const joinBtn = document.getElementById("joinBtn");
const joinHint = document.getElementById("joinHint");

const roomLabel = document.getElementById("roomLabel");
const statusLabel = document.getElementById("statusLabel");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const shareBtn = document.getElementById("shareBtn");
const fsBtn = document.getElementById("fsBtn");
const leaveBtn = document.getElementById("leaveBtn");

function query() {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(params.entries());
}

function isSEB() {
  const ua = navigator.userAgent || "";
  return ua.toLowerCase().includes("safeexambrowser") || ua.toLowerCase().includes("seb");
}

function setHint(text) {
  joinHint.textContent = text || "";
}

function setStatus(text) {
  statusLabel.textContent = text || "";
}

function setControlState(btn, on) {
  btn.classList.toggle("off", !on);
}

function randomRoom() {
  const s = crypto.getRandomValues(new Uint32Array(2));
  return `${s[0].toString(16)}${s[1].toString(16)}`.slice(0, 10).toUpperCase();
}

const qp = query();
if (qp.room) roomIdInput.value = String(qp.room).trim();
const pathName = location.pathname.toLowerCase();
if (pathName.startsWith("/candidate")) {
  roleSelect.value = "candidate";
  roleSelect.disabled = true;
} else if (pathName.startsWith("/hr")) {
  roleSelect.value = "hr";
  roleSelect.disabled = true;
} else if (qp.role) roleSelect.value = qp.role === "hr" ? "hr" : "candidate";
if (!roomIdInput.value) roomIdInput.value = randomRoom();

let ws = null;
let pc = null;
let localStream = null;
let screenStream = null;
let cameraVideoTrack = null;
let role = "candidate";
let roomId = null;
let connectedPeerCount = 0;
let iceServersPromise = null;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

async function ensureLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = localStream;
  cameraVideoTrack = localStream.getVideoTracks()[0] || null;
  setControlState(micBtn, (localStream.getAudioTracks()[0] || {}).enabled !== false);
  setControlState(camBtn, (localStream.getVideoTracks()[0] || {}).enabled !== false);
  return localStream;
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...(options || {}), signal: controller.signal }).finally(() => clearTimeout(t));
}

function getIceServers() {
  if (iceServersPromise) return iceServersPromise;
  iceServersPromise = (async () => {
    try {
      const res = await fetchWithTimeout(`/api/ice?role=${encodeURIComponent(role)}`, { cache: "no-store" }, 2500);
      if (!res.ok) throw new Error("bad status");
      const json = await res.json();
      if (json && Array.isArray(json.iceServers) && json.iceServers.length) return json.iceServers;
    } catch {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
    return [{ urls: "stun:stun.l.google.com:19302" }];
  })();
  return iceServersPromise;
}

function createPeerConnection(iceServers) {
  pc = new RTCPeerConnection({
    iceServers: iceServers && iceServers.length ? iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    sendSignal({ kind: "ice", candidate: event.candidate });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) remoteVideo.srcObject = stream;
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "connected") setStatus("Connected");
    if (st === "connecting") setStatus("Connecting…");
    if (st === "failed") setStatus("Connection failed");
    if (st === "disconnected") setStatus("Disconnected");
    if (st === "closed") setStatus("Closed");
  };

  return pc;
}

function attachLocalTracks() {
  if (!pc || !localStream) return;
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendSignal(data) {
  send({ type: "signal", data });
}

async function maybeStartOffer() {
  if (!pc) return;
  if (role !== "hr") return;
  if (connectedPeerCount < 2) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ kind: "offer", sdp: pc.localDescription });
}

async function handleSignal(data) {
  if (!pc) return;
  if (!data || typeof data.kind !== "string") return;

  if (data.kind === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ kind: "answer", sdp: pc.localDescription });
    return;
  }

  if (data.kind === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    return;
  }

  if (data.kind === "ice" && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {
      return;
    }
  }
}

function applyCandidateLockdown() {
  if (role !== "candidate") return;

  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("copy", (e) => e.preventDefault());
  document.addEventListener("cut", (e) => e.preventDefault());
  document.addEventListener("paste", (e) => e.preventDefault());

  document.addEventListener(
    "keydown",
    (e) => {
      const k = (e.key || "").toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;

      const blocked =
        k === "f11" ||
        k === "f12" ||
        k === "escape" ||
        (ctrl && ["l", "r", "w", "t", "n", "p", "o", "+", "-", "0"].includes(k)) ||
        (alt && ["f4", "tab", "left", "right"].includes(k));

      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setStatus("Stay in the interview tab");
  });
}

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    return;
  }
}

function enforceSEBForCandidate() {
  const allowNonSEB = query().allowNonSEB === "1";
  if (role !== "candidate") return true;
  if (isSEB()) return true;
  if (allowNonSEB) return true;
  return false;
}

async function joinRoom() {
  role = roleSelect.value === "hr" ? "hr" : "candidate";
  roomId = String(roomIdInput.value || "").trim();

  if (!roomId) {
    setHint("Enter a room code");
    return;
  }

  if (!enforceSEBForCandidate()) {
    setHint("Candidate mode requires Safe Exam Browser (SEB).");
    return;
  }

  joinBtn.disabled = true;
  setHint("");

  try {
    await ensureLocalMedia();
  } catch {
    joinBtn.disabled = false;
    setHint("Allow camera and microphone permissions");
    return;
  }

  applyCandidateLockdown();
  if (role === "candidate") await enterFullscreen();

  ws = new WebSocket(`${wsUrl()}?role=${encodeURIComponent(role)}`);
  ws.onopen = () => {
    send({ type: "join", roomId });
  };

  ws.onmessage = async (event) => {
    let msg = null;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "room-full") {
      joinBtn.disabled = false;
      setHint("This room is already in use. Use a different room code.");
      try {
        ws.close();
      } catch {
        return;
      }
      ws = null;
      return;
    }

    if (msg.type === "joined") {
      connectedPeerCount = Number(msg.peerCount || 1);
      joinPanel.classList.add("hidden");
      callStage.classList.remove("hidden");
      roomLabel.textContent = `Room ${roomId} · ${role.toUpperCase()}`;
      setStatus(connectedPeerCount >= 2 ? "Connecting…" : "Waiting for peer…");

      const iceServers = await getIceServers();
      createPeerConnection(iceServers);
      attachLocalTracks();
      if (connectedPeerCount >= 2) await maybeStartOffer();
      return;
    }

    if (msg.type === "peer-joined") {
      connectedPeerCount = Number(msg.peerCount || 2);
      setStatus("Connecting…");
      await maybeStartOffer();
      return;
    }

    if (msg.type === "peer-left") {
      connectedPeerCount = Number(msg.peerCount || 1);
      setStatus("Peer left");
      remoteVideo.srcObject = null;
      return;
    }

    if (msg.type === "signal") {
      try {
        await handleSignal(msg.data);
      } catch {
        return;
      }
    }
  };

  ws.onclose = () => {
    setStatus("Disconnected");
  };

  ws.onerror = () => {
    setStatus("Network error");
  };
}

function stopStream(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

async function startScreenShare() {
  if (!pc) return;
  if (screenStream) return;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return;
  }

  const screenTrack = screenStream.getVideoTracks()[0];
  if (!screenTrack) return;

  const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (sender) await sender.replaceTrack(screenTrack);

  const preview = new MediaStream([screenTrack]);
  localVideo.srcObject = preview;
  setControlState(shareBtn, true);

  screenTrack.onended = async () => {
    await stopScreenShare();
  };
}

async function stopScreenShare() {
  if (!pc) return;
  if (!screenStream) return;

  const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (sender && cameraVideoTrack) await sender.replaceTrack(cameraVideoTrack);

  stopStream(screenStream);
  screenStream = null;
  localVideo.srcObject = localStream;
  setControlState(shareBtn, false);
}

function toggleMic() {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  setControlState(micBtn, t.enabled);
}

function toggleCam() {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  setControlState(camBtn, t.enabled);
}

async function toggleShare() {
  if (screenStream) await stopScreenShare();
  else await startScreenShare();
}

async function leaveRoom() {
  try {
    send({ type: "leave" });
  } catch {
    return;
  }

  if (ws) {
    try {
      ws.close();
    } catch {
      return;
    }
  }

  if (pc) {
    try {
      pc.close();
    } catch {
      return;
    }
  }

  if (screenStream) await stopScreenShare();

  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  stopStream(localStream);
  localStream = null;
  pc = null;
  ws = null;

  joinBtn.disabled = false;
  callStage.classList.add("hidden");
  joinPanel.classList.remove("hidden");
  setStatus("");
}

joinBtn.addEventListener("click", joinRoom);
micBtn.addEventListener("click", toggleMic);
camBtn.addEventListener("click", toggleCam);
shareBtn.addEventListener("click", toggleShare);
fsBtn.addEventListener("click", enterFullscreen);
leaveBtn.addEventListener("click", leaveRoom);

roleSelect.addEventListener("change", () => {
  role = roleSelect.value === "hr" ? "hr" : "candidate";
  if (role === "candidate" && !enforceSEBForCandidate()) {
    setHint("Candidate mode requires Safe Exam Browser (SEB).");
  } else {
    setHint("");
  }
});

if (roleSelect.value === "candidate" && !enforceSEBForCandidate()) {
  setHint("Candidate mode requires Safe Exam Browser (SEB).");
}
