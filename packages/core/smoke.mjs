// Smoke-тест против собранного dist (Node ESM, без сети).
import { decodeShareCode, encodeShareCode, PobCodeError } from './dist/build.js';
import { getLevelingPlan, getZonesByAct, levelDiff } from './dist/leveling.js';
import * as core from './dist/index.js';

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg); failed++; }
};

console.log('plan: zones by act distributed 1-4');
const plan = getLevelingPlan();
ok(plan.length > 40, `many zones (${plan.length})`);
ok(JSON.stringify([...new Set(plan.map(z => z.act))].sort()) === '[1,2,3,4]', 'acts 1-4 present');
ok(plan[0].monsterLevel < plan[plan.length-1].monsterLevel, 'monster level rises');
ok(getZonesByAct(1).length > 10, 'act1 zones');
ok(levelDiff(5, getZonesByAct(1)[0]) === 5 - getZonesByAct(1)[0].monsterLevel, 'levelDiff');

console.log('PoB roundtrip');
const xml = `<?xml version="1.0"?><PathOfBuilding><Build level="20"/></PathOfBuilding>`;
const decoded = decodeShareCode(encodeShareCode(xml));
ok(decoded.includes('PathOfBuilding'), 'roundtrip decode/includes PathOfBuilding');

console.log('PobCodeError handling');
let threw = false;
try { decodeShareCode(''); } catch(e){ threw = e instanceof PobCodeError; }
ok(threw, 'empty code throws PobCodeError');

console.log('root exports');
ok(core.core.trade && core.core.build && core.core.leveling && core.core.repoe && core.core.ai, 'root exports all');

console.log('item parser');
const uniqueText = [
  'Rarity: Unique',
  'Brutal Grenaade',
  'Mace',
  '--------',
  'Weapon: Mace',
  'Physical Damage: 12-22',
  'Critical Strike Chance: 6.00%',
  'Attacks per Second: 1.20',
  '--------',
  'Requires Level 35, 57 Str',
  '--------',
  'Adds 2 to 5 Fire Damage',
  'Adds 10 to 20 Physical Damage',
].join('\n');
const parsedUnique = core.core.parse.parseItemText(uniqueText);
ok(parsedUnique.rarity === 'Unique', 'parse: rarity Unique');
ok(parsedUnique.name === 'Brutal Grenaade', 'parse: name');
ok(parsedUnique.baseType === 'Mace', 'parse: baseType');
ok(parsedUnique.offense.physicalDamage?.min === 12, 'parse: phys dmg min');
ok(parsedUnique.mods.some(m => m.text.includes('Fire Damage')), 'parse: fire mod captured');
ok(parsedUnique.itemLevel === null, 'parse: no item level present');

const rareWithLevel = [
  'Rarity: Rare',
  'Storm Warden',
  'Leather Gloves',
  '--------',
  'Quality: +20%',
  'Armour: 42',
  '--------',
  'Item Level: 68',
  '--------',
  'Requires Level 52, 40 Dex',
  '--------',
  '+45 to Strength (implicit)',
  'Adds 3 to 8 Cold Damage',
  '+20% to Fire Resistance',
].join('\n');
const parsedRare = core.core.parse.parseItemText(rareWithLevel);
ok(parsedRare.rarity === 'Rare', 'parse rare: rarity');
ok(parsedRare.quality?.value === 20, 'parse rare: quality 20');
ok(parsedRare.itemLevel === 68, 'parse rare: item level 68');
ok(parsedRare.defences.armour?.value === 42, 'parse rare: armour 42');
ok(parsedRare.mods.some(m => m.type === 'implicit' && m.text.includes('Strength')), 'parse rare: implicit mod');
ok(parsedRare.mods.some(m => m.type === 'explicit' && m.text.includes('Resistance')), 'parse rare: explicit mod');

console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);