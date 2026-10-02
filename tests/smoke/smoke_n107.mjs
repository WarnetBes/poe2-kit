// №107-смок: alpha-ReferenceError в rendererHtml — регресс-проверка
import { readFileSync } from 'node:fs';
let fail = 0;
const html = readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const renderer = readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');

// 1. Баг-паттерн `opacity: alpha` отсутствует в dist
if (/opacity:\s*alpha\s*,/.test(html)) {
  console.log('FAIL 1: opacity: alpha остался в dist renderer');
  fail++;
} else console.log('OK 1: баг-паттерн отсутствует в dist');

// 2. В исходнике fixes-строка на месте
if (!/opacity: \(typeof s\.opacity === 'number' \? s\.opacity : 0\.86\)/.test(renderer)) {
  console.log('FAIL 2: фикс-строка не найдена в rendererHtml.ts');
  fail++;
} else console.log('OK 2: фикс-строка в исходнике');

// 3. hexToRgba(alpha) не тронута (параметр — легитимный)
if (!/function hexToRgba\(hex, alpha\)/.test(renderer)) {
  console.log('FAIL 3: hexToRgba повреждена');
  fail++;
} else console.log('OK 3: hexToRgba не тронута');

// 4. В вызове buildSettingsPanel из settings:display нет голого alpha-идентификатора
// (комментарии вырезаем — там слово alpha упомянуто в описании фикса)
const m = html.match(/buildSettingsPanel\(\{[\s\S]{0,500}?\}\);/);
const mNoComments = m ? m[0].replace(/^[ \t]*\/\/.*$/gm, '') : '';
if (m && /\balpha\b/.test(mNoComments)) {
  console.log('FAIL 4: alpha остался в вызове buildSettingsPanel: ' + mNoComments.slice(0, 200));
  fail++;
} else console.log('OK 4: вызов buildSettingsPanel чист');

// 5. Защита от обратного: typeof-паттерн присутствует в dist трижды
// (стартовая загрузка темы + settings:display + сам фикс)
const n = (html.match(/typeof s\.opacity === 'number' \? s\.opacity : 0\.86/g) || []).length;
if (n !== 3) {
  console.log('FAIL 5: typeof s.opacity в dist встречается ' + n + ' раз (ожидалось 3)');
  fail++;
} else console.log('OK 5: typeof s.opacity в dist ×3 (старт + display + фикс)');

console.log(fail === 0 ? 'ALL OK' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
