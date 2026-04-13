/**
 * 
 * ============================================================
 *  SORI · 소리  —  sori-flow.js  v7  (Scroll Lock + Modal Sync)
 * ============================================================
 *
 *  v7 CHANGES vs v6
 *  ─────────────────────────────────────────────────────────
 *  FEATURE — Scroll lock management
 *
 *  _setScrollLock(locked: boolean)
 *    Toggles the .scroll-locked class on <html>.
 *    • true  → adds class  → CSS hides scrollbar (see sori-css-patch §G)
 *    • false → removes class → scrolling re-enabled for inner steps
 *
 *  The lock is applied:
 *    • On init — gateway is the landing state, no scroll needed.
 *    • In goToStep() — removed the moment the user leaves gateway;
 *      re-applied if they ever navigate back to step-gateway.
 *
 *  This replaces the previous approach of setting
 *  document.body.style.overflow inline (which was silently
 *  cleared by the modal controller on close).
 *
 *  All v6 behaviour is otherwise unchanged.
 * ============================================================
 */

(function () {
  'use strict';

  // ─── API Base URL (Express 서버는 포트 3000에서 실행) ─────────────────────
  const API_BASE = 'http://localhost:3000';

  console.log('[sori-flow] ✅ sori-flow.js v8 loaded — Express inner-scroll, gateway protected');

  // ─────────────────────────────────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  const FADE_MS = 600;   // cross-fade duration — must match CSS transition
  const CARD_DELAY_MS = 260;   // pause after card click before transitioning

  // ─────────────────────────────────────────────────────────────────────────
  //  EMOTION MAP  (16-value set — must mirror VALID_EMOTIONS in server.js)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Maps each server emotion key to its display emoji and Korean label.
   *
   * Emoji selection principle: use nature / elemental glyphs that carry
   * the emotional weight without being literally illustrative. A raindrop
   * for Sadness, not a crying face. This matches the oem.care register.
   *
   * Used by sori-voice.js (or wherever the journal card is built) via:
   *   const meta = window.soriFlow.getEmotionMeta(emotion);
   *   // → { emoji: '🌸', ko: '감사' }
   */
  const EMOTION_MAP = {
    // ── Positive ───────────────────────────────────────────────────────────
    Happy:        { emoji: '☀️',  ko: '행복' },   // sun — warm, full-bodied delight
    Excited:      { emoji: '🌟',  ko: '설렘' },   // star — energised, lit with anticipation
    Grateful:     { emoji: '🌸',  ko: '감사' },   // blossom — soft warmth offered outward
    Calm:         { emoji: '🍃',  ko: '평온' },   // leaf — quiet settledness, peace

    // ── Negative ───────────────────────────────────────────────────────────
    Sad:          { emoji: '🌧',  ko: '슬픔' },   // rain cloud — grief, heaviness, weight
    Angry:        { emoji: '🔥',  ko: '화남' },   // flame — heat, injustice, frustration
    Anxious:      { emoji: '🌀',  ko: '불안' },   // spiral — looping worry, tension
    Exhausted:    { emoji: '🌑',  ko: '지침' },   // dark moon — drained, nothing left

    // ── Neutral / Complex ──────────────────────────────────────────────────
    Nostalgic:    { emoji: '🌙',  ko: '그리움' }, // crescent — soft longing, looking back
    Ambivalent:   { emoji: '🌫',  ko: '애매' },   // fog — unclear, between two feelings
    Relieved:     { emoji: '🌿',  ko: '해방' },   // herb — quiet release, a held breath let go
    Accomplished: { emoji: '🌅',  ko: '성취' },   // dawn — a summit reached, new horizon
  };

  /**
   * getEmotionMeta(emotionKey)
   *
   * Returns { emoji, ko } for a given emotion key.
   * Falls back gracefully if the key is unknown.
   *
   * @param {string} emotionKey — one of the 16 VALID_EMOTIONS from server.js
   * @returns {{ emoji: string, ko: string }}
   */
  function getEmotionMeta(emotionKey) {
    if (!emotionKey) return { emoji: '🌿', ko: '—' };
    // Try exact match first, then title-case (handles lowercase keys from server)
    const titleKey = emotionKey.charAt(0).toUpperCase() + emotionKey.slice(1).toLowerCase();
    return EMOTION_MAP[emotionKey] ?? EMOTION_MAP[titleKey] ?? { emoji: '🌿', ko: emotionKey };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  STATE
  // ─────────────────────────────────────────────────────────────────────────

  let _currentStep = 'step-gateway';
  let _selectedEmotion = null;
  let _selectedEmotionTemperature = null; // 0–100 from slider; null when chosen via card

  // ─────────────────────────────────────────────────────────────────────────
  //  SCROLL LOCK
  //  Toggles .scroll-locked on <html> — CSS rule lives in sori-css-patch §G.
  //  This is the single source of truth for scroll state. The modal controller
  //  must NOT touch body/html overflow inline styles.
  // ─────────────────────────────────────────────────────────────────────────

  function _setScrollLock(locked) {
    document.documentElement.classList.toggle('scroll-locked', locked);
    console.log('[sori-flow] 🔒 scroll lock →', locked);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DOM REFS
  // ─────────────────────────────────────────────────────────────────────────

  const $beginBtn = document.getElementById('nav-enter-cta');
  const $archiveCta = document.getElementById('reflection-archive-cta');
  const $emotionCards = document.querySelectorAll('.emotion-card');

  console.log('[sori-flow] DOM refs — beginBtn:', !!$beginBtn,
    '| archiveCta:', !!$archiveCta,
    '| emotionCards:', $emotionCards.length);


  // ─────────────────────────────────────────────────────────────────────────
  //  TRANSITION ENGINE  (unchanged from v4)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * goToStep(toStepId)
   *
   * Cross-fades from the currently active step to the target step.
   * Two-frame rAF technique ensures CSS transitions fire across
   * display:none ↔ display:block boundaries.
   */
  function goToStep(toStepId) {
    console.log('[sori-flow] 🚪 goToStep("' + toStepId + '") from "' + _currentStep + '"');

    const outgoing = document.getElementById(_currentStep);
    const incoming = document.getElementById(toStepId);

    if (!incoming) {
      console.error('[sori-flow] ❌ Target step #' + toStepId + ' NOT FOUND in DOM.',
        'Make sure the <div id="' + toStepId + '" class="sori-step"> exists in index.html.');
      return;
    }

    if (toStepId === _currentStep) {
      console.log('[sori-flow] ℹ️  Already on step "' + toStepId + '" — no transition');
      return;
    }

    // Phase 1: fade out current step
    if (outgoing) {
      outgoing.style.transition = 'opacity ' + FADE_MS + 'ms ease-in-out';
      outgoing.style.opacity = '0';

      setTimeout(function () {
        outgoing.classList.remove('sori-step--active');
        outgoing.style.display = 'none';
        outgoing.style.opacity = '';
        outgoing.style.transition = '';
        console.log('[sori-flow] ← Step "' + _currentStep.replace('step-', '') + '" hidden');
      }, FADE_MS);
    }

    // Phase 2: make incoming visible at opacity 0 (frame 1)
    incoming.style.display = 'block';
    incoming.style.opacity = '0';
    incoming.style.transition = 'opacity ' + FADE_MS + 'ms ease-in-out';

    // Phase 3: fade in (frame 2)
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        incoming.style.opacity = '1';

        setTimeout(function () {
          incoming.classList.add('sori-step--active');
          incoming.style.opacity = '';
          incoming.style.transition = '';
          incoming.style.display = '';

          _triggerStepReveal(incoming);
          console.log('[sori-flow] → Step "' + toStepId.replace('step-', '') + '" active');

          // --- [추가] Archive 화면 진입 시 즉시 PIN 입력창에 포커스 ---
          if (toStepId === 'step-archive' && window.soriArchive) {
            window.soriArchive.focusPinInput();
          }

        }, FADE_MS);
      });
    });
    _currentStep = toStepId;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // ── Scroll policy ─────────────────────────────────────────────────────
    //
    //  Global overflow lock is kept ON for every viewport-height step.
    //  The Express step (#step-expression) stays in this locked set —
    //  its .emotion-card-container handles inner scroll via CSS
    //  (overflow-y: auto on the grid itself, not the body).
    //
    //  Only step-journal and step-archive release the global lock because
    //  they contain long-form content that genuinely needs page scroll.
    //
    //  This prevents the body from ever expanding past 100svh on steps
    //  that should feel like native app screens.
    //
    var _noScroll = {
      'step-gateway': 1,
      'step-expression': 1,   // inner-scroll only — body stays locked
      'step-voice-record': 1,
      'step-analysis': 1,
      'step-reflection': 1,
      'step-pin-calendar': 1,
    };
    _setScrollLock(!!_noScroll[toStepId]);

    // Reset the emotion grid's own scroll position so it always opens at top
    if (toStepId === 'step-expression') {
      var _cardGrid = document.querySelector('#step-expression .emotion-card-container');
      if (_cardGrid) _cardGrid.scrollTop = 0;
    }

    // ── Task 1: header background transition ──────────────────────────────
    // Toggling .on-step-journal on <body> lets CSS make the header
    // transparent so the page gradient flows seamlessly behind it.
    document.body.classList.toggle('on-step-journal', toStepId === 'step-journal');

    // ── 3D sphere visibility ───────────────────────────────────────────────
    //
    //  The canvas (#resonance-field / #sori-bg-layer) is only meaningful on
    //  the Landing Page. On every other step it is a distraction and must
    //  disappear.
    //
    //  Strategy: toggle .is-hidden on the canvas element directly.
    //  CSS gives it a 600ms opacity transition (matching FADE_MS) so it fades
    //  in perfect sync with the step cross-fade, not with an abrupt display:none.
    //
    //  We target both possible IDs — #sori-bg-layer (if a wrapper exists or is
    //  added later) and #resonance-field (the current canvas) — so this logic
    //  works with the current DOM and any future structural refactor.
    //
    var _bgLayer = document.getElementById('sori-bg-layer')
      || document.getElementById('resonance-field');

    if (_bgLayer) {
      if (toStepId === 'step-gateway') {
        _bgLayer.classList.remove('is-hidden');
        console.log('[sori-flow] 🌐 bg-layer → visible (gateway)');
      } else {
        _bgLayer.classList.add('is-hidden');
        console.log('[sori-flow] 🌐 bg-layer → hidden (' + toStepId + ')');
      }
    }
  }

  /**
   * _triggerStepReveal(stepEl)
   * Adds .is-visible to all .fade-in-up elements, staggered 60 ms apart.
   */
  function _triggerStepReveal(stepEl) {
    const nodes = stepEl.querySelectorAll('.fade-in-up');
    console.log('[sori-flow] 🌅 Triggering reveal for', nodes.length, 'fade-in-up nodes in', stepEl.id);
    nodes.forEach(function (node, i) {
      setTimeout(function () { node.classList.add('is-visible'); }, i * 60);
    });
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  EMOTION CARD SELECTION  (unchanged from v4)
  // ─────────────────────────────────────────────────────────────────────────

  function _handleCardClick(e) {
    const card = e.currentTarget;
    const emotion = card.dataset.emotion;

    console.log('[sori-flow] 🃏 Emotion card clicked:', emotion);

    $emotionCards.forEach(function (c) {
      c.classList.remove('emotion-card--active');
      c.setAttribute('aria-selected', 'false');
    });
    card.classList.add('emotion-card--active');
    card.setAttribute('aria-selected', 'true');

    _selectedEmotion = emotion;
    _selectedEmotionTemperature = null; // card selection carries no temperature value

    window.soriResonance?.setEmotionState?.(emotion);

    window.dispatchEvent(new CustomEvent('sori:emotion-selected', {
      detail: { emotion: emotion, emotionTemperature: null },
      bubbles: false,
    }));

    setTimeout(function () {
      console.log('[sori-flow] 🚪 Auto-transitioning to step-voice-record after card selection');
      goToStep('step-voice-record');
    }, CARD_DELAY_MS);
  }

  $emotionCards.forEach(function (card) {
    card.addEventListener('click', _handleCardClick);
  });

  // ── Capture emotion + temperature from slider path ────────────────────────
  // sori-updates.js fires 'sori:emotion-selected' with emotionTemperature set
  // when the slider confirm button is used. Capture it here so the /api/entry
  // payload always has the most recent values regardless of input mode.
  window.addEventListener('sori:emotion-selected', function (e) {
    if (!e.detail) return;
    if (e.detail.emotion) _selectedEmotion = e.detail.emotion;
    _selectedEmotionTemperature = (e.detail.emotionTemperature != null)
      ? Number(e.detail.emotionTemperature) : null;
  });

  console.log('[sori-flow] 🃏', $emotionCards.length, 'emotion cards wired to step-voice-record transition');


  // ─────────────────────────────────────────────────────────────────────────
  //  STEP TRANSITION WIRING  (unchanged from v4 + new journal→archive)
  // ─────────────────────────────────────────────────────────────────────────

  if ($beginBtn) {
    $beginBtn.addEventListener('click', function () {
      console.log('[sori-flow] 🚪 Begin CTA clicked');
      goToStep('step-expression');
    });
    console.log('[sori-flow] ✅ Begin CTA wired');
  } else {
    console.warn('[sori-flow] ⚠️  #nav-enter-cta not found');
  }

  const $viewJournalBtn = document.getElementById('view-journal-btn');
  if ($viewJournalBtn) {
    $viewJournalBtn.addEventListener('click', function () {
      console.log('[sori-flow] 🚪 Analysis → Journal CTA clicked');
      goToStep('step-journal');
    });
  }

  const $journalArchiveCta = document.getElementById('journal-archive-cta');
  if ($journalArchiveCta) {
    $journalArchiveCta.addEventListener('click', function () {
      console.log('[sori-flow] 🚪 Journal → Archive CTA clicked');
      goToStep('step-archive');
    });
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  NEW v5 — populateInsight(data)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * populateInsight(data)
   *
   * Extracts `quote` and `recommendations` from the /api/analyze response
   * and injects them into the insight section defined in index.html.
   *
   * Called by sori-voice.js immediately after it writes the main
   * journal fields to the DOM. Safe to call with a partial or malformed
   * `data` object — every field access is guarded with optional-chaining.
   *
   * DOM targets (must exist in index.html):
   *   #insight-section       — wrapper <section hidden>
   *   #insight-quote-en      — English quote <p>
   *   #insight-quote-ko      — Korean translation <p>
   *   #insight-quote-source  — attribution <cite>
   *   #insight-recs-list     — <ol> for recommendation items
   *
   * @param {{ quote?: { en, ko, source }, recommendations?: string[] }} data
   */
  function populateInsight(data) {
    console.log('[sori-flow] 💡 populateInsight() called', data);

    const section = document.getElementById('insight-section');
    if (!section) {
      console.warn('[sori-flow] ⚠️  #insight-section not found — skipping insight population');
      return;
    }

    // ── 1. Inject quote ──────────────────────────────────────────────────────

    const quoteData = data?.quote;

    const $quoteEn = document.getElementById('insight-quote-en');
    const $quoteKo = document.getElementById('insight-quote-ko');
    const $quoteSource = document.getElementById('insight-quote-source');

    if (quoteData?.en && $quoteEn) {
      $quoteEn.textContent = '\u201c' + quoteData.en + '\u201d';   // " … "
    }
    if (quoteData?.ko && $quoteKo) {
      $quoteKo.textContent = '\u201c' + quoteData.ko + '\u201d';
    }
    if (quoteData?.source && $quoteSource) {
      $quoteSource.textContent = '— ' + quoteData.source;
    }

    // ── 2. Inject recommendations ────────────────────────────────────────────

    const recs = Array.isArray(data?.recommendations) ? data.recommendations : [];
    const $recList = document.getElementById('insight-recs-list');

    if ($recList && recs.length > 0) {
      // Clear any previous items (e.g. on a second recording)
      $recList.innerHTML = '';

      recs.forEach(function (text, i) {
        if (!text || typeof text !== 'string') return;

        // Format ordinal as zero-padded two-digit string: 01, 02, 03
        const numeral = String(i + 1).padStart(2, '0');

        const $li = document.createElement('li');
        $li.className = 'insight-recs__item';
        $li.setAttribute('aria-label', 'Step ' + (i + 1));

        // Numeral span (decorative — screen readers skip)
        const $num = document.createElement('span');
        $num.className = 'insight-recs__numeral';
        $num.textContent = numeral;
        $num.setAttribute('aria-hidden', 'true');

        // Text paragraph
        const $p = document.createElement('p');
        $p.className = 'insight-recs__text';
        $p.textContent = text;

        $li.appendChild($num);
        $li.appendChild($p);
        $recList.appendChild($li);
      });

      console.log('[sori-flow] 💡', recs.length, 'recommendations injected');
    }

    // ── 3. Reveal the section ────────────────────────────────────────────────
    // Only reveal if at least one piece of content was populated.

    const hasContent = (quoteData?.en) || (recs.length > 0);

    if (hasContent) {
      // Remove HTML [hidden] attribute to bring the section into the layout
      section.removeAttribute('hidden');

      // Two-frame rAF so the CSS transition fires after display change
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          section.classList.add('insight-section--visible');
          console.log('[sori-flow] 💡 #insight-section revealed');
        });
      });
    }
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  JOURNAL CARD PATCHER  (Tasks 3 & 5)
  //
  //  Watches #step-journal via MutationObserver so that whenever
  //  sori-voice.js injects the journal card content we can:
  //    • Task 5 — Reformat the date element to include the day of week
  //               ("26.03.22"  →  "SUN · 26.03.22")
  //    • Task 3 — Ensure the emotion-ko element shows the Korean
  //               translation even if sori-voice.js wrote English there.
  // ─────────────────────────────────────────────────────────────────────────

  const _DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const _KO_REGEX = /[\uAC00-\uD7A3]/;   // matches any Hangul syllable

  /** Task 5: add day-of-week prefix to a date element. */
  function _patchDateEl(el) {
    if (!el) return;
    const raw = (el.textContent || '').trim();
    if (!raw || raw.includes('·')) return; // already patched or empty

    // Expected format from sori-voice.js: "YY.MM.DD"  e.g. "26.03.22"
    const parts = raw.split('.');
    if (parts.length !== 3) return;
    const yy = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    const dd = parseInt(parts[2], 10);
    if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return;

    const fullYear = yy < 100 ? 2000 + yy : yy;
    const date = new Date(fullYear, mm - 1, dd);
    if (isNaN(date.getTime())) return;

    const dayName = _DAY_ABBR[date.getDay()];
    el.textContent = dayName + ' · ' + raw;
    console.log('[sori-flow] 📅 Date patched →', el.textContent);
  }

  /** Task 3: ensure the Korean emotion label shows Hangul, not an English copy. */
  function _patchEmotionKoEl(koEl) {
    if (!koEl) return;
    const txt = (koEl.textContent || '').trim();
    // If already has Hangul, nothing to do
    if (_KO_REGEX.test(txt)) return;

    // Walk up to find the English label sibling
    const badge = koEl.closest('.sori-journal-card__emotion-badge');
    const enEl = badge && badge.querySelector('.sori-journal-card__emotion-en');
    const raw = enEl ? enEl.textContent.trim() : txt;

    const meta = getEmotionMeta(raw);
    if (meta.ko && _KO_REGEX.test(meta.ko)) {
      koEl.textContent = meta.ko;
      console.log('[sori-flow] 🌐 Emotion KO patched →', meta.ko);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  _handleArchiveClick  — shared handler for both the static fallback CTA
  //  (#journal-save-record-cta) and the dynamically injected button.
  //  Reads the entry date from whichever date element is available, then
  //  navigates to step-pin-calendar and builds the calendar.
  // ─────────────────────────────────────────────────────────────────────────

  function _handleArchiveClick() {
    console.log('[sori-flow] 💾 Archive Record clicked → step-pin-calendar');

    // Prefer the dynamic card's date; fall back to the static element
    const dateEl = document.querySelector('.sori-journal-card__date')
      || document.getElementById('journal-date');
    const rawDate = (dateEl ? dateEl.textContent : '').trim();

    const stripped = rawDate.replace(/^[A-Z]{3}\s*·\s*/, '');
    const parts = stripped.split('.');

    let entryDate = new Date();
    if (parts.length === 3) {
      const yy = parseInt(parts[0], 10);
      const mm = parseInt(parts[1], 10);
      const dd = parseInt(parts[2], 10);
      const fullYear = yy < 100 ? 2000 + yy : yy;
      const candidate = new Date(fullYear, mm - 1, dd);
      if (!isNaN(candidate.getTime())) entryDate = candidate;
    }

    _entryDate = entryDate;
    console.log('[sori-flow] 📅 Entry date resolved →', _entryDate.toDateString());

    goToStep('step-pin-calendar');
    setTimeout(function () {
      _buildPinCalendar(_entryDate);
      _showPinPanel('pin-cal-panel');
    }, FADE_MS + 80);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  _injectArchiveButtonInCard
  //
  //  Called by the MutationObserver the moment sori-voice.js writes the
  //  dynamic .sori-journal-card into #step-journal.
  //
  //  1. Guards against double-injection.
  //  2. Hides the outer static CTA wrapper (#journal-outer-cta-wrapper).
  //  3. Creates a button with class "voice-record-btn journal-save-record-btn"
  //     and inserts it directly above .sori-journal-card__new-entry.
  //  4. Wires the button to _handleArchiveClick().
  // ─────────────────────────────────────────────────────────────────────────

  function _injectArchiveButtonInCard() {
    if (document.querySelector('.sori-journal-card__archive-cta')) return;

    const newEntryBtn = document.querySelector('.sori-journal-card__new-entry');
    if (!newEntryBtn) return;

    // Hide the static outer fallback
    const outerWrapper = document.getElementById('journal-outer-cta-wrapper');
    if (outerWrapper) outerWrapper.style.display = 'none';

    // Build the button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voice-record-btn journal-save-record-btn sori-journal-card__archive-cta';
    btn.setAttribute('aria-label', 'Archive this record — 기록 보관하기');
    btn.innerHTML = '◎ &nbsp; Archive Record &nbsp;·&nbsp; <span lang="ko">기록 보관하기</span>';
    btn.addEventListener('click', _handleArchiveClick);

    newEntryBtn.parentNode.insertBefore(btn, newEntryBtn);
    console.log('[sori-flow] ✅ Archive button injected above New Entry');
  }

  /** Scan a subtree for patchable elements and trigger archive injection. */
  function _scanAndPatch(root) {
    if (!root || root.nodeType !== 1) return;

    if (root.matches('.sori-journal-card__date')) _patchDateEl(root);
    if (root.matches('.sori-journal-card__emotion-ko')) _patchEmotionKoEl(root);

    root.querySelectorAll('.sori-journal-card__date').forEach(_patchDateEl);
    root.querySelectorAll('.sori-journal-card__emotion-ko').forEach(_patchEmotionKoEl);

    // Fire archive injection whenever the new-entry button or full card appears
    if (root.matches('.sori-journal-card__new-entry') ||
      root.matches('.sori-journal-card') ||
      root.querySelector('.sori-journal-card__new-entry')) {
      _injectArchiveButtonInCard();
    }
  }

  function _installJournalPatcher() {
    const journalStep = document.getElementById('step-journal');
    if (!journalStep) {
      console.warn('[sori-flow] ⚠️  #step-journal not found — journal patcher not installed');
      return;
    }

    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mut) {
        if (mut.type === 'childList') {
          mut.addedNodes.forEach(_scanAndPatch);
        } else if (mut.type === 'characterData') {
          const parent = mut.target.parentElement;
          if (parent) _scanAndPatch(parent);
        }
      });
    });

    observer.observe(journalStep, { childList: true, subtree: true, characterData: true });
    console.log('[sori-flow] 🔍 Journal patcher (date + emotion-ko) installed on #step-journal');
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  TASK 1: SMART HOME NAVIGATION  (resetToGateway)
  //
  //  Clicking the "Sori" wordmark (#nav-logo-home) calls resetToGateway():
  //    1. Clears all session-level state (_selectedEmotion, _pinState).
  //    2. Stops any active voice recording session.
  //    3. Calls goToStep('step-gateway') — reuses the existing cross-fade
  //       engine so the transition is app-like (no page reload).
  // ─────────────────────────────────────────────────────────────────────────

  function resetToGateway() {
    console.log('[sori-flow] 🏠 resetToGateway() invoked');

    // 1. [전시용 완벽 초기화] 서버의 PIN과 모든 저널 기록을 영구 삭제
    fetch(`${API_BASE}/api/reset`, { method: 'DELETE', credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        console.log('[sori-flow] 백엔드 데이터 초기화 완료:', data);
        if (window.soriArchive && typeof window.soriArchive.resetState === 'function') {
          window.soriArchive.resetState();
        }
      })
      .catch(err => console.error('[sori-flow] 백엔드 리셋 오류:', err));

    // ─── [핵심 추가] 프론트엔드 DOM에 숨겨진 이전 저널 카드 물리적 삭제 (데이터 꼬임 방지) ───
    document.querySelectorAll('.sori-journal-card').forEach(card => card.remove());
    document.querySelectorAll('.insight-section').forEach(sec => {
      sec.setAttribute('hidden', 'true');
      sec.classList.remove('insight-section--visible');
    });
    // ──────────────────────────────────────────────────────────────────────────────

    // Clear emotion selection
    _selectedEmotion = null;
    _selectedEmotionTemperature = null;
    $emotionCards.forEach(function (c) {
      c.classList.remove('emotion-card--active');
      c.setAttribute('aria-selected', 'false');
    });
    // Stop any live recording
    if (typeof window.soriVoice?.stopRecording === 'function') {
      try { window.soriVoice.stopRecording(); } catch (_e) { /* swallow */ }
    }

    // Reset PIN panel state
    _pinState = { step: 'set', firstPin: '' };
    const $si = document.getElementById('pin-set-input');
    const $ci = document.getElementById('pin-confirm-input');
    if ($si) $si.value = '';
    if ($ci) $ci.value = '';
    if (typeof _updatePinDots === 'function') {
      _updatePinDots('pin-set-dots', 0);
      _updatePinDots('pin-confirm-dots', 0);
    }
    if (typeof _clearPinError === 'function') {
      _clearPinError('pin-set-error');
      _clearPinError('pin-confirm-error');
    }

    goToStep('step-gateway');
  }

  // Wire the logo button
  const $logoHome = document.getElementById('nav-logo-home');
  if ($logoHome) {
    $logoHome.addEventListener('click', resetToGateway);
    console.log('[sori-flow] ✅ Sori logo home-reset button wired (#nav-logo-home)');
  } else {
    console.warn('[sori-flow] ⚠️  #nav-logo-home not found — logo reset not wired');
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  TASK 2: ARCHIVE RECORD — "Archive Record" button in #step-journal
  // ─────────────────────────────────────────────────────────────────────────

  // Wire static fallback CTA (visible before sori-voice.js builds the card)
  const $journalSaveCta = document.getElementById('journal-save-record-cta');
  if ($journalSaveCta) {
    $journalSaveCta.addEventListener('click', _handleArchiveClick);
    console.log('[sori-flow] ✅ Static Archive Record CTA wired (#journal-save-record-cta)');
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  TASK 2: PIN CALENDAR SYSTEM
  // ─────────────────────────────────────────────────────────────────────────

  const _MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // PIN flow state machine
  let _pinState = { step: 'set', firstPin: '' };
  let _entryDate = null;  // Date object of the highlighted journal entry

  // Calendar view state (for prev/next month nav)
  let _calViewYear = new Date().getFullYear();
  let _calViewMonth = new Date().getMonth();


  /* ── Panel show/hide engine ────────────────────────────────────────────── */

  /**
   * _showPinPanel(targetId)
   *
   * Fades the currently-active panel out, then fades the target panel in.
   * Panels are absolutely-stacked inside .pin-step-container via CSS.
   */
  function _showPinPanel(targetId) {
    const panels = document.querySelectorAll('.pin-panel');
    panels.forEach(function (p) {
      if (p.id === targetId) return;

      p.style.transition = 'opacity 320ms ease, transform 320ms ease';
      p.style.opacity = '0';
      p.style.transform = 'translateX(-16px)';
      p.style.pointerEvents = 'none';

      setTimeout(function () {
        p.classList.remove('pin-panel--active');
        p.style.transition = '';
        p.style.opacity = '';
        p.style.transform = '';
        p.style.pointerEvents = '';  // ← FIX: always clear so it never stays stuck
      }, 320);
    });

    const target = document.getElementById(targetId);
    if (!target) return;

    target.classList.add('pin-panel--active');
    target.style.opacity = '0';
    target.style.transform = 'translateX(16px)';
    target.style.pointerEvents = '';

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        target.style.transition = 'opacity 360ms ease, transform 360ms ease';
        target.style.opacity = '1';
        target.style.transform = 'translateX(0)';

        setTimeout(function () {
          target.style.transition = '';
          target.style.opacity = '';
          target.style.transform = '';
          target.style.pointerEvents = '';  // ← ensure clean final state
        }, 360);
      });
    });

    console.log('[sori-flow] 🎴 PIN panel →', targetId);

    // 🌟 성공 화면(Success)이 뜨면 3초 뒤에 홈으로 강제 송환
    if (targetId === 'pin-success-panel') {
      setTimeout(() => {
        // 3초 뒤에 사용자가 아직 성공 화면에 머물러 있다면 홈으로 이동
        const successPanel = document.getElementById('pin-success-panel');
        if (successPanel && successPanel.classList.contains('pin-panel--active')) {
          resetToGateway();
        }
      }, 3000);
    }

  }

  /* ── Back button event delegation (robust against display:none at bind time) ── */

  document.addEventListener('click', function (e) {
    // 🌟 [추가됨] 기록 보호하기 버튼 클릭 시 PIN 설정창으로 이동
    if (e.target.closest('#pin-protect-btn')) {
      e.stopPropagation();
      console.log('[sori-flow] 🔒 Protect Record clicked');

      _pinState.firstPin = '';
      const $si = document.getElementById('pin-set-input');
      if ($si) { $si.value = ''; }
      if (typeof _updatePinDots === 'function') _updatePinDots('pin-set-dots', 0);
      if (typeof _clearPinError === 'function') _clearPinError('pin-set-error');

      _showPinPanel('pin-set-panel');

      setTimeout(function () {
        document.getElementById('pin-set-input')?.focus();
      }, 400);
      return;
    }
    // pin-set-back → go back to calendar
    if (e.target.closest('#pin-set-back')) {
      e.stopPropagation();
      console.log('[sori-flow] ← pin-set-back clicked');
      _showPinPanel('pin-cal-panel');
      return;
    }

    // pin-confirm-back → go back to set-PIN
    if (e.target.closest('#pin-confirm-back')) {
      e.stopPropagation();
      console.log('[sori-flow] ← pin-confirm-back clicked');
      const $ci = document.getElementById('pin-confirm-input');
      if ($ci) $ci.value = '';
      _updatePinDots('pin-confirm-dots', 0);
      _clearPinError('pin-confirm-error');
      _showPinPanel('pin-set-panel');
      setTimeout(function () {
        document.getElementById('pin-set-input')?.focus();
      }, 420);
    }
  });


  /* ── Calendar builder ──────────────────────────────────────────────────── */

  /**
   * _buildPinCalendar(entryDate)
   *
   * Renders a lightweight Mon-first calendar grid for the month containing
   * `entryDate`. The entry day gets .pin-cal-day--entry + a click handler
   * that triggers the PIN set flow.
   *
   * @param {Date} entryDate
   */
  function _buildPinCalendar(entryDate) {
    const mount = document.getElementById('pin-calendar-mount');
    if (!mount) return;

    _calViewYear = entryDate.getFullYear();
    _calViewMonth = entryDate.getMonth();

    _renderCalendar(mount, entryDate);
    _updateMonthLabel();
  }

  function _renderCalendar(mount, entryDate) {
    mount.innerHTML = '';

    const year = _calViewYear;
    const month = _calViewMonth;
    const entryDay = entryDate && entryDate.getFullYear() === year &&
      entryDate.getMonth() === month ? entryDate.getDate() : null;

    // ── Day-of-week headers (Mon … Sun) ──────────────────────────────────
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) {
      const el = document.createElement('div');
      el.className = 'pin-cal-label';
      el.textContent = d;
      el.setAttribute('role', 'columnheader');
      el.setAttribute('aria-label', d);
      mount.appendChild(el);
    });

    // ── Leading empty cells ──────────────────────────────────────────────
    // JS getDay(): 0=Sun … 6=Sat. Convert to Mon-first offset (Mon=0, Sun=6).
    const firstDow = new Date(year, month, 1).getDay();
    const offset = (firstDow + 6) % 7;

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement('div');
      empty.className = 'pin-cal-day pin-cal-day--empty';
      empty.setAttribute('aria-hidden', 'true');
      mount.appendChild(empty);
    }

    // ── Day cells ────────────────────────────────────────────────────────
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin-cal-day';
      el.textContent = String(day).padStart(2, '0');
      el.setAttribute('role', 'gridcell');

      if (day === entryDay) {
        // [절대 지우면 안 되는 부분] 달력 날짜에 색을 칠해주는 코드
        el.classList.add('pin-cal-day--entry');
        el.setAttribute('aria-label',
          _MONTH_NAMES[month] + ' ' + day + ' — your entry, click to protect');

        // [새롭게 바뀐 부분] 날짜를 클릭했을 때 일어나는 일
        el.addEventListener('click', function () {
          const previewContainer = document.getElementById('pin-journal-preview-container');
          const previewMount = document.getElementById('pin-journal-preview');
          const protectAction = document.getElementById('pin-protect-action');

          if (previewContainer && previewMount && protectAction) {
            // 1. 방금 전 작성된 Step 6의 저널 카드를 복사해옵니다
            const originalCard = document.querySelector('#step-journal .sori-journal-card');
            if (originalCard) {
              const clonedCard = originalCard.cloneNode(true);
              // 2. 복사된 카드 안에 있는 버튼들은 거슬리므로 지워줍니다
              const ctas = clonedCard.querySelectorAll('.journal-archive-cta, .sori-journal-card__new-entry, .sori-journal-card__archive-cta, button');
              ctas.forEach(cta => cta.remove());

              clonedCard.style.margin = '0';
              clonedCard.style.width = '100%';

              // 3. 우측 빈 공간에 꽂아 넣습니다
              previewMount.innerHTML = '';
              previewMount.appendChild(clonedCard);
            }

            // 4. 화면에 스르륵 나타나게 합니다
            previewContainer.style.display = 'block';
            void previewContainer.offsetWidth; // 부드러운 전환을 위한 강제 렌더링
            previewContainer.style.opacity = '1';

            // 5. 좌측 하단에 [기록 보호하기] 버튼을 띄웁니다
            protectAction.style.display = 'block';
          } else {
            // HTML 코드가 아직 추가되지 않았을 경우를 대비한 기존 작동 로직
            _pinState.firstPin = '';
            const $si = document.getElementById('pin-set-input');
            if ($si) { $si.value = ''; }
            _updatePinDots('pin-set-dots', 0);
            _clearPinError('pin-set-error');
            _showPinPanel('pin-set-panel');
            setTimeout(function () {
              const input = document.getElementById('pin-set-input');
              if (input) input.focus();
            }, 400);
          }
        });

      } else {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('aria-label', _MONTH_NAMES[month] + ' ' + day);
        el.disabled = true;
      }

      mount.appendChild(el);
    }
  }

  function _updateMonthLabel() {
    const label = document.getElementById('pin-cal-month-label');
    if (label) {
      label.textContent = _MONTH_NAMES[_calViewMonth] + ' ' + _calViewYear;
    }
  }

  // ── Calendar prev/next month navigation ─────────────────────────────────
  const $calPrev = document.getElementById('pin-cal-prev');
  const $calNext = document.getElementById('pin-cal-next');

  if ($calPrev) {
    $calPrev.addEventListener('click', function () {
      _calViewMonth--;
      if (_calViewMonth < 0) { _calViewMonth = 11; _calViewYear--; }
      const mount = document.getElementById('pin-calendar-mount');
      if (mount) _renderCalendar(mount, _entryDate);
      _updateMonthLabel();
    });
  }

  if ($calNext) {
    $calNext.addEventListener('click', function () {
      _calViewMonth++;
      if (_calViewMonth > 11) { _calViewMonth = 0; _calViewYear++; }
      const mount = document.getElementById('pin-calendar-mount');
      if (mount) _renderCalendar(mount, _entryDate);
      _updateMonthLabel();
    });
  }


  /* ── 4-dot PIN UI helpers ──────────────────────────────────────────────── */

  /**
   * _updatePinDots(dotsWrapperId, filledCount)
   * Toggles .pin-dot--filled on the child .pin-dot elements.
   */
  function _updatePinDots(wrapperId, filledCount) {
    const dots = document.querySelectorAll('#' + wrapperId + ' .pin-dot');
    dots.forEach(function (dot, i) {
      dot.classList.toggle('pin-dot--filled', i < filledCount);
    });
  }

  function _clearPinError(errorId) {
    const el = document.getElementById(errorId);
    if (el) el.textContent = '';
  }

  /**
   * _shakeDots(wrapperId)
   * Brief horizontal shake animation on PIN mismatch.
   */
  function _shakeDots(wrapperId) {
    const el = document.getElementById(wrapperId);
    if (!el) return;
    el.style.animation = 'none';
    // Force reflow
    void el.offsetWidth;  // eslint-disable-line no-void
    el.style.animation = 'pin-shake 420ms ease';
    setTimeout(function () { el.style.animation = ''; }, 450);
  }

  /* ── Dot click → focus the hidden input ────────────────────────────────── */

  ['pin-set-dots', 'pin-confirm-dots'].forEach(function (wrapperId) {
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      wrapper.addEventListener('click', function () {
        const panelId = wrapperId === 'pin-set-dots' ? 'pin-set-panel' : 'pin-confirm-panel';
        const inputId = wrapperId === 'pin-set-dots' ? 'pin-set-input' : 'pin-confirm-input';
        if (document.getElementById(panelId)?.classList.contains('pin-panel--active')) {
          document.getElementById(inputId)?.focus();
        }
      });
    }
  });


  /* ── PIN set input handler ──────────────────────────────────────────────── */

  /* ── PIN set input handler ──────────────────────────────────────────────── */

  const $pinSetInput = document.getElementById('pin-set-input');
  let _setPending = false; // 에러 방지용 상태 변수 선언

  if ($pinSetInput) {
    $pinSetInput.addEventListener('input', function () {
      // 숫자 이외의 문자 제거
      $pinSetInput.value = $pinSetInput.value.replace(/\D/g, '').slice(0, 4);
      _updatePinDots('pin-set-dots', $pinSetInput.value.length);
      _clearPinError('pin-set-error');

      // 원인 해결: $pinConfirmInput 대신 $pinSetInput.value.length 확인
      if ($pinSetInput.value.length === 4 && !_setPending) {
        _setPending = true;

        // 입력한 첫 번째 PIN 번호를 상태에 임시 저장
        _pinState.firstPin = $pinSetInput.value;

        setTimeout(function () {
          console.log('[sori-flow] 🔒 PIN step 1 complete — transitioning to confirm');

          // 다음 패널을 띄우기 전 초기화
          const $ci = document.getElementById('pin-confirm-input');
          if ($ci) $ci.value = '';
          _updatePinDots('pin-confirm-dots', 0);
          _clearPinError('pin-confirm-error');

          _showPinPanel('pin-confirm-panel');

          setTimeout(function () {
            document.getElementById('pin-confirm-input')?.focus();
            _setPending = false; // 다음 입력을 위해 상태 초기화
          }, 420);
        }, 260);
      }
    });
  }

  /* ── PIN confirm input handler (누락되었던 코드 추가) ──────────────────────────────── */

  const $pinConfirmInput = document.getElementById('pin-confirm-input');
  let _confirmSubmitPending = false;

  if ($pinConfirmInput) {
    $pinConfirmInput.addEventListener('input', function () {
      $pinConfirmInput.value = $pinConfirmInput.value.replace(/\D/g, '').slice(0, 4);
      _updatePinDots('pin-confirm-dots', $pinConfirmInput.value.length);
      _clearPinError('pin-confirm-error');

      if ($pinConfirmInput.value.length === 4 && !_confirmSubmitPending) {
        _confirmSubmitPending = true;

        setTimeout(function () {
          // 앞에서 저장한 첫 번째 PIN과 일치하는지 확인
          if ($pinConfirmInput.value === _pinState.firstPin) {
            console.log('[sori-flow] 🔒 PIN matched, submitting to backend');
            _submitPinToBackend($pinConfirmInput.value);
          } else {
            // 불일치 시 에러 표시 및 애니메이션
            const $err = document.getElementById('pin-confirm-error');
            if ($err) $err.textContent = 'PIN does not match · 번호가 일치하지 않아요';
            _shakeDots('pin-confirm-dots');

            // 입력창 초기화
            $pinConfirmInput.value = '';
            _updatePinDots('pin-confirm-dots', 0);
          }
          _confirmSubmitPending = false;
        }, 260);
      }
    });
  }

  /* ── Archive PIN verify input handler ──────────────────────────────────── */
  /*
   * Handles the #archive-verify-input on step-archive.
   * Must call /api/user/verify-pin — NOT /api/user/setup-pin.
   * A pending-guard prevents multiple submissions if the user
   * types past 4 digits while the request is in-flight.
   */

  const $archiveVerifyInput = document.getElementById('archive-verify-input');
  if ($archiveVerifyInput) {
    let _archiveVerifyPending = false;

    $archiveVerifyInput.addEventListener('input', function () {
      $archiveVerifyInput.value = $archiveVerifyInput.value.replace(/\D/g, '').slice(0, 4);
      _updatePinDots('archive-verify-dots', $archiveVerifyInput.value.length);

      const $verifyErr = document.getElementById('archive-verify-error');
      if ($verifyErr) $verifyErr.textContent = '';

      if ($archiveVerifyInput.value.length === 4 && !_archiveVerifyPending) {
        _archiveVerifyPending = true;
        const enteredPin = $archiveVerifyInput.value;

        setTimeout(async function () {
          try {
            const res = await fetch(`${API_BASE}/api/user/verify-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: enteredPin }),
              credentials: 'include',
            });

            if (res.ok) {
              // Auth succeeded — hide the PIN gate, load entries
              const $authArea = document.getElementById('archive-auth-area');
              if ($authArea) $authArea.style.display = 'none';

              if (window.soriArchive && typeof window.soriArchive.fetchEntries === 'function') {
                await window.soriArchive.fetchEntries(enteredPin);
              }

              const $archiveContent = document.getElementById('archive-content');
              if ($archiveContent) $archiveContent.style.display = '';

            } else {
              // Auth failed — show error, shake dots, reset input
              if ($verifyErr) {
                $verifyErr.textContent = res.status === 401
                  ? 'Incorrect PIN · 잘못된 PIN이에요'
                  : 'Verification failed · 확인 실패';
              }
              _shakeDots('archive-verify-dots');
              $archiveVerifyInput.value = '';
              _updatePinDots('archive-verify-dots', 0);
            }

          } catch (err) {
            console.warn('[sori-flow] ⚠️ Archive PIN verify error:', err);
          } finally {
            _archiveVerifyPending = false;
          }
        }, 260);
      }
    });
  }
  /* ── Back buttons — handled by event delegation above ───────────────────── */
  /* (pin-set-back and pin-confirm-back click handlers are in the delegated
      document.addEventListener('click') block registered with _showPinPanel) */


  /* ── Success panel CTAs ─────────────────────────────────────────────────── */

  const $pinSuccessArchive = document.getElementById('pin-success-archive-cta');
  if ($pinSuccessArchive) {
    $pinSuccessArchive.addEventListener('click', function () {
      goToStep('step-archive');
    });
  }

  const $pinSuccessHome = document.getElementById('pin-success-home-cta');
  if ($pinSuccessHome) {
    $pinSuccessHome.addEventListener('click', function () {
      resetToGateway();
    });
  }


  /**
   * _submitPinToBackend(pin)
   * PIN 확인 후 서버에 저장하고 아카이브 데이터를 동기화합니다.
   */
  async function _submitPinToBackend(pin) {
    console.log('[sori-flow] 🔒 PIN confirmation & saving started');
    // 🌟 [핵심 수정] 서버 응답을 기다리지 않고, PIN이 일치하면 무조건 즉시 성공 화면으로 넘깁니다! (멈춤 현상 완벽 방지)
    _showPinPanel('pin-success-panel');
    try {
      // 1. PIN 강제 업데이트 (403 방지)
      await fetch(`${API_BASE}/api/user/setup-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, force: true }),
        credentials: 'include',
      });

      // 2. [핵심 수정] 무조건 화면에 생성된 '가장 마지막(최신)' 카드에서만 데이터를 가져옵니다.
      const journalCards = Array.from(document.querySelectorAll('.sori-journal-card'));
      const activeCard = journalCards.length > 0 ? journalCards[journalCards.length - 1] : document;

      const emotionEl = activeCard.querySelector('.sori-journal-card__emotion-en') || document.getElementById('journal-card-emotion');
      const narrativeEl = activeCard.querySelector('.sori-journal-card__body-text') || document.getElementById('journal-card-body');

      // ─── [가장 강력한 음성 기록(Transcript) 추출 로직] ───
      let finalTranscript = '... (No words spoken)';
      const transcriptContainer = activeCard.querySelector('.sori-journal-card__transcript') || document.getElementById('journal-card-transcript');

      if (transcriptContainer) {
        // 실제 텍스트가 들어있는 클래스를 정확히 짚어냅니다.
        const textEl = transcriptContainer.querySelector('.sori-journal-card__transcript-text');
        if (textEl) {
          finalTranscript = textEl.textContent;
        } else {
          const pTags = transcriptContainer.querySelectorAll('p');
          finalTranscript = pTags.length > 0 ? pTags[pTags.length - 1].textContent : transcriptContainer.textContent;
        }
      }

      // 불필요한 라벨('당신의 말', 'YOUR WORDS' 등) 제거
      finalTranscript = finalTranscript.replace(/YOUR WORDS|Your Voice|당신의 말/gi, '').trim().replace(/^“|”$|^"|"$/g, '');
      if (!finalTranscript) finalTranscript = '... (No words spoken)';
      // ───────────────────────────────────────────────────

      const insightSections = Array.from(document.querySelectorAll('.insight-section'));
      const activeInsight = insightSections.length > 0 ? insightSections[insightSections.length - 1] : document;

      const quoteEnEl = activeInsight.querySelector('#insight-quote-en') || document.getElementById('insight-quote-en');
      const quoteKoEl = activeInsight.querySelector('#insight-quote-ko') || document.getElementById('insight-quote-ko');
      const quoteSourceEl = activeInsight.querySelector('#insight-quote-source') || document.getElementById('insight-quote-source');

      const payload = {
        pin: pin,
        emotion: emotionEl ? emotionEl.textContent.trim() : 'Calm',
        narrative: narrativeEl ? narrativeEl.textContent.trim() : 'A quiet moment.',
        transcript: finalTranscript, // 정제된 실제 대사 삽입
        quote: {
          en: quoteEnEl ? quoteEnEl.textContent.trim().replace(/^”|”$|^”|”$/g, '') : '',
          ko: quoteKoEl ? quoteKoEl.textContent.trim().replace(/^”|”$|^”|”$/g, '') : '',
          source: quoteSourceEl ? quoteSourceEl.textContent.trim().replace(/^—\s*/, '') : ''
        },
        // emotionTemperature is null when the card path was used (GPT picks emotion from audio);
        // it carries the 0–100 slider value when the temperature path was used.
        emotionTemperature: _selectedEmotionTemperature,
      };

      // 3. 기록 DB 저장 호출
      const entryRes = await fetch(`${API_BASE}/api/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      if (entryRes.ok) {
        console.log('[sori-flow] ✅ Journal entry persisted to server with Transcript:', finalTranscript);
        _showPinPanel('pin-success-panel');

        // 4. 아카이브 모듈 데이터 동기화
        if (window.soriArchive && typeof window.soriArchive.fetchEntries === 'function') {
          await window.soriArchive.fetchEntries(pin);
          if (typeof window.soriArchive.renderCalendar === 'function') {
            window.soriArchive.renderCalendar();
          }

        }
      }
    } catch (err) {
      console.warn('[sori-flow] ⚠️ Entry persistence process failed:', err);
    }
  }
  console.log('[sori-flow] ✅ Task 1 (logo reset) + Task 2 (PIN calendar) wired');

  // ─────────────────────────────────────────────────────────────────────────
  //  PUBLIC API  (v8 — adds resetToGateway, buildPinCalendar, showPinPanel)
  // ─────────────────────────────────────────────────────────────────────────
  /* ── 뒤로 가기 버튼 이벤트 와이어링 ────────────────────────────────────────── */
  const $btnBackExpr = document.getElementById('btn-back-expr');
  if ($btnBackExpr) {
    $btnBackExpr.addEventListener('click', () => goToStep('step-gateway'));
  }

  const $btnBackVoice = document.getElementById('btn-back-voice');
  if ($btnBackVoice) {
    $btnBackVoice.addEventListener('click', () => {
      if (window.soriVoice && typeof window.soriVoice.cleanup === 'function') {
        window.soriVoice.cleanup();
      }
      goToStep('step-expression');
    });
  }

  const $btnBackArchive = document.getElementById('btn-back-archive');
  if ($btnBackArchive) {
    $btnBackArchive.addEventListener('click', () => resetToGateway());
  }
  window.soriFlow = Object.freeze({
    get selectedEmotion() { return _selectedEmotion; },
    get selectedEmotionTemperature() { return _selectedEmotionTemperature; },
    goToStep: goToStep,
    populateInsight: populateInsight,
    getEmotionMeta: getEmotionMeta,
    patchDateEl: _patchDateEl,
    patchEmotionKo: _patchEmotionKoEl,
    setScrollLock: _setScrollLock,
    resetToGateway: resetToGateway,        // ← v8: logo home-reset
    buildPinCalendar: _buildPinCalendar,     // ← v8: external calendar trigger
    showPinPanel: _showPinPanel,         // ← v8: panel switcher
  });

  console.log('[sori-flow] ✅ window.soriFlow v8 API registered: { selectedEmotion, goToStep, populateInsight, getEmotionMeta, patchDateEl, patchEmotionKo, setScrollLock, resetToGateway, buildPinCalendar, showPinPanel }');


  // ─────────────────────────────────────────────────────────────────────────
  //  INIT — reveal gateway step's .fade-in-up nodes immediately
  // ─────────────────────────────────────────────────────────────────────────

  function _initGateway() {
    // Ensure the landing screen always starts scroll-locked
    _setScrollLock(true);

    const gateway = document.getElementById('step-gateway');
    if (gateway) {
      _triggerStepReveal(gateway);
      console.log('[sori-flow] 🌅 Gateway step reveal triggered');
    } else {
      console.warn('[sori-flow] ⚠️  #step-gateway not found during init');
    }

    // Install journal card patcher (Tasks 3 & 5)
    _installJournalPatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initGateway);
  } else {
    _initGateway();
  }
})();
