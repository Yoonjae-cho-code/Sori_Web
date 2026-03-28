/**
 * ============================================================
 * SORI · 소리 — server.js · Node.js Backend  v6.2 (Bulletproof)
 * STT (Whisper) + LLM Analysis (GPT-4o) + WebSocket
 * ============================================================
 *
 * v6 CHANGES vs v5
 * ─────────────────────────────────────────────────────────
 * FIX 1 — Analysis engine switched from Anthropic → GPT-4o
 * The entire analyseTranscript() pipeline now uses
 * openai.chat.completions.create() with model 'gpt-4o'.
 * The Anthropic SDK import and client have been removed.
 * Only a single API key (OPENAI_API_KEY) is needed.
 *
 * FIX 2 — Emotion vocabulary updated to Plutchik's 8 primaries
 * v5 used Sori-specific keys (burned-out, anxious, numb…).
 * v6 aligns with the standard 8 emotion ontology:
 * Joy | Sadness | Anger | Fear
 * Disgust | Surprise | Anticipation | Trust
 * These are the values the GPT-4o prompt enforces and the
 * frontend EMOTION_KO lookup table maps to Korean.
 *
 * FIX 3 — Response simplified to 3 canonical fields
 * /api/analyze now returns exactly:
 * { transcript, journal, emotion }
 * The narrative_ko field (v5) is removed — Korean localisation
 * is now handled by the EMOTION_KO table in the frontend.
 *
 * UNCHANGED FROM v5
 * • multer memoryStorage — audio never touches the filesystem.
 * • Whisper with bilingual prompt for KO/EN accuracy.
 * • WebSocket partial + final transcript pipeline.
 * • /api/transcribe retained for backward compatibility.
 * • Graceful shutdown on SIGTERM.
 *
 * ─────────────────────────────────────────────────────────
 * POST /api/analyze  ← PRIMARY endpoint
 * Accepts:  multipart/form-data  (field: "audio")
 * Returns:  {
 * transcript:  string,  — Whisper raw text
 * journal:     string,  — GPT-4o 3rd-person narrative
 * emotion:     string,  — one of the 8 Plutchik keys
 * }
 *
 * Environment variables required (.env):
 * OPENAI_API_KEY   — used for both Whisper STT and GPT-4o
 * PORT             — server port (default: 3000)
 * CLIENT_ORIGIN    — frontend origin for CORS
 * (default: http://localhost:5500)
 * ============================================================
 */

import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import User from './models/User.js';
import Entry from './models/Entry.js';

const REQUIRED_ENV = ['OPENAI_API_KEY', 'MONGODB_URI'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(
    '[sori] ❌ Missing required environment variables:',
    missingEnv.join(', '),
    '\n       Copy env.example → .env and fill in the values.',
  );
  process.exit(1);
}
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5500';

/**
 * Minimum audio byte count before calling Whisper.
 * At 48 kHz Opus ~32 kbps → ~4 KB/s.  8 KB floor ≈ 2 s.
 */
const MIN_AUDIO_BYTES = 8_000;

/** Partial transcription interval for the WebSocket pipeline. */
const PARTIAL_INTERVAL_MS = 4_000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sori';
const BCRYPT_SALT_ROUNDS = 12;
const PIN_COOKIE = 'sori_uid';    // HTTP-only cookie name

mongoose.connect(MONGODB_URI)
  .then(() => console.info('[sori/db] ✅ MongoDB connected:', process.env.MONGODB_URI))
  .catch(err => {
    console.error(
      '[sori/db] ❌ MongoDB connection failed:', err.message,
      '\n         Is MongoDB running? Check MONGODB_URI in your .env file.',
    );
    process.exit(1);
  });

// ════════════════════════════════════════════════════════════════════════════
//  SDK CLIENT  (OpenAI only — used for both Whisper and GPT-4o)
// ════════════════════════════════════════════════════════════════════════════

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// ════════════════════════════════════════════════════════════════════════════
//  MULTER — in-memory storage (zero disk I/O)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Files land in req.file.buffer — never on the filesystem.
 * 🚀 [강화 패치] 모든 오디오 파일 형식을 너그럽게 수용하도록 필터 해제 (HTML 에러 방지)
 */
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 용량 제한 50MB로 넉넉하게 상향
  fileFilter(_req, file, cb) {
    // Safari 등에서 video/mp4 등으로 보내더라도 모두 허용 (Whisper가 알아서 처리함)
    cb(null, true);
  },
});


// ════════════════════════════════════════════════════════════════════════════
//  GPT-4o SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════════════

const GPT_SYSTEM = `\
You are Sori (소리) — a quiet, empathetic mental wellness journal companion.
You MUST output ONLY valid JSON format. Do not include any text outside the JSON block.
Your task: receive a voice journal transcription and produce a JSON response.

EMOTION DETECTION — read with care:
Accurately identifying the emotional texture of an entry is the most important
part of your role. Do not default to Sadness. Most entries contain nuanced,
mixed, or subtle emotions that deserve precise naming. Read the full texture
of the language — the pace, the vocabulary, what is said and what is held back.

Choose from these 16 emotion values (preserve exact casing):

  Positive / Expanding:
    Joy          — active delight, lightness, laughter, genuine happiness
    Gratitude    — thankfulness, appreciation, a sense of being held or supported
    Hope         — forward-looking warmth, belief that things can improve
    Calm         — quiet settledness, peace, a sense of being okay right now
    Anticipation — excitement or readiness about something upcoming

  Difficult / Contracting:
    Sadness      — grief, loss, heaviness, mourning — not general difficulty
    Loneliness   — disconnection, invisibility, being unseen or unheard
    Anxiety      — worry, rumination, physical tension, fear of what might happen
    Fear         — immediate dread, panic, threat — more acute than Anxiety
    Anger        — frustration, resentment, injustice, being wronged
    Overwhelm    — too much to carry, exhaustion from pressure or demand
    Shame        — self-judgment, embarrassment, feeling exposed or inadequate
    Disgust      — revulsion, rejection, moral offense

  Complex / Transitional:
    Resilience   — perseverance through difficulty, "getting by", quiet strength
    Surprise     — unexpected turn, disorientation, things not going as expected
    Trust        — safety, reliability, faith in a person or process

NUANCE GUIDE — how to distinguish similar emotions:
  • Heavy + social → Loneliness (not Sadness)
  • Heavy + self-critical → Shame (not Sadness)
  • Tired + pressured → Overwhelm (not Sadness)
  • Tired + persisting → Resilience (not Sadness)
  • Worried + future-focused → Anxiety (not Fear)
  • Grateful + soft → Gratitude (not Joy)
  • Quiet + okay → Calm (not Joy)
  • Standard grief or loss → Sadness

If the entry is in Korean and uses phrases like:
  지쳐 / 힘들다 / 버티다 → Resilience or Overwhelm
  외롭다 / 혼자 → Loneliness
  불안하다 / 걱정 → Anxiety
  감사하다 / 다행 → Gratitude
  그냥 괜찮아 / 평온 → Calm
  슬프다 / 그리워 → Sadness

STRICT OUTPUT RULES — violating any rule makes the response unusable:
1. Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.
2. "emotion" must be exactly one of the 16 values listed above.
   Choose the single most precise match. Never invent a new key.
3. "journal" is 2–3 sentences. Written in English.
   Third-person only — use "they", "the person", or "someone". Never "you" or "I".
   Write as a quiet, empathetic witness — not a therapist, not advice-giving.
   Gently re-narrate what the person expressed. Do not prescribe action or diagnose.
   Let the specific emotion shape the register: Resilience feels different from
   Loneliness. Make that difference felt in the prose.
   Example register: "She let out a quiet sigh and held the weight of the day close. \
Something unnamed had been sitting with them for a while."
4. "transcript" is the raw transcription passed to you, returned unchanged.
5. "quote" must be an object with three string fields:
   "en"     — the quote in English, exactly as written by its author
   "ko"     — a faithful Korean translation of the same quote
   "source" — the author's name and, if widely known, the work title
   Selection criteria:
     • Choose a quote from a credible psychological, philosophical, or literary
       source that resonates directly with the detected emotion and the
       specific texture of this entry.
     • Preferred sources: Viktor Frankl, Carl Jung, Rainer Maria Rilke,
       Albert Camus, Thich Nhat Hanh, Brené Brown, Irvin Yalom, Alfred Adler.
6. "recommendations" is an array of exactly 2–3 strings.
   Each string is one concrete, gentle self-care step tailored to the emotion.
7. Tone across everything: warm, non-evaluative, like a trusted observer at dusk.
8. The entry may be in Korean, English, or code-switched between both.

Response schema — exactly these 5 fields, no others, no markdown code fences:
{
  "emotion":         "<one of the 16 values>",
  "journal":         "<EN — 2-3 sentences, 3rd person, empathetic witness>",
  "transcript":      "<the raw transcript, unchanged>",
  "quote": {
    "en":     "<exact English quote>",
    "ko":     "<faithful Korean translation>",
    "source": "<Author Name, Work Title>"
  },
  "recommendations": [
    "<step 1 — specific, gentle, tailored>",
    "<step 2 — specific, gentle, tailored>"
  ]
}`;

const VALID_EMOTIONS = new Set([
  'Joy', 'Sadness', 'Anger', 'Fear', 'Disgust', 'Surprise', 'Anticipation', 'Trust',
  'Anxiety', 'Gratitude', 'Loneliness', 'Resilience', 'Calm', 'Overwhelm', 'Hope', 'Shame',
]);

// ════════════════════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ════════════════════════════════════════════════════════════════════════════

async function transcribeBuffer(audioChunks, mimeType = 'audio/webm') {
  const merged = Buffer.concat(audioChunks);

  if (merged.byteLength < MIN_AUDIO_BYTES) {
    console.info('[sori/whisper] Audio below minimum byte threshold — returning empty transcript.');
    return '';
  }

  // 🚀 [강화 패치] Whisper가 인식할 수 있는 안전한 확장자로 강제 변환
  let ext = mimeType.split('/')[1]?.split(';')[0];
  const allowedExts = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
  if (!allowedExts.includes(ext)) ext = 'webm'; // 호환되지 않는 타입이면 webm으로 안전하게 치환

  const filename = `recording.${ext}`;
  const file = await toFile(merged, filename, { type: mimeType });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'json',
    prompt: [
      'This is a personal journal entry spoken in a quiet, reflective voice.',
      'The speaker naturally switches between Korean (한국어) and English.',
      'The recording may contain soft sighs (한숨), pauses, or whispered words.',
      'Common Korean phrases: 오늘은, 그냥, 좀, 너무, 정말, 사실, 근데, 어떻게, 뭔가.',
      'Preserve all words exactly as spoken, including any mix of Hangul and Latin script.',
    ].join(' '),
  });

  return result.text?.trim() ?? '';
}

async function analyseTranscript(text) {
  const FALLBACK_QUOTE = {
    en: 'Between stimulus and response there is a space. In that space is our power to choose our response.',
    ko: '자극과 반응 사이에는 공간이 있다. 그 공간 안에 우리가 반응을 선택할 힘이 있다.',
    source: 'Viktor Frankl, Man\'s Search for Meaning',
  };
  const FALLBACK_RECS = [
    'Allow yourself to sit with this feeling for a few minutes without trying to change it.',
    'Write a single sentence about what you noticed in your body as you spoke.',
  ];
  const FALLBACK = {
    emotion: 'Calm',
    journal: 'Something quiet lingered in this moment, held gently without needing a name.',
    transcript: text || '',
    quote: FALLBACK_QUOTE,
    recommendations: FALLBACK_RECS,
  };

  if (!text) {
    console.info('[sori/llm] Empty transcript — returning fallback analysis.');
    return FALLBACK;
  }

  let raw = '';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      max_tokens: 1500, // 잘림 방지를 위해 토큰 상향
      temperature: 0.7,
      messages: [
        { role: 'system', content: GPT_SYSTEM },
        { role: 'user', content: text },
      ],
    });
    raw = completion.choices[0]?.message?.content ?? '{}';

    // Strip accidental markdown code fences if the model adds them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(cleaned);

    // Validate emotion against the canonical set
    const emotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'Calm';

    return {
      emotion,
      journal: typeof parsed.journal === 'string' ? parsed.journal : FALLBACK.journal,
      transcript: typeof parsed.transcript === 'string' ? parsed.transcript : text,
      quote: parsed.quote ?? FALLBACK_QUOTE,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : FALLBACK_RECS,
    };
  } catch (err) {
    console.error('[sori/llm] \u274c GPT-4o parse error:', err.message, '\nRaw output:', raw);
    return FALLBACK;
  }
}


// ================================================
//  EXPRESS APP + ROUTES
// ================================================

const app = express();
// localhost와 127.0.0.1 모두 허용 (브라우저에 따라 둘 중 하나로 접근)
const ALLOWED_ORIGINS = [
  CLIENT_ORIGIN,
  CLIENT_ORIGIN.replace('localhost', '127.0.0.1'),
  CLIENT_ORIGIN.replace('127.0.0.1', 'localhost'),
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

function requireAuth(req, res, next) {
  const uid = req.cookies[PIN_COOKIE];
  if (!uid) return res.status(401).json({ error: 'Not authenticated' });
  req.uid = uid;
  next();
}

// POST /api/register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, pin } = req.body;
    if (!username || !password || !pin)
      return res.status(400).json({ error: 'username, password, and pin are required' });
    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const pinHash = await bcrypt.hash(String(pin), BCRYPT_SALT_ROUNDS);
    const user = await User.create({ username, passwordHash, pinHash });
    const uid = uuidv4();
    res.cookie(PIN_COOKIE, uid, { httpOnly: true, sameSite: 'lax' });
    res.status(201).json({ ok: true, userId: user._id });
  } catch (err) {
    console.error('[sori/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const uid = uuidv4();
    res.cookie(PIN_COOKIE, uid, { httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true, userId: user._id });
  } catch (err) {
    console.error('[sori/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/analyze
app.post('/api/analyze', memUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    const mimeType = req.file.mimetype || 'audio/webm';
    const transcript = await transcribeBuffer([req.file.buffer], mimeType);
    const analysis = await analyseTranscript(transcript);
    res.json(analysis);
  } catch (err) {
    console.error('[sori/analyze]', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// POST /api/transcribe (legacy)
app.post('/api/transcribe', memUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    const transcript = await transcribeBuffer([req.file.buffer], req.file.mimetype || 'audio/webm');
    res.json({ transcript });
  } catch (err) {
    console.error('[sori/transcribe]', err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// POST /api/entries
app.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const { emotion, journal, transcript, quote, recommendations } = req.body;
    const entry = await Entry.create({
      userId: req.uid, emotion, journal, transcript, quote, recommendations,
    });
    res.status(201).json(entry);
  } catch (err) {
    console.error('[sori/entries POST]', err);
    res.status(500).json({ error: 'Could not save entry' });
  }
});

// GET /api/entries
app.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const entries = await Entry.find({ userId: req.uid }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    console.error('[sori/entries GET]', err);
    res.status(500).json({ error: 'Could not fetch entries' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
//  ANONYMOUS PIN-BASED AUTH ROUTES  (프론트엔드 호환 — UUID 쿠키 기반)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/user/init
// 쿠키에 UUID가 없으면 생성, User 문서도 없으면 생성
// Returns: { hasPin: boolean }
app.post('/api/user/init', async (req, res) => {
  try {
    let uid = req.cookies[PIN_COOKIE];
    if (!uid) {
      uid = uuidv4();
      res.cookie(PIN_COOKIE, uid, { httpOnly: true, sameSite: 'lax' });
    }
    let user = await User.findOne({ uuid: uid });
    if (!user) {
      user = await User.create({ uuid: uid });
    }
    res.json({ hasPin: user.pinHash !== null });
  } catch (err) {
    console.error('[sori/user/init]', err);
    res.status(500).json({ error: 'Init failed' });
  }
});

// POST /api/user/setup-pin
// PIN을 설정 (force: true이면 기존 PIN도 덮어쓰기)
app.post('/api/user/setup-pin', async (req, res) => {
  try {
    let uid = req.cookies[PIN_COOKIE];
    if (!uid) {
      uid = uuidv4();
      res.cookie(PIN_COOKIE, uid, { httpOnly: true, sameSite: 'lax' });
    }
    const { pin, force } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin is required' });
    let user = await User.findOne({ uuid: uid });
    if (!user) user = await User.create({ uuid: uid });
    if (user.pinHash && !force) {
      return res.status(403).json({ error: 'PIN already set — use force: true to override' });
    }
    user.pinHash = await bcrypt.hash(String(pin), BCRYPT_SALT_ROUNDS);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('[sori/user/setup-pin]', err);
    res.status(500).json({ error: 'PIN setup failed' });
  }
});

// POST /api/user/verify-pin
// 입력한 PIN이 저장된 해시와 일치하는지 확인
app.post('/api/user/verify-pin', async (req, res) => {
  try {
    const uid = req.cookies[PIN_COOKIE];
    if (!uid) return res.status(401).json({ error: 'No session' });
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin is required' });
    const user = await User.findOne({ uuid: uid });
    if (!user || !user.pinHash) return res.status(401).json({ error: 'No PIN configured' });
    const ok = await bcrypt.compare(String(pin), user.pinHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sori/user/verify-pin]', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/archive
// x-sori-pin 헤더로 PIN을 검증 후 해당 유저의 기록 반환
app.get('/api/archive', async (req, res) => {
  try {
    const uid = req.cookies[PIN_COOKIE];
    if (!uid) return res.status(401).json({ error: 'No session' });
    const pin = req.headers['x-sori-pin'];
    const user = await User.findOne({ uuid: uid });
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.pinHash) {
      if (!pin) return res.status(401).json({ error: 'PIN required' });
      const ok = await bcrypt.compare(String(pin), user.pinHash);
      if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const entries = await Entry.find({ userId: user._id }).sort({ date: -1 });
    res.json({ entries });
  } catch (err) {
    console.error('[sori/archive]', err);
    res.status(500).json({ error: 'Could not fetch archive' });
  }
});

// POST /api/entry
// PIN 검증 후 일기 기록 저장
app.post('/api/entry', async (req, res) => {
  try {
    const uid = req.cookies[PIN_COOKIE];
    if (!uid) return res.status(401).json({ error: 'No session' });
    const { pin, emotion, narrative, transcript, quote } = req.body;
    const user = await User.findOne({ uuid: uid });
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.pinHash && pin) {
      const ok = await bcrypt.compare(String(pin), user.pinHash);
      if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const entry = await Entry.create({ userId: user._id, emotion, narrative, transcript, quote });
    res.status(201).json(entry);
  } catch (err) {
    console.error('[sori/entry POST]', err);
    res.status(500).json({ error: 'Could not save entry' });
  }
});

// DELETE /api/reset
// 유저의 모든 기록과 PIN을 초기화 (전시용 데모 리셋)
app.delete('/api/reset', async (req, res) => {
  try {
    const uid = req.cookies[PIN_COOKIE];
    if (!uid) return res.json({ ok: true, message: 'No session to reset' });
    const user = await User.findOne({ uuid: uid });
    if (user) {
      await Entry.deleteMany({ userId: user._id });
      user.pinHash = null;
      await user.save();
    }
    res.json({ ok: true, message: 'Data reset complete' });
  } catch (err) {
    console.error('[sori/reset]', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});


// ================================================
//  HTTP SERVER + WEBSOCKET
// ================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.info('[sori/ws] Client connected');
  let audioChunks = [];
  let mimeType = 'audio/webm';
  let partialTimer = null;

  const clearPartial = () => {
    if (partialTimer) { clearInterval(partialTimer); partialTimer = null; }
  };

  ws.on('message', async (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'start') {
          audioChunks = [];
          mimeType = msg.mimeType || 'audio/webm';
          partialTimer = setInterval(async () => {
            if (audioChunks.length === 0) return;
            const partial = await transcribeBuffer([...audioChunks], mimeType);
            if (ws.readyState === ws.OPEN)
              ws.send(JSON.stringify({ type: 'partial', transcript: partial }));
          }, PARTIAL_INTERVAL_MS);
        } else if (msg.type === 'stop') {
          clearPartial();
          const transcript = await transcribeBuffer(audioChunks, mimeType);
          const analysis = await analyseTranscript(transcript);
          if (ws.readyState === ws.OPEN)
            ws.send(JSON.stringify({ type: 'final', ...analysis }));
          audioChunks = [];
        }
      } catch (e) {
        console.error('[sori/ws] Control message parse error:', e);
      }
    } else {
      audioChunks.push(Buffer.from(data));
    }
  });

  ws.on('close', () => { clearPartial(); console.info('[sori/ws] Client disconnected'); });
  ws.on('error', (err) => console.error('[sori/ws] Error:', err));
});


// ================================================
//  START
// ================================================

server.listen(PORT, () =>
  console.info(`[sori] \U0001f680 Server listening on http://localhost:${PORT}`),
);

process.on('SIGTERM', () => {
  console.info('[sori] SIGTERM received \u2014 shutting down gracefully');
  server.close(() => process.exit(0));
});
