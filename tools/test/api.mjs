// Тест на PHP частта на абонамента (api/*.php) без интернет:
// собствен ключ за подпис на „Firebase“ токени и имитация на Stripe.
//   node test/api.mjs        (нужен е php в PATH)
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
try { execSync('php -v', { stdio: 'ignore' }); } catch (e) { console.log('(няма php — тестът на api/ се пропуска)'); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'maxi-api-'));
let ok = 0, bad = 0;
const chk = (c, m) => { c ? ok++ : bad++; console.log(c ? '✓' : '✗', m); };

/* ---------- ключ и сертификат за подпис на токените ---------- */
const keyFile = path.join(TMP, 'k.pem'), crtFile = path.join(TMP, 'c.pem');
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyFile} -out ${crtFile} -days 2 -subj /CN=test 2>/dev/null`);
const KEY = fs.readFileSync(keyFile, 'utf8');
fs.writeFileSync(path.join(TMP, 'certs.json'), JSON.stringify({ kid1: fs.readFileSync(crtFile, 'utf8') }));
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims, opt = {}) {
  const now = Math.floor(Date.now() / 1000);
  const c = Object.assign({ aud: 'maxiwriting', iss: 'https://securetoken.google.com/maxiwriting', iat: now, exp: now + 3600,
    sub: 'uidA', email: 'parent@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } }, claims);
  const h = b64({ alg: 'RS256', kid: opt.kid || 'kid1', typ: 'JWT' }), p = b64(c);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), opt.key || KEY).toString('base64url');
  return `${h}.${p}.${sig}`;
}

/* ---------- имитация на Stripe ---------- */
const stripe = { customers: [], subs: [], sessions: [], portal: 0 };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => body += d);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = new URLSearchParams(body);
    const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Basic ' + Buffer.from('sk_test_x:').toString('base64')) return send({ error: { message: 'auth' } }, 401);
    if (u.pathname === '/customers' && req.method === 'POST') {
      const c = { id: 'cus_' + (stripe.customers.length + 1), email: p.get('email'), uid: p.get('metadata[uid]') };
      stripe.customers.push(c); return send(c);
    }
    if (u.pathname === '/checkout/sessions' && req.method === 'POST') {
      const s = Object.fromEntries(p); stripe.sessions.push(s);
      return send({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    }
    if (u.pathname === '/subscriptions' && req.method === 'GET') {
      return send({ data: stripe.subs.filter((s) => s.customer === u.searchParams.get('customer')) });
    }
    if (u.pathname === '/billing_portal/sessions' && req.method === 'POST') { stripe.portal++; return send({ url: 'https://billing.stripe.test/p' }); }
    send({ error: { message: 'unknown ' + u.pathname } }, 404);
  });
}).listen(8793);

/* ---------- PHP сървър ---------- */
const DATA = path.join(TMP, 'data');
fs.writeFileSync(path.join(TMP, 'config.php'), `<?php return [
  'stripe_secret' => 'sk_test_x', 'prices' => ['month' => 'price_m', 'year' => 'price_y'],
  'trial_days' => 14, 'site' => 'https://test.tapnime.eu', 'free_emails' => ['owner@example.com'],
  'firebase_project' => 'maxiwriting', 'data_dir' => ${JSON.stringify(DATA)} ];`);
const php = spawn('php', ['-S', '127.0.0.1:8794', '-t', ROOT], {
  env: Object.assign({}, process.env, { MAXI_CONFIG: path.join(TMP, 'config.php'), MAXI_CERTS_FILE: path.join(TMP, 'certs.json'), MAXI_STRIPE_BASE: 'http://127.0.0.1:8793/' }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 700));

async function call(file, tok, body, method = 'POST', headers = {}) {
  const r = await fetch('http://127.0.0.1:8794/api/' + file, {
    method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}, headers),
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { code: r.status, j };
}

try {
  // достъп и токени
  chk((await call('status.php', null)).code === 401, 'без токен → 401');
  chk((await call('status.php', token({}), null, 'GET')).code === 405, 'GET → 405');
  chk((await call('status.php', token({ aud: 'other' }))).code === 401, 'чужд проект → 401');
  chk((await call('status.php', token({ exp: Math.floor(Date.now() / 1000) - 10 }))).code === 401, 'изтекъл токен → 401');
  chk((await call('status.php', token({ firebase: { sign_in_provider: 'anonymous' } }))).code === 401, 'анонимен вход → 401');
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  chk((await call('status.php', token({}, { key: otherKey }))).code === 401, 'фалшив подпис → 401');
  chk((await call('status.php', token({ sub: '../x' }))).code === 401, 'лош uid → 401');
  chk((await call('status.php', token({}), {}, 'POST', { Origin: 'https://evil.example' })).code === 403, 'чужд Origin → 403');

  // пробен период
  let r = await call('status.php', token({}));
  chk(r.code === 200 && r.j.active === true && r.j.kind === 'trial', 'нов акаунт → пробен период');
  const days = Math.round((r.j.trialEnds - r.j.now) / 86400);
  chk(days === 14, '14 дни пробен период (' + days + ')');
  const uf = path.join(DATA, 'users', 'uidA.json');
  const rec = JSON.parse(fs.readFileSync(uf, 'utf8'));
  rec.firstSeen -= 15 * 86400; fs.writeFileSync(uf, JSON.stringify(rec));
  r = await call('status.php', token({}));
  chk(r.j.active === false && r.j.kind === 'trial', 'след 15 дни → без достъп');

  // безплатен акаунт
  r = await call('status.php', token({ sub: 'uidO', email: 'owner@example.com' }));
  chk(r.j.active === true && r.j.kind === 'free', 'собственикът е безплатно');
  r = await call('status.php', token({ sub: 'uidO2', email: 'owner@example.com', email_verified: false }));
  chk(r.j.kind === 'trial', 'непотвърден имейл на собственика → не е безплатно');

  // плащане
  chk((await call('checkout.php', token({}), { plan: 'week' })).code === 400, 'непознат план → 400');
  r = await call('checkout.php', token({}), { plan: 'year' });
  chk(r.code === 200 && r.j.url.startsWith('https://checkout.stripe.test/'), 'checkout връща адрес');
  const s = stripe.sessions.at(-1);
  chk(s['line_items[0][price]'] === 'price_y' && s.mode === 'subscription' && s.customer === 'cus_1', 'годишна цена, абонамент, клиент cus_1');
  chk(s.success_url === 'https://test.tapnime.eu/app.html?abonament=ok' && s.locale === 'bg', 'адрес за връщане и български');
  chk(!('subscription_data[trial_end]' in s), 'изтекъл пробен период → плащане веднага');
  await call('checkout.php', token({}), { plan: 'month' });
  chk(stripe.customers.length === 1, 'клиентът в Stripe се създава само веднъж');

  // абонат по време на пробния период → плащането започва в края му
  r = await call('status.php', token({ sub: 'uidB', email: 'b@example.com' }));
  await call('checkout.php', token({ sub: 'uidB', email: 'b@example.com' }), { plan: 'month' });
  chk(+stripe.sessions.at(-1)['subscription_data[trial_end]'] === r.j.trialEnds, 'по време на пробния период → trial_end = края му');

  // активен абонамент
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  stripe.subs.push({ id: 'sub_1', customer: 'cus_1', status: 'active', created: 1, cancel_at_period_end: false,
    items: { data: [{ current_period_end: end, price: { recurring: { interval: 'year' } } }] } });
  r = await call('status.php', token({}));
  chk(r.j.active === true && r.j.kind === 'subscription' && r.j.interval === 'year' && r.j.periodEnd === end, 'активен годишен абонамент');
  chk((await call('checkout.php', token({}), { plan: 'month' })).code === 409, 'втори абонамент не се позволява');
  stripe.subs[0].status = 'canceled';
  r = await call('status.php', token({}));
  chk(r.j.active === false, 'спрян абонамент + изтекъл пробен период → без достъп');

  // портал
  r = await call('portal.php', token({}));
  chk(r.code === 200 && r.j.url && stripe.portal === 1, 'портал за управление');
  chk((await call('portal.php', token({ sub: 'uidNew', email: 'n@example.com' }))).code === 404, 'портал без клиент → 404');

  // защитени файлове
  const lib = await fetch('http://127.0.0.1:8794/api/lib.php');
  const libText = await lib.text();
  chk(!/stripe_secret/.test(libText) || lib.status >= 400 || libText.trim() === '', 'lib.php не изписва нищо');
} finally {
  php.kill(); mock.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${ok} ✓, ${bad} ✗`);
console.log(bad ? 'ИМА ГРЕШКИ' : 'Всичко е наред');
process.exit(bad ? 1 : 0);
