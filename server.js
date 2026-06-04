import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

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
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

const hasSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = hasSupabase ? createClient(supabaseUrl, supabaseServiceKey) : null;
const sebSessions = new Map();
const dashboardRoomPrefix = "dashboard:";
const scheduleTable = "interview_schedule";
let scheduleDbChecked = false;
let scheduleDbAvailable = false;
const scheduleByInterviewer = new Map();
const studentSocketIdsByEmail = new Map();
const interviewerSocketIdsByEmail = new Map();
const studentActiveRoomByEmail = new Map();
const admissionByKey = new Map();
const aiSessionsById = new Map();
const aiReportsByScheduleId = new Map();
const aiAudioByScheduleQuestion = new Map();

const aiQuestionBank = [
  {
    id: "js-async",
    topic: "JavaScript",
    seconds: 120,
    prompt: "Explain the difference between a Promise and async/await. When would you use each?",
    keywords: ["promise", "async", "await", "then", "catch", "try", "error", "readability"]
  },
  {
    id: "http-api",
    topic: "Backend",
    seconds: 120,
    prompt: "Design a simple REST API for creating and listing interview slots. What endpoints and fields would you include?",
    keywords: ["rest", "post", "get", "endpoint", "status", "json", "validation", "id"]
  },
  {
    id: "db-index",
    topic: "Databases",
    seconds: 120,
    prompt: "What is an index in a database? When does it help, and what trade-offs does it introduce?",
    keywords: ["index", "query", "search", "lookup", "write", "storage", "b-tree", "trade"]
  },
  {
    id: "system-debug",
    topic: "Engineering",
    seconds: 120,
    prompt: "A production service is slow. Walk through how you would debug and identify the bottleneck.",
    keywords: ["metrics", "logs", "trace", "profil", "latency", "database", "cache", "baseline"]
  },
  {
    id: "security-basic",
    topic: "Security",
    seconds: 120,
    prompt: "What are common web security risks (e.g., XSS/CSRF), and how would you mitigate them?",
    keywords: ["xss", "csrf", "csp", "sanitize", "cookie", "same-site", "token", "headers"]
  }
];

function computeKeywordScore(text, keywords) {
  const t = String(text || "").toLowerCase();
  if (!t) return { hits: 0, total: keywords.length };
  let hits = 0;
  for (const kw of keywords || []) {
    if (!kw) continue;
    const k = String(kw).toLowerCase();
    if (k && t.includes(k)) hits += 1;
  }
  return { hits, total: (keywords || []).length };
}

function clampScore(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreAiAnswer({ text, keywords, stablePercent, poseWarnings }) {
  const cleaned = String(text || "").trim();
  const lengthPoints = cleaned.length >= 360 ? 6 : cleaned.length >= 200 ? 5 : cleaned.length >= 120 ? 4 : cleaned.length >= 60 ? 3 : cleaned.length >= 20 ? 2 : cleaned.length > 0 ? 1 : 0;
  const { hits, total } = computeKeywordScore(cleaned, keywords || []);
  const keywordPoints = total ? Math.round((hits / total) * 12) : 0;
  const stability = typeof stablePercent === "number" ? stablePercent : 1;
  const posturePenalty = Math.round((1 - clampScore(stability, 0, 1)) * 4) + clampScore(Number(poseWarnings || 0), 0, 10);
  const raw = lengthPoints + keywordPoints;
  const score = clampScore(raw - posturePenalty, 0, 20);
  const feedback = total
    ? `Keywords: ${hits}/${total} · Posture warnings: ${clampScore(Number(poseWarnings || 0), 0, 10)}`
    : `Posture warnings: ${clampScore(Number(poseWarnings || 0), 0, 10)}`;
  return { score, feedback, hits, total, posturePenalty };
}

function readResponseText(payload) {
  const out = payload?.output;
  if (Array.isArray(out) && out.length) {
    for (const item of out) {
      const parts = item?.content;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const t = part?.text;
        if (typeof t === "string" && t.trim()) return t;
      }
    }
  }
  const alt = payload?.output_text;
  if (typeof alt === "string" && alt.trim()) return alt;
  return "";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function deepgramSpeak(text) {
  if (!deepgramApiKey) return { ok: false, error: "Deepgram not configured" };
  const input = String(text || "").trim();
  if (!input) return { ok: false, error: "Text required" };
  if (input.length > 1200) return { ok: false, error: "Text too long" };
  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", "aura-asteria-en");
  url.searchParams.set("encoding", "mp3");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text: input })
  });
  if (!res.ok) return { ok: false, error: "Deepgram TTS failed" };
  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  if (!buf.byteLength) return { ok: false, error: "Empty audio" };
  return { ok: true, audio: buf };
}

async function deepgramTranscribe({ audioBuf, mimeType }) {
  if (!deepgramApiKey) return { ok: false, error: "Deepgram not configured" };
  if (!audioBuf || !audioBuf.byteLength) return { ok: false, error: "Audio required" };
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", "nova-2");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("numerals", "true");
  url.searchParams.set("paragraphs", "true");
  url.searchParams.set("detect_language", "true");
  url.searchParams.set("utterances", "false");
  const mt = String(mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": mt
    },
    body: audioBuf
  });
  if (!res.ok) return { ok: false, error: "Deepgram transcription failed" };
  const data = await res.json().catch(() => null);
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { ok: false, error: "Empty transcript" };
  return { ok: true, transcript: text, raw: data };
}

function normalizeDeepgramMimeType(mimeType) {
  const mt = String(mimeType || "").trim().toLowerCase();
  if (!mt) return "audio/webm";
  if (mt.includes("audio/webm")) return "audio/webm";
  if (mt.includes("audio/wav")) return "audio/wav";
  if (mt.includes("audio/mpeg")) return "audio/mpeg";
  if (mt.includes("audio/mp3")) return "audio/mpeg";
  if (mt.includes("audio/ogg")) return "audio/ogg";
  return mt;
}

function getDeepgramLiveState(socket) {
  const st = socket?.data?.deepgramLive;
  if (!st || typeof st !== "object") return null;
  if (!st.ws) return null;
  return st;
}

function closeDeepgramLive(socket, { sendCloseStream } = { sendCloseStream: false }) {
  const st = getDeepgramLiveState(socket);
  if (!st) return "";
  const ws = st.ws;
  const transcript = String(`${st.finalTranscript || ""}${st.finalTranscript && st.interimTranscript ? " " : ""}${st.interimTranscript || ""}`).trim();
  try {
    if (sendCloseStream && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
  } catch {
  }
  try {
    ws?.removeAllListeners?.();
  } catch {
  }
  try {
    ws?.close?.();
  } catch {
    try {
      ws?.terminate?.();
    } catch {
    }
  }
  socket.data.deepgramLive = null;
  return transcript;
}

function emitDeepgramLive(socket, st, payload) {
  const now = Date.now();
  if (now - (st.lastEmitAt || 0) < 75) return;
  st.lastEmitAt = now;
  socket.emit("ai-stt", payload);
}

function openDeepgramLive(socket, { mimeType }) {
  if (!deepgramApiKey) return { ok: false, error: "Deepgram not configured" };
  closeDeepgramLive(socket);
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", "nova-2");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("vad_events", "true");
  url.searchParams.set("endpointing", "90");
  url.searchParams.set("utterance_end_ms", "900");

  const contentType = normalizeDeepgramMimeType(mimeType);
  const ws = new WebSocket(url.toString(), {
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": contentType
    }
  });

  const st = {
    ws,
    mimeType: contentType,
    finalTranscript: "",
    interimTranscript: "",
    lastEmitAt: 0
  };
  socket.data.deepgramLive = st;

  ws.on("open", () => {
    emitDeepgramLive(socket, st, { ok: true, final: st.finalTranscript, interim: st.interimTranscript, text: "" });
  });

  ws.on("message", (raw) => {
    const text = raw instanceof Buffer ? raw.toString("utf8") : String(raw || "");
    const data = safeJsonParse(text);
    if (!data) return;
    const transcript = data?.channel?.alternatives?.[0]?.transcript;
    const next = typeof transcript === "string" ? transcript.trim() : "";
    if (!next) return;

    const isFinal = Boolean(data?.is_final);
    const speechFinal = Boolean(data?.speech_final);
    if (isFinal) {
      st.finalTranscript = String(`${st.finalTranscript || ""}${st.finalTranscript ? " " : ""}${next}`).trim();
      st.interimTranscript = "";
    } else {
      st.interimTranscript = next;
    }
    const combined = String(`${st.finalTranscript || ""}${st.finalTranscript && st.interimTranscript ? " " : ""}${st.interimTranscript || ""}`).trim();
    emitDeepgramLive(socket, st, {
      ok: true,
      final: st.finalTranscript,
      interim: st.interimTranscript,
      text: combined,
      isFinal,
      speechFinal
    });
  });

  ws.on("close", () => {
    const combined = String(`${st.finalTranscript || ""}${st.finalTranscript && st.interimTranscript ? " " : ""}${st.interimTranscript || ""}`).trim();
    socket.emit("ai-stt", { ok: true, final: st.finalTranscript, interim: st.interimTranscript, text: combined, closed: true });
  });

  ws.on("error", () => {
    socket.emit("ai-stt-error", { ok: false, error: "Live transcription error" });
  });

  return { ok: true };
}

async function rateAiAnswerWithOpenAI({ question, transcript, typedText, topic }) {
  if (!openaiApiKey) return { ok: false, error: "OpenAI not configured" };
  const q = String(question || "").trim();
  const said = String(transcript || "").trim();
  const typed = String(typedText || "").trim();
  if (!q) return { ok: false, error: "Question required" };
  if (!said && !typed) return { ok: false, error: "Answer required" };

  const schema = {
    name: "ai_interview_rating",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        score_0_20: { type: "integer", minimum: 0, maximum: 20 },
        feedback: { type: "string" },
        strengths: { type: "array", items: { type: "string" }, maxItems: 4 },
        improvements: { type: "array", items: { type: "string" }, maxItems: 4 }
      },
      required: ["score_0_20", "feedback", "strengths", "improvements"]
    }
  };

  const input = [
    {
      role: "system",
      content:
        "You are a strict technical interview evaluator. Score answers based on correctness, completeness, clarity, and practical trade-offs. Do not mention policies. Keep feedback concise and actionable."
    },
    {
      role: "user",
      content: [
        `Topic: ${String(topic || "General")}`,
        `Question: ${q}`,
        `Spoken transcript: ${said || "(none)"}`,
        `Typed notes (optional): ${typed || "(none)"}`
      ].join("\n")
    }
  ];

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input,
      response_format: { type: "json_schema", json_schema: schema }
    })
  });
  if (!res.ok) return { ok: false, error: "OpenAI rating failed" };
  const payload = await res.json().catch(() => null);
  const text = readResponseText(payload);
  const parsed = safeJsonParse(text);
  if (!parsed || typeof parsed.score_0_20 !== "number") return { ok: false, error: "OpenAI rating malformed" };
  return {
    ok: true,
    score: clampScore(Math.round(parsed.score_0_20), 0, 20),
    feedback: String(parsed.feedback || "").trim(),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map((s) => String(s || "").trim()).filter(Boolean) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map((s) => String(s || "").trim()).filter(Boolean) : []
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureScheduleDbAvailable() {
  if (!supabase) return false;
  if (scheduleDbChecked) return scheduleDbAvailable;
  scheduleDbChecked = true;
  const { error } = await supabase.from(scheduleTable).select("id").limit(1);
  if (error) {
    scheduleDbAvailable = false;
    return false;
  }
  scheduleDbAvailable = true;
  return true;
}

async function getUserByEmail(email) {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "Invalid email" };

  const primary = await supabase
    .from("users")
    .select("email, role, name, password_hash")
    .eq("email", normalized)
    .maybeSingle();

  if (!primary.error) return { ok: true, user: primary.data };

  const msg = String(primary.error?.message || "").toLowerCase();
  if (!msg.includes("column") || (!msg.includes("name") && !msg.includes("password_hash"))) {
    return { ok: false, error: "Database error" };
  }

  const fallback = await supabase
    .from("users")
    .select("email, role")
    .eq("email", normalized)
    .maybeSingle();
  if (fallback.error) return { ok: false, error: "Database error" };
  return { ok: true, user: fallback.data };
}

async function getUsersByEmails(emails) {
  if (!supabase) return new Map();
  const unique = Array.from(new Set((emails || []).map((e) => normalizeEmail(e)).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const primary = await supabase.from("users").select("email, name, role").in("email", unique);
  if (!primary.error) {
    const map = new Map();
    for (const row of primary.data || []) map.set(String(row.email).toLowerCase(), row);
    return map;
  }

  const msg = String(primary.error?.message || "");
  if (!msg.toLowerCase().includes("column") || !msg.toLowerCase().includes("name")) return new Map();

  const fallback = await supabase.from("users").select("email, role").in("email", unique);
  const map = new Map();
  for (const row of fallback.data || []) map.set(String(row.email).toLowerCase(), row);
  return map;
}

function normalizeIsoDateTime(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function admissionKey(roomCode, studentEmail) {
  const code = String(roomCode || "").trim().toUpperCase();
  const email = String(studentEmail || "").trim().toLowerCase();
  if (!code || !email) return null;
  return `${code}|${email}`;
}

function isStudentAdmitted(roomCode, studentEmail) {
  const key = admissionKey(roomCode, studentEmail);
  if (!key) return false;
  const entry = admissionByKey.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    admissionByKey.delete(key);
    return false;
  }
  return true;
}

function upsertScheduleEntry(interviewerEmail, entry) {
  const email = String(interviewerEmail || "").trim().toLowerCase();
  if (!email) return null;
  if (!scheduleByInterviewer.has(email)) scheduleByInterviewer.set(email, []);
  const list = scheduleByInterviewer.get(email);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return entry;
}

function getInterviewerSchedule(interviewerEmail) {
  const email = String(interviewerEmail || "").trim().toLowerCase();
  const list = scheduleByInterviewer.get(email) || [];
  return [...list].sort((a, b) => {
    const at = new Date(a.scheduledAt).getTime();
    const bt = new Date(b.scheduledAt).getTime();
    if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function computeScheduleEntryStatus({ entry, online, activeRoom, admitted }) {
  if (entry.doneAt) return "completed";
  if (entry.roomCode && activeRoom && activeRoom === entry.roomCode) return "in_room";

  const now = Date.now();
  const scheduledTs = entry.scheduledAt ? new Date(entry.scheduledAt).getTime() : NaN;
  const isScheduledValid = !Number.isNaN(scheduledTs);
  const missedGraceMs = 10 * 60 * 1000;
  const isPastWindow = isScheduledValid && now > scheduledTs + missedGraceMs;

  if (!entry.doneAt && isPastWindow && !activeRoom && !admitted) return "missed";
  if (admitted) return "admitted";
  if (online) return "waiting";
  return "scheduled";
}

async function listScheduleEntriesForInterviewer(interviewerEmail) {
  const email = String(interviewerEmail || "").trim().toLowerCase();
  if (!email) return [];

  const useDb = await ensureScheduleDbAvailable();
  if (!useDb) return getInterviewerSchedule(email);

  const primary = await supabase
    .from(scheduleTable)
    .select("id, student_email, interviewer_email, scheduled_at, room_code, admitted_at, done_at, created_at, interview_mode")
    .eq("interviewer_email", email)
    .order("scheduled_at", { ascending: true });
  if (primary.error) {
    const msg = String(primary.error?.message || "").toLowerCase();
    if (!msg.includes("column") || !msg.includes("interview_mode")) return getInterviewerSchedule(email);
    const fallback = await supabase
      .from(scheduleTable)
      .select("id, student_email, interviewer_email, scheduled_at, room_code, admitted_at, done_at, created_at")
      .eq("interviewer_email", email)
      .order("scheduled_at", { ascending: true });
    if (fallback.error) return getInterviewerSchedule(email);
    return (fallback.data || []).map((row) => ({
      id: row.id,
      studentEmail: String(row.student_email || "").toLowerCase(),
      scheduledAt: row.scheduled_at,
      roomCode: row.room_code ? String(row.room_code || "").toUpperCase() : null,
      createdAt: row.created_at,
      doneAt: row.done_at,
      admittedAt: row.admitted_at,
      interviewMode: "manual"
    }));
  }

  return (primary.data || []).map((row) => ({
    id: row.id,
    studentEmail: String(row.student_email || "").toLowerCase(),
    scheduledAt: row.scheduled_at,
    roomCode: row.room_code ? String(row.room_code || "").toUpperCase() : null,
    createdAt: row.created_at,
    doneAt: row.done_at,
    admittedAt: row.admitted_at,
    interviewMode: normalizeInterviewMode(row.interview_mode)
  }));
}

async function computeDashboard(interviewerEmail) {
  const scheduleEntries = await listScheduleEntriesForInterviewer(interviewerEmail);
  const usersMap = await getUsersByEmails([
    interviewerEmail,
    ...scheduleEntries.map((e) => e.studentEmail)
  ]);

  const schedule = scheduleEntries.map((entry) => {
    const online = studentSocketIdsByEmail.get(entry.studentEmail)?.size ? true : false;
    const activeRoom = studentActiveRoomByEmail.get(entry.studentEmail) || null;
    const admitted =
      entry.interviewMode === "manual"
        ? Boolean(entry.admittedAt) || isStudentAdmitted(entry.roomCode, entry.studentEmail)
        : false;
    const status = computeScheduleEntryStatus({ entry, online, activeRoom, admitted });
    const studentProfile = usersMap.get(String(entry.studentEmail || "").toLowerCase());
    const interviewerProfile = usersMap.get(String(interviewerEmail || "").toLowerCase());
    return {
      ...entry,
      studentName: studentProfile?.name || null,
      interviewerName: interviewerProfile?.name || null,
      online,
      admitted,
      activeRoom,
      status
    };
  });

  const byStudent = new Map(schedule.map((s) => [s.studentEmail, s]));
  const unassigned = Array.from(studentSocketIdsByEmail.keys())
    .filter((email) => !byStudent.has(email))
    .map((email) => ({ email, online: true, activeRoom: studentActiveRoomByEmail.get(email) || null }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return { schedule, unassigned };
}

async function emitDashboard(interviewerEmail) {
  const email = String(interviewerEmail || "").trim().toLowerCase();
  if (!email) return;
  const payload = await computeDashboard(email);
  io.to(`${dashboardRoomPrefix}${email}`).emit("dashboard-update", payload);
}

function emitDashboardsForConnectedInterviewers() {
  for (const interviewerEmail of interviewerSocketIdsByEmail.keys()) {
    emitDashboard(interviewerEmail).catch(() => {});
  }
  if (interviewerSocketIdsByEmail.size === 0) {
    for (const interviewerEmail of scheduleByInterviewer.keys()) {
      emitDashboard(interviewerEmail).catch(() => {});
    }
  }
}

async function emitStudentStatus(studentEmail) {
  const email = String(studentEmail || "").trim().toLowerCase();
  if (!email) return;
  const useDb = await ensureScheduleDbAvailable();
  let scheduleEntries = [];
  if (useDb) {
    const primary = await supabase
      .from(scheduleTable)
      .select("id, student_email, interviewer_email, scheduled_at, room_code, admitted_at, done_at, created_at, interview_mode")
      .eq("student_email", email)
      .order("scheduled_at", { ascending: true });
    let rows = null;
    if (!primary.error) rows = primary.data || [];
    else {
      const msg = String(primary.error?.message || "").toLowerCase();
      if (!msg.includes("column") || !msg.includes("interview_mode")) rows = null;
      else {
        const fallback = await supabase
          .from(scheduleTable)
          .select("id, student_email, interviewer_email, scheduled_at, room_code, admitted_at, done_at, created_at")
          .eq("student_email", email)
          .order("scheduled_at", { ascending: true });
        if (!fallback.error) rows = (fallback.data || []).map((r) => ({ ...r, interview_mode: "manual" }));
      }
    }

    if (rows) {
      const interviewerEmails = rows.map((r) => String(r.interviewer_email || "").toLowerCase());
      const usersMap = await getUsersByEmails(interviewerEmails);
      scheduleEntries = rows.map((row) => {
        const interviewerEmail = String(row.interviewer_email || "").toLowerCase();
        const interviewerProfile = usersMap.get(interviewerEmail);
        return {
          id: row.id,
          interviewerEmail,
          interviewerName: interviewerProfile?.name || null,
          studentEmail: String(row.student_email || "").toLowerCase(),
          scheduledAt: row.scheduled_at,
          roomCode: row.room_code ? String(row.room_code || "").toUpperCase() : null,
          createdAt: row.created_at,
          doneAt: row.done_at,
          admittedAt: row.admitted_at,
          interviewMode: normalizeInterviewMode(row.interview_mode)
        };
      });
    }
  }

  if (!useDb || scheduleEntries.length === 0) {
    for (const [interviewerEmail, list] of scheduleByInterviewer.entries()) {
      for (const entry of list) {
        if (entry.studentEmail === email) scheduleEntries.push({ interviewerEmail, ...entry });
      }
    }
  }

  const now = Date.now();
  const missedGraceMs = 10 * 60 * 1000;
  scheduleEntries = (scheduleEntries || [])
    .filter((entry) => {
      if (entry?.doneAt) return false;
      const ts = entry?.scheduledAt ? new Date(entry.scheduledAt).getTime() : NaN;
      if (Number.isNaN(ts)) return true;
      if (now > ts + missedGraceMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const admittedRooms = [];
  for (const entry of scheduleEntries) {
    if (!entry.roomCode) continue;
    if (normalizeInterviewMode(entry.interviewMode) === "ai") continue;
    if (entry.admittedAt || isStudentAdmitted(entry.roomCode, email)) admittedRooms.push(entry.roomCode);
  }
  const socketIds = studentSocketIdsByEmail.get(email);
  if (!socketIds?.size) return;
  for (const socketId of socketIds) {
    io.to(socketId).emit("student-status", { schedule: scheduleEntries, admittedRooms });
  }
}

async function findScheduleEntryForStudent({ scheduleId, studentEmail }) {
  const email = String(studentEmail || "").trim().toLowerCase();
  const id = scheduleId != null ? scheduleId : null;
  if (!email || !id) return { ok: false, error: "Invalid schedule" };

  const useDb = supabase ? await ensureScheduleDbAvailable() : false;
  if (useDb) {
    const primary = await supabase
      .from(scheduleTable)
      .select("id, student_email, interviewer_email, scheduled_at, room_code, done_at, created_at, interview_mode")
      .eq("id", id)
      .eq("student_email", email)
      .maybeSingle();
    if (!primary.error && primary.data) {
      return {
        ok: true,
        entry: {
          id: primary.data.id,
          studentEmail: String(primary.data.student_email || "").toLowerCase(),
          interviewerEmail: String(primary.data.interviewer_email || "").toLowerCase(),
          scheduledAt: primary.data.scheduled_at,
          roomCode: primary.data.room_code ? String(primary.data.room_code || "").toUpperCase() : null,
          doneAt: primary.data.done_at,
          createdAt: primary.data.created_at,
          interviewMode: normalizeInterviewMode(primary.data.interview_mode)
        }
      };
    }
    if (primary.error) {
      const msg = String(primary.error?.message || "").toLowerCase();
      if (msg.includes("column") && msg.includes("interview_mode")) {
        const fallback = await supabase
          .from(scheduleTable)
          .select("id, student_email, interviewer_email, scheduled_at, room_code, done_at, created_at")
          .eq("id", id)
          .eq("student_email", email)
          .maybeSingle();
        if (!fallback.error && fallback.data) {
          return {
            ok: true,
            entry: {
              id: fallback.data.id,
              studentEmail: String(fallback.data.student_email || "").toLowerCase(),
              interviewerEmail: String(fallback.data.interviewer_email || "").toLowerCase(),
              scheduledAt: fallback.data.scheduled_at,
              roomCode: fallback.data.room_code ? String(fallback.data.room_code || "").toUpperCase() : null,
              doneAt: fallback.data.done_at,
              createdAt: fallback.data.created_at,
              interviewMode: "manual"
            }
          };
        }
      }
    }
  }

  for (const [interviewerEmail, list] of scheduleByInterviewer.entries()) {
    for (const entry of list || []) {
      if (String(entry.id) !== String(id)) continue;
      if (String(entry.studentEmail || "").toLowerCase() !== email) continue;
      return { ok: true, entry: { ...entry, interviewerEmail } };
    }
  }
  return { ok: false, error: "Schedule not found" };
}

async function notifyJoinRequest({ roomCode, studentEmail }) {
  const code = String(roomCode || "").trim().toUpperCase();
  const email = String(studentEmail || "").trim().toLowerCase();
  if (!code || !email) return;
  const useDb = supabase ? await ensureScheduleDbAvailable() : false;
  let interviewerEmail = null;
  let scheduleId = null;
  if (useDb) {
    const { data, error } = await supabase
      .from(scheduleTable)
      .select("id, interviewer_email")
      .eq("student_email", email)
      .eq("room_code", code)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      interviewerEmail = String(data.interviewer_email || "").toLowerCase();
      scheduleId = data.id;
    }
  }
  if (!interviewerEmail) {
    for (const [iEmail, list] of scheduleByInterviewer.entries()) {
      for (const entry of list) {
        if (entry.studentEmail === email && String(entry.roomCode || "").toUpperCase() === code) {
          interviewerEmail = iEmail;
          scheduleId = entry.id;
          break;
        }
      }
      if (interviewerEmail) break;
    }
  }
  if (!interviewerEmail) return;
  const socketIds = interviewerSocketIdsByEmail.get(interviewerEmail);
  if (!socketIds?.size) return;
  const payload = { studentEmail: email, roomCode: code, scheduleId };
  for (const sid of socketIds) {
    io.to(sid).emit("join-request", payload);
  }
}

async function isRoomExpired(roomCode) {
  const code = String(roomCode || "").trim().toUpperCase();
  if (!code) return false;
  const now = Date.now();
  const maxDurationMs = 60 * 60 * 1000;

  let startAt = null;
  let doneAt = null;

  const useDb = supabase ? await ensureScheduleDbAvailable() : false;
  if (useDb) {
    const { data, error } = await supabase
      .from(scheduleTable)
      .select("scheduled_at, admitted_at, done_at")
      .eq("room_code", code)
      .order("scheduled_at", { ascending: true })
      .limit(1);
    if (!error && data && data.length) {
      const row = data[0];
      doneAt = row.done_at ? new Date(row.done_at).getTime() : null;
      const admittedTs = row.admitted_at ? new Date(row.admitted_at).getTime() : null;
      const scheduledTs = row.scheduled_at ? new Date(row.scheduled_at).getTime() : null;
      startAt = admittedTs ?? scheduledTs ?? null;
    }
  }

  if (!useDb || (!startAt && !doneAt)) {
    for (const list of scheduleByInterviewer.values()) {
      for (const entry of list) {
        if (!entry.roomCode || String(entry.roomCode || "").toUpperCase() !== code) continue;
        const entryDone = entry.doneAt ? new Date(entry.doneAt).getTime() : null;
        const entryAdmitted = entry.admittedAt ? new Date(entry.admittedAt).getTime() : null;
        const entryScheduled = entry.scheduledAt ? new Date(entry.scheduledAt).getTime() : null;
        if (entryDone && (!doneAt || entryDone < doneAt)) doneAt = entryDone;
        const candidateStart = entryAdmitted ?? entryScheduled ?? null;
        if (candidateStart && (!startAt || candidateStart < startAt)) startAt = candidateStart;
      }
    }
  }

  if (doneAt) return true;
  if (!startAt) return false;
  return now - startAt > maxDurationMs;
}

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

function normalizeInterviewMode(mode) {
  const v = String(mode || "").trim().toLowerCase();
  if (v === "ai") return "ai";
  return "manual";
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

function verifyPasswordHash(password, hash) {
  const stored = String(hash || "");
  if (!stored) return false;
  const computed = sha256Hex(password);
  if (computed.length !== stored.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(stored));
  } catch {
    return false;
  }
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
  if (!ok) return res.status(403).json({ ok: false, error: "Open in the specified app to continue." });
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
  const password = String(req.body?.password || "");
  if (!password) return res.status(400).json({ ok: false, error: "Password required" });
  if (!sessionSecret) return res.status(500).json({ ok: false, error: "Server not configured" });

  const existingResult = await getUserByEmail(email);
  if (!existingResult.ok) {
    const status = existingResult.error === "Account not found" ? 404 : 500;
    return res.status(status).json({ ok: false, error: existingResult.error });
  }

  const existing = existingResult.user;
  if (!existing) return res.status(404).json({ ok: false, error: "Account not found" });

  const role = normalizeRole(existing.role);
  if (!role) return res.status(500).json({ ok: false, error: "Role missing in database" });

  const storedHash = existing.password_hash ? String(existing.password_hash || "") : "";
  if (!storedHash || !verifyPasswordHash(password, storedHash)) {
    return res.status(401).json({ ok: false, error: "Invalid email or password" });
  }

  if (role === "student" && shouldRequireSebKeyCheck()) {
    const requestUrl = getFullRequestUrl(req);
    const ok = verifySebHeaders({ headers: req.headers, requestUrl });
    if (!ok) return res.status(403).json({ ok: false, error: "Open in the specified app to continue." });
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("users")
    .update({ last_seen_at: now })
    .eq("email", email);
  if (updateError) return res.status(500).json({ ok: false, error: "Database error" });

  const token = signToken({ email, role, iat: Date.now() });
  if (!token) return res.status(500).json({ ok: false, error: "Server not configured" });
  return res.status(200).json({ ok: true, token, user: { email, role, name: existing.name || null } });
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

app.post("/api/ai/tts", requireAuth, requireSebForStudents, async (req, res) => {
  const text = String(req.body?.text || "");
  const result = await deepgramSpeak(text);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error || "TTS failed" });
  res.status(200);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  return res.send(result.audio);
});

app.post(
  "/api/ai/stt",
  requireAuth,
  requireSebForStudents,
  express.raw({ type: () => true, limit: "3mb" }),
  async (req, res) => {
    const mimeType = String(req.headers["content-type"] || "audio/webm");
    const audioBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    const result = await deepgramTranscribe({ audioBuf, mimeType });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error || "Transcription failed" });
    return res.status(200).json({ ok: true, transcript: result.transcript });
  }
);

function generateMeetingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function createMeetingCodeForSchedule({ interviewerEmail }) {
  const useDb = await ensureScheduleDbAvailable();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateMeetingCode();
    if (!useDb) return { ok: true, code };
    const { data: existing, error } = await supabase
      .from(scheduleTable)
      .select("id")
      .eq("room_code", code)
      .limit(1);
    if (error) return { ok: false, error: "Database error" };
    if (!existing?.length) return { ok: true, code };
  }
  return { ok: false, error: "Failed to create meeting" };
}

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
  const userEmail = String(socket.data.user?.email || "").trim().toLowerCase();
  const userRole = String(socket.data.user?.role || "").trim().toLowerCase();

  if (userRole === "student" && userEmail) {
    if (!studentSocketIdsByEmail.has(userEmail)) studentSocketIdsByEmail.set(userEmail, new Set());
    studentSocketIdsByEmail.get(userEmail).add(socket.id);
    emitStudentStatus(userEmail).catch(() => {});
    emitDashboardsForConnectedInterviewers();
  }

  if (userRole === "interviewer" && userEmail) {
    if (!interviewerSocketIdsByEmail.has(userEmail)) interviewerSocketIdsByEmail.set(userEmail, new Set());
    interviewerSocketIdsByEmail.get(userEmail).add(socket.id);
  }

  socket.on("join-room", async ({ roomCode }, ack) => {
    if (typeof roomCode !== "string" || roomCode.trim().length === 0) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid code" });
      return;
    }

    if (socket.data.user?.role === "student") {
      const userAgent = socket.handshake.headers?.["user-agent"];
      if (!isSafeExamBrowserUserAgent(userAgent)) {
        if (typeof ack === "function") ack({ ok: false, error: "Open in the specified app to continue." });
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
            ack({ ok: false, error: "Open in the specified app to continue." });
          }
          return;
        }
      }
    }

    const normalized = roomCode.trim().toUpperCase();
    if (await isRoomExpired(normalized)) {
      if (typeof ack === "function") ack({ ok: false, error: "Meeting has ended" });
      return;
    }
    const room = `room:${normalized}`;

    if (socket.data.user?.role === "student") {
      const email = String(socket.data.user?.email || "").trim().toLowerCase();
      let admitted = false;
      if (email) {
        const useDb = await ensureScheduleDbAvailable();
        if (useDb) {
          const { data, error } = await supabase
            .from(scheduleTable)
            .select("id")
            .eq("student_email", email)
            .eq("room_code", normalized)
            .not("admitted_at", "is", null)
            .limit(1);
          admitted = !error && Boolean(data?.length);
        }
        if (!admitted) admitted = isStudentAdmitted(normalized, email);
      }
      if (!email || !admitted) {
        if (email) {
          notifyJoinRequest({ roomCode: normalized, studentEmail: email }).catch(() => {});
        }
        if (typeof ack === "function") ack({ ok: false, error: "Waiting for interviewer approval" });
        return;
      }
    }

    const currentSize = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    if (currentSize >= 3) {
      if (typeof ack === "function") ack({ ok: false, error: "Room is full (max 3 participants)" });
      return;
    }

    socket.join(room);

    const peerIds = Array.from(io.sockets.adapter.rooms.get(room) ?? []).filter(
      (id) => id !== socket.id
    );

    socket.emit("existing-peers", { peerIds, roomCode: normalized });
    socket.to(room).emit("peer-joined", { peerId: socket.id });

    socket.data.room = room;
    socket.data.roomCode = normalized;
    if (socket.data.user?.role === "student") {
      const email = String(socket.data.user?.email || "").trim().toLowerCase();
      if (email) {
        studentActiveRoomByEmail.set(email, normalized);
        emitStudentStatus(email).catch(() => {});
        emitDashboardsForConnectedInterviewers();
      }
    }

    if (typeof ack === "function") ack({ ok: true, peerIds, roomCode: normalized });
  });

  socket.on("screen-share", ({ sharing }, ack) => {
    const room = socket.data.room;
    if (!room) {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
    const isSharing = Boolean(sharing);
    socket.to(room).emit("screen-share", { peerId: socket.id, sharing: isSharing });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("proctor-event", (payload, ack) => {
    if (socket.data.user?.role !== "student") {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
    const room = socket.data.room;
    if (!room) {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
    const type = typeof payload?.type === "string" ? payload.type : null;
    const reason = typeof payload?.reason === "string" ? payload.reason : "";
    const at =
      typeof payload?.at === "string" && payload.at
        ? payload.at
        : new Date().toISOString();
    socket.to(room).emit("proctor-event", {
      peerId: socket.id,
      type,
      reason,
      at
    });
    if (typeof ack === "function") ack({ ok: true });
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
    if (socket.data.user?.role === "student") {
      const email = String(socket.data.user?.email || "").trim().toLowerCase();
      if (email && studentActiveRoomByEmail.get(email) === socket.data.roomCode) {
        studentActiveRoomByEmail.delete(email);
        emitStudentStatus(email).catch(() => {});
        emitDashboardsForConnectedInterviewers();
      }
    }
    socket.data.room = undefined;
    socket.data.roomCode = undefined;
  };

  socket.on("leave-room", leave);

  socket.on("dashboard-subscribe", (payload, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    socket.join(`${dashboardRoomPrefix}${interviewerEmail}`);
    if (!scheduleByInterviewer.has(interviewerEmail)) scheduleByInterviewer.set(interviewerEmail, []);
    computeDashboard(interviewerEmail)
      .then((dash) => {
        socket.emit("dashboard-update", dash);
        if (typeof ack === "function") ack({ ok: true, dashboard: dash });
      })
      .catch(() => {
        if (typeof ack === "function") ack({ ok: false, error: "Failed to load dashboard" });
      });
  });

  socket.on("schedule-add", async ({ studentEmail, scheduledAt, interviewMode }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const sEmail = normalizeEmail(studentEmail);
    if (!sEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid student email" });
      return;
    }
    const iso = normalizeIsoDateTime(scheduledAt);
    if (!iso) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid scheduled time" });
      return;
    }
    const mode = normalizeInterviewMode(interviewMode);

    if (supabase) {
      const studentResult = await getUserByEmail(sEmail);
      if (!studentResult.ok || !studentResult.user) {
        if (typeof ack === "function") ack({ ok: false, error: "Student account not found" });
        return;
      }
      const role = normalizeRole(studentResult.user.role);
      if (role !== "student") {
        if (typeof ack === "function") ack({ ok: false, error: "Email is not a student account" });
        return;
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      studentEmail: sEmail,
      interviewerEmail,
      scheduledAt: iso,
      roomCode: null,
      createdAt: nowIso(),
      admittedAt: null,
      doneAt: null,
      interviewMode: mode
    };

    const useDb = await ensureScheduleDbAvailable();
    if (useDb) {
      const primary = await supabase
        .from(scheduleTable)
        .insert({
          student_email: sEmail,
          interviewer_email: interviewerEmail,
          scheduled_at: iso,
          created_at: entry.createdAt,
          interview_mode: mode
        })
        .select("id")
        .maybeSingle();
      if (!primary.error && primary.data?.id) entry.id = primary.data.id;
      if (primary.error) {
        const msg = String(primary.error?.message || "").toLowerCase();
        if (msg.includes("column") && msg.includes("interview_mode")) {
          const fallback = await supabase
            .from(scheduleTable)
            .insert({
              student_email: sEmail,
              interviewer_email: interviewerEmail,
              scheduled_at: iso,
              created_at: entry.createdAt
            })
            .select("id")
            .maybeSingle();
          if (!fallback.error && fallback.data?.id) entry.id = fallback.data.id;
          if (fallback.error) upsertScheduleEntry(interviewerEmail, entry);
        } else {
          upsertScheduleEntry(interviewerEmail, entry);
        }
      }
    } else {
      upsertScheduleEntry(interviewerEmail, entry);
    }

    emitDashboard(interviewerEmail).catch(() => {});
    emitStudentStatus(sEmail).catch(() => {});
    if (typeof ack === "function") ack({ ok: true, entry });
  });

  socket.on("join-request-decision", async ({ studentEmail, roomCode, accept }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const email = normalizeEmail(studentEmail);
    const code = String(roomCode || "").trim().toUpperCase();
    if (!email || !code) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }
    if (!accept) {
      if (typeof ack === "function") ack({ ok: true, accepted: false });
      return;
    }
    const key = admissionKey(code, email);
    if (!key) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }
    const useDb = supabase ? await ensureScheduleDbAvailable() : false;
    let scheduleId = null;
    if (useDb) {
      const { data, error } = await supabase
        .from(scheduleTable)
        .select("id")
        .eq("student_email", email)
        .eq("interviewer_email", interviewerEmail)
        .eq("room_code", code)
        .order("scheduled_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        scheduleId = data.id;
        await supabase
          .from(scheduleTable)
          .update({ admitted_at: nowIso() })
          .eq("id", scheduleId)
          .eq("interviewer_email", interviewerEmail);
      }
    }
    admissionByKey.set(key, {
      admittedBy: interviewerEmail,
      admittedAt: Date.now(),
      expiresAt: Date.now() + 45 * 60 * 1000
    });
    const socketIds = studentSocketIdsByEmail.get(email);
    if (socketIds?.size) {
      for (const sid of socketIds) io.to(sid).emit("admitted", { roomCode: code, scheduleId });
    }
    emitDashboard(interviewerEmail).catch(() => {});
    emitStudentStatus(email).catch(() => {});
    if (typeof ack === "function") ack({ ok: true, accepted: true, roomCode: code, scheduleId });
  });

  socket.on("schedule-join", async ({ scheduleId }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }

    const useDb = supabase ? await ensureScheduleDbAvailable() : false;
    if (useDb) {
      const primary = await supabase
        .from(scheduleTable)
        .select("id, student_email, room_code, interview_mode")
        .eq("id", scheduleId)
        .eq("interviewer_email", interviewerEmail)
        .maybeSingle();
      let data = primary.data || null;
      if (primary.error) {
        const msg = String(primary.error?.message || "").toLowerCase();
        if (msg.includes("column") && msg.includes("interview_mode")) {
          const fallback = await supabase
            .from(scheduleTable)
            .select("id, student_email, room_code")
            .eq("id", scheduleId)
            .eq("interviewer_email", interviewerEmail)
            .maybeSingle();
          if (!fallback.error) data = fallback.data ? { ...fallback.data, interview_mode: "manual" } : null;
        }
      }

      if (data) {
        const mode = normalizeInterviewMode(data.interview_mode);
        if (mode === "ai") {
          if (typeof ack === "function") ack({ ok: false, error: "AI interview does not use a meeting code" });
          return;
        }
        const existingCode = data.room_code ? String(data.room_code || "").toUpperCase() : null;
        let roomCode = existingCode;
        if (!roomCode) {
          const created = await createMeetingCodeForSchedule({ interviewerEmail });
          if (!created.ok) {
            if (typeof ack === "function") ack({ ok: false, error: created.error || "Failed to create meeting" });
            return;
          }
          roomCode = created.code;
          await supabase
            .from(scheduleTable)
            .update({ room_code: roomCode })
            .eq("id", scheduleId)
            .eq("interviewer_email", interviewerEmail);
        }
        emitDashboard(interviewerEmail).catch(() => {});
        if (typeof ack === "function") ack({ ok: true, roomCode });
        return;
      }
    }

    const list = scheduleByInterviewer.get(interviewerEmail) || [];
    const idx = list.findIndex((e) => e.id === scheduleId);
    if (idx < 0) {
      if (typeof ack === "function") ack({ ok: false, error: "Schedule not found" });
      return;
    }

    const current = list[idx];
    if (normalizeInterviewMode(current.interviewMode) === "ai") {
      if (typeof ack === "function") ack({ ok: false, error: "AI interview does not use a meeting code" });
      return;
    }
    let code = current.roomCode || null;
    if (!code) {
      const created = await createMeetingCodeForSchedule({ interviewerEmail });
      if (!created.ok) {
        if (typeof ack === "function") ack({ ok: false, error: created.error || "Failed to create meeting" });
        return;
      }
      code = created.code;
      list[idx] = { ...current, roomCode: code };
    }
    emitDashboard(interviewerEmail).catch(() => {});
    if (typeof ack === "function") ack({ ok: true, roomCode: code });
  });

  socket.on("schedule-admit", async ({ scheduleId }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }

    const admit = async (entry) => {
      if (normalizeInterviewMode(entry.interviewMode) === "ai") {
        if (typeof ack === "function") ack({ ok: false, error: "AI interview does not require admission" });
        return;
      }
      const key = admissionKey(entry.roomCode, entry.studentEmail);
      admissionByKey.set(key, {
        admittedBy: interviewerEmail,
        admittedAt: Date.now(),
        expiresAt: Date.now() + 45 * 60 * 1000
      });
      const socketIds = studentSocketIdsByEmail.get(entry.studentEmail);
      if (socketIds?.size) {
        for (const sid of socketIds) io.to(sid).emit("admitted", { roomCode: entry.roomCode, scheduleId: entry.id });
      }
      emitDashboard(interviewerEmail).catch(() => {});
      emitStudentStatus(entry.studentEmail).catch(() => {});
      if (typeof ack === "function") ack({ ok: true, roomCode: entry.roomCode });
    };

    const useDb = supabase ? await ensureScheduleDbAvailable() : false;
    if (useDb) {
      const primary = await supabase
        .from(scheduleTable)
        .select("id, student_email, room_code, interview_mode")
        .eq("id", scheduleId)
        .eq("interviewer_email", interviewerEmail)
        .maybeSingle();
      let data = primary.data || null;
      if (primary.error) {
        const msg = String(primary.error?.message || "").toLowerCase();
        if (msg.includes("column") && msg.includes("interview_mode")) {
          const fallback = await supabase
            .from(scheduleTable)
            .select("id, student_email, room_code")
            .eq("id", scheduleId)
            .eq("interviewer_email", interviewerEmail)
            .maybeSingle();
          if (!fallback.error) data = fallback.data ? { ...fallback.data, interview_mode: "manual" } : null;
        }
      }

      if (data) {
        const mode = normalizeInterviewMode(data.interview_mode);
        if (mode === "ai") {
          if (typeof ack === "function") ack({ ok: false, error: "AI interview does not require admission" });
          return;
        }
        const roomCode = data.room_code ? String(data.room_code || "").toUpperCase() : null;
        if (!roomCode) {
          if (typeof ack === "function") ack({ ok: false, error: "Join to create a code first" });
          return;
        }
        await supabase
          .from(scheduleTable)
          .update({ admitted_at: nowIso() })
          .eq("id", scheduleId)
          .eq("interviewer_email", interviewerEmail);
        await admit({
          id: data.id,
          studentEmail: String(data.student_email || "").toLowerCase(),
          roomCode
        });
        return;
      }
    }

    const list = scheduleByInterviewer.get(interviewerEmail) || [];
    const entry = list.find((e) => e.id === scheduleId);
    if (!entry) {
      if (typeof ack === "function") ack({ ok: false, error: "Schedule not found" });
      return;
    }
    if (normalizeInterviewMode(entry.interviewMode) === "ai") {
      if (typeof ack === "function") ack({ ok: false, error: "AI interview does not require admission" });
      return;
    }
    if (!entry.roomCode) {
      if (typeof ack === "function") ack({ ok: false, error: "Join to create a code first" });
      return;
    }
    admit(entry).catch(() => {});
  });

  socket.on("schedule-done", async ({ scheduleId }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }

    const useDb = supabase ? await ensureScheduleDbAvailable() : false;
    if (useDb) {
      const { data, error } = await supabase
        .from(scheduleTable)
        .select("student_email")
        .eq("id", scheduleId)
        .eq("interviewer_email", interviewerEmail)
        .maybeSingle();
      if (!error && data) {
        await supabase
          .from(scheduleTable)
          .update({ done_at: nowIso() })
          .eq("id", scheduleId)
          .eq("interviewer_email", interviewerEmail);
        emitDashboard(interviewerEmail).catch(() => {});
        emitStudentStatus(String(data.student_email || "").toLowerCase()).catch(() => {});
        if (typeof ack === "function") ack({ ok: true });
        return;
      }
    }

    const list = scheduleByInterviewer.get(interviewerEmail) || [];
    const idx = list.findIndex((e) => e.id === scheduleId);
    if (idx < 0) {
      if (typeof ack === "function") ack({ ok: false, error: "Schedule not found" });
      return;
    }
    const updated = { ...list[idx], doneAt: nowIso() };
    list[idx] = updated;
    emitDashboard(interviewerEmail).catch(() => {});
    emitStudentStatus(updated.studentEmail).catch(() => {});
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("ai-stt-start", ({ mimeType }, ack) => {
    if (socket.data.user?.role !== "student") {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const opened = openDeepgramLive(socket, { mimeType });
    if (typeof ack === "function") ack(opened);
  });

  socket.on("ai-stt-chunk", ({ audio }, ack) => {
    const st = getDeepgramLiveState(socket);
    if (!st?.ws || st.ws.readyState !== WebSocket.OPEN) {
      if (typeof ack === "function") ack({ ok: false, error: "Live transcription not started" });
      return;
    }
    let audioBuf = null;
    try {
      if (audio && (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio))) {
        const arr = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer);
        if (arr.byteLength > 0 && arr.byteLength <= 250_000) audioBuf = Buffer.from(arr);
      }
    } catch {
      audioBuf = null;
    }
    if (!audioBuf) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid audio" });
      return;
    }
    try {
      st.ws.send(audioBuf);
      if (typeof ack === "function") ack({ ok: true });
    } catch {
      if (typeof ack === "function") ack({ ok: false, error: "Failed to send audio" });
    }
  });

  socket.on("ai-stt-stop", async (_payload, ack) => {
    const st = getDeepgramLiveState(socket);
    if (st?.ws && st.ws.readyState === WebSocket.OPEN) {
      try {
        st.ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
      }
      await new Promise((r) => setTimeout(r, 650));
    }
    const transcript = closeDeepgramLive(socket);
    if (typeof ack === "function") ack({ ok: true, transcript });
  });

  socket.on("ai-start", async ({ scheduleId }, ack) => {
    if (socket.data.user?.role !== "student") {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const studentEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    const found = await findScheduleEntryForStudent({ scheduleId, studentEmail });
    if (!found.ok) {
      if (typeof ack === "function") ack({ ok: false, error: found.error || "Schedule not found" });
      return;
    }
    if (normalizeInterviewMode(found.entry?.interviewMode) !== "ai") {
      if (typeof ack === "function") ack({ ok: false, error: "This slot is manual and must be handled by an interviewer" });
      return;
    }
    if (found.entry?.doneAt) {
      if (typeof ack === "function") ack({ ok: false, error: "Interview is completed" });
      return;
    }

    const sessionId = crypto.randomUUID();
    const questions = aiQuestionBank.map((q) => ({
      id: q.id,
      topic: q.topic,
      seconds: q.seconds,
      prompt: q.prompt
    }));
    aiSessionsById.set(sessionId, {
      sessionId,
      scheduleId: found.entry.id,
      studentEmail,
      interviewerEmail: found.entry.interviewerEmail,
      startedAt: Date.now(),
      questions,
      answers: [],
      totals: null
    });
    if (typeof ack === "function") ack({ ok: true, sessionId, questions });
  });

  socket.on("ai-answer", async ({ sessionId, questionId, text, audio, transcript, mimeType, meta }, ack) => {
    if (socket.data.user?.role !== "student") {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const sid = typeof sessionId === "string" ? sessionId : "";
    const session = aiSessionsById.get(sid);
    if (!session) {
      if (typeof ack === "function") ack({ ok: false, error: "Session not found" });
      return;
    }
    const studentEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (!studentEmail || studentEmail !== session.studentEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }

    const qid = String(questionId || "");
    const bank = aiQuestionBank.find((q) => q.id === qid) || null;
    if (!bank) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid question" });
      return;
    }

    let audioBuf = null;
    try {
      if (audio && (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio))) {
        const arr = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer);
        if (arr.byteLength <= 2_000_000) audioBuf = Buffer.from(arr);
      }
    } catch {
      audioBuf = null;
    }

    const stablePercent = typeof meta?.stablePercent === "number" ? meta.stablePercent : 1;
    const poseWarnings = typeof meta?.poseWarnings === "number" ? meta.poseWarnings : 0;
    const typedText = String(text || "");
    let spokenTranscript = String(transcript || "").trim();
    const mt = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "audio/webm";
    if (audioBuf) aiAudioByScheduleQuestion.set(`${session.scheduleId}:${qid}`, { audio: audioBuf, mimeType: mt });
    if (!spokenTranscript && audioBuf) {
      const stt = await deepgramTranscribe({ audioBuf, mimeType: mt });
      if (stt.ok) spokenTranscript = stt.transcript;
    }

    const rated = await rateAiAnswerWithOpenAI({
      question: bank.prompt,
      transcript: spokenTranscript,
      typedText,
      topic: bank.topic
    });
    const scored = rated.ok
      ? { score: rated.score, feedback: rated.feedback }
      : scoreAiAnswer({ text: spokenTranscript || typedText, keywords: bank.keywords, stablePercent, poseWarnings });

    const answer = {
      questionId: qid,
      topic: bank.topic,
      prompt: bank.prompt,
      text: spokenTranscript || typedText,
      transcript: spokenTranscript,
      typedText,
      audioBytes: audioBuf ? audioBuf.byteLength : 0,
      meta: {
        durationMs: typeof meta?.durationMs === "number" ? meta.durationMs : null,
        stablePercent,
        poseWarnings
      },
      score: scored.score,
      feedback: scored.feedback,
      at: nowIso()
    };

    session.answers.push(answer);
    if (typeof ack === "function") {
      ack({
        ok: true,
        score: scored.score,
        feedback: scored.feedback,
        transcript: spokenTranscript,
        strengths: rated.ok ? rated.strengths : [],
        improvements: rated.ok ? rated.improvements : [],
        usedGpt: rated.ok
      });
    }
  });

  socket.on("ai-finish", async ({ sessionId }, ack) => {
    if (socket.data.user?.role !== "student") {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const sid = typeof sessionId === "string" ? sessionId : "";
    const session = aiSessionsById.get(sid);
    if (!session) {
      if (typeof ack === "function") ack({ ok: false, error: "Session not found" });
      return;
    }
    const studentEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (!studentEmail || studentEmail !== session.studentEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }

    const breakdown = session.answers.map((a) => ({
      questionId: a.questionId,
      topic: a.topic,
      score: a.score,
      feedback: a.feedback
    }));
    const totalScore = clampScore(breakdown.reduce((sum, a) => sum + (Number(a.score) || 0), 0) * 5, 0, 100);
    const summaryLines = [
      `AI interview score: ${totalScore}/100`,
      `Questions answered: ${breakdown.length}/${aiQuestionBank.length}`
    ];
    for (const item of breakdown) summaryLines.push(`${item.topic}: ${item.score}/20`);
    const summary = summaryLines.join(" · ");

    const report = {
      scheduleId: session.scheduleId,
      studentEmail: session.studentEmail,
      interviewerEmail: session.interviewerEmail,
      totalScore,
      breakdown,
      answers: session.answers.map((a) => ({
        questionId: a.questionId,
        topic: a.topic,
        prompt: a.prompt,
        transcript: a.transcript,
        typedText: a.typedText,
        score: a.score,
        feedback: a.feedback,
        audioBytes: a.audioBytes,
        at: a.at
      })),
      summary,
      finishedAt: nowIso()
    };
    aiReportsByScheduleId.set(String(session.scheduleId), report);

    const useDb = supabase ? await ensureScheduleDbAvailable() : false;
    if (useDb) {
      await supabase
        .from(scheduleTable)
        .update({ done_at: nowIso() })
        .eq("id", session.scheduleId);
    } else if (session.interviewerEmail) {
      const list = scheduleByInterviewer.get(String(session.interviewerEmail || "").toLowerCase()) || [];
      const idx = list.findIndex((e) => String(e.id) === String(session.scheduleId));
      if (idx >= 0) list[idx] = { ...list[idx], doneAt: nowIso() };
    }

    if (session.interviewerEmail) {
      io.to(`${dashboardRoomPrefix}${session.interviewerEmail}`).emit("ai-report", report);
      emitDashboard(session.interviewerEmail).catch(() => {});
    }
    socket.emit("ai-report", report);
    emitStudentStatus(session.studentEmail).catch(() => {});
    if (typeof ack === "function") ack({ ok: true, report });
  });

  socket.on("ai-get-report", async ({ scheduleId }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const id = scheduleId != null ? String(scheduleId) : null;
    if (!id) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid schedule" });
      return;
    }
    const report = aiReportsByScheduleId.get(id) || null;
    if (!report || report.interviewerEmail !== interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "AI report not available" });
      return;
    }
    if (typeof ack === "function") ack({ ok: true, report });
  });

  socket.on("ai-get-audio", async ({ scheduleId, questionId }, ack) => {
    const interviewerEmail = String(socket.data.user?.email || "").trim().toLowerCase();
    if (socket.data.user?.role !== "interviewer" || !interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      return;
    }
    const id = scheduleId != null ? String(scheduleId) : null;
    const qid = String(questionId || "").trim();
    if (!id || !qid) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }
    const report = aiReportsByScheduleId.get(id) || null;
    if (!report || report.interviewerEmail !== interviewerEmail) {
      if (typeof ack === "function") ack({ ok: false, error: "Audio not available" });
      return;
    }
    const stored = aiAudioByScheduleQuestion.get(`${id}:${qid}`) || null;
    if (!stored?.audio?.byteLength) {
      if (typeof ack === "function") ack({ ok: false, error: "Audio not available" });
      return;
    }
    if (typeof ack === "function") {
      ack({ ok: true, mimeType: stored.mimeType || "audio/webm", audio: stored.audio.toString("base64") });
    }
  });

  socket.on("disconnect", () => {
    closeDeepgramLive(socket);
    leave();
    if (userRole === "student" && userEmail) {
      const set = studentSocketIdsByEmail.get(userEmail);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) studentSocketIdsByEmail.delete(userEmail);
      }
      emitStudentStatus(userEmail).catch(() => {});
      emitDashboardsForConnectedInterviewers();
    }

    if (userRole === "interviewer" && userEmail) {
      const set = interviewerSocketIdsByEmail.get(userEmail);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) interviewerSocketIdsByEmail.delete(userEmail);
      }
    }
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on ${port}`);
});
