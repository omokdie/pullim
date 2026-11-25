// 아이콘 만들기: assets/logo*.svg → extension/icons/*.png, assets/pullim.ico (python3 Pillow 필요)
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const big = readFileSync(root + 'assets/logo.svg', 'utf8');
const small = readFileSync(root + 'assets/logo-small.svg', 'utf8');
const chrome = process.env.CHROME || '/usr/bin/google-chrome';
mkdirSync(root + 'extension/icons', { recursive: true });
mkdirSync(root + 'build/out/ico', { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
async function render(svg, size, out) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const s of [16, 32, 48, 128]) await render(s <= 16 ? small : big, s, `${root}extension/icons/icon${s}.png`);
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
for (const s of icoSizes) await render(s <= 20 ? small : big, s, `${root}build/out/ico/${s}.png`);
await browser.close();

execFileSync('python3', ['-c', `
from PIL import Image
sizes=${JSON.stringify(icoSizes)}
imgs=[Image.open('${root}build/out/ico/%d.png'%s).convert('RGBA') for s in sizes]
imgs[-1].save('${root}assets/pullim.ico', format='ICO', sizes=[(s,s) for s in sizes], append_images=imgs[:-1])
print('ico ok')
`], { stdio: 'inherit' });
console.log('icons ok');
