import {
  withDefaults, normalizeEntry, DEFAULT_SETTINGS, FEATURE_LABELS, BUILTIN_EXCEPTIONS, RELEASES_URL,
} from '../shared/core.js';

const $ = (id) => document.getElementById(id);
let settings = withDefaults(null);

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

async function save(next, msg = '저장했어요') {
  settings = withDefaults(next);
  await chrome.storage.local.set({ settings });
  render();
  toast(msg);
}

function renderList(id, key) {
  const ul = $(id);
  ul.replaceChildren();
  const items = settings[key];
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '없음';
    ul.append(li);
    return;
  }
  for (const entry of items) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = entry;
    const del = document.createElement('button');
    del.type = 'button';
    del.title = '빼기';
    del.setAttribute('aria-label', `${entry} 빼기`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      const next = { ...settings, [key]: settings[key].filter((x) => x !== entry) };
      if (key === 'strongSites') {
        next.strongFrames = { ...settings.strongFrames };
        delete next.strongFrames[entry];
      }
      save(next, `${entry} 뺐어요`);
    });
    li.append(span, del);
    ul.append(li);
  }
}

function render() {
  $('enabled').checked = settings.enabled;
  $('useBuiltin').checked = settings.useBuiltinExceptions;

  const fBox = $('features');
  fBox.replaceChildren();
  for (const [key, label] of Object.entries(FEATURE_LABELS)) {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = settings.features[key] !== false;
    c.addEventListener('change', () => save({ ...settings, features: { ...settings.features, [key]: c.checked } }));
    l.append(c, document.createTextNode(label));
    fBox.append(l);
  }

  renderList('disabledList', 'disabledSites');
  renderList('strongList', 'strongSites');

  const g = $('builtinList');
  g.replaceChildren();
  g.classList.toggle('off', !settings.useBuiltinExceptions);
  const seen = new Set();
  for (const [pattern, label] of BUILTIN_EXCEPTIONS) {
    const li = document.createElement('li');
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = settings.allowedBuiltin.includes(pattern);
    c.title = '체크하면 이 웹 앱에서도 풀림을 켭니다';
    c.addEventListener('change', () => {
      const set = new Set(settings.allowedBuiltin);
      if (c.checked) set.add(pattern); else set.delete(pattern);
      save({ ...settings, allowedBuiltin: [...set] });
    });
    const text = document.createElement('span');
    const small = document.createElement('small');
    small.textContent = ' ' + pattern;
    text.append(document.createTextNode(seen.has(label) ? label + ' ' : label), small);
    seen.add(label);
    l.append(c, text);
    li.append(l);
    g.append(li);
  }
}

async function renderUpdate(force) {
  const box = $('updateBox');
  box.textContent = '확인하는 중…';
  let info = null;
  try { info = await chrome.runtime.sendMessage({ t: 'updateInfo', force }); } catch {}
  if (!info) { box.textContent = '업데이트 정보를 읽지 못했어요.'; return; }
  const up = info.update || {};
  const auto = info.install && info.install.installer && info.install.installer !== 'manual';
  const lines = [];
  lines.push(`지금 버전 ${info.current}` + (up.latest ? ` · 최신 버전 ${up.latest}` : ''));
  lines.push(auto
    ? '자동 업데이트: 켜짐 — 윈도우의 "풀림 업데이트 도우미"가 새 버전을 받아 두면 브라우저가 몇 분 안에 스스로 다시 불러와요.'
    : '자동 업데이트: 없음 — 직접 압축을 풀어 넣은 경우예요. GitHub 릴리스의 설치 프로그램(Pullim-Setup)으로 설치하면 자동으로 업데이트돼요.');
  if (info.hasNewer) lines.push(`새 버전 ${up.latest} 이 나왔어요.` + (up.notes ? ` (${up.notes})` : ''));
  if (up.error) lines.push(`확인 실패: ${up.error}`);
  box.replaceChildren(...lines.map((t) => { const p = document.createElement('p'); p.textContent = t; return p; }));
}

async function init() {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  $('releases').href = RELEASES_URL;
  settings = withDefaults((await chrome.storage.local.get('settings')).settings);
  render();
  renderUpdate(false);

  $('enabled').addEventListener('change', (e) => save({ ...settings, enabled: e.target.checked }));
  $('useBuiltin').addEventListener('change', (e) => save({ ...settings, useBuiltinExceptions: e.target.checked }));
  for (const form of document.querySelectorAll('form.add')) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const entry = normalizeEntry(input.value);
      if (!entry) { toast('주소 모양이 아니에요 (예: blog.example.com)'); return; }
      const key = form.dataset.list;
      if (settings[key].includes(entry)) { toast('이미 있어요'); return; }
      input.value = '';
      save({ ...settings, [key]: [...settings[key], entry] }, `${entry} 넣었어요`);
    });
  }
  $('checkNow').addEventListener('click', () => renderUpdate(true));
  $('reset').addEventListener('click', () => {
    if (confirm('풀림 설정을 처음 상태로 되돌릴까요? (꺼 둔 사이트 · 강력 모드 사이트 목록이 지워져요)')) {
      save(structuredClone(DEFAULT_SETTINGS), '처음 설정으로 되돌렸어요');
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { settings = withDefaults(changes.settings.newValue); render(); }
  });
}

init();
