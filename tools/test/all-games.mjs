// Всички игри: отваря всяка игра във всяко приложение, минава през нивата и няколко
// кръга и проверява, че няма грешки. Така промяна в една игра (или в общия код)
// не може да счупи незабелязано друга.
// После нарочно „чупи“ една игра и проверява, че другите продължават да работят.
//   node test/all-games.mjs            — изходния код
//   node test/all-games.mjs dist       — защитената версия
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.argv[2] === 'dist';
const ROOT = path.resolve(__dirname, '..', '..', DIST ? 'dist' : '.');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let patch = null;   // { file, fn } — подменя файл, за да симулира грешка
const server = http.createServer((q, r) => {
  const f = q.url.split('?')[0].slice(1);
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  let body = fs.readFileSync(p);
  if (patch && patch.file === f) body = patch.fn(body.toString('utf8'));
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  r.end(body);
}).listen(8706);

const exe = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };

async function openPage(file) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route(/^https:/, (r) => r.abort());
  await ctx.addInitScript(() => {
    try { window.speechSynthesis.speak = () => {}; } catch (e) {}
    window.__errors = [];
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errors.push(a.map(String).join(' ').slice(0, 160)); ce(...a); };
  });
  const t = await ctx.newPage();
  const errors = [];
  t.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  t.on('dialog', (d) => d.dismiss().catch(() => {}));
  await t.goto('http://localhost:8706/' + file); await t.waitForTimeout(500);
  return { t, ctx, errors };
}
// Пуска играта: всички нива, по 3 кръга. Връща списък с проблеми.
async function playMode(t, key) {
  return t.evaluate(async (key) => {
    const probs = [];
    const before = window.__errors.length;
    openMode(key);
    if (!document.getElementById('play').classList.contains('active')) return ['не се отваря'];
    const levels = document.querySelectorAll('#levels .mx-level').length || 1;
    for (let lv = 0; lv < levels; lv++) {
      const b = document.querySelectorAll('#levels .mx-level')[lv];
      if (b) b.click();
      for (let i = 0; i < 3; i++) {
        newRound();
        await new Promise((r) => setTimeout(r, 30));
        const area = document.getElementById('area'), prompt = document.getElementById('prompt');
        if (area.querySelector('.mx-down')) probs.push('ниво ' + (lv + 1) + ': „Тази игра почива“');
        else if (!area.children.length && !prompt.textContent.trim() && !document.getElementById('keypad').children.length) probs.push('ниво ' + (lv + 1) + ': празен екран');
        // натискаме първия отговор, ако има — за да минем и през проверката
        const opt = area.querySelector('.mx-opt:not([disabled])'); if (opt) opt.click();
      }
    }
    goMenu();
    if (window.__errors.length > before) probs.push(...window.__errors.slice(before));
    return probs;
  }, key);
}

const APPS = ['chetene.html', 'chisla-i-pari.html', 'vnimanie.html', 'govorya.html', 'dvizhenie.html'];
const SPECIAL = {   // игри извън MODES: функция → екран
  'govorya.html': [['openAAC', 'aac'], ['openGrafik', 'grafik'], ['openFeel', 'feel'], ['openTimer', 'timer']],
  'dvizhenie.html': [['openBreath', 'breath'], ['openBubbles', 'bubbles'], ['openLights', 'lights'], ['openDraw', 'draw']]
};
let total = 0;
for (const app of APPS) {
  const { t, ctx, errors } = await openPage(app);
  const keys = await t.evaluate(() => [...document.querySelectorAll('.mx-tile[onclick*="openMode"]')].map((b) => b.getAttribute('onclick').match(/openMode\('(\w+)'\)/)[1]));
  const bad = [];
  for (const k of keys) { const p = await playMode(t, k); total++; if (p.length) bad.push(k + ' → ' + p.join('; ')); }
  for (const [fn, screen] of SPECIAL[app] || []) {
    total++;
    const ok = await t.evaluate(([fn, screen]) => { window[fn](); const s = document.getElementById(screen); const r = !!(s && s.classList.contains('active')); goMenu(); return r; }, [fn, screen]).catch((e) => false);
    if (!ok) bad.push(fn + ' → не отваря екрана „' + screen + '“');
  }
  check(!bad.length && !errors.length, `${app}: ${keys.length + (SPECIAL[app] || []).length} игри работят` + (bad.length ? ' — ' + bad.join(' | ') : '') + (errors.length ? ' — JS: ' + errors.join(' | ') : ''));
  await ctx.close();
}
// Приложенията с една игра: зареждат се без грешки
for (const app of ['srichki-razmer.html', 'bulgarian-typing-login.html', 'matematika_sbor_login_preminavane.html', 'matematika_izvazhdane_login_zaemane.html']) {
  const { t, ctx, errors } = await openPage(app);
  await t.waitForTimeout(300);
  total++;
  check(!errors.length, `${app}: зарежда се без грешки` + (errors.length ? ' — ' + errors.join(' | ') : ''));
  await ctx.close();
}
console.log(`   (общо ${total} игри)`);

// ---------- „Счупена“ игра не засяга другите ----------
if (!DIST) {
  // 1) грешка при зареждане в „Рисувай свободно“
  patch = { file: 'dvizhenie.html', fn: (s) => s.replace("M.isolate('risuvane', function buildDrawTools(){", "M.isolate('risuvane', function buildDrawTools(){ throw new Error('нарочна грешка');") };
  let { t, ctx } = await openPage('dvizhenie.html');
  const okOthers = await t.evaluate(() => ['prosledi', 'tochki', 'konturi'].every((k) => { openMode(k); const ok = document.getElementById('play').classList.contains('active') && !document.querySelector('#area .mx-down'); goMenu(); return ok; }));
  const breathOk = await t.evaluate(() => { openBreath(); const ok = document.getElementById('breath').classList.contains('active'); goMenu(); return ok; });
  const drawState = await t.evaluate(() => { openDraw(); return { onDraw: document.getElementById('draw').classList.contains('active'), marked: !!document.querySelector('.mx-tile[onclick*="risuvane"] .mx-fix') }; });
  check(okOthers && breathOk, 'грешка в „Рисувай“ при зареждане → другите 6 игри в „Пръстче“ работят');
  check(!drawState.onDraw && drawState.marked, '…а „Рисувай“ не се отваря и плочката ѝ показва „🔧 почива“');
  await ctx.close();
  // 2) грешка по време на игра в „Рими“
  patch = { file: 'chetene.html', fn: (s) => s.replace(/(\n\s*rimi\s*:\s*\{[\s\S]*?round\s*\(\)\s*\{)/, "$1 throw new Error('нарочна грешка');") };
  ({ t, ctx } = await openPage('chetene.html'));
  const rimi = await t.evaluate(() => { openMode('rimi'); return !!document.querySelector('#area .mx-down'); });
  const after = await t.evaluate(() => { goMenu(); openMode('zvuk'); const ok = document.getElementById('area').children.length > 0 && !document.querySelector('#area .mx-down'); goMenu(); return ok; });
  check(rimi && after, 'грешка в „Рими“ → спокойно „Тази игра почива“, другите игри в „Четене“ работят');
  await ctx.close();
  // 3) грешка в темите на „Пиши и говори“ → писането работи без тях
  patch = { file: 'bulgarian-typing-login.html', fn: (s) => s.replace('try{ THEMES_RAW.forEach(([key, icon, name, subject, raw]) => {', 'try{ THEMES_RAW.forEach(([key, icon, name, subject, raw]) => { null.x;') };
  let errs;
  ({ t, ctx, errors: errs } = await openPage('bulgarian-typing-login.html'));
  const typing = await t.evaluate(() => ({ pool: pool.length, themeHidden: getComputedStyle(document.getElementById('themeSelect')).display === 'none' }));
  check(!errs.length && typing.pool > 10 && typing.themeHidden, 'грешка в темите → „Пиши и говори“ работи без менюто „Тема“');
  await ctx.close();
  patch = null;
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} ГРЕШКИ` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
