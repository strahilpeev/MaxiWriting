/* Точки, звания и бонус звезди — общи правила за всички игри и хъба.
   Само данни и чисти функции (без странични ефекти), за да може да се
   зарежда навсякъде, включително в по-старите приложения.
   Излага window.MaxiPoints.

   - Верен отговор: 15 точки без грешка, 10 точки с грешки.
   - Всяка игра има свои звания по точките в нея (0, 50, 150, 300, 500, 800, 1200).
   - В общия басейн от звезди: всеки 100 точки (сбор от всички игри) = +1 ⭐,
     а всяко ново звание дава еднократен бонус: +10, +20, +40, +60, +80, +100 ⭐. */
(function(){
'use strict';
const P = {};
window.MaxiPoints = P;

P.CLEAN = 15;
P.WITH_MISTAKES = 10;
P.POINTS_PER_STAR = 100;
P.STEPS = [0, 50, 150, 300, 500, 800, 1200];
P.BONUS = [0, 10, 20, 40, 60, 80, 100];   // звезди за достигане на звание i

P.forAnswer = (clean) => clean ? P.CLEAN : P.WITH_MISTAKES;

/* Званията по игри — същите прагове навсякъде. */
P.TITLES = {
  pisane:     ['Начинаещ пътник 🌱','Любител на думите 📖','Малък писар ✍️','Майстор на буквите 🔤','Шампион по български 🏅','Кралица/Крал на думите 👑','Легенда на българския 🏆'],
  sbor:       ['Начинаещ броител 🌱','Приятел на числата 🔢','Малък математик ➕','Майстор на сбора 🧮','Шампион по смятане 🏅','Кралица/Крал на сбора 👑','Легенда на сбора 🏆'],
  izvazhdane: ['Начинаещ броител 🌱','Приятел на числата 🔢','Малък математик ➖','Майстор на изваждането 🧮','Шампион по смятане 🏅','Кралица/Крал на изваждането 👑','Легенда на изваждането 🏆'],
  chetene:    ['Начинаещ читател 🌱','Любител на буквите 🔤','Малък читател 📖','Майстор на сричките 🧩','Шампион по четене 🏅','Кралица/Крал на книжките 👑','Легенда на четенето 🏆'],
  pari:       ['Начинаещ касиер 🌱','Приятел на числата 🔢','Малък търговец 🛒','Майстор на парите 💶','Шампион по числа 🏅','Кралица/Крал на числата 👑','Легенда на числата 🏆'],
  vnimanie:   ['Начинаещ откривател 🌱','Зорко око 👀','Малък детектив 🔍','Майстор на паметта 🧠','Шампион по внимание 🏅','Кралица/Крал на паметта 👑','Легенда на паметта 🏆'],
  govorya:    ['Начинаещ събеседник 🌱','Добър приятел 🤝','Малък разказвач 💬','Майстор на чувствата 💛','Шампион по общуване 🏅','Кралица/Крал на думите 👑','Легенда на общуването 🏆'],
  dvizhenie:  ['Начинаещо пръстче 🌱','Ловко пръстче ✋','Малък художник ✍️','Майстор на линиите 〰️','Шампион по точност 🏅','Кралица/Крал на пръстчетата 👑','Легенда на точността 🏆']
};
P.APP_NAMES = { pisane:'Пиши и говори', sbor:'Сбор', izvazhdane:'Изваждане', chetene:'Четене', pari:'Числа и пари',
  vnimanie:'Внимание и памет', govorya:'Говоря и планирам', dvizhenie:'Пръстче и спокойствие' };

P.titleIndex = (points) => { let i = 0; P.STEPS.forEach((s, k) => { if((points || 0) >= s) i = k; }); return i; };
P.title = (app, points) => (P.TITLES[app] || P.TITLES.pisane)[P.titleIndex(points)];
P.nextStep = (points) => P.STEPS.find(s => s > (points || 0)) || null;
/* Сбор на бонусите за всички достигнати звания (без първото — то е от 0 точки). */
P.titleBonus = (points) => { let b = 0; for(let i = 1; i <= P.titleIndex(points); i++) b += P.BONUS[i]; return b; };
P.pointStars = (totalPoints) => Math.floor((totalPoints || 0) / P.POINTS_PER_STAR);
/* Редица звезди, която не излиза от екрана: всеки 10 звезди се събират в една
   по-голяма звезда с друг цвят, всеки 10 от тях — в още по-голяма, и т.н.
   (37 = 3 оранжеви + 7 жълти; 120 = 1 червена + 2 оранжеви). */
P.STAR_TIER_NAMES = ['звезда', '10 звезди', '100 звезди', '1 000 звезди', '10 000 звезди', '100 000 звезди', '1 000 000 звезди'];
function starStyle(){
  if(document.getElementById('mx-stars-style')) return;
  const st = document.createElement('style'); st.id = 'mx-stars-style';
  st.textContent = '.mx-stars{display:flex!important;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px 4px;max-width:100%;letter-spacing:0!important;overflow:hidden}' +
    '.mx-star{display:inline-block;line-height:1}' +
    '.mx-star.t1{font-size:1.3em;filter:hue-rotate(-38deg) saturate(2.6) drop-shadow(0 0 2px rgba(230,126,34,.6))}' +
    '.mx-star.t2{font-size:1.55em;filter:hue-rotate(-55deg) saturate(2.2) drop-shadow(0 0 3px rgba(231,76,60,.6))}' +
    '.mx-star.t3{font-size:1.8em;filter:hue-rotate(240deg) saturate(1.6) drop-shadow(0 0 3px rgba(155,89,182,.6))}' +
    '.mx-star.t4{font-size:2em;filter:hue-rotate(170deg) saturate(1.6) drop-shadow(0 0 3px rgba(52,152,219,.6))}' +
    '.mx-star.t5{font-size:2.2em;filter:hue-rotate(75deg) saturate(1.6) drop-shadow(0 0 3px rgba(46,204,113,.6))}' +
    '.mx-star.t6{font-size:2.4em;filter:hue-rotate(290deg) saturate(1.8) drop-shadow(0 0 4px rgba(253,121,168,.7))}' +
    '.mx-stars-n{font-size:.6em;font-weight:800;opacity:.75;margin-left:4px;align-self:center}';
  document.head.appendChild(st);
}
P.starGroups = function(count){
  const out = []; let c = Math.max(0, Math.floor(+count || 0)), k = 0;
  while(c > 0){ if(c % 10) out.push([k, c % 10]); c = Math.floor(c / 10); k++; }
  return out.reverse();   // [[ниво, брой], …] — първо най-големите
};
P.renderStars = function(el, count, animateLast){
  if(!el) return;
  starStyle();
  el.classList.add('mx-stars');
  el.innerHTML = '';
  let last = null;
  P.starGroups(count).forEach(([k, n]) => {
    const tier = Math.min(k, 6);
    for(let i = 0; i < n; i++){
      const s = document.createElement('span');
      s.className = 'mx-star t' + tier; s.textContent = '⭐';
      s.title = P.STAR_TIER_NAMES[tier] || ('10^' + k + ' звезди');
      el.appendChild(s); last = s;
    }
  });
  if(count >= 10){ const n = document.createElement('span'); n.className = 'mx-stars-n'; n.textContent = count; el.appendChild(n); }
  el.setAttribute('aria-label', count + ' звезди');
  if(animateLast && last) last.classList.add('star-pop');
};

})();
