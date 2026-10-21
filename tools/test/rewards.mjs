// Тест на наградите в хъба: общ басейн от звезди, нива, празнуване, аватари,
// значки, грамота и класиране (с имитация на Firebase).
//   node test/rewards.mjs            — изходния код
//   node test/rewards.mjs dist       — защитената версия
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
}).listen(8702);

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route('**/firebase-shared.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route(/^https:/, (r) => r.abort());
// Броим звуците и печата, без да пускаме истински.
await ctx.addInitScript(() => {
  window.__osc = 0; window.__printed = 0;
  const AC = window.AudioContext;
  if (AC) {
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { window.__osc++; return orig.call(this); };
  }
  window.print = () => { window.__printed++; };
});
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
t.on('dialog', (d) => d.accept());

let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };
const activeScreen = () => t.evaluate(() => (document.querySelector('.screen.active') || {}).id || '(app)');
const URL = 'http://localhost:8702/app.html';
const gate = async () => {
  const q = await t.textContent('#mx-gate-q');
  const [a, b] = q.match(/\d+/g).map(Number);
  await t.fill('#mx-gate-in', String(a * b)); await t.click('#mx-gate-ok'); await t.waitForTimeout(300);
};
const setStars = (app, name, stars, extra) => t.evaluate(([app, name, stars, extra]) => {
  const all = JSON.parse(localStorage.getItem(app) || '{}');
  all[name] = Object.assign({ score: 0, total: 0, streak: 0, stars: 0, history: [], extra: {} }, all[name] || {}, { stars }, extra || {});
  localStorage.setItem(app, JSON.stringify(all));
}, [app, name, stars, extra]);

// --- 1. Акаунт и дете „Мая“
await t.goto(URL);
await t.evaluate(() => localStorage.clear());
await t.reload(); await t.waitForTimeout(300);
await t.click('#login-toggle');
await t.fill('#login-email', 'mama@test.bg'); await t.fill('#login-pass', '123456'); await t.fill('#login-pass2', '123456');
await t.click('#login-submit'); await t.waitForTimeout(500);
await t.locator('.profile-card.add-new').click(); await t.waitForTimeout(200);
await t.fill('#new-profile-name', 'Мая'); await t.click('#new-profile-screen .btn.save'); await t.waitForTimeout(400);
check(await activeScreen() === 'menu', 'нов профил → менюто');
check((await t.textContent('.rw-level-name')).includes('Ниво 1'), 'менюто показва „Ниво 1 · Пиленце“');
check((await t.textContent('.rw-next')).includes('още 3 ⭐ до ниво 2'), '…и „още 3 ⭐ до ниво 2“');

// --- 2. Звезди от различни игри се събират; ново ниво по време на игра → празнуване
await setStars('maxiChetene_v1', 'Мая', 1);
await t.click('button.tile[onclick*="chisla-i-pari"]'); await t.waitForTimeout(600);
// играта в рамката записва звезди (както при верни отговори) → хъбът получава „storage“
await t.frameLocator('#app-frame').locator('body').evaluate(() => {
  const all = JSON.parse(localStorage.getItem('maxiChislaPari_v1') || '{}');
  all['Мая'] = Object.assign({ score: 12, total: 14, streak: 10, bestStreak: 10, stars: 2, history: [], extra: {} }, all['Мая'] || {}, { stars: 2 });
  localStorage.setItem('maxiChislaPari_v1', JSON.stringify(all));
});
await t.waitForTimeout(900);
check(await t.locator('#rw-celebrate.open').isVisible(), '1 ⭐ (Четене) + 2 ⭐ (Числа) = 3 → празнуване „Ниво 2“ над играта');
check((await t.textContent('#rw-celebrate .rw-title')).includes('Ниво 2'), 'надпис „Ниво 2!“');
check(await t.locator('.rw-confetti i').count() > 50, 'конфети');
check(await t.evaluate(() => window.__osc) > 20, 'фанфара (синтезирана, ~6.5 s)');
await t.click('#rw-celebrate [data-av]'); await t.waitForTimeout(200);
check(await t.evaluate(() => JSON.parse(localStorage.getItem('hubActiveProfile_v1')).avatar) === '🐥', 'бутонът „Сложи 🐥 за аватар“ сменя аватара');
await t.click('#rw-celebrate [data-close]'); await t.waitForTimeout(200);
await t.click('#home-btn'); await t.waitForTimeout(500);
check((await t.textContent('.rw-level-name')).includes('Ниво 2'), 'в менюто: „Ниво 2 · Пиле“');
check(await t.locator('.rw-badge:not(.locked)').count() >= 2, 'значки „Първа звезда“ и „10 поред“ са отключени');
const cloudAv = await t.evaluate(() => JSON.parse(localStorage.getItem('__mockCloud')));
check(Object.values(Object.values(cloudAv.accounts)[0].profiles).some(p => p.avatar === '🐥'), 'новият аватар е записан в облака');

// --- 3. Без повторно празнуване при презареждане
await t.reload(); await t.waitForTimeout(500);
check(!(await t.locator('#rw-celebrate.open').count()), 'презареждане → без ново празнуване');

// --- 4. Избор на аватар: отключени до текущото ниво, другите със 🔒
await t.click('#progress-avatar'); await t.waitForTimeout(200);
check(await t.locator('#rw-avatar-modal .rw-av.locked').count() === 18, 'аватари за нивата: 2 отключени, 18 заключени');
await t.locator('#rw-avatar-modal .rw-av[data-a="🐣"]').click(); await t.waitForTimeout(200);
check((await t.textContent('#progress-avatar')) === '🐣', 'избран аватар 🐣');

// --- 5. Ниво 5 → грамота
await setStars('maxiVnimanie_v1', 'Мая', 15);   // 1 + 2 + 15 = 18 ⭐ → ниво 5
await t.evaluate(() => Rewards.renderCard(getActiveProfile())); await t.waitForTimeout(400);
check((await t.textContent('#rw-celebrate .rw-title')).includes('Ниво 5'), '18 ⭐ → „Ниво 5!“');
check(await t.locator('#rw-celebrate [data-cert]').isVisible(), 'на ниво 5 има бутон „🖨️ Грамота“');
await t.click('#rw-celebrate [data-cert]'); await t.waitForTimeout(400);
check(await t.evaluate(() => window.__printed) === 1, 'грамотата се изпраща за печат');
check((await t.textContent('#rw-cert')).includes('Мая') && (await t.textContent('#rw-cert')).includes('Ниво 5'), 'грамотата е с име и ниво');
await t.click('#rw-celebrate [data-close]'); await t.waitForTimeout(200);
await t.click('#menu .top-bar button:has-text("За родители")'); await t.waitForTimeout(200); await gate();
check((await t.textContent('#rw-pp-card')).includes('Грамота за ниво 5'), 'родителски панел: грамота за ниво 5');
await t.click('#parent-screen .pp-btn.gray'); await t.waitForTimeout(200);

// --- 6. Класиране: родителят включва детето в „Акаунт“; вижда се само прякор
await t.click('#switch-profile-btn'); await t.waitForTimeout(200);
await t.click('.admin-link'); await t.waitForTimeout(200); await gate(); await t.waitForTimeout(300);
await t.locator('.rw-rank-ctl [data-rank-on]').check(); await t.waitForTimeout(500);
const rank1 = await t.evaluate(() => JSON.parse(localStorage.getItem('__mockRank') || '{}'));
const e1 = Object.values(rank1)[0] || {};
check(e1.level === 5 && e1.nick && !JSON.stringify(e1).includes('Мая'), 'в класирането: прякор „' + e1.nick + '“, ниво 5, без истинското име');
check((await t.textContent('.rw-rank-ctl')).includes(e1.nick), 'в „Акаунт“ се вижда прякорът');
await t.click('.rw-rank-ctl [data-rank-roll]'); await t.waitForTimeout(400);
const e2 = Object.values(await t.evaluate(() => JSON.parse(localStorage.getItem('__mockRank')))) [0];
check(e2.nick && e2.nick !== e1.nick, '🎲 сменя прякора (' + e1.nick + ' → ' + e2.nick + ')');
check(/^\S+(ият|ата|ото) [А-Я][а-я]+$/.test(e2.nick) && !/(ът|та|то)$/.test(e2.nick.split(' ')[1]), 'прякорът е граматически правилен (член само на прилагателното)');
await t.click('#admin-screen .admin-close'); await t.waitForTimeout(200);
await t.locator('.profile-card', { hasText: 'Мая' }).click(); await t.waitForTimeout(300);
await t.click('#menu .top-bar button:has-text("Класиране")'); await t.waitForTimeout(500);
check(await activeScreen() === 'rank-screen', 'бутон „🏆 Класиране“ отваря екрана');
check(await t.locator('.rw-rank-row.mine').count() === 1 && (await t.textContent('.rw-rank-row.mine')).includes('Ниво 5'), 'нашето дете е в класирането с ниво 5');

// --- 7. Друг родител вижда прякора и нивото, не и името
await t.evaluate(() => window.MaxiDB.signOut()); await t.waitForTimeout(300);
await t.click('#login-toggle');
await t.fill('#login-email', 'tatko@test.bg'); await t.fill('#login-pass', 'abcdef'); await t.fill('#login-pass2', 'abcdef');
await t.click('#login-submit'); await t.waitForTimeout(500);
await t.locator('.profile-card.add-new').click(); await t.waitForTimeout(200);
await t.fill('#new-profile-name', 'Иво'); await t.click('#new-profile-screen .btn.save'); await t.waitForTimeout(400);
await t.click('#menu .top-bar button:has-text("Класиране")'); await t.waitForTimeout(500);
const rows = await t.locator('.rw-rank-row').allTextContents();
check(rows.length === 1 && rows[0].includes(e2.nick) && !rows[0].includes('Мая'), 'друг акаунт вижда „' + e2.nick + '“ без истинското име');
check((await t.textContent('#rank-list')).includes('помоли родител'), 'детето без включено класиране вижда подсказка за родителя');

// --- 8. Изключване маха детето от класирането
await t.evaluate(() => window.MaxiDB.signOut()); await t.waitForTimeout(300);
await t.fill('#login-email', 'mama@test.bg'); await t.fill('#login-pass', '123456'); await t.click('#login-submit'); await t.waitForTimeout(600);
await t.click('.admin-link'); await t.waitForTimeout(200); await gate(); await t.waitForTimeout(300);
await t.locator('.rw-rank-ctl [data-rank-on]').first().uncheck(); await t.waitForTimeout(500);
check(Object.keys(await t.evaluate(() => JSON.parse(localStorage.getItem('__mockRank')))).length === 0, 'изключване → махнато от класирането');

// --- 8б. Ново устройство: звездите от облака се броят, без празнуване
await t.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('__mockCloud'));
  const acc = Object.values(c.accounts).find(a => Object.values(a.profiles).some(p => p.name === 'Мая'));
  const [id, p] = Object.entries(acc.profiles).find(([, p]) => p.name === 'Мая');
  p.stats = { chetene: { stars: 40 }, sbor: { stars: 12 } };   // 52 ⭐ в облака → ниво 9
  localStorage.setItem('__mockCloud', JSON.stringify(c));
  // „нов таблет“: махаме местните звезди на Мая
  ['maxiChetene_v1', 'maxiChislaPari_v1', 'maxiVnimanie_v1'].forEach(k => localStorage.removeItem(k));
});
await t.click('#admin-screen .admin-close'); await t.waitForTimeout(200);
await t.locator('.profile-card', { hasText: 'Мая' }).click(); await t.waitForTimeout(300);
await t.evaluate(() => cloudSyncProfiles()); await t.waitForTimeout(600);
check((await t.textContent('.rw-level-name')).includes('Ниво 9'), 'нов таблет: 52 ⭐ от облака → „Ниво 9“');
check(!(await t.locator('#rw-celebrate.open').count()), '…без празнуване за нива от друго устройство');

// --- 9. Без акаунт: нива работят, класирането обяснява защо го няма
await t.evaluate(() => localStorage.clear()); await t.reload(); await t.waitForTimeout(300);
await t.click('#login-local'); await t.waitForTimeout(200);
await t.locator('.profile-card.add-new').click(); await t.waitForTimeout(200);
await t.fill('#new-profile-name', 'Ники'); await t.click('#new-profile-screen .btn.save'); await t.waitForTimeout(400);
check((await t.textContent('.rw-level-name')).includes('Ниво 1'), 'без акаунт: нивото се показва');
await t.click('#menu .top-bar button:has-text("Класиране")'); await t.waitForTimeout(300);
check((await t.textContent('#rank-list')).includes('само за деца в акаунт'), 'без акаунт: класирането обяснява, че е само с акаунт');
await t.keyboard.press('Escape'); await t.waitForTimeout(200);

check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await t.screenshot({ path: path.join(__dirname, 'rewards.png') });
await browser.close(); server.close();
console.log(failed ? `\n${failed} проблема` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
