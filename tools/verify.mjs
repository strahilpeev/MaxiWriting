// Проверява, че защитената версия (dist/) работи точно като изходния код:
// отваря всяка страница, натиска всички видими бутони и сравнява грешките.
// Проверява и че копие на чужд домейн показва бележката.
//
//   npm run build && npm test

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

function serve(dir, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(port, () => res(s));
  });
}

const exe = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--host-resolver-rules=MAP kopie.example 127.0.0.1', '--autoplay-policy=no-user-gesture-required']
});

async function exercise(base, page) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Външните услуги (шрифтове, Firebase) са без значение за сравнението.
  await ctx.route(/^https:\/\/(?!.*(localhost|kopie)).*/, (r) => r.abort());
  // Еднакви „случайни“ задачи в двете версии, за да е честно сравнението.
  await ctx.addInitScript(() => { let x = 12345; Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647); });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message.replace(/_0x[0-9a-f]+/g, 'X')));
  tab.on('dialog', (d) => d.dismiss().catch(() => {}));
  await tab.goto(base + page, { waitUntil: 'load' });
  await tab.waitForTimeout(600);

  let clicks = 0;
  for (let round = 0; round < 2; round++) {
    const buttons = await tab.locator('button:visible, [onclick]:visible').all();
    for (const b of buttons.slice(0, 40)) {
      try { await b.click({ timeout: 800, trial: false }); clicks++; await tab.waitForTimeout(120); } catch {}
    }
    const inputs = await tab.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible').all();
    for (const i of inputs.slice(0, 5)) {
      try { await i.fill('мама 12'); await i.press('Enter'); } catch {}
    }
  }
  const bodyText = (await tab.locator('body').innerText().catch(() => '')).slice(0, 80);
  await tab.evaluate(() => window.speechSynthesis && speechSynthesis.cancel()).catch(() => {});
  await tab.waitForTimeout(400);
  const shot = await tab.screenshot({ animations: 'disabled' }).catch(() => Buffer.alloc(0));
  await ctx.close();
  return { errors: [...new Set(errors)].sort(), clicks, bodyText, shot };
}

const srcServer = await serve(ROOT, 8601);
const distServer = await serve(path.join(ROOT, 'dist'), 8602);
let failed = false;

for (const p of PAGES) {
  const a = await exercise('http://localhost:8601/', p);
  const b = await exercise('http://localhost:8602/', p);
  const same = JSON.stringify(a.errors) === JSON.stringify(b.errors);
  const blockedByMistake = b.bodyText.includes('Официалната версия');
  const looksSame = a.shot.equals(b.shot);
  console.log(`${same && !blockedByMistake ? '✓' : '✗'} ${p}  (кликове: оригинал ${a.clicks} / защитена ${b.clicks}; ` +
    `екран: ${looksSame ? 'идентичен' : 'различен'})`);
  if (!same || blockedByMistake) {
    failed = true;
    console.log('   оригинал:', a.errors);
    console.log('   защитена:', b.errors);
  }
}

// Копие на чужд сайт → трябва да показва бележката.
for (const p of PAGES) {
  const c = await exercise('http://kopie.example:8602/', p);
  const ok = c.bodyText.includes('Моите учебни игри');
  console.log(`${ok ? '✓' : '✗'} чужд домейн блокиран: ${p}`);
  if (!ok) failed = true;
}

await browser.close(); srcServer.close(); distServer.close();
process.exit(failed ? 1 : 0);
