const statusEl = document.getElementById("status");
const authEl = document.getElementById("auth");
const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const authBtn = document.getElementById("authBtn");
const authError = document.getElementById("authError");
const lobbyEl = document.getElementById("lobby");
const meetingEl = document.getElementById("meeting");
const joinForm = document.getElementById("joinForm");
const logoutBtn = document.getElementById("logoutBtn");
const codeInput = document.getElementById("codeInput");
const meetingInfo = document.getElementById("meetingInfo");
const studentWaitingCard = document.getElementById("studentWaiting");
const studentWaitingBody = document.getElementById("studentWaitingBody");
const studentWaitingMeta = document.getElementById("studentWaitingMeta");
const studentJoinForm = document.getElementById("studentJoinForm");
const studentCodeInput = document.getElementById("studentCodeInput");
const interviewerDashboardEl = document.getElementById("interviewerDashboard");
const scheduleForm = document.getElementById("scheduleForm");
const studentEmailInput = document.getElementById("studentEmailInput");
const scheduleTimeInput = document.getElementById("scheduleTimeInput");
const scheduleList = document.getElementById("scheduleList");
const tabScheduleBtn = document.getElementById("tabScheduleBtn");
const tabJoinBtn = document.getElementById("tabJoinBtn");
const tabSchedulePanel = document.getElementById("tabSchedule");
const tabJoinPanel = document.getElementById("tabJoin");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const localVideo = document.getElementById("localVideo");
const localCard = document.getElementById("localCard");
const localOff = document.getElementById("localOff");
const remoteVideos = document.getElementById("remoteVideos");
const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const leaveBtn = document.getElementById("leaveBtn");
const meetingStageEl = meetingEl.querySelector(".meetingStage");

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
let lastDashboard = null;
let lastStudentStatus = null;
let autoJoinAttempted = new Set();
let interviewerTab = "schedule";

const peers = new Map();
const remoteMedia = new Map();
const remoteCards = new Map();
let proctorSuppressed = false;
const proctor = createProctor();
const localCardHome = { parent: localCard.parentElement, nextSibling: localCard.nextSibling };
const proctorFlags = new Map();
let presenterPeerId = null;
let presenterStageEl = null;

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

function formatLocalTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  return d.toLocaleString();
}

function clearChildren(el) {
  if (!el) return;
  el.replaceChildren();
}

function applyRoleUI() {
  const role = currentUser?.role;
  const isStudent = role === "student";
  const isInterviewer = role === "interviewer";

  joinForm.classList.toggle("hidden", !isInterviewer || interviewerTab !== "join");
  studentWaitingCard.classList.toggle("hidden", !isStudent);
  interviewerDashboardEl.classList.toggle("hidden", !isInterviewer);

  if (tabSchedulePanel) tabSchedulePanel.classList.toggle("hidden", !isInterviewer || interviewerTab !== "schedule");
  if (tabJoinPanel) tabJoinPanel.classList.toggle("hidden", !isInterviewer || interviewerTab !== "join");
  if (tabScheduleBtn) tabScheduleBtn.classList.toggle("active", interviewerTab === "schedule");
  if (tabJoinBtn) tabJoinBtn.classList.toggle("active", interviewerTab === "join");
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
    meetingInfo.textContent = "Open in the specified app to continue.";
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
    if (proctorSuppressed) return false;
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
    if (isSafeExamBrowser()) return;
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
    try {
      const payload = {
        type: "violation",
        reason,
        at: new Date().toISOString()
      };
      ensureSocket().emit("proctor-event", payload);
    } catch {
    }

    if (state.maxWarnings && state.warnings >= state.maxWarnings) {
      leave().catch(() => {});
    }
  }

  function onVisibilityChange() {
    if (document.hidden) reportViolation("You left the interview tab.");
  }

  function onBlur() {
    if (document.hidden) return;
    if (isSafeExamBrowser()) return;
    reportViolation("The interview window lost focus.");
  }

  function onMouseLeave() {
    if (isSafeExamBrowser()) return;
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
    if (currentUser?.role === "student" && !isSafeExamBrowser()) {
      showOverlay("Click “Return to interview” to enter fullscreen and start the proctored session.");
    }
    await tryRestore();
    if (document.fullscreenElement || isSafeExamBrowser()) hideOverlay();
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
  localVideo.play().catch(() => {});
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

function mountMeetingUI() {
  document.body.classList.add("inMeeting");
  if (localCard.parentElement !== remoteVideos) remoteVideos.prepend(localCard);
  ensurePresenterStage();
}

function unmountMeetingUI() {
  document.body.classList.remove("inMeeting");
  clearPresenter();
  if (localCardHome.parent) localCardHome.parent.insertBefore(localCard, localCardHome.nextSibling);
}

function ensurePresenterStage() {
  if (presenterStageEl) return presenterStageEl;
  const el = document.createElement("div");
  el.id = "presenterStage";
  el.className = "presenterStage hidden";
  if (meetingStageEl) meetingStageEl.prepend(el);
  presenterStageEl = el;
  return el;
}

function clearPresenter() {
  presenterPeerId = null;
  meetingEl.classList.remove("presenting");
  if (presenterStageEl) {
    const staged = presenterStageEl.querySelector(".videoCard");
    if (staged) remoteVideos.prepend(staged);
    presenterStageEl.classList.add("hidden");
  }
  for (const el of remoteVideos.querySelectorAll(".videoCard.presenter")) el.classList.remove("presenter");
  if (localCard.parentElement !== remoteVideos) remoteVideos.prepend(localCard);
  for (const { card } of remoteCards.values()) {
    if (card.parentElement !== remoteVideos) remoteVideos.appendChild(card);
  }
}

function getCardForPeer(peerId) {
  if (!peerId) return null;
  if (peerId === socket?.id) return localCard;
  return remoteCards.get(peerId)?.card ?? null;
}

function setPresenter(peerId) {
  ensurePresenterStage();
  const card = getCardForPeer(peerId);
  if (!card) return;
  if (presenterPeerId === peerId) return;
  presenterPeerId = peerId;
  meetingEl.classList.add("presenting");
  for (const el of remoteVideos.querySelectorAll(".videoCard.presenter")) el.classList.remove("presenter");
  if (presenterStageEl && card.parentElement !== presenterStageEl) presenterStageEl.replaceChildren(card);
  if (presenterStageEl) presenterStageEl.classList.remove("hidden");
  card.classList.add("presenter");
  if (localCard !== card && localCard.parentElement !== remoteVideos) remoteVideos.prepend(localCard);
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

  socket.on("connect", () => {
    if (currentUser?.email) setStatus(`Connected as ${currentUser.email}`);
    else setStatus("Connected");
  });
  socket.on("disconnect", () => setStatus("Disconnected"));
  socket.on("connect_error", () => setStatus("Connection error"));

  socket.on("dashboard-update", (payload) => {
    lastDashboard = payload || null;
    renderDashboard();
  });

  socket.on("student-status", (payload) => {
    lastStudentStatus = payload || null;
    renderStudentWaiting();
  });

  socket.on("join-request", ({ studentEmail, roomCode }) => {
    if (currentUser?.role !== "interviewer") return;
    const email = String(studentEmail || "");
    const code = normalizeCode(roomCode);
    const label = email || "student";
    const message = code
      ? `${label} wants to join meeting ${code}. Admit this student?`
      : `${label} wants to join the meeting. Admit this student?`;
    const accept = window.confirm(message);
    ensureSocket().emit("join-request-decision", { studentEmail: email, roomCode: code, accept });
  });

  socket.on("admitted", ({ roomCode: admittedCode }) => {
    const code = normalizeCode(admittedCode);
    if (!code) return;
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = `Interviewer allowed you to join. Enter the code below and click Join to start the interview.`;
    if (currentUser?.role === "student" && studentJoinForm && studentCodeInput) {
      studentCodeInput.value = code;
      studentJoinForm.classList.remove("hidden");
    }
  });

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

  socket.on("screen-share", ({ peerId, sharing }) => {
    if (sharing) {
      setPresenter(peerId);
      return;
    }
    if (presenterPeerId === peerId) clearPresenter();
  });

  socket.on("proctor-event", ({ peerId, reason }) => {
    if (!peerId) return;
    const entry = remoteCards.get(peerId);
    if (!entry || !entry.card) return;
    const card = entry.card;
    let flag = entry.flag;
    if (!flag) {
      flag = document.createElement("div");
      flag.className = "proctorFlag";
      card.appendChild(flag);
      entry.flag = flag;
    }
    const text = reason || "Student left the interview window.";
    flag.textContent = text;
    flag.classList.remove("hidden");
    card.classList.add("proctorFlagged");
    const existingTimeout = proctorFlags.get(peerId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeoutId = setTimeout(() => {
      flag.classList.add("hidden");
      card.classList.remove("proctorFlagged");
      proctorFlags.delete(peerId);
    }, 5000);
    proctorFlags.set(peerId, timeoutId);
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

function resetSocket() {
  lastDashboard = null;
  lastStudentStatus = null;
  autoJoinAttempted = new Set();

  if (!socket) return;
  try {
    socket.disconnect();
  } catch {
  }
  socket = undefined;
}

function statusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "in_room" || s === "done") return "good";
  if (s === "waiting" || s === "admitted") return "warn";
  if (s === "scheduled") return "";
  return "bad";
}

function renderDashboard() {
  if (currentUser?.role !== "interviewer") return;
  const dash = lastDashboard;
  clearChildren(scheduleList);
  if (!dash) return;

  const items = (Array.isArray(dash.schedule) ? dash.schedule : []).filter(
    (entry) => String(entry.status || "").toLowerCase() !== "done"
  );
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dashItem";
    empty.textContent = "No scheduled interviews yet.";
    scheduleList.appendChild(empty);
  } else {
    for (const entry of items) {
      const row = document.createElement("div");
      row.className = "dashItem";

      const left = document.createElement("div");
      left.className = "dashLeft";

      const primary = document.createElement("div");
      primary.className = "dashPrimary";
      const studentLabel = entry.studentName
        ? `${entry.studentName} (${entry.studentEmail || "student"})`
        : entry.studentEmail || "student";
      primary.textContent = `${studentLabel} · ${formatLocalTime(entry.scheduledAt)}`;

      const secondary = document.createElement("div");
      secondary.className = "dashSecondary";
      secondary.textContent = entry.roomCode
        ? `Code ${entry.roomCode} · ${entry.online ? "online" : "offline"}`
        : `Code will be created when you join · ${entry.online ? "online" : "offline"}`;

      left.appendChild(primary);
      left.appendChild(secondary);

      const actions = document.createElement("div");
      actions.className = "dashActions";

      const statusPill = document.createElement("div");
      statusPill.className = `pill ${statusPillClass(entry.status)}`;
      statusPill.textContent = String(entry.status || "scheduled").replace(/_/g, " ");
      actions.appendChild(statusPill);

      const admitBtn = document.createElement("button");
      admitBtn.type = "button";
      admitBtn.className = "btn";
      admitBtn.textContent = "Admit";
      admitBtn.disabled = !entry.roomCode || !entry.online || entry.status === "done" || entry.status === "in_room";
      admitBtn.addEventListener("click", async () => {
        meetingInfo.classList.add("hidden");
        const res = await new Promise((resolve) => {
          ensureSocket().emit("schedule-admit", { scheduleId: entry.id }, (ack) => resolve(ack || { ok: false }));
        });
        if (!res.ok) {
          meetingInfo.classList.remove("hidden");
          meetingInfo.textContent = res.error || "Failed to admit student";
          return;
        }
        meetingInfo.classList.remove("hidden");
        meetingInfo.textContent = `Admitted ${studentLabel}.`;
      });
      actions.appendChild(admitBtn);

      const joinBtn = document.createElement("button");
      joinBtn.type = "button";
      joinBtn.className = "btn primary";
      joinBtn.textContent = entry.roomCode ? "Join" : "Create & Join";
      joinBtn.addEventListener("click", async () => {
        meetingInfo.classList.add("hidden");
        let ensuredCode = entry.roomCode || null;
        if (!ensuredCode) {
          const res = await new Promise((resolve) => {
            ensureSocket().emit("schedule-join", { scheduleId: entry.id }, (ack) => resolve(ack || { ok: false }));
          });
          if (!res.ok) {
            meetingInfo.classList.remove("hidden");
            meetingInfo.textContent = res.error || "Failed to create meeting code";
            return;
          }
          ensuredCode = res.roomCode || null;
        }

        if (!ensuredCode) {
          meetingInfo.classList.remove("hidden");
          meetingInfo.textContent = "Failed to create meeting code";
          return;
        }

        await join(ensuredCode);
      });
      actions.appendChild(joinBtn);

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "btn";
      doneBtn.textContent = "Done";
      doneBtn.disabled = entry.status === "done";
      doneBtn.addEventListener("click", async () => {
        const res = await new Promise((resolve) => {
          ensureSocket().emit("schedule-done", { scheduleId: entry.id }, (ack) => resolve(ack || { ok: false }));
        });
        if (!res.ok) {
          meetingInfo.classList.remove("hidden");
          meetingInfo.textContent = res.error || "Failed to mark done";
        }
      });
      actions.appendChild(doneBtn);

      row.appendChild(left);
      row.appendChild(actions);
      scheduleList.appendChild(row);
    }
  }
}

function renderStudentWaiting() {
  if (currentUser?.role !== "student") return;
  const status = lastStudentStatus;
  if (!status) {
    studentWaitingBody.textContent = "Waiting for interviewer…";
    studentWaitingMeta.textContent = "";
    if (studentJoinForm) studentJoinForm.classList.add("hidden");
    return;
  }

  const schedule = Array.isArray(status.schedule) ? status.schedule : [];
  const admittedRooms = Array.isArray(status.admittedRooms) ? status.admittedRooms : [];
  const sorted = [...schedule].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const next = sorted[0] || null;

  if (next) {
    studentWaitingBody.textContent = `Your interview time: ${formatLocalTime(next.scheduledAt)}`;
    const interviewerLabel = next.interviewerName
      ? `${next.interviewerName} (${next.interviewerEmail})`
      : next.interviewerEmail;
    studentWaitingMeta.textContent = next.roomCode
      ? `Interviewer: ${interviewerLabel} · Code: ${next.roomCode}`
      : `Interviewer: ${interviewerLabel} · Code will appear when interviewer joins`;
  } else {
    studentWaitingBody.textContent = "Waiting for interviewer…";
    studentWaitingMeta.textContent = "No scheduled slot found for your email.";
  }

  const code = normalizeCode(admittedRooms[0]);
  if (code && studentJoinForm && studentCodeInput) {
    studentCodeInput.value = code;
    studentJoinForm.classList.remove("hidden");
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Interviewer admitted you. Check the code below and click Join to enter the interview.";
  } else if (studentJoinForm) {
    studentJoinForm.classList.add("hidden");
  }
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

  remoteCards.set(peerId, { card, video, flag: null });
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
  remoteCards.delete(peerId);
  const el = document.getElementById(`remote-${peerId}`);
  if (el) el.remove();
  if (presenterPeerId === peerId) clearPresenter();
}

async function join(code) {
  if (currentUser?.role === "student") {
    if (!isSafeExamBrowser()) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = "Open in the specified app to continue.";
      return;
    }

    const sebCheck = await api("/api/seb-check", { method: "POST" });
    if (!sebCheck.ok) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = sebCheck.body?.error || "Open in the specified app to continue.";
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
  clearPresenter();
  if (currentUser?.role === "student") {
    proctorSuppressed = false;
    await proctor.start();
  }
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
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: false
    });
  } catch (err) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = String(err?.message || err || "Screen sharing failed");
    return;
  }
  const screenTrack = screenStream.getVideoTracks()[0];
  if (!screenTrack) return;

  isScreenSharing = true;
  syncControlUI();

  const audioTrack = cameraStream?.getAudioTracks()[0] ?? null;
  localStream = new MediaStream([screenTrack, ...(audioTrack ? [audioTrack] : [])]);
  localVideo.srcObject = localStream;
  localVideo.play().catch(() => {});
  if (socket?.connected) {
    ensureSocket().emit("screen-share", { sharing: true });
    setPresenter(socket.id);
  }

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
  localStream = cameraStream;
  localVideo.srcObject = localStream;
  localVideo.play().catch(() => {});
  if (socket?.connected) {
    ensureSocket().emit("screen-share", { sharing: false });
    if (presenterPeerId === socket.id) clearPresenter();
  }

  for (const pc of peers.values()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }
}

async function leave() {
  proctor.stop();
  clearPresenter();
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

joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await join(codeInput.value);
});

if (studentJoinForm) {
  studentJoinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await join(studentCodeInput.value);
  });
}

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
  proctorSuppressed = true;
  leave().catch(() => {});
});

logoutBtn.addEventListener("click", () => {
  proctorSuppressed = true;
  leave().catch(() => {});

  authToken = "";
  localStorage.removeItem("authToken");
  currentUser = null;
  proctor.stop();

  resetSocket();

  setAuthed(false);
  setStatus("Not connected");
  emailInput.value = "";
  if (passwordInput) passwordInput.value = "";
});

window.addEventListener("beforeunload", () => {
  if (socket && socket.connected) socket.emit("leave-room");
});

setLobbyVisible(true);
setStatus("Not connected");
syncControlUI();

async function bootstrapAuth() {
  authError.classList.add("hidden");
  authError.textContent = "";

  authToken = localStorage.getItem("authToken") || "";
  currentUser = null;
  proctor.stop();
  resetSocket();

  const resetToLoggedOut = () => {
    setAuthed(false);
    authBtn.textContent = "Log in";
    setStatus("Not connected");
    interviewerTab = "schedule";
    applyRoleUI();
    applyStudentJoinPolicy();
    studentWaitingBody.textContent = "Waiting for interviewer…";
    studentWaitingMeta.textContent = "";
    meetingInfo.classList.add("hidden");
    if (passwordInput) passwordInput.value = "";
  };

  if (!authToken) {
    localStorage.removeItem("authToken");
    resetToLoggedOut();
    return;
  }

  const res = await api("/api/me");
  if (!res.ok || !res.body?.user) {
    authToken = "";
    localStorage.removeItem("authToken");
    resetToLoggedOut();
    return;
  }

  currentUser = res.body.user;
  setAuthed(true);
  authBtn.textContent = "Log in";
  setStatus(`Logged in as ${currentUser.role}`);
  applyRoleUI();
  applyStudentJoinPolicy();
  resetSocket();
  ensureSocket();
  if (currentUser?.role === "interviewer") {
    ensureSocket().emit("dashboard-subscribe", {}, () => {});
  }
  renderStudentWaiting();
  const urlCode = new URL(window.location.href).searchParams.get("code");
  if (urlCode) {
    const normalized = normalizeCode(urlCode);
    if (normalized) {
      codeInput.value = normalized;
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent =
        currentUser?.role === "interviewer"
          ? "Meeting code loaded from link. Click Join to enter the meeting."
          : "Meeting code loaded from link. Wait for the interviewer to admit you.";
    }
  }
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authError.textContent = "";

  const email = String(emailInput.value || "").trim();
  const password = String(passwordInput?.value || "").trim();

  if (!password) {
    authError.classList.remove("hidden");
    authError.textContent = "Password is required";
    return;
  }

  const res = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
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
  authBtn.textContent = "Log in";
  setStatus(`Logged in as ${currentUser.role}`);
  applyRoleUI();
  applyStudentJoinPolicy();
  resetSocket();
  ensureSocket();
  if (currentUser?.role === "interviewer") {
    ensureSocket().emit("dashboard-subscribe", {}, () => {});
  }
  renderStudentWaiting();
  const urlCode = new URL(window.location.href).searchParams.get("code");
  if (urlCode) {
    const normalized = normalizeCode(urlCode);
    if (normalized) {
      codeInput.value = normalized;
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent =
        currentUser?.role === "interviewer"
          ? "Meeting code loaded from link. Click Join to enter the meeting."
          : "Meeting code loaded from link. Wait for the interviewer to admit you.";
    }
  }
});

function setInterviewerTab(tab) {
  const t = String(tab || "").toLowerCase();
  interviewerTab = t === "join" ? "join" : "schedule";
  applyRoleUI();
  if (interviewerTab === "join") renderDashboard();
}

if (tabScheduleBtn) tabScheduleBtn.addEventListener("click", () => setInterviewerTab("schedule"));
if (tabJoinBtn) tabJoinBtn.addEventListener("click", () => setInterviewerTab("join"));

if (scheduleForm) {
  scheduleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentUser?.role !== "interviewer") return;
    const studentEmail = String(studentEmailInput.value || "").trim();
    const rawTime = String(scheduleTimeInput.value || "").trim();
    let scheduledAt = null;
    if (rawTime) {
      const d = new Date(rawTime);
      if (!Number.isNaN(d.getTime())) scheduledAt = d.toISOString();
    }
    if (!scheduledAt) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = "Invalid scheduled time";
      return;
    }
    meetingInfo.classList.add("hidden");
    const res = await new Promise((resolve) => {
      ensureSocket().emit("schedule-add", { studentEmail, scheduledAt }, (ack) => resolve(ack || { ok: false }));
    });
    if (!res.ok) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = res.error || "Failed to add slot";
      return;
    }
    studentEmailInput.value = "";
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = `Added slot for ${res.entry?.studentEmail || studentEmail}.`;
  });
}

bootstrapAuth().catch(() => {});
