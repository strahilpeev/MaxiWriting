// Статистика: хъбът праща посещения и игри (с опашка без интернет), игра се отваря
// направо от хъба (файл#g=игра) и „Назад“ връща в хъба; страницата stats.html показва
// графиките и таблицата с игрите. Сървърът е имитиран.
//   node test/stats.mjs            — изходния код
//   node test/stats.mjs dist       — защитената версия
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
}).listen(8707);

const exe = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route('**/firebase-shared.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
const sent = [];
let offline = false;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = ymd(new Date());
await ctx.route('**/api/*.php', async (r) => {
  const file = new URL(r.request().url()).pathname.split('/').pop();
  if (file === 'track.php') {
    if (offline) return r.abort();
    sent.push(...JSON.parse(r.request().postData()).e);
    return r.fulfill({ status: 204, body: '' });
  }
  if (file === 'stats.php') {
    const days = {};
    for (let i = 0; i < 40; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days[ymd(d)] = { v: 10 + (i % 7), vu: 4, p: 20, pu: 4, g: { 'dvizhenie/konturi': [12, 3], 'pisane': [8, 2], ...(i === 0 ? { 'chetene/rimi': [1, 1] } : {}) } };
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, today: TODAY, from: ymd(new Date(Date.now() - 799 * 86400000)), days,
      periods: { 7: { users: 6, games: { 'dvizhenie/konturi': 4, pisane: 2, 'chetene/rimi': 1 } }, 30: { users: 9, games: { 'dvizhenie/konturi': 5, pisane: 3, 'chetene/rimi': 1 } }, 365: { users: 9, games: { 'dvizhenie/konturi': 5, pisane: 3, 'chetene/rimi': 1 } } } }) });
  }
  r.fulfill({ status: 404, body: '' });
});
await ctx.route(/^https:/, (r) => r.abort());
await ctx.addInitScript(() => { try { window.speechSynthesis.speak = () => {}; } catch (e) {} });
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };

// --- вписан акаунт с дете, статистиката включена
await t.goto('http://localhost:8707/manifest.json');
await t.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('__statsForce', '1');
  localStorage.setItem('__mockAuth', JSON.stringify({ uid: 'u1', email: 'mama@test.bg', verified: true }));
  localStorage.setItem('hubAccount_v1', JSON.stringify({ uid: 'u1', email: 'mama@test.bg' }));
  localStorage.setItem('hubChildProfiles_v1', JSON.stringify([{ id: 'p1', name: 'Мая', avatar: '🦊', owner: 'u1' }]));
  localStorage.setItem('hubActiveProfile_v1', JSON.stringify({ id: 'p1', name: 'Мая', avatar: '🦊' }));
});
await t.goto('http://localhost:8707/app.html'); await t.waitForTimeout(3500);
check(sent.filter((e) => e.t === 'v').length === 1 && sent[0].d === TODAY, 'отварянето на хъба праща едно посещение с днешна дата');
const key = sent[0] && sent[0].u;
check(/^[A-Za-z0-9_-]{16,}_p1$/.test(key || '') && !/mama|Мая/.test(JSON.stringify(sent)), 'ключът е случаен + номер на профила — без имейл и име');
await t.reload(); await t.waitForTimeout(3500);
check(sent.filter((e) => e.t === 'v').length === 1, 'повторно отваряне до 30 мин не е ново посещение');

// --- игра направо от хъба
await t.evaluate(() => openApp('dvizhenie.html', 'konturi')); await t.waitForTimeout(1200);
const fr = t.frameLocator('#app-frame');
const inGame = await t.frames().find((f) => f.url().includes('dvizhenie.html')).evaluate(() => ({ mode: G.mode, play: document.getElementById('play').classList.contains('active'), deep: G.deep }));
check(inGame.play && inGame.mode === 'konturi' && inGame.deep, '#g=konturi → „Проследи предмет“ се отваря направо');
await t.waitForTimeout(2600);
check(sent.some((e) => e.t === 'g' && e.g === 'dvizhenie/konturi' && e.u === key), 'играта се отчита като dvizhenie/konturi');
await t.frames().find((f) => f.url().includes('dvizhenie.html')).evaluate(() => goMenu()); await t.waitForTimeout(300);
check(!(await t.evaluate(() => document.getElementById('app-screen').classList.contains('active'))), '„↩ Игри“ в отворена направо игра връща в хъба');
await t.evaluate(() => openApp('govorya.html', 'taimer')); await t.waitForTimeout(1200);
const tim = await t.frames().find((f) => f.url().includes('govorya.html')).evaluate(() => document.getElementById('timer').classList.contains('active'));
check(tim, '#g=taimer → игра извън MODES (Таймер) също се отваря направо');
await t.evaluate(() => closeApp()); await t.waitForTimeout(200);
await t.evaluate(() => openApp('bulgarian-typing-login.html')); await t.waitForTimeout(2800);
check(sent.some((e) => e.g === 'pisane'), '„Пиши и говори“ се отчита като pisane');
await t.evaluate(() => closeApp());
// същата игра до минута — едно пускане
const nK = sent.filter((e) => e.g === 'dvizhenie/konturi').length;
await t.evaluate(() => openApp('dvizhenie.html', 'konturi')); await t.waitForTimeout(2800); await t.evaluate(() => closeApp());
check(sent.filter((e) => e.g === 'dvizhenie/konturi').length === nK, 'същата игра до 1 мин не се брои два пъти');

// --- без интернет: опашка, после се праща
offline = true;
await t.evaluate(() => openApp('dvizhenie.html', 'tochki')); await t.waitForTimeout(2800); await t.evaluate(() => closeApp());
const q = await t.evaluate(() => JSON.parse(localStorage.getItem('maxiStatsQ_v1') || '[]'));
check(q.some((e) => e.g === 'dvizhenie/tochki') && !sent.some((e) => e.g === 'dvizhenie/tochki'), 'без интернет събитието чака на устройството');
offline = false;
await t.evaluate(() => Maxi.Stats.flush()); await t.waitForTimeout(300);
check(sent.some((e) => e.g === 'dvizhenie/tochki') && (await t.evaluate(() => JSON.parse(localStorage.getItem('maxiStatsQ_v1') || '[]').length)) === 0, 'с интернет се праща и опашката се изчиства');

// --- извън tapnime.eu статистиката е изключена
const before = sent.length;
await t.evaluate(() => localStorage.removeItem('__statsForce'));
await t.evaluate(() => { Maxi.Stats.game('vnimanie/memory'); return Maxi.Stats.flush(); }); await t.waitForTimeout(200);
check(sent.length === before && !(await t.evaluate(() => Maxi.Stats.enabled())), 'на друг адрес (localhost) нищо не се праща');

// --- каталогът покрива всички игри
const cat = await t.evaluate(() => ({ n: Maxi.GAMES.length, worlds: Maxi.WORLDS.length, bad: Maxi.GAMES.filter((g) => !Maxi.WORLDS.some((w) => w.id === g.world)).map((g) => g.id) }));
check(cat.n === 49 && cat.worlds === 6 && !cat.bad.length, 'каталог: 49 игри в 6 свята');

// --- stats.html
const s = await ctx.newPage();
s.on('pageerror', (e) => errors.push('stats: ' + e.message));
await s.goto('http://localhost:8707/stats.html'); await s.waitForTimeout(800);
const kpi = await s.locator('.kpi').first().innerText();
check(kpi.includes('10') && kpi.includes('потребители'), 'stats.html: „Днес“ — посещения и потребители');
const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
check(await s.locator('section:nth-of-type(2) .bar').count() === dim, 'графика по дни за месеца: ' + dim + ' стълба');
check(await s.locator('section:nth-of-type(3) .bar').count() === 12, 'графика по месеци за годината: 12 стълба');
await s.click('section:nth-of-type(2) .nav button >> nth=0'); await s.waitForTimeout(100);
check((await s.locator('section:nth-of-type(2) .nav span').innerText()).length > 3, '◀ сменя месеца');
await s.click('section:nth-of-type(2) .nav button >> nth=1');
const rows = await s.locator('tr.g').count();
check(rows === 49, 'таблицата показва всички 49 игри, и неиграните (' + rows + ')');
const first = await s.locator('tr.g').first().innerText();
check(first.includes('Проследи предмет') && first.includes('топ'), 'най-играната е отгоре, с „топ“');
check((await s.locator('.rank').nth(1).innerText()).includes('не е играна'), '„Най-малко играни“ показва и неиграни игри');
await s.click('tr.g >> nth=0'); await s.waitForTimeout(100);
check(await s.locator('#gameBox svg.chart .bar').count() >= 7, 'докосване на игра → графика по дни');
await s.click(`section:nth-of-type(2) .bar[data-id="${TODAY}"]`); await s.waitForTimeout(100);
check((await s.locator('#dayBox').innerText()).includes('Рими'), 'докосване на ден → кои игри са играни (вкл. „Рими“)');
await s.click('[data-per="7"]'); await s.waitForTimeout(100);
check((await s.locator('tr.g').first().innerText()).includes('4'), 'период 7 дни → потребители за 7 дни');
await s.screenshot({ path: path.join(__dirname, 'stats.png'), fullPage: true });
// не-собственик
await ctx.route('**/api/stats.php', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"not-admin"}' }));
await s.reload(); await s.waitForTimeout(800);
check((await s.locator('main').innerText()).includes('само за собственика'), 'не-собственик → „Статистиката е само за собственика“');

check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} ГРЕШКИ` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
