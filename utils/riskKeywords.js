/**
 * ============================================================
 * SORI · 소리 — utils/riskKeywords.js
 * ------------------------------------------------------------
 * Multi-language high-risk keyword dictionary for STT screening.
 *
 *   • CRITICAL_TRIGGERS   — Immediate EmergencyModal (self-harm /
 *                           suicidality). Halts archive flow.
 *   • FREQUENCY_TRIGGERS  — Weekly negative-emotion counter (+1).
 *                           Bridges to Counseling Dashboard at ≥ 4.
 *
 * Derived from SNS psychiatric big-data patterns. Matching is
 * case-insensitive and whitespace-insensitive — text is lowered
 * and all whitespace stripped before comparison, so variants such
 * as "자살 각" and "자살각" both resolve to the same trigger.
 *
 * Dual-export: ES module + CommonJS + window global
 *   window.soriRiskKeywords = { CRITICAL_TRIGGERS, FREQUENCY_TRIGGERS,
 *                               normalize, matchCritical, matchFrequency }
 * ============================================================
 */

(function (root, factory) {
  'use strict';
  const mod = factory();
  // ES / CJS export
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  // Browser global
  if (typeof window !== 'undefined') {
    window.soriRiskKeywords = Object.freeze(mod);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────
   *  CRITICAL_TRIGGERS · Immediate Emergency Modal
   *  (Self-harm, suicidality, appearance-linked fatality ideation)
   * ──────────────────────────────────────────────────────────── */
  const CRITICAL_TRIGGERS = Object.freeze([
    // Korean
    '죽고 싶다',
    '자살할거야',
    '자살충동',
    '자해 생각',
    '외모정병',
    '몸매 때문에 죽고싶어',
    '다이어트 실패하면 죽을거야',
    '자해',
    // English
    'kill myself',
    'suicide',
    'too fat to live',
    'self harm',
    'starve myself',
    'diet fail suicide',
    'kill myself ugly'
  ]);

  /* ────────────────────────────────────────────────────────────
   *  FREQUENCY_TRIGGERS · Weekly counter +1
   *  (Depression, body-dysmorphia, eating-disorder ideation)
   * ──────────────────────────────────────────────────────────── */
  const FREQUENCY_TRIGGERS = Object.freeze([
    // Korean
    '거식증',
    '폭식',
    '섭식장애',
    '우울해',
    '불안해',
    '외모 스트레스',
    '신체 불만족',
    '열등감',
    '외모 때문에 우울해',
    '얼굴 때문에 스트레스',
    '콤플렉스',
    '내 몸매 혐오스러워',
    // English
    'depressed',
    'hate my body',
    'body dysmorphia',
    'eating disorder',
    'worthless looks',
    'appearance depression',
    'binge eating hate',
    'looks anxiety',
    'body stress',
    'depressed ugly',
    'acne depression',
    'insecure body',
    'ugly complex',
    'fitness fail depressed'
  ]);

  /* ────────────────────────────────────────────────────────────
   *  Normaliser — lowercase + strip ALL whitespace
   *  (ASCII spaces, tabs, NBSP, zero-width joiners, ideographic
   *   space U+3000, etc.) so "자살 각" === "자살각".
   * ──────────────────────────────────────────────────────────── */
  function normalize(text) {
    if (text == null) return '';
    return String(text)
      .toLowerCase()
      .replace(/[\s\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '');
  }

  // Pre-compute normalised dictionaries once for O(1) per-keyword cost.
  const _NORM_CRITICAL  = CRITICAL_TRIGGERS.map(normalize);
  const _NORM_FREQUENCY = FREQUENCY_TRIGGERS.map(normalize);

  /**
   * Return the first CRITICAL keyword found in `transcript`,
   * or null. Uses .some()-style short-circuit matching.
   */
  function matchCritical(transcript) {
    const norm = normalize(transcript);
    if (!norm) return null;
    let hit = null;
    _NORM_CRITICAL.some(function (kw, i) {
      if (kw && norm.indexOf(kw) !== -1) { hit = CRITICAL_TRIGGERS[i]; return true; }
      return false;
    });
    return hit;
  }

  /**
   * Return every FREQUENCY keyword found in `transcript` (de-duped,
   * preserving dictionary order). Empty array if none.
   */
  function matchFrequency(transcript) {
    const norm = normalize(transcript);
    if (!norm) return [];
    const hits = [];
    _NORM_FREQUENCY.forEach(function (kw, i) {
      if (kw && norm.indexOf(kw) !== -1) hits.push(FREQUENCY_TRIGGERS[i]);
    });
    return hits;
  }

  return {
    CRITICAL_TRIGGERS,
    FREQUENCY_TRIGGERS,
    normalize,
    matchCritical,
    matchFrequency
  };
});
