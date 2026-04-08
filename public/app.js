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
const proctor = createProctor();
const localCardHome = { parent: localCard.parentElement, nextSibling: localCard.nextSibling };

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

function applyStudentJoinPolicy() {
  const isStudent = currentUser?.role === "student";
  const allowed = !isStudent || isSafeExamBrowser();

  codeInput.disabled = !allowed;
  const joinBtn = joinForm.querySelector('button[type="submit"]');
  if (joinBtn) joinBtn.disabled = !allowed;

  if (!allowed) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Students must open this link using the provided exam browser configuration (.seb).";
  }
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

function createProctor() {
  const state = {
    enabled: false,
    warnings: 0,
    maxWarnings: 3,
    overlay: null,
    overlayTitle: null,
    overlayBody: null,
    overlayCount: null,
    overlayBtn: null,
    lastAlertAt: 0,
    lastViolationAt: 0
  };

  function isStudentInMeeting() {
    if (!state.enabled) return false;
    if (currentUser?.role !== "student") return false;
    if (meetingEl.classList.contains("hidden")) return false;
    return true;
  }

  function ensureOverlay() {
    if (state.overlay) return;

    const overlay = document.createElement("div");
    overlay.id = "proctorOverlay";
    overlay.className = "proctorOverlay hidden";

    const panel = document.createElement("div");
    panel.className = "proctorPanel";

    const title = document.createElement("div");
    title.className = "proctorTitle";
    title.textContent = "Proctor alert";

    const body = document.createElement("div");
    body.className = "proctorBody";
    body.textContent = "Return to the interview window to continue.";

    const count = document.createElement("div");
    count.className = "proctorCount";
    count.textContent = "";

    const actions = document.createElement("div");
    actions.className = "proctorActions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn primary";
    btn.textContent = "Return to interview";

    actions.appendChild(btn);
    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(count);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    state.overlay = overlay;
    state.overlayTitle = title;
    state.overlayBody = body;
    state.overlayCount = count;
    state.overlayBtn = btn;

    btn.addEventListener("click", async () => {
      hideOverlay();
      await tryRestore();
    });
  }

  function showOverlay(message) {
    ensureOverlay();
    state.overlayBody.textContent = message;
    state.overlayCount.textContent = state.maxWarnings
      ? `Warnings: ${state.warnings}/${state.maxWarnings}`
      : `Warnings: ${state.warnings}`;
    state.overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    if (!state.overlay) return;
    state.overlay.classList.add("hidden");
  }

  async function tryRestore() {
    try {
      if (!document.fullscreenElement && meetingEl.requestFullscreen) {
        await meetingEl.requestFullscreen();
      }
    } catch {
    }
    try {
      window.focus();
    } catch {
    }
  }

  function throttledAlert(text) {
    const now = Date.now();
    if (now - state.lastAlertAt < 1200) return;
    state.lastAlertAt = now;
    try {
      window.alert(text);
    } catch {
    }
  }

  function reportViolation(reason) {
    if (!isStudentInMeeting()) return;
    const now = Date.now();
    if (now - state.lastViolationAt < 1500) return;
    state.lastViolationAt = now;
    state.warnings += 1;

    const message = `${reason} Return to the interview window.`;
    showOverlay(message);
    throttledAlert(message);

    if (state.maxWarnings && state.warnings >= state.maxWarnings) {
      leave().catch(() => {});
    }
  }

  function onVisibilityChange() {
    if (document.hidden) reportViolation("You left the interview tab.");
  }

  function onBlur() {
    if (document.hidden) return;
    reportViolation("The interview window lost focus.");
  }

  function onMouseLeave() {
    reportViolation("Your cursor left the interview window.");
  }

  function onFullscreenChange() {
    if (!isStudentInMeeting()) return;
    if (!document.fullscreenElement) reportViolation("Fullscreen was exited.");
  }

  function shouldBlockKey(e) {
    const key = String(e.key || "").toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    if (key === "f12") return true;
    if (ctrl && (key === "r" || key === "w" || key === "t" || key === "n")) return true;
    if (ctrl && e.shiftKey && (key === "i" || key === "j" || key === "c")) return true;
    if (key === "escape" && document.fullscreenElement) return true;
    return false;
  }

  function onKeyDown(e) {
    if (!isStudentInMeeting()) return;
    if (!shouldBlockKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    reportViolation("A restricted shortcut was used.");
  }

  function onContextMenu(e) {
    if (!isStudentInMeeting()) return;
    e.preventDefault();
    e.stopPropagation();
    reportViolation("Right click is restricted.");
  }

  function onClipboard(e) {
    if (!isStudentInMeeting()) return;
    e.preventDefault();
    e.stopPropagation();
    reportViolation("Clipboard actions are restricted.");
  }

  async function start() {
    state.enabled = true;
    state.warnings = 0;
    ensureOverlay();
    if (currentUser?.role === "student") {
      showOverlay("Click “Return to interview” to enter fullscreen and start the proctored session.");
    }
    await tryRestore();
    if (document.fullscreenElement) hideOverlay();
  }

  function stop() {
    state.enabled = false;
    state.warnings = 0;
    hideOverlay();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onBlur);
  document.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("copy", onClipboard, true);
  document.addEventListener("cut", onClipboard, true);
  document.addEventListener("paste", onClipboard, true);

  return { start, stop };
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
  meetingEl.classList.toggle("sharing", isScreenSharing);
}

function mountMeetingUI() {
  document.body.classList.add("inMeeting");
  if (localCard.parentElement !== remoteVideos) remoteVideos.prepend(localCard);
}

function unmountMeetingUI() {
  document.body.classList.remove("inMeeting");
  if (localCardHome.parent) localCardHome.parent.insertBefore(localCard, localCardHome.nextSibling);
  meetingEl.classList.remove("sharing");
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
  socket = window.io({
    auth: { token: authToken }
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
    if (!isSafeExamBrowser()) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = "Students must open this link using the provided exam browser configuration (.seb).";
      return;
    }

    const sebCheck = await api("/api/seb-check", { method: "POST" });
    if (!sebCheck.ok) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = sebCheck.body?.error || "Students must use the provided exam browser configuration (.seb).";
      return;
    }
  }

  roomCode = normalizeCode(code);
  if (!roomCode) return;

  codeInput.value = roomCode;
  setStatus("Requesting camera/mic…");

  await ensureCamera();

  setStatus("Joining room…");
  const joinResult = await new Promise((resolve) => {
    ensureSocket().emit("join-room", { roomCode }, (ack) => resolve(ack || { ok: true }));
  });

  if (!joinResult.ok) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = joinResult.error || "Failed to join meeting";
    return;
  }

  setLobbyVisible(false);
  roomCodeLabel.textContent = roomCode;
  mountMeetingUI();
  const url = new URL(window.location.href);
  url.searchParams.set("code", roomCode);
  window.history.replaceState({}, "", url.toString());

  if (currentUser?.role === "student") {
    proctor.start().catch(() => {});
  }
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
  proctor.stop();
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
  unmountMeetingUI();

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
  proctor.stop();

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
  authToken = "";
  localStorage.removeItem("authToken");
  currentUser = null;
  proctor.stop();

  setAuthed(false);
  authBtn.textContent = "Check account";
  setStatus("Not connected");
  applyStudentJoinPolicy();
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
  const urlCode = new URL(window.location.href).searchParams.get("code");
  if (urlCode) {
    const normalized = normalizeCode(urlCode);
    if (normalized) {
      codeInput.value = normalized;
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = "Meeting code loaded from link. Click Join to enter the meeting.";
    }
  }
});

initAuth().catch(() => {});
