/**
 * ============================================================
 * SORI · 소리  —  sori-voice.js  v8 (Spacing Patch)
 * Voice recording → Whisper STT → GPT-4o → Journal Card
 * ============================================================
 */

(function () {
  'use strict';

  console.log('[sori-voice] ✅ sori-voice.js v8 loaded');

  const API_ENDPOINT = '/api/analyze';
  const LOADING_STEP = 'step-analysis';
  const JOURNAL_STEP = 'step-journal';
  const RECORD_STEP = 'step-voice-record';
  const MAX_MS = 30_000;
  const SILENCE_THRESHOLD = 0.022;
  const SILENCE_TIMEOUT_MS = 1_800;
  const POLL_MS = 100;
  const WARMUP_MS = 500;
  let _stylesInjected = false;

  const EMOTION_KO = Object.freeze({ Joy: '기쁨', Sadness: '슬픔', Anger: '분노', Fear: '두려움', Disgust: '혐오', Surprise: '놀라움', Anticipation: '기대', Trust: '신뢰' });
  const EMOTION_EMOJI = Object.freeze({ Joy: '☀️', Sadness: '🌧', Anger: '🔥', Fear: '🌑', Disgust: '💢', Surprise: '✨', Anticipation: '🌱', Trust: '🤍' });

  let _recording = false, _stopGuard = false, _stream = null, _recorder = null, _audioCtx = null, _analyser = null;
  let _chunks = [], _hardTimer = null, _silenceTimer = null, _silenceStart = null, _warmupTimer = null;
  let _audioBlob = null, _analyzeBtn = null, _waveformRaf = null;
  // ── Recording generation counter ─────────────────────────────────────────
  // Incremented on every startRecording() and cleanup(). Each MediaRecorder
  // 'stop' callback captures its generation at creation time; if the
  // generation has advanced by the time the callback fires, the callback
  // is silently discarded. This prevents stale onRecorderStop calls from
  // a previous recording session overwriting a new one (re-recording bug).
  let _recordingGen = 0;

  function recordBtn() { return document.getElementById('voice-record-trigger'); }
  function statusEl() { return document.getElementById('voice-status'); }
  function orbRing() { return document.getElementById('voice-orb-ring'); }
  function silenceBar() { return document.getElementById('silence-bar-track'); }
  function silenceFill() { return document.getElementById('silence-bar-fill'); }
  function waveVis() { return document.getElementById('waveform-visualiser'); }

  function goToStep(stepId) {
    if (window.soriFlow && typeof window.soriFlow.goToStep === 'function') {
      try { window.soriFlow.goToStep(stepId); return; } catch (err) { }
    }
    const steps = Array.from(document.querySelectorAll('[data-step], .step, [id^="step-"]'));
    if (steps.length === 0) {
      const target = document.getElementById(stepId);
      if (target) { target.style.display = ''; target.removeAttribute('hidden'); target.classList.remove('is-hidden'); target.classList.add('is-active'); }
      return;
    }
    steps.forEach(el => {
      if (el.id === stepId) { el.style.display = ''; el.removeAttribute('hidden'); el.classList.remove('is-hidden'); el.classList.add('is-active'); }
      else { el.style.display = 'none'; el.classList.remove('is-active'); el.classList.add('is-hidden'); }
    });
  }

  function formatEntryDate() {
    const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${DAY_ABBR[now.getDay()]} · ${yy}.${mm}.${dd}`;
  }

  function injectJournalStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'sori-journal-card-styles';
    style.textContent = `/* styles delegated to sori-css-patch.css */`;
    document.head.appendChild(style);
  }

  function buildJournalCard(data) {
    injectJournalStyles();

    const transcript = (data.transcript || '').trim();
    const journal = (data.journal || 'A quiet moment, held in space.').trim();
    const emotion = (data.emotion || 'Sadness').trim();
    const _meta = (window.soriFlow && window.soriFlow.getEmotionMeta) ? window.soriFlow.getEmotionMeta(emotion) : null;
    const emotionKo = (_meta && _meta.ko) || EMOTION_KO[emotion] || emotion;
    const emotionEmoji = (_meta && _meta.emoji) || EMOTION_EMOJI[emotion] || '·';
    const dateStr = formatEntryDate();

    const HALLUCINATION_PATTERNS = [/thank\s+you\s+for\s+watching/i, /thanks\s+for\s+watching/i, /thank\s+you\s+for\s+listening/i, /please\s+subscribe/i, /like\s+and\s+subscribe/i, /^\s*thank\s+you[\s.!]*$/i, /^\s*thanks[\s.!]*$/i, /^\s*\.{1,5}\s*$/, /^\s*[\u3000-\u303f\uff01-\uff60\s]*$/];
    const SILENCE_MESSAGE = '\u201c오늘은 침묵했군요. 억지로 얘기하지 않아도 좋아요.\u201d\u2009\u2014\u2009You were silent today. You don\u2019t have to force yourself to speak.';
    const isHallucination = !transcript || transcript.length < 4 || HALLUCINATION_PATTERNS.some(re => re.test(transcript));
    const transcriptDisplay = isHallucination ? SILENCE_MESSAGE : ('\u201c' + transcript + '\u201d');

    let container = document.getElementById(JOURNAL_STEP);
    if (!container) { container = document.createElement('div'); container.id = JOURNAL_STEP; container.className = 'step'; document.body.appendChild(container); }

    const card = document.createElement('div'); card.className = 'sori-journal-card';
    const header = document.createElement('div'); header.className = 'sori-journal-card__header';
    const dateEl = document.createElement('span'); dateEl.className = 'sori-journal-card__date'; dateEl.textContent = dateStr;
    const badge = document.createElement('div'); badge.className = 'sori-journal-card__emotion-badge';

    // 🌟 [수정 핵심] 이모지, 영단어, 한국어 사이에 띄어쓰기 한 칸 추가 (' ')
    const emojiEl = document.createElement('span'); emojiEl.className = 'sori-journal-card__emotion-emoji'; emojiEl.textContent = emotionEmoji + ' '; emojiEl.setAttribute('aria-hidden', 'true');
    const enEl = document.createElement('span'); enEl.className = 'sori-journal-card__emotion-en'; enEl.textContent = emotion + ' ';
    const koEl = document.createElement('span'); koEl.className = 'sori-journal-card__emotion-ko'; koEl.setAttribute('lang', 'ko'); koEl.textContent = emotionKo;

    badge.appendChild(emojiEl); badge.appendChild(enEl); badge.appendChild(koEl);
    header.appendChild(dateEl); header.appendChild(badge);

    const divider = document.createElement('hr'); divider.className = 'sori-journal-card__divider';
    const body = document.createElement('div'); body.className = 'sori-journal-card__body';
    const bodyText = document.createElement('p'); bodyText.className = 'sori-journal-card__body-text'; bodyText.textContent = journal;
    body.appendChild(bodyText);

    const transcriptEl = document.createElement('blockquote'); transcriptEl.className = 'sori-journal-card__transcript';
    const transcriptLabel = document.createElement('span'); transcriptLabel.className = 'sori-journal-card__transcript-label'; transcriptLabel.innerHTML = 'Your words &nbsp;&middot;&nbsp; <span lang="ko">당신의 말</span>';
    const transcriptText = document.createElement('p'); transcriptText.className = 'sori-journal-card__transcript-text'; transcriptText.textContent = transcriptDisplay;
    transcriptEl.appendChild(transcriptLabel); transcriptEl.appendChild(transcriptText);

    const newEntryBtn = document.createElement('button'); newEntryBtn.type = 'button'; newEntryBtn.className = 'sori-journal-card__new-entry'; newEntryBtn.innerHTML = '↺ &nbsp; New entry &nbsp;&middot;&nbsp; <span lang="ko">새 기록</span>';
    newEntryBtn.addEventListener('click', () => { cleanup(); goToStep(RECORD_STEP); });

    const insightSection = document.createElement('section'); insightSection.className = 'insight-section'; insightSection.id = 'insight-section'; insightSection.setAttribute('aria-label', 'Psychological insight'); insightSection.setAttribute('aria-live', 'polite'); insightSection.setAttribute('hidden', '');
    insightSection.innerHTML = '<div class="insight-quote" role="figure"><span class="insight-label" aria-hidden="true">A thought for you &nbsp;&middot;&nbsp; <span lang="ko">함께 머물 생각</span></span><blockquote class="insight-quote__body"><p class="insight-quote__text" id="insight-quote-en" lang="en"></p><p class="insight-quote__text insight-quote__text--ko" id="insight-quote-ko" lang="ko"></p><footer class="insight-quote__attribution"><cite id="insight-quote-source"></cite></footer></blockquote></div><div class="insight-recs" aria-labelledby="insight-recs-heading"><span class="insight-label" id="insight-recs-heading" aria-hidden="true">Gentle steps &nbsp;&middot;&nbsp; <span lang="ko">작은 돌봄</span></span><ol class="insight-recs__list" id="insight-recs-list" aria-label="Self-care recommendations"></ol></div>';

    card.appendChild(header); card.appendChild(divider); card.appendChild(body); card.appendChild(transcriptEl); card.appendChild(insightSection); card.appendChild(newEntryBtn);
    container.innerHTML = ''; container.appendChild(card);
    return card;
  }

  function buildErrorCard(message) {
    injectJournalStyles();
    let container = document.getElementById(JOURNAL_STEP);
    if (!container) { container = document.createElement('div'); container.id = JOURNAL_STEP; container.className = 'step'; document.body.appendChild(container); }
    const card = document.createElement('div'); card.className = 'sori-journal-card sori-journal-card--error';
    const title = document.createElement('p'); title.className = 'sori-journal-card__error-title'; title.textContent = 'Something went gently wrong · 문제가 생겼어요';
    const body = document.createElement('p'); body.className = 'sori-journal-card__error-body'; body.textContent = message || 'The analysis could not be completed. Please try again.';
    const retryBtn = document.createElement('button'); retryBtn.type = 'button'; retryBtn.className = 'sori-journal-card__retry'; retryBtn.innerHTML = '↩ &nbsp; Try again &nbsp;&middot;&nbsp; <span lang="ko">다시 시도</span>';
    retryBtn.addEventListener('click', () => { cleanup(); goToStep(RECORD_STEP); });
    card.appendChild(title); card.appendChild(body); card.appendChild(retryBtn);
    container.innerHTML = ''; container.appendChild(card);
  }

  function setStatus(text) { const el = statusEl(); if (el) el.textContent = text; }
  function setBtnListening() { const b = recordBtn(); if (!b) return; b.disabled = false; b.setAttribute('aria-pressed', 'true'); b.classList.add('voice-record-btn--active'); b.innerHTML = '● &nbsp; Listening\u2026 &nbsp;&middot;&nbsp; <span lang="ko">듣고 있어요</span>'; orbRing()?.classList.add('voice-orb-ring--active'); }
  function setBtnStopped() {
    const b = recordBtn();
    if (!b) return;
    b.disabled = true;
    b.setAttribute('aria-pressed', 'false');
    b.classList.remove('voice-record-btn--active');
    b.innerHTML = '○ &nbsp; Recorded &nbsp;&middot;&nbsp; <span lang="ko">녹음 완료</span>';
    orbRing()?.classList.remove('voice-orb-ring--active');
    stopWaveform();
    // ── Micro-interaction: toast confirming recording captured ───────────
    _showRecordingStoppedToast();
  }

  // ── Recording-stopped toast ─────────────────────────────────────────────
  function _showRecordingStoppedToast() {
    const existing = document.getElementById('sori-recording-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'sori-recording-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.innerHTML = '<span class="sori-toast__check" aria-hidden="true">✓</span> Recording captured &nbsp;·&nbsp; <span lang="ko">녹음 완료</span>';
    document.body.appendChild(toast);
    // Two-frame rAF ensures CSS transition fires after display: block
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add('sori-toast--visible');
      });
    });
    setTimeout(function () {
      toast.classList.remove('sori-toast--visible');
      setTimeout(function () { toast.remove(); }, 500);
    }, 2200);
  }
  function setBtnIdle() { const b = recordBtn(); if (!b) return; b.disabled = false; b.setAttribute('aria-pressed', 'false'); b.classList.remove('voice-record-btn--active'); b.innerHTML = '○ &nbsp; Speak &nbsp;&middot;&nbsp; <span lang="ko">말하기</span>'; orbRing()?.classList.remove('voice-orb-ring--active'); stopWaveform(); }

  function revealAnalyzeBtn() {
    hideAnalyzeBtn();
    const anchor = document.querySelector('.voice-orb-wrapper');
    if (!anchor) return;
    const btn = document.createElement('button'); btn.id = 'analyze-trigger'; btn.type = 'button'; btn.className = 'voice-record-btn';
    btn.style.cssText = 'opacity: 0; transform: translateY(8px); transition: opacity 400ms ease, transform 400ms ease; margin-top: 16px;';
    btn.setAttribute('aria-label', 'Analyze my record — 내 기록 분석해보기'); btn.innerHTML = '→ &nbsp; Analyze my record&nbsp;&middot;&nbsp; <span lang="ko">내 기록 분석해보기</span>';
    btn.addEventListener('click', onAnalyzeClick); anchor.insertAdjacentElement('afterend', btn); _analyzeBtn = btn;
    requestAnimationFrame(() => requestAnimationFrame(() => { btn.style.opacity = '1'; btn.style.transform = 'translateY(0)'; }));
  }

  function hideAnalyzeBtn() { if (_analyzeBtn) { _analyzeBtn.removeEventListener('click', onAnalyzeClick); _analyzeBtn.remove(); _analyzeBtn = null; } else { document.getElementById('analyze-trigger')?.remove(); } }

  function getRMS(analyser) { const buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; return Math.sqrt(sum / buf.length); }

  function startSilenceDetection() {
    _silenceStart = null; const track = silenceBar(); const fill = silenceFill();
    if (track) track.classList.remove('is-counting'); if (fill) fill.style.transform = 'scaleX(1)';
    _silenceTimer = setInterval(() => {
      if (!_analyser || !_recording) { clearInterval(_silenceTimer); return; }
      const rms = getRMS(_analyser);
      if (rms < SILENCE_THRESHOLD) {
        if (_silenceStart === null) _silenceStart = Date.now();
        const elapsed = Date.now() - _silenceStart; const progress = Math.min(elapsed / SILENCE_TIMEOUT_MS, 1);
        if (track) track.classList.add('is-counting'); if (fill) fill.style.transform = `scaleX(${1 - progress})`;
        if (elapsed >= SILENCE_TIMEOUT_MS) { clearInterval(_silenceTimer); stopRecording(); }
      } else { _silenceStart = null; if (track) track.classList.remove('is-counting'); if (fill) fill.style.transform = 'scaleX(1)'; }
    }, POLL_MS);
  }

  function stopSilenceDetection() { clearInterval(_silenceTimer); _silenceTimer = null; _silenceStart = null; silenceBar()?.classList.remove('is-counting'); const fill = silenceFill(); if (fill) fill.style.transform = 'scaleX(1)'; }

  function startWaveform() {
    const vis = waveVis(); if (!vis || !_analyser) return; vis.classList.add('is-active');
    const bars = vis.querySelectorAll('.waveform-bar'); if (!bars.length) return;
    function draw() {
      if (!_analyser || !_recording) return; const buf = new Float32Array(_analyser.fftSize); _analyser.getFloatTimeDomainData(buf);
      bars.forEach((bar, i) => { const slice = Math.floor((buf.length / bars.length) * i); const sample = Math.abs(buf[slice] || 0); bar.style.height = `${Math.max(4, Math.min(28, 4 + sample * 240))}px`; });
      _waveformRaf = requestAnimationFrame(draw);
    } draw();
  }

  function stopWaveform() { if (_waveformRaf) { cancelAnimationFrame(_waveformRaf); _waveformRaf = null; } const vis = waveVis(); if (vis) { vis.classList.remove('is-active'); vis.querySelectorAll('.waveform-bar').forEach(b => { b.style.height = '4px'; }); } }

  async function startRecording() {
    if (_recording) return;
    _audioBlob = null;
    hideAnalyzeBtn();

    // Capture generation snapshot BEFORE any async work so the closure
    // correctly identifies which recording session this belongs to.
    _recordingGen++;
    const myGen = _recordingGen;

    try {
      setStatus('Opening a quiet space\u2026 \u00b7 조용한 공간을 여는 중이에요');

      // ── Mobile guard: check API availability ──────────────────────────
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Voice recording is not supported in this browser. \u00b7 이 브라우저는 녹음을 지원하지 않아요.');
        return;
      }

      _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // ── AudioContext: iOS Safari requires explicit .resume() ──────────
      // The context may be created in a 'suspended' state on iOS because
      // the getUserMedia await crossed a task boundary. .resume() is a
      // no-op on desktop where state is already 'running'.
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') {
        await _audioCtx.resume().catch(function () { /* non-fatal */ });
      }

      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 512;
      _analyser.smoothingTimeConstant = 0.25;
      const src = _audioCtx.createMediaStreamSource(_stream);
      src.connect(_analyser);

      // ── MIME type: prefer opus/webm, fall back for iOS (mp4) ─────────
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : '';

      _recorder = new MediaRecorder(_stream, mime ? { mimeType: mime } : {});
      _chunks = [];

      _recorder.addEventListener('dataavailable', function (e) {
        if (e.data && e.data.size > 0) _chunks.push(e.data);
      });

      // ── Generation-scoped stop listener ──────────────────────────────
      // If cleanup() has already incremented _recordingGen, this callback
      // is silently discarded — preventing stale data from overwriting a
      // new recording session (re-recording same-output bug).
      _recorder.addEventListener('stop', function () {
        if (_recordingGen !== myGen) {
          console.log('[sori-voice] 🚫 Stale stop event discarded (gen ' + myGen + ' vs current ' + _recordingGen + ')');
          return;
        }
        onRecorderStop();
      });

      _recorder.start(250);
      _recording = true;
      _stopGuard = false;
      setBtnListening();
      setStatus('Speak freely, or rest in silence. \u00b7 자유롭게 말하거나, 침묵 속에 있어도 돼요');
      window.soriResonance?.setRecordingActive?.(true);
      startWaveform();
      _hardTimer = setTimeout(function () { if (_recording) stopRecording(); }, MAX_MS);
      _warmupTimer = setTimeout(startSilenceDetection, WARMUP_MS);

    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setStatus('Microphone access is needed. \u00b7 마이크 권한이 필요해요.');
      } else {
        setStatus('Something went gently wrong. Please try again. \u00b7 다시 시도해 주세요.');
      }
      cleanup();
    }
  }

  function stopRecording() {
    if (!_recording || _stopGuard) return; _stopGuard = true; _recording = false;
    clearTimeout(_hardTimer); clearTimeout(_warmupTimer); stopSilenceDetection(); stopWaveform(); window.soriResonance?.setRecordingActive?.(false);
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
  }

  async function onRecorderStop() {
    try { if (_audioCtx) await _audioCtx.close(); } catch (e) { } _audioCtx = null; _analyser = null;
    if (_chunks.length === 0) { setStatus('No audio was captured. Please try again. \u00b7 녹음된 내용이 없어요.'); setBtnIdle(); _recorder = null; return; }
    const mimeType = (_recorder && _recorder.mimeType) || 'audio/webm'; _audioBlob = new Blob(_chunks, { type: mimeType });
    _chunks = []; _recorder = null; setBtnStopped(); setStatus('Ready when you are. \u00b7 준비됐어요'); revealAnalyzeBtn();
  }

  async function onAnalyzeClick() {
    if (!_audioBlob) { setStatus('No recording found. Please record again. \u00b7 다시 녹음해 주세요.'); return; }
    const blob = _audioBlob;
    _audioBlob = null;
    hideAnalyzeBtn();
    goToStep(LOADING_STEP);

    // ── Start the Analyzing... cycling text animation ────────────────────
    if (window.soriUpdates && typeof window.soriUpdates.startAnalyzingCycle === 'function') {
      window.soriUpdates.startAnalyzingCycle();
    }

    try {
      const form = new FormData();
      // ── Use the correct file extension for the MIME type (iOS fix) ────
      const mimeType = blob.type || 'audio/webm';
      const ext = mimeType.includes('mp4') ? 'mp4'
        : mimeType.includes('ogg') ? 'ogg'
        : 'webm';
      form.append('audio', blob, 'recording.' + ext);
      // Cache-bust: prevents any proxy/SW from returning a stale response
      form.append('_ts', Date.now().toString());

      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      if (!res.ok) {
        let errText = 'Server error ' + res.status;
        try { const j = await res.json(); if (j.error) errText = j.error; } catch (_) { }
        throw new Error(errText);
      }
      const data = await res.json();
      onTranscriptReceived(data);
    } catch (err) {
      if (window.soriUpdates && typeof window.soriUpdates.stopAnalyzingCycle === 'function') {
        window.soriUpdates.stopAnalyzingCycle();
      }
      buildErrorCard(err.message);
      goToStep(JOURNAL_STEP);
      setBtnIdle();
    }
  }

  function onTranscriptReceived(data) {
    // Stop the analyzing cycle animation
    if (window.soriUpdates && typeof window.soriUpdates.stopAnalyzingCycle === 'function') {
      window.soriUpdates.stopAnalyzingCycle();
    }
    try { buildJournalCard(data); } catch (buildErr) { buildErrorCard('The journal card could not be rendered. ' + buildErr.message); }
    window.soriFlow?.populateInsight?.(data);

    // ── Hero emotion display: brief interstitial on step-analysis ────────
    // Show a large emotion keyword for ~1.8s before auto-advancing to journal.
    if (window.soriUpdates && typeof window.soriUpdates.showHeroEmotion === 'function') {
      window.soriUpdates.showHeroEmotion(data, function () {
        goToStep(JOURNAL_STEP);
        setBtnIdle();
        setStatus('');
      });
    } else {
      goToStep(JOURNAL_STEP);
      setBtnIdle();
      setStatus('');
    }
  }

  function cleanup() {
    // Advance generation counter FIRST — this silently invalidates any
    // inflight onRecorderStop callbacks from the outgoing session.
    _recordingGen++;
    _recording = false;
    _stopGuard = false;
    _audioBlob = null;
    clearTimeout(_hardTimer);
    clearTimeout(_warmupTimer);
    stopSilenceDetection();
    stopWaveform();
    setBtnIdle();
    hideAnalyzeBtn();
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
    // Stop the recorder gracefully (stream tracks stopped above will
    // trigger the native stop internally, but we call it explicitly to
    // be safe). The generation-scoped stop listener will ignore this.
    if (_recorder && _recorder.state !== 'inactive') {
      try { _recorder.stop(); } catch (e) { /* ignore */ }
    }
    _recorder = null;
    _chunks = [];
    try { if (_audioCtx) _audioCtx.close(); } catch (_) { }
    _audioCtx = null;
    _analyser = null;
    window.soriResonance?.setRecordingActive?.(false);
  }

  document.addEventListener('click', function soriVoiceDelegate(e) {
    const b = e.target.closest('#voice-record-trigger');
    if (!b || b.disabled) return;
    if (_recording) stopRecording(); else startRecording();
  });

  window.soriVoice = Object.freeze({ get isRecording() { return _recording; }, get hasPendingBlob() { return _audioBlob !== null; }, stop: stopRecording, analyze: onAnalyzeClick, cleanup: cleanup, goToStep: goToStep });

})();