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

  // кодове за достъп: само собственикът ги създава
  const OWN = token({ sub: 'uidO', email: 'owner@example.com' });
  chk((await call('codes.php', token({}), { action: 'list' })).code === 403, 'родител не може да създава кодове → 403');
  chk((await call('codes.php', token({ sub: 'uidO2', email: 'owner@example.com', email_verified: false }), { action: 'list' })).code === 403, 'собственик с непотвърден имейл → 403');
  chk((await call('codes.php', OWN, { action: 'create', count: 99 })).code === 400, 'повече от 50 кода наведнъж → 400');
  r = await call('codes.php', OWN, { action: 'create', count: 3, note: 'Училище №1' });
  chk(r.code === 200 && r.j.codes.length === 3 && r.j.codes.every((c) => /^MAXI(-[A-HJ-KMNP-Z2-9]{4}){4}$/.test(c.code)), '3 кода във вид MAXI-XXXX-XXXX-XXXX-XXXX (16 знака) без I, L, O, 0, 1');
  const big = await call('codes.php', OWN, { action: 'create', count: 50 });
  const bodies = big.j.codes.map((c) => c.code.slice(5).replace(/-/g, ''));
  const freq = {}; bodies.join('').split('').forEach((ch) => freq[ch] = (freq[ch] || 0) + 1);
  chk(new Set(bodies).size === 50 && Object.keys(freq).length >= 28, '50 кода — всички различни, използват почти всички 31 знака (случайни)');
  for (const c of big.j.codes) await call('codes.php', OWN, { action: 'delete', code: c.code });
  const [c1, c2, c3] = r.j.codes.map((c) => c.code);
  r = await call('codes.php', OWN, { action: 'create', count: 1, days: 30 });
  const c30 = r.j.codes[0].code;
  chk(r.j.codes[0].days === 30, 'код за 30 дни');
  r = await call('status.php', OWN);
  chk(r.j.admin === true, 'status.php казва на собственика, че е администратор');
  r = await call('status.php', token({}));
  chk(!('admin' in r.j), '…а на родителя — не');

  // родител с изтекъл пробен период въвежда код
  const P = token({});
  r = await call('redeem.php', P, { code: 'MAXI-AAAA-AAAA' });
  chk(r.code === 400 && r.j.error === 'invalid', 'грешен код → invalid');
  r = await call('redeem.php', P, { code: '  ' + c1.toLowerCase().replace(/-/g, ' ') + ' ' });
  chk(r.code === 200 && r.j.active === true && r.j.kind === 'code' && r.j.until === null, 'код с малки букви и интервали → отключено без срок');
  r = await call('status.php', P);
  chk(r.j.active === true && r.j.kind === 'code', 'status.php помни кода');
  chk((await call('checkout.php', P, { plan: 'month' })).code === 409, 'с код без срок не се плаща');
  chk((await call('redeem.php', P, { code: c2 })).j.error === 'already-active', 'втори код в същия акаунт не се хаби');
  const T2 = token({ sub: 'uidC', email: 'c@example.com' });
  r = await call('redeem.php', T2, { code: c1 });
  chk(r.code === 409 && r.j.error === 'used', 'използван код в друг акаунт → used');
  // кирилица вместо латиница (А, В, Е, К, М, Н, Р, С, Т, Х)
  const cyr = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', P: 'Р', C: 'С', T: 'Т', X: 'Х' };
  r = await call('redeem.php', T2, { code: c2.replace(/[ABEKMHPCTX]/g, (ch) => cyr[ch]) });
  chk(r.code === 200 && r.j.kind === 'code', 'код, написан с кирилски букви → приема се');

  // код със срок
  const T3 = token({ sub: 'uidD', email: 'd@example.com' });
  r = await call('redeem.php', T3, { code: c30 });
  chk(r.j.kind === 'code' && Math.round((r.j.until - r.j.now) / 86400) === 30, 'код за 30 дни → до след 30 дни');
  await call('checkout.php', T3, { plan: 'year' });
  chk(+stripe.sessions.at(-1)['subscription_data[trial_end]'] === r.j.until, 'абонамент по време на кода → плащането започва в края му');
  const df = path.join(DATA, 'users', 'uidD.json');
  const drec = JSON.parse(fs.readFileSync(df, 'utf8'));
  drec.code.until = Math.floor(Date.now() / 1000) - 10; drec.firstSeen -= 40 * 86400; fs.writeFileSync(df, JSON.stringify(drec));
  r = await call('status.php', T3);
  chk(r.j.active === false && r.j.kind === 'trial', 'изтекъл код → пак е нужен абонамент');
  r = await call('redeem.php', T3, { code: c30 });
  chk(r.code === 409 && r.j.error === 'used' && (await call('status.php', T3)).j.active === false, 'изтеклият код не може да се въведе пак в същия акаунт (само веднъж)');

  // бележка към код
  chk((await call('codes.php', OWN, { action: 'note', code: c3, note: 'Семейство Иванови ' + 'я'.repeat(200) })).code === 200, 'бележката на кода се сменя');
  r = await call('codes.php', OWN, { action: 'list' });
  const n3 = r.j.codes.find((c) => c.code === c3).note;
  chk(n3.startsWith('Семейство Иванови') && [...n3].length === 100, 'дългата бележка се съкращава до 100 знака, без да се чупи кирилицата');
  chk((await call('codes.php', P, { action: 'note', code: c3, note: 'x' })).code === 403, 'родител не може да сменя бележки');

  // спиране на код
  r = await call('codes.php', OWN, { action: 'revoke', code: c2 });
  chk(r.code === 200, 'собственикът спира код');
  r = await call('status.php', T2);
  chk(r.j.kind !== 'code', 'спрян код → акаунтът губи достъпа');
  chk((await call('redeem.php', token({ sub: 'uidE', email: 'e@example.com' }), { code: c2 })).j.error === 'invalid', 'спрян код не може да се въведе');
  r = await call('codes.php', OWN, { action: 'list' });
  const L = Object.fromEntries(r.j.codes.map((c) => [c.code, c]));
  chk(L[c1].email === 'parent@example.com' && L[c1].usedAt && L[c2].revoked && !L[c3].usedAt && L[c1].note === 'Училище №1', 'списъкът показва кой е използвал кода, спрените и свободните');

  // изтриване
  r = await call('codes.php', OWN, { action: 'create', count: 2 });
  const [d1, d2] = r.j.codes.map((c) => c.code);
  chk((await call('codes.php', P, { action: 'delete', code: d1 })).code === 403, 'родител не може да трие кодове');
  chk((await call('codes.php', OWN, { action: 'delete', code: d1 })).code === 200, 'собственикът изтрива код');
  r = await call('codes.php', OWN, { action: 'list' });
  chk(!r.j.codes.some((c) => c.code === d1) && r.j.codes.some((c) => c.code === d2), 'изтритият код изчезва от списъка, другите остават');
  chk((await call('redeem.php', token({ sub: 'uidH', email: 'h@example.com' }), { code: d1 })).j.error === 'invalid', 'изтрит код не може да се въведе');
  chk((await call('codes.php', OWN, { action: 'delete', code: d1 })).code === 404, 'изтриване на несъществуващ код → 404');
  const TH = token({ sub: 'uidI', email: 'i@example.com' });
  await call('redeem.php', TH, { code: d2 });
  await call('codes.php', OWN, { action: 'delete', code: d2 });
  chk((await call('status.php', TH)).j.kind !== 'code', 'изтрит използван код → акаунтът губи достъпа');
  // стар 8-знаков код още важи
  const cf = path.join(DATA, 'codes.json'), all = JSON.parse(fs.readFileSync(cf, 'utf8'));
  all['ABCD2345'] = { created: 1, days: null, note: '', usedBy: null }; fs.writeFileSync(cf, JSON.stringify(all));
  r = await call('redeem.php', token({ sub: 'uidJ', email: 'j@example.com' }), { code: 'maxi-abcd-2345' });
  chk(r.code === 200 && r.j.kind === 'code', 'стар код MAXI-XXXX-XXXX още се приема');

  // защита от налучкване: 10 грешни опита на час
  const G = token({ sub: 'uidG', email: 'g@example.com' });
  for (let i = 0; i < 10; i++) await call('redeem.php', G, { code: 'MAXI-ZZZZ-ZZZZ-ZZZZ-ZZZ' + 'ABCDEFGHJK'[i] });
  r = await call('redeem.php', G, { code: c3 });
  chk(r.code === 429 && r.j.error === 'too-many', '11-ти опит след 10 грешни → изчакване (дори с верен код)');
  chk(fs.existsSync(path.join(DATA, 'codes.json')) && (fs.statSync(path.join(DATA, 'codes.json')).mode & 0o077) === 0, 'codes.json е достъпен само за сървъра (0600)');

  // статистика: анонимни посещения и игри
  const dd = (k) => { const d = new Date(Date.now() + k * 86400000); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' }); };
  const T0 = dd(0), T1 = dd(-1);
  const tr = (e) => fetch('http://127.0.0.1:8794/api/track.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e }) });
  r = await tr([
    { t: 'v', d: T0, u: 'deviceAAAA_p1' }, { t: 'v', d: T0, u: 'deviceAAAA_p1' }, { t: 'v', d: T0, u: 'deviceBBBB_p7' },
    { t: 'g', g: 'dvizhenie/konturi', d: T0, u: 'deviceAAAA_p1' }, { t: 'g', g: 'dvizhenie/konturi', d: T0, u: 'deviceBBBB_p7' },
    { t: 'g', g: 'dvizhenie/konturi', d: T0, u: 'deviceBBBB_p7' }, { t: 'g', g: 'pisane', d: T1, u: 'deviceAAAA_p1' },
    { t: 'v', d: T1, u: 'deviceAAAA_p1' },
    // боклук — пропуска се
    { t: 'x', d: T0, u: 'deviceAAAA_p1' }, { t: 'g', g: '../etc', d: T0, u: 'deviceAAAA_p1' }, { t: 'v', d: '2001-01-01', u: 'deviceAAAA_p1' },
    { t: 'v', d: T0, u: 'короткo' }, { t: 'g', g: 'A/B', d: T0, u: 'deviceAAAA_p1' }
  ]);
  chk(r.status === 204, 'track.php приема събития без вход (204)');
  chk((await tr('нещо')).status === 400, 'track.php: лоши данни → 400');
  const sfiles = fs.readdirSync(path.join(DATA, 'stats'));
  const raw = fs.readFileSync(path.join(DATA, 'stats', T0.slice(0, 7) + '.json'), 'utf8');
  chk(!/device/.test(raw) && sfiles.includes('salt.txt'), 'на сървъра няма ключовете на устройствата — само съкратен HMAC');
  chk((await call('stats.php', token({}), {})).code === 403, 'родител не вижда статистиката → 403');
  r = await call('stats.php', OWN, { days: 30 });
  const s0 = r.j.days[T0], s1 = r.j.days[T1];
  chk(r.code === 200 && s0.v === 3 && s0.vu === 2, 'днес: 3 посещения от 2 потребители (' + (s0 && s0.v) + '/' + (s0 && s0.vu) + ')');
  chk(s0.g['dvizhenie/konturi'][0] === 3 && s0.g['dvizhenie/konturi'][1] === 2 && s0.p === 3 && s0.pu === 2, 'игра днес: 3 пъти от 2 потребители');
  chk(s1.v === 1 && s1.g['pisane'][0] === 1 && !('A/B' in s0.g) && !('../etc' in s0.g), 'вчера отделно; невалидните игри са пропуснати');
  chk(r.j.periods['7'].users === 2 && r.j.periods['7'].games['dvizhenie/konturi'] === 2 && r.j.periods['7'].games['pisane'] === 1, 'за 7 дни: 2 различни потребители, по игри — също');

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
