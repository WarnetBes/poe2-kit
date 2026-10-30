// tests/smoke/smoke_w44_ru.mjs — №693-грабля: RU-формы статов нельзя угадывать —
// только канон ExE2-датасета (packages/core/data/game/i18n/mods_ru.json — тот же
// MIT-источник, что питает parse-слой кита).
//
// Проверка: для ключевых статов берём КАНОНИЧЕСКУЮ RU-строку датасета («# к
// уклонению», «# к максимуму здоровья», …), рендерим как клиент (плоский мод
// получает «+», см. фикстуры xiletrade: «+40 к максимуму здоровья») и прогоняем
// через три слоя (dist): modsToStatFilters (stat-id), suggestGearFocus (kind),
// gearScoreItem (contribution). В gearscore-профиле важность per-slot: MS
// считается только на Boots, Spirit на Body/Amulet/Weapon — смок проверяет
// стат на том слоте, где он по профилю валиден.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const coreDist = path.join(root, 'packages/core/dist/index.js');
const ruMods = JSON.parse(readFileSync(path.join(root, 'packages/core/data/game/i18n/mods_ru.json'), 'utf8'));

// en (канон датасета) → ожидания: stat-id trade-слоя, kind autoWeights,
// label gearscore + слот, на котором профиль его засчитывает.
const SPECS = [
  { en: '# to maximum Life',           stat: 'pseudo.pseudo_total_life', kind: 'life',     label: 'Life',            slot: 'Rings' },
  { en: '# to maximum Energy Shield',  stat: 'pseudo.pseudo_total_energy_shield', kind: 'es', label: 'Energy Shield', slot: 'Rings' },
  { en: '# to Evasion Rating',         stat: 'explicit.stat_2144192055', kind: 'evasion',   label: 'Evasion',         slot: 'Rings' },
  { en: '# to Armour',                 stat: 'explicit.stat_809229260',  kind: 'armour',     label: null,              slot: 'Rings' }, // flat armour on jewelry не роллится (живой факт: 0 листингов) — gearscore вклад не ждём
  { en: '# to Spirit',                 stat: 'explicit.stat_3981240776', kind: 'spirit',    label: 'Spirit',          slot: 'Amulets' },
  { en: '#% to Fire Resistance',       stat: 'pseudo.pseudo_total_fire_resistance', kind: 'fres', label: 'Fire res',       slot: 'Rings' },
  { en: '#% to Cold Resistance',       stat: 'pseudo.pseudo_total_cold_resistance', kind: 'cres', label: 'Cold res',       slot: 'Rings' },
  { en: '#% to Lightning Resistance',  stat: 'pseudo.pseudo_total_lightning_resistance', kind: 'lres', label: 'Lightning res',  slot: 'Rings' },
  { en: '#% to Chaos Resistance',      stat: 'pseudo.pseudo_total_chaos_resistance', kind: 'chaores', label: 'Chaos res',      slot: 'Rings' },
  { en: '# to Strength',               stat: 'pseudo.pseudo_total_strength', kind: 'str',   label: 'Str/Dex/Int',     slot: 'Rings' },
  { en: '# to Dexterity',              stat: 'pseudo.pseudo_total_dexterity', kind: 'dex',   label: 'Str/Dex/Int',     slot: 'Rings' },
  { en: '# to Intelligence',           stat: 'pseudo.pseudo_total_intelligence', kind: 'int', label: 'Str/Dex/Int',    slot: 'Rings' },
  { en: '#% increased Movement Speed', stat: 'explicit.stat_2250533757', kind: 'ms',       label: 'Movement speed',  slot: 'Boots' },
  // №696 P2-8: rarity (EN-канон первый в датасете = «повышение … найденных»);
  // kind: null — autoWeights rarity не классифицирует (вне trade-приоритетов).
  { en: '#% increased Rarity of Items found', stat: 'explicit.stat_3917489142', kind: null, label: 'Rarity', slot: 'Rings' },
];

const canonOf = (en) => {
  const hit = ruMods.mods.find((m) => m.en === en);
  return hit ? hit.ru.replace(/^Всего /, '') : null;
};

// Рендер как клиент: плоские моды с «+» (факт xiletrade-фикстур), проценты — без.
const render = (ru) => {
  if (/^#%/.test(ru)) return ru.replace(/^#%/, '40%');
  return ru.replace(/^#/, '+40'); // «# к уклонению» → «+40 к уклонению»
};

const RUNTIME = String.raw`
const SPECS = JSON.parse(process.env.SPECS);
const core = await import(process.env.CORE);

let failures = 0;
const ok = (cond, name) => { console.log((cond ? '  [ok]  ' : '  [FAIL] ') + name); if (!cond) failures++; };

for (const s of SPECS) {
  const modText = s.ru; // уже отрендерено в родителе (+40 / 40%)
  const itemText = ['Item Class: ' + s.slot, 'Rarity: RARE', 'Xx', s.slot === 'Boots' ? 'Sinner Trample' : 'Iron Ring', '--------', modText].join('\n');
  const tag = s.en + ' | RU: «' + modText + '»';
  // (1) trade-слой: RU-текст → stat-id
  const f = core.modsToStatFilters([modText]);
  ok(f.some(x => x.id === s.stat), 'trade->stat-id: ' + tag);
  // (2) autoWeights: RU-текст → kind (слот любой — важности per-kind);
  // kind: null — autoWeights этот стат не классифицирует, слой пропускаем.
  if (s.kind) {
    const focus = core.suggestGearFocus([itemText]);
    ok(focus.some(x => x.kind === s.kind), 'autoWeights->kind: ' + tag);
  }
  // (3) gearscore: RU-текст → вклад на слоте, где профиль валиден
  if (s.label) {
    const g = core.gearScoreItem(itemText);
    ok(g.contributions.some(c => c.label === s.label), 'gearscore->' + s.slot + ': ' + tag);
  }
}
console.log(failures === 0 ? 'PASS  smoke_w44_ru.mjs' : 'FAIL  smoke_w44_ru.mjs (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
`;

const specs = SPECS.map((s) => {
  const ru = canonOf(s.en);
  return { ...s, ru: ru ? render(ru) : null };
}).filter((s) => s.ru);

// №695-ревью P2-6: гейт против ложнозелёного — деградация mods_ru.json не должна
// превращать смок в «PASS с 0 проверок».
if (specs.length < 10) {
  console.error(`[FAIL] канонов найдено ${specs.length}/13 — датасет mods_ru.json деградировал?`);
  process.exit(1);
}
console.log('канонов найдено:', specs.length, '/', SPECS.length);
const child = spawnSync(process.execPath, ['--input-type=module', '-e', RUNTIME], {
  env: { ...process.env, CORE: pathToFileURL(coreDist).href, SPECS: JSON.stringify(specs) },
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'inherit'],
});
process.exit(child.status ?? 1);
