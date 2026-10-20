// Сглобява защитената версия на приложението в папка dist/.
// Изходният код (в корена на хранилището) остава непокътнат и четим.
//
//   cd tools && npm install && npm run build
//
// В dist/ отиват: минифициран HTML/CSS, обфускиран JavaScript,
// проверка на домейна, авторски бележки и отпечатък. Без source maps.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify as terser } from 'terser';
import { minify as minifyHtml } from 'html-minifier-terser';
import {
  ALLOWED_HOSTS, OFFICIAL_URL, COPYRIGHT, FINGERPRINT, OBFUSCATOR_OPTIONS
} from './protect.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const OUT = path.join(SRC, 'dist');

// Всичко в корена се обработва автоматично — нови игри не изискват промени тук.
const ROOT_FILES = fs.readdirSync(SRC).filter((f) => fs.statSync(path.join(SRC, f)).isFile());
const HTML_FILES = ROOT_FILES.filter((f) => f.endsWith('.html'));
const JS_FILES = ROOT_FILES.filter((f) => f.endsWith('.js') && f !== 'service-worker.js');
const CSS_FILES = ROOT_FILES.filter((f) => f.endsWith('.css'));
// Файлове, които не са част от сайта и не се публикуват.
const NOT_PUBLISHED = /^(\.git.*|.*\.md|firestore\.rules|package.*\.json)$/i;
const PLAIN_COPY = ROOT_FILES.filter((f) =>
  !/\.(html|js|css)$/.test(f) && !NOT_PUBLISHED.test(f));

// ---------- Проверка на домейна ----------
// Слага се най-отгоре във всеки скрипт ПРЕДИ обфускацията, така че се
// разтваря в останалия код и не може просто да се изтрие един ред.
// На официалния адрес (и офлайн като инсталирано приложение) не прави нищо.
function guardCode() {
  const notice =
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;' +
    'padding:32px;text-align:center;background:#fdf6ec;border-radius:24px;color:#333">' +
    '<div style="font-size:64px">🎓</div>' +
    '<h1 style="font-size:28px;margin:12px 0">Моите учебни игри</h1>' +
    '<p style="font-size:20px;line-height:1.5">Официалната версия на това приложение е на</p>' +
    `<p><a href="${OFFICIAL_URL}" target="_top" style="display:inline-block;font-size:24px;` +
    'padding:16px 32px;background:#5da8e8;color:#fff;border-radius:16px;text-decoration:none">' +
    `${OFFICIAL_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></p></div>`;

  return `
(function(){
  var __mwf=${JSON.stringify(FINGERPRINT)};
  var H=${JSON.stringify(ALLOWED_HOSTS)};
  function okHost(h){ return H.indexOf(String(h||'').toLowerCase())!==-1; }
  var ok = okHost(location.hostname);
  if(ok){
    try{ if(window.top!==window.self){ ok = okHost(window.top.location.hostname); } }
    catch(e){ ok = false; }
  }
  if(ok) return;
  window.__mwBlocked = __mwf;
  var show=function(){ try{ document.body.innerHTML=${JSON.stringify(notice)}; }catch(e){} };
  if(document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  throw new Error('Unofficial copy');
})();
`;
}

function obfuscate(code, isModule) {
  return JavaScriptObfuscator.obfuscate(guardCode() + '\n' + code, {
    ...OBFUSCATOR_OPTIONS,
    sourceType: isModule ? 'module' : 'script'
  }).getObfuscatedCode();
}

const jsBanner = `/*! ${COPYRIGHT} */\n`;
const htmlBanner = `<!-- ${COPYRIGHT} -->\n`;

const metaTags =
  `<meta name="author" content="Strahil Peev">` +
  `<meta name="copyright" content="${COPYRIGHT.replace(/"/g, '&quot;')}">`;

async function buildHtml(file) {
  let html = fs.readFileSync(path.join(SRC, file), 'utf8');

  // Обфускира само вградените класически скриптове.
  html = html.replace(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) return m;
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) return m; // json и др.
    const isModule = /type\s*=\s*["']module/i.test(attrs);
    return `<script${attrs}>${obfuscate(body, isModule)}</script>`;
  });

  html = html.replace(/<head(\b[^>]*)>/i, (m) => m + metaTags);

  html = await minifyHtml(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false
  });

  // Авторската бележка — веднага след <!doctype>.
  html = html.replace(/^(<!doctype[^>]*>)/i, `$1\n${htmlBanner}`);
  fs.writeFileSync(path.join(OUT, file), html);
}

async function buildJs(file) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const isModule = /^\s*(import|export)\b/m.test(code);
  fs.writeFileSync(path.join(OUT, file), jsBanner + obfuscate(code, isModule));
}

async function buildCss(file) {
  const css = fs.readFileSync(path.join(SRC, file), 'utf8');
  // html-minifier минифицира CSS вътре в <style>; ползваме същото за .css файлове.
  const wrapped = await minifyHtml(`<style>${css}</style>`, { minifyCSS: true, collapseWhitespace: true });
  fs.writeFileSync(path.join(OUT, file), jsBanner + wrapped.replace(/^<style>|<\/style>$/g, ''));
}

async function buildServiceWorker() {
  const code = fs.readFileSync(path.join(SRC, 'service-worker.js'), 'utf8');
  const out = await terser(code, { compress: true, mangle: true, format: { comments: false } });
  fs.writeFileSync(path.join(OUT, 'service-worker.js'), jsBanner + out.code);
}

// ---------- Воден знак в иконите ----------
// PNG: добавя текстови полета (Author, Copyright) — невидими, картинката е същата.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function itxt(key, text) { // iTXt = UTF-8, за да се запази кирилицата
  return pngChunk('iTXt', Buffer.concat([
    Buffer.from(key, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, 'utf8')
  ]));
}
function watermarkPng(buf) {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // подпис + IHDR
  return Buffer.concat([
    buf.subarray(0, ihdrEnd),
    itxt('Author', 'Strahil Peev'),
    itxt('Copyright', COPYRIGHT),
    itxt('Comment', FINGERPRINT),
    buf.subarray(ihdrEnd)
  ]);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name), d = path.join(to, name);
    if (fs.statSync(s).isDirectory()) { copyDir(s, d); continue; }
    if (name.endsWith('.png')) {
      fs.writeFileSync(d, watermarkPng(fs.readFileSync(s)));
    } else if (name.endsWith('.svg')) {
      const svg = fs.readFileSync(s, 'utf8')
        .replace(/(<svg\b[^>]*>)/i, `$1<!-- ${COPYRIGHT} --><metadata>${FINGERPRINT}</metadata>`);
      fs.writeFileSync(d, svg);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Забранява вграждане в чужди сайтове (iframe) и кеширане на стари версии
// на HTML. Работи на Apache хостинг (tapnime.eu); GitHub Pages го игнорира.
const HTACCESS = `# ${COPYRIGHT}
<IfModule mod_headers.c>
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Content-Security-Policy "frame-ancestors 'self'"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  <FilesMatch "\\.(html|js|json)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
Options -Indexes
`;

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of HTML_FILES) { await buildHtml(f); console.log('✓', f); }
  for (const f of JS_FILES) { await buildJs(f); console.log('✓', f); }
  for (const f of CSS_FILES) { await buildCss(f); console.log('✓', f); }
  await buildServiceWorker(); console.log('✓ service-worker.js');
  for (const f of PLAIN_COPY) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  for (const d of fs.readdirSync(SRC)) { // папки с ресурси (icons/ и др.)
    if (['tools', 'dist', 'node_modules'].includes(d) || d.startsWith('.')) continue;
    if (fs.statSync(path.join(SRC, d)).isDirectory()) copyDir(path.join(SRC, d), path.join(OUT, d));
  }
  fs.writeFileSync(path.join(OUT, '.htaccess'), HTACCESS);
  fs.writeFileSync(path.join(OUT, 'COPYRIGHT.txt'), COPYRIGHT + '\n');
  console.log('\nГотово → dist/');
}

main().catch((e) => { console.error(e); process.exit(1); });
