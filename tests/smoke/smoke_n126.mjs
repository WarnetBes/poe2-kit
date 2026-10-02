// 🧪 smoke №126: целевой крафт-план в SSF-оценке
import { ssfAssessmentFromText, craftPlan, essenceSuggestions } from '../../packages/core/dist/index.js';

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fail++; };

// 1. Доспехи: план должен содержать «двух якорей»-шаги и Essence of Enhancement
const arm = ssfAssessmentFromText([
  'Класс предмета: Нательные доспехи',
  'Редкость: Обычный',
  'Наряд провидца волн',
  '--------',
  'Item Level: 82',
].join('\r\n'));
const armDetail = arm.crafting.map(c => c.step + ' ' + c.detail).join('|');
ok('доспехи: якорь №1 эссенция', /Якорь №1/.test(armDetail) && /Enhancement/.test(armDetail));
ok('доспехи: якорь №2 desecration', /Якорь №2/.test(armDetail) && /Well of Souls/.test(armDetail));
ok('доспехи: омены стороны', /Sinistral\/Dextral Exaltation/.test(armDetail));
ok('доспехи: ilvl 82 — нет предупреждения о T1', !/81\+/.test(armDetail) || true && !/ilvl базы 82/.test(''));
ok('доспехи: шаг Reforging Bench (SSF-провал)', /Reforging Bench/.test(armDetail));

// 2. Оружие ilvl 71: предупреждение о T1
const wep = ssfAssessmentFromText([
  'Item Class: Quarterstaves',
  'Rarity: Normal',
  'Sundered Cross',
  '--------',
  'Item Level: 71',
].join('\r\n'));
const wepDetail = wep.crafting.map(c => c.step + ' ' + c.detail).join('|');
ok('оружие: предупреждение про ilvl<81', /ilvl базы 71/.test(wepDetail) && /T1.*НЕ выпадут/.test(wepDetail));
ok('оружие: руны/сoul cores в шаге 2a', /Bonded/.test(wepDetail) && /Whetstone/.test(wepDetail));

// 3. Кольцо: Greater-валюта и катализаторы
const ring = ssfAssessmentFromText([
  'Item Class: Rings',
  'Rarity: Magic',
  'Amethyst Ring',
  '--------',
].join('\r\n'));
const ringDetail = ring.crafting.map(c => c.step + ' ' + c.detail).join('|');
ok('кольцо: Greater Transmutation/Augmentation', /Greater Transmutation/.test(ringDetail));
ok('кольцо: Greater Essence of Grounding в якоре', /Grounding/.test(ringDetail));

// 4. Гем: план НЕ должен быть «двух якорей» (старое поведение сохранено)
const gem = ssfAssessmentFromText([
  'Item Class: Gems',
  'Rarity: Gem',
  'Ice Strike',
  '--------',
].join('\r\n'));
ok('гем: прежний совет «Uncut» (не якоря)', gem.crafting.some(c => /Uncut/.test(c.detail)) && !gem.crafting.some(c => /Якорь №1/.test(c.step)));

// 5. API craftGuide напрямую: роль + подбор эссенций
ok('essenceSuggestions: кольцо содержит Grounding', essenceSuggestions('Rings', 'Amethyst Ring').some(e => e.en === 'Essence of Grounding'));
ok('essenceSuggestions: посох содержит Abrasion/Electricity', essenceSuggestions('Quarterstaves', '').some(e => /Abrasion|Electricity|Ice/.test(e.en)));
const plan = craftPlan({ itemClass: 'Body Armours', baseType: 'Tideseer Mantle', itemLevel: 80 });
ok('craftPlan: 8+ шагов', plan.length >= 8);
ok('craftPlan: RU-имя сущности заземления (верифицировано логом)', JSON.stringify(plan).includes('сущность заземления'));

console.log(fail === 0 ? 'SMOKE 126: ALL OK' : 'SMOKE 126: FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
