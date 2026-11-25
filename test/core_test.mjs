// node test/core_test.mjs — 설정 · 사이트 판단 규칙
import assert from 'node:assert/strict';
import {
  withDefaults, matchEntry, normalizeEntry, siteStatus, setSiteActive, setSiteStrong,
  strongMatchPatterns, compareVersions, siteKey, isScriptable, parseSite,
} from '../extension/shared/core.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('항목 정리', () => {
  assert.equal(normalizeEntry('https://Blog.Naver.com/abc?x=1'), 'blog.naver.com/abc');
  assert.equal(normalizeEntry('*.example.com'), 'example.com');
  assert.equal(normalizeEntry('example.com:8080/path/'), 'example.com/path');
  assert.equal(normalizeEntry('  '), '');
  assert.equal(normalizeEntry('not a host'), '');
  assert.equal(normalizeEntry('a..b'), '');
});

t('하위 도메인 · 경로 일치', () => {
  assert.ok(matchEntry('youtube.com', 'www.youtube.com'));
  assert.ok(matchEntry('youtube.com', 'youtube.com'));
  assert.ok(!matchEntry('youtube.com', 'notyoutube.com'));
  assert.ok(matchEntry('google.com/maps', 'www.google.com', '/maps/place/x'));
  assert.ok(matchEntry('google.com/maps', 'www.google.com', '/maps'));
  assert.ok(!matchEntry('google.com/maps', 'www.google.com', '/mapsx'));
  assert.ok(!matchEntry('google.com/maps', 'www.google.com', '/search'));
  assert.ok(!matchEntry('www.naver.com', 'blog.naver.com'));
});

t('기본값: 모든 사이트 켜짐, 웹 앱 예외는 꺼짐', () => {
  const s = withDefaults(null);
  assert.equal(siteStatus(s, 'https://blog.naver.com/x/1').active, true);
  const docs = siteStatus(s, 'https://docs.google.com/document/d/1');
  assert.equal(docs.active, false);
  assert.equal(docs.builtin.pattern, 'docs.google.com');
  assert.equal(siteStatus(s, 'https://www.google.com/search?q=1').active, true);
  assert.equal(siteStatus(s, 'https://www.google.com/maps/@1,2').active, false);
});

t('브라우저가 막는 페이지', () => {
  for (const u of ['chrome://extensions', 'edge://settings', 'whale://extensions', 'about:blank',
    'https://chromewebstore.google.com/detail/x', 'https://microsoftedge.microsoft.com/addons/detail/x', 'https://store.whale.naver.com/x']) {
    assert.equal(siteStatus(null, u).scriptable, false, u);
    assert.equal(siteStatus(null, u).active, false, u);
  }
  assert.ok(isScriptable(parseSite('file:///C:/a.html')));
});

t('이 사이트 끄기 · 켜기', () => {
  let s = setSiteActive(null, 'https://blog.naver.com/a/1', false);
  assert.deepEqual(s.disabledSites, ['blog.naver.com']);
  assert.equal(siteStatus(s, 'https://blog.naver.com/b').active, false);
  assert.equal(siteStatus(s, 'https://cafe.naver.com/b').active, true);
  s = setSiteActive(s, 'https://blog.naver.com/a/1', true);
  assert.deepEqual(s.disabledSites, []);
});

t('웹 앱 예외 켜기 · 다시 끄기', () => {
  let s = setSiteActive(null, 'https://www.youtube.com/watch?v=1', true);
  assert.deepEqual(s.allowedBuiltin, ['youtube.com']);
  assert.equal(siteStatus(s, 'https://m.youtube.com/').active, true);
  s = setSiteActive(s, 'https://www.youtube.com/', false);
  assert.deepEqual(s.allowedBuiltin, []);
  assert.deepEqual(s.disabledSites, []);
  assert.equal(siteStatus(s, 'https://www.youtube.com/').active, false);
});

t('모든 사이트 끄기', () => {
  const s = withDefaults({ enabled: false });
  const st = siteStatus(s, 'https://example.com/');
  assert.equal(st.active, false);
  assert.equal(st.globalEnabled, false);
  assert.deepEqual(strongMatchPatterns({ enabled: false, strongSites: ['a.com'] }), []);
});

t('강력 모드 + 같은 사이트 프레임만', () => {
  let s = setSiteStrong(null, 'https://blog.naver.com/a', true,
    ['blog.naver.com', 'blogfiles.naver.com', 'ad.doubleclick.net', '', 'x y']);
  assert.deepEqual(s.strongSites, ['blog.naver.com']);
  assert.deepEqual(s.strongFrames['blog.naver.com'], ['blogfiles.naver.com']);
  const st = siteStatus(s, 'https://blog.naver.com/a');
  assert.equal(st.strong, true);
  assert.deepEqual(strongMatchPatterns(s).sort(), ['*://*.blog.naver.com/*', '*://*.blogfiles.naver.com/*']);
  // 꺼진 사이트면 강력 모드도 아님
  const off = setSiteActive(s, 'https://blog.naver.com/a', false);
  assert.equal(siteStatus(off, 'https://blog.naver.com/a').strong, false);
  s = setSiteStrong(s, 'https://blog.naver.com/a', false);
  assert.deepEqual(s.strongSites, []);
  assert.deepEqual(s.strongFrames, {});
  assert.deepEqual(strongMatchPatterns(s), []);
});

t('IP · localhost 주소 모양', () => {
  const s = withDefaults({ strongSites: ['127.0.0.1', 'localhost'] });
  assert.deepEqual(strongMatchPatterns(s), ['*://127.0.0.1/*', '*://localhost/*']);
});

t('같은 사이트 열쇠', () => {
  assert.equal(siteKey('blog.naver.com'), 'naver.com');
  assert.equal(siteKey('www.example.co.kr'), 'example.co.kr');
  assert.equal(siteKey('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteKey('127.0.0.1'), '127.0.0.1');
});

t('버전 비교', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

t('망가진 설정도 견딤', () => {
  const s = withDefaults({ disabledSites: 'x', features: null, strongFrames: 3, enabled: 'yes' });
  assert.deepEqual(s.disabledSites, []);
  assert.equal(s.features.copy, true);
  assert.deepEqual(s.strongFrames, {});
  assert.equal(s.enabled, true);
});

console.log(`\n${n}개 모두 통과`);
