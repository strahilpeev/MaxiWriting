// Тест на „Пръстче и спокойствие“: „Проследи предмет“ (всички 18 контура могат да се
// проследят, драскане не минава) и „Рисувай свободно“ (цвят, гума, назад, нов лист, размер).
//   node test/dvizhenie.mjs            — изходния код
//   node test/dvizhenie.mjs dist       — защитената версия
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', process.argv[2] === 'dist' ? 'dist' : '.');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, q.url.split('?')[0].slice(1) || 'dvizhenie.html');
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
}).listen(8705);

const exe = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', hasTouch: true });
await ctx.route(/^https:/, (r) => r.abort());
await ctx.addInitScript(() => { try{ window.speechSynthesis.speak = () => {}; }catch(e){} });
const t = await ctx.newPage();
const errors = [];
t.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) failed++; };

await t.goto('http://localhost:8705/dvizhenie.html'); await t.waitForTimeout(400);
check(await t.locator('.mx-tile[onclick*="konturi"]').isVisible() && await t.locator('.mx-tile[onclick*="risuvane"]').isVisible(), 'в менюто има „Проследи предмет“ и „Рисувай свободно“');
check(await t.locator('.mx-tile[onclick*="konturi"] .mx-new').count() === 1, 'новите игри са със значка „НОВО“');

// Проследява текущия контур: минава по пътеката точка по точка (SVG getPointAtLength), с мишка.
async function traceCurrent(offset = 0) {
  const pts = await t.evaluate((off) => {
    const sh = lastOutline, cv = document.getElementById('traceCanvas'), r = cv.getBoundingClientRect();
    const cssW = r.width, cssH = r.height, k = Math.min(cssW, cssH) * 0.9 / 100, ox = (cssW - 100 * k) / 2, oy = (cssH - 100 * k) / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const strokes = [];
    // всяка подпътека (M…) поотделно, за да не минаваме между частите
    sh.d.split(/(?=M)/).forEach((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p);
      document.body.appendChild(svg);
      const L = p.getTotalLength(), n = Math.max(8, Math.ceil(L / 1.5)), arr = [];
      for (let i = 0; i <= n; i++) { const q = p.getPointAtLength(L * i / n); arr.push([r.left + ox + q.x * k + off, r.top + oy + q.y * k + off]); }
      strokes.push(arr); svg.remove();
    });
    return strokes;
  }, offset);
  for (const s of pts) {
    await t.mouse.move(s[0][0], s[0][1]); await t.mouse.down();
    for (const [x, y] of s) await t.mouse.move(x, y);
    await t.mouse.up();
  }
}

await t.click('.mx-tile[onclick*="konturi"]'); await t.waitForTimeout(300);
check(await t.evaluate(() => G.mode === 'konturi' && !!document.getElementById('traceCanvas')), '„Проследи предмет“ се отваря с лист за проследяване');
const all = await t.evaluate(() => OUTLINES.map((l) => l.map((o) => o.n)));
check(all.flat().length === 18 && new Set(all.flat()).size === 18, '18 различни предмета на три нива');

// всеки контур може да се проследи
const solved = [];
for (let lv = 0; lv < 3; lv++) {
  await t.click(`#levels .mx-level >> nth=${lv}`); await t.waitForTimeout(200);
  for (const name of all[lv]) {
    await t.evaluate((nm) => { lastOutline = OUTLINES.flat().find((o) => o.n !== nm) ; const want = OUTLINES[G.level].find((o) => o.n === nm); const pick = M.pick; M.pick = () => want; newRound(); M.pick = pick; }, name);
    await t.waitForTimeout(80);
    await traceCurrent(0);
    await t.waitForTimeout(80);
    if (await t.evaluate(() => G.done())) solved.push(name);
    else console.log('   не мина:', name, await t.evaluate(() => 0));
  }
}
check(solved.length === 18, 'всички 18 контура се приемат, когато се проследят (' + solved.length + ')');

// проследяване малко встрани — пак минава (толеранс за детски пръст)
await t.evaluate(() => { const want = OUTLINES[0][0]; const pick = M.pick; M.pick = () => want; lastOutline = null; newRound(); M.pick = pick; });
await t.click('#levels .mx-level >> nth=0'); await t.waitForTimeout(100);
await t.evaluate(() => { const want = OUTLINES[0].find((o) => o.n === 'къща'); const pick = M.pick; M.pick = () => want; lastOutline = null; newRound(); M.pick = pick; });
await traceCurrent(7); await t.waitForTimeout(80);
check(await t.evaluate(() => G.done()), 'малко встрани от линията (7px) → пак се приема');

// драскане не минава
await t.evaluate(() => { const want = OUTLINES[0].find((o) => o.n === 'топка'); const pick = M.pick; M.pick = () => want; lastOutline = null; newRound(); M.pick = pick; });
const box = await t.locator('#traceCanvas').boundingBox();
await t.mouse.move(box.x + 20, box.y + 20); await t.mouse.down();
for (let i = 0; i < 40; i++) await t.mouse.move(box.x + 20 + (i % 2) * (box.width - 40), box.y + 20 + i * (box.height - 40) / 40);
await t.mouse.up();
await t.click('text=Готово ✓'); await t.waitForTimeout(100);
check(!(await t.evaluate(() => G.done())), 'драскане по целия лист не се приема');
await t.click('text=🧽 Изчисти');
// половин контур не стига
await t.evaluate(() => {
  const sh = lastOutline, cv = document.getElementById('traceCanvas'); window.__half = sh;
});
const half = await t.evaluate(() => {
  const cv = document.getElementById('traceCanvas'), r = cv.getBoundingClientRect(), k = Math.min(r.width, r.height) * 0.9 / 100, ox = (r.width - 100 * k) / 2, oy = (r.height - 100 * k) / 2;
  const out = []; for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + Math.PI * i / 40; out.push([r.left + ox + (50 + 38 * Math.cos(a)) * k, r.top + oy + (50 + 38 * Math.sin(a)) * k]); } return out;
});
await t.mouse.move(half[0][0], half[0][1]); await t.mouse.down(); for (const [x, y] of half) await t.mouse.move(x, y); await t.mouse.up();
await t.waitForTimeout(80);
check(!(await t.evaluate(() => G.done())), 'половин топка не стига');
await t.click('text=Готово ✓'); await t.waitForTimeout(100);
check(!(await t.evaluate(() => G.done())) && (await t.textContent('#fb')).includes('Още малко'), '„Готово“ с половин контур → „Още малко“');
await t.screenshot({ path: '/tmp/konturi.png' });

// ---------- Рисувай свободно ----------
await t.evaluate(() => goMenu()); await t.waitForTimeout(200);
await t.click('.mx-tile[onclick*="risuvane"]'); await t.waitForTimeout(400);
check(await t.evaluate(() => document.getElementById('draw').classList.contains('active')), '„Рисувай свободно“ се отваря');
check(await t.locator('.swatch').count() === 12 && await t.locator('.tool.size').count() === 3, '12 цвята и 3 дебелини');
const sw = await t.locator('.swatch').first().boundingBox(), er = await t.locator('#eraserBtn').boundingBox();
check(sw.width >= 54 && er.height >= 54, 'бутоните за цвят и гума са големи (' + Math.round(sw.width) + 'px, ' + Math.round(er.height) + 'px)');
const cb = await t.locator('#drawCanvas').boundingBox();
check(cb.height > 350 && cb.width > 900, 'листът заема почти целия екран (' + Math.round(cb.width) + '×' + Math.round(cb.height) + ')');
const pixel = (x, y) => t.evaluate(([x, y]) => { const cv = document.getElementById('drawCanvas'), dpr = cv.width / cv.clientWidth; return Array.from(cv.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data); }, [x, y]);
async function stroke(x1, y1, x2, y2) { await t.mouse.move(cb.x + x1, cb.y + y1); await t.mouse.down(); for (let i = 1; i <= 20; i++) await t.mouse.move(cb.x + x1 + (x2 - x1) * i / 20, cb.y + y1 + (y2 - y1) * i / 20); await t.mouse.up(); }
await t.click('.swatch[data-c="#3498db"]');
check(await t.evaluate(() => document.querySelector('.swatch[data-c="#3498db"]').classList.contains('on')), 'избраният цвят е отбелязан');
await stroke(100, 100, 400, 100);
let px = await pixel(250, 100);
check(px[3] > 200 && px[2] > 150 && px[0] < 100, 'рисува се със синьо');
await t.click('.swatch[data-c="#e74c3c"]'); await t.click('.tool.size >> nth=2');
await stroke(100, 200, 400, 200);
px = await pixel(250, 200);
check(px[3] > 200 && px[0] > 180 && px[2] < 100, 'смяна на цвета → червено');
await t.click('#eraserBtn');
check(await t.evaluate(() => D.eraser && document.getElementById('eraserBtn').classList.contains('on') && !document.querySelector('.swatch.on')), 'гумата е отбелязана, цветът — не');
await stroke(250, 60, 250, 240);
check((await pixel(250, 100))[3] === 0 && (await pixel(250, 200))[3] === 0, 'гумата трие');
check((await pixel(150, 100))[3] > 200, '…само там, където минава');
await t.click('text=Назад');
check((await pixel(250, 100))[3] > 200, '„Назад“ връща изтритото');
await t.click('.swatch[data-c="#2ecc71"]');
check(await t.evaluate(() => !D.eraser), 'избор на цвят изключва гумата');
// два пръста едновременно
await t.evaluate(() => {
  const cv = document.getElementById('drawCanvas'), r = cv.getBoundingClientRect();
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch', isPrimary: id === 11 }));
  ev('pointerdown', 11, 500, 300); ev('pointerdown', 12, 700, 300);
  for (let i = 1; i <= 10; i++) { ev('pointermove', 11, 500, 300 + i * 6); ev('pointermove', 12, 700, 300 + i * 6); }
  ev('pointerup', 11, 500, 360); ev('pointerup', 12, 700, 360);
});
check((await pixel(500, 330))[3] > 200 && (await pixel(700, 330))[3] > 200 && (await pixel(600, 330))[3] === 0, 'два пръста рисуват две отделни линии');
// нов лист — с второ докосване
await t.click('#clearBtn');
check((await pixel(150, 100))[3] > 200 && (await t.textContent('#clearBtn')).includes('Сигурен'), '„Нов лист“ първо пита');
await t.click('#clearBtn');
check((await pixel(150, 100))[3] === 0 && (await pixel(500, 330))[3] === 0, 'второто докосване изчиства листа');
await t.click('text=Назад');
check((await pixel(150, 100))[3] > 200, '„Назад“ връща и изчистения лист');
// завъртане на таблета → рисунката остава
await t.setViewportSize({ width: 800, height: 1200 }); await t.waitForTimeout(300);
const cb2 = await t.locator('#drawCanvas').boundingBox();
check(await t.evaluate(() => { const cv = document.getElementById('drawCanvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 400) if (d[i] > 0) n++; return n > 20; }), 'след завъртане рисунката остава (' + Math.round(cb2.width) + '×' + Math.round(cb2.height) + ')');
await t.screenshot({ path: '/tmp/risuvane.png' });
const dl = t.waitForEvent('download', { timeout: 3000 }).catch(() => null);
await t.click('text=Запази');
const file = await dl;
check(!!file && /^risunka-\d{8}-\d{4}\.png$/.test(file.suggestedFilename()), '„Запази“ сваля PNG (' + (file && file.suggestedFilename()) + ')');
await t.evaluate(() => goMenu()); await t.waitForTimeout(100);
check(await t.evaluate(() => store.rec.history.some((h) => h.mode === 'risuvane' && h.q.includes('свободно рисуване'))), 'рисуването се записва в дневника');

check(errors.length === 0, 'без JavaScript грешки' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} ГРЕШКИ` : '\nВсичко е наред');
process.exit(failed ? 1 : 0);
