/**
 * ============================================================
 *  SORI · 소리 — Entry Model  (ESM · mongoose)
 *
 *  Stores one journal moment per document.
 *
 *  Deliberate omissions:
 *    • rawText / originalTranscript — NEVER stored.
 *      The user's spoken words exist only in transit
 *      (RAM → Whisper → GPT-4o).  Once the AI rewrites them
 *      into a 3rd-person narrative, the source is discarded.
 *      This is a core psychological-safety commitment.
 *    • User location, device info, session metadata — none.
 *
 *  What IS stored:
 *    • userId    — foreign key to the anonymous User UUID
 *    • date      — moment of reflection
 *    • emotion   — one of Plutchik's 8 primary emotions
 *                  (matches the value returned by GPT-4o via
 *                   /api/analyze in server.js v6)
 *    • narrative — AI-rewritten 3rd-person record
 *                  (mapped from the `journal` field in the
 *                   /api/analyze response before DB insertion)
 *
 *  Emotion vocabulary (v6 — Plutchik 8 primaries, title-cased):
 *    Joy | Sadness | Anger | Fear
 *    Disgust | Surprise | Anticipation | Trust
 * ============================================================
 */

import mongoose from 'mongoose';

// ── Plutchik's 8 primary emotions ──────────────────────────────────────────
// Must stay in sync with VALID_EMOTIONS in server.js and EMOTION_KO in
// sori-voice.js.
// [수정 후]
const VALID_EMOTIONS = [
  'Joy', 'Sadness', 'Anger', 'Fear', 'Disgust', 'Surprise', 'Anticipation', 'Trust',
  'Anxiety', 'Gratitude', 'Loneliness', 'Resilience', 'Calm', 'Overwhelm', 'Hope', 'Shame',
];

const entrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    emotion: {
      type: String,
      required: true,
      enum: VALID_EMOTIONS,
    },
    narrative: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    transcript: String,
    // 새로 추가된 quote 필드 명시 (없으면 Mongoose가 데이터를 버립니다)
    quote: {
      en: String,
      ko: String,
      source: String
    }
  },
  {
    versionKey: false,

    // Expose 'id' as a plain string alias for '_id'
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Compound index: fetch all entries for a user sorted newest-first
entrySchema.index({ userId: 1, date: -1 });

const Entry = mongoose.model('Entry', entrySchema);

export default Entry;
