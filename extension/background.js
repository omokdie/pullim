// 풀림 — 백그라운드 (서비스 워커)
import {
  withDefaults, siteStatus, strongMatchPatterns, compareVersions,
  CSS_BASIC, CSS_STRONG, LATEST_JSON_URL,
} from './shared/core.js';

const STRONG_SCRIPT_ID = 'pullim-strong-main';
const DISK_CHECK_MIN = 10; // 업데이트 도우미가 파일을 바꿨는지 보는 간격(분)
const REMOTE_CHECK_MIN = 360; // GitHub 에서 새 버전을 확인하는 간격(분)

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}

// ── 글자 선택 CSS (USER 출처: 사이트의 !important · 인라인 스타일보다 셈) ──
async function setCSS(target, css, on) {
  try { await chrome.scripting.removeCSS({ target, css, origin: 'USER' }); } catch {}
  if (on) await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
}

async function onHello(msg, sender) {
  const settings = await getSettings();
  const topUrl = (sender.frameId === 0 ? sender.url : sender.tab && sender.tab.url) || msg.top || sender.url || '';
  const st = siteStatus(settings, topUrl);
  const state = { active: st.active, strong: st.strong, features: settings.features };
  let cssOk = false;
  if (sender.tab && sender.tab.id >= 0) {
    const target = sender.documentId
      ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
      : { tabId: sender.tab.id, frameIds: [sender.frameId || 0] };
    try {
      await setCSS(target, CSS_BASIC, st.active && settings.features.select);
      await setCSS(target, CSS_STRONG, st.strong);
      cssOk = true;
    } catch {}
    if (sender.frameId === 0) updateBadge(sender.tab.id, topUrl, settings);
  }
  return { state, cssOk };
}

// ── '강력 모드가 필요해 보임' 표시 ───────────────────────────
async function getHints() {
  const { hints } = await chrome.storage.session.get('hints');
  return hints && typeof hints === 'object' ? hints : {};
}
async function onHint(msg, sender) {
  if (!sender.tab || sender.tab.id < 0) return;
  const tabId = sender.tab.id;
  const hints = await getHints();
  hints[tabId] = { kind: String(msg.kind || ''), url: sender.tab.url || '', at: Date.now() };
  await chrome.storage.session.set({ hints });
  updateBadge(tabId, sender.tab.url);
}
async function clearHint(tabId) {
  const hints = await getHints();
  if (hints[tabId]) { delete hints[tabId]; await chrome.storage.session.set({ hints }); }
}

// ── 도구 막대 아이콘 글자 ────────────────────────────────────
async function updateBadge(tabId, url, settings) {
  try {
    settings = settings || (await getSettings());
    const st = siteStatus(settings, url || '');
    const hint = (await getHints())[tabId];
    let text = '';
    let color = '#0f766e';
    let title = '풀림 — 우클릭 · 드래그 · 복사 제한 풀림';
    if (!st.scriptable) {
      title = '풀림 — 이 페이지에서는 확장 프로그램이 동작할 수 없어요';
    } else if (!st.active) {
      text = '끔';
      color = '#6b7280';
      title = !st.globalEnabled ? '풀림 — 모든 사이트에서 꺼 둠'
        : st.builtin && !st.builtin.allowed ? `풀림 — ${st.builtin.label}: 자체 메뉴를 쓰는 사이트라 꺼 둠`
          : '풀림 — 이 사이트에서 꺼 둠';
    } else if (st.strong) {
      text = '강';
      color = '#c2410c';
      title = '풀림 — 강력 모드';
    } else if (hint) {
      text = '!';
      color = '#b45309';
      title = '풀림 — 이 사이트는 강력 모드가 필요해 보여요 (눌러서 켜기)';
    }
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await chrome.action.setTitle({ tabId, title });
  } catch {}
}

async function updateAllBadges(settings) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id >= 0) updateBadge(t.id, t.url, settings);
}

// ── 강력 모드 스크립트를 페이지 시작 때 넣도록 등록 ─────────────
async function syncStrongScripts(settings) {
  const matches = strongMatchPatterns(settings);
  let existing = [];
  try { existing = await chrome.scripting.getRegisteredContentScripts({ ids: [STRONG_SCRIPT_ID] }); } catch {}
  try {
    if (!matches.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [STRONG_SCRIPT_ID] });
      return;
    }
    const def = {
      id: STRONG_SCRIPT_ID,
      js: ['content/strong-main.js'],
      matches,
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'MAIN',
      persistAcrossSessions: true,
    };
    if (existing.length) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (e) {
    console.warn('[풀림] 강력 모드 등록 실패', e);
  }
}

// 설치 · 업데이트 직후, 이미 열려 있던 탭에도 바로 적용
async function injectIntoOpenTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!(tab.id >= 0) || !/^(https?|file):/.test(tab.url || '')) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/unlock.js'] });
      if (siteStatus(settings, tab.url).strong) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/strong-main.js'], world: 'MAIN' });
      }
    } catch {}
  }));
}

// ── 자동 업데이트 ────────────────────────────────────────────
// 윈도우 '풀림 업데이트 도우미'가 확장 폴더의 파일을 새 버전으로 바꿔 두면,
// 여기서 그걸 알아채고 확장 프로그램을 스스로 다시 불러온다(브라우저를 껐다 켜지 않아도 됨).
async function checkDisk() {
  const running = chrome.runtime.getManifest().version;
  let disk = '';
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    disk = String((await r.json()).version || '');
  } catch { return; } // 파일을 바꾸는 중이면 다음에
  if (!disk || disk === running) return;
  const { reloadTried } = await chrome.storage.local.get('reloadTried');
  if (reloadTried === disk) return; // 이미 한 번 시도함 — 되풀이하지 않음
  await chrome.storage.local.set({ reloadTried: disk });
  chrome.runtime.reload();
}

async function readInstallInfo() {
  try {
    const r = await fetch(chrome.runtime.getURL('install-info.json'), { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// GitHub 릴리스에서 최신 버전 정보 (팝업 표시용)
async function checkRemote(force = false) {
  const now = Date.now();
  const { update } = await chrome.storage.local.get('update');
  if (!force && update && update.checkedAt && now - update.checkedAt < (REMOTE_CHECK_MIN / 2) * 60e3) return update;
  let next = { ...(update || {}), checkedAt: now, error: '' };
  try {
    const r = await fetch(LATEST_JSON_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? '아직 올라간 릴리스가 없어요' : 'HTTP ' + r.status);
    const j = await r.json();
    next = {
      checkedAt: now,
      latest: String(j.version || ''),
      notes: String(j.notes || ''),
      setupUrl: j.setup && typeof j.setup.url === 'string' ? j.setup.url : '',
      minHelper: Number(j.minHelper || 1),
      error: '',
    };
  } catch (e) {
    next.error = String((e && e.message) || e);
  }
  await chrome.storage.local.set({ update: next });
  return next;
}

async function updateInfo(force) {
  const [update, install] = await Promise.all([checkRemote(force), readInstallInfo()]);
  const current = chrome.runtime.getManifest().version;
  return {
    current,
    update,
    install,
    hasNewer: !!(update && update.latest && compareVersions(update.latest, current) > 0),
  };
}

function setupAlarms() {
  chrome.alarms.create('pullim-disk', { periodInMinutes: DISK_CHECK_MIN, delayInMinutes: 1 });
  chrome.alarms.create('pullim-remote', { periodInMinutes: REMOTE_CHECK_MIN, delayInMinutes: 3 });
}

// ── 이벤트 ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return undefined;
  if (msg.t === 'hello') { onHello(msg, sender).then(sendResponse, () => sendResponse(null)); return true; }
  if (msg.t === 'hint') { onHint(msg, sender); return undefined; }
  if (msg.t === 'updateInfo') { updateInfo(!!msg.force).then(sendResponse, () => sendResponse(null)); return true; }
  if (msg.t === 'clearHint' && Number.isInteger(msg.tabId)) { clearHint(msg.tabId).then(() => sendResponse(true)); return true; }
  return undefined;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const s = withDefaults(changes.settings.newValue);
  syncStrongScripts(s);
  updateAllBadges(s);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const tab = await chrome.tabs.get(tabId); updateBadge(tabId, tab.url); } catch {}
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url) {
    const hints = await getHints();
    const h = hints[tabId];
    if (h) {
      let same = false;
      try { same = new URL(h.url).host === new URL(info.url).host; } catch {}
      if (!same) await clearHint(tabId);
    }
  }
  if (info.url || info.status) updateBadge(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => { clearHint(tabId); });

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'pullim-disk') checkDisk();
  else if (a.name === 'pullim-remote') checkRemote();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: s });
  await syncStrongScripts(s);
  setupAlarms();
  await injectIntoOpenTabs();
  updateAllBadges(s);
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html#welcome') });
  }
  checkRemote(true);
});

// 시험 · 문제 찾기용 (서비스 워커 콘솔에서 __pullim.checkDisk() 등)
globalThis.__pullim = { checkDisk, checkRemote, updateInfo, syncStrongScripts, getSettings };

chrome.runtime.onStartup.addListener(async () => {
  setupAlarms();
  syncStrongScripts(await getSettings());
  checkDisk();
});
