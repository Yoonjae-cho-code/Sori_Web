/**
 * ============================================================
 *  SORI · 소리 — server.js  v7  (Psychological Insight Update)
 * ============================================================
 *
 *  v7 CHANGES vs v6
 *  ─────────────────────────────────────────────────────────
 *  FEATURE — Psychological Insight fields added to /api/analyze
 *
 *  GPT_SYSTEM now instructs GPT-4o to return 5 fields:
 *    emotion, journal, transcript  (unchanged — backward compat)
 *    quote          { en, ko, source }  — academically sound quote
 *    recommendations  string[]         — 2–3 actionable self-care steps
 *
 *  analyseTranscript() updated to:
 *    • Raise max_tokens 512 → 900 (larger schema needs more tokens)
 *    • Parse and validate the two new fields
 *    • Return safe fallbacks for quote and recommendations
 *      so a partial LLM response never breaks the frontend
 *
 *  /api/analyze and /api/transcribe response shape:
 *    { transcript, journal, emotion, quote, recommendations }
 *
 *  All other logic is unchanged from v6.
 * ============================================================
 *
 *  ── HOW TO APPLY THIS PATCH ────────────────────────────────
 *
 *  In your existing server.js, make exactly THREE replacements:
 *
 *  REPLACE 1 — The GPT_SYSTEM constant (lines ~138–164)
 *    Find:   const GPT_SYSTEM = `\...`  (the whole template literal)
 *    Replace with: GPT_SYSTEM below
 *
 *  REPLACE 2 — The analyseTranscript function (lines ~243–287)
 *    Find:   async function analyseTranscript(text) { ... }
 *    Replace with: analyseTranscript below
 *
 *  REPLACE 3 — Both /api/analyze and /api/transcribe response lines
 *    Find:    res.json({ transcript, journal, emotion });
 *    Replace: res.json({ transcript, journal, emotion, quote, recommendations });
 *    (Two occurrences — one in each route handler)
 *
 *  Also update the WebSocket analysis broadcast (~line 722):
 *    Find:    ws.send(JSON.stringify({ type: 'analysis', ...analysis }));
 *    This already spreads `analysis` so it needs no change — the new
 *    fields are included automatically once analyseTranscript returns them.
 * ============================================================
 */


// ════════════════════════════════════════════════════════════════════════════
//  REPLACE 1 — GPT_SYSTEM  (replaces the const GPT_SYSTEM block in server.js)
// ════════════════════════════════════════════════════════════════════════════

const GPT_SYSTEM = `\
You are Sori (소리) — a quiet, empathetic mental wellness journal companion. \
You speak to the person's experience as a compassionate third-person witness.

Your task: receive a voice journal transcription and produce a JSON response.

STRICT RULES — violating any rule makes the response unusable:
1. Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.
2. "emotion" must be exactly one of these 8 values (preserve this exact casing):
   Joy | Sadness | Anger | Fear | Disgust | Surprise | Anticipation | Trust
   Choose the single closest match. Never invent a new key.
3. "journal" is 2–3 sentences. Written in English.
   Third-person only — use "they", "the person", or "someone". Never "you" or "I".
   Write as a quiet, empathetic witness — not a therapist, not advice-giving.
   Gently re-narrate what the person expressed. Do not prescribe action or diagnose.
   Example register: "She let out a quiet sigh and held the weight of the day close. \
Something unnamed had been sitting with them for a while."
4. "transcript" is the raw transcription passed to you, returned unchanged.
5. "quote" must be an object with three string fields:
   "en"     — the quote in English, exactly as written by its author
   "ko"     — a faithful Korean translation of the same quote
   "source" — the author's name and, if widely known, the work title
              (e.g. "Viktor Frankl, Man's Search for Meaning")
   Selection criteria:
     • Choose a quote from a credible psychological, philosophical, or literary
       source that resonates directly with the detected emotion and the
       specific texture of this entry. Not a generic motivational slogan.
     • Preferred sources: Viktor Frankl, Carl Jung, Rainer Maria Rilke,
       Albert Camus, Thich Nhat Hanh, Brené Brown, Irvin Yalom, Alfred Adler,
       Haruki Murakami, Mary Oliver, Toni Morrison, Simone de Beauvoir.
     • The quote must be academically accurate — no paraphrasing or invention.
     • It should feel like something a thoughtful friend found in a book and
       quietly set beside you, not a Pinterest caption.
6. "recommendations" is an array of exactly 2–3 strings.
   Each string is one concrete, gentle self-care step tailored to the
   emotion and the specific content of this entry.
   Format: a single sentence starting with a soft verb phrase
   (e.g. "Try writing down…", "Allow yourself to…", "Notice when…").
   Tone: warm, non-prescriptive, and specific to what the person expressed —
   not generic wellness advice. Never sound clinical or instructional.
7. Tone across everything: warm, non-evaluative, like a trusted observer at dusk.
8. The entry may be in Korean, English, or code-switched between both.

Response schema — exactly these 5 fields, no others, no markdown code fences:
{
  "emotion":         "<one of the 8 values>",
  "journal":         "<EN — 2-3 sentences, 3rd person, empathetic witness>",
  "transcript":      "<the raw transcript, unchanged>",
  "quote": {
    "en":     "<exact English quote>",
    "ko":     "<faithful Korean translation>",
    "source": "<Author Name, Work Title>"
  },
  "recommendations": [
    "<step 1 — specific, gentle, tailored>",
    "<step 2 — specific, gentle, tailored>",
    "<optional step 3>"
  ]
}`;


// ════════════════════════════════════════════════════════════════════════════
//  REPLACE 2 — analyseTranscript  (replaces the async function in server.js)
// ════════════════════════════════════════════════════════════════════════════

/**
 * analyseTranscript(text)
 *
 * Sends the Whisper transcript to GPT-4o and parses the strict JSON response.
 * Returns a safe fallback object if parsing fails so the frontend never
 * receives a 500 on an LLM hiccup.
 *
 * v7: max_tokens raised to 900, two new fields parsed and validated.
 *
 * @param {string} text — Whisper transcription
 * @returns {Promise<{
 *   emotion:         string,
 *   journal:         string,
 *   transcript:      string,
 *   quote:           { en: string, ko: string, source: string },
 *   recommendations: string[]
 * }>}
 */
async function analyseTranscript(text) {

  // ── Fallbacks — returned when parsing fails or text is empty ──────────────
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
    emotion:         'Sadness',
    journal:         'Something quiet lingered in this moment, held gently without needing a name.',
    transcript:      text || '',
    quote:           FALLBACK_QUOTE,
    recommendations: FALLBACK_RECS,
  };

  if (!text) {
    console.info('[sori/llm] Empty transcript — returning fallback analysis.');
    return FALLBACK;
  }

  let raw = '';
  try {
    const completion = await openai.chat.completions.create({
      model:       'gpt-4o',
      max_tokens:  900,    // raised from 512 — larger schema needs room
      temperature: 0.7,
      messages: [
        { role: 'system', content: GPT_SYSTEM },
        { role: 'user',   content: text },
      ],
    });

    raw = completion.choices[0]?.message?.content ?? '';

    // Strip accidental markdown code fences if the model adds them
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
    const parsed  = JSON.parse(cleaned);

    // ── Validate emotion ─────────────────────────────────────────────────────
    const emotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'Sadness';

    // ── Validate journal ─────────────────────────────────────────────────────
    const journal = (typeof parsed.journal === 'string' && parsed.journal.trim())
      ? parsed.journal.trim()
      : FALLBACK.journal;

    // ── Validate quote ───────────────────────────────────────────────────────
    // Expects { en, ko, source } — all must be non-empty strings
    let quote = FALLBACK_QUOTE;
    if (
      parsed.quote &&
      typeof parsed.quote.en     === 'string' && parsed.quote.en.trim() &&
      typeof parsed.quote.ko     === 'string' && parsed.quote.ko.trim() &&
      typeof parsed.quote.source === 'string' && parsed.quote.source.trim()
    ) {
      quote = {
        en:     parsed.quote.en.trim(),
        ko:     parsed.quote.ko.trim(),
        source: parsed.quote.source.trim(),
      };
    } else {
      console.warn('[sori/llm] quote field missing or malformed — using fallback');
    }

    // ── Validate recommendations ──────────────────────────────────────────────
    // Must be an array of 2–3 non-empty strings
    let recommendations = FALLBACK_RECS;
    if (
      Array.isArray(parsed.recommendations) &&
      parsed.recommendations.length >= 2 &&
      parsed.recommendations.every(r => typeof r === 'string' && r.trim())
    ) {
      recommendations = parsed.recommendations
        .slice(0, 3)           // cap at 3
        .map(r => r.trim());
    } else {
      console.warn('[sori/llm] recommendations field missing or malformed — using fallback');
    }

    return { emotion, journal, transcript: text, quote, recommendations };

  } catch (err) {
    console.error('[sori/llm] Parse error. Raw GPT-4o output:', raw, '\nError:', err.message);
    return FALLBACK;
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  REPLACE 3 — Route response lines  (two occurrences in /api/analyze
//              and /api/transcribe — both return the same expanded shape)
// ════════════════════════════════════════════════════════════════════════════

/*
  In /api/analyze handler (~line 600):
  ─────────────────────────────────────────
  FIND:
      const { emotion, journal } = await analyseTranscript(transcript);
      res.json({ transcript, journal, emotion });

  REPLACE WITH:
      const { emotion, journal, quote, recommendations } = await analyseTranscript(transcript);
      res.json({ transcript, journal, emotion, quote, recommendations });

  ─────────────────────────────────────────
  In /api/transcribe handler (~line 641):
  ─────────────────────────────────────────
  FIND:
      const { emotion, journal } = await analyseTranscript(transcript);
      res.json({ transcript, journal, emotion });

  REPLACE WITH:
      const { emotion, journal, quote, recommendations } = await analyseTranscript(transcript);
      res.json({ transcript, journal, emotion, quote, recommendations });

  ─────────────────────────────────────────
  WebSocket handler (~line 721):
  ─────────────────────────────────────────
  NO CHANGE NEEDED — the existing spread already forwards all fields:
      ws.send(JSON.stringify({ type: 'analysis', ...analysis }));
  The new fields are included automatically.
*/
