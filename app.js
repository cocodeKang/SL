import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const GATES = [2, 3, 4, 1];
const STORAGE_KEYS = {
  draft: 'sjoelen.firebase.draft.v1',
  settings: 'sjoelen.firebase.settings.v1'
};

const state = {
  uid: null,
  db: null,
  auth: null,
  sessions: [],
  reflections: [],
  updates: [],
  unsubscribers: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function today() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2300);
}

function setSync(status, message, detail = '') {
  const dot = $('#syncDot');
  dot.className = `sync-dot ${status}`;
  $('#syncStatus').textContent = message;
  $('#userStatus').textContent = detail;
}

function requireDb() {
  if (!state.db || !state.uid) {
    throw new Error('먼저 Google 로그인 또는 이 기기만 사용을 눌러 저장소를 연결하세요.');
  }
}

function userCollection(name) {
  requireDb();
  return collection(state.db, 'users', state.uid, name);
}

function createQuarterRows() {
  const body = $('#quarterBody');
  body.innerHTML = '';
  for (let quarter = 1; quarter <= 3; quarter += 1) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${quarter}쿼터</strong></td>`;
    for (const gate of GATES) {
      const td = document.createElement('td');
      td.innerHTML = `
        <div class="gate-input-wrap">
          <button class="mini-btn" type="button" data-step="-1" data-quarter="${quarter}" data-gate="${gate}">-</button>
          <input class="gate-input" id="q${quarter}g${gate}" type="number" min="0" max="30" inputmode="numeric" value="0" aria-label="${quarter}쿼터 ${gate}점 관문" />
          <button class="mini-btn" type="button" data-step="1" data-quarter="${quarter}" data-gate="${gate}">+</button>
        </div>`;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function readGateCounts() {
  const quarters = [];
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let quarter = 1; quarter <= 3; quarter += 1) {
    const row = {};
    for (const gate of GATES) {
      const value = safeNumber($(`#q${quarter}g${gate}`).value);
      row[gate] = value;
      totals[gate] += value;
    }
    quarters.push(row);
  }
  return { quarters, totals };
}

function calculateSjoelen(totals) {
  const counts = GATES.map((gate) => safeNumber(totals[gate]));
  const sets = Math.min(...counts);
  let score = sets * 20;
  for (const gate of GATES) {
    score += (safeNumber(totals[gate]) - sets) * gate;
  }
  const totalIn = counts.reduce((a, b) => a + b, 0);
  const successRate = totalIn > 0 ? Math.round((Math.min(totalIn, 30) / 30) * 100) : 0;
  const sortedWeak = [...GATES].sort((a, b) => safeNumber(totals[a]) - safeNumber(totals[b]));
  const weakGate = sortedWeak[0];
  const balance = Math.max(...counts) - Math.min(...counts);
  return { score, sets, totalIn, successRate, weakGate, balance };
}

function updateLiveScore() {
  const { totals } = readGateCounts();
  const calc = calculateSjoelen(totals);
  $('#liveScore').textContent = calc.score;
  $('#liveSets').textContent = calc.sets;
  $('#liveTotalIn').textContent = `${calc.totalIn} / 30`;
  $('#liveRate').textContent = `${calc.successRate}%`;
  saveDraft();
}

function updateTargetPreview() {
  const throwsCount = safeNumber($('#targetThrows').value);
  const hits = safeNumber($('#targetHits').value);
  const rate = throwsCount ? Math.round((hits / throwsCount) * 100) : 0;
  $('#targetRate').textContent = `${rate}%`;
  $('#targetResult').textContent = hits >= Math.ceil(throwsCount * 0.6) ? '목표권' : '연습 필요';
  saveDraft();
}

function bindTabs() {
  const move = (tabId) => {
    $$('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    $$('.mobile-bottom button').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === tabId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  $$('.tab, .mobile-bottom button').forEach((btn) => {
    btn.addEventListener('click', () => move(btn.dataset.tab));
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && ['1','2','3','4','5','6'].includes(e.key)) {
      e.preventDefault();
      const ids = ['dashboard', 'score', 'target', 'focus', 'reflection', 'updates'];
      move(ids[Number(e.key) - 1]);
    }
    if (e.key === 'Escape') {
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) active.blur();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      resetScoreForm();
      move('score');
    }
  });
}

function bindInputs() {
  $('#quarterBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-step]');
    if (!btn) return;
    const input = $(`#q${btn.dataset.quarter}g${btn.dataset.gate}`);
    input.value = Math.max(0, safeNumber(input.value) + Number(btn.dataset.step));
    updateLiveScore();
  });

  $$('#scoreForm input, #scoreForm textarea, #scoreForm select').forEach((el) => {
    el.addEventListener('input', updateLiveScore);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') el.blur();
    });
  });

  $$('#targetForm input, #targetForm textarea, #targetForm select').forEach((el) => {
    el.addEventListener('input', updateTargetPreview);
  });

  $$('[data-target-gate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#targetGate').value = btn.dataset.targetGate;
      toast(`${btn.dataset.targetGate}점 관문 목표훈련으로 설정했습니다.`);
      updateTargetPreview();
    });
  });

  for (const id of ['focusScore', 'routineScore', 'postureScore']) {
    const out = $(`#${id}Out`);
    $(`#${id}`).addEventListener('input', (e) => {
      out.textContent = e.target.value;
      saveDraft();
    });
  }

  $$('#focusForm input, #focusForm textarea').forEach((el) => el.addEventListener('input', saveDraft));

  $('#newScoreBtn').addEventListener('click', resetScoreForm);
  $('#copySummaryBtn').addEventListener('click', copyScoreSummary);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#clearDraftBtn').addEventListener('click', clearDraft);
}

function resetScoreForm() {
  $('#scoreForm').reset();
  $('#scoreDate').value = today();
  applySettingsToForms();
  for (let q = 1; q <= 3; q += 1) {
    for (const gate of GATES) $(`#q${q}g${gate}`).value = 0;
  }
  $('#missShort').value = 0;
  $('#missLong').value = 0;
  $('#missLeft').value = 0;
  $('#missRight').value = 0;
  updateLiveScore();
  toast('새 일반기록을 시작합니다.');
}

function collectScoreSession() {
  const { quarters, totals } = readGateCounts();
  const calculated = calculateSjoelen(totals);
  return {
    kind: 'score',
    date: $('#scoreDate').value || today(),
    player: text($('#scorePlayer').value),
    place: text($('#scorePlace').value),
    goal: text($('#scoreGoal').value),
    quarters,
    gateTotals: totals,
    misses: {
      short: safeNumber($('#missShort').value),
      long: safeNumber($('#missLong').value),
      left: safeNumber($('#missLeft').value),
      right: safeNumber($('#missRight').value)
    },
    reflection: {
      good: text($('#scoreGood').value),
      improve: text($('#scoreImprove').value),
      question: text($('#scoreQuestion').value)
    },
    calculated,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function collectTargetSession() {
  const throwsCount = safeNumber($('#targetThrows').value);
  const hits = safeNumber($('#targetHits').value);
  return {
    kind: 'target',
    date: $('#targetDate').value || today(),
    player: text($('#targetPlayer').value),
    target: {
      gate: Number($('#targetGate').value),
      throws: throwsCount,
      hits,
      rate: throwsCount ? Math.round((hits / throwsCount) * 100) : 0,
      standard: text($('#targetStandard').value)
    },
    reflection: {
      successFeel: text($('#targetSuccessFeel').value),
      failCause: text($('#targetFailCause').value),
      next: text($('#targetNext').value)
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function collectFocusSession() {
  const checked = (id) => $(`#${id}`).checked;
  return {
    kind: 'focus',
    date: $('#focusDate').value || today(),
    player: text($('#focusPlayer').value),
    keyword: text($('#focusKeyword').value),
    sets: safeNumber($('#focusSets').value),
    routine: {
      stance: checked('routineStance'),
      grip: checked('routineGrip'),
      eyes: checked('routineEyes'),
      breath: checked('routineBreath'),
      release: checked('routineRelease'),
      follow: checked('routineFollow')
    },
    scores: {
      focus: safeNumber($('#focusScore').value),
      routine: safeNumber($('#routineScore').value),
      posture: safeNumber($('#postureScore').value)
    },
    reflection: {
      shake: text($('#focusShake').value),
      condition: text($('#focusCondition').value),
      mantra: text($('#focusMantra').value)
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

async function saveSession(payload) {
  requireDb();
  setSync('pending', '저장 중', 'Firestore에 기록 저장 중');
  await addDoc(userCollection('sessions'), payload);
  setSync('online', '동기화 완료', `익명 UID: ${state.uid.slice(0, 8)}...`);
  toast('Firestore에 저장했습니다.');
}

function bindForms() {
  $('#scoreForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveSession(collectScoreSession());
    } catch (err) {
      console.error(err);
      toast(err.message);
      setSync('offline', '저장 실패', err.message);
    }
  });

  $('#targetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveSession(collectTargetSession());
    } catch (err) {
      console.error(err);
      toast(err.message);
      setSync('offline', '저장 실패', err.message);
    }
  });

  $('#focusForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveSession(collectFocusSession());
    } catch (err) {
      console.error(err);
      toast(err.message);
      setSync('offline', '저장 실패', err.message);
    }
  });

  $('#reflectionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      requireDb();
      await addDoc(userCollection('reflections'), {
        date: $('#reflectionDate').value || today(),
        type: $('#reflectionType').value,
        question: text($('#reflectionQuestion').value),
        answer: text($('#reflectionAnswer').value),
        experiment: text($('#reflectionExperiment').value),
        createdAt: serverTimestamp()
      });
      $('#reflectionQuestion').value = '';
      $('#reflectionAnswer').value = '';
      $('#reflectionExperiment').value = '';
      toast('성찰을 저장했습니다.');
    } catch (err) {
      console.error(err);
      toast(err.message);
    }
  });

  $('#updateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      requireDb();
      await addDoc(userCollection('updates'), {
        type: $('#updateType').value,
        detail: text($('#updateDetail').value),
        status: $('#updateStatus').value,
        createdAt: serverTimestamp()
      });
      $('#updateDetail').value = '';
      toast('업데이트 기록을 저장했습니다.');
    } catch (err) {
      console.error(err);
      toast(err.message);
    }
  });
}

function subscribeFirestore() {
  for (const unsub of state.unsubscribers) unsub();
  state.unsubscribers = [];

  const sessionsQuery = query(userCollection('sessions'), orderBy('createdAt', 'desc'));
  state.unsubscribers.push(onSnapshot(sessionsQuery, (snap) => {
    state.sessions = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderDashboard();
    renderRecentList();
  }, handleSnapshotError));

  const reflectionQuery = query(userCollection('reflections'), orderBy('createdAt', 'desc'));
  state.unsubscribers.push(onSnapshot(reflectionQuery, (snap) => {
    state.reflections = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderDashboard();
    renderReflectionList();
  }, handleSnapshotError));

  const updateQuery = query(userCollection('updates'), orderBy('createdAt', 'desc'));
  state.unsubscribers.push(onSnapshot(updateQuery, (snap) => {
    state.updates = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderUpdateList();
  }, handleSnapshotError));
}

function handleSnapshotError(err) {
  console.error(err);
  setSync('offline', '동기화 오류', err.message);
  toast('Firestore 읽기 오류: 보안 규칙 또는 인덱스를 확인하세요.');
}

function formatDate(value) {
  if (!value) return '-';
  if (typeof value === 'string') return value;
  if (value.toDate) return value.toDate().toLocaleDateString('ko-KR');
  return String(value);
}

function renderDashboard() {
  $('#statTotalSessions').textContent = state.sessions.length;
  const latest = state.sessions[0];
  if (latest) {
    $('#statLastScore').textContent = latest.kind === 'score' ? latest.calculated?.score ?? '-' : latest.kind === 'target' ? `${latest.target?.rate ?? 0}%` : `${latest.scores?.focus ?? '-'}점`;
    $('#statLastDate').textContent = formatDate(latest.date);
  } else {
    $('#statLastScore').textContent = '-';
    $('#statLastDate').textContent = '기록 없음';
  }

  const scoreSessions = state.sessions.filter((item) => item.kind === 'score').slice(0, 10);
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const session of scoreSessions) {
    for (const gate of GATES) totals[gate] += safeNumber(session.gateTotals?.[gate]);
  }
  $('#statWeakGate').textContent = scoreSessions.length ? `${calculateSjoelen(totals).weakGate}점` : '-';
  $('#statNextQuestion').textContent = state.reflections[0]?.question || latest?.reflection?.question || '-';
}

function sessionTitle(item) {
  if (item.kind === 'score') return `일반기록 · ${item.calculated?.score ?? 0}점 · 약한 관문 ${item.calculated?.weakGate ?? '-'}점`;
  if (item.kind === 'target') return `목표훈련 · ${item.target?.gate ?? '-'}점 관문 · ${item.target?.hits ?? 0}/${item.target?.throws ?? 0}`;
  if (item.kind === 'focus') return `집중훈련 · 집중도 ${item.scores?.focus ?? '-'}점 · ${item.keyword || '루틴 점검'}`;
  return '훈련기록';
}

function sessionDescription(item) {
  if (item.kind === 'score') {
    const t = item.gateTotals || {};
    return `관문분포: 2점 ${t[2] ?? 0}, 3점 ${t[3] ?? 0}, 4점 ${t[4] ?? 0}, 1점 ${t[1] ?? 0} / 질문: ${item.reflection?.question || '없음'}`;
  }
  if (item.kind === 'target') return `기준: ${item.target?.standard || '-'} / 다음 목표: ${item.reflection?.next || '없음'}`;
  if (item.kind === 'focus') return `루틴 안정성 ${item.scores?.routine ?? '-'}점 / 다음 문장: ${item.reflection?.mantra || '없음'}`;
  return '';
}

function renderRecentList() {
  const list = $('#recentList');
  if (!state.sessions.length) {
    list.className = 'list empty';
    list.textContent = '아직 저장된 기록이 없습니다.';
    return;
  }
  list.className = 'list';
  list.innerHTML = state.sessions.slice(0, 12).map((item) => `
    <article class="item">
      <div class="item-head">
        <div>
          <div class="item-title">${escapeHtml(sessionTitle(item))}</div>
          <div class="item-meta">${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.player || '이름 없음')} ${item.place ? '· ' + escapeHtml(item.place) : ''}</div>
        </div>
      </div>
      <p>${escapeHtml(sessionDescription(item))}</p>
      <div class="item-actions"><button type="button" data-delete-session="${item.id}">삭제</button></div>
    </article>
  `).join('');

  $$('[data-delete-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 훈련 기록을 삭제할까요?')) return;
      await deleteDoc(doc(state.db, 'users', state.uid, 'sessions', btn.dataset.deleteSession));
      toast('기록을 삭제했습니다.');
    });
  });
}

function renderReflectionList() {
  const list = $('#reflectionList');
  if (!state.reflections.length) {
    list.className = 'list empty';
    list.textContent = '아직 성찰 기록이 없습니다.';
    return;
  }
  list.className = 'list';
  list.innerHTML = state.reflections.slice(0, 20).map((item) => `
    <article class="item">
      <div class="item-title">${escapeHtml(item.question)}</div>
      <div class="item-meta">${escapeHtml(formatDate(item.date))} · ${escapeHtml(item.type || '기타')}</div>
      <p><b>답/가설:</b> ${escapeHtml(item.answer || '미작성')}</p>
      <p><b>다음 실험:</b> ${escapeHtml(item.experiment || '미작성')}</p>
      <div class="item-actions"><button type="button" data-delete-reflection="${item.id}">삭제</button></div>
    </article>
  `).join('');
  $$('[data-delete-reflection]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 성찰 기록을 삭제할까요?')) return;
      await deleteDoc(doc(state.db, 'users', state.uid, 'reflections', btn.dataset.deleteReflection));
      toast('성찰을 삭제했습니다.');
    });
  });
}

function renderUpdateList() {
  const list = $('#updateList');
  if (!state.updates.length) {
    list.className = 'list empty';
    list.textContent = '아직 업데이트 기록이 없습니다.';
    return;
  }
  list.className = 'list';
  list.innerHTML = state.updates.slice(0, 20).map((item) => `
    <article class="item">
      <div class="item-title">[${escapeHtml(item.status || '요청')}] ${escapeHtml(item.type || '기타')}</div>
      <p>${escapeHtml(item.detail || '')}</p>
      <div class="item-actions"><button type="button" data-delete-update="${item.id}">삭제</button></div>
    </article>
  `).join('');
  $$('[data-delete-update]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 업데이트 기록을 삭제할까요?')) return;
      await deleteDoc(doc(state.db, 'users', state.uid, 'updates', btn.dataset.deleteUpdate));
      toast('업데이트 기록을 삭제했습니다.');
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function csvCell(value) {
  const normalized = String(value ?? '').replaceAll('"', '""');
  return `"${normalized}"`;
}

function exportCsv() {
  const rows = [[
    '구분', '날짜', '선수', '장소', '점수', '라인인세트', '통과퍽', '성공률',
    '2점', '3점', '4점', '1점', '목표관문', '목표시도', '목표명중', '집중키워드', '집중도', '루틴안정', '자세안정', '성찰/메모'
  ]];

  for (const item of state.sessions) {
    rows.push([
      item.kind,
      item.date || '',
      item.player || '',
      item.place || '',
      item.calculated?.score ?? '',
      item.calculated?.sets ?? '',
      item.calculated?.totalIn ?? '',
      item.calculated?.successRate ?? '',
      item.gateTotals?.[2] ?? '',
      item.gateTotals?.[3] ?? '',
      item.gateTotals?.[4] ?? '',
      item.gateTotals?.[1] ?? '',
      item.target?.gate ?? '',
      item.target?.throws ?? '',
      item.target?.hits ?? '',
      item.keyword ?? '',
      item.scores?.focus ?? '',
      item.scores?.routine ?? '',
      item.scores?.posture ?? '',
      item.reflection?.question || item.reflection?.next || item.reflection?.mantra || item.reflection?.good || ''
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sjoelen-training-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('CSV 파일을 내려받았습니다. 구글시트에서 가져오기로 열 수 있습니다.');
}

async function copyScoreSummary() {
  const payload = collectScoreSession();
  const summary = [
    `슐런 일반기록 요약`,
    `날짜: ${payload.date}`,
    `선수: ${payload.player || '-'}`,
    `점수: ${payload.calculated.score}점`,
    `라인인 세트: ${payload.calculated.sets}`,
    `관문분포: 2점 ${payload.gateTotals[2]}, 3점 ${payload.gateTotals[3]}, 4점 ${payload.gateTotals[4]}, 1점 ${payload.gateTotals[1]}`,
    `잘 된 점: ${payload.reflection.good || '-'}`,
    `수정할 점: ${payload.reflection.improve || '-'}`,
    `다음 질문: ${payload.reflection.question || '-'}`
  ].join('\n');
  await navigator.clipboard.writeText(summary);
  toast('요약을 복사했습니다.');
}

function saveSettings() {
  const settings = {
    player: text($('#settingPlayer').value),
    place: text($('#settingPlace').value)
  };
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  applySettingsToForms();
  toast('기기 설정을 저장했습니다.');
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}'); }
  catch { return {}; }
}

function applySettingsToForms() {
  const settings = readSettings();
  $('#settingPlayer').value = settings.player || '';
  $('#settingPlace').value = settings.place || '';
  if (!$('#scorePlayer').value) $('#scorePlayer').value = settings.player || '';
  if (!$('#targetPlayer').value) $('#targetPlayer').value = settings.player || '';
  if (!$('#focusPlayer').value) $('#focusPlayer').value = settings.player || '';
  if (!$('#scorePlace').value) $('#scorePlace').value = settings.place || '';
}

function saveDraft() {
  const draft = {
    score: {
      date: $('#scoreDate').value,
      player: $('#scorePlayer').value,
      place: $('#scorePlace').value,
      goal: $('#scoreGoal').value,
      gateValues: Object.fromEntries([...$$('.gate-input')].map((input) => [input.id, input.value])),
      missShort: $('#missShort').value,
      missLong: $('#missLong').value,
      missLeft: $('#missLeft').value,
      missRight: $('#missRight').value,
      good: $('#scoreGood').value,
      improve: $('#scoreImprove').value,
      question: $('#scoreQuestion').value
    },
    target: {
      date: $('#targetDate').value,
      player: $('#targetPlayer').value,
      gate: $('#targetGate').value,
      throws: $('#targetThrows').value,
      hits: $('#targetHits').value,
      standard: $('#targetStandard').value,
      successFeel: $('#targetSuccessFeel').value,
      failCause: $('#targetFailCause').value,
      next: $('#targetNext').value
    },
    focus: {
      date: $('#focusDate').value,
      player: $('#focusPlayer').value,
      keyword: $('#focusKeyword').value,
      sets: $('#focusSets').value,
      checks: Object.fromEntries(['routineStance','routineGrip','routineEyes','routineBreath','routineRelease','routineFollow'].map((id) => [id, $(`#${id}`).checked])),
      focusScore: $('#focusScore').value,
      routineScore: $('#routineScore').value,
      postureScore: $('#postureScore').value,
      shake: $('#focusShake').value,
      condition: $('#focusCondition').value,
      mantra: $('#focusMantra').value
    }
  };
  localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
}

function restoreDraft() {
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(STORAGE_KEYS.draft) || '{}'); }
  catch { draft = {}; }

  $('#scoreDate').value = draft.score?.date || today();
  $('#targetDate').value = draft.target?.date || today();
  $('#focusDate').value = draft.focus?.date || today();
  $('#reflectionDate').value = today();

  if (draft.score) {
    $('#scorePlayer').value = draft.score.player || '';
    $('#scorePlace').value = draft.score.place || '';
    $('#scoreGoal').value = draft.score.goal || '';
    for (const [id, value] of Object.entries(draft.score.gateValues || {})) {
      const input = $(`#${CSS.escape(id)}`);
      if (input) input.value = value;
    }
    $('#missShort').value = draft.score.missShort || 0;
    $('#missLong').value = draft.score.missLong || 0;
    $('#missLeft').value = draft.score.missLeft || 0;
    $('#missRight').value = draft.score.missRight || 0;
    $('#scoreGood').value = draft.score.good || '';
    $('#scoreImprove').value = draft.score.improve || '';
    $('#scoreQuestion').value = draft.score.question || '';
  }

  if (draft.target) {
    $('#targetPlayer').value = draft.target.player || '';
    $('#targetGate').value = draft.target.gate || '3';
    $('#targetThrows').value = draft.target.throws || 10;
    $('#targetHits').value = draft.target.hits || 0;
    $('#targetStandard').value = draft.target.standard || '10개 중 6개 이상';
    $('#targetSuccessFeel').value = draft.target.successFeel || '';
    $('#targetFailCause').value = draft.target.failCause || '';
    $('#targetNext').value = draft.target.next || '';
  }

  if (draft.focus) {
    $('#focusPlayer').value = draft.focus.player || '';
    $('#focusKeyword').value = draft.focus.keyword || '';
    $('#focusSets').value = draft.focus.sets || 3;
    for (const [id, checked] of Object.entries(draft.focus.checks || {})) {
      const input = $(`#${CSS.escape(id)}`);
      if (input) input.checked = Boolean(checked);
    }
    $('#focusScore').value = draft.focus.focusScore || 3;
    $('#routineScore').value = draft.focus.routineScore || 3;
    $('#postureScore').value = draft.focus.postureScore || 3;
    $('#focusScoreOut').textContent = $('#focusScore').value;
    $('#routineScoreOut').textContent = $('#routineScore').value;
    $('#postureScoreOut').textContent = $('#postureScore').value;
    $('#focusShake').value = draft.focus.shake || '';
    $('#focusCondition').value = draft.focus.condition || '';
    $('#focusMantra').value = draft.focus.mantra || '';
  }

  applySettingsToForms();
  updateLiveScore();
  updateTargetPreview();
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEYS.draft);
  resetScoreForm();
  $('#targetForm').reset();
  $('#focusForm').reset();
  $('#targetDate').value = today();
  $('#focusDate').value = today();
  applySettingsToForms();
  updateTargetPreview();
  toast('현재 기기의 임시기록을 삭제했습니다.');
}

async function initFirebase() {
  if (firebaseConfig.apiKey.includes('여기에')) {
    setSync('offline', '설정 필요', 'firebase-config.js에 Firebase 설정값을 입력하세요.');
    toast('firebase-config.js 설정값을 먼저 입력하세요.');
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  state.auth = auth;
  state.db = db;

  enableIndexedDbPersistence(db).catch((err) => {
    console.warn('오프라인 캐시 사용 불가:', err.code);
  });

  $('#googleLoginBtn').addEventListener('click', loginWithGoogle);
  $('#anonLoginBtn').addEventListener('click', loginAnonymously);
  $('#logoutBtn').addEventListener('click', async () => {
    await signOut(state.auth);
    toast('로그아웃했습니다.');
  });

  setSync('pending', '로그인 선택', 'PC·모바일 동기화는 Google 로그인을 권장합니다.');
  onAuthStateChanged(auth, (user) => {
    if (user) {
      state.uid = user.uid;
      $('#googleLoginBtn').hidden = true;
      $('#anonLoginBtn').hidden = true;
      $('#logoutBtn').hidden = false;
      const label = user.isAnonymous ? '익명 UID' : (user.email || 'Google 사용자');
      setSync('online', '동기화 연결됨', `${label}: ${user.uid.slice(0, 8)}...`);
      subscribeFirestore();
    } else {
      for (const unsub of state.unsubscribers) unsub();
      state.unsubscribers = [];
      state.uid = null;
      state.sessions = [];
      state.reflections = [];
      state.updates = [];
      $('#googleLoginBtn').hidden = false;
      $('#anonLoginBtn').hidden = false;
      $('#logoutBtn').hidden = true;
      setSync('pending', '로그인 필요', 'Google 로그인 또는 이 기기만 사용을 선택하세요.');
      renderDashboard();
      renderRecentList();
      renderReflectionList();
      renderUpdateList();
    }
  });
}

async function loginWithGoogle() {
  try {
    setSync('pending', 'Google 로그인 중', '동일 계정이면 PC·모바일 기록이 동기화됩니다.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(state.auth, provider);
  } catch (err) {
    console.warn('팝업 로그인 실패, 리다이렉트 시도:', err.code);
    if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(state.auth, provider);
      return;
    }
    setSync('offline', '로그인 실패', err.message);
    toast('Google 로그인 실패: Firebase Authentication 설정을 확인하세요.');
  }
}

async function loginAnonymously() {
  try {
    setSync('pending', '익명 로그인 중', '이 브라우저 중심으로 저장됩니다.');
    await signInAnonymously(state.auth);
  } catch (err) {
    console.error(err);
    setSync('offline', '익명 로그인 실패', err.message);
    toast('익명 로그인 실패: Firebase Authentication 설정을 확인하세요.');
  }
}

function init() {
  createQuarterRows();
  bindTabs();
  bindInputs();
  bindForms();
  restoreDraft();
  initFirebase().catch((err) => {
    console.error(err);
    setSync('offline', 'Firebase 오류', err.message);
    toast('Firebase 연결 오류가 발생했습니다.');
  });
}

init();
