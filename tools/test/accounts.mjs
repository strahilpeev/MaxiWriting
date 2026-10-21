// Тест на акаунтите в хъба (app.html) с имитация на Firebase.
//   node test/accounts.mjs            — изходния код
//   node test/accounts.mjs dist       — защитената версия
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
}).listen(8701);

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
// Без service worker: иначе той сервира кеширания модул и „офлайн“ не е истински.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
let offline = false;
await ctx.route('**/firebase-shared.js', (r) => offline ? r.abort() : r.fulfill({ contentType: 'text/javascript', body: MOCK }));
await ctx.route(/^https:/, (r) => r.abort());
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
t.on('dialog', (d) => d.accept());

let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };
const visible = (sel) => t.locator(sel).isVisible();
const activeScreen = () => t.evaluate(() => (document.querySelector('.screen.active') || {}).id || '(app)');
const URL = 'http://localhost:8701/app.html';

// --- 1. Таблет отпреди акаунтите: има дете „Мая“ на устройството и стари данни в облака
await t.goto(URL);
await t.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('hubChildProfiles_v1', JSON.stringify([{ id: 'p1', name: 'Мая', avatar: '🦊' }]));
  localStorage.setItem('hubActiveProfile_v1', JSON.stringify({ id: 'p1', name: 'Мая', avatar: '🦊' }));
  localStorage.setItem('__mockLegacy', JSON.stringify([{ id: 'p9', name: 'Стар профил', avatar: '🐻', stats: { sbor: { stars: 3 } } }]));
});
await t.reload(); await t.waitForTimeout(400);
check(await activeScreen() === 'login-screen', 'без акаунт → показва се входът за възрастни');

// --- 2. Грешки във формата
await t.click('#login-toggle');
await t.fill('#login-email', 'mama@test.bg'); await t.fill('#login-pass', '123456'); await t.fill('#login-pass2', '654321');
await t.click('#login-submit');
check((await t.textContent('#login-msg')).includes('не съвпадат'), 'регистрация: несъвпадащи пароли → съобщение');
await t.fill('#login-pass', '123'); await t.fill('#login-pass2', '123'); await t.click('#login-submit');
check((await t.textContent('#login-msg')).includes('6 знака'), 'регистрация: къса парола → съобщение');
await t.click('#login-google'); await t.waitForTimeout(100);
check((await t.textContent('#login-msg')).includes('не е включен'), 'грешка при вход с Google се показва на български');

// --- 3. Регистрация → директно към игрите, детето от устройството е в акаунта
await t.fill('#login-pass', '123456'); await t.fill('#login-pass2', '123456'); await t.click('#login-submit');
await t.waitForTimeout(500);
check(await activeScreen() === 'menu', 'след регистрация → менюто с игрите на „Мая“');
const cloud1 = await t.evaluate(() => JSON.parse(localStorage.getItem('__mockCloud')));
const acc1 = Object.values(cloud1.accounts)[0];
check(acc1 && acc1.profiles.p1 && acc1.profiles.p1.name === 'Мая', 'профилът от устройството е качен в акаунта');

// --- 4. Презареждане → без вход, направо игрите
await t.reload(); await t.waitForTimeout(400);
check(await activeScreen() === 'menu', 'повторно отваряне → без екран за вход');

// --- 5. Без интернет, но вписано устройство → детето играе
offline = true;
await t.reload(); await t.waitForTimeout(600);
check(await activeScreen() === 'menu', 'офлайн (Firebase не се зарежда) → менюто се показва');
offline = false;
await t.reload(); await t.waitForTimeout(400);

// --- 6. Игра → статистиката отива в акаунта
await t.click('button.tile[onclick*="matematika_sbor"]'); await t.waitForTimeout(800);
await t.click('#home-btn'); await t.waitForTimeout(500);
check(errors.length === 0, 'игра и връщане без грешки');

// --- 7. Екран „Акаунт“ зад родителската проверка + пренасяне на старите профили
await t.click('#switch-profile-btn'); await t.waitForTimeout(200);
await t.click('.admin-link'); await t.waitForTimeout(200);
const q = await t.textContent('#mx-gate-q');
const [a, b] = q.match(/\d+/g).map(Number);
await t.fill('#mx-gate-in', String(a * b)); await t.click('#mx-gate-ok'); await t.waitForTimeout(400);
check(await activeScreen() === 'admin-screen', 'родителска проверка → екран „Акаунт“');
check((await t.textContent('#acc-email')) === 'mama@test.bg', 'показва имейла на акаунта');
check(await visible('#acc-resend'), 'непотвърден имейл → бутон „Изпрати писмото пак“');
check((await t.textContent('#admin-list')).includes('Мая'), 'списъкът с деца съдържа „Мая“');
await t.click('#acc-import'); await t.waitForTimeout(500);
check((await t.textContent('#acc-legacy')).includes('Пренесени са 1'), 'старите профили се пренасят');
check((await t.textContent('#admin-list')).includes('Стар профил'), 'пренесеният профил се вижда в акаунта');

// --- 8. Изход → децата изчезват от устройството, показва се входът
await t.click('#acc-signout'); await t.waitForTimeout(400);
check(await activeScreen() === 'login-screen', 'изход → екран за вход');
const localAfter = await t.evaluate(() => localStorage.getItem('hubChildProfiles_v1'));
check(localAfter === '[]', 'след изход профилите са махнати от устройството');

// --- 9. Друг акаунт на същия таблет не вижда чуждите деца
await t.click('#login-toggle');
await t.fill('#login-email', 'logoped@test.bg'); await t.fill('#login-pass', 'abcdef'); await t.fill('#login-pass2', 'abcdef');
await t.click('#login-submit'); await t.waitForTimeout(500);
check(await activeScreen() === 'profile-screen', 'втори акаунт → празен избор на профил');
const names = await t.locator('.profile-card .name').allTextContents();
check(!names.includes('Мая') && !names.includes('Стар профил'), 'вторият акаунт не вижда децата на първия');

// --- 10. Обратно в първия акаунт → децата се връщат от облака
await t.evaluate(() => window.MaxiDB.signOut()); await t.waitForTimeout(300);
await t.fill('#login-email', 'mama@test.bg'); await t.fill('#login-pass', 'грешна'); await t.click('#login-submit'); await t.waitForTimeout(200);
check((await t.textContent('#login-msg')).includes('Грешен'), 'грешна парола → съобщение');
await t.fill('#login-pass', '123456'); await t.click('#login-submit'); await t.waitForTimeout(600);
const names2 = await t.locator('.profile-card .name').allTextContents();
check(names2.includes('Мая') && names2.includes('Стар профил'), 'отново първият акаунт → децата се връщат');

// --- 11. Изход по време на игра (напр. сменена парола другаде) не прекъсва детето
await t.locator('.profile-card', { hasText: 'Мая' }).click(); await t.waitForTimeout(200);
await t.click('button.tile[onclick*="chetene"]'); await t.waitForTimeout(500);
await t.evaluate(() => window.MaxiDB.signOut()); await t.waitForTimeout(300);
check(await t.locator('#app-screen').evaluate((el) => el.classList.contains('active')), 'изход отвън по време на игра → играта продължава');
await t.click('#home-btn'); await t.waitForTimeout(300);
check(await activeScreen() === 'login-screen', '…и входът се показва чак след връщане от играта');

// --- 12. Първо пускане без интернет
await t.evaluate(() => localStorage.clear());
offline = true;
await t.reload(); await t.waitForTimeout(8500);
check((await t.textContent('#login-msg')).includes('интернет'), 'първо пускане без интернет → обяснение');
offline = false;

// --- 13. Игра без акаунт (напр. входът във Firebase още не е настроен)
await t.evaluate(() => localStorage.clear());
await t.reload(); await t.waitForTimeout(400);
await t.click('#login-google'); await t.waitForTimeout(100); // входът дава грешка…
await t.click('#login-local'); await t.waitForTimeout(300);   // …но „Играй без акаунт“ пуска към игрите
check(await activeScreen() === 'profile-screen', 'без акаунт → избор на профил');
await t.locator('.profile-card').last().click(); await t.waitForTimeout(200);
await t.fill('#new-profile-name', 'Иво'); await t.click('#new-profile-screen .btn.save'); await t.waitForTimeout(300);
check(await activeScreen() === 'menu', 'без акаунт → нов профил и менюто с игрите');
await t.reload(); await t.waitForTimeout(500);
check(await activeScreen() === 'menu', 'без акаунт → след презареждане пак направо игрите');
const cloudLocal = await t.evaluate(() => localStorage.getItem('__mockCloud'));
check(!cloudLocal || !cloudLocal.includes('Иво'), 'без акаунт → нищо не отива в облака');

// --- 14. Значки „НОВО“: в менюто и вътре в приложението, изчезват след отваряне
const badge = () => t.locator('button.tile[onclick*="vnimanie"] .tile-new').textContent().catch(() => '');
check((await badge()).includes('3 нови'), '„Внимание и памет“ показва „✨ 3 нови“');
await t.click('button.tile[onclick*="vnimanie"]'); await t.waitForTimeout(700);
const fr = t.frameLocator('#app-frame');
check(await fr.locator('.mx-tile[onclick*="labirint"] .mx-new').count() === 1, 'вътре: „Лабиринт“ има значка НОВО');
check(await fr.locator('.mx-tile[onclick*="memory"] .mx-new').count() === 0, 'вътре: старата игра „Двойки“ е без значка');
await fr.locator('.mx-tile[onclick*="labirint"]').click(); await t.waitForTimeout(300);
await t.click('#home-btn'); await t.waitForTimeout(400);
check((await badge()).includes('2 нови'), 'след отваряне на „Лабиринт“ → „✨ 2 нови“');

// --- 15. Вход след игра без акаунт → децата минават в акаунта
await t.click('#switch-profile-btn'); await t.waitForTimeout(200);
await t.click('.admin-link'); await t.waitForTimeout(200);
const q2 = await t.textContent('#mx-gate-q');
const [a2, b2] = q2.match(/\d+/g).map(Number);
await t.fill('#mx-gate-in', String(a2 * b2)); await t.click('#mx-gate-ok'); await t.waitForTimeout(300);
check((await t.textContent('#account-box')).includes('без акаунт'), 'екран „Акаунт“ казва, че се играе без акаунт');
await t.click('#acc-login'); await t.waitForTimeout(200);
check((await t.textContent('#login-local')).includes('Обратно'), 'от „Акаунт“ входът има бутон „Обратно към игрите“');
await t.click('#login-toggle');
await t.fill('#login-email', 'tatko@test.bg'); await t.fill('#login-pass', '123456'); await t.fill('#login-pass2', '123456');
await t.click('#login-submit'); await t.waitForTimeout(700);
check(await activeScreen() === 'menu', 'нов акаунт след игра без акаунт → направо игрите на „Иво“');
const names3 = await t.evaluate(() => JSON.parse(localStorage.getItem('hubChildProfiles_v1')).map(p => p.name));
check(names3.includes('Иво'), 'профилът „Иво“ остава на устройството след входа');
const cloud3 = await t.evaluate(() => localStorage.getItem('__mockCloud'));
check(cloud3.includes('Иво'), '„Иво“ е качен в облака на акаунта');

check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await t.screenshot({ path: path.join(__dirname, 'login.png') });
await browser.close(); server.close();
console.log(failed ? `\n${failed} проблема` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
