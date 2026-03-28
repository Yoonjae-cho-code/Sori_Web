/**
 * SORI · sori-flow.js — FIX for `transcriptionCta: false` warning
 *
 * In the DOM REFERENCES block (around line 56), remove this line:
 *
 *   const $transcriptionAnalysisCta = document.getElementById('transcription-analysis-cta');
 *
 * And in the console.log below it (around line 64), remove the reference:
 *
 * BEFORE:
 *   console.log('[sori-flow] DOM refs — beginBtn:', !!$beginBtn,
 *     '| archiveCta:', !!$archiveCta,
 *     '| transcriptionCta:', !!$transcriptionAnalysisCta,   // ← REMOVE this line
 *     '| emotionCards:', $emotionCards.length);
 *
 * AFTER:
 *   console.log('[sori-flow] DOM refs — beginBtn:', !!$beginBtn,
 *     '| archiveCta:', !!$archiveCta,
 *     '| emotionCards:', $emotionCards.length);
 *
 * WHY THIS IS SAFE:
 *   The transition from step-analysis → step-journal is already handled
 *   by the #view-journal-btn listener (around line 243 in sori-flow.js).
 *   The $transcriptionAnalysisCta variable was a leftover from the old v2
 *   flow where a separate "View Analysis" CTA existed. In the current HTML
 *   that button has been renamed to #view-journal-btn. Nothing breaks by
 *   removing the dead reference — it was never used after being declared.
 */
