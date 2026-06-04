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
const aiInterviewCard = document.getElementById("aiInterviewCard");
const aiPoseBadge = document.getElementById("aiPoseBadge");
const aiIntro = document.getElementById("aiIntro");
const aiSessionEl = document.getElementById("aiSession");
const aiStartBtn = document.getElementById("aiStartBtn");
const aiConsentBtn = document.getElementById("aiConsentBtn");
const aiProgressEl = document.getElementById("aiProgress");
const aiTimerEl = document.getElementById("aiTimer");
const aiQuestionEl = document.getElementById("aiQuestion");
const aiTranscriptEl = document.getElementById("aiTranscript");
const aiAnswerInput = document.getElementById("aiAnswerInput");
const aiRecordBtn = document.getElementById("aiRecordBtn");
const aiStopBtn = document.getElementById("aiStopBtn");
const aiRecorderMeta = document.getElementById("aiRecorderMeta");
const aiPoseMeta = document.getElementById("aiPoseMeta");
const aiNextBtn = document.getElementById("aiNextBtn");
const aiFinishBtn = document.getElementById("aiFinishBtn");
const aiFeedbackEl = document.getElementById("aiFeedback");
const interviewerDashboardEl = document.getElementById("interviewerDashboard");
const scheduleForm = document.getElementById("scheduleForm");
const studentEmailInput = document.getElementById("studentEmailInput");
const scheduleModeInput = document.getElementById("scheduleModeInput");
const scheduleTimeInput = document.getElementById("scheduleTimeInput");
const scheduleTimeBtn = document.getElementById("scheduleTimeBtn");
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
const aiHudEl = document.getElementById("aiHud");
const aiHudStatusEl = document.getElementById("aiHudStatus");
const aiMeetingBarEl = document.getElementById("aiMeetingBar");
const aiMeetingStatusEl = document.getElementById("aiMeetingStatus");
const aiMeetingSpeakBtn = document.getElementById("aiMeetingSpeakBtn");
const aiMeetingStopBtn = document.getElementById("aiMeetingStopBtn");
const aiMeetingNextBtn = document.getElementById("aiMeetingNextBtn");
const aiMeetingFinishBtn = document.getElementById("aiMeetingFinishBtn");
const aiCenterOverlayEl = document.getElementById("aiCenterOverlay");
const aiCenterOverlayTextEl = document.getElementById("aiCenterOverlayText");

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
const aiReports = new Map();
let aiActiveScheduleId = null;
let aiSessionId = null;
let aiQuestions = [];
let aiQuestionIndex = 0;
let aiQuestionStartedAt = 0;
let aiThinkIntervalId = null;
let aiThinkToken = 0;
let aiMediaRecorder = null;
let aiRecordingStartAt = 0;
let aiAudioChunks = [];
let aiLatestAudioBuffer = null;
let aiLatestAudioMimeType = "audio/webm";
let aiLatestTranscript = "";
let aiStopPromise = null;
let aiStopPromiseResolve = null;
let aiAnswerReady = false;
let aiHasRecordedThisQuestion = false;
let aiAllowSpeak = false;
let aiMeetingMounted = false;
let aiPoseIntervalId = null;
let aiPoseStableTotal = 0;
let aiPoseSamples = 0;
let aiPoseUnsteadyStreak = 0;
let aiPoseWarnings = 0;
let aiSpeakAudio = null;
let aiSpeakUrl = null;
let aiSubmitting = false;
let aiAutoStartAttemptedForScheduleId = null;
let aiStopping = false;
let aiFinalizedThisRecording = false;
let aiReviewIntervalId = null;
let aiReviewRemainingSec = 0;
let aiUseLiveStt = false;
let aiLiveSttSessionToken = 0;
let aiLiveSttActiveToken = 0;
let aiLiveSttLatestText = "";
let aiLiveSttFinalText = "";
let aiLiveSttStopPromise = null;
let aiQuitting = false;
let aiAnswerIntervalId = null;
let aiAnswerRemainingSec = 0;

function formatMmSs(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const peers = new Map();
const remoteMedia = new Map();
const remoteCards = new Map();
let proctorSuppressed = false;
const proctor = createProctor();
const localCardHome = { parent: localCard.parentElement, nextSibling: localCard.nextSibling };
const aiInterviewCardHome = { parent: aiInterviewCard?.parentElement || null, nextSibling: aiInterviewCard?.nextSibling || null };
const proctorFlags = new Map();
let presenterPeerId = null;
let presenterStageEl = null;

function setStatus(text) {
  const value = String(text || "");
  statusEl.textContent = value;
  const isBad = /error|disconnected/i.test(value);
  const isOk = !isBad && /connected|logged in|joining|requesting/i.test(value);
  statusEl.classList.toggle("ok", isOk);
  statusEl.classList.toggle("bad", isBad);
  statusEl.classList.toggle("neutral", !isOk && !isBad);
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
  const actualMicOn = cameraStream?.getAudioTracks?.()?.some?.((t) => t && t.enabled && t.readyState === "live") ?? micEnabled;
  const actualCamOn = cameraStream?.getVideoTracks?.()?.some?.((t) => t && t.enabled && t.readyState === "live") ?? cameraEnabled;

  micBtn.classList.toggle("off", !actualMicOn);
  camBtn.classList.toggle("off", !actualCamOn);

  micBtn.textContent = actualMicOn ? "Mic on" : "Mic off";
  camBtn.textContent = actualCamOn ? "Camera on" : "Camera off";

  localOff.classList.toggle("hidden", actualCamOn || isScreenSharing);
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

function requestFullscreen(target) {
  try {
    if (document.fullscreenElement) return;
    if (target && typeof target.requestFullscreen === "function") {
      target.requestFullscreen().catch(() => {});
    }
  } catch {
  }
}

function setAiMeetingStatus(text) {
  const value = String(text || "").trim() || "Listening…";
  if (aiHudStatusEl) aiHudStatusEl.textContent = value;
  if (aiMeetingStatusEl) aiMeetingStatusEl.textContent = value;
}

function stopAiReviewWindow() {
  if (aiReviewIntervalId) clearInterval(aiReviewIntervalId);
  aiReviewIntervalId = null;
  aiReviewRemainingSec = 0;
  syncAiMeetingButtons();
}

function beginAiReviewWindow(seconds) {
  stopAiReviewWindow();
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  if (!total) return;
  aiReviewRemainingSec = total;
  setAiMeetingStatus(`Review (${aiReviewRemainingSec}s)`);
  syncAiMeetingButtons();
  aiReviewIntervalId = setInterval(() => {
    aiReviewRemainingSec = Math.max(0, aiReviewRemainingSec - 1);
    if (aiReviewRemainingSec <= 0) {
      stopAiReviewWindow();
      submitAiAnswer({ finish: false, auto: true }).catch(() => {});
      return;
    }
    setAiMeetingStatus(`Review (${aiReviewRemainingSec}s)`);
    syncAiMeetingButtons();
  }, 1000);
}

function startAiAnswerTimer(seconds) {
  if (aiAnswerIntervalId) clearInterval(aiAnswerIntervalId);
  aiAnswerIntervalId = null;
  aiAnswerRemainingSec = Math.max(0, Math.floor(Number(seconds || 0)));
  if (aiTimerEl) aiTimerEl.textContent = formatMmSs(aiAnswerRemainingSec);
  aiAnswerIntervalId = setInterval(() => {
    if (aiMediaRecorder?.state !== "recording") return;
    aiAnswerRemainingSec = Math.max(0, aiAnswerRemainingSec - 1);
    if (aiTimerEl) aiTimerEl.textContent = formatMmSs(aiAnswerRemainingSec);
    setAiMeetingStatus(`Recording ${formatMmSs(aiAnswerRemainingSec)}`);
    if (aiAnswerRemainingSec <= 0) {
      clearInterval(aiAnswerIntervalId);
      aiAnswerIntervalId = null;
      stopAndShowReviewAi().catch(() => {});
    }
  }, 1000);
}

async function stopAndShowReviewAi() {
  if (!aiSessionId) return;
  stopAiReviewWindow();
  if (aiMediaRecorder?.state === "recording") {
    await stopAiRecording({ waitMs: 20000 });
  }
}

async function stopAndContinueAi() {
  if (!aiSessionId) return;
  stopAiReviewWindow();
  if (aiMediaRecorder?.state === "recording") await stopAiRecording({ waitMs: 12000 });
  await submitAiAnswer({ finish: false }).catch(() => {});
}

async function confirmQuitAiInterview() {
  const ok = window.confirm("Do you want to quit the interview?");
  if (!ok) return;
  aiQuitting = true;
  stopAiReviewWindow();
  stopAiTimer();
  stopAiPoseMonitor();
  stopAiSpeech();
  hideAiCenterOverlay();
  aiAllowSpeak = false;

  try {
    if (aiMediaRecorder?.state === "recording") {
      try {
        if (typeof aiMediaRecorder.requestData === "function") aiMediaRecorder.requestData();
      } catch {
      }
      try {
        aiMediaRecorder.stop();
      } catch {
      }
    }
  } catch {
  }

  if (aiSessionId) {
    try {
      await Promise.race([
        new Promise((resolve) => {
          ensureSocket().emit("ai-finish", { sessionId: aiSessionId }, () => resolve(true));
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), 6000))
      ]);
    } catch {
    }
  }

  aiSessionId = null;
  aiQuestions = [];
  aiQuestionIndex = 0;
  aiAnswerReady = false;
  aiHasRecordedThisQuestion = false;
  aiStopping = false;
  aiFinalizedThisRecording = false;
  setAiMode(false);
  aiQuitting = false;
}

function showAiCenterOverlay(text) {
  if (!aiCenterOverlayEl || !aiCenterOverlayTextEl) return;
  aiCenterOverlayTextEl.textContent = String(text || "");
  aiCenterOverlayEl.classList.remove("hidden");
}

function hideAiCenterOverlay() {
  if (!aiCenterOverlayEl) return;
  aiCenterOverlayEl.classList.add("hidden");
}

function stopAiThinkCountdown() {
  if (aiThinkIntervalId) clearInterval(aiThinkIntervalId);
  aiThinkIntervalId = null;
}

async function runAiThinkCountdown(seconds, token) {
  stopAiThinkCountdown();
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  let remaining = total;
  if (remaining <= 0) return true;
  showAiCenterOverlay(`You have ${remaining} seconds to think`);
  return await new Promise((resolve) => {
    aiThinkIntervalId = setInterval(() => {
      if (token !== aiThinkToken) {
        stopAiThinkCountdown();
        resolve(false);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        stopAiThinkCountdown();
        resolve(true);
        return;
      }
      showAiCenterOverlay(`You have ${remaining} seconds to think`);
    }, 1000);
  });
}

function syncAiMeetingButtons() {
  const isRecording = aiMediaRecorder?.state === "recording";
  const canSpeak = !aiSubmitting && !aiStopping && !aiAnswerReady && !aiHasRecordedThisQuestion && aiAllowSpeak && !isRecording;
  if (aiMeetingSpeakBtn) {
    aiMeetingSpeakBtn.disabled = !canSpeak;
    aiMeetingSpeakBtn.classList.toggle("hidden", !aiAllowSpeak || aiHasRecordedThisQuestion || isRecording);
  }
  if (aiMeetingStopBtn) {
    aiMeetingStopBtn.disabled = !isRecording || aiStopping;
    aiMeetingStopBtn.classList.toggle("hidden", !isRecording);
  }
  const canSubmit = !aiSubmitting && !isRecording && aiAnswerReady;
  if (aiMeetingNextBtn) {
    aiMeetingNextBtn.disabled = !canSubmit;
    aiMeetingNextBtn.textContent = aiReviewRemainingSec > 0 ? `Proceed (${aiReviewRemainingSec}s)` : "Proceed";
  }
  if (aiMeetingFinishBtn) aiMeetingFinishBtn.disabled = aiSubmitting;

  if (aiRecordBtn) aiRecordBtn.disabled = !canSpeak;
  if (aiStopBtn) aiStopBtn.disabled = !isRecording || aiStopping;
  const submitDisabled = !canSubmit;
  if (aiNextBtn) aiNextBtn.disabled = submitDisabled;
  if (aiFinishBtn) aiFinishBtn.disabled = submitDisabled;
}

function mountAiMeetingUI() {
  if (aiMeetingMounted) return;
  aiMeetingMounted = true;
  document.body.classList.add("inMeeting");
  document.body.classList.add("aiInterview");
  setLobbyVisible(false);
  if (aiHudEl) aiHudEl.classList.remove("hidden");
  if (aiMeetingBarEl) aiMeetingBarEl.classList.remove("hidden");
  if (localCard.parentElement !== meetingStageEl) meetingStageEl.prepend(localCard);
  if (aiInterviewCard && aiInterviewCard.parentElement !== meetingStageEl) meetingStageEl.appendChild(aiInterviewCard);
  setAiMeetingStatus("Listening…");
  syncAiMeetingButtons();
}

function unmountAiMeetingUI() {
  if (!aiMeetingMounted) return;
  aiMeetingMounted = false;
  document.body.classList.remove("aiInterview");
  document.body.classList.remove("inMeeting");
  if (aiHudEl) aiHudEl.classList.add("hidden");
  if (aiMeetingBarEl) aiMeetingBarEl.classList.add("hidden");
  if (aiInterviewCard && aiInterviewCardHome.parent) aiInterviewCardHome.parent.insertBefore(aiInterviewCard, aiInterviewCardHome.nextSibling);
  setLobbyVisible(true);
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
  syncAiMeetingButtons();
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

  socket.on("ai-stt", (payload) => {
    const token = aiLiveSttActiveToken;
    if (!token) return;
    const text = String(payload?.text || "").trim();
    const final = String(payload?.final || "").trim();
    if (final) aiLiveSttFinalText = final;
    if (text) aiLiveSttLatestText = text;
  });
  socket.on("ai-stt-error", () => {
    aiLiveSttActiveToken = 0;
    aiLiveSttStopPromise = null;
  });

  socket.on("dashboard-update", (payload) => {
    lastDashboard = payload || null;
    renderDashboard();
  });

  socket.on("student-status", (payload) => {
    lastStudentStatus = payload || null;
    renderStudentWaiting();
  });

  socket.on("ai-report", (payload) => {
    const scheduleId = payload?.scheduleId != null ? String(payload.scheduleId) : null;
    if (scheduleId) aiReports.set(scheduleId, payload);
    if (currentUser?.role === "interviewer") {
      renderDashboard();
      return;
    }
    if (currentUser?.role === "student" && payload?.studentEmail) {
      if (aiFeedbackEl) {
        aiFeedbackEl.classList.remove("hidden");
        aiFeedbackEl.textContent = payload?.summary || "AI interview completed.";
      }
    }
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
  aiActiveScheduleId = null;
  aiSessionId = null;
  aiQuestions = [];
  aiQuestionIndex = 0;
  aiLatestAudioBuffer = null;
  stopAiTimer();
  stopAiPoseMonitor();
  stopAiSpeech();

  if (!socket) return;
  try {
    socket.disconnect();
  } catch {
  }
  socket = undefined;
}

function statusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "in_room" || s === "completed") return "good";
  if (s === "waiting" || s === "admitted") return "warn";
  if (s === "scheduled") return "";
  if (s === "missed") return "bad";
  return "bad";
}

const alertedMeetings = new Set();

function showAlertForUpcomingMeetings(upcomingMeetings) {
  const now = Date.now();
  const alertThresholdMs = 5 * 60 * 1000; // 5 minutes

  for (const entry of upcomingMeetings) {
    const scheduledTime = new Date(entry.scheduledAt).getTime();
    if (scheduledTime - now <= alertThresholdMs && scheduledTime > now && !alertedMeetings.has(entry.id)) {
      alert(`Upcoming interview with ${entry.studentName || entry.studentEmail} at ${formatLocalTime(entry.scheduledAt)}!`);
      alertedMeetings.add(entry.id);
    }
  }
}

function renderDashboard() {
  if (currentUser?.role !== "interviewer") return;
  const dash = lastDashboard;
  clearChildren(scheduleList);
  alertedMeetings.clear();
  if (!dash) return;

  const items = Array.isArray(dash.schedule) ? dash.schedule : [];
  const upcoming = items
    .filter((entry) => {
      const s = String(entry.status || "").toLowerCase();
      return s !== "completed" && s !== "missed";
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  showAlertForUpcomingMeetings(upcoming);
  const missed = items.filter((entry) => String(entry.status || "").toLowerCase() === "missed");
  const completed = items
    .filter((entry) => String(entry.status || "").toLowerCase() === "completed")
    .sort((a, b) => new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime());

  if (upcoming.length === 0 && missed.length === 0 && completed.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dashItem";
    empty.textContent = "No scheduled interviews yet.";
    scheduleList.appendChild(empty);
    return;
  }

  const renderSection = (sectionItems, title) => {
    if (!sectionItems.length) return;
    if (title) {
      const header = document.createElement("div");
      header.className = "divider";
      header.textContent = title;
      scheduleList.appendChild(header);
    }
    for (const entry of sectionItems) {
      const status = String(entry.status || "").toLowerCase();
      const isCompleted = status === "completed";
      const isInRoom = status === "in_room";
      const isAdmitted = status === "admitted";
      const mode = String(entry.interviewMode || "manual").toLowerCase() === "ai" ? "ai" : "manual";
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
      secondary.textContent =
        mode === "ai"
          ? `AI interview · ${entry.online ? "online" : "offline"}`
          : entry.roomCode
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

      const modePill = document.createElement("div");
      modePill.className = `pill ${mode === "ai" ? "good" : ""}`.trim();
      modePill.textContent = mode === "ai" ? "AI" : "Manual";
      actions.appendChild(modePill);

      const aiReport = aiReports.get(String(entry.id));
      if (aiReport?.totalScore != null) {
        const scorePill = document.createElement("div");
        scorePill.className = "pill good";
        scorePill.textContent = `AI ${aiReport.totalScore}/100`;
        actions.appendChild(scorePill);

        const reportBtn = document.createElement("button");
        reportBtn.type = "button";
        reportBtn.className = "btn";
        reportBtn.textContent = "AI report";
        reportBtn.addEventListener("click", async () => {
          const res = await new Promise((resolve) => {
            ensureSocket().emit("ai-get-report", { scheduleId: entry.id }, (ack) => resolve(ack || { ok: false }));
          });
          if (!res.ok) {
            meetingInfo.classList.remove("hidden");
            meetingInfo.textContent = res.error || "AI report not available";
            return;
          }
          const report = res.report || null;
          meetingInfo.classList.remove("hidden");
          meetingInfo.textContent = report?.summary || "AI report loaded.";
        });
        actions.appendChild(reportBtn);
      }

      if (mode === "ai") {
        row.appendChild(left);
        row.appendChild(actions);
        scheduleList.appendChild(row);
        continue;
      }

      const admitBtn = document.createElement("button");
      admitBtn.type = "button";
      admitBtn.className = "btn";
      admitBtn.textContent = "Admit";
      admitBtn.disabled = !entry.roomCode || !entry.online || isCompleted || isInRoom || isAdmitted;
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
      joinBtn.className = isCompleted ? "btn" : "btn primary";
      joinBtn.textContent = isCompleted ? "Completed" : entry.roomCode ? "Join" : "Create & Join";
      joinBtn.disabled = isCompleted;
      joinBtn.addEventListener("click", async () => {
        if (isCompleted) return;
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
      doneBtn.textContent = "Mark completed";
      doneBtn.disabled = String(entry.status || "").toLowerCase() === "completed";
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
  };

  renderSection(upcoming, null);
  renderSection(missed, "Missed meetings");
  renderSection(completed, "Completed meetings");
}

function formatAiTimer(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function setAiPoseBadge(kind, text) {
  if (!aiPoseBadge) return;
  aiPoseBadge.classList.toggle("good", kind === "good");
  aiPoseBadge.classList.toggle("warn", kind === "warn");
  aiPoseBadge.classList.toggle("bad", kind === "bad");
  aiPoseBadge.textContent = text || "Steady";
  if (aiPoseMeta) aiPoseMeta.textContent = `Posture: ${String(text || "steady").toLowerCase()}`;
}

function resetAiPoseStats() {
  aiPoseStableTotal = 0;
  aiPoseSamples = 0;
  aiPoseUnsteadyStreak = 0;
  aiPoseWarnings = 0;
  setAiPoseBadge("good", "Steady");
}

function getAiPoseMetrics() {
  const stablePercent = aiPoseSamples ? aiPoseStableTotal / aiPoseSamples : 1;
  return {
    stablePercent: Math.max(0, Math.min(1, stablePercent)),
    warnings: aiPoseWarnings
  };
}

function stopAiPoseMonitor() {
  if (aiPoseIntervalId) clearInterval(aiPoseIntervalId);
  aiPoseIntervalId = null;
}

function stopAiSpeech() {
  if (aiSpeakAudio) {
    try {
      aiSpeakAudio.pause();
    } catch {
    }
  }
  aiSpeakAudio = null;
  if (aiSpeakUrl) {
    try {
      URL.revokeObjectURL(aiSpeakUrl);
    } catch {
    }
  }
  aiSpeakUrl = null;
}

async function fetchAiTtsUrl(text) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch("/api/ai/tts", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: String(text || "") })
  });
  if (!res.ok) return null;
  const blob = await res.blob().catch(() => null);
  if (!blob || !blob.size) return null;
  return URL.createObjectURL(blob);
}

async function transcribeAiAudioBlob(blob, mimeType) {
  if (!blob || !blob.size) return { ok: false, error: "No audio captured" };
  const headers = new Headers();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  if (mimeType) headers.set("Content-Type", mimeType);
  const res = await fetch("/api/ai/stt", {
    method: "POST",
    headers,
    body: blob
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body?.ok) {
    const err = String(body?.error || `Transcription failed (HTTP ${res.status})`).trim();
    return { ok: false, status: res.status, error: err || "Transcription failed" };
  }
  const t = String(body.transcript || "").trim();
  if (!t) return { ok: false, status: res.status, error: "Empty transcript" };
  return { ok: true, transcript: t };
}

async function playAiVoice(text) {
  stopAiSpeech();
  const url = await fetchAiTtsUrl(text).catch(() => null);
  if (!url) return false;
  aiSpeakUrl = url;
  const audio = new Audio(url);
  audio.preload = "auto";
  aiSpeakAudio = audio;
  const done = new Promise((resolve) => {
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
  });
  try {
    await audio.play();
  } catch {
    stopAiSpeech();
    return false;
  }
  const ok = await done;
  stopAiSpeech();
  return ok;
}

function startAiPoseMonitor() {
  stopAiPoseMonitor();
  resetAiPoseStats();
  const canvas = document.createElement("canvas");
  const w = 64;
  const h = 36;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  let last = null;

  aiPoseIntervalId = setInterval(() => {
    const video = localVideo;
    if (!video) return;
    if (video.readyState < 2) return;
    try {
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      if (last) {
        let diff = 0;
        for (let i = 0; i < data.length; i += 4) {
          diff += Math.abs(data[i] - last[i]);
          diff += Math.abs(data[i + 1] - last[i + 1]);
          diff += Math.abs(data[i + 2] - last[i + 2]);
        }
        const norm = diff / (w * h * 3 * 255);
        const stable = norm < 0.06 ? 1 : norm < 0.1 ? 0.6 : 0;
        aiPoseStableTotal += stable;
        aiPoseSamples += 1;
        if (stable === 0) aiPoseUnsteadyStreak += 1;
        else aiPoseUnsteadyStreak = 0;
        if (aiPoseUnsteadyStreak >= 4) {
          aiPoseWarnings += 1;
          aiPoseUnsteadyStreak = 0;
        }

        const stablePercent = aiPoseSamples ? aiPoseStableTotal / aiPoseSamples : 1;
        if (stablePercent > 0.78) setAiPoseBadge("good", "Steady");
        else if (stablePercent > 0.52) setAiPoseBadge("warn", "Move less");
        else setAiPoseBadge("bad", "Too shaky");
      }
      last = new Uint8ClampedArray(data);
    } catch {
      return;
    }
  }, 400);
}

function stopAiTimer() {
  stopAiThinkCountdown();
  if (aiAnswerIntervalId) clearInterval(aiAnswerIntervalId);
  aiAnswerIntervalId = null;
  aiAnswerRemainingSec = 0;
  hideAiCenterOverlay();
  aiAllowSpeak = false;
  if (aiTimerEl) aiTimerEl.textContent = "";
}

function setAiMode(active) {
  if (!aiInterviewCard) return;
  aiIntro?.classList.toggle("hidden", active);
  aiSessionEl?.classList.toggle("hidden", !active);
  if (active) {
    mountAiMeetingUI();
  }
  if (!active) {
    unmountAiMeetingUI();
    stopAiPoseMonitor();
    stopAiTimer();
    stopAiReviewWindow();
    aiLiveSttActiveToken = 0;
    aiLiveSttStopPromise = null;
    stopAiSpeech();
    if (aiFeedbackEl) aiFeedbackEl.classList.add("hidden");
    if (aiTranscriptEl) aiTranscriptEl.classList.add("hidden");
  }
}

function syncAiInterviewCard(nextSchedule) {
  if (!aiInterviewCard) return;
  const sched = nextSchedule && nextSchedule.id != null && !nextSchedule.doneAt ? nextSchedule : null;
  aiInterviewCard.classList.toggle("hidden", !sched);
  if (!sched) {
    setAiMode(false);
    return;
  }
  if (!aiSessionId) aiActiveScheduleId = String(sched.id);
}

async function renderAiQuestion() {
  const q = aiQuestions[aiQuestionIndex] || null;
  if (!q) return;
  aiThinkToken += 1;
  stopAiTimer();
  stopAiReviewWindow();
  stopAiSpeech();
  stopAiPoseMonitor();
  hideAiCenterOverlay();

  if (aiProgressEl) aiProgressEl.textContent = `Question ${aiQuestionIndex + 1} of ${aiQuestions.length}`;
  if (aiQuestionEl) aiQuestionEl.textContent = q.prompt || "Question";
  if (aiAnswerInput) aiAnswerInput.value = "";
  if (aiTranscriptEl) {
    aiTranscriptEl.classList.add("hidden");
    aiTranscriptEl.textContent = "";
  }
  aiLatestAudioBuffer = null;
  aiAudioChunks = [];
  aiLatestTranscript = "";
  aiAnswerReady = false;
  aiHasRecordedThisQuestion = false;
  aiAllowSpeak = false;
  aiStopping = false;
  aiFinalizedThisRecording = false;
  aiLiveSttActiveToken = 0;
  aiLiveSttLatestText = "";
  aiLiveSttFinalText = "";
  aiLiveSttStopPromise = null;
  aiQuestionStartedAt = 0;
  if (aiRecorderMeta) aiRecorderMeta.textContent = "Audio: not recording";
  if (aiFeedbackEl) aiFeedbackEl.classList.add("hidden");
  if (aiRecordBtn) aiRecordBtn.disabled = true;
  if (aiStopBtn) aiStopBtn.disabled = true;
  if (aiNextBtn) aiNextBtn.disabled = true;
  if (aiFinishBtn) aiFinishBtn.disabled = true;
  syncAiMeetingButtons();

  setAiMeetingStatus("Speaking…");
  if (aiRecorderMeta) aiRecorderMeta.textContent = "Voice: asking question...";
  await playAiVoice(q.prompt || "");

  const token = aiThinkToken;
  setAiMeetingStatus("Get ready…");
  if (aiRecorderMeta) aiRecorderMeta.textContent = "You have 10 seconds to think.";
  const ok = await runAiThinkCountdown(10, token);
  if (!ok || token !== aiThinkToken) return;

  setAiMeetingStatus("Recording…");
  showAiCenterOverlay("Recording…");
  aiAllowSpeak = true;
  aiQuestionStartedAt = Date.now();
  startAiPoseMonitor();
  if (aiRecorderMeta) aiRecorderMeta.textContent = "Recording started. Speak clearly, then press Stop.";
  syncAiMeetingButtons();
  startAiRecording().catch(() => {});
}

async function startAiLiveStt(mimeType) {
  const sock = ensureSocket();
  const token = (aiLiveSttSessionToken += 1);
  aiLiveSttActiveToken = token;
  aiLiveSttLatestText = "";
  aiLiveSttFinalText = "";
  aiLiveSttStopPromise = null;
  const res = await new Promise((resolve) => {
    sock.emit("ai-stt-start", { mimeType: String(mimeType || "") }, (ack) => resolve(ack || { ok: false }));
  });
  if (!res.ok) {
    if (aiLiveSttActiveToken === token) aiLiveSttActiveToken = 0;
    return { ok: false };
  }
  return { ok: true, token };
}

async function stopAiLiveStt() {
  const token = aiLiveSttActiveToken;
  if (!token) return "";
  if (aiLiveSttStopPromise) {
    try {
      const t = await aiLiveSttStopPromise;
      return t || "";
    } catch {
      return "";
    }
  }
  const sock = ensureSocket();
  aiLiveSttStopPromise = new Promise((resolve) => {
    sock.emit("ai-stt-stop", {}, (ack) => {
      if (aiLiveSttActiveToken === token) aiLiveSttActiveToken = 0;
      resolve(String(ack?.transcript || "").trim());
    });
  });
  try {
    const t = await aiLiveSttStopPromise;
    return t || "";
  } catch {
    return "";
  }
}

async function finalizeAiRecording({ blob, mimeType, liveTranscript }) {
  if (aiFinalizedThisRecording) return;
  aiFinalizedThisRecording = true;
  setAiMeetingStatus("Transcribing…");
  syncAiMeetingButtons();
  const mt = String(mimeType || "audio/webm");
  const liveText = String(liveTranscript || "").trim();
  const stt = await transcribeAiAudioBlob(blob, mt).catch(() => ({ ok: false, error: "Transcription failed" }));
  const transcript = String(stt?.ok ? stt.transcript : "" || (aiUseLiveStt ? liveText : "") || "").trim();
  aiLatestTranscript = transcript || "";

  if (transcript) {
    if (aiTranscriptEl) {
      aiTranscriptEl.textContent = `Transcript: ${transcript}`;
      aiTranscriptEl.classList.remove("hidden");
    }
    if (aiAnswerInput && !String(aiAnswerInput.value || "").trim()) aiAnswerInput.value = transcript;
    if (aiRecorderMeta) aiRecorderMeta.textContent = "Transcript ready";
  } else if (aiTranscriptEl) {
    aiTranscriptEl.textContent = `Transcript: (${String(stt?.error || "unavailable")})`;
    aiTranscriptEl.classList.remove("hidden");
    if (aiRecorderMeta) aiRecorderMeta.textContent = String(stt?.error || "Transcript unavailable");
  }

  aiAllowSpeak = false;
  aiHasRecordedThisQuestion = true;
  aiAnswerReady = true;
  aiStopping = false;
  hideAiCenterOverlay();
  beginAiReviewWindow(10);
  syncAiMeetingButtons();
}

async function startAiRecording() {
  if (aiMediaRecorder && aiMediaRecorder.state === "recording") return;
  if (!aiAllowSpeak || aiHasRecordedThisQuestion) return;
  setMicEnabled(true);
  await ensureCamera();
  const audioTracks = cameraStream?.getAudioTracks?.() || [];
  if (!audioTracks.length) {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Microphone not available.";
    return;
  }
  for (const t of audioTracks) t.enabled = true;
  const stream = new MediaStream([audioTracks[0]]);
  let mimeType = "";
  if (window.MediaRecorder?.isTypeSupported?.("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
  else if (window.MediaRecorder?.isTypeSupported?.("audio/webm")) mimeType = "audio/webm";
  aiAudioChunks = [];
  aiLatestAudioBuffer = null;
  aiLatestTranscript = "";
  aiAnswerReady = false;
  aiStopping = false;
  aiFinalizedThisRecording = false;
  stopAiReviewWindow();
  if (aiTranscriptEl) {
    aiTranscriptEl.textContent = "";
    aiTranscriptEl.classList.add("hidden");
  }
  aiRecordingStartAt = Date.now();
  aiMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  if (aiUseLiveStt) startAiLiveStt(aiMediaRecorder?.mimeType || mimeType).catch(() => {});
  setAiMeetingStatus("Recording…");
  showAiCenterOverlay("Recording…");
  syncAiMeetingButtons();

  const stopPromise = new Promise((resolve) => {
    aiStopPromiseResolve = resolve;
  });
  aiStopPromise = stopPromise;

  aiMediaRecorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    aiAudioChunks.push(e.data);
    if (!aiUseLiveStt) return;
    const token = aiLiveSttActiveToken;
    if (!token) return;
    e.data
      .arrayBuffer()
      .then((buf) => {
        if (!buf || !buf.byteLength) return;
        if (token !== aiLiveSttActiveToken) return;
        ensureSocket().emit("ai-stt-chunk", { audio: buf }, () => {});
      })
      .catch(() => {});
  };
  aiMediaRecorder.onstop = async () => {
    if (aiQuitting) {
      if (aiStopPromiseResolve) aiStopPromiseResolve();
      aiStopPromise = null;
      aiStopPromiseResolve = null;
      aiStopping = false;
      syncAiMeetingButtons();
      return;
    }
    const mt = aiMediaRecorder?.mimeType || "audio/webm";
    aiLatestAudioMimeType = mt;
    const blob = new Blob(aiAudioChunks, { type: mt });
    try {
      aiLatestAudioBuffer = await blob.arrayBuffer();
      if (aiRecorderMeta) aiRecorderMeta.textContent = `Audio: recorded ${formatAiTimer(Date.now() - aiRecordingStartAt)}`;
    } catch {
      aiLatestAudioBuffer = null;
      if (aiRecorderMeta) aiRecorderMeta.textContent = "Audio: recorded";
    }
    const liveTranscript = aiUseLiveStt
      ? await Promise.race([stopAiLiveStt(), new Promise((resolve) => setTimeout(() => resolve(""), 2500))])
      : "";
    await finalizeAiRecording({ blob, mimeType: mt, liveTranscript });
    if (aiStopPromiseResolve) aiStopPromiseResolve();
    aiStopPromise = null;
    aiStopPromiseResolve = null;
    aiStopping = false;
    syncAiMeetingButtons();
  };
  aiMediaRecorder.start(250);
  if (aiRecorderMeta) aiRecorderMeta.textContent = "Audio: recording...";
  startAiAnswerTimer(120);
  syncAiMeetingButtons();
}

async function stopAiRecording({ waitMs } = {}) {
  if (!aiMediaRecorder) return;
  if (aiMediaRecorder.state !== "recording") return;
  aiStopping = true;
  setAiMeetingStatus("Stopping…");
  syncAiMeetingButtons();
  if (aiAnswerIntervalId) clearInterval(aiAnswerIntervalId);
  aiAnswerIntervalId = null;
  const waitForStop = aiStopPromise;
  try {
    if (typeof aiMediaRecorder.requestData === "function") aiMediaRecorder.requestData();
    aiMediaRecorder.stop();
  } catch {
  }
  if (waitForStop) {
    try {
      const ms = typeof waitMs === "number" ? waitMs : 2500;
      const done = await Promise.race([waitForStop.then(() => true), new Promise((r) => setTimeout(() => r(false), Math.max(0, ms)))]);
      if (!done && !aiFinalizedThisRecording && aiAudioChunks.length) {
        const mt = aiMediaRecorder?.mimeType || aiLatestAudioMimeType || "audio/webm";
        const blob = new Blob(aiAudioChunks, { type: mt });
        const liveTranscript = await Promise.race([
          stopAiLiveStt(),
          new Promise((resolve) => setTimeout(() => resolve(""), 2500))
        ]);
        try {
          aiLatestAudioMimeType = mt;
          aiLatestAudioBuffer = await blob.arrayBuffer();
        } catch {
          aiLatestAudioBuffer = null;
        }
        await finalizeAiRecording({ blob, mimeType: mt, liveTranscript });
        if (aiStopPromiseResolve) aiStopPromiseResolve();
        aiStopPromise = null;
        aiStopPromiseResolve = null;
      }
    } catch {
    }
  }
  aiStopping = false;
  syncAiMeetingButtons();
}

async function startAiInterview() {
  if (currentUser?.role !== "student") return;
  const status = lastStudentStatus;
  const schedule = Array.isArray(status?.schedule) ? status.schedule : [];
  const sorted = [...schedule].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const next =
    sorted.find((e) => e && e.id != null && !e.doneAt && String(e.interviewMode || "manual").toLowerCase() === "ai") ||
    null;
  if (!next) return;

  setMicEnabled(true);
  setCameraEnabled(true);
  try {
    await ensureCamera();
  } catch {
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Camera/microphone permission is required for AI interview.";
    return;
  }

  meetingInfo.classList.add("hidden");
  setAiMode(true);
  if (aiFeedbackEl) aiFeedbackEl.classList.add("hidden");
  try {
    const res = await new Promise((resolve) => {
      ensureSocket().emit("ai-start", { scheduleId: next.id }, (ack) => resolve(ack || { ok: false }));
    });
    if (!res.ok) {
      setAiMode(false);
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = res.error || "Failed to start AI interview";
      return;
    }
    aiActiveScheduleId = String(next.id);
    aiSessionId = String(res.sessionId || "");
    aiQuestions = Array.isArray(res.questions) ? res.questions : [];
    aiQuestionIndex = 0;
    await renderAiQuestion();
  } catch {
    setAiMode(false);
    meetingInfo.classList.remove("hidden");
    meetingInfo.textContent = "Failed to start AI interview";
  }
}

async function submitAiAnswer({ finish, auto }) {
  if (!aiSessionId) return;
  if (aiSubmitting) return;
  const q = aiQuestions[aiQuestionIndex] || null;
  if (!q) return;
  aiSubmitting = true;
  setAiMeetingStatus("Submitting…");
  syncAiMeetingButtons();
  stopAiTimer();
  if (aiMediaRecorder?.state === "recording") await stopAiRecording({ waitMs: 2500 });
  const { stablePercent, warnings } = getAiPoseMetrics();
  const startedAt = aiQuestionStartedAt || Date.now();
  const payload = {
    sessionId: aiSessionId,
    questionId: q.id,
    text: String(aiAnswerInput?.value || "").trim(),
    audio: aiLatestAudioBuffer || null,
    transcript: aiLatestTranscript || "",
    mimeType: aiLatestAudioMimeType || "audio/webm",
    meta: {
      durationMs: Math.max(0, Date.now() - startedAt),
      stablePercent,
      poseWarnings: warnings
    }
  };
  setAiMeetingStatus("Submitting… (this may take up to 2 minutes)");
  const res = await Promise.race([
    new Promise((resolve) => {
      ensureSocket().emit("ai-answer", payload, (ack) => resolve(ack || { ok: false }));
    }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Submit timed out" }), 120000))
  ]);
  if (!res.ok) {
    if (aiFeedbackEl) {
      aiFeedbackEl.classList.remove("hidden");
      aiFeedbackEl.textContent = res.error || "Failed to submit answer";
    }
    setAiMeetingStatus("Ready");
    syncAiMeetingButtons();
    aiSubmitting = false;
    return;
  }
  if (aiTranscriptEl) {
    const t = String(res.transcript || "").trim();
    aiTranscriptEl.textContent = t ? `Transcript: ${t}` : "Transcript: (unavailable)";
    aiTranscriptEl.classList.remove("hidden");
  }
  if (res.transcript && aiAnswerInput && !String(aiAnswerInput.value || "").trim()) {
    aiAnswerInput.value = String(res.transcript || "").trim();
  }
  if (aiFeedbackEl) {
    aiFeedbackEl.classList.remove("hidden");
    const parts = [];
    if (typeof res.score === "number") parts.push(`Score: ${res.score}/20`);
    if (res.usedGpt) parts.push("Rated by GPT-4o-mini");
    if (res.feedback) parts.push(String(res.feedback));
    const strengths = Array.isArray(res.strengths) ? res.strengths.map((s) => String(s || "").trim()).filter(Boolean) : [];
    const improvements = Array.isArray(res.improvements) ? res.improvements.map((s) => String(s || "").trim()).filter(Boolean) : [];
    if (strengths.length) parts.push(`Strengths: ${strengths.join(" · ")}`);
    if (improvements.length) parts.push(`Improve: ${improvements.join(" · ")}`);
    aiFeedbackEl.textContent = parts.filter(Boolean).join(" · ") || `Saved. Score: ${res.score ?? 0}/20`;
  }

  const nextIndex = aiQuestionIndex + 1;
  if (finish || nextIndex >= aiQuestions.length) {
    const fin = await Promise.race([
      new Promise((resolve) => {
        ensureSocket().emit("ai-finish", { sessionId: aiSessionId }, (ack) => resolve(ack || { ok: false }));
      }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Finish timed out" }), 120000))
    ]);
    if (!fin.ok) {
      if (aiFeedbackEl) {
        aiFeedbackEl.classList.remove("hidden");
        aiFeedbackEl.textContent = fin.error || "Failed to finish AI interview";
      }
      setAiMeetingStatus("Ready");
      syncAiMeetingButtons();
      aiSubmitting = false;
      return;
    }
    const report = fin.report || null;
    if (aiFeedbackEl) {
      aiFeedbackEl.classList.remove("hidden");
      aiFeedbackEl.textContent = report?.summary || "AI interview completed.";
    }
    stopAiPoseMonitor();
    stopAiTimer();
    aiAnswerReady = false;
    aiHasRecordedThisQuestion = false;
    aiAllowSpeak = false;
    if (aiNextBtn) aiNextBtn.disabled = true;
    if (aiFinishBtn) aiFinishBtn.disabled = true;
    setAiMeetingStatus("Completed");
    syncAiMeetingButtons();
    aiSubmitting = false;
    return;
  }

  aiQuestionIndex = nextIndex;
  aiSubmitting = false;
  await renderAiQuestion();
}

function renderStudentWaiting() {
  if (currentUser?.role !== "student") return;
  const status = lastStudentStatus;
  if (!status) {
    studentWaitingBody.textContent = "Waiting for interviewer…";
    studentWaitingMeta.textContent = "";
    if (studentJoinForm) studentJoinForm.classList.add("hidden");
    if (aiInterviewCard) aiInterviewCard.classList.add("hidden");
    return;
  }

  const schedule = Array.isArray(status.schedule) ? status.schedule : [];
  const admittedRooms = Array.isArray(status.admittedRooms) ? status.admittedRooms : [];
  const sorted = [...schedule].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const next = sorted.find((e) => e && e.id != null && !e.doneAt) || null;
  const mode = next && String(next.interviewMode || "manual").toLowerCase() === "ai" ? "ai" : "manual";
  syncAiInterviewCard(mode === "ai" ? next : null);

  if (next) {
    studentWaitingBody.textContent = `Your interview time: ${formatLocalTime(next.scheduledAt)}`;
    const interviewerLabel = next.interviewerName
      ? `${next.interviewerName} (${next.interviewerEmail})`
      : next.interviewerEmail;
    studentWaitingMeta.textContent =
      mode === "ai"
        ? `Interviewer: ${interviewerLabel} · Mode: AI`
        : next.roomCode
          ? `Interviewer: ${interviewerLabel} · Code: ${next.roomCode}`
          : `Interviewer: ${interviewerLabel} · Code will appear when interviewer joins`;
  } else {
    studentWaitingBody.textContent = "Waiting for interviewer…";
    studentWaitingMeta.textContent = "No scheduled slot found for your email.";
  }

  if (mode === "ai") {
    if (studentJoinForm) studentJoinForm.classList.add("hidden");
    const schedId = next?.id != null ? String(next.id) : null;
    const scheduledTs = next?.scheduledAt ? new Date(next.scheduledAt).getTime() : NaN;
    const now = Date.now();
    const withinStartWindow = !Number.isNaN(scheduledTs) ? now >= scheduledTs && now <= scheduledTs + 10 * 60 * 1000 : true;
    if (schedId && withinStartWindow && !aiSessionId && aiAutoStartAttemptedForScheduleId !== schedId) {
      aiAutoStartAttemptedForScheduleId = schedId;
      startAiInterview().catch(() => {});
    }
    return;
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
    authBtn.textContent = "Log in securely";
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
  authBtn.textContent = "Log in securely";
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

  authBtn.disabled = true;
  authBtn.textContent = "Signing in...";

  const res = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    authBtn.disabled = false;
    authBtn.textContent = "Log in securely";
    authError.classList.remove("hidden");
    authError.textContent = res.body?.error || "Account check failed";
    return;
  }

  authToken = res.body.token;
  localStorage.setItem("authToken", authToken);
  currentUser = res.body.user;
  setAuthed(true);
  authBtn.disabled = false;
  authBtn.textContent = "Log in securely";
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
    const interviewMode = String(scheduleModeInput?.value || "manual").trim().toLowerCase();
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
      ensureSocket().emit("schedule-add", { studentEmail, scheduledAt, interviewMode }, (ack) => resolve(ack || { ok: false }));
    });
    if (!res.ok) {
      meetingInfo.classList.remove("hidden");
      meetingInfo.textContent = res.error || "Failed to add slot";
      return;
    }
    studentEmailInput.value = "";
    if (scheduleModeInput) scheduleModeInput.value = "manual";
    meetingInfo.classList.remove("hidden");
    const modeLabel = String(res.entry?.interviewMode || interviewMode || "manual").toLowerCase() === "ai" ? "AI" : "Manual";
    meetingInfo.textContent = `Added ${modeLabel} slot for ${res.entry?.studentEmail || studentEmail}.`;
  });
}

if (scheduleTimeBtn && scheduleTimeInput) {
  scheduleTimeBtn.addEventListener("click", () => {
    try {
      if (typeof scheduleTimeInput.showPicker === "function") {
        scheduleTimeInput.showPicker();
        return;
      }
    } catch {
    }
    scheduleTimeInput.focus();
    try {
      scheduleTimeInput.click();
    } catch {
    }
  });
}

if (aiConsentBtn) {
  aiConsentBtn.addEventListener("click", () => {
    const text =
      "Consent notice: This AI interview records your audio response (and may evaluate steadiness via camera motion). Use this only with informed consent and in compliance with applicable laws and company policy.";
    try {
      window.alert(text);
    } catch {
    }
  });
}

if (aiStartBtn) {
  aiStartBtn.addEventListener("click", async () => {
    aiStartBtn.disabled = true;
    if (aiNextBtn) aiNextBtn.disabled = false;
    if (aiFinishBtn) aiFinishBtn.disabled = false;
    requestFullscreen(document.documentElement);
    await startAiInterview();
    aiStartBtn.disabled = false;
  });
}

if (aiRecordBtn) {
  aiRecordBtn.addEventListener("click", () => {
    startAiRecording().catch(() => {});
  });
}

if (aiStopBtn) {
  aiStopBtn.addEventListener("click", () => {
    stopAndContinueAi().catch(() => {});
  });
}

if (aiNextBtn) {
  aiNextBtn.addEventListener("click", () => {
    stopAiReviewWindow();
    submitAiAnswer({ finish: false }).catch(() => {});
  });
}

if (aiFinishBtn) {
  aiFinishBtn.addEventListener("click", () => {
    stopAiReviewWindow();
    confirmQuitAiInterview().catch(() => {});
  });
}

if (aiMeetingSpeakBtn) {
  aiMeetingSpeakBtn.addEventListener("click", () => {
    startAiRecording().catch(() => {});
  });
}

if (aiMeetingStopBtn) {
  aiMeetingStopBtn.addEventListener("click", () => {
    stopAndContinueAi().catch(() => {});
  });
}

if (aiMeetingNextBtn) {
  aiMeetingNextBtn.addEventListener("click", () => {
    stopAiReviewWindow();
    submitAiAnswer({ finish: false }).catch(() => {});
  });
}

if (aiMeetingFinishBtn) {
  aiMeetingFinishBtn.addEventListener("click", () => {
    stopAiReviewWindow();
    confirmQuitAiInterview().catch(() => {});
  });
}

bootstrapAuth().catch(() => {});
