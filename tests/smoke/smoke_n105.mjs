// smoke_n105.mjs — №105 Цвета доступности: DOM-стаб-прогон applyThemeColors + маркеры
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '  OK  ' : 'FAIL  ') + n + (c ? '' : ' ' + e)); if (!c) fails++; };

const js = readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const html = (await import('../../apps/overlay/dist/rendererHtml.js')).rendererHtml;

// Маркеры UI
for (const m of ['themeRow', 'setColBg', 'setColFg', 'setColDim', 'setColAccent', 'setColReset',
  '🎨 Цвета', 'Дальтонизм', 'Okabe-Ito', 'THEME_PRESETS', 'applyThemeColors', 'paintTheme', '№105'])
  ok('HTML marker: ' + m, html.includes(m));

// Маркеры main (валидация темы/цветов + push)
const main = readFileSync('apps/overlay/dist/main.js', 'utf8');
for (const m of ["'contrast'", "'cb'", "'custom'", 'HEX_RE', 'theme: settings.theme ??', "colors: settings.colors ??"])
  ok('main marker: ' + m, main.includes(m));

// DOM-стаб: вырезаем блок lastOpacity..paintTheme из скрипта и прогоняем.
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const s0 = script.indexOf('var lastOpacity = 0.86;');
const pth = script.indexOf('function paintTheme');
const s1 = script.indexOf('\n  }', pth) + 6;
ok('блок найден в скрипте', s0 >= 0 && pth > s0 && s1 > pth, `${s0}/${pth}/${s1}/${script.length}`);
const chunk = script.slice(s0, s1);
const vars = {};
const style = {
  setProperty(k, v) { vars[k] = v; },
  removeProperty(k) { delete vars[k]; },
};
const docStub = { documentElement: { style } };
const fn = new Function('document', chunk + '\nreturn applyThemeColors;')(docStub);

fn('contrast', null, 0.9);
ok('contrast: bg rgba(0,0,0,0.90)', vars['--bg'] === 'rgba(0,0,0,0.90)', vars['--bg']);
ok('contrast: fg white', vars['--fg'] === '#ffffff');
ok('contrast: ok #00e676', vars['--ok'] === '#00e676');

fn('cb', null, 0.5);
ok('cb: bg rgba(16,21,27,0.50)', vars['--bg'] === 'rgba(16,21,27,0.50)', vars['--bg']);
ok('cb: err #d55e00 (Okabe-Ito vermillion)', vars['--err'] === '#d55e00');
ok('cb: accent #56b4e9 (sky blue)', vars['--accent'] === '#56b4e9');
ok('cb: warn #f0e442 (yellow)', vars['--warn'] === '#f0e442');

fn('custom', { bg: '#112233', fg: '#eeeeee', dim: '#cccccc', accent: '#123456' }, 0.86);
ok('custom: bg hex+alpha', vars['--bg'] === 'rgba(17,34,51,0.86)', vars['--bg']);
ok('custom: fg', vars['--fg'] === '#eeeeee');
ok('custom: accent', vars['--accent'] === '#123456');
ok('custom: ок-цвета не переопределены темой', !vars['--ok']);

const before = Object.keys(vars).length;
fn('default', null, 0.86);
ok('default: все переменные сняты', Object.keys(vars).length === 0, JSON.stringify(vars));
ok('default: переменные were set до сброса', before > 0);

console.log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
