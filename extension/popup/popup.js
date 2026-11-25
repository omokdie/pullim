import {
  withDefaults, siteStatus, setSiteActive, setSiteStrong, RELEASES_URL,
} from '../shared/core.js';

const $ = (id) => document.getElementById(id);
let tab = null;
let settings = withDefaults(null);

async function saveSettings(next) {
  settings = withDefaults(next);
  await chrome.storage.local.set({ settings });
  render();
}

function render() {
  const url = (tab && tab.url) || '';
  const st = siteStatus(settings, url);

  $('globalToggle').checked = settings.enabled;
  $('siteCard').hidden = !st.scriptable;
  $('restricted').hidden = st.scriptable;
  if (!st.scriptable) return;

  $('host').textContent = st.isFile ? '내 컴퓨터의 파일' : st.host;

  const siteOn = st.isFile ? settings.enabled : (st.active || (!st.globalEnabled && !st.userDisabled && !(st.builtin && !st.builtin.allowed)));
  const t = $('siteTitle');
  if (!st.globalEnabled) {
    t.textContent = '모든 사이트에서 꺼 둠';
    t.className = 'title off';
    $('siteSub').textContent = '아래 "모든 사이트에서 사용"을 켜면 다시 동작해요';
  } else if (st.active) {
    t.textContent = st.strong ? '강력 모드로 풀림' : '제한 풀림 켜짐';
    t.className = 'title ' + (st.strong ? 'strong' : 'on');
    $('siteSub').textContent = '우클릭 · 드래그 · 복사가 풀려 있어요';
  } else {
    t.textContent = '이 사이트에서 꺼 둠';
    t.className = 'title off';
    $('siteSub').textContent = st.builtin && !st.builtin.allowed ? '자체 메뉴를 쓰는 웹 앱이라 기본으로 꺼 둔 사이트' : '사이트 원래대로 동작해요';
  }

  const siteToggle = $('siteToggle');
  siteToggle.checked = siteOn;
  siteToggle.disabled = !st.globalEnabled || st.isFile;

  const note = $('builtinNote');
  if (st.builtin && st.globalEnabled) {
    note.hidden = false;
    note.textContent = st.builtin.allowed
      ? `${st.builtin.label} — 원래는 꺼 두는 웹 앱인데 켜 두었어요. 사이트 자체 메뉴 대신 브라우저 메뉴가 나와요.`
      : `${st.builtin.label} — 자체 우클릭 메뉴와 복사 기능을 쓰는 웹 앱이라 기본으로 꺼 뒀어요. 켜면 사이트 메뉴 대신 브라우저 메뉴가 나와요.`;
  } else {
    note.hidden = true;
  }

  const strongToggle = $('strongToggle');
  strongToggle.checked = st.strong;
  strongToggle.disabled = !st.active || st.isFile;
  $('strongRow').classList.toggle('muted', !st.active);
}

async function renderHint() {
  if (!tab) return;
  let hints = {};
  try { hints = (await chrome.storage.session.get('hints')).hints || {}; } catch {}
  const h = hints[tab.id];
  const st = siteStatus(settings, tab.url || '');
  $('hintBox').hidden = !(h && st.active && !st.strong);
}

function showReload() { $('reloadBtn').hidden = false; }

async function frameHosts() {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => location.hostname });
    return res.map((r) => r && r.result).filter((h) => typeof h === 'string' && h);
  } catch { return []; }
}

async function setStrong(on) {
  const frames = on ? await frameHosts() : [];
  await saveSettings(setSiteStrong(settings, tab.url, on, frames));
  if (on) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/strong-main.js'], world: 'MAIN' });
    } catch {}
    try { await chrome.runtime.sendMessage({ t: 'clearHint', tabId: tab.id }); } catch {}
    $('hintBox').hidden = true;
  }
  showReload();
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function renderUpdate(force = false) {
  const box = $('update');
  if (force) box.textContent = '확인하는 중…';
  let info = null;
  try { info = await chrome.runtime.sendMessage({ t: 'updateInfo', force }); } catch {}
  if (!info) { box.textContent = '업데이트 정보를 읽지 못했어요'; return; }
  const auto = info.install && info.install.installer && info.install.installer !== 'manual';
  const up = info.update || {};
  box.className = 'update muted';
  box.replaceChildren();
  if (info.hasNewer) {
    box.className = 'update new';
    const b = document.createElement('b');
    b.textContent = `새 버전 ${up.latest}`;
    box.append(b, auto ? ' 이 나왔어요. 자동 업데이트 도우미가 곧 설치해요.' : ' 이 나왔어요. ');
    if (!auto) {
      const a = document.createElement('a');
      a.href = RELEASES_URL; a.target = '_blank'; a.textContent = '받으러 가기';
      box.append(a);
    }
    if (up.notes) box.title = up.notes;
  } else if (up.error && !up.latest) {
    box.textContent = `v${info.current} · 업데이트 확인 실패 (${up.error})`;
  } else {
    box.textContent = `최신 버전이에요 (v${info.current})` + (auto ? ' · 자동 업데이트 켜짐' : ' · 자동 업데이트 없음(직접 설치)');
    if (up.checkedAt) box.title = '마지막 확인 ' + fmtTime(up.checkedAt);
  }
}

async function init() {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  const forced = Number(new URLSearchParams(location.search).get('tab')); // 시험용: popup.html?tab=<id>
  tab = forced ? await chrome.tabs.get(forced).catch(() => null) : null;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  settings = withDefaults((await chrome.storage.local.get('settings')).settings);
  render();
  renderHint();
  renderUpdate(false);

  $('siteToggle').addEventListener('change', (e) => saveSettings(setSiteActive(settings, tab.url, e.target.checked)));
  $('strongToggle').addEventListener('change', (e) => setStrong(e.target.checked));
  $('hintStrong').addEventListener('click', () => setStrong(true));
  $('globalToggle').addEventListener('change', (e) => saveSettings({ ...settings, enabled: e.target.checked }));
  $('reloadBtn').addEventListener('click', async () => { await chrome.tabs.reload(tab.id); window.close(); });
  $('openOptions').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  $('openGuide').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') }); window.close(); });
  $('recheck').addEventListener('click', (e) => { e.preventDefault(); renderUpdate(true); });
}

init();
