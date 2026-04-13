/**
 * ============================================================
 *  SORI · 소리  —  sori-updates.js  v1
 *  User Interview Patch — April 2026
 * ============================================================
 *
 *  This file adds five new capabilities WITHOUT touching the
 *  existing boot sequence in sori-flow.js or sori-voice.js:
 *
 *  1. Analyzing... cycling text  (startAnalyzingCycle / stopAnalyzingCycle)
 *  2. Hero emotion interstitial  (showHeroEmotion)
 *  3. Emotion Temperature Slider (bootstrapped on DOMContentLoaded)
 *  4. Progressive Wellbeing flow (injected into step-archive when unlocked)
 *  5. Conditional counseling link (rendered only on persistently negative trend)
 *
 *  Public API — window.soriUpdates:
 *    startAnalyzingCycle()
 *    stopAnalyzingCycle()
 *    showHeroEmotion(data, onDone)
 *    renderWellbeingSection(entries)   ← called by sori-archive.js on unlock
 * ============================================================
 */

(function () {
  'use strict';

  console.log('[sori-updates] ✅ v1 loaded');

  // ─────────────────────────────────────────────────────────────────────────
  //  CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────

  const HERO_HOLD_MS    = 1800;   // how long the hero emotion is visible
  const HERO_FADE_MS    = 500;    // fade-in / fade-out duration
  const CYCLE_INTERVAL  = 2600;   // ms between cycling messages

  // Negative emotion keys (must mirror the 4 negative keys in EMOTION_MAP / server.js VALID_EMOTIONS)
  const NEGATIVE_EMOTIONS = new Set(['Sad', 'Angry', 'Anxious', 'Exhausted']);

  // Number of entries required before the wellbeing section appears
  const WELLBEING_MIN_ENTRIES = 5;

  // Threshold: if ≥ this fraction of recent entries are negative, show link
  const NEGATIVE_THRESHOLD = 0.6;

  // How many recent entries to sample for the trend
  const TREND_WINDOW = 14;

  // Mental health checklist items (bilingual)
  const CHECKLIST_ITEMS = [
    { en: 'Over the past two weeks, have you felt persistently low or hopeless?',      ko: '지난 2주간 지속적으로 기분이 가라앉거나 희망이 없게 느껴지셨나요?' },
    { en: 'Have you had significantly less interest or pleasure in activities you used to enjoy?', ko: '평소 즐기던 활동에 대한 관심이나 즐거움이 현저히 줄었나요?' },
    { en: 'Have you been feeling unusually tired or having difficulty sleeping?',        ko: '평소보다 극심한 피로감을 느끼거나 수면에 어려움을 겪고 있나요?' },
    { en: 'Have you found it hard to concentrate, even on simple things?',               ko: '간단한 일에도 집중하기 어려웠나요?' },
    { en: 'Have you been experiencing anxious or racing thoughts that feel hard to stop?', ko: '멈추기 어려운 불안하거나 빠른 생각들을 경험하셨나요?' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  //  1.  ANALYZING... CYCLING TEXT
  // ─────────────────────────────────────────────────────────────────────────

  const ANALYZE_MESSAGES = [
    { en: 'Listening…',               ko: '듣고 있어요…' },
    { en: 'Reading the shape of your words…', ko: '말의 형태를 읽는 중이에요…' },
    { en: 'Finding the feeling beneath…',     ko: '그 안의 감정을 찾고 있어요…' },
    { en: 'Holding what you shared…',         ko: '나눈 것들을 담고 있어요…' },
    { en: 'Almost there…',                    ko: '거의 다 됐어요…' },
  ];

  let _cycleTimer   = null;
  let _cycleIndex   = 0;

  function startAnalyzingCycle() {
    _cycleIndex = 0;
    _setCycleMessage(_cycleIndex);
    _cycleTimer = setInterval(function () {
      _cycleIndex = (_cycleIndex + 1) % ANALYZE_MESSAGES.length;
      _setCycleMessage(_cycleIndex);
    }, CYCLE_INTERVAL);
    console.log('[sori-updates] 🔄 Analyzing cycle started');
  }

  function stopAnalyzingCycle() {
    clearInterval(_cycleTimer);
    _cycleTimer = null;
    _resetCycleMessage();
    console.log('[sori-updates] ⏹ Analyzing cycle stopped');
  }

  function _setCycleMessage(idx) {
    const msg     = ANALYZE_MESSAGES[idx];
    const heading = document.getElementById('analysis-heading');
    const subKo   = document.getElementById('analysis-heading-ko');
    if (heading) heading.textContent = msg.en;
    if (subKo)   subKo.textContent   = msg.ko;
  }

  function _resetCycleMessage() {
    const heading = document.getElementById('analysis-heading');
    const subKo   = document.getElementById('analysis-heading-ko');
    if (heading) heading.textContent = 'Sori is listening and reflecting…';
    if (subKo)   subKo.textContent   = '소리가 듣고 반영 중이에요…';
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  2.  HERO EMOTION INTERSTITIAL
  //
  //  After the API resolves, we briefly show the primary emotion as a large
  //  "hero" keyword on the analysis step before fading through to the journal.
  //  This gives users an MBTI-style "reveal" moment — clear, singular, calm.
  // ─────────────────────────────────────────────────────────────────────────

  function showHeroEmotion(data, onDone) {
    const emotion   = (data && data.emotion) || '';
    const meta      = (window.soriFlow && window.soriFlow.getEmotionMeta)
                        ? window.soriFlow.getEmotionMeta(emotion)
                        : { emoji: '🌿', ko: emotion };

    const loadingEl = document.getElementById('analysis-loading');
    const resultEl  = document.getElementById('analysis-result');

    // ── Hide the loading dots ─────────────────────────────────────────────
    if (loadingEl) {
      loadingEl.style.transition = 'opacity 400ms ease';
      loadingEl.style.opacity = '0';
      setTimeout(function () {
        loadingEl.classList.add('is-hidden');
        loadingEl.style.opacity = '';
        loadingEl.style.transition = '';
      }, 420);
    }

    // ── Build and show the hero overlay ──────────────────────────────────
    const hero = document.createElement('div');
    hero.id        = 'sori-hero-emotion';
    hero.className = 'sori-hero-emotion';
    hero.setAttribute('aria-live', 'polite');
    hero.setAttribute('aria-atomic', 'true');
    hero.innerHTML =
      '<span class="sori-hero-emotion__emoji" aria-hidden="true">' + meta.emoji + '</span>' +
      '<h2 class="sori-hero-emotion__keyword">' + emotion + '</h2>' +
      '<p class="sori-hero-emotion__ko" lang="ko">' + meta.ko + '</p>' +
      '<p class="sori-hero-emotion__hint">Sori heard you &nbsp;·&nbsp; <span lang="ko">소리가 들었어요</span></p>';

    const analysisContainer = document.querySelector('#step-analysis .sori-container');
    if (analysisContainer) {
      analysisContainer.appendChild(hero);
    } else {
      document.body.appendChild(hero);
    }

    // Fade-in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        hero.classList.add('sori-hero-emotion--visible');
      });
    });

    // Hold → fade-out → trigger onDone
    setTimeout(function () {
      hero.classList.add('sori-hero-emotion--out');
      setTimeout(function () {
        hero.remove();
        if (typeof onDone === 'function') onDone();
      }, HERO_FADE_MS);
    }, HERO_HOLD_MS);

    // Populate the static analysis-result chip (kept for a11y)
    const chip = document.getElementById('analysis-emotion-chip');
    if (chip) chip.textContent = meta.emoji + '  ' + emotion;

    console.log('[sori-updates] 🌟 Hero emotion shown:', emotion);
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  3.  EMOTION TEMPERATURE SLIDER
  //
  //  An alternative to the 8-card grid. A toggle above the grid switches
  //  between "Card" mode and "Slider" mode. The slider maps a continuous
  //  0–100 value to one of 8 emotion keys (matching the existing cards).
  //  On confirmation, it fires the same 'sori:emotion-selected' event that
  //  card clicks fire, so the rest of the flow is unchanged.
  // ─────────────────────────────────────────────────────────────────────────

  // Emotion temperature segments — 12 segments across 0–100
  // Ordered from lowest energy / most difficult (0) to highest energy / most positive (100).
  // Each segment is ~8 units wide; slight variation keeps segment boundaries intuitive.
  const TEMP_SEGMENTS = [
    { key: 'Exhausted',    min: 0,   max: 8,   label: { en: 'Exhausted',    ko: '지침' },   tone: 'cool'    },
    { key: 'Sad',          min: 9,   max: 16,  label: { en: 'Sad',          ko: '슬픔' },   tone: 'cool'    },
    { key: 'Angry',        min: 17,  max: 24,  label: { en: 'Angry',        ko: '화남' },   tone: 'cool'    },
    { key: 'Anxious',      min: 25,  max: 33,  label: { en: 'Anxious',      ko: '불안' },   tone: 'cool'    },
    { key: 'Ambivalent',   min: 34,  max: 41,  label: { en: 'Ambivalent',   ko: '애매' },   tone: 'neutral' },
    { key: 'Nostalgic',    min: 42,  max: 49,  label: { en: 'Nostalgic',    ko: '그리움' }, tone: 'neutral' },
    { key: 'Calm',         min: 50,  max: 57,  label: { en: 'Calm',         ko: '평온' },   tone: 'warm'    },
    { key: 'Relieved',     min: 58,  max: 66,  label: { en: 'Relieved',     ko: '해방' },   tone: 'warm'    },
    { key: 'Happy',        min: 67,  max: 74,  label: { en: 'Happy',        ko: '행복' },   tone: 'warm'    },
    { key: 'Grateful',     min: 75,  max: 82,  label: { en: 'Grateful',     ko: '감사' },   tone: 'warm'    },
    { key: 'Excited',      min: 83,  max: 91,  label: { en: 'Excited',      ko: '설렘' },   tone: 'warm'    },
    { key: 'Accomplished', min: 92,  max: 100, label: { en: 'Accomplished', ko: '성취' },   tone: 'warm'    },
  ];

  function _tempToSegment(value) {
    const v = Math.round(value);
    for (const seg of TEMP_SEGMENTS) {
      if (v >= seg.min && v <= seg.max) return seg;
    }
    return TEMP_SEGMENTS[TEMP_SEGMENTS.length - 1];
  }

  function _bootstrapSlider() {
    const expressionSection = document.getElementById('step-expression');
    if (!expressionSection) return;

    // ── Build the mode-toggle ─────────────────────────────────────────────
    const toggle = document.createElement('div');
    toggle.className = 'emotion-input-toggle fade-in-up delay-1';
    toggle.setAttribute('role', 'tablist');
    toggle.setAttribute('aria-label', 'Emotion input method');

    const btnCard = document.createElement('button');
    btnCard.type = 'button';
    btnCard.className = 'emotion-toggle-btn emotion-toggle-btn--active';
    btnCard.setAttribute('role', 'tab');
    btnCard.setAttribute('aria-selected', 'true');
    btnCard.setAttribute('aria-controls', 'emotion-card-panel');
    btnCard.id = 'tab-cards';
    btnCard.innerHTML = 'Cards &nbsp;·&nbsp; <span lang="ko">카드</span>';

    const btnSlider = document.createElement('button');
    btnSlider.type = 'button';
    btnSlider.className = 'emotion-toggle-btn';
    btnSlider.setAttribute('role', 'tab');
    btnSlider.setAttribute('aria-selected', 'false');
    btnSlider.setAttribute('aria-controls', 'emotion-slider-panel');
    btnSlider.id = 'tab-slider';
    btnSlider.innerHTML = 'Temperature &nbsp;·&nbsp; <span lang="ko">온도계</span>';

    toggle.appendChild(btnCard);
    toggle.appendChild(btnSlider);

    // ── Build the slider panel ────────────────────────────────────────────
    const sliderPanel = document.createElement('div');
    sliderPanel.id = 'emotion-slider-panel';
    sliderPanel.className = 'emotion-slider-panel';
    sliderPanel.setAttribute('role', 'tabpanel');
    sliderPanel.setAttribute('aria-labelledby', 'tab-slider');
    sliderPanel.setAttribute('hidden', '');

    sliderPanel.innerHTML = [
      '<p class="emotion-slider__prompt type-caption">',
      '  Drag to where you are today',
      '  &nbsp;·&nbsp; <span lang="ko">오늘 기분의 온도를 맞춰보세요</span>',
      '</p>',
      '<div class="emotion-slider__track-wrapper" aria-hidden="true">',
      '  <div class="emotion-slider__gradient-track"></div>',
      '</div>',
      '<input',
      '  type="range"',
      '  id="emotion-temp-input"',
      '  class="emotion-slider__range"',
      '  min="0" max="100" value="50"',
      '  step="1"',
      '  aria-label="Emotion temperature — 감정 온도"',
      '  aria-valuetext="Meh · 그저그런"',
      '/>',
      '<div class="emotion-slider__labels" aria-hidden="true">',
      '  <span class="emotion-slider__label-start">Heavy &nbsp;·&nbsp; <span lang="ko">무거운</span></span>',
      '  <span class="emotion-slider__label-end">Light &nbsp;·&nbsp; <span lang="ko">가벼운</span></span>',
      '</div>',
      '<div class="emotion-slider__readout" id="emotion-temp-readout" aria-live="polite" aria-atomic="true">',
      '  <span class="emotion-slider__readout-emoji" id="temp-readout-emoji">·</span>',
      '  <span class="emotion-slider__readout-label" id="temp-readout-label">Meh</span>',
      '  <span class="emotion-slider__readout-ko" id="temp-readout-ko" lang="ko">그저그런</span>',
      '</div>',
      '<button type="button" class="voice-record-btn emotion-slider__confirm" id="emotion-temp-confirm">',
      '  → &nbsp; This feels right &nbsp;·&nbsp; <span lang="ko">이게 맞아요</span>',
      '</button>',
    ].join('\n');

    // ── Wrap the existing card grid in a panel div ────────────────────────
    const cardContainer = expressionSection.querySelector('.emotion-card-container');
    const hrEl          = expressionSection.querySelector('.sori-rule.fade-in-up');

    if (!cardContainer) {
      console.warn('[sori-updates] ⚠️  .emotion-card-container not found — slider not injected');
      return;
    }

    // Wrap card grid
    const cardPanel = document.createElement('div');
    cardPanel.id = 'emotion-card-panel';
    cardPanel.setAttribute('role', 'tabpanel');
    cardPanel.setAttribute('aria-labelledby', 'tab-cards');
    cardContainer.parentNode.insertBefore(cardPanel, cardContainer);
    cardPanel.appendChild(cardContainer);

    // Insert toggle BEFORE the hr rule (or before cardPanel if no hr)
    const insertBefore = hrEl || cardPanel;
    insertBefore.parentNode.insertBefore(toggle, insertBefore);

    // Insert slider panel AFTER card panel
    cardPanel.insertAdjacentElement('afterend', sliderPanel);

    // ── Slider interaction ────────────────────────────────────────────────
    const rangeInput = sliderPanel.querySelector('#emotion-temp-input');
    const emojiEl    = sliderPanel.querySelector('#temp-readout-emoji');
    const labelEl    = sliderPanel.querySelector('#temp-readout-label');
    const koEl       = sliderPanel.querySelector('#temp-readout-ko');
    const readoutEl  = sliderPanel.querySelector('#emotion-temp-readout');
    const confirmBtn = sliderPanel.querySelector('#emotion-temp-confirm');

    let _currentTempSeg = _tempToSegment(50);

    function _updateReadout(value) {
      const seg  = _tempToSegment(value);
      const meta = (window.soriFlow && window.soriFlow.getEmotionMeta)
                     ? window.soriFlow.getEmotionMeta(seg.key)
                     : { emoji: '·', ko: seg.label.ko };
      _currentTempSeg = seg;
      if (emojiEl) emojiEl.textContent = meta.emoji;
      if (labelEl) labelEl.textContent = seg.label.en;
      if (koEl)    koEl.textContent    = seg.label.ko;

      // Update ARIA value text for screen readers
      if (rangeInput) rangeInput.setAttribute('aria-valuetext', seg.label.en + ' · ' + seg.label.ko);

      // Toggle tone class for gradient tint
      if (readoutEl) {
        readoutEl.classList.remove('tone-cool', 'tone-neutral', 'tone-warm');
        readoutEl.classList.add('tone-' + seg.tone);
      }

      // Update CSS custom property so the gradient thumb tints correctly
      if (rangeInput) {
        rangeInput.style.setProperty('--thumb-pct', value + '%');
      }
    }

    _updateReadout(50);

    rangeInput?.addEventListener('input', function () {
      _updateReadout(parseInt(this.value, 10));
    });

    confirmBtn?.addEventListener('click', function () {
      const seg     = _currentTempSeg;
      const emotion = seg.key;

      // Dispatch the same CustomEvent that card clicks dispatch so any
      // listener in sori-flow.js or sori-resonance.js reacts identically.
      // Also carry emotionTemperature so sori-flow.js can persist it with the entry.
      const temperatureValue = parseInt(rangeInput ? rangeInput.value : '50', 10);
      window.dispatchEvent(new CustomEvent('sori:emotion-selected', {
        detail: { emotion: emotion, emotionTemperature: temperatureValue },
        bubbles: false,
      }));

      // Also call soriResonance state setter if available (3D sphere colour)
      window.soriResonance?.setEmotionState?.(emotion);

      // Mark the matching card as active (visual parity — may not find a match
      // for slider-only emotions like 'Sadness', and that is fine)
      document.querySelectorAll('.emotion-card').forEach(function (c) {
        c.classList.toggle('emotion-card--active', c.dataset.emotion === emotion);
        c.setAttribute('aria-selected', c.dataset.emotion === emotion ? 'true' : 'false');
      });

      // Pulse animation on confirm button
      confirmBtn.classList.add('is-confirming');
      setTimeout(function () {
        confirmBtn.classList.remove('is-confirming');
        // Navigate directly — sori-flow.js's card handler does the same.
        // goToStep is safe to call redundantly if the event already fired it.
        if (window.soriFlow && typeof window.soriFlow.goToStep === 'function') {
          window.soriFlow.goToStep('step-voice-record');
        }
      }, 280);
    });

    // ── Tab toggle logic ──────────────────────────────────────────────────
    function _showPanel(mode) {
      // mode: 'cards' | 'slider'
      const isCards = mode === 'cards';

      btnCard.classList.toggle('emotion-toggle-btn--active', isCards);
      btnCard.setAttribute('aria-selected', isCards ? 'true' : 'false');
      btnSlider.classList.toggle('emotion-toggle-btn--active', !isCards);
      btnSlider.setAttribute('aria-selected', !isCards ? 'true' : 'false');

      if (isCards) {
        cardPanel.removeAttribute('hidden');
        sliderPanel.setAttribute('hidden', '');
      } else {
        cardPanel.setAttribute('hidden', '');
        sliderPanel.removeAttribute('hidden');
        // Focus the range input when switching to slider mode
        setTimeout(function () { rangeInput?.focus(); }, 60);
      }
    }

    btnCard.addEventListener('click',   function () { _showPanel('cards');  });
    btnSlider.addEventListener('click', function () { _showPanel('slider'); });

    console.log('[sori-updates] 🌡️  Emotion temperature slider injected');
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  4 & 5.  PROGRESSIVE WELLBEING FLOW
  //
  //  Called by sori-archive.js after the archive unlocks.
  //  Injects below the calendar:
  //    a. 2-month emotion heatmap using archive entries
  //    b. Mental health checklist (5 items, Yes/No)
  //    c. Conditional counseling resources link — shown only when:
  //         • checklist is completed AND
  //         • ≥ 60% of the last 14 entries are in NEGATIVE_EMOTIONS
  //         OR
  //         • ≥ 3 of 5 checklist items answered "Yes"
  // ─────────────────────────────────────────────────────────────────────────

  function renderWellbeingSection(entries) {
    if (!entries || !Array.isArray(entries)) return;

    // Remove any previously injected section (e.g., on re-unlock)
    const old = document.getElementById('sori-wellbeing-section');
    if (old) old.remove();

    if (entries.length < WELLBEING_MIN_ENTRIES) return; // Not enough data yet

    const archiveContent = document.getElementById('archive-content');
    if (!archiveContent) return;

    const section = document.createElement('section');
    section.id = 'sori-wellbeing-section';
    section.className = 'wellbeing-section fade-in-up';
    section.setAttribute('aria-labelledby', 'wellbeing-heading');

    // ── a. Emotion Heatmap (last 8 weeks, colour-coded) ──────────────────
    const heatmapHTML = _buildHeatmapHTML(entries);

    // ── b. Mental health checklist ────────────────────────────────────────
    const checklistHTML = _buildChecklistHTML();

    section.innerHTML = [
      '<hr class="sori-rule" style="margin: var(--sori-x-8) 0; opacity: 0.2;" aria-hidden="true" />',
      '<h2 class="type-caption text-deep" id="wellbeing-heading" style="font-size:clamp(11px,1vw,13px); letter-spacing:0.12em; text-transform:uppercase; margin-bottom:var(--sori-x-3);">',
      '  Emotional Overview &nbsp;·&nbsp; <span lang="ko">감정 흐름</span>',
      '</h2>',
      '<p class="type-micro text-ghost" style="margin-bottom:var(--sori-x-4); line-height:1.6;">',
      '  A quiet look at your last two months',
      '  &nbsp;·&nbsp; <span lang="ko">지난 두 달의 조용한 기록</span>',
      '</p>',
      heatmapHTML,
      '<div class="wellbeing-heatmap-legend" aria-hidden="true">',
      '  <span class="legend-dot legend-dot--positive"></span><span class="type-micro text-ghost">Positive</span>',
      '  <span class="legend-dot legend-dot--neutral"></span><span class="type-micro text-ghost">Neutral</span>',
      '  <span class="legend-dot legend-dot--negative"></span><span class="type-micro text-ghost">Difficult</span>',
      '  <span class="legend-dot legend-dot--none"></span><span class="type-micro text-ghost">No entry</span>',
      '</div>',
      checklistHTML,
      '<div id="counseling-resources" hidden></div>',
    ].join('\n');

    archiveContent.appendChild(section);

    // ── Wire up checklist logic ───────────────────────────────────────────
    _wireChecklist(section, entries);

    console.log('[sori-updates] 🌱 Wellbeing section rendered with', entries.length, 'entries');
  }

  function _buildHeatmapHTML(entries) {
    // Build a map: localKey → sentiment
    const sentimentMap = {};
    entries.forEach(function (e) {
      const key = e.localKey || _getLocalISO(e.date || new Date());
      const sentiment = NEGATIVE_EMOTIONS.has(e.emotion) ? 'negative'
        : (e.emotion === 'meh' || e.emotion === 'numb') ? 'neutral'
        : 'positive';
      // If multiple entries on same day, take the most recent (entries are sorted desc by date)
      if (!sentimentMap[key]) sentimentMap[key] = sentiment;
    });

    // Generate last 56 days (8 weeks)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 55; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key       = _getLocalISO(d);
      const sentiment = sentimentMap[key] || 'none';
      const dayNum    = d.getDate();
      const isSunday  = d.getDay() === 0;
      days.push({ key, sentiment, dayNum, isSunday, date: d });
    }

    // Pad the start to align first day with its weekday column
    const firstDay = days[0].date.getDay();
    const cellsHTML = [];

    // Day-of-week header
    ['S','M','T','W','T','F','S'].forEach(function (d) {
      cellsHTML.push('<div class="heatmap-dow-label">' + d + '</div>');
    });

    // Empty prefix cells
    for (let i = 0; i < firstDay; i++) {
      cellsHTML.push('<div class="heatmap-cell heatmap-cell--empty"></div>');
    }

    // Day cells
    days.forEach(function (day) {
      const label = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cellsHTML.push(
        '<div class="heatmap-cell heatmap-cell--' + day.sentiment + '"' +
        '  title="' + label + '"' +
        '  aria-label="' + label + ': ' + day.sentiment + '">' +
        '</div>'
      );
    });

    return '<div class="emotion-heatmap" role="img" aria-label="Emotion heatmap — last 8 weeks">' +
           cellsHTML.join('') +
           '</div>';
  }

  function _buildChecklistHTML() {
    const items = CHECKLIST_ITEMS.map(function (item, i) {
      return [
        '<li class="checklist-item" data-index="' + i + '">',
        '  <p class="checklist-item__question">',
        '    <span lang="en">' + item.en + '</span>',
        '    <span class="checklist-item__ko" lang="ko">' + item.ko + '</span>',
        '  </p>',
        '  <div class="checklist-item__answers" role="group" aria-label="Answer for question ' + (i + 1) + '">',
        '    <button type="button" class="checklist-answer-btn" data-value="yes" aria-pressed="false">',
        '      Yes &nbsp;·&nbsp; <span lang="ko">네</span>',
        '    </button>',
        '    <button type="button" class="checklist-answer-btn" data-value="no" aria-pressed="false">',
        '      No &nbsp;·&nbsp; <span lang="ko">아니요</span>',
        '    </button>',
        '  </div>',
        '</li>',
      ].join('\n');
    }).join('\n');

    return [
      '<div class="wellbeing-checklist" id="wellbeing-checklist">',
      '  <hr class="sori-rule" style="margin: var(--sori-x-6) 0; opacity: 0.15;" aria-hidden="true" />',
      '  <h3 class="type-caption text-deep" style="font-size:clamp(11px,1vw,13px); letter-spacing:0.12em; text-transform:uppercase; margin-bottom:var(--sori-x-2);">',
      '    A quiet check-in &nbsp;·&nbsp; <span lang="ko">조용한 점검</span>',
      '  </h3>',
      '  <p class="type-micro text-ghost" style="margin-bottom:var(--sori-x-4); line-height:1.6;">',
      '    These questions are for reflection only — not a clinical screening',
      '    &nbsp;·&nbsp; <span lang="ko">이 질문들은 임상 검사가 아닌, 스스로를 돌아보기 위한 것이에요</span>',
      '  </p>',
      '  <ol class="checklist-list" aria-label="Wellbeing check-in questions">',
      items,
      '  </ol>',
      '</div>',
    ].join('\n');
  }

  function _wireChecklist(section, entries) {
    const checklist = section.querySelector('#wellbeing-checklist');
    if (!checklist) return;

    const answers = {};   // {index: 'yes'|'no'}

    checklist.addEventListener('click', function (e) {
      const btn = e.target.closest('.checklist-answer-btn');
      if (!btn) return;

      const li    = btn.closest('.checklist-item');
      const idx   = parseInt(li.dataset.index, 10);
      const value = btn.dataset.value;

      // Toggle state
      const siblings = li.querySelectorAll('.checklist-answer-btn');
      siblings.forEach(function (b) {
        const isThis = b === btn;
        b.setAttribute('aria-pressed', isThis ? 'true' : 'false');
        b.classList.toggle('checklist-answer-btn--selected', isThis);
      });
      answers[idx] = value;

      // Check if all answered
      if (Object.keys(answers).length === CHECKLIST_ITEMS.length) {
        _evaluateAndRenderCounseling(section, entries, answers);
      }
    });
  }

  function _evaluateAndRenderCounseling(section, entries, answers) {
    const yesCount = Object.values(answers).filter(function (v) { return v === 'yes'; }).length;

    // Trend: fraction of last TREND_WINDOW entries that are negative
    const recent       = entries.slice(0, TREND_WINDOW);
    const negativeCount = recent.filter(function (e) { return NEGATIVE_EMOTIONS.has(e.emotion); }).length;
    const negativeFraction = recent.length > 0 ? negativeCount / recent.length : 0;

    const shouldShow = yesCount >= 3 || negativeFraction >= NEGATIVE_THRESHOLD;

    const counselingEl = section.querySelector('#counseling-resources');
    if (!counselingEl) return;

    if (shouldShow) {
      counselingEl.innerHTML = [
        '<div class="counseling-resources-card">',
        '  <hr class="sori-rule" style="margin: var(--sori-x-5) 0; opacity: 0.15;" aria-hidden="true" />',
        '  <span class="counseling-eyebrow">',
        '    A gentle nudge &nbsp;·&nbsp; <span lang="ko">작은 제안</span>',
        '  </span>',
        '  <p class="counseling-body">',
        '    Based on what you\'ve shared over time, it may help to speak with someone.',
        '    Sori is a space to be heard — a counsellor can be a space to be held.',
        '  </p>',
        '  <p class="counseling-body" lang="ko">',
        '    시간이 지나면서 나눈 것들을 바탕으로, 누군가와 직접 이야기를 나눠보는 게 도움이 될 수 있어요.',
        '    소리는 들을 수 있지만, 상담사는 함께 있어줄 수 있어요.',
        '  </p>',
        '  <div class="counseling-links">',
        '    <a href="https://www.imh.com.sg" target="_blank" rel="noopener noreferrer" class="counseling-link">',
        '      Institute of Mental Health (SG) &nbsp;·&nbsp;',
        '      <span class="counseling-link__meta">imh.com.sg</span>',
        '    </a>',
        '    <a href="tel:18002214444" class="counseling-link counseling-link--phone">',
        '      Samaritans of Singapore &nbsp;·&nbsp; 1800-221-4444',
        '    </a>',
        '  </div>',
        '  <p class="counseling-disclaimer type-micro text-ghost">',
        '    Sori is not a crisis service. If you are in immediate distress, please contact emergency services.',
        '    &nbsp;·&nbsp; <span lang="ko">소리는 위기 서비스가 아니에요. 즉각적인 위험 상황이라면 응급 서비스에 연락해주세요.</span>',
        '  </p>',
        '</div>',
      ].join('\n');
      counselingEl.removeAttribute('hidden');

      // Fade in
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          const card = counselingEl.querySelector('.counseling-resources-card');
          if (card) card.classList.add('counseling-resources-card--visible');
        });
      });
      console.log('[sori-updates] 💜 Counseling resources shown (yesCount:', yesCount, 'negFraction:', negativeFraction.toFixed(2) + ')');
    } else {
      counselingEl.setAttribute('hidden', '');
      console.log('[sori-updates] ✓ No counseling link needed (yesCount:', yesCount, 'negFraction:', negativeFraction.toFixed(2) + ')');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  UTILITY
  // ─────────────────────────────────────────────────────────────────────────

  function _getLocalISO(date) {
    const d      = new Date(date);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  BOOTSTRAP
  // ─────────────────────────────────────────────────────────────────────────

  function _init() {
    _bootstrapSlider();
    console.log('[sori-updates] 🚀 Bootstrap complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }


  // ─────────────────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  window.soriUpdates = Object.freeze({
    startAnalyzingCycle:    startAnalyzingCycle,
    stopAnalyzingCycle:     stopAnalyzingCycle,
    showHeroEmotion:        showHeroEmotion,
    renderWellbeingSection: renderWellbeingSection,
  });

})();
