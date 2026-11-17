/* Общ модул за новите учебни игри.
   Събира логиката, която вече работи добре в „Сбор“, „Изваждане“ и
   „Пиши и говори“: проверка на отговора цифра по цифра, звукови сигнали,
   звезда на всеки 5 поредни верни, изговаряне с поправките за Android,
   автоматичен вход от хъба (?hubUser=) и пазене в localStorage.
   Излага глобален обект window.Maxi. */
(function(){
'use strict';
const M = {};
window.Maxi = M;

/* ================= Общи настройки (задават се от хъба) ================= */
const SETTINGS_KEY = 'hubSettings_v1';
const DEFAULT_SETTINGS = { speechRate:1, textSize:1, sounds:true, speech:true, reduceMotion:false, highContrast:false };
M.SETTINGS_KEY = SETTINGS_KEY;
M.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

M.loadSettings = function(){
  try{ return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); }
  catch(e){ return Object.assign({}, DEFAULT_SETTINGS); }
};
M.saveSettings = function(s){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch(e){}
};
M.applySettings = function(s){
  const root = document.documentElement;
  root.style.setProperty('--ts', String(s.textSize || 1));
  root.classList.toggle('mx-reduce-motion', !!s.reduceMotion);
  root.classList.toggle('mx-contrast', !!s.highContrast);
};
M.settings = M.loadSettings();
M.applySettings(M.settings);
window.addEventListener('storage', (e) => {
  if(e.key === SETTINGS_KEY){ M.settings = M.loadSettings(); M.applySettings(M.settings); }
});

/* ================= Малки помощници ================= */
M.randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
M.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
M.shuffle = function(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
M.sample = (arr, n) => M.shuffle(arr).slice(0, n);
M.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
M.$ = (sel, root) => (root || document).querySelector(sel);
M.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ================= Потребител (от хъба) ================= */
function resolveUser(){
  if(window.__HUB_USER__) return window.__HUB_USER__;
  try{
    const p = new URLSearchParams(window.location.search).get('hubUser');
    if(p) return decodeURIComponent(p);
  }catch(e){}
  try{
    const a = JSON.parse(localStorage.getItem('hubActiveProfile_v1'));
    if(a && a.name) return a.name;
  }catch(e){}
  return 'Гост';
}
M.user = resolveUser();

/* ================= Резултати: точки, серия, звезди, история =================
   Форматът е същият като при математиката: { [име]: { score, total, streak,
   stars, history:[...] } }, за да може хъбът да го чете еднакво. */
M.createStore = function(storageKey){
  const blank = () => ({ score:0, total:0, streak:0, bestStreak:0, stars:0, points:0, history:[], extra:{} });
  function loadAll(){ try{ return JSON.parse(localStorage.getItem(storageKey)) || {}; }catch(e){ return {}; } }
  const all = loadAll();
  const rec = Object.assign(blank(), all[M.user] || {});
  const listeners = [];
  const APP_BY_STORAGE = { maxiChetene_v1:'chetene', maxiChislaPari_v1:'pari', maxiVnimanie_v1:'vnimanie', maxiGovorya_v1:'govorya', maxiDvizhenie_v1:'dvizhenie' };
  const store = {
    rec,
    app: APP_BY_STORAGE[storageKey] || null,
    save(){
      const fresh = loadAll();
      fresh[M.user] = rec;
      try{ localStorage.setItem(storageKey, JSON.stringify(fresh)); }catch(e){}
      listeners.forEach(fn => fn(rec));
    },
    onChange(fn){ listeners.push(fn); fn(rec); },
    /* Отчита отговор. Връща { star:true }, ако е спечелена звезда.
       points — точки за завършена задача (15 без грешка, 10 с грешки). */
    result(mode, q, correct, answer, points){
      rec.total++;
      if(points) rec.points = (rec.points || 0) + points;
      let star = false;
      if(correct){
        rec.score++;
        rec.streak++;
        if(rec.streak > rec.bestStreak) rec.bestStreak = rec.streak;
        if(rec.streak % 5 === 0){ rec.stars++; star = true; }
      } else {
        rec.streak = 0;
      }
      rec.history.unshift({ mode, q, a: answer === undefined ? null : String(answer), correct: !!correct, ts: Date.now() });
      if(rec.history.length > 300) rec.history.length = 300;
      store.save();
      return { star };
    },
    /* Запис без оценка (напр. „Как се чувствам“, дневен график, дишане). */
    log(mode, q){
      rec.history.unshift({ mode, q, correct: null, ts: Date.now() });
      if(rec.history.length > 300) rec.history.length = 300;
      store.save();
    },
    award(n){
      rec.stars += (n || 1);
      store.save();
    }
  };
  return store;
};

/* Свързва значките ⭐ и 🔥 в горната лента със store-а. */
M.bindBadges = function(store){
  const starsEl = document.getElementById('mx-stars');
  const streakEl = document.getElementById('mx-streak');
  let lastStars = store.rec.stars;
  store.onChange(rec => {
    if(starsEl){
      starsEl.textContent = rec.stars;
      if(rec.stars > lastStars){
        starsEl.classList.remove('mx-pop'); void starsEl.offsetWidth; starsEl.classList.add('mx-pop');
      }
    }
    if(streakEl) streakEl.textContent = rec.streak;
    lastStars = rec.stars;
    renderPoints(store, rec);
  });
};
/* ✏️ точки в горната лента + званието в менюто на играта (правилата са в maxi-points.js). */
let lastPoints = null;
function renderPoints(store, rec){
  const P = window.MaxiPoints;
  if(!P || !store.app) return;
  const pts = rec.points || 0;
  let badge = document.getElementById('mx-points');
  if(!badge){
    const streak = document.getElementById('mx-streak');
    const host = streak && streak.closest('.mx-badge');
    if(host){
      host.insertAdjacentHTML('afterend', '<span class="mx-badge" title="Точки">✏️ <span id="mx-points">0</span></span>');
      badge = document.getElementById('mx-points');
    }
  }
  if(badge){
    badge.textContent = pts;
    if(lastPoints !== null && pts > lastPoints){ badge.classList.remove('mx-pop'); void badge.offsetWidth; badge.classList.add('mx-pop'); }
  }
  lastPoints = pts;
  const sub = document.querySelector('#menu .mx-sub');
  if(sub){
    let line = document.getElementById('mx-title-line');
    if(!line){ line = document.createElement('p'); line.id = 'mx-title-line'; line.className = 'mx-title-line'; sub.insertAdjacentElement('afterend', line); }
    const next = P.nextStep(pts);
    line.textContent = '✏️ ' + pts + ' точки · ' + P.title(store.app, pts) + (next ? ' · още ' + (next - pts) + ' до следващото звание' : '');
  }
}

/* ================= Звук (Web Audio) ================= */
let audioCtx = null;
M.tone = function(freq, duration, type, delay){
  if(!M.settings.sounds) return;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + (delay || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + duration + 0.02);
  }catch(e){ /* тихо игнориране */ }
};
M.good = () => { M.tone(880, 0.15); M.tone(1175, 0.18, 'sine', 0.1); };
M.bad = () => M.tone(220, 0.2);
M.click = () => M.tone(660, 0.05, 'triangle');
M.chime = () => { M.tone(784, 0.4); M.tone(988, 0.4, 'sine', 0.18); M.tone(1319, 0.6, 'sine', 0.36); };

/* ================= Изговаряне (SpeechSynthesis) =================
   Поправки за Android Chrome, същите като в „Срички на глас“:
   1) пауза след cancel(), иначе speak() понякога мълчи;
   2) текущото изречение се пази в глобална променлива (иначе GC го „изяжда“);
   3) keep-alive с pause/resume при по-дълъг текст;
   4) watchdog — ако onend не дойде, веригата продължава сама. */
const synth = window.speechSynthesis || null;
let bgVoice = null;
function pickVoice(){
  if(!synth) return;
  const voices = synth.getVoices();
  bgVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('bg')) || null;
}
if(synth){ pickVoice(); synth.onvoiceschanged = pickVoice; }

let speakToken = 0;
let keepAlive = null;
M._utter = null;
function stopKeepAlive(){ if(keepAlive){ clearInterval(keepAlive); keepAlive = null; } }

M.speak = function(text, opts){
  opts = opts || {};
  const token = ++speakToken;
  const finishLater = () => { if(opts.onend) setTimeout(() => { if(token === speakToken) opts.onend(); }, 250); };
  if(!synth || !M.settings.speech || !text){ finishLater(); return; }
  synth.cancel();
  stopKeepAlive();
  setTimeout(() => {
    if(token !== speakToken) return;
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'bg-BG';
    if(bgVoice) u.voice = bgVoice;
    const rate = (opts.rate || 0.9) * (M.settings.speechRate || 1);
    u.rate = Math.max(0.3, Math.min(2, rate));
    M._utter = u;
    let done = false;
    const est = 3000 + String(text).length * 150 / u.rate;
    const fin = () => {
      if(done) return;
      done = true;
      clearTimeout(wd);
      stopKeepAlive();
      if(token === speakToken && opts.onend) opts.onend();
    };
    const wd = setTimeout(fin, est);
    u.onend = fin;
    u.onerror = fin;
    synth.speak(u);
    keepAlive = setInterval(() => {
      if(synth.speaking){ synth.pause(); synth.resume(); }
    }, 9000);
  }, 120);
};
/* Изговаря няколко фрази една след друга. */
M.speakSeq = function(list, onend, rate){
  const items = list.filter(Boolean);
  let i = 0;
  const next = () => {
    if(i >= items.length){ if(onend) onend(); return; }
    M.speak(items[i++], { rate, onend: next });
  };
  next();
};
M.stopSpeech = function(){
  speakToken++;
  stopKeepAlive();
  if(synth) synth.cancel();
};

/* ================= Числа с думи (български) =================
   gender: 'n' среден (едно, две — за броене и „евро“),
           'm' мъжки (един, два — за „цент“, „час“), 'f' женски (една, две). */
const ONES = ['','едно','две','три','четири','пет','шест','седем','осем','девет'];
const TEENS = ['десет','единадесет','дванадесет','тринадесет','четиринадесет','петнадесет','шестнадесет','седемнадесет','осемнадесет','деветнадесет'];
const TENS = ['','','двадесет','тридесет','четиридесет','петдесет','шестдесет','седемдесет','осемдесет','деветдесет'];
const HUNDREDS = ['','сто','двеста','триста','четиристотин','петстотин','шестстотин','седемстотин','осемстотин','деветстотин'];
function ones(u, g){
  if(u === 1) return g === 'm' ? 'един' : (g === 'f' ? 'една' : 'едно');
  if(u === 2) return g === 'm' ? 'два' : 'две';
  return ONES[u];
}
function under100(n, g){
  if(n < 10) return ones(n, g);
  if(n < 20) return TEENS[n - 10];
  const t = Math.floor(n / 10), u = n % 10;
  return TENS[t] + (u ? ' и ' + ones(u, g) : '');
}
function isSingleWord(n){ return n < 20 || n % 10 === 0; }
function under1000(n, g){
  const h = Math.floor(n / 100), r = n % 100;
  if(!h) return under100(r, g);
  if(!r) return HUNDREDS[h];
  return HUNDREDS[h] + (isSingleWord(r) ? ' и ' : ' ') + under100(r, g);
}
M.num = function(n, g){
  n = Math.round(n);
  g = g || 'n';
  if(n === 0) return 'нула';
  if(n < 0) return 'минус ' + M.num(-n, g);
  if(n < 1000) return under1000(n, g);
  const th = Math.floor(n / 1000), r = n % 1000;
  const thWord = th === 1 ? 'хиляда' : under1000(th, 'f') + ' хиляди';
  if(!r) return thWord;
  const joinI = (r < 100 && isSingleWord(r)) || (r % 100 === 0);
  return thWord + (joinI ? ' и ' : ' ') + under1000(r, g);
};
M.digitWord = (d) => ['нула','едно','две','три','четири','пет','шест','седем','осем','девет'][parseInt(d, 10)] || String(d);

/* ================= Евро ================= */
M.moneyWords = function(cents){
  const e = Math.floor(cents / 100), c = cents % 100;
  const parts = [];
  if(e) parts.push(M.num(e, 'n') + ' евро');
  if(c) parts.push(M.num(c, 'm') + (c === 1 ? ' цент' : ' цента'));
  return parts.length ? parts.join(' и ') : 'нула евро';
};
M.fmtMoney = function(cents){
  const e = Math.floor(cents / 100), c = cents % 100;
  if(!e && c) return c + ' ц';
  if(!c) return e + ' €';
  return e + ',' + String(c).padStart(2, '0') + ' €';
};
M.moneyName = function(cents){
  if(cents < 100) return cents + (cents === 1 ? ' цент' : ' цента');
  return (cents / 100) + ' евро';
};

/* ================= Похвали ================= */
M.PRAISE = ['Браво!','Точно така!','Супер!','Отлично!','Много добре!','Страхотно!','Умничко!'];
M.TRY = ['Опитай пак.','Почти!','Пробвай отново!','Помисли още малко.'];
M.praise = () => M.pick(M.PRAISE);
M.tryAgain = () => M.pick(M.TRY);

/* ================= Конфети ================= */
M.confetti = function(count){
  if(M.settings.reduceMotion) return;
  let layer = document.querySelector('.mx-confetti');
  if(!layer){ layer = document.createElement('div'); layer.className = 'mx-confetti'; document.body.appendChild(layer); }
  const emojis = ['⭐','✨','🎉','🌟'];
  for(let i = 0; i < (count || 10); i++){
    const el = document.createElement('span');
    el.textContent = M.pick(emojis);
    el.style.setProperty('--dx', (Math.random() * 260 - 130) + 'px');
    el.style.setProperty('--rot', (Math.random() * 200 - 100) + 'deg');
    el.style.left = (40 + Math.random() * 20) + '%';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
};

/* ================= Значка „НОВО“ =================
   Новите игри носят значка, докато детето не ги отвори веднъж на това устройство.
   Хъбът показва „✨ N нови“ на плочката на приложението, докато има неотворени. */
M.NEW_GAMES = {
  'chetene.html': ['chuy', 'broisrichki', 'posleden', 'glavni', 'izrechenie'],
  'chisla-i-pari.html': ['umnozhenie', 'shabloni', 'figuri', 'kalendar'],
  'vnimanie.html': ['simon', 'lyavo', 'labirint'],
  'dvizhenie.html': ['tochki', 'konturi', 'risuvane'],
  'govorya.html': ['bezopasnost', 'vreme']
};
const SEEN_KEY = 'maxiSeenNew_v1';
function loadSeen(){ try{ return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }catch(e){ return {}; } }
const thisFile = () => (location.pathname.split('/').pop() || '').toLowerCase();
M.unseenNew = (file) => { const seen = loadSeen(); return (M.NEW_GAMES[file] || []).filter(k => !seen[file + '#' + k]); };
M.markSeen = function(key, file){
  file = file || thisFile();
  if(!(M.NEW_GAMES[file] || []).includes(key)) return;
  const seen = loadSeen();
  seen[file + '#' + key] = Date.now();
  try{ localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); }catch(e){}
  M.$$('.mx-new[data-k="' + key + '"]').forEach(b => b.remove());
};
M.decorateNew = function(){
  const file = thisFile();
  M.unseenNew(file).forEach(k => {
    const tile = M.$$('.mx-tile').find(t => (t.getAttribute('onclick') || '').includes("'" + k + "'"));
    if(tile && !tile.querySelector('.mx-new')) tile.insertAdjacentHTML('beforeend', `<span class="mx-new" data-k="${k}">НОВО</span>`);
  });
};
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => M.decorateNew());
else setTimeout(() => M.decorateNew(), 0);

/* ================= Екрани ================= */
M.show = function(id){
  M.$$('.mx-screen').forEach(s => s.classList.toggle('active', s.id === id));
  const back = document.getElementById('mx-back');
  if(back) back.hidden = (id === 'menu');
  const scr = document.getElementById(id);
  if(scr) scr.scrollTop = 0;
};
/* Назад / Esc (вика се от началния екран): затваря отворен прозорец,
   после връща от играта към менюто ѝ. false = вече сме в менюто. */
window.maxiBack = function(){
  const modal = M.$$('.mx-modal.open').pop();
  if(modal){ modal.classList.remove('open'); return true; }
  const back = document.getElementById('mx-back');
  if(back && !back.hidden){
    if(typeof window.goMenu === 'function') window.goMenu(); else back.click();
    return true;
  }
  return false;
};
M.feedback = function(el, text, cls){
  el.textContent = text || '';
  el.className = 'mx-feedback' + (cls ? ' ' + cls : '');
};

/* Стандартна реакция на верен/грешен отговор: звук, похвала, звезда. */
M.onCorrect = function(store, mode, q, answer, fbEl, extraSpeech, onDone){
  const res = store.result(mode, q, true, answer);
  const p = M.praise();
  M.good();
  if(fbEl) M.feedback(fbEl, '✅ ' + p + (res.star ? ' ⭐ Нова звезда!' : ''), 'ok');
  if(res.star) M.confetti(12);
  M.speakSeq([p, extraSpeech, res.star ? 'Нова звезда!' : null], onDone);
  return res;
};
M.onWrong = function(store, mode, q, answer, fbEl, extraSpeech){
  store.result(mode, q, false, answer);
  const t = M.tryAgain();
  M.bad();
  if(fbEl) M.feedback(fbEl, '❌ ' + t, 'bad');
  M.speakSeq([t, extraSpeech]);
};

/* ================= Екранна цифрова клавиатура ================= */
M.keypad = function(container, onDigit, onBack){
  container.innerHTML = '';
  container.classList.add('mx-keypad');
  ['1','2','3','4','5','6','7','8','9','0'].forEach(d => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mx-key'; b.textContent = d;
    b.addEventListener('click', () => onDigit(d));
    container.appendChild(b);
  });
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'mx-key back'; back.textContent = '⌫ Изтрий';
  back.style.gridColumn = 'span 5';
  back.addEventListener('click', onBack);
  container.appendChild(back);
};

/* ================= Отговор цифра по цифра =================
   Същото поведение като в „Сбор“: всяка вярна цифра се приема веднага,
   грешната се изговаря („три — грешно“), изтрива се и полето трепва.
   segments: [{ target:'3', unit:'€' }, { target:'50', unit:'ц' }] */
let activeAnswer = null;
document.addEventListener('keydown', (e) => {
  if(!activeAnswer) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  if(/^[0-9]$/.test(e.key)){ activeAnswer.input(e.key); e.preventDefault(); }
  else if(e.key === 'Backspace'){ activeAnswer.back(); e.preventDefault(); }
});

M.digitAnswer = function(answerEl, keypadEl, segments, opts){
  opts = opts || {};
  let cur = 0;
  let finished = false;
  const values = segments.map(() => '');
  answerEl.innerHTML = '';
  answerEl.classList.add('mx-answer');
  const segEls = segments.map((s, i) => {
    const box = document.createElement('div');
    box.className = 'mx-seg';
    answerEl.appendChild(box);
    if(s.unit){
      const u = document.createElement('span');
      u.className = 'mx-unit'; u.textContent = s.unit;
      answerEl.appendChild(u);
    }
    return box;
  });
  function render(){
    segEls.forEach((el, i) => {
      el.classList.toggle('current', i === cur && !finished);
      el.classList.toggle('done', i < cur || finished);
      el.innerHTML = values[i] ? M.escapeHtml(values[i]) : '<span class="ph">?</span>';
    });
  }
  const api = {
    input(d){
      if(finished) return;
      const seg = segments[cur];
      const idx = values[cur].length;
      if(d === seg.target[idx]){
        values[cur] += d;
        M.click();
        if(values[cur].length === seg.target.length){
          cur++;
          if(cur >= segments.length){
            finished = true;
            render();
            activeAnswer = null;
            setTimeout(() => opts.onDone && opts.onDone(), 200);
            return;
          }
        }
        render();
      } else {
        const el = segEls[cur];
        el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong');
        setTimeout(() => el.classList.remove('wrong'), 350);
        M.speak(M.digitWord(d) + ' — грешно');
        if(opts.onWrongDigit) opts.onWrongDigit(d);
      }
    },
    back(){
      if(finished) return;
      if(values[cur].length) values[cur] = values[cur].slice(0, -1);
      render();
    },
    reveal(){
      finished = true;
      segments.forEach((s, i) => values[i] = s.target);
      cur = segments.length;
      render();
      activeAnswer = null;
    },
    get done(){ return finished; }
  };
  if(keypadEl) M.keypad(keypadEl, api.input, api.back);
  activeAnswer = api;
  render();
  return api;
};

/* ================= Родителска проверка =================
   Простичка „врата“ (като в детските приложения): задача за умножение,
   която детето трудно решава само. Не е защита, а предпазва от случайни промени. */
M.parentGate = function(onOk, title){
  const a = M.randInt(6, 9), b = M.randInt(6, 9);
  let modal = document.getElementById('mx-gate');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'mx-gate';
    modal.className = 'mx-modal';
    modal.innerHTML = `<div class="box">
      <h3 id="mx-gate-title"></h3>
      <div id="mx-gate-q" style="font-size:1.4rem;font-weight:800;"></div>
      <input class="mx-input" id="mx-gate-in" type="number" inputmode="numeric" autocomplete="off">
      <div class="mx-row"><button class="mx-btn gray" id="mx-gate-no">Отказ</button><button class="mx-btn green" id="mx-gate-ok">Напред</button></div>
    </div>`;
    document.body.appendChild(modal);
  }
  modal.querySelector('#mx-gate-title').textContent = title || 'За родители';
  modal.querySelector('#mx-gate-q').textContent = 'Колко е ' + a + ' × ' + b + '?';
  const input = modal.querySelector('#mx-gate-in');
  input.value = '';
  modal.classList.add('open');
  setTimeout(() => input.focus(), 50);
  const close = () => modal.classList.remove('open');
  const check = () => {
    if(parseInt(input.value, 10) === a * b){ close(); onOk(); }
    else { input.value = ''; input.placeholder = 'Опитайте пак'; }
  };
  modal.querySelector('#mx-gate-ok').onclick = check;
  modal.querySelector('#mx-gate-no').onclick = close;
  input.onkeydown = (e) => { if(e.key === 'Enter') check(); };
};

/* ================= Рамка на игра с режими и нива =================
   Общата логика за всички игри: меню → режим → кръгове. Очаква в
   страницата елементите #levels, #prompt, #area, #answer, #keypad,
   #fb, #hintBtn, #nextBtn и екрани #menu / #play.
   Инсталира глобални функции (openMode, newRound, complete, miss…),
   за да са удобни от HTML и от кода на режимите. */
/* ================= Каталог на игрите =================
   Всички игри на едно място: id за статистиката (приложение/игра), файл, икона, име
   и „свят“ на началния екран. Нова игра → нов ред тук. */
M.WORLDS = [
  { id:'cheta',    icon:'📖', name:'Чета',           sub:'букви, срички, думи',   col:'#2f80c9', bg:'#e3f0fb' },
  { id:'pisha',    icon:'✏️', name:'Пиша и рисувам', sub:'пръстче, писане, рисуване', col:'#c2457a', bg:'#fbe6ef' },
  { id:'smyatam',  icon:'🔢', name:'Смятам',         sub:'числа, пари, часовник', col:'#c47a12', bg:'#fdf0d9' },
  { id:'mislya',   icon:'🧩', name:'Мисля и помня',  sub:'памет и внимание',      col:'#6c55c9', bg:'#ecebfd' },
  { id:'govorya',  icon:'💬', name:'Говоря',         sub:'чувства, моят ден',     col:'#1b8a6b', bg:'#dff4ec' },
  { id:'pochivam', icon:'🌿', name:'Почивам',        sub:'дишане, балончета',     col:'#4f8a1f', bg:'#e8f3dc' }
];
M.GAMES = [
  // [id, файл, игра в файла (или ''), икона, име, свят]
  ['srichki', 'srichki-razmer.html', '', '📖', 'Срички на глас', 'cheta'],
  ['chetene/kartinka', 'chetene.html', 'kartinka', '🐱', 'Коя е думата?', 'cheta'],
  ['chetene/duma', 'chetene.html', 'duma', '🔤', 'Прочети и намери', 'cheta'],
  ['chetene/zvuk', 'chetene.html', 'zvuk', '🅰️', 'Първият звук', 'cheta'],
  ['chetene/posleden', 'chetene.html', 'posleden', '🔚', 'Последният звук', 'cheta'],
  ['chetene/chuy', 'chetene.html', 'chuy', '👂', 'Чуй сричката', 'cheta'],
  ['chetene/broisrichki', 'chetene.html', 'broisrichki', '👏', 'Колко срички?', 'cheta'],
  ['chetene/srichki', 'chetene.html', 'srichki', '🧩', 'Сглоби думата', 'cheta'],
  ['chetene/rimi', 'chetene.html', 'rimi', '🎵', 'Рими', 'cheta'],
  ['chetene/glavni', 'chetene.html', 'glavni', 'Аа', 'Голяма и малка', 'cheta'],
  ['chetene/izrechenie', 'chetene.html', 'izrechenie', '📝', 'Подреди изречението', 'cheta'],
  ['pisane', 'bulgarian-typing-login.html', '', '⌨️', 'Пиши и говори', 'pisha'],
  ['dvizhenie/prosledi', 'dvizhenie.html', 'prosledi', '✍️', 'Проследи букви', 'pisha'],
  ['dvizhenie/konturi', 'dvizhenie.html', 'konturi', '🏠', 'Проследи предмет', 'pisha'],
  ['dvizhenie/tochki', 'dvizhenie.html', 'tochki', '1·2·3', 'Свържи точките', 'pisha'],
  ['dvizhenie/risuvane', 'dvizhenie.html', 'risuvane', '🎨', 'Рисувай свободно', 'pisha'],
  ['sbor', 'matematika_sbor_login_preminavane.html', '', '➕', 'Събиране', 'smyatam'],
  ['izvazhdane', 'matematika_izvazhdane_login_zaemane.html', '', '➖', 'Изваждане', 'smyatam'],
  ['pari/broene', 'chisla-i-pari.html', 'broene', '🍎', 'Броене', 'smyatam'],
  ['pari/sravnenie', 'chisla-i-pari.html', 'sravnenie', '⚖️', 'По-малко или повече', 'smyatam'],
  ['pari/prava', 'chisla-i-pari.html', 'prava', '📏', 'Числова права', 'smyatam'],
  ['pari/umnozhenie', 'chisla-i-pari.html', 'umnozhenie', '✖️', 'Умножение', 'smyatam'],
  ['pari/shabloni', 'chisla-i-pari.html', 'shabloni', '🔴', 'Какво следва?', 'smyatam'],
  ['pari/figuri', 'chisla-i-pari.html', 'figuri', '🔺', 'Фигури и цветове', 'smyatam'],
  ['pari/chasovnik', 'chisla-i-pari.html', 'chasovnik', '🕒', 'Часовник', 'smyatam'],
  ['pari/kalendar', 'chisla-i-pari.html', 'kalendar', '📅', 'Дни, месеци, сезони', 'smyatam'],
  ['pari/razpoznavane', 'chisla-i-pari.html', 'razpoznavane', '🪙', 'Монети и банкноти', 'smyatam'],
  ['pari/kolko', 'chisla-i-pari.html', 'kolko', '💰', 'Колко пари има?', 'smyatam'],
  ['pari/plati', 'chisla-i-pari.html', 'plati', '🛒', 'Плати точно', 'smyatam'],
  ['pari/resto', 'chisla-i-pari.html', 'resto', '💶', 'Колко е рестото?', 'smyatam'],
  ['pari/stigat', 'chisla-i-pari.html', 'stigat', '🤔', 'Стигат ли парите?', 'smyatam'],
  ['vnimanie/memory', 'vnimanie.html', 'memory', '🃏', 'Намери двойките', 'mislya'],
  ['vnimanie/sortirane', 'vnimanie.html', 'sortirane', '🧺', 'Подреди в кошниците', 'mislya'],
  ['vnimanie/razlichno', 'vnimanie.html', 'razlichno', '🔍', 'Кое е различното?', 'mislya'],
  ['vnimanie/lipsva', 'vnimanie.html', 'lipsva', '❓', 'Какво липсва?', 'mislya'],
  ['vnimanie/poredica', 'vnimanie.html', 'poredica', '🔢', 'Какво става после?', 'mislya'],
  ['vnimanie/simon', 'vnimanie.html', 'simon', '🔴', 'Повтори реда', 'mislya'],
  ['vnimanie/lyavo', 'vnimanie.html', 'lyavo', '⬅️', 'Ляво и дясно', 'mislya'],
  ['vnimanie/labirint', 'vnimanie.html', 'labirint', '🐭', 'Лабиринт', 'mislya'],
  ['govorya/aac', 'govorya.html', 'aac', '🗣️', 'Моето табло', 'govorya'],
  ['govorya/grafik', 'govorya.html', 'grafik', '📅', 'Моят ден', 'govorya'],
  ['govorya/chuvstva', 'govorya.html', 'chuvstva', '💛', 'Как се чувствам?', 'govorya'],
  ['govorya/emocii', 'govorya.html', 'emocii', '😀', 'Познай емоцията', 'govorya'],
  ['govorya/bezopasnost', 'govorya.html', 'bezopasnost', '🚦', 'Светофар и безопасност', 'govorya'],
  ['govorya/vreme', 'govorya.html', 'vreme', '☂️', 'Облечи се за времето', 'govorya'],
  ['govorya/taimer', 'govorya.html', 'taimer', '⏳', 'Таймер', 'govorya'],
  ['dvizhenie/dishane', 'dvizhenie.html', 'dishane', '🌬️', 'Дишай с мен', 'pochivam'],
  ['dvizhenie/balonche', 'dvizhenie.html', 'balonche', '🫧', 'Балончета', 'pochivam'],
  ['dvizhenie/svetlinki', 'dvizhenie.html', 'svetlinki', '✨', 'Светлинки', 'pochivam']
].map(([id, file, mode, icon, name, world]) => ({ id, file, mode, icon, name, world }));
M.gameById = (id) => M.GAMES.find(g => g.id === id) || null;
const APP_SHORT = { 'chetene.html':'chetene', 'chisla-i-pari.html':'pari', 'vnimanie.html':'vnimanie', 'govorya.html':'govorya', 'dvizhenie.html':'dvizhenie' };

/* ================= Анонимна статистика =================
   Брои посещенията (отваряне на хъба) и игрите. Пази опашка на устройството и я
   праща на api/track.php, когато има интернет. Без имена и имейли: само случаен ключ
   на устройството + номера на профила. Изключена е извън tapnime.eu (тестовете я
   включват с __statsForce). */
const ST_Q = 'maxiStatsQ_v1', ST_DEV = 'maxiDev_v1', ST_LAST = 'maxiStatsLast_v1';
const S = M.Stats = {};
S.enabled = function(){
  try{ if(localStorage.getItem('__statsForce') === '1') return true; }catch(e){}
  return /(^|\.)tapnime\.eu$/i.test(location.hostname);
};
const lsGet = (k, d) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
function devKey(){
  let k = lsGet(ST_DEV, '');
  if(!/^[A-Za-z0-9_-]{16,40}$/.test(k)){
    const a = new Uint8Array(15);
    (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach((x, i) => a[i] = Math.random() * 256);
    k = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    lsSet(ST_DEV, k);
  }
  return k;
}
function userKey(){
  const p = lsGet('hubActiveProfile_v1', null);
  const pid = p && p.id ? String(p.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) : '';
  return (devKey() + (pid ? '_' + pid : '')).slice(0, 64);
}
function today(){ const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
let flushTimer = null, flushing = false;
function push(ev){
  if(!S.enabled()) return;
  ev.d = today(); ev.u = userKey();
  const q = lsGet(ST_Q, []);
  q.push(ev);
  if(q.length > 500) q.splice(0, q.length - 500);
  lsSet(ST_Q, q);
  clearTimeout(flushTimer); flushTimer = setTimeout(S.flush, 2000);
}
S.flush = function(){
  if(!S.enabled() || flushing || (navigator.onLine === false)) return Promise.resolve();
  const q = lsGet(ST_Q, []);
  if(!q.length) return Promise.resolve();
  const batch = q.slice(0, 100);
  flushing = true;
  return fetch('api/track.php', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ e: batch }), keepalive:true, cache:'no-store' })
    .then(r => {
      // приети (2xx) или безсмислени за повторение (4xx) → махаме ги от опашката
      if(r.ok || (r.status >= 400 && r.status < 500)){
        const now = lsGet(ST_Q, []); now.splice(0, batch.length); lsSet(ST_Q, now);
        if(r.ok && now.length) setTimeout(S.flush, 500);
      }
    })
    .catch(() => {})
    .then(() => { flushing = false; });
};
// Посещение: отваряне на хъба (повторно отваряне до 30 мин е същото посещение).
S.visit = function(){
  const last = lsGet(ST_LAST, {});
  if(last.v && Date.now() - last.v < 30 * 60000){ last.v = Date.now(); lsSet(ST_LAST, last); return; }
  last.v = Date.now(); lsSet(ST_LAST, last);
  push({ t:'v' });
};
// Игра: една и съща игра до 1 мин е едно пускане.
S.game = function(id){
  if(!id || !/^[a-z0-9_-]{1,32}(\/[a-z0-9_-]{1,32})?$/.test(id)) return;
  const last = lsGet(ST_LAST, {});
  last.g = last.g || {};
  if(last.g[id] && Date.now() - last.g[id] < 60000) return;
  last.g[id] = Date.now();
  Object.keys(last.g).forEach(k => { if(Date.now() - last.g[k] > 3600000) delete last.g[k]; });
  lsSet(ST_LAST, last);
  push({ t:'g', g:id });
};
S.gameHere = (key) => { const a = APP_SHORT[thisFile()]; if(a) S.game(a + '/' + key); };
if(typeof window !== 'undefined'){
  window.addEventListener('online', () => S.flush());
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') S.flush(); });
  setTimeout(() => S.flush(), 3000);
}

/* ================= Изолация на игрите =================
   Игрите в едно приложение са в един файл и делят общия код. За да не може грешка
   в една игра да спре другите:
   - M.isolate(key, fn) пуска кода на играта при зареждане; ако гръмне, само тази игра
     се изключва (плочката ѝ показва „🔧 почива“), а останалите работят;
   - M.guard(key, fn) пази функцията, която отваря игра (напр. openDraw);
   - createGame пази всеки кръг: грешка показва „Тази игра почива“ вместо празен екран. */
M.brokenGames = {};
function tilesOf(key){
  return M.$$('.mx-tile').filter(t => t.dataset.game === key || (t.getAttribute('onclick') || '').includes("'" + key + "'"));
}
M.markBroken = function(key, err){
  M.brokenGames[key] = String((err && err.message) || err || 'грешка');
  try{ console.error('[Maxi] Играта „' + key + '“ е изключена:', err); }catch(e){}
  const mark = () => tilesOf(key).forEach(t => {
    t.classList.add('mx-broken'); t.setAttribute('aria-disabled', 'true');
    if(!t.querySelector('.mx-fix')) t.insertAdjacentHTML('beforeend', '<span class="mx-fix">🔧 почива</span>');
  });
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark); else mark();
};
M.isolate = function(key, fn){
  try{ return fn(); }catch(e){ M.markBroken(key, e); return undefined; }
};
M.gameDown = function(key){
  M.speak('Тази игра почива. Избери друга.');
  const t = tilesOf(key)[0];
  if(t){ t.classList.remove('mx-shake'); void t.offsetWidth; t.classList.add('mx-shake'); }
};
M.guard = function(key, fn){
  if(typeof fn !== 'function') return function(){ M.gameDown(key); };
  return function(){
    if(M.brokenGames[key]){ M.gameDown(key); return; }
    try{ const r = fn.apply(this, arguments); M.Stats.gameHere(key); return r; }
    catch(e){
      try{ console.error('[Maxi] Грешка в „' + key + '“:', e); }catch(x){}
      M.show('menu');
      M.gameDown(key);
    }
  };
};

M.createGame = function(store, modes, opts){
  opts = opts || {};
  const $ = (id) => document.getElementById(id);
  store.rec.extra.levels = store.rec.extra.levels || {};
  const G = { mode:null, level:0, roundId:0, mistakes:0, promptSpeech:'', hintFn:null, modes, store };

  // Отворена направо от хъба (app.html → файл#g=игра): „Назад“ връща в хъба, не в менюто тук.
  G.deep = false;
  G.goMenu = function(){
    G.roundId++; M.stopSpeech(); if(G.onLeave) G.onLeave(); G.onLeave = null;
    if(G.deep){
      G.deep = false;
      try{ if(window.parent !== window && typeof window.parent.closeApp === 'function'){ window.parent.closeApp(); return; } }catch(e){}
    }
    M.show('menu');
  };
  G.openMode = function(key){
    if(!modes[key] || M.brokenGames[key]){ M.gameDown(key); return; }
    M.Stats.gameHere(key);
    G.mode = key;
    M.markSeen(key);
    const lv = modes[key].levels || [];
    G.level = Math.min(store.rec.extra.levels[key] || 0, Math.max(0, lv.length - 1));
    G.renderLevels();
    M.show('play');
    G.newRound();
  };
  G.renderLevels = function(){
    const box = $('levels');
    box.innerHTML = '';
    (modes[G.mode].levels || []).forEach((lbl, i) => {
      const b = document.createElement('button');
      b.className = 'mx-level' + (i === G.level ? ' active' : '');
      b.textContent = lbl;
      b.onclick = () => { G.level = i; store.rec.extra.levels[G.mode] = i; store.save(); G.renderLevels(); G.newRound(); };
      box.appendChild(b);
    });
    if(modes[G.mode].extraControls){ try{ modes[G.mode].extraControls(box); }catch(e){ try{ console.error(e); }catch(x){} } }
  };
  G.newRound = function(){
    G.roundId++;
    G.mistakes = 0;
    G.hintFn = null;
    if(G.onLeave) G.onLeave();
    G.onLeave = null;
    $('area').innerHTML = '';
    $('answer').innerHTML = ''; $('answer').className = '';
    $('keypad').innerHTML = ''; $('keypad').className = '';
    $('nextBtn').hidden = true;
    $('hintBtn').hidden = true;
    M.feedback($('fb'), '');
    try{ modes[G.mode].round(); }
    catch(e){
      // Грешка само в тази игра: показваме спокойно съобщение, другите игри не се засягат.
      try{ console.error('[Maxi] Грешка в „' + G.mode + '“:', e); }catch(x){}
      $('area').innerHTML = '<div class="mx-down">🔧<b>Тази игра почива.</b><span>Избери друга игра.</span>' +
        '<button class="mx-btn" type="button" onclick="goMenu()">↩ Към игрите</button></div>';
      M.speak('Тази игра почива. Избери друга.');
    }
  };
  G.setPrompt = function(text, speech, silent){
    $('prompt').textContent = text;
    G.promptSpeech = speech || text;
    if(!silent) M.speak(G.promptSpeech);
  };
  G.sayPrompt = () => M.speak(G.promptSpeech);
  G.setHint = function(fn){ G.hintFn = fn; $('hintBtn').hidden = !fn; };
  G.hint = () => { if(G.hintFn) G.hintFn(); };
  G.done = () => !$('nextBtn').hidden;
  G.lockOptions = () => M.$$('.mx-opt', $('area')).forEach(b => b.disabled = true);

  /* Завършен кръг: запис (верен, ако е без грешки), похвала, звезда, напред. */
  G.complete = function(q, answer, extraSpeech, o){
    o = o || {};
    const clean = G.mistakes === 0;
    const res = store.result(G.mode, q, clean, answer, window.MaxiPoints ? MaxiPoints.forAnswer(clean) : (clean ? 15 : 10));
    const p = M.praise();
    M.good();
    M.feedback($('fb'), '✅ ' + p + (res.star ? ' ⭐ Нова звезда!' : ''), 'ok');
    if(res.star) M.confetti(12);
    G.lockOptions();
    $('nextBtn').hidden = false;
    $('hintBtn').hidden = true;
    const my = G.roundId;
    const speech = Array.isArray(extraSpeech) ? extraSpeech : [extraSpeech];
    M.speakSeq([p].concat(speech).concat([res.star ? 'Нова звезда!' : null]), () => {
      if(o.noAuto) return;
      setTimeout(() => { if(my === G.roundId && $('play').classList.contains('active')) G.newRound(); }, opts.autoDelay || 1500);
    });
  };
  G.miss = function(q, answer, extraSpeech){
    G.mistakes++;
    store.result(G.mode, q, false, answer);
    M.bad();
    const t = M.tryAgain();
    M.feedback($('fb'), '❌ ' + t, 'bad');
    M.speakSeq([t, extraSpeech]);
  };
  /* Големи бутони с отговори. items: [{ html, value, label, cls, speakOk, speakBad }] */
  G.optionButtons = function(items, correct, q, onPick, parent){
    const box = document.createElement('div');
    box.className = 'mx-options';
    items.forEach(it => {
      const b = document.createElement('button');
      b.className = 'mx-opt' + (it.cls ? ' ' + it.cls : '');
      b.innerHTML = it.html;
      b.onclick = () => {
        if(b.disabled || G.done()) return;
        if(onPick) onPick(it, b);
        if(it.value === correct){
          b.classList.add('ok');
          G.complete(q, it.label !== undefined ? it.label : it.value, it.speakOk);
        } else {
          b.classList.remove('bad'); void b.offsetWidth; b.classList.add('bad');
          b.disabled = true;
          G.miss(q, it.label !== undefined ? it.label : it.value, it.speakBad);
        }
      };
      box.appendChild(b);
    });
    (parent || $('area')).appendChild(box);
    return box;
  };
  G.numberOptions = function(correct, spread, min){
    const set = new Set([correct]);
    let guard = 0;
    while(set.size < 3 && guard++ < 100){
      const v = correct + M.pick([-1, 1]) * M.randInt(1, spread);
      if(v >= (min || 0)) set.add(v);
    }
    return M.shuffle(Array.from(set));
  };
  G.digits = function(segments, onDone){
    return M.digitAnswer($('answer'), $('keypad'), segments, { onWrongDigit(){ G.mistakes++; }, onDone });
  };

  ['goMenu','openMode','newRound','setPrompt','sayPrompt','setHint','hint','complete','miss','optionButtons','numberOptions','lockOptions']
    .forEach(k => { window[k] = G[k]; });
  M.bindBadges(store);
  // file.html#g=игра → отваряме направо тази игра (плочката ѝ — и за игрите извън MODES).
  setTimeout(() => {
    const m = /^#g=(\w+)$/.exec(location.hash || '');
    if(!m) return;
    const tile = tilesOf(m[1])[0];
    if(tile){ G.deep = true; tile.click(); }
  }, 0);
  return G;
};

/* ================= Рисунки на евро монети и банкноти =================
   Опростени учебни рисунки (не са копия на истинските): правилен цвят,
   относителен размер и стойност. Банкнотите носят надпис „УЧЕБНИ ПАРИ“. */
M.COINS = [1, 2, 5, 10, 20, 50, 100, 200];
M.NOTES = [500, 1000, 2000, 5000, 10000, 20000, 50000];
const COIN_MM = { 1:16.25, 2:18.75, 5:21.25, 10:19.75, 20:22.25, 50:24.25, 100:23.25, 200:25.75 };
const NOTE_MM = { 500:[120,62], 1000:[127,67], 2000:[133,72], 5000:[140,77], 10000:[147,77], 20000:[153,77], 50000:[160,82] };
const NOTE_COL = {
  500:['#7d8b91','#d5dcde'], 1000:['#c9463f','#f4bcb3'], 2000:['#3a67ad','#b3cbee'],
  5000:['#e07a2c','#f9cfa3'], 10000:['#338c50','#b5e0c0'], 20000:['#b88d25','#f0dfa6'], 50000:['#7e4f9c','#d8c0e6']
};
let gradId = 0;
M.moneySVG = function(cents, scale){
  scale = scale || 1;
  const id = 'mg' + (++gradId);
  if(COIN_MM[cents]){
    const d = Math.round(COIN_MM[cents] * 3.1 * scale);
    const r = d / 2;
    const copper = ['#f0b27f','#b8612a','#7a3d17'];
    const gold = ['#fbe6a0','#caa13a','#8a6a18'];
    const silver = ['#fbfcfd','#b3bcc5','#6f7a85'];
    const outer = cents <= 5 ? copper : (cents < 100 ? gold : (cents === 100 ? gold : silver));
    const inner = cents === 100 ? silver : (cents === 200 ? gold : null);
    const big = cents >= 100 ? String(cents / 100) : String(cents);
    const small = cents >= 100 ? 'ЕВРО' : (cents === 1 ? 'ЦЕНТ' : 'ЦЕНТА');
    const ink = outer === copper ? '#5a2a0e' : '#4a3a0c';
    const inkIn = inner === silver ? '#3a434c' : ink;
    return `<svg class="money coin" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" role="img" aria-label="${M.moneyName(cents)}">
      <defs>
        <radialGradient id="${id}o" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${outer[0]}"/><stop offset="1" stop-color="${outer[1]}"/></radialGradient>
        ${inner ? `<radialGradient id="${id}i" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${inner[0]}"/><stop offset="1" stop-color="${inner[1]}"/></radialGradient>` : ''}
      </defs>
      <circle cx="${r}" cy="${r}" r="${r - 1}" fill="url(#${id}o)" stroke="${outer[2]}" stroke-width="2"/>
      <circle cx="${r}" cy="${r}" r="${r * 0.86}" fill="none" stroke="${outer[2]}" stroke-opacity="0.35" stroke-width="1.5"/>
      ${inner ? `<circle cx="${r}" cy="${r}" r="${r * 0.68}" fill="url(#${id}i)" stroke="${inner[2]}" stroke-width="1.5"/>` : ''}
      <text x="${r}" y="${r + d * 0.1}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${d * (big.length > 1 ? 0.36 : 0.44)}" fill="${inner ? inkIn : ink}">${big}</text>
      <text x="${r}" y="${r + d * 0.29}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${d * 0.12}" fill="${inner ? inkIn : ink}">${small}</text>
    </svg>`;
  }
  if(NOTE_MM[cents]){
    const [mw, mh] = NOTE_MM[cents];
    const w = Math.round(mw * 1.35 * scale), h = Math.round(mh * 1.35 * scale);
    const [dark, light] = NOTE_COL[cents];
    const val = String(cents / 100);
    let stars = '';
    const cx = w * 0.2, cy = h * 0.3, rr = h * 0.13;
    for(let i = 0; i < 12; i++){
      const a = i * Math.PI / 6;
      stars += `<circle cx="${(cx + rr * Math.cos(a)).toFixed(1)}" cy="${(cy + rr * Math.sin(a)).toFixed(1)}" r="${(h * 0.017).toFixed(1)}" fill="#ffd84a"/>`;
    }
    return `<svg class="money note" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${M.moneyName(cents)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
      <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${h * 0.08}" fill="url(#${id})" stroke="${dark}" stroke-width="2"/>
      <rect x="${w * 0.06}" y="${h * 0.12}" width="${w * 0.28}" height="${h * 0.62}" rx="${h * 0.05}" fill="#1f3c88" fill-opacity="0.85"/>
      ${stars}
      <path d="M ${w * 0.45} ${h * 0.86} L ${w * 0.45} ${h * 0.42} Q ${w * 0.58} ${h * 0.12} ${w * 0.71} ${h * 0.42} L ${w * 0.71} ${h * 0.86} Z" fill="#ffffff" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.6" stroke-width="2"/>
      <text x="${w * 0.2}" y="${h * 0.66}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${h * 0.14}" fill="#ffffff">ЕВРО</text>
      <text x="${w * 0.95}" y="${h * 0.34}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-weight="900" font-size="${h * 0.3}" fill="#ffffff" stroke="${dark}" stroke-width="1">${val}</text>
      <text x="${w * 0.95}" y="${h * 0.9}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-weight="900" font-size="${h * 0.42}" fill="${dark}" fill-opacity="0.9">${val}</text>
      <text x="${w * 0.06}" y="${h * 0.93}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${h * 0.08}" fill="#ffffff" fill-opacity="0.85">УЧЕБНИ ПАРИ</text>
    </svg>`;
  }
  return '';
};

})();
