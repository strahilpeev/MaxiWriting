/* Абонамент: пробен период, екран „Отключи игрите“, код за достъп и състояние в „👤 Акаунт“.
   Сървърът (api/*.php на tapnime.eu) пита Stripe и пази началото на пробния период.
   Тук пазим последния отговор, за да работят игрите и без интернет.

   Използва глобалните функции на app.html: getAccount, whenDB, showLogin, openAdmin. */
(function(){
'use strict';
const S = window.Sub = {};
const CACHE_KEY = 'maxiSub_v1';
const LOCAL_TRIAL_KEY = 'maxiLocalTrial_v1';
const DAY = 86400;
S.TRIAL_DAYS = 14;          // за „Играй без акаунт“ (за акаунтите решава сървърът)
S.GRACE_DAYS = 3;           // колко дни след края да се играе офлайн, докато се провери пак
S.PLANS = {
  month: { label: 'Месечен', price: '4,99 €', per: 'на месец' },
  year:  { label: 'Годишен', price: '49,99 €', per: 'на година', note: '2 месеца подарък' }
};

// Абонаментът важи само на tapnime.eu (там е сървърът). Тестовете го включват с __subForce.
S.enabled = function(){
  try{ if(localStorage.getItem('__subForce') === '1') return true; }catch(e){}
  return /(^|\.)tapnime\.eu$/i.test(location.hostname);
};

const now = () => Math.floor(Date.now() / 1000);
const read = (k) => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
const write = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const acct = () => (typeof getAccount === 'function' ? getAccount() : null);
const isLocal = () => { const a = acct(); return !a || !!a.local; };
function fmtDate(sec){
  const d = new Date(sec * 1000);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}
const daysLeft = (until) => Math.max(0, Math.ceil((until - now()) / DAY));
function toast(t){ if(window.Rewards && Rewards.toast) Rewards.toast(t); }

/* ---------------- Състояние ---------------- */

function localState(){
  let start = +(read(LOCAL_TRIAL_KEY) || 0);
  if(!start){ start = now(); write(LOCAL_TRIAL_KEY, start); }
  const trialEnds = start + S.TRIAL_DAYS * DAY;
  return { kind: 'local-trial', active: now() < trialEnds, trialEnds };
}

// Последното известно състояние (без мрежа). null = още не знаем.
S.state = function(){
  if(!S.enabled()) return { kind: 'off', active: true };
  if(isLocal()) return localState();
  const a = acct(), c = read(CACHE_KEY);
  if(!c || c.uid !== a.uid) return null;
  return c;
};

// Може ли детето да играе в момента.
S.canPlay = function(){
  const st = S.state();
  if(!st) return true;                                  // още не е проверено — не спираме детето
  if(st.kind === 'off' || st.kind === 'free') return true;
  if(st.kind === 'trial' || st.kind === 'local-trial') return now() < st.trialEnds;
  if(st.kind === 'subscription') return now() < (st.periodEnd || 0) + S.GRACE_DAYS * DAY;
  if(st.kind === 'code') return !st.until || now() < st.until + S.GRACE_DAYS * DAY;
  return !!st.active;
};

function api(file, body){
  return new Promise((resolve, reject) => {
    if(typeof whenDB !== 'function') return reject(new Error('no-db'));
    whenDB(db => {
      if(!db.idToken) return reject(new Error('no-token'));
      db.idToken().then(tok => fetch('api/' + file, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      })).then(r => r.json().catch(() => ({ ok: false, error: 'http-' + r.status })).then(j => { j.httpStatus = r.status; return j; }))
        .then(resolve, reject);
    });
  });
}

// Запомня отговора на сървъра (status.php или redeem.php), за да важи и без интернет.
function save(j, a){
  const st = { uid: a.uid, kind: j.kind, active: !!j.active, trialEnds: j.trialEnds || null, periodEnd: j.periodEnd || null,
    until: j.until || null, interval: j.interval || null, cancelAtPeriodEnd: !!j.cancelAtPeriodEnd, status: j.status || null,
    admin: !!j.admin, checkedAt: now() };
  // Часовникът на устройството може да е грешен — пренасяме датите спрямо часа на сървъра.
  const skew = j.now ? now() - j.now : 0;
  if(Math.abs(skew) > 300){ ['trialEnds', 'periodEnd', 'until'].forEach(k => { if(st[k]) st[k] += skew; }); }
  write(CACHE_KEY, st);
}

let refreshing = null;
S.refresh = function(){
  if(!S.enabled() || isLocal()){ render(); return Promise.resolve(S.state()); }
  if(refreshing) return refreshing;
  const a = acct();
  refreshing = api('status.php').then(j => {
    if(j && j.ok) save(j, a);
    return S.state();
  }).catch(() => S.state()).finally(() => { refreshing = null; render(); });
  return refreshing;
};

/* ---------------- Плащане ---------------- */

function go(file, body, btn){
  if(btn){ btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Момент…'; }
  return api(file, body).then(j => {
    if(j && j.ok && j.url){ window.location.href = j.url; return; }
    const msg = j && j.error === 'already-active' ? 'Абонаментът вече е активен.'
      : j && j.error === 'not-configured' ? 'Плащанията още не са включени.'
      : 'Не успях да отворя плащането. Опитайте пак.';
    toast(msg); S.refresh();
    if(btn){ btn.disabled = false; btn.textContent = btn.dataset.t; }
  }).catch(() => {
    toast('Няма връзка с интернет. Плащането изисква интернет.');
    if(btn){ btn.disabled = false; btn.textContent = btn.dataset.t; }
  });
}
S.checkout = (plan, btn) => go('checkout.php', { plan }, btn);
S.portal = (btn) => go('portal.php', {}, btn);

/* ---------------- Код за достъп ---------------- */

const CODE_ERRORS = {
  invalid: 'Няма такъв код. Проверете буквите и цифрите.',
  used: 'Този код вече е използван. Всеки код важи само веднъж.',
  'too-many': 'Много грешни опити. Опитайте пак след един час.',
  'already-active': 'Игрите вече са отключени в този акаунт.',
  'not-configured': 'Кодовете още не са включени.'
};
S.redeem = function(code, btn, msgEl){
  const say = (t, ok) => { if(msgEl){ msgEl.textContent = t; msgEl.className = 'sub-code-msg' + (ok ? ' ok' : ' bad'); } };
  code = String(code || '').trim();
  if(!code){ say('Напишете кода.'); return Promise.resolve(false); }
  const a = acct();
  if(btn){ btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Момент…'; }
  const done = () => { if(btn){ btn.disabled = false; btn.textContent = btn.dataset.t; } };
  return api('redeem.php', { code }).then(j => {
    done();
    if(j && j.ok){
      save(j, a);
      say('✅ Готово!', true);
      toast('🎉 Игрите са отключени. Приятна игра!');
      S.closeWall(); render();
      return true;
    }
    say(CODE_ERRORS[j && j.error] || 'Не успях да проверя кода. Опитайте пак.');
    return false;
  }).catch(() => { done(); say('Няма връзка с интернет. Кодът се проверява онлайн веднъж.'); return false; });
};

function codeFormHtml(open){
  return `<details class="sub-code"${open ? ' open' : ''}>
      <summary>🎟️ Имам код за достъп</summary>
      <div class="sub-code-row">
        <input class="sub-code-in" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
          maxlength="40" placeholder="MAXI-XXXX-XXXX-XXXX-XXXX" aria-label="Код за достъп">
        <button class="pp-btn sub-code-go" type="button">Отключи</button>
      </div>
      <div class="sub-code-msg" aria-live="polite"></div>
      <div class="sub-fine">Кодът се използва само веднъж и отключва игрите за всички деца и устройства в акаунта, без карта.</div>
    </details>`;
}
function bindCode(root){
  root.querySelectorAll('.sub-code').forEach(box => {
    const inp = box.querySelector('.sub-code-in'), go = box.querySelector('.sub-code-go'), msg = box.querySelector('.sub-code-msg');
    const run = () => S.redeem(inp.value, go, msg);
    go.onclick = run;
    inp.onkeydown = (e) => { if(e.key === 'Enter') run(); };
  });
}

/* ---- Кодове за достъп (само собственикът) ----
   Панелът се прави веднъж и се пази: когато „Акаунт“ се изчертае наново
   (например след проверка на абонамента), формата и списъкът не се губят. */
let adminBox = null;
function adminHtml(){
  return `<div class="sub-title" style="margin-top:0.4rem">📊 <a href="stats.html" target="_blank" rel="noopener">Статистика на посещенията и игрите</a> <span class="sa-only">(само за вас)</span></div>
      <div class="sub-title" style="margin-top:0.8rem">🎟️ Кодове за достъп <span class="sa-only">(виждате го само вие)</span></div>
      <div class="sub-admin-row">
        <label>Брой <input class="sa-count" type="number" min="1" max="50" value="1"></label>
        <label>Важи <select class="sa-days">
          <option value="">без срок</option><option value="30">30 дни</option><option value="90">90 дни</option><option value="365">1 година</option>
        </select></label>
        <label class="sa-note-l">Бележка <input class="sa-note" type="text" maxlength="100" placeholder="напр. за кого е"></label>
        <button class="pp-btn sa-make" type="button">➕ Създай</button>
      </div>
      <div class="sa-msg sub-code-msg" aria-live="polite"></div>
      <div class="sa-out"><div class="account-note">Зареждане…</div></div>`;
}
function copyText(text){
  return (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast('Копирано ✅'), () => toast('Маркирайте кода и го копирайте.'));
}
function codesTable(list, fresh){
  if(!list.length) return '<div class="account-note">Още няма кодове. Създайте първия отгоре.</div>';
  const free = list.filter(c => !c.usedAt && !c.revoked).length;
  return `<div class="account-note">Общо ${list.length} · свободни ${free}</div>
    <table class="sa-table"><tr><th>Код</th><th>Бележка</th><th>Срок</th><th>Състояние</th><th></th></tr>${
    list.map(c => {
      const state = c.revoked ? '⛔ спрян' : c.usedAt ? `✅ ${esc(c.email || 'използван')}<br><small>${fmtDate(c.usedAt)}</small>` : '🆕 свободен';
      return `<tr${fresh && fresh.has(c.code) ? ' class="sa-fresh"' : ''}>
        <td class="sa-code"><button class="sa-copy1" type="button" data-code="${esc(c.code)}" title="Копирай">${esc(c.code)} 📋</button></td>
        <td><input class="sa-note-row" type="text" maxlength="100" value="${esc(c.note)}" data-code="${esc(c.code)}" placeholder="бележка…"></td>
        <td>${c.days ? c.days + ' дни' : 'без срок'}</td><td>${state}</td>
        <td class="sa-acts">${c.revoked ? '' : `<button class="pp-btn gray sa-revoke" type="button" data-code="${esc(c.code)}">Спри</button>`}<button class="pp-btn gray sa-del" type="button" data-code="${esc(c.code)}" title="Изтрий" aria-label="Изтрий ${esc(c.code)}">🗑️</button></td></tr>`;
    }).join('')}</table>`;
}
function bindAdmin(box){
  const out = box.querySelector('.sa-out'), msg = box.querySelector('.sa-msg');
  const say = (t, ok) => { msg.textContent = t || ''; msg.className = 'sa-msg sub-code-msg' + (ok ? ' ok' : ' bad'); };
  const fail = (j) => say(j && j.error === 'not-admin' ? 'Нямате права.' : 'Не успях. Проверете интернета.');
  const list = (fresh) => api('codes.php', { action: 'list' }).then(j => {
    if(!(j && j.ok)) return fail(j);
    out.innerHTML = codesTable(j.codes, fresh);
    out.querySelectorAll('.sa-copy1').forEach(b => b.onclick = () => copyText(b.dataset.code));
    out.querySelectorAll('.sa-note-row').forEach(inp => {
      inp.onchange = () => api('codes.php', { action: 'note', code: inp.dataset.code, note: inp.value })
        .then(r => r && r.ok ? toast('Бележката е запазена ✅') : fail(r), () => fail());
      inp.onkeydown = (e) => { if(e.key === 'Enter') inp.blur(); };
    });
    out.querySelectorAll('.sa-revoke').forEach(b => b.onclick = () => {
      if(!confirm('Да спра ли ' + b.dataset.code + '? Ако е използван, игрите в онзи акаунт ще се заключат.')) return;
      api('codes.php', { action: 'revoke', code: b.dataset.code }).then(r => r && r.ok ? list() : fail(r), () => fail());
    });
    out.querySelectorAll('.sa-del').forEach(b => b.onclick = () => {
      const used = !!b.closest('tr').querySelector('td:nth-child(4)').textContent.match(/@|използван/);
      if(!confirm('Да изтрия ли ' + b.dataset.code + '?' + (used ? ' Кодът е използван — игрите в онзи акаунт ще се заключат.' : ''))) return;
      api('codes.php', { action: 'delete', code: b.dataset.code }).then(r => { if(r && r.ok){ toast('Кодът е изтрит'); list(); } else fail(r); }, () => fail());
    });
  }, () => fail());
  box.querySelector('.sa-make').onclick = function(){
    const btn = this; btn.disabled = true; say('');
    api('codes.php', { action: 'create', count: +box.querySelector('.sa-count').value || 1,
      days: box.querySelector('.sa-days').value || null, note: box.querySelector('.sa-note').value })
      .then(j => {
        btn.disabled = false;
        if(!(j && j.ok)) return fail(j);
        const made = j.codes.map(c => c.code);
        say(made.length === 1 ? 'Създаден е ' + made[0] + ' — оцветен е в списъка.' : 'Създадени са ' + made.length + ' кода — оцветени са в списъка.', true);
        box.querySelector('.sa-note').value = '';
        if(made.length > 1){
          const b = document.createElement('button'); b.className = 'pp-btn sa-copy'; b.type = 'button'; b.textContent = '📋 Копирай новите';
          b.onclick = () => copyText(made.join('\n')); msg.appendChild(document.createTextNode(' ')); msg.appendChild(b);
        }
        list(new Set(made));
      }, () => { btn.disabled = false; fail(); });
  };
  list();
}
function adminPanel(){
  if(!adminBox){
    adminBox = document.createElement('div');
    adminBox.className = 'sub-admin';
    adminBox.innerHTML = adminHtml();
    bindAdmin(adminBox);
  }
  return adminBox;
}

/* ---------------- Изглед ---------------- */

function plansHtml(){
  return `<div class="sub-plans">${Object.keys(S.PLANS).map(k => { const p = S.PLANS[k]; return `
      <button class="sub-plan${k === 'year' ? ' best' : ''}" type="button" data-plan="${k}">
        <span class="sp-l">${p.label}</span>
        <span class="sp-p">${p.price}</span>
        <span class="sp-per">${p.per}</span>
        ${p.note ? `<span class="sp-note">${p.note}</span>` : ''}
      </button>`; }).join('')}</div>
    <div class="sub-fine">Плащане с карта, Apple Pay или Google Pay чрез Stripe. Един абонамент важи за всички деца и устройства в акаунта. Може да се спре по всяко време.</div>`;
}
function bindPlans(root){
  root.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => S.checkout(b.dataset.plan, b));
}

// Текстът за състоянието — за „Акаунт“ и за екрана с плановете.
function statusHtml(st){
  if(!st) return '<div class="sub-line">⏳ Проверяваме абонамента…</div>';
  switch(st.kind){
    case 'free': return '<div class="sub-line ok">✅ Пълен достъп</div>';
    case 'code':
      if(st.until && now() >= st.until) return '<div class="sub-line warn">⏰ Срокът на кода за достъп изтече.</div>';
      return st.until
        ? `<div class="sub-line ok">✅ Отключено с код за достъп — до ${fmtDate(st.until)}</div>`
        : '<div class="sub-line ok">✅ Отключено с код за достъп</div>';
    case 'subscription': {
      const plan = st.interval === 'year' ? 'годишен' : 'месечен';
      const when = st.periodEnd ? fmtDate(st.periodEnd) : '';
      if(st.status === 'trialing') return `<div class="sub-line ok">✅ Абонамент (${plan}) — първото плащане е на ${when}</div>`;
      if(st.status === 'past_due') return `<div class="sub-line warn">⚠️ Абонаментът (${plan}) не е платен. Проверете картата в „Управление“.</div>`;
      return st.cancelAtPeriodEnd
        ? `<div class="sub-line warn">✅ Абонамент (${plan}) — спира на ${when}</div>`
        : `<div class="sub-line ok">✅ Абонамент (${plan}) — подновява се на ${when}</div>`;
    }
    case 'trial':
    case 'local-trial': {
      if(now() >= st.trialEnds) return '<div class="sub-line warn">⏰ Пробният период свърши.</div>';
      const d = daysLeft(st.trialEnds);
      const where = st.kind === 'local-trial' ? ' на това устройство' : '';
      return `<div class="sub-line">🎁 Пробен период${where}: ${d === 1 ? 'остава 1 ден' : 'остават ' + d + ' дни'} (до ${fmtDate(st.trialEnds)})</div>`;
    }
    default: return '';
  }
}

// Блокът в „👤 Акаунт“ (вика се от renderAccountScreen).
S.renderAccount = function(el){
  if(!el) return;
  if(!S.enabled()){ el.innerHTML = ''; return; }
  const st = S.state();
  let actions = '';
  if(isLocal()){
    actions = `<div class="account-note">За абонамент или код за достъп е нужен акаунт — така важи за всички деца и устройства.</div>`;
  } else if(st && st.kind === 'subscription'){
    actions = `<button class="pp-btn" type="button" id="sub-portal">⚙️ Управление на абонамента</button>
      <div class="account-note">Смяна на карта, фактури, смяна на плана или спиране.</div>`;
  } else if(st && st.kind === 'code' && !st.until){
    actions = '';
  } else if(st && st.kind !== 'free'){
    actions = plansHtml() + (st.kind === 'code' ? '' : codeFormHtml(false));
  }
  el.innerHTML = `<div class="admin-profile-card sub-card"><div class="sub-title">Абонамент</div>${statusHtml(st)}${actions}</div>`;
  bindPlans(el); bindCode(el);
  if(!isLocal() && st && st.admin) el.firstElementChild.appendChild(adminPanel());
  const p = el.querySelector('#sub-portal'); if(p) p.onclick = () => S.portal(p);
};

/* ---- Екран „Отключи игрите“, когато пробният период е свършил ---- */
function wallTitle(){
  const st = S.state();
  return st && st.kind === 'subscription' ? 'Абонаментът трябва да се поднови'
    : st && st.kind === 'code' ? 'Срокът на кода свърши' : 'Пробният период свърши';
}
S.showWall = function(){
  let m = document.getElementById('sub-wall');
  if(!m){
    m = document.createElement('div');
    m.id = 'sub-wall'; m.className = 'sub-wall'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    document.body.appendChild(m);
  }
  const local = isLocal();
  m.innerHTML = `<div class="sub-box">
      <div class="sub-big">🔒⭐</div>
      <h2>${wallTitle()}</h2>
      <p>Помоли мама, татко или учителя да отключат игрите.</p>
      <div class="sub-row">
        <button class="pp-btn" type="button" id="sw-parent">👨‍👩‍👧 За родители</button>
        <button class="pp-btn gray" type="button" id="sw-close">Затвори</button>
      </div>
    </div>`;
  m.classList.add('open');
  m.querySelector('#sw-close').onclick = S.closeWall;
  m.querySelector('#sw-parent').onclick = () => {
    const show = () => {
      m.querySelector('.sub-box').innerHTML = local
        ? `<h2>Отключете всички игри</h2>
           <p>Абонаментът е към акаунт на родителя и важи за всички деца и устройства.</p>
           <p class="sub-fine">Имате код за достъп? Влезте в акаунта и го въведете тук.</p>
           <div class="sub-row"><button class="pp-btn" type="button" id="sw-login">Вход / нов акаунт</button>
           <button class="pp-btn gray" type="button" id="sw-close2">Затвори</button></div>`
        : `<h2>Отключете всички игри</h2>
           ${statusHtml(S.state())}${plansHtml()}${codeFormHtml(false)}
           <div class="sub-row"><button class="pp-btn gray" type="button" id="sw-close2">Затвори</button></div>`;
      bindPlans(m); bindCode(m);
      const c = m.querySelector('#sw-close2'); if(c) c.onclick = S.closeWall;
      const l = m.querySelector('#sw-login'); if(l) l.onclick = () => { S.closeWall(); if(typeof showLogin === 'function') showLogin(); };
    };
    if(window.Maxi && Maxi.parentGate) Maxi.parentGate(show, 'За родители'); else show();
  };
};
S.closeWall = function(){ const m = document.getElementById('sub-wall'); if(m) m.classList.remove('open'); };
S.wallOpen = () => { const m = document.getElementById('sub-wall'); return !!(m && m.classList.contains('open')); };

// Лента в менюто в последните 3 дни от пробния период и при неплатен абонамент.
function render(){
  const b = document.getElementById('sub-banner');
  if(b){
    const st = S.enabled() ? S.state() : null;
    let text = '';
    if(st && (st.kind === 'trial' || st.kind === 'local-trial')){
      const d = daysLeft(st.trialEnds);
      if(now() >= st.trialEnds) text = '⏰ Пробният период свърши — родител може да го отключи от „👤 Акаунт“';
      else if(d <= 3) text = `🎁 Пробният период свършва след ${d === 1 ? '1 ден' : d + ' дни'}`;
    } else if(st && st.kind === 'code' && st.until && now() >= st.until){
      text = '⏰ Срокът на кода свърши — родител може да отключи игрите от „👤 Акаунт“';
    } else if(st && st.kind === 'subscription' && st.status === 'past_due'){
      text = '⚠️ Абонаментът не е платен — проверете в „👤 Акаунт“';
    }
    b.textContent = text; b.hidden = !text;
  }
  const acc = document.getElementById('acc-sub');
  if(acc && acc.offsetParent !== null) S.renderAccount(acc);
}
S.render = render;

/* ---------------- Старт ---------------- */
function boot(){
  // Връщане от Stripe
  const q = new URLSearchParams(location.search);
  const back = q.get('abonament');
  if(back){
    try{ history.replaceState(null, '', location.pathname); }catch(e){}
    if(back === 'ok'){
      toast('Благодарим! Абонаментът се активира… 🎉');
      // Stripe понякога завършва плащането след няколко секунди
      let n = 0;
      const again = () => S.refresh().then(st => {
        if(st && st.kind === 'subscription') toast('✅ Абонаментът е активен. Приятна игра!');
        else if(++n < 5) setTimeout(again, 3000);
      });
      setTimeout(again, 800);
    } else if(back === 'otkaz'){
      toast('Плащането беше отказано. Нищо не е таксувано.');
    }
  }
  render();
  if(typeof whenDB === 'function'){
    whenDB(db => {
      db.ready.then(() => setTimeout(S.refresh, 50));
      db.onAuth(() => setTimeout(S.refresh, 50));
    });
  }
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState !== 'visible') return;
    const st = S.state();
    if(!st || !st.checkedAt || now() - st.checkedAt > 3600) S.refresh(); else render();
  });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
