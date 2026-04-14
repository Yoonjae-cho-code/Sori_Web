/**
 * ============================================================
 * SORI · 소리 — sori-risk-detector.js
 * ------------------------------------------------------------
 * Non-destructive STT risk-screening layer.
 *
 *   1. Reads every transcript via window.soriVoice hook.
 *   2. CRITICAL match  → halts archive + mounts EmergencyModal
 *                        (SAMH · Toll-free 1800-283-7019 /
 *                         Tel +65 6255 3222).
 *   3. FREQUENCY match → increments a rolling weekly counter
 *                        in localStorage. On count ≥ 4, mounts
 *                        the "Counseling Bridge" overlay.
 *
 * Design system:
 *   Deep Purple  #311F5D   (primary ink)
 *   Lucid Lilac  #DBC9E3   (supportive surface)
 *   Font         Pretendard
 *
 * Integration is entirely a wrapper — we do not alter any
 * existing function body in sori-voice.js. Instead we patch
 * window.fetch for the `/api/analyze` endpoint and surface a
 * lightweight API: `window.soriRiskDetector.evaluate(text)`.
 * ============================================================
 */

(function () {
  'use strict';

  console.log('[sori-risk-detector] ✅ loaded');

  // ── Design tokens ───────────────────────────────────────────
  const TOKENS = Object.freeze({
    DEEP_PURPLE : '#311F5D',
    LUCID_LILAC : '#DBC9E3',
    FONT        : "'Pretendard', 'Pretendard Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
  });

  // ── SAMH contact info ───────────────────────────────────────
  const SAMH = Object.freeze({
    name     : 'Singapore Association for Mental Health (SAMH)',
    tollFree : '1800-283-7019',
    tel      : '+65 6255 3222'
  });

  // ── Counter settings ────────────────────────────────────────
  const STORAGE_KEY    = 'sori.riskFrequencyCounter.v1';
  const BRIDGE_SHOWN   = 'sori.riskBridgeShown.v1';
  const BRIDGE_THRESH  = 4;
  const WINDOW_MS      = 7 * 24 * 60 * 60 * 1000; // rolling week

  /* ════════════════════════════════════════════════════════════
   *  STYLES
   * ════════════════════════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('sori-risk-styles')) return;
    const css = `
    /* ── Shared backdrop ─────────────────────────────────────── */
    .sori-risk-backdrop {
      position: fixed; inset: 0; z-index: 9999;
      background: radial-gradient(circle at 50% 40%,
                  rgba(49, 31, 93, 0.72) 0%,
                  rgba(49, 31, 93, 0.92) 100%);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      opacity: 0;
      transition: opacity 360ms cubic-bezier(.22,.61,.36,1);
      font-family: ${TOKENS.FONT};
    }
    .sori-risk-backdrop.is-open { opacity: 1; }

    /* ── Card base ───────────────────────────────────────────── */
    .sori-risk-card {
      width: min(460px, 100%);
      background: #FAF7FC;
      border-radius: 22px;
      padding: 32px 28px 26px;
      box-shadow: 0 24px 80px rgba(49, 31, 93, 0.28);
      transform: translateY(12px) scale(.98);
      opacity: 0;
      transition: transform 420ms cubic-bezier(.22,.61,.36,1),
                  opacity   420ms cubic-bezier(.22,.61,.36,1);
      color: ${TOKENS.DEEP_PURPLE};
      position: relative;
    }
    .sori-risk-backdrop.is-open .sori-risk-card {
      transform: translateY(0) scale(1); opacity: 1;
    }

    /* ── Eyebrow / title / body ──────────────────────────────── */
    .sori-risk-card__eyebrow {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 999px;
      background: ${TOKENS.LUCID_LILAC};
      color: ${TOKENS.DEEP_PURPLE};
      font-size: 11.5px; letter-spacing: .12em;
      text-transform: uppercase; font-weight: 600;
      margin-bottom: 18px;
    }
    .sori-risk-card__title {
      font-size: 22px; line-height: 1.35; font-weight: 700;
      margin: 0 0 6px; letter-spacing: -0.01em;
    }
    .sori-risk-card__title-ko {
      font-size: 15px; font-weight: 500;
      color: rgba(49, 31, 93, 0.72);
      margin: 0 0 18px;
    }
    .sori-risk-card__body {
      font-size: 15px; line-height: 1.65;
      color: rgba(49, 31, 93, 0.88);
      margin: 0 0 20px;
    }

    /* ── Contact block (Emergency) ───────────────────────────── */
    .sori-risk-contact {
      background: ${TOKENS.LUCID_LILAC};
      border-radius: 14px;
      padding: 16px 18px;
      margin-bottom: 22px;
    }
    .sori-risk-contact__label {
      font-size: 11.5px; letter-spacing: .1em;
      text-transform: uppercase;
      color: rgba(49, 31, 93, 0.66);
      margin: 0 0 6px;
    }
    .sori-risk-contact__name {
      font-size: 14px; font-weight: 600;
      margin: 0 0 10px; color: ${TOKENS.DEEP_PURPLE};
    }
    .sori-risk-contact__row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 0;
      border-top: 1px solid rgba(49, 31, 93, 0.12);
    }
    .sori-risk-contact__row:first-of-type { border-top: 0; }
    .sori-risk-contact__row-label {
      font-size: 13px; color: rgba(49, 31, 93, 0.72);
    }
    .sori-risk-contact__row-value {
      font-size: 15px; font-weight: 600;
      color: ${TOKENS.DEEP_PURPLE};
      text-decoration: none;
      letter-spacing: .02em;
    }
    .sori-risk-contact__row-value:hover { text-decoration: underline; }

    /* ── Buttons ─────────────────────────────────────────────── */
    .sori-risk-actions {
      display: flex; flex-direction: column; gap: 10px;
    }
    /* Single-button variant (e.g. Emergency modal after the primary
       call button was removed for exhibition safety). No stacking gap
       needed; pull up slightly so the ghost button hugs the contact
       block cleanly. */
    .sori-risk-actions--single { gap: 0; margin-top: 4px; }
    .sori-risk-btn {
      appearance: none; border: 0; cursor: pointer;
      font-family: inherit; font-size: 14.5px; font-weight: 600;
      padding: 13px 18px; border-radius: 12px;
      transition: transform 160ms ease, background 200ms ease,
                  box-shadow 200ms ease;
    }
    .sori-risk-btn--primary {
      background: ${TOKENS.DEEP_PURPLE};
      color: #FFFFFF !important;
      text-decoration: none;
      text-align: center;
      box-shadow: 0 6px 18px rgba(49,31,93,0.24);
    }
    .sori-risk-btn--primary, .sori-risk-btn--primary * { color: #FFFFFF !important; }
    .sori-risk-btn--primary:hover { transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(49,31,93,0.32); }
    .sori-risk-btn--ghost {
      background: transparent; color: ${TOKENS.DEEP_PURPLE};
      border: 1px solid rgba(49,31,93,0.18);
    }
    .sori-risk-btn--ghost:hover { background: rgba(219,201,227,0.32); }

    /* ── Breath dot (soft pulse) ─────────────────────────────── */
    .sori-risk-breath {
      width: 10px; height: 10px; border-radius: 50%;
      background: ${TOKENS.DEEP_PURPLE};
      display: inline-block; margin-right: 8px;
      animation: soriRiskBreath 2.4s ease-in-out infinite;
      vertical-align: middle;
    }
    @keyframes soriRiskBreath {
      0%, 100% { opacity: .35; transform: scale(.88); }
      50%      { opacity: 1;   transform: scale(1.15); }
    }

    /* ── Bridge variant tweaks ───────────────────────────────── */
    .sori-risk-card--bridge .sori-risk-card__eyebrow {
      background: rgba(219,201,227,0.6);
    }
    .sori-risk-card--bridge .sori-risk-card__body strong {
      color: ${TOKENS.DEEP_PURPLE};
    }
    `;
    const style = document.createElement('style');
    style.id = 'sori-risk-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════
   *  COUNTER (localStorage, rolling 7-day window)
   * ════════════════════════════════════════════════════════════ */
  function readCounter() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { events: [] };
      const parsed = JSON.parse(raw);
      const cutoff = Date.now() - WINDOW_MS;
      const events = Array.isArray(parsed.events)
        ? parsed.events.filter(function (e) { return typeof e === 'number' && e >= cutoff; })
        : [];
      return { events: events };
    } catch (e) { return { events: [] }; }
  }

  function writeCounter(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function incrementCounter() {
    const state = readCounter();
    state.events.push(Date.now());
    writeCounter(state);
    return state.events.length;
  }

  function resetCounter() {
    writeCounter({ events: [] });
    try { localStorage.removeItem(BRIDGE_SHOWN); } catch (e) {}
  }

  function bridgeAlreadyShownThisWeek() {
    try {
      const ts = parseInt(localStorage.getItem(BRIDGE_SHOWN) || '0', 10);
      return ts && (Date.now() - ts) < WINDOW_MS;
    } catch (e) { return false; }
  }

  function markBridgeShown() {
    try { localStorage.setItem(BRIDGE_SHOWN, String(Date.now())); } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   *  EMERGENCY MODAL
   * ════════════════════════════════════════════════════════════ */
  function mountEmergencyModal(triggerWord) {
    injectStyles();
    closeAll();

    const backdrop = document.createElement('div');
    backdrop.className = 'sori-risk-backdrop';
    backdrop.id = 'sori-emergency-modal';
    backdrop.setAttribute('role', 'alertdialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'sori-emergency-title');
    backdrop.setAttribute('aria-describedby', 'sori-emergency-body');
    backdrop.tabIndex = -1;

    backdrop.innerHTML = `
      <div class="sori-risk-card" role="document">
        <span class="sori-risk-card__eyebrow">
          <span class="sori-risk-breath" aria-hidden="true"></span>
          You are not alone &middot; 혼자가 아니에요
        </span>
        <h2 class="sori-risk-card__title" id="sori-emergency-title">
          We heard something heavy in your voice.
        </h2>
        <p class="sori-risk-card__title-ko" lang="ko">
          당신의 목소리에서 무거운 마음이 느껴졌어요.
        </p>
        <p class="sori-risk-card__body" id="sori-emergency-body">
          Please reach out — a kind, trained listener is ready for you, any hour.
          <br/><span lang="ko" style="opacity:.72">지금 이 순간 당신과 함께할 전문 상담사가 있어요.</span>
        </p>

        <div class="sori-risk-contact" aria-label="SAMH contact">
          <p class="sori-risk-contact__label">Call support · 지금 전화하기</p>
          <p class="sori-risk-contact__name">${SAMH.name}</p>
          <div class="sori-risk-contact__row">
            <span class="sori-risk-contact__row-label">Toll-free · 무료전화</span>
            <a class="sori-risk-contact__row-value" href="tel:18002837019">${SAMH.tollFree}</a>
          </div>
          <div class="sori-risk-contact__row">
            <span class="sori-risk-contact__row-label">Tel · 전화</span>
            <a class="sori-risk-contact__row-value" href="tel:+6562553222">${SAMH.tel}</a>
          </div>
        </div>

        <div class="sori-risk-actions sori-risk-actions--single">
          <button type="button" class="sori-risk-btn sori-risk-btn--ghost"
                  id="sori-emergency-close">
            I'm safe for now &middot; <span lang="ko">지금은 괜찮아요</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { backdrop.classList.add('is-open'); });
    });

    // Focus trap (soft) — primary call button was removed for exhibition
    // safety (no accidental tel: taps). The close button is now the sole
    // focus target and must ALSO resume the main app flow (it's the only
    // way out of step-analysis once we short-circuited onTranscriptReceived
    // — otherwise the app sits in "State Limbo").
    const closeBtn = backdrop.querySelector('#sori-emergency-close');
    closeBtn.addEventListener('click', function () { dismissEmergency(backdrop); });
    backdrop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') dismissEmergency(backdrop);
    });
    setTimeout(function () { try { closeBtn.focus(); } catch (e) {} }, 120);

    // Telemetry hook (non-blocking)
    try {
      window.dispatchEvent(new CustomEvent('sori:risk:critical', {
        detail: { trigger: triggerWord, at: Date.now() }
      }));
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   *  COUNSELING BRIDGE OVERLAY
   * ════════════════════════════════════════════════════════════ */
  function mountBridgeOverlay(count, hits) {
    injectStyles();
    closeAll();

    const backdrop = document.createElement('div');
    backdrop.className = 'sori-risk-backdrop';
    backdrop.id = 'sori-bridge-modal';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'sori-bridge-title');
    backdrop.tabIndex = -1;

    const hitsLabel = hits && hits.length
      ? hits.slice(0, 3).map(function (h) { return '“' + h + '”'; }).join(', ')
      : '';

    backdrop.innerHTML = `
      <div class="sori-risk-card sori-risk-card--bridge" role="document">
        <span class="sori-risk-card__eyebrow">
          <span class="sori-risk-breath" aria-hidden="true"></span>
          A gentle check-in &middot; 잠시 멈춤
        </span>
        <h2 class="sori-risk-card__title" id="sori-bridge-title">
          This week has been carrying a lot.
        </h2>
        <p class="sori-risk-card__title-ko" lang="ko">
          이번 주, 마음이 많이 무거웠던 것 같아요.
        </p>
        <p class="sori-risk-card__body">
          We've noticed <strong>${count}</strong> moments of heaviness in your recent recordings${hitsLabel ? ' — such as ' + hitsLabel : ''}.
          <br/>
          <span lang="ko" style="opacity:.72">
            최근 ${count}번, 마음이 힘들다는 신호가 있었어요. 잠시 함께 살펴볼까요?
          </span>
        </p>

        <div class="sori-risk-actions">
          <button type="button" class="sori-risk-btn sori-risk-btn--primary"
                  id="sori-bridge-open">
            Open Counseling Bridge &middot; <span lang="ko">상담 연결 살펴보기</span>
          </button>
          <button type="button" class="sori-risk-btn sori-risk-btn--ghost"
                  id="sori-bridge-later">
            Maybe later &middot; <span lang="ko">다음에 할게요</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { backdrop.classList.add('is-open'); });
    });

    backdrop.querySelector('#sori-bridge-later')
      .addEventListener('click', function () { dismiss(backdrop); });
    backdrop.querySelector('#sori-bridge-open')
      .addEventListener('click', function () {
        // Hand off to app-level handler if present, else reuse Emergency info.
        if (typeof window.openCounselingBridge === 'function') {
          try { window.openCounselingBridge({ count: count, hits: hits }); } catch (e) {}
        } else {
          window.dispatchEvent(new CustomEvent('sori:risk:bridge', {
            detail: { count: count, hits: hits, at: Date.now() }
          }));
        }
        dismiss(backdrop);
      });

    backdrop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') dismiss(backdrop);
    });

    markBridgeShown();
  }

  function dismiss(backdrop) {
    if (!backdrop || !backdrop.parentNode) return;
    backdrop.classList.remove('is-open');
    setTimeout(function () {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }, 380);
  }

  /* ────────────────────────────────────────────────────────────
   *  dismissEmergency — Emergency-modal-specific close handler.
   *  Fixes the "State Limbo" bug: onTranscriptReceived short-
   *  circuits the archive render on a CRITICAL match, which
   *  leaves the app parked on step-analysis. When the user taps
   *  "I'm safe for now", we must ALSO resume the flow.
   *
   *  Sequence (engineered so the transition lives UNDER the
   *  fading scrim — user never sees a blank frame):
   *    t=0     remove .is-open  → backdrop begins 360ms fade
   *    t=0+    route to step-voice-record + soriVoice.cleanup()
   *    t=0+    dispatch 'sori:risk:critical:dismissed' so any
   *            host app / analytics / alt-router can override.
   *    t=400   remove the backdrop node from the DOM.
   * ──────────────────────────────────────────────────────────── */
  function dismissEmergency(backdrop) {
    if (!backdrop) return;
    // Idempotency guard — clicking close + Escape in quick succession.
    if (backdrop.dataset.soriDismissed === '1') return;
    backdrop.dataset.soriDismissed = '1';

    const RESUME_STEP = 'step-voice-record';

    // 1. Begin scrim fade-out FIRST so the step swap happens beneath it.
    backdrop.classList.remove('is-open');

    // 2. CROSS-SCRIPT BRIDGE — fire the event sori-flow.js listens for.
    //    This is the authoritative signal: sori-flow.js owns the router
    //    and will invoke goToStep() directly, bypassing any indirection
    //    through sori-voice.js (whose wrapper silently try/catches and
    //    was leaving the app in State Limbo).
    //
    //    Both names are dispatched for forward compatibility — the
    //    plain-Event form is what the spec requested; the namespaced
    //    CustomEvent carries structured detail for analytics.
    try {
      window.dispatchEvent(new Event('modalDismissedResumingFlow'));
    } catch (e) { /* IE fallback not needed — Sori targets evergreen */ }
    try {
      window.dispatchEvent(new CustomEvent('sori:risk:critical:dismissed', {
        detail: { at: Date.now(), resumedTo: RESUME_STEP, source: 'EmergencyModal' }
      }));
    } catch (e) {}

    // 3. Belt-and-suspenders — if for any reason sori-flow.js did not
    //    register the listener (e.g. it failed to load), call its router
    //    directly, then fall through to soriVoice, then a raw DOM swap.
    //    Wrapped in a microtask so the event-driven path runs first and
    //    we don't double-fade on it.
    Promise.resolve().then(function () {
      if (document.getElementById(RESUME_STEP) &&
          document.getElementById(RESUME_STEP).style.display !== 'block' &&
          !document.getElementById(RESUME_STEP).classList.contains('sori-step--active')) {
        // Only force if the event listener didn't already route us.
        try {
          if (window.soriFlow && typeof window.soriFlow.goToStep === 'function') {
            window.soriFlow.goToStep(RESUME_STEP); return;
          }
          if (window.soriVoice && typeof window.soriVoice.goToStep === 'function') {
            window.soriVoice.goToStep(RESUME_STEP); return;
          }
        } catch (err) { console.warn('[sori-risk-detector] direct router threw:', err); }
        // Final fallback — raw DOM swap.
        document.querySelectorAll('[data-step], .step, .sori-step, [id^="step-"]').forEach(function (el) {
          if (el.id === RESUME_STEP) {
            el.style.display = 'block'; el.style.opacity = '1';
            el.removeAttribute('hidden');
            el.classList.remove('is-hidden'); el.classList.add('is-active', 'sori-step--active');
          } else {
            el.style.display = 'none';
            el.classList.remove('is-active', 'sori-step--active');
            el.classList.add('is-hidden');
          }
        });
      }
    });

    // 4. Reset the voice layer so the record button is fresh and armed.
    //    Runs AFTER the router signal so cleanup's setBtnIdle doesn't
    //    race the step swap.
    try {
      if (window.soriVoice && typeof window.soriVoice.cleanup === 'function') {
        window.soriVoice.cleanup();
      }
      if (window.soriUpdates && typeof window.soriUpdates.stopAnalyzingCycle === 'function') {
        window.soriUpdates.stopAnalyzingCycle();
      }
    } catch (e) {
      console.warn('[sori-risk-detector] voice cleanup threw:', e);
    }

    // 5. Tear down the modal node once the fade completes.
    setTimeout(function () {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }, 400);
  }

  function closeAll() {
    document.querySelectorAll('.sori-risk-backdrop').forEach(dismiss);
  }

  /* ════════════════════════════════════════════════════════════
   *  EVALUATE — the public entry point
   * ════════════════════════════════════════════════════════════
   * Returns one of:
   *   { level: 'critical',  trigger }     → modal mounted, archive halted
   *   { level: 'frequency', hits, count } → counter bumped (bridge maybe)
   *   { level: 'clear' }                  → nothing to do
   * ──────────────────────────────────────────────────────────── */
  function evaluate(transcript) {
    if (!window.soriRiskKeywords) {
      console.warn('[sori-risk-detector] riskKeywords module not loaded');
      return { level: 'clear' };
    }
    const { matchCritical, matchFrequency } = window.soriRiskKeywords;

    const critical = matchCritical(transcript);
    if (critical) {
      mountEmergencyModal(critical);
      return { level: 'critical', trigger: critical };
    }

    const hits = matchFrequency(transcript);
    if (hits.length > 0) {
      const count = incrementCounter();
      if (count >= BRIDGE_THRESH && !bridgeAlreadyShownThisWeek()) {
        mountBridgeOverlay(count, hits);
      }
      return { level: 'frequency', hits: hits, count: count };
    }

    return { level: 'clear' };
  }

  /* ════════════════════════════════════════════════════════════
   *  AUTO-WRAP — intercept /api/analyze responses so we can
   *  screen every transcript without mutating sori-voice.js.
   *  If the core component already calls window.soriRiskDetector
   *  .evaluate(transcript) directly (see injection point below),
   *  this fetch-wrap acts as an idempotent safety net.
   * ════════════════════════════════════════════════════════════ */
  (function wrapFetch() {
    if (!window.fetch || window.__soriRiskFetchWrapped) return;
    window.__soriRiskFetchWrapped = true;

    const _origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input
                : (input && input.url) ? input.url : '';
      const isAnalyze = typeof url === 'string' && url.indexOf('/api/analyze') !== -1;
      const p = _origFetch(input, init);
      if (!isAnalyze) return p;

      return p.then(function (res) {
        if (!res || !res.ok) return res;
        // Tee the body so callers still receive an untouched Response.
        const clone = res.clone();
        clone.json().then(function (data) {
          if (data && typeof data.transcript === 'string') {
            try { evaluate(data.transcript); } catch (e) {
              console.warn('[sori-risk-detector] evaluate() threw:', e);
            }
          }
        }).catch(function () { /* non-JSON — ignore */ });
        return res;
      });
    };
  })();

  /* ════════════════════════════════════════════════════════════
   *  PUBLIC API
   * ════════════════════════════════════════════════════════════ */
  window.soriRiskDetector = Object.freeze({
    evaluate           : evaluate,
    mountEmergencyModal: mountEmergencyModal,
    mountBridgeOverlay : mountBridgeOverlay,
    resetCounter       : resetCounter,
    readCounter        : readCounter,
    _tokens            : TOKENS
  });
})();
