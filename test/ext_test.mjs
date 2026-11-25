// node test/ext_test.mjs — 실제 크롬에 풀림을 넣고 막힌 페이지들에서 동작 확인
//   CHROME=/path/to/chrome (기본 /usr/bin/google-chrome), SHOTS=1 이면 test/tmp 에 화면 저장
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = !!process.env.SHOTS;
mkdirSync(path.join(ROOT, 'test/tmp'), { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '0.0.0.0', '--directory', path.join(ROOT, 'test/pages')], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);

let failures = 0;
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok -', name); } catch (e) { failures++; console.log('FAIL -', name, '\n   ', e && e.message); }
}

async function launch(withExt, extDir) {
  // 사용자는 '개발자 모드'를 켜고 풀림을 불러오므로 시험 프로필도 똑같이 (꺼져 있으면 크롬 134+ 가 다시 불러올 때 막음)
  const udd = mkdtempSync(path.join(tmpdir(), 'pullim-profile-'));
  mkdirSync(path.join(udd, 'Default'), { recursive: true });
  writeFileSync(path.join(udd, 'Default/Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, enableExtensions: withExt, userDataDir: udd,
    args: ['--no-sandbox', '--window-size=1200,900'], defaultViewport: { width: 1100, height: 800 },
  });
  let id = null; let sw = null;
  if (withExt) {
    id = await browser.installExtension(extDir);
    sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id))).worker();
    for (let i = 0; i < 50; i++) { // onInstalled 가 설정을 써 둘 때까지
      if ((await sw.evaluate(() => chrome.storage.local.get('settings'))).settings) break;
      await sleep(100);
    }
  }
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  return { browser, id, sw };
}

async function swOf(browser, id, not = null) {
  const t = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id) && t !== not, { timeout: 10000 });
  return [t, await t.worker()];
}
async function closeBrowser(browser) {
  const proc = browser.process();
  await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
  try { proc && proc.kill('SIGKILL'); } catch {}
}

async function setSettings(sw, patch) {
  await sw.evaluate(async (patch) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  }, patch);
  await sleep(350);
}

async function open(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(500); // 풀림이 설정을 받고 CSS 를 넣을 시간
  return page;
}

async function textBox(target, sel) {
  return target.$eval(sel, (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = rg.getClientRects();
    const a = rs[0]; const b = rs[rs.length - 1];
    return { x1: a.left + 2, y1: a.top + a.height / 2, x2: b.right - 2, y2: b.top + b.height / 2 };
  });
}

async function dragSelect(page, sel, frame = null, offset = { x: 0, y: 0 }) {
  const b = await textBox(frame || page, sel);
  await page.mouse.click(5, 5); // 이전 선택 지우기
  await page.mouse.move(b.x1 + offset.x, b.y1 + offset.y);
  await page.mouse.down();
  await page.mouse.move(b.x2 + offset.x, b.y2 + offset.y, { steps: 15 });
  await page.mouse.up();
  await sleep(150);
  return (frame || page).evaluate(() => String(getSelection()));
}

async function rightClick(page, sel, opts = {}, frame = null, offset = { x: 0, y: 0 }) {
  const b = await textBox(frame || page, sel);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click((b.x1 + b.x2) / 2 + offset.x, b.y1 + offset.y, { button: 'right' });
  if (opts.shift) await page.keyboard.up('Shift');
  await sleep(100);
}

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await sleep(150);
}

const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const setClip = (page, t) => page.evaluate((t) => navigator.clipboard.writeText(t), t);
const hits = (target) => target.evaluate(() => ({ ...window.__hits }));
const userSelect = (target, sel) => target.$eval(sel, (el) => getComputedStyle(el).userSelect);

// ─────────────────────────────────────────────────────────────
console.log(`# 대조군: 풀림 없이 (${BASE})`);
{
  const { browser } = await launch(false);
  await test('막힌 블로그는 정말 막혀 있다 (풀림 없을 때)', async () => {
    const page = await open(browser, `${BASE}/basic.html`);
    assert.equal(await dragSelect(page, '#p1'), '');
    await rightClick(page, '#p1');
    const h = await hits(page);
    assert.ok(h.ctx >= 1, '우클릭 처리기가 불려야 함');
    assert.equal(await userSelect(page, '#p2'), 'none');
    await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p1')); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await setClip(page, 'BEFORE');
    await ctrl(page, 'KeyC');
    assert.equal(await clip(page), 'BEFORE');
    assert.ok((await hits(page)).key >= 1);
  });
  await test('출처 붙이는 신문은 복사에 글을 덧붙인다 (풀림 없을 때)', async () => {
    const page = await open(browser, `${BASE}/append.html`);
    await dragSelect(page, '#p1');
    await ctrl(page, 'KeyC');
    assert.match(await clip(page), /\[출처\]/);
  });
  await closeBrowser(browser);
}

// ─────────────────────────────────────────────────────────────
console.log('\n# 풀림 켬');
const extCopy = mkdtempSync(path.join(tmpdir(), 'pullim-ext-'));
cpSync(path.join(ROOT, 'extension'), extCopy, { recursive: true });
const { browser, id, sw: sw0 } = await launch(true, extCopy);
const killer = setTimeout(() => { console.log('시간 초과'); try { browser.process().kill('SIGKILL'); } catch {} process.exit(2); }, 240000);
let sw = sw0;

await test('설치하면 환영 안내 탭이 열리고 기본 설정이 저장된다', async () => {
  await sleep(300);
  const urls = (await browser.pages()).map((p) => p.url());
  assert.ok(urls.some((u) => u.endsWith('/guide.html#welcome')), urls.join(', '));
  const { settings } = await sw.evaluate(() => chrome.storage.local.get('settings'));
  assert.equal(settings.enabled, true);
});

await test('우클릭 · 드래그 · Ctrl+C · Ctrl+A 가 풀린다 (티스토리식 막기)', async () => {
  const page = await open(browser, `${BASE}/basic.html`);
  assert.equal(await userSelect(page, '#p1'), 'auto');
  assert.equal(await userSelect(page, '#p2'), 'auto', '인라인 !important 도 이겨야 함');
  const s = await dragSelect(page, '#p1');
  assert.match(s, /첫째 문단입니다/);
  await setClip(page, 'BEFORE');
  await ctrl(page, 'KeyC');
  assert.match(await clip(page), /첫째 문단입니다/);
  await rightClick(page, '#p1');
  await ctrl(page, 'KeyA');
  assert.match(await page.evaluate(() => String(getSelection())), /둘째 문단/);
  const h = await hits(page);
  assert.deepEqual({ ctx: h.ctx, sel: h.sel, copy: h.copy, key: h.key, alert: h.alert }, { ctx: 0, sel: 0, copy: 0, key: 0, alert: 0 });
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'test/tmp/basic-selected.png') });
});

await test('입력 칸 안의 복사 · 우클릭은 사이트에 맡긴다', async () => {
  const page = await open(browser, `${BASE}/editor.html`);
  await setClip(page, 'BEFORE');
  await page.click('#ed');
  await ctrl(page, 'KeyA'); // 편집기 안 Ctrl+A 는 편집기 것
  await ctrl(page, 'KeyC');
  assert.match(await clip(page), /^EDITOR:편집기/);
  await page.click('#field', { button: 'right' });
  const h = await hits(page);
  assert.equal(h.edcopy, 1);
  assert.equal(h.inputctx, 1);
});

await test('복사에 덧붙는 "출처" 글이 빠진다', async () => {
  const page = await open(browser, `${BASE}/append.html`);
  await dragSelect(page, '#p1');
  await setClip(page, 'BEFORE');
  await ctrl(page, 'KeyC');
  assert.equal((await clip(page)).trim(), '기사 본문 한 줄입니다');
  assert.equal((await hits(page)).copy, 0);
});

await test('Shift + 우클릭은 사이트 자체 메뉴', async () => {
  const page = await open(browser, `${BASE}/webapp.html`);
  await rightClick(page, '#p1');
  assert.equal((await hits(page)).menu, 0);
  await rightClick(page, '#p1', { shift: true });
  assert.equal((await hits(page)).menu, 1);
});

await test('다른 주소의 프레임 안도 풀린다', async () => {
  const page = await open(browser, `${BASE}/iframe.html`);
  await sleep(400);
  const fe = await page.$('#f');
  const frame = await fe.contentFrame();
  const box = await fe.boundingBox();
  const off = { x: box.x + 1, y: box.y + 1 };
  assert.equal(await userSelect(frame, '#p1'), 'auto');
  const s = await dragSelect(page, '#p1', frame, off);
  assert.match(s, /프레임 속 글/);
  await rightClick(page, '#p1', {}, frame, off);
  const h = await hits(frame);
  assert.equal(h.ctx + h.sel, 0);
});

await test('srcdoc · document.write 로 만든 빈(about:blank) 프레임도 풀린다', async () => {
  const page = await open(browser, `${BASE}/blankframe.html`);
  await sleep(400);
  for (const id of ['#s', '#w']) {
    const fe = await page.$(id);
    const frame = await fe.contentFrame();
    const box = await fe.boundingBox();
    const off = { x: box.x + 1, y: box.y + 1 };
    assert.equal(await userSelect(frame, '#p1'), 'auto', id + ' CSS');
    const s = await dragSelect(page, '#p1', frame, off);
    assert.match(s, /프레임 속 글/, id + ' 선택');
    await rightClick(page, '#p1', {}, frame, off);
  }
  const h = await hits(page);
  assert.equal(h.ctx + h.sel, 0, JSON.stringify(h));
});

await test('이 사이트 끄기 — 새로고침 없이 바로 원래대로, 다시 켜면 바로 풀림', async () => {
  const page = await open(browser, `${BASE}/basic.html`);
  await setSettings(sw, { disabledSites: ['127.0.0.1'] });
  assert.equal(await userSelect(page, '#p1'), 'none');
  await rightClick(page, '#p1');
  assert.ok((await hits(page)).ctx >= 1);
  await setSettings(sw, { disabledSites: [] });
  const before = (await hits(page)).ctx;
  await rightClick(page, '#p1');
  assert.equal((await hits(page)).ctx, before);
  assert.equal(await userSelect(page, '#p1'), 'auto');
});

await test('꺼 둔 사이트의 프레임도 꺼진다 (맨 위 주소 기준)', async () => {
  await setSettings(sw, { disabledSites: ['127.0.0.1'] });
  const page = await open(browser, `${BASE}/iframe.html`);
  await sleep(400);
  const frame = await (await page.$('#f')).contentFrame();
  assert.equal(await userSelect(frame, '#p1'), 'none');
  await setSettings(sw, { disabledSites: [] });
});

await test('모든 사이트 끄기', async () => {
  await setSettings(sw, { enabled: false });
  const page = await open(browser, `${BASE}/basic.html`);
  await rightClick(page, '#p1');
  assert.ok((await hits(page)).ctx >= 1);
  assert.equal(await userSelect(page, '#p1'), 'none');
  await setSettings(sw, { enabled: true });
});

await test('기능 하나만 끄기 (복사만 사이트에 맡김)', async () => {
  await setSettings(sw, { features: { contextmenu: true, select: true, copy: false, keys: true, drag: true } });
  const page = await open(browser, `${BASE}/append.html`);
  await dragSelect(page, '#p1');
  await ctrl(page, 'KeyC');
  assert.match(await clip(page), /\[출처\]/);
  await setSettings(sw, { features: { contextmenu: true, select: true, copy: true, keys: true, drag: true } });
});

await test('누름 막기 페이지: 일반 모드로는 안 풀림 → 아이콘에 "!" 표시', async () => {
  const page = await open(browser, `${BASE}/mousedown.html`);
  assert.equal(await dragSelect(page, '#p1'), '');
  await sleep(300);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  const badge = await sw.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), tabId);
  assert.equal(badge, '!');
});

await test('강력 모드: 누름 막기 · 오른쪽 버튼 경고 · 버튼 클릭은 그대로', async () => {
  await setSettings(sw, { strongSites: ['127.0.0.1'] });
  const page = await open(browser, `${BASE}/mousedown.html`);
  const s = await dragSelect(page, '#p1');
  assert.match(s, /누르는 순간을 막아서/);
  await rightClick(page, '#p1');
  const h = await hits(page);
  assert.equal(h.rdown, 0, '오른쪽 버튼 처리기는 안 불려야 함');
  assert.equal(h.alert, 0);
  await page.click('#btn');
  assert.equal((await hits(page)).menu, 1, '단추는 그대로 눌려야 함');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  assert.equal(await sw.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), tabId), '강');
});

await test('강력 모드: 고른 글자를 지우는 페이지', async () => {
  await setSettings(sw, { strongSites: [] });
  let page = await open(browser, `${BASE}/clear.html`);
  await dragSelect(page, '#p1');
  await sleep(300);
  assert.equal(await page.evaluate(() => String(getSelection())), '', '일반 모드에선 지워짐');
  await setSettings(sw, { strongSites: ['127.0.0.1'] });
  page = await open(browser, `${BASE}/clear.html`);
  await dragSelect(page, '#p1');
  await sleep(300);
  assert.match(await page.evaluate(() => String(getSelection())), /고르면 곧바로/);
  await setClip(page, 'BEFORE');
  await ctrl(page, 'KeyC');
  assert.match(await clip(page), /고르면 곧바로/);
});

await test('강력 모드: 그림 위 투명 덮개를 지나 우클릭이 그림에 닿음', async () => {
  const page = await open(browser, `${BASE}/overlay.html`);
  const box = await (await page.$('#img')).boundingBox();
  const x = box.x + 100; const y = box.y + 100;
  assert.equal(await page.evaluate((x, y) => document.elementFromPoint(x, y).id, x, y), 'cover');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  const top = await page.evaluate((x, y) => document.elementFromPoint(x, y).id, x, y);
  await page.mouse.up({ button: 'right' });
  assert.equal(top, 'img');
  await sleep(1700);
  assert.equal(await page.evaluate((x, y) => document.elementFromPoint(x, y).id, x, y), 'cover', '잠시 뒤 덮개는 제자리');
});

await test('강력 모드: 안 보이게 해 둔 선택 표시를 되살림', async () => {
  const page = await open(browser, `${BASE}/invisible.html`);
  const bg = await page.$eval('#p1', (el) => getComputedStyle(el, '::selection').backgroundColor);
  assert.match(bg, /rgba\(45, 140, 255/);
});

await test('강력 모드 끄면 페이지 쪽 스크립트도 바로 잠듦', async () => {
  const page = await open(browser, `${BASE}/mousedown.html`);
  await setSettings(sw, { strongSites: [] });
  assert.equal(await dragSelect(page, '#p1'), '');
});

await test('웹 앱 예외 (호스트 이름 판단은 core_test) · 백그라운드 디버그 접근', async () => {
  const info = await sw.evaluate(() => globalThis.__pullim.updateInfo(false));
  assert.equal(info.current, '1.0.0');
  assert.equal(info.install.installer, 'manual');
});

await test('팝업 화면 (막힌 블로그에서)', async () => {
  const page = await open(browser, `${BASE}/basic.html`);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  const pop = await browser.newPage();
  await pop.setViewport({ width: 330, height: 520 });
  await pop.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await sleep(500);
  assert.equal(await pop.$eval('#host', (e) => e.textContent), '127.0.0.1');
  assert.equal(await pop.$eval('#siteToggle', (e) => e.checked), true);
  assert.equal(await pop.$eval('#siteTitle', (e) => e.textContent), '제한 풀림 켜짐');
  if (SHOTS) await pop.screenshot({ path: path.join(ROOT, 'test/tmp/popup.png'), fullPage: true });
  // 팝업에서 이 사이트 끄기
  await pop.click('#siteToggle');
  await sleep(400);
  const { settings } = await sw.evaluate(() => chrome.storage.local.get('settings'));
  assert.deepEqual(settings.disabledSites, ['127.0.0.1']);
  assert.equal(await userSelect(page, '#p1'), 'none');
  if (SHOTS) await pop.screenshot({ path: path.join(ROOT, 'test/tmp/popup-off.png'), fullPage: true });
  // 강력 모드 켜기 (팝업은 꺼진 사이트에선 강력 모드를 막아 둠)
  await pop.click('#siteToggle');
  await sleep(300);
  await pop.click('#strongToggle');
  await sleep(500);
  const s2 = (await sw.evaluate(() => chrome.storage.local.get('settings'))).settings;
  assert.deepEqual(s2.strongSites, ['127.0.0.1']);
  assert.equal(await pop.$eval('#reloadBtn', (e) => e.hidden), false);
  if (SHOTS) await pop.screenshot({ path: path.join(ROOT, 'test/tmp/popup-strong.png'), fullPage: true });
  await setSettings(sw, { strongSites: [], disabledSites: [] });
});

await test('설정 화면 · 안내 화면이 오류 없이 뜸', async () => {
  for (const p of ['options/options.html', 'guide.html', 'guide.html#welcome']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`chrome-extension://${id}/${p}`);
    await sleep(600);
    assert.deepEqual(errors, [], p);
    if (SHOTS) await page.screenshot({ path: path.join(ROOT, `test/tmp/${p.replace(/[/#.]/g, '_')}.png`), fullPage: true });
    await page.close();
  }
});

await test('자동 업데이트: 폴더의 파일이 새 버전으로 바뀌면 확장이 스스로 다시 불러옴', async () => {
  const page = await open(browser, `${BASE}/basic.html`);
  const mf = path.join(extCopy, 'manifest.json');
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  m.version = '1.0.1';
  writeFileSync(mf, JSON.stringify(m, null, 2));
  const oldTarget = browser.targets().find((t) => t.type() === 'service_worker' && t.url().includes(id));
  sw.evaluate(() => globalThis.__pullim.checkDisk()).catch(() => {}); // 다시 불러오며 워커가 끊김
  let ver = '';
  try {
    let t;
    [t, sw] = await swOf(browser, id, oldTarget);
    for (let i = 0; i < 20 && !ver; i++) { try { ver = await sw.evaluate(() => chrome.runtime.getManifest().version); } catch { await sleep(200); } }
  } catch (e) { ver = 'error: ' + e.message; }
  assert.equal(ver, '1.0.1');
  await sleep(800);
  // 열려 있던 탭에도 새 스크립트가 들어가 있어야 함: 끄기/켜기가 바로 먹는지
  await rightClick(page, '#p1');
  assert.equal((await hits(page)).ctx, 0, '다시 불러온 뒤에도 풀린 상태');
  await setSettings(sw, { disabledSites: ['127.0.0.1'] });
  await rightClick(page, '#p1');
  assert.ok((await hits(page)).ctx >= 1, '새 스크립트가 설정 바뀜을 받아야 함');
  await setSettings(sw, { disabledSites: [] });
  const again = await sw.evaluate(async () => { await globalThis.__pullim.checkDisk(); return chrome.runtime.getManifest().version; });
  assert.equal(again, '1.0.1', '같은 버전이면 다시 불러오지 않음');
});

await closeBrowser(browser);
clearTimeout(killer);
server.kill();
console.log(`\n${passed}개 통과, ${failures}개 실패`);
process.exit(failures ? 1 : 0);
