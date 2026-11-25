// 풀림 — 설정 · 사이트 판단 (팝업 · 설정 화면 · 백그라운드가 함께 씀, 시험은 test/core_test.mjs)

export const REPO = 'omokdie/pullim';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const LATEST_JSON_URL = `${REPO_URL}/releases/latest/download/latest.json`;

export const FEATURE_LABELS = {
  contextmenu: '우클릭 메뉴',
  select: '글자 선택(드래그)',
  copy: '복사 · 잘라내기',
  keys: '단축키 (Ctrl+C · Ctrl+A · Ctrl+X)',
  drag: '끌어서 옮기기',
};

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  features: { contextmenu: true, select: true, copy: true, keys: true, drag: true },
  useBuiltinExceptions: true,
  disabledSites: [],   // 사용자가 끈 사이트 (호스트, 하위 도메인 포함)
  strongSites: [],     // 강력 모드 사이트
  strongFrames: {},    // 강력 모드 사이트 → 그 안의 프레임 호스트들
  allowedBuiltin: [],  // 기본 예외(웹 앱) 가운데 사용자가 켠 것
});

// 자체 우클릭 메뉴 · 복사 기능을 쓰는 웹 앱. 여기서는 기본으로 꺼 둔다 (팝업에서 켤 수 있음).
export const BUILTIN_EXCEPTIONS = [
  ['docs.google.com', '구글 문서 · 스프레드시트 · 프레젠테이션'],
  ['drive.google.com', '구글 드라이브'],
  ['mail.google.com', '지메일'],
  ['google.com/maps', '구글 지도'],
  ['maps.google.com', '구글 지도'],
  ['earth.google.com', '구글 어스'],
  ['remotedesktop.google.com', '크롬 원격 데스크톱'],
  ['youtube.com', '유튜브 (영상 플레이어 메뉴)'],
  ['twitch.tv', '트위치'],
  ['open.spotify.com', '스포티파이'],
  ['figma.com', '피그마'],
  ['canva.com', '캔바'],
  ['miro.com', '미로'],
  ['notion.so', '노션'],
  ['office.com', 'Microsoft 365'],
  ['officeapps.live.com', 'Office 웹'],
  ['sharepoint.com', 'SharePoint · OneDrive'],
  ['onedrive.live.com', 'OneDrive'],
  ['outlook.live.com', 'Outlook'],
  ['outlook.office.com', 'Outlook'],
  ['teams.microsoft.com', 'Teams'],
  ['teams.live.com', 'Teams'],
  ['vscode.dev', 'VS Code 웹'],
  ['github.dev', 'GitHub 편집기'],
  ['codesandbox.io', 'CodeSandbox'],
  ['stackblitz.com', 'StackBlitz'],
  ['replit.com', 'Replit'],
  ['photopea.com', 'Photopea'],
  ['excalidraw.com', 'Excalidraw'],
  ['app.diagrams.net', 'draw.io'],
  ['discord.com', '디스코드'],
  ['app.slack.com', '슬랙'],
  ['web.whatsapp.com', 'WhatsApp'],
  ['web.telegram.org', '텔레그램'],
  ['trello.com', '트렐로'],
  ['atlassian.net', 'Jira · Confluence'],
  ['map.naver.com', '네이버 지도'],
  ['map.kakao.com', '카카오맵'],
];

// 확장 프로그램이 들어갈 수 없는 페이지 (브라우저 규칙)
const STORE_PAGES = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
  'microsoftedge.microsoft.com/addons',
  'store.whale.naver.com',
];

export function withDefaults(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.features = { ...DEFAULT_SETTINGS.features, ...(raw && raw.features) };
  for (const k of ['disabledSites', 'strongSites', 'allowedBuiltin']) {
    s[k] = Array.isArray(s[k]) ? s[k].filter((x) => typeof x === 'string' && x) : [];
  }
  s.strongFrames = s.strongFrames && typeof s.strongFrames === 'object' ? s.strongFrames : {};
  s.enabled = s.enabled !== false;
  s.useBuiltinExceptions = s.useBuiltinExceptions !== false;
  return s;
}

export function parseSite(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  return { protocol: u.protocol, host: u.hostname.toLowerCase().replace(/\.$/, ''), path: u.pathname || '/' };
}

// 사용자가 적은 항목을 "호스트[/경로]" 모양으로 정리. 틀린 모양이면 ''.
export function normalizeEntry(text) {
  let t = String(text || '').trim().toLowerCase();
  if (!t) return '';
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').replace(/^\.+/, '');
  const slash = t.indexOf('/');
  let host = slash < 0 ? t : t.slice(0, slash);
  let path = slash < 0 ? '' : t.slice(slash);
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) return '';
  path = path.replace(/[?#].*$/, '').replace(/\*+$/, '').replace(/\/+$/, '');
  return host + path;
}

// 항목 "example.com" 은 example.com 과 모든 하위 도메인, "google.com/maps" 는 그 경로 아래만.
export function matchEntry(entry, host, path = '/') {
  const e = normalizeEntry(entry);
  if (!e || !host) return false;
  const slash = e.indexOf('/');
  const eh = slash < 0 ? e : e.slice(0, slash);
  const ep = slash < 0 ? '' : e.slice(slash);
  if (host !== eh && !host.endsWith('.' + eh)) return false;
  if (!ep) return true;
  return path === ep || path.startsWith(ep + '/');
}

const isIPv4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const SECOND_LEVEL = new Set(['co', 'or', 'go', 'ac', 'ne', 're', 'pe', 'com', 'net', 'org', 'edu', 'gov', 'mil']);

// 대략적인 "같은 사이트" 열쇠 (blog.naver.com → naver.com, www.example.co.kr → example.co.kr)
export function siteKey(host) {
  const h = String(host || '').toLowerCase();
  if (!h || isIPv4(h) || !h.includes('.')) return h;
  const parts = h.split('.');
  const n = parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

export function isScriptable(site) {
  if (!site) return false;
  if (site.protocol === 'file:') return true;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') return false;
  return !STORE_PAGES.some((p) => matchEntry(p, site.host, site.path));
}

export function builtinFor(site) {
  if (!site || !site.host) return null;
  const hit = BUILTIN_EXCEPTIONS.find(([p]) => matchEntry(p, site.host, site.path));
  return hit ? { pattern: hit[0], label: hit[1] } : null;
}

// 지금 페이지(맨 위 주소)에서 풀림이 할 일
export function siteStatus(rawSettings, url) {
  const s = withDefaults(rawSettings);
  const site = parseSite(url);
  const scriptable = isScriptable(site);
  const host = site ? site.host : '';
  const isFile = !!site && site.protocol === 'file:';
  const builtin = s.useBuiltinExceptions && !isFile ? builtinFor(site) : null;
  const builtinAllowed = !!builtin && s.allowedBuiltin.includes(builtin.pattern);
  const userDisabled = !isFile && s.disabledSites.some((p) => matchEntry(p, host, site.path));
  const strongHit = !isFile && s.strongSites.some((p) => matchEntry(p, host, site.path));
  const active = scriptable && s.enabled && !userDisabled && !(builtin && !builtinAllowed);
  return {
    scriptable,
    isFile,
    host,
    globalEnabled: s.enabled,
    userDisabled,
    builtin: builtin ? { ...builtin, allowed: builtinAllowed } : null,
    active,
    strong: active && strongHit,
    strongSaved: strongHit,
  };
}

const uniq = (a) => [...new Set(a)];

// 이 사이트에서 켜기 / 끄기
export function setSiteActive(rawSettings, url, on) {
  const s = withDefaults(rawSettings);
  const site = parseSite(url);
  if (!site || !site.host) return s;
  const builtin = s.useBuiltinExceptions ? builtinFor(site) : null;
  if (on) {
    s.disabledSites = s.disabledSites.filter((p) => !matchEntry(p, site.host, site.path));
    if (builtin) s.allowedBuiltin = uniq([...s.allowedBuiltin, builtin.pattern]);
  } else if (builtin && s.allowedBuiltin.includes(builtin.pattern)) {
    s.allowedBuiltin = s.allowedBuiltin.filter((p) => p !== builtin.pattern);
  } else if (!s.disabledSites.some((p) => matchEntry(p, site.host, site.path))) {
    s.disabledSites = [...s.disabledSites, site.host];
  }
  return s;
}

// 강력 모드 켜기 / 끄기 (frames: 그 탭 안 프레임들의 호스트)
export function setSiteStrong(rawSettings, url, on, frames = []) {
  const s = withDefaults(rawSettings);
  const site = parseSite(url);
  if (!site || !site.host) return s;
  const host = site.host;
  const strongFrames = { ...s.strongFrames };
  if (on) {
    s.strongSites = uniq([...s.strongSites, host]);
    // 같은 사이트의 프레임만 (광고 프레임까지 강력 모드를 퍼뜨리지 않음)
    const extra = uniq(frames.map(normalizeEntry)
      .filter((h) => h && !h.includes('/') && h !== host && siteKey(h) === siteKey(host)));
    if (extra.length) strongFrames[host] = extra; else delete strongFrames[host];
  } else {
    s.strongSites = s.strongSites.filter((p) => !matchEntry(p, host, site.path));
    for (const k of Object.keys(strongFrames)) if (matchEntry(k, host, site.path)) delete strongFrames[k];
  }
  s.strongFrames = strongFrames;
  return s;
}

// 강력 모드 스크립트를 미리 심을 주소 모양 (chrome.scripting.registerContentScripts)
export function strongMatchPatterns(rawSettings) {
  const s = withDefaults(rawSettings);
  if (!s.enabled) return [];
  const hosts = [];
  for (const p of s.strongSites) {
    const e = normalizeEntry(p);
    if (!e) continue;
    hosts.push(e.split('/')[0]);
    const fr = s.strongFrames[p];
    if (Array.isArray(fr)) for (const f of fr) { const h = normalizeEntry(f); if (h) hosts.push(h.split('/')[0]); }
  }
  // "*.example.com" 은 example.com 자신도 포함
  return uniq(hosts).map((h) => (isIPv4(h) || !h.includes('.') ? `*://${h}/*` : `*://*.${h}/*`));
}

export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 사용자가 고른 글자 선택 막기를 풀어 주는 CSS (USER 출처로 넣어 사이트의 !important 도 이김)
export const CSS_BASIC = `html, body, body *:not(button):not(select):not(option):not([role="button"]):not([role="slider"]):not([role="scrollbar"]):not([role="separator"]):not([draggable="true"]) {
  -webkit-user-select: auto !important;
  user-select: auto !important;
}`;

export const CSS_STRONG = `::selection { background-color: rgba(45, 140, 255, 0.35) !important; }
img { pointer-events: auto !important; -webkit-user-drag: auto !important; }`;
