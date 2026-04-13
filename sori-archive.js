/**
 * ============================================================
 * SORI · 소리 — Archive & Calendar Module (Final Stable v11)
 * ============================================================
 */

(function () {
  'use strict';

  // ─── API Base URL — relative path works on both localhost and Render ────
  const API_BASE = '';

  // --- State (전역 유지) ---
  let entries = [];
  let userHasPin = false;
  let currentPin = '';
  let currentDate = new Date();

  // ─── DOM References ──────────────────────────────────────────────────────
  const authArea = document.getElementById('archive-auth-area');
  const authMsg = document.getElementById('archive-auth-msg');
  const archiveContent = document.getElementById('archive-content');
  const verifyInput = document.getElementById('archive-verify-input');
  const verifyDots = document.getElementById('archive-verify-dots');
  const verifyError = document.getElementById('archive-verify-error');
  const calMonthYear = document.getElementById('calendar-month-year');
  const calGrid = document.getElementById('calendar-grid');
  const pastDateLabel = document.getElementById('past-date-label');
  const entriesList = document.getElementById('entries-list-container');

  // ─── Helper: Timezone-safe Date String ───────────────────────────────────
  // 어떤 날짜 객체든 "YYYY-MM-DD" 로컬 문자열로 반환 (시간대 오차 해결 핵심)
  function _getLocalISO(date) {
    const d = new Date(date);
    const offset = d.getTimezoneOffset() * 60000;
    const localDate = new Date(d.getTime() - offset);
    return localDate.toISOString().split('T')[0];
  }

  // ─── Initial Session ──────────────────────────────────────────────────
  async function initSession() {
    try {
      const res = await fetch(`${API_BASE}/api/user/init`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      userHasPin = data.hasPin;
      authMsg.textContent = userHasPin ? '보호된 기록을 보기 위해 PIN 번호를 입력해주세요' : '기록을 보호하기 위해 먼저 PIN 번호를 설정해주세요';
      if (verifyInput) verifyInput.focus();
    } catch (err) { console.error('Init error:', err); }
  }

  // ─── PIN Logic (기존 로직 엄격 유지) ──────────────────────────────────────────
  function updatePinDots(len) {
    const dots = verifyDots.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => dot.classList.toggle('pin-dot--filled', i < len));
  }

  verifyInput?.addEventListener('input', async (e) => {
    const pin = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = pin;
    updatePinDots(pin.length);
    if (pin.length === 4) {
      if (!userHasPin) await handleFirstPinSetup(pin);
      else await handlePinVerification(pin);
    }
  });

  async function handleFirstPinSetup(pin) {
    try {
      const res = await fetch(`${API_BASE}/api/user/setup-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }), credentials: 'include'
      });
      if (res.ok) { userHasPin = true; currentPin = pin; unlockArchive(); }
      else showError('PIN 설정에 실패했습니다.');
    } catch (err) { showError('서버 통신 오류'); }
  }

  async function handlePinVerification(pin) {
    try {
      const res = await fetch(`${API_BASE}/api/user/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }), credentials: 'include'
      });
      if (res.ok) { currentPin = pin; unlockArchive(); }
      else showError('PIN 번호가 일치하지 않습니다.');
    } catch (err) { showError('인증 오류'); }
  }

  function showError(msg) {
    verifyError.textContent = msg;
    verifyInput.value = '';
    setTimeout(() => { updatePinDots(0); verifyError.textContent = ''; verifyInput.focus(); }, 1000);
  }

  // ─── Archive Core Logic ──────────────────────────────────────────────────
  async function unlockArchive() {
    authArea.style.display = 'none';
    archiveContent.style.display = 'flex';
    await fetchEntries();
    // ── Progressive wellbeing section (sori-updates.js) ───────────────────
    // Rendered after entries load so the heatmap and checklist have real data.
    // The counseling resources link is only shown conditionally inside
    // renderWellbeingSection — never on first-session results directly.
    if (window.soriUpdates && typeof window.soriUpdates.renderWellbeingSection === 'function') {
      window.soriUpdates.renderWellbeingSection(entries);
    }
  }

  async function fetchEntries(providedPin) {
    const pinToUse = providedPin || currentPin;
    if (!pinToUse) return;
    try {
      const res = await fetch(`${API_BASE}/api/archive`, { headers: { 'x-sori-pin': pinToUse }, credentials: 'include' });
      const data = await res.json();
      currentPin = pinToUse;

      // [핵심 수정] 서버 데이터를 로컬 기준 키로 미리 매핑
      entries = (data.entries || []).map(e => ({
        ...e,
        localKey: _getLocalISO(e.date) // "2026-03-25" 고정
      }));
      renderCalendar();
    } catch (err) { console.error('Fetch error:', err); }
  }

  // ─── Calendar Rendering ──────────────────────────────────────────────────
  function renderCalendar() {
    calGrid.innerHTML = '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    calMonthYear.textContent = currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
      const el = document.createElement('div');
      el.className = 'calendar-day-label';
      el.textContent = d;
      calGrid.appendChild(el);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let x = 0; x < firstDay; x++) {
      const el = document.createElement('div');
      el.className = 'calendar-day calendar-day--empty';
      calGrid.appendChild(el);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const iterDate = new Date(year, month, i);
      const dateKey = _getLocalISO(iterDate); // 현재 칸의 날짜 키

      const dayEl = document.createElement('button');
      dayEl.className = 'calendar-day';
      dayEl.textContent = i;


      dayEl.addEventListener('click', () => {
        document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('calendar-day--selected'));
        dayEl.classList.add('calendar-day--selected');

        // 필터링 및 디테일 표시
        const currentDayEntries = entries.filter(e => e.localKey === dateKey);
        showDayDetails(iterDate, currentDayEntries);
      });
      calGrid.appendChild(dayEl);
    }
  }
  function showDayDetails(date, dayEntries) {
    if (pastDateLabel) {
      pastDateLabel.textContent = date.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }

    if (!entriesList) return;
    entriesList.innerHTML = '';

    if (dayEntries.length === 0) {
      entriesList.innerHTML = `
        <div class="empty-state-container mt-x5 text-center">
          <p class="type-body text-ghost mb-x1">기록이 없는 날입니다.</p>
          <p class="type-micro text-ghost italic" style="opacity: 0.7;">There are no records for this day.</p>
        </div>`;
      return;
    }

    // ─── [핵심 완벽 수정] ───
    // 옛날 실패 기록들을 버리고, 밀리초 단위로 계산해 '가장 최근에 저장된' 딱 1개의 데이터만 쏙 뽑아옵니다.
    const sortedEntries = [...dayEntries].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    const entry = sortedEntries[0];

    const card = document.createElement('div');
    card.className = 'past-entry-card fade-in-up';
    const meta = window.soriFlow ? window.soriFlow.getEmotionMeta(entry.emotion) : { emoji: '🌿', ko: entry.emotion };

    card.innerHTML = `
      <div class="archive-card-header d-flex justify-between align-center mb-x2">
        <div class="type-micro text-sage">#${meta.ko}</div>
        <div class="type-micro">${meta.emoji}</div>
      </div>
      <div class="archive-transcript mb-x3">
        <p class="type-micro text-ghost mb-x1">Your Voice</p>
        <p class="type-body text-deep italic" style="opacity: 0.8; border-left: 2px solid rgba(0,0,0,0.05); padding-left: 12px;">
          "${entry.transcript || '... (No words spoken)'}"
        </p>
      </div>
      <div class="archive-narrative mb-x4">
        <p class="type-body text-deep" style="line-height: 1.6;">${entry.narrative}</p>
      </div>
      ${entry.quote ? `
        <div class="archive-insight-mini mt-x3 pt-x3" style="border-top: 1px solid rgba(100, 80, 60, 0.08);">
          <p class="type-micro text-ghost italic mb-x1">"${entry.quote.en}"</p>
          <p class="type-micro text-ghost">— ${entry.quote.source}</p>
        </div>` : ''}
    `;
    entriesList.appendChild(card);

    requestAnimationFrame(() => card.classList.add('is-visible'));
  }
  // ─── Public API ──────────────────────────────────────────────────────────
  window.soriArchive = {
    focusPinInput: () => { if (verifyInput) verifyInput.focus(); },
    fetchEntries: fetchEntries,
    renderCalendar: renderCalendar,
    selectDate: (targetDate) => {
      if (!targetDate) return;

      // [에러 완벽 방어] 시간의 오차를 없애고 안전하게 날짜(자정 기준) 값만 추출
      const targetTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();

      const dayEntries = entries.filter(e => {
        // 1. parsedDate가 객체로 잘 존재할 때
        if (e.parsedDate && typeof e.parsedDate.getTime === 'function') {
          return e.parsedDate.getTime() === targetTime;
        }
        // 2. 모종의 이유로 parsedDate가 없더라도, 서버의 원본 date 값으로 무조건 찾아냄 (에러 방지)
        if (e.date) {
          const d = new Date(e.date);
          return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() === targetTime;
        }
        return false;
      });

      showDayDetails(targetDate, dayEntries);
    },
    // 홈 화면 복귀 시 완벽한 메모리 초기화
    resetState: () => {
      entries = [];
      userHasPin = false;
      currentPin = '';
      if (entriesList) entriesList.innerHTML = '';
      renderCalendar();
      initSession();
      console.log('[Sori Archive] Memory completely wiped for next user.');
    }
  };
  document.addEventListener('DOMContentLoaded', initSession);
  verifyDots?.addEventListener('click', () => verifyInput.focus());
  authArea?.addEventListener('click', () => verifyInput.focus());

})();