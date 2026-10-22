/* Абонамент: пробен период, екран „Отключи игрите“ и състояние в „👤 Акаунт“.
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

let refreshing = null;
S.refresh = function(){
  if(!S.enabled() || isLocal()){ render(); return Promise.resolve(S.state()); }
  if(refreshing) return refreshing;
  const a = acct();
  refreshing = api('status.php').then(j => {
    if(j && j.ok){
      const st = { uid: a.uid, kind: j.kind, active: !!j.active, trialEnds: j.trialEnds || null, periodEnd: j.periodEnd || null,
        interval: j.interval || null, cancelAtPeriodEnd: !!j.cancelAtPeriodEnd, status: j.status || null, checkedAt: now() };
      // Часовникът на устройството може да е грешен — пренасяме датите спрямо часа на сървъра.
      const skew = j.now ? now() - j.now : 0;
      if(Math.abs(skew) > 300){ ['trialEnds', 'periodEnd'].forEach(k => { if(st[k]) st[k] += skew; }); }
      write(CACHE_KEY, st);
    }
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
    actions = `<div class="account-note">За абонамент е нужен акаунт — така важи за всички деца и устройства.</div>`;
  } else if(st && st.kind === 'subscription'){
    actions = `<button class="pp-btn" type="button" id="sub-portal">⚙️ Управление на абонамента</button>
      <div class="account-note">Смяна на карта, фактури, смяна на плана или спиране.</div>`;
  } else if(st && st.kind !== 'free'){
    actions = plansHtml();
  }
  el.innerHTML = `<div class="admin-profile-card sub-card"><div class="sub-title">Абонамент</div>${statusHtml(st)}${actions}</div>`;
  bindPlans(el);
  const p = el.querySelector('#sub-portal'); if(p) p.onclick = () => S.portal(p);
};

/* ---- Екран „Отключи игрите“, когато пробният период е свършил ---- */
function wallTitle(){
  const st = S.state();
  return st && st.kind === 'subscription' ? 'Абонаментът трябва да се поднови' : 'Пробният период свърши';
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
           <div class="sub-row"><button class="pp-btn" type="button" id="sw-login">Вход / нов акаунт</button>
           <button class="pp-btn gray" type="button" id="sw-close2">Затвори</button></div>`
        : `<h2>Отключете всички игри</h2>
           ${statusHtml(S.state())}${plansHtml()}
           <div class="sub-row"><button class="pp-btn gray" type="button" id="sw-close2">Затвори</button></div>`;
      bindPlans(m);
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
