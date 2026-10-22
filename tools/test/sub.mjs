// Тест на абонамента в хъба (app.html): пробен период, екран „Отключи игрите“,
// плановете в „Акаунт“, връщане от Stripe. Сървърът (api/*.php) е имитиран.
//   node test/sub.mjs            — изходния код
//   node test/sub.mjs dist       — защитената версия
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

const DAY = 86400, now = () => Math.floor(Date.now() / 1000);
// Какво „казва сървърът“ — сменя се по време на теста.
let server_state = { ok: true, kind: 'trial', active: true, trialEnds: now() + 10 * DAY };
let serverDown = false;
const calls = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route('**/firebase-shared.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route('**/api/*.php', (r) => {
  const file = new URL(r.request().url()).pathname.split('/').pop();
  calls.push({ file, auth: r.request().headers()['authorization'], body: r.request().postData() });
  if (serverDown) return r.abort();
  if (file === 'status.php') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({ now: now() }, server_state)) });
  if (file === 'checkout.php') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'http://localhost:8702/app.html?abonament=ok' }) });
  if (file === 'portal.php') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'http://localhost:8702/app.html' }) });
  r.fulfill({ status: 404, body: '' });
});
await ctx.route(/^https:/, (r) => r.abort());
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
t.on('dialog', (d) => d.accept());

let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };
const APP = 'http://localhost:8702/app.html';
const activeScreen = () => t.evaluate(() => (document.querySelector('.screen.active') || {}).id || '(app)');
const appOpen = () => t.evaluate(() => document.getElementById('app-screen').classList.contains('active'));
const wallOpen = () => t.evaluate(() => !!(window.Sub && Sub.wallOpen()));
async function passGate() {
  await t.waitForSelector('#mx-gate.open');
  const q = await t.textContent('#mx-gate-q');
  const [a, b] = q.match(/\d+/g).map(Number);
  await t.fill('#mx-gate-in', String(a * b)); await t.click('#mx-gate-ok');
}
async function closeGameIfOpen() { if (await appOpen()) { await t.evaluate(() => closeApp()); await t.waitForTimeout(200); } }

// --- вписан акаунт с дете
await t.goto('http://localhost:8702/manifest.json');  // данните се слагат на празна страница, за да не ги пипне хъбът
await t.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('__subForce', '1');
  localStorage.setItem('__mockUsers', JSON.stringify({ 'mama@test.bg': { uid: 'u1', pass: '123456' } }));
  localStorage.setItem('__mockAuth', JSON.stringify({ uid: 'u1', email: 'mama@test.bg', verified: true }));
  localStorage.setItem('hubAccount_v1', JSON.stringify({ uid: 'u1', email: 'mama@test.bg' }));
  localStorage.setItem('hubChildProfiles_v1', JSON.stringify([{ id: 'p1', name: 'Мая', avatar: '🦊', owner: 'u1' }]));
  localStorage.setItem('hubActiveProfile_v1', JSON.stringify({ id: 'p1', name: 'Мая', avatar: '🦊' }));
});
await t.goto(APP); await t.waitForTimeout(700);
check(await activeScreen() === 'menu', 'вписан акаунт → менюто');
const st1 = calls.find(c => c.file === 'status.php');
check(!!st1 && st1.auth === 'Bearer mock-token-u1', 'хъбът пита сървъра със своя токен');

// --- 1. пробен период с 10 дни → играе, без лента
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(400);
check(await appOpen() && !(await wallOpen()), 'пробен период → играта се отваря');
await closeGameIfOpen();
check(await t.locator('#sub-banner').isHidden(), '10 дни остават → няма лента');

// --- 2. 2 дни остават → лента
server_state = { ok: true, kind: 'trial', active: true, trialEnds: now() + 2 * DAY - 60 };
await t.evaluate(() => Sub.refresh()); await t.waitForTimeout(200);
check(await t.locator('#sub-banner').isVisible() && (await t.textContent('#sub-banner')).includes('2 дни'), 'последни дни → лента „свършва след 2 дни“');

// --- 3. пробният период свършил → екран „Отключи игрите“
server_state = { ok: true, kind: 'trial', active: false, trialEnds: now() - 60 };
await t.evaluate(() => Sub.refresh()); await t.waitForTimeout(200);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(!(await appOpen()) && await wallOpen(), 'изтекъл пробен период → игрите не се отварят, показва се екранът');
check((await t.textContent('#sub-wall')).includes('Пробният период свърши'), 'текст за детето');
await t.click('#sw-parent'); await passGate(); await t.waitForTimeout(150);
check(await t.locator('#sub-wall [data-plan="month"]').isVisible() && await t.locator('#sub-wall [data-plan="year"]').isVisible(), 'след родителската проверка → двата плана');
check((await t.textContent('#sub-wall')).includes('4,99 €') && (await t.textContent('#sub-wall')).includes('49,99 €'), 'цените 4,99 € и 49,99 €');
// „плащането минава“ в Stripe → сървърът вече вижда абонамента
const paid = { ok: true, kind: 'subscription', active: true, status: 'active', interval: 'year', periodEnd: now() + 365 * DAY, cancelAtPeriodEnd: false };
await t.click('#sub-wall [data-plan="year"]'); server_state = paid; await t.waitForTimeout(900);
const co = calls.filter(c => c.file === 'checkout.php').at(-1);
check(!!co && JSON.parse(co.body).plan === 'year', 'избран годишен план → checkout.php с plan=year');

// --- 4. връщане от Stripe → абонаментът е активен
await t.waitForTimeout(1500);
check(!(await t.evaluate(() => location.search)), 'адресът е изчистен след връщане от Stripe');
check(await t.evaluate(() => Sub.state() && Sub.state().kind === 'subscription'), 'състоянието е „абонамент“');
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await appOpen(), 'с абонамент → играта се отваря');
await closeGameIfOpen();

// --- 5. „Акаунт“ показва абонамента и „Управление“
await t.evaluate(() => openAdmin()); await passGate(); await t.waitForTimeout(400);
const accText = await t.textContent('#acc-sub');
check(accText.includes('годишен') && accText.includes('подновява се'), '„Акаунт“: годишен абонамент, подновява се на …');
await t.click('#sub-portal'); await t.waitForTimeout(500);
check(calls.some(c => c.file === 'portal.php'), '„Управление на абонамента“ → portal.php');
await t.waitForTimeout(500);

// --- 6. без интернет: последното известно състояние важи
serverDown = true;
await t.goto(APP); await t.waitForTimeout(700);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await appOpen(), 'офлайн с платен абонамент → играе');
await closeGameIfOpen();
await t.evaluate(() => { const c = JSON.parse(localStorage.getItem('maxiSub_v1')); c.periodEnd = Math.floor(Date.now() / 1000) - 5 * 86400; localStorage.setItem('maxiSub_v1', JSON.stringify(c)); });
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(!(await appOpen()) && (await t.textContent('#sub-wall')).includes('поднови'), 'абонамент изтекъл преди 5 дни и няма връзка → „да се поднови“');
await t.evaluate(() => Sub.closeWall());

// --- 7. собственик / безплатен достъп
serverDown = false;
server_state = { ok: true, kind: 'free', active: true };
await t.evaluate(() => Sub.refresh()); await t.waitForTimeout(200);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await appOpen(), 'безплатен достъп → играе');
await closeGameIfOpen();

// --- 8. сървърът още не е настроен (503) → не спираме детето
await t.evaluate(() => localStorage.removeItem('maxiSub_v1'));
server_state = { ok: false, error: 'not-configured' };
await t.evaluate(() => Sub.refresh()); await t.waitForTimeout(200);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await appOpen(), 'без отговор от сървъра и без кеш → играе');
await closeGameIfOpen();

// --- 9. „Играй без акаунт“: пробен период на устройството
await t.evaluate(() => {
  localStorage.setItem('hubAccount_v1', JSON.stringify({ local: true }));
  localStorage.setItem('__mockAuth', 'null');
  localStorage.setItem('maxiLocalTrial_v1', String(Math.floor(Date.now() / 1000) - 3 * 86400));
});
await t.reload(); await t.waitForTimeout(500);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await appOpen(), 'без акаунт, ден 3 → играе');
await closeGameIfOpen();
await t.evaluate(() => localStorage.setItem('maxiLocalTrial_v1', String(Math.floor(Date.now() / 1000) - 15 * 86400)));
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(300);
check(await wallOpen(), 'без акаунт, ден 15 → екранът за отключване');
await t.click('#sw-parent'); await passGate(); await t.waitForTimeout(150);
check(await t.locator('#sw-login').isVisible(), 'без акаунт → бутон „Вход / нов акаунт“');
await t.click('#sw-login'); await t.waitForTimeout(200);
check(await activeScreen() === 'login-screen' && !(await wallOpen()), '→ екранът за вход');

// --- 10. извън tapnime.eu абонаментът е изключен
await t.evaluate(() => localStorage.removeItem('__subForce'));
check(await t.evaluate(() => Sub.canPlay() && Sub.state().kind === 'off'), 'на друг адрес (localhost) абонаментът е изключен');

check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} ГРЕШКИ` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
