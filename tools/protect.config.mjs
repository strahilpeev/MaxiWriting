// Настройки на защитата. Тук се редактира, не в build.mjs.

// Домейни, на които приложението има право да работи.
// Ако го качите на нов адрес, добавете го тук и пуснете build отново.
export const ALLOWED_HOSTS = [
  'tapnime.eu',
  'www.tapnime.eu',
  'strahilpeev.github.io',
  'localhost',
  '127.0.0.1'
];

// Къде да отиде човек, ако отвори копие на чужд сайт.
export const OFFICIAL_URL = 'https://tapnime.eu/';

export const OWNER = 'Strahil Peev';
export const YEAR = new Date().getFullYear();
export const COPYRIGHT =
  `© ${YEAR} ${OWNER} — tapnime.eu. Всички права запазени. ` +
  `Копиране, промяна и разпространение без писмено разрешение е забранено.`;

// Невидим отпечатък — уникален низ, който доказва произхода на кода,
// ако се появи копие някъде другаде. Не го споделяйте.
export const FINGERPRINT = 'MXW-SP-7f3c9a21';

// Умерена обфускация: прави кода нечетим, без да забавя таблета
// и без да пипа имената, които HTML бутоните (onclick="...") използват.
export const OBFUSCATOR_OPTIONS = {
  compact: true,
  target: 'browser',
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: false,
  transformObjectKeys: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  // Изключени нарочно — забавят или могат да счупят нещо на стари таблети:
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false
};
