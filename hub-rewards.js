/* Награди в хъба (app.html): общ басейн от звезди, нива, празнуване на ново
   ниво, аватари за нивата, значки, грамоти и общо класиране.
   Зарежда се след основния скрипт на хъба и ползва неговите функции
   (loadProfiles, readNewApp, whenDB, …). Излага window.Rewards. */
(function(){
'use strict';
const R = {};
window.Rewards = R;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ================= Нива =================
   Общият басейн от звезди на детето = звездите за серии (5 поредни верни) от
   всички игри + 1 ⭐ на всеки 100 точки (сбор от всички игри) + бонусите за
   званията във всяка игра (правилата за точките — в maxi-points.js). */
const LEVELS = [
  ['🐣','Пиленце'], ['🐥','Пиле'], ['🐰','Зайче'], ['🐿️','Катеричка'], ['🦊','Лисиче'],
  ['🐼','Панда'], ['🐨','Коала'], ['🐬','Делфин'], ['🦉','Бухал'], ['🦁','Лъв'],
  ['🐯','Тигър'], ['🦅','Орел'], ['🐘','Слон'], ['🦒','Жираф'], ['🐳','Кит'],
  ['🚀','Ракета'], ['🌟','Звезда'], ['🌈','Дъга'], ['🐉','Дракон'], ['🦄','Еднорог']
];
// Праговете са ×100: ниво 2 = 300⭐, 3 = 700⭐, 4 = 1200⭐, 5 = 1800⭐, 10 = 6300⭐.
// Стъпката до следващото ниво расте с всяко ниво: 300, 400, 500, 600… звезди.
const STAR_SCALE = 100;
const LEVEL_FORMULA = 3;   // 3: в басейна влизат и точките и званията   // сменя се при промяна на праговете → запазените нива се преизчисляват
R.levelStart = (k) => STAR_SCALE * (k - 1) * (k + 4) / 2;
R.levelOf = (stars) => { let k = 1; while(R.levelStart(k + 1) <= stars) k++; return k; };
R.levelInfo = (k) => k <= LEVELS.length
  ? { emoji: LEVELS[k - 1][0], title: LEVELS[k - 1][1] }
  : { emoji: '👑', title: 'Шампион ' + (k - LEVELS.length) };

/* ================= Звезди и статистика на профила (от всички приложения) ================= */
function statsOf(profile){
  const name = profile.name;
  const math = readMathStats(name), sub = readSubtractionStats(name), typing = readTypingStats(name);
  const recs = NEW_APPS.map(a => ({ key: a.key, r: readNewApp(a, name) }));
  const num = (v) => +v || 0;
  const P = window.MaxiPoints;
  // точки по игри (ключовете са същите като в maxi-points.js)
  const pts = { pisane: num(typing && typing.points), sbor: num(math && math.points), izvazhdane: num(sub && sub.points) };
  recs.forEach(x => { pts[x.key] = num(x.r && x.r.points); });
  const totalPoints = Object.values(pts).reduce((t, v) => t + v, 0);
  const streakStars = num(math && math.stars) + num(sub && sub.stars) + num(typing && typing.stars) + recs.reduce((t, x) => t + num(x.r && x.r.stars), 0);
  const pointStars = P ? P.pointStars(totalPoints) : 0;
  const titleBonus = P ? Object.values(pts).reduce((t, v) => t + P.titleBonus(v), 0) : 0;
  const local = streakStars + pointStars + titleBonus;
  const correct = num(math && math.score) + num(sub && sub.score)
    + ((typing && typing.history) || []).length
    + recs.reduce((t, x) => t + num(x.r && x.r.score), 0);
  // Звездите в облака (от друго устройство или пренесени от старата база) също се броят:
  // взимаме по-голямото, за да не започва детето от нула на нов таблет.
  const lp = (typeof loadProfiles === 'function' ? loadProfiles() : []).find(x => x.id === profile.id) || profile;
  const cloudStars = num(lp.cloudStars);
  const bestStreak = Math.max(0,
    num(math && (math.bestStreak || math.streak)), num(sub && (sub.bestStreak || sub.streak)),
    ...recs.map(x => num(x.r && (x.r.bestStreak || x.r.streak))));
  return { stars: Math.max(local, cloudStars), correct, bestStreak, pts, totalPoints, streakStars, pointStars, titleBonus, fromCloud: cloudStars > local };
}
R.statsOf = statsOf;

/* ================= Пазене по профил (на устройството) ================= */
const KEY = 'hubRewards_v1';
function loadAll(){ try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; } }
function rec(profile){
  const all = loadAll();
  return Object.assign({ level: 0, badges: {}, days: [], apps: {}, titles: null }, all[profile.id] || {});
}
function saveRec(profile, r){
  const all = loadAll();
  all[profile.id] = r;
  try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function longestDayRun(days){
  const ts = Array.from(new Set(days)).sort().map(d => Date.parse(d + 'T12:00:00'));
  let best = 0, run = 0;
  ts.forEach((t, i) => { run = (i && Math.round((t - ts[i - 1]) / 86400000) === 1) ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}
// Отбелязва деня и приложението при всяко отваряне (за значките „дни поред“ и „изследовател“).
R.noteOpen = function(src){
  const p = getActiveProfile(); if(!p) return;
  const r = rec(p);
  const d = today();
  if(!r.days.includes(d)){ r.days.push(d); if(r.days.length > 90) r.days = r.days.slice(-90); }
  r.apps[src] = 1;
  saveRec(p, r);
};
const ALL_APPS = () => Array.from(document.querySelectorAll('#menu .tile')).map(t => ((t.getAttribute('onclick') || '').match(/openApp\('([^']+)'\)/) || [])[1]).filter(Boolean);

/* ================= Значки ================= */
const BADGES = [
  { k:'star1',     e:'🌱', t:'Първа звезда',            ok:(s) => s.stars >= 1 },
  { k:'star10',    e:'⭐', t:'10 звезди',                ok:(s) => s.stars >= 10 },
  { k:'star50',    e:'🌟', t:'50 звезди',                ok:(s) => s.stars >= 50 },
  { k:'star100',   e:'💫', t:'100 звезди',               ok:(s) => s.stars >= 100 },
  { k:'ok50',      e:'✅', t:'50 верни отговора',        ok:(s) => s.correct >= 50 },
  { k:'ok200',     e:'🏅', t:'200 верни отговора',       ok:(s) => s.correct >= 200 },
  { k:'ok500',     e:'🏆', t:'500 верни отговора',       ok:(s) => s.correct >= 500 },
  { k:'streak10',  e:'🔥', t:'10 поред без грешка',      ok:(s) => s.bestStreak >= 10 },
  { k:'days3',     e:'📅', t:'3 дни поред',              ok:(s, r) => longestDayRun(r.days) >= 3 },
  { k:'days7',     e:'🗓️', t:'7 дни поред',              ok:(s, r) => longestDayRun(r.days) >= 7 },
  { k:'explorer',  e:'🧭', t:'Опита всички приложения',  ok:(s, r) => { const all = ALL_APPS(); return all.length > 0 && all.every(a => r.apps[a]); } },
  { k:'level10',   e:'👑', t:'Ниво 10',                  ok:(s) => R.levelOf(s.stars) >= 10 }
];
R.BADGES = BADGES;

/* ================= Проверка: ново ниво / нови значки ================= */
let busy = false;
R.check = function(profile, celebrate){
  if(!profile) return null;
  const s = statsOf(profile);
  const level = R.levelOf(s.stars);
  const r = rec(profile);
  // Праговете са сменени: приемаме тихо новото (по-ниско) ниво, без празнуване,
  // иначе детето нямаше да празнува, докато не надмине старото си ниво.
  if(r.formula !== LEVEL_FORMULA){ if(r.level) r.level = level; r.formula = LEVEL_FORMULA; }
  const first = !r.level;
  // Нови звания (по игри): първия път се запомнят тихо.
  const P = window.MaxiPoints;
  const newTitles = [];
  if(P){
    const firstTitles = !r.titles;
    r.titles = r.titles || {};
    Object.keys(s.pts).forEach(app => {
      const idx = P.titleIndex(s.pts[app]);
      if(!firstTitles && idx > (r.titles[app] || 0)){
        for(let i = (r.titles[app] || 0) + 1; i <= idx; i++) newTitles.push({ app, idx: i, title: P.TITLES[app][i], bonus: P.BONUS[i] });
      }
      r.titles[app] = Math.max(r.titles[app] || 0, idx);
    });
  }
  const newBadges = BADGES.filter(b => !r.badges[b.k] && b.ok(s, r));
  newBadges.forEach(b => { r.badges[b.k] = Date.now(); });
  const up = !first && level > r.level;
  const prev = r.level;
  r.level = Math.max(r.level, level);
  saveRec(profile, r);
  if(first) return { level, stars: s.stars };     // първо засичане — без празнуване за натрупаното досега
  if(celebrate && up) R.celebrate(profile, level, prev, newBadges, newTitles);
  else if(celebrate && newTitles.length) R.celebrateTitles(profile, newTitles, newBadges);
  else if(celebrate && newBadges.length) toast('Нова значка: ' + newBadges.map(b => b.e + ' ' + b.t).join(', '));
  if(up || newBadges.length || newTitles.length) R.publish(profile);
  return { level, stars: s.stars, up, newBadges, newTitles };
};

// Игрите в рамката пишат звездите си в localStorage → хъбът получава „storage“ събитие.
let checkTimer = null;
window.addEventListener('storage', (e) => {
  if(!e.key || e.key === KEY) return;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => R.check(getActiveProfile(), true), 350);
});

/* ================= Карта в менюто: ниво, лента, значки ================= */
R.renderCard = function(profile){
  const card = $('progress-card'); if(!card || !profile) return;
  let box = $('rw-card');
  if(!box){
    box = document.createElement('div'); box.id = 'rw-card';
    card.querySelector('.progress-top').insertAdjacentElement('afterend', box);
  }
  const res = R.check(profile, true) || {};
  const s = statsOf(profile);
  const level = R.levelOf(s.stars), info = R.levelInfo(level);
  const from = R.levelStart(level), to = R.levelStart(level + 1);
  const pct = Math.round((s.stars - from) / (to - from) * 100);
  const r = rec(profile);
  const badges = BADGES.map(b => `<span class="rw-badge${r.badges[b.k] ? '' : ' locked'}" title="${esc(b.t)}" data-t="${esc(b.t)}">${b.e}</span>`).join('');
  const got = BADGES.filter(b => r.badges[b.k]).length;
  box.innerHTML = `
    <div class="rw-level">
      <span class="rw-level-emoji">${info.emoji}</span>
      <div class="rw-level-main">
        <div class="rw-level-name">Ниво ${level} · ${esc(info.title)}</div>
        <div class="rw-bar"><i style="width:${pct}%"></i></div>
        <div class="rw-next">още ${to - s.stars} ⭐ до ниво ${level + 1} ${R.levelInfo(level + 1).emoji}</div>
      </div>
    </div>
    <div class="rw-sources">${s.fromCloud ? '⭐ ' + s.stars + ' (заедно с другите устройства)' :
      '⭐ ' + s.stars + ' = ' + s.streakStars + ' за серии + ' + s.pointStars + ' от ' + s.totalPoints + ' ✏️ точки + ' + s.titleBonus + ' за звания'}</div>
    ${titleChips(s)}
    <div class="rw-badges-title">Значки ${got} / ${BADGES.length}</div>
    <div class="rw-badges">${badges}</div>`;
  box.querySelectorAll('.rw-badge').forEach(el => el.addEventListener('click', () => {
    toast((el.classList.contains('locked') ? '🔒 ' : '') + el.textContent + ' ' + el.dataset.t);
    if(window.Maxi) Maxi.speak(el.dataset.t);
  }));
  const av = $('progress-avatar');
  if(av && !av.dataset.rw){
    av.dataset.rw = '1';
    av.setAttribute('role', 'button'); av.title = 'Смени аватара';
    av.style.cursor = 'pointer';
    av.addEventListener('click', () => R.openAvatarPicker());
  }
  return res;
};

function titleChips(s){
  const P = window.MaxiPoints; if(!P) return '';
  const chips = Object.keys(s.pts).filter(app => s.pts[app] > 0).map(app => {
    const next = P.nextStep(s.pts[app]);
    return `<span class="rw-title-chip" title="${esc(P.APP_NAMES[app])}: ${s.pts[app]} точки${next ? ', следващото звание при ' + next : ''}"><b>${esc(P.APP_NAMES[app])}</b> ${esc(P.title(app, s.pts[app]))}</span>`;
  });
  return chips.length ? `<div class="rw-badges-title">Звания</div><div class="rw-titles">${chips.join('')}</div>` : '';
}

/* ================= Аватари за нивата ================= */
R.unlockedAvatars = (level) => LEVELS.slice(0, Math.min(level, LEVELS.length)).map(x => x[0]);
R.openAvatarPicker = function(){
  const p = getActiveProfile(); if(!p) return;
  const level = R.levelOf(statsOf(p).stars);
  const modal = ensureModal('rw-avatar-modal');
  const base = AVATARS.map(a => `<button class="rw-av${a === p.avatar ? ' sel' : ''}" data-a="${a}">${a}</button>`).join('');
  const lv = LEVELS.map(([e, t], i) => i < level
    ? `<button class="rw-av${e === p.avatar ? ' sel' : ''}" data-a="${e}" title="${esc(t)}">${e}</button>`
    : `<button class="rw-av locked" disabled title="Ниво ${i + 1}">${e}<small>🔒${i + 1}</small></button>`).join('');
  modal.querySelector('.rw-modal-box').innerHTML = `
    <h3>Избери аватар</h3>
    <div class="rw-av-grid">${base}</div>
    <h4>🏆 Аватари за нивата</h4>
    <div class="rw-av-grid">${lv}</div>
    <button class="btn cancel" type="button" data-close>Затвори</button>`;
  modal.querySelectorAll('.rw-av[data-a]').forEach(b => b.onclick = () => { setAvatar(p, b.dataset.a); closeModal(modal); });
  modal.querySelector('[data-close]').onclick = () => closeModal(modal);
  modal.classList.add('open');
};
function setAvatar(p, a){
  const list = loadProfiles();
  const it = list.find(x => x.id === p.id);
  if(it){ it.avatar = a; saveProfiles(list); }
  const act = Object.assign({}, p, { avatar: a });
  setActiveProfile(act);
  if(typeof menuGreeting !== 'undefined') menuGreeting.textContent = a + ' Здравей, ' + act.name + '! Какво играем днес?';
  if(typeof renderProgressCard === 'function') renderProgressCard(act);
  if(!isLocalAccount()) whenDB(db => db.upsertProfile(p.id, { avatar: a }).catch(() => {}));
  R.publish(act);
}

/* ================= Празнуване ================= */
R.celebrate = function(profile, level, prevLevel, newBadges, newTitles){
  const info = R.levelInfo(level);
  const ov = ensureModal('rw-celebrate', 'rw-celebrate');
  const newAv = level <= LEVELS.length && info.emoji !== profile.avatar;
  const cert = level % 5 === 0;
  ov.querySelector('.rw-modal-box').innerHTML = `
    <div class="rw-big">${info.emoji}</div>
    <div class="rw-title">Ниво ${level}!</div>
    <div class="rw-sub">Браво, ${esc(profile.name)}! Вече си <b>${esc(info.title)}</b>.</div>
    ${newTitles && newTitles.length ? `<div class="rw-sub">Ново звание: ${newTitles.map(x => '<b>' + esc(x.title) + '</b> (+' + x.bonus + ' ⭐)').join(' · ')}</div>` : ''}
    ${newBadges && newBadges.length ? `<div class="rw-sub">Нови значки: ${newBadges.map(b => b.e + ' ' + esc(b.t)).join(' · ')}</div>` : ''}
    <div class="rw-actions">
      ${newAv ? `<button class="btn save" type="button" data-av>Сложи ${info.emoji} за аватар</button>` : ''}
      ${cert ? `<button class="btn" type="button" data-cert style="background:#8e44ad">🖨️ Грамота</button>` : ''}
      <button class="btn" type="button" data-close style="background:#3498db">Продължи ▶</button>
    </div>`;
  let auto = setTimeout(() => closeModal(ov), 11000);
  const hold = () => { clearTimeout(auto); };
  ov.querySelector('.rw-modal-box').addEventListener('pointerdown', hold, { once: true });
  ov.querySelector('[data-close]').onclick = () => closeModal(ov);
  const avb = ov.querySelector('[data-av]'); if(avb) avb.onclick = () => { setAvatar(profile, info.emoji); avb.textContent = '✓ Готово'; avb.disabled = true; };
  const cb = ov.querySelector('[data-cert]'); if(cb) cb.onclick = () => R.printCertificate(profile, level);
  ov.classList.add('open');
  bigConfetti();
  playFanfare();
  if(window.Maxi) setTimeout(() => Maxi.speak('Браво, ' + profile.name + '! Ниво ' + Maxi.num(level) + '!'), 600);
};

/* Ново звание в някоя игра: бонус звезди, конфети, фанфара и глас. */
R.celebrateTitles = function(profile, items, newBadges){
  const P = window.MaxiPoints;
  const last = items[items.length - 1];
  const emoji = (last.title.match(/(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)\s*$/u) || [])[1] || '🏅';
  const name = last.title.replace(/\s*\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*\s*$/u, '');
  const bonus = items.reduce((t, x) => t + x.bonus, 0);
  const ov = ensureModal('rw-celebrate', 'rw-celebrate');
  ov.querySelector('.rw-modal-box').innerHTML = `
    <div class="rw-big">${emoji}</div>
    <div class="rw-title">Ново звание!</div>
    <div class="rw-sub">${esc(P ? P.APP_NAMES[last.app] : '')}: <b>${esc(last.title)}</b></div>
    <div class="rw-sub" style="font-size:1.5em;font-weight:900;color:#e8845d;">+${bonus} ⭐ бонус</div>
    ${newBadges && newBadges.length ? `<div class="rw-sub">Нови значки: ${newBadges.map(b => b.e + ' ' + esc(b.t)).join(' · ')}</div>` : ''}
    <div class="rw-actions"><button class="btn" type="button" data-close style="background:#3498db">Продължи ▶</button></div>`;
  let auto = setTimeout(() => closeModal(ov), 9000);
  ov.querySelector('.rw-modal-box').addEventListener('pointerdown', () => clearTimeout(auto), { once: true });
  ov.querySelector('[data-close]').onclick = () => closeModal(ov);
  ov.classList.add('open');
  bigConfetti();
  playFanfare();
  if(window.Maxi) setTimeout(() => Maxi.speak('Браво, ' + profile.name + '! Ново звание: ' + name + '! Плюс ' + Maxi.num(bonus, 'f') + ' звезди!'), 600);
};

function bigConfetti(){
  const reduce = window.Maxi && Maxi.settings && Maxi.settings.reduceMotion;
  const layer = document.createElement('div'); layer.className = 'rw-confetti';
  const cols = ['#e74c3c','#f1c40f','#2ecc71','#3498db','#9b59b6','#e67e22','#ff6fb5'];
  const n = reduce ? 0 : 110;
  for(let i = 0; i < n; i++){
    const el = document.createElement('i');
    const star = i % 6 === 0;
    if(star) el.textContent = ['⭐','🎉','✨','🌟'][i % 4];
    else el.style.background = cols[i % cols.length];
    el.className = star ? 'e' : '';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.setProperty('--dx', (Math.random() * 30 - 15) + 'vw');
    el.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    el.style.animationDuration = (2.6 + Math.random() * 2.4) + 's';
    el.style.animationDelay = (Math.random() * 1.2) + 's';
    layer.appendChild(el);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 6500);
}

/* ---------- Фанфара: оригинална, ~6.5 s, синтезирана с Web Audio ----------
   Ако на сайта има файл sounds/level-up.mp3 (собствена музика, за която имате
   права), се пускат първите 7 секунди от него вместо синтезираната. */
let customSound = null; // null = не е проверено, false = няма, true = има
function playFanfare(){
  if(window.Maxi && Maxi.settings && !Maxi.settings.sounds) return;
  const tryCustom = customSound === false ? Promise.resolve(false)
    : fetch('sounds/level-up.mp3', { method: 'HEAD', cache: 'no-cache' }).then(r => r.ok).catch(() => false);
  tryCustom.then(ok => {
    customSound = ok;
    if(ok){
      const a = new Audio('sounds/level-up.mp3');
      a.volume = 0.9;
      a.play().catch(() => synthFanfare());
      setTimeout(() => { const f = setInterval(() => { a.volume = Math.max(0, a.volume - 0.1); if(a.volume <= 0.05){ a.pause(); clearInterval(f); } }, 60); }, 6300);
    } else synthFanfare();
  });
}
let actx = null;
function synthFanfare(){
  try{
    if(!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if(actx.state === 'suspended') actx.resume();
  }catch(e){ return; }
  const t0 = actx.currentTime + 0.05;
  const master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
  const f = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz
  // „Тромпет“: два леко разстроени sawtooth през нискочестотен филтър
  function brass(note, start, dur, vol){
    const g = actx.createGain(), lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t0 + start); lp.frequency.linearRampToValueAtTime(2600, t0 + start + 0.08);
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + start + 0.04);
    g.gain.setValueAtTime(vol || 0.16, t0 + start + Math.max(0.05, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur + 0.12);
    [-6, 6].forEach(det => {
      const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f(note); o.detune.value = det;
      o.connect(lp); o.start(t0 + start); o.stop(t0 + start + dur + 0.2);
    });
    lp.connect(g); g.connect(master);
  }
  // „Тимпан“: нисък синус с падаща височина
  function drum(start, vol){
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t0 + start); o.frequency.exponentialRampToValueAtTime(55, t0 + start + 0.35);
    g.gain.setValueAtTime(vol || 0.5, t0 + start); g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.5);
    o.connect(g); g.connect(master); o.start(t0 + start); o.stop(t0 + start + 0.55);
  }
  // „Чинел“: филтриран шум
  function cymbal(start, dur){
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = actx.createBufferSource(), hp = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 5000; g.gain.value = 0.18;
    src.connect(hp); hp.connect(g); g.connect(master); src.start(t0 + start);
  }
  const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, G5 = 79, C6 = 84;
  // 1) изкачване по тризвучието
  [[C4, 0], [E4, 0.16], [G4, 0.32], [C5, 0.48]].forEach(([n, s]) => brass(n, s, 0.15));
  brass(E5, 0.66, 0.34); brass(C5, 0.66, 0.34, 0.1);
  drum(0.66);
  // 2) отговор
  brass(D5, 1.05, 0.16); brass(E5, 1.23, 0.16); brass(G5, 1.41, 0.62); brass(E5, 1.41, 0.62, 0.1);
  drum(1.41, 0.4);
  // 3) акорди: фа мажор → сол мажор
  [F4, A4, C5].forEach(n => brass(n, 2.15, 0.42, 0.11)); drum(2.15, 0.45);
  [G4, B4, D5].forEach(n => brass(n, 2.65, 0.42, 0.11)); drum(2.65, 0.45);
  // 4) тържествен край: до мажор, дълго, с тремоло на тимпана и чинел
  [C4, G4, C5, E5, G5, C6].forEach(n => brass(n, 3.2, 2.6, 0.1));
  for(let i = 0; i < 10; i++) drum(3.2 + i * 0.09, 0.18 + i * 0.03);
  drum(4.15, 0.7); cymbal(3.2, 2.8);
  drum(5.75, 0.6);
}

/* ================= Грамота ================= */
R.printCertificate = function(profile, level){
  const info = R.levelInfo(level);
  let el = $('rw-cert');
  if(!el){ el = document.createElement('div'); el.id = 'rw-cert'; document.body.appendChild(el); }
  const date = new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
  el.innerHTML = `<div class="rw-cert-in">
    <div class="rw-cert-stars">⭐ 🌟 ⭐</div>
    <div class="rw-cert-h">ГРАМОТА</div>
    <div class="rw-cert-t">се връчва на</div>
    <div class="rw-cert-name">${esc(profile.name)}</div>
    <div class="rw-cert-t">за достигнато</div>
    <div class="rw-cert-lvl">${info.emoji} Ниво ${level} — ${esc(info.title)}</div>
    <div class="rw-cert-t">в „Моите учебни игри“. Браво! Продължавай все така!</div>
    <div class="rw-cert-foot"><span>${esc(date)}</span><span>tapnime.eu</span></div>
  </div>`;
  document.documentElement.classList.add('rw-printing');
  const done = () => { document.documentElement.classList.remove('rw-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try{ window.print(); }catch(e){} setTimeout(done, 1500); }, 100);
};
// В родителския панел: грамоти за всяко достигнато 5-то ниво.
R.renderParentExtras = function(profile){
  const wrap = document.querySelector('#parent-screen .pp-wrap'); if(!wrap || !profile) return;
  let card = $('rw-pp-card');
  if(!card){ card = document.createElement('div'); card.id = 'rw-pp-card'; card.className = 'pp-card'; wrap.appendChild(card); }
  const s = statsOf(profile), level = R.levelOf(s.stars), info = R.levelInfo(level);
  const r = rec(profile);
  const milestones = []; for(let k = 5; k <= level; k += 5) milestones.push(k);
  card.innerHTML = `<h2>🏆 Ниво, значки и грамоти</h2>
    <div style="font-size:1.05rem;margin-bottom:0.6rem;">${info.emoji} <b>Ниво ${level}</b> · ${esc(info.title)} · ${s.stars} ⭐ общо · ${s.correct} верни</div>
    <div style="margin-bottom:0.6rem;">⭐ ${s.streakStars} за серии + ${s.pointStars} от ${s.totalPoints} ✏️ точки (1 ⭐ на 100) + ${s.titleBonus} за звания</div>
    ${window.MaxiPoints ? '<table class="pp-table" style="margin-bottom:0.6rem;"><tr><th>Игра</th><th>✏️ Точки</th><th>Звание</th></tr>' + Object.keys(s.pts).map(app => '<tr><td>' + esc(MaxiPoints.APP_NAMES[app]) + '</td><td>' + s.pts[app] + '</td><td>' + esc(MaxiPoints.title(app, s.pts[app])) + '</td></tr>').join('') + '</table>' : ''}
    <div style="margin-bottom:0.6rem;">${BADGES.map(b => `<span title="${esc(b.t)}" style="font-size:1.6rem;${r.badges[b.k] ? '' : 'opacity:0.2;filter:grayscale(1);'}">${b.e}</span>`).join(' ')}</div>
    ${milestones.length
      ? milestones.map(k => `<button class="pp-btn" type="button" data-cert="${k}">🖨️ Грамота за ниво ${k}</button>`).join(' ')
      : '<div class="pp-muted">Грамота има на всяко 5-то ниво (първата е на ниво 5 — ${R.levelStart(5)} ⭐).</div>'}`;
  card.querySelectorAll('[data-cert]').forEach(b => b.onclick = () => R.printCertificate(profile, +b.dataset.cert));
};

/* ================= Общо класиране ================= */
const NICK_ADJ = [['Смелият','Смелата','Смелото'],['Веселият','Веселата','Веселото'],['Бързият','Бързата','Бързото'],['Умният','Умната','Умното'],
  ['Слънчевият','Слънчевата','Слънчевото'],['Звездният','Звездната','Звездното'],['Шареният','Шарената','Шареното'],['Храбрият','Храбрата','Храброто'],
  ['Усмихнатият','Усмихнатата','Усмихнатото'],['Пъргавият','Пъргавата','Пъргавото'],['Любопитният','Любопитната','Любопитното'],['Сияйният','Сияйната','Сияйното']];
// Членът е само на прилагателното: „Смелото Лисиче“, „Бързият Делфин“. 0 = м.р., 1 = ж.р., 2 = ср.р.
const NICK_ANIMAL = [['Лисиче',2],['Мече',2],['Зайче',2],['Коте',2],['Кученце',2],['Пингвин',0],['Делфин',0],['Бухал',0],
  ['Таралеж',0],['Тигър',0],['Панда',1],['Пчеличка',1],['Катеричка',1],['Костенурка',1],['Жираф',0],['Сърничка',1]];
R.randomNick = function(not){
  for(let i = 0; i < 20; i++){
    const [an, g] = NICK_ANIMAL[Math.floor(Math.random() * NICK_ANIMAL.length)];
    const nick = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)][g] + ' ' + an;
    if(nick !== not) return nick;
  }
  return 'Смелото Лисиче';
};
// Публикува нивото на детето, ако родителят го е включил в класирането.
R.publish = function(profile){
  if(!profile || isLocalAccount()) return;
  const local = loadProfiles().find(x => x.id === profile.id) || profile;
  if(!local.rankOptIn || !local.rankNick) return;
  const s = statsOf(local);
  whenDB(db => db.publishRank && db.publishRank(local.id, { nick: local.rankNick, avatar: local.avatar, level: R.levelOf(s.stars), stars: s.stars }).catch(() => {}));
};
// Включване/изключване от екрана „👤 Акаунт“ (зад родителската проверка).
R.setRanking = function(profileId, on, nick, db){
  const list = loadProfiles();
  const it = list.find(x => x.id === profileId);
  const patch = { rankOptIn: !!on, rankNick: nick || (it && it.rankNick) || R.randomNick() };
  if(it){ Object.assign(it, patch); saveProfiles(list); }
  const jobs = [db.upsertProfile(profileId, patch)];
  if(on && it) jobs.push(db.publishRank(profileId, { nick: patch.rankNick, avatar: it.avatar, level: R.levelOf(statsOf(it).stars), stars: statsOf(it).stars }));
  if(!on) jobs.push(db.removeRank(profileId));
  return Promise.all(jobs).then(() => patch);
};
R.rankControls = function(p){
  const on = !!p.rankOptIn;
  return `<div class="rw-rank-ctl" data-pid="${esc(p.id)}">
    <label><input type="checkbox" ${on ? 'checked' : ''} data-rank-on> 🏆 В общото класиране</label>
    <span class="rw-rank-nick">${on ? 'като „' + esc(p.rankNick || '') + '“' : ''}</span>
    ${on ? '<button class="link-btn" type="button" data-rank-roll>🎲 Друг прякор</button>' : ''}
    <div class="account-note">В класирането се вижда само прякор, аватар и ниво — не и истинското име.</div>
  </div>`;
};
R.bindRankControls = function(root, db, rerender){
  root.querySelectorAll('.rw-rank-ctl').forEach(box => {
    const pid = box.dataset.pid;
    const cb = box.querySelector('[data-rank-on]');
    cb.onchange = () => { cb.disabled = true; R.setRanking(pid, cb.checked, null, db).then(rerender, () => { cb.disabled = false; cb.checked = !cb.checked; toast('Не успях да запиша. Има ли интернет?'); }); };
    const roll = box.querySelector('[data-rank-roll]');
    if(roll) roll.onclick = () => {
      roll.disabled = true;
      const cur = (loadProfiles().find(x => x.id === pid) || {}).rankNick;
      R.setRanking(pid, true, R.randomNick(cur), db).then(rerender, () => { roll.disabled = false; });
    };
  });
};
R.openRanking = function(){
  const scr = $('rank-screen'); if(!scr) return;
  showScreen(scr);
  const list = $('rank-list');
  if(isLocalAccount() || !getAccount()){
    list.innerHTML = '<div class="progress-empty">Класирането е само за деца в акаунт. Помолете родител да влезе от „👤 Акаунт“.</div>';
    return;
  }
  list.innerHTML = '<div class="progress-empty">Зареждане…</div>';
  const active = getActiveProfile();
  const me = active && loadProfiles().find(x => x.id === active.id);
  whenDB(db => {
    if(me) R.publish(me);
    db.listRanking(50).then(rows => {
      if(!rows.length){ list.innerHTML = '<div class="progress-empty">Още няма никой в класирането.</div>'; return; }
      list.innerHTML = rows.map((r, i) => {
        const medal = ['🥇','🥈','🥉'][i] || (i + 1) + '.';
        const info = R.levelInfo(r.level || 1);
        return `<div class="rw-rank-row${r.mine ? ' mine' : ''}">
          <span class="rw-rank-place">${medal}</span>
          <span class="rw-rank-av">${esc(r.avatar || '🦊')}</span>
          <span class="rw-rank-name">${esc(r.nick || '')}${r.mine ? ' <small>(наш)</small>' : ''}</span>
          <span class="rw-rank-lvl">${info.emoji} Ниво ${r.level || 1}</span>
        </div>`;
      }).join('') + (me && !me.rankOptIn ? '<div class="progress-empty">За да влезеш в класирането, помоли родител да го включи от „👤 Акаунт“.</div>' : '');
    }).catch(() => { list.innerHTML = '<div class="progress-empty">Класирането не може да се зареди. Има ли интернет?</div>'; });
  });
};

/* ================= Общи малки помощници ================= */
function ensureModal(id, extra){
  let m = $(id);
  if(!m){
    m = document.createElement('div'); m.id = id; m.className = 'rw-modal' + (extra ? ' ' + extra : '');
    m.innerHTML = '<div class="rw-modal-box"></div>';
    m.addEventListener('click', (e) => { if(e.target === m && !m.classList.contains('rw-celebrate')) closeModal(m); });
    document.body.appendChild(m);
  }
  return m;
}
function closeModal(m){ m.classList.remove('open'); }
R.closeTop = function(){ const m = Array.from(document.querySelectorAll('.rw-modal.open')).pop(); if(m){ closeModal(m); return true; } return false; };
function toast(text){
  const t = document.createElement('div'); t.className = 'rw-toast'; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}
R.toast = toast;
})();
