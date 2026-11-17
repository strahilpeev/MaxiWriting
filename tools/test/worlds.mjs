// Началният екран „по светове“: 6 свята → игрите вътре → играта се отваря направо,
// „Продължи“ с последната игра, „Назад“ и смяна на подредбата.
//   node test/worlds.mjs            — изходния код
//   node test/worlds.mjs dist       — защитената версия
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', process.argv[2] === 'dist' ? 'dist' : '.');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-firebase.js'), 'utf8');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, q.url.split('?')[0].slice(1) || 'app.html');
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
}).listen(8708);
const exe = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route('**/firebase-shared.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route(/^https:/, (r) => r.abort());
await ctx.addInitScript(() => { try { window.speechSynthesis.speak = () => {}; } catch (e) {} });
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };

await t.goto('http://localhost:8708/manifest.json');
await t.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('__mockAuth', JSON.stringify({ uid: 'u1', email: 'mama@test.bg', verified: true }));
  localStorage.setItem('hubAccount_v1', JSON.stringify({ uid: 'u1', email: 'mama@test.bg' }));
  localStorage.setItem('hubChildProfiles_v1', JSON.stringify([{ id: 'p1', name: 'Мая', avatar: '🦊', owner: 'u1' }]));
  localStorage.setItem('hubActiveProfile_v1', JSON.stringify({ id: 'p1', name: 'Мая', avatar: '🦊' }));
});
await t.goto('http://localhost:8708/app.html'); await t.waitForTimeout(800);
check(await t.locator('#worlds .world').count() === 6 && await t.locator('#worlds').isVisible(), 'началният екран показва 6 свята');
check(!(await t.locator('#menu > .tiles').isVisible()), 'старите плочки по приложения са скрити');
check(await t.locator('#continue-btn').isHidden(), 'без изиграна игра няма „Продължи“');
await t.screenshot({ path: path.join(__dirname, 'worlds.png') });

const counts = await t.evaluate(() => Object.fromEntries(Maxi.WORLDS.map((w) => [w.id, Maxi.GAMES.filter((g) => g.world === w.id).length])));
await t.click('.world[data-w="pisha"]'); await t.waitForTimeout(200);
check(await t.locator('#wgames .wgame').count() === counts.pisha && await t.locator('#worlds').isHidden(), '„Пиша и рисувам“ → ' + counts.pisha + ' игри вътре, световете са скрити');
check((await t.locator('#world-head').innerText()).includes('Пиша и рисувам'), 'заглавие на света и „← Назад“');
await t.screenshot({ path: path.join(__dirname, 'world-pisha.png') });
await t.click('.wgame[data-g="dvizhenie/konturi"]'); await t.waitForTimeout(1200);
const f = t.frames().find((x) => x.url().includes('dvizhenie.html'));
check(!!f && await f.evaluate(() => G.mode === 'konturi' && document.getElementById('play').classList.contains('active')), 'игра → отваря се направо „Проследи предмет“');
await f.evaluate(() => goMenu()); await t.waitForTimeout(300);
check(await t.locator('#world-view').isVisible() && !(await t.locator('#worlds').isVisible()), 'след играта детето е пак в същия свят');
await t.click('.wgame[data-g="pisane"]'); await t.waitForTimeout(800);
check((await t.evaluate(() => document.getElementById('app-frame').contentWindow.location.pathname)).endsWith('bulgarian-typing-login.html'), 'игра от друго приложение („Пиши и говори“) се отваря');
await t.evaluate(() => closeApp()); await t.waitForTimeout(200);
await t.evaluate(() => goBack()); await t.waitForTimeout(200);
check(await t.locator('#worlds').isVisible() && await t.locator('#world-view').isHidden(), '„Назад“ от света → обратно към световете');
check((await t.locator('#continue-btn').innerText()).includes('Пиши и говори'), '„▶ Продължи“ показва последната игра');
await t.click('#continue-btn'); await t.waitForTimeout(800);
check(await t.evaluate(() => document.getElementById('app-screen').classList.contains('active')), '„Продължи“ отваря играта');
await t.evaluate(() => closeApp()); await t.waitForTimeout(200);
// всички игри от всички светове имат файл и плочка в него
const bad = [];
for (const w of Object.keys(counts)) {
  await t.click(`.world[data-w="${w}"]`); await t.waitForTimeout(100);
  const ids = await t.locator('#wgames .wgame').evaluateAll((els) => els.map((e) => e.dataset.g));
  for (const id of ids) {
    await t.evaluate((id) => document.querySelector(`.wgame[data-g="${id}"]`).click(), id); await t.waitForTimeout(700);
    const ok = await t.evaluate((id) => {
      const g = Maxi.gameById(id), w = document.getElementById('app-frame').contentWindow;
      if (!w.location.pathname.endsWith(g.file)) return false;
      if (!g.mode) return true;
      const act = w.document.querySelector('.mx-screen.active');
      return !!act && act.id !== 'menu';
    }, id);
    if (!ok) bad.push(id);
    await t.evaluate(() => closeApp()); await t.waitForTimeout(100);
  }
  await t.evaluate(() => goBack()); await t.waitForTimeout(100);
}
check(!bad.length, 'всяка от 49-те игри в световете се отваря направо' + (bad.length ? ': ' + bad.join(', ') : ''));
// смяна на подредбата
await t.click('#layout-toggle'); await t.waitForTimeout(200);
check(await t.locator('#menu > .tiles').isVisible() && await t.locator('#worlds').isHidden(), '„Подредба по приложения“ показва старите плочки');
await t.reload(); await t.waitForTimeout(700);
check(await t.locator('#menu > .tiles').isVisible(), 'изборът се помни');
await t.click('#layout-toggle'); await t.waitForTimeout(200);
check(await t.locator('#worlds').isVisible(), '„Подредба по светове“ връща световете');
// портрет (таблет изправен)
await t.setViewportSize({ width: 800, height: 1280 }); await t.waitForTimeout(200);
const cols = await t.evaluate(() => getComputedStyle(document.getElementById('worlds')).gridTemplateColumns.split(' ').length);
check(cols === 2, 'изправен таблет → 2 колони');
await t.screenshot({ path: path.join(__dirname, 'worlds-portrait.png') });
check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} ГРЕШКИ` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
