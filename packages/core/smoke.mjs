// Smoke-тест против собранного dist (Node ESM, без сети).
import { decodeShareCode, encodeShareCode, PobCodeError } from './dist/build.js';
import { getLevelingPlan, getZonesByAct, levelDiff } from './dist/leveling.js';
import { inferUniqueCategory, mapItemClassToScoutCategory } from './dist/trade.js';
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

// PoB-аннотации: Rarity в верхнем регистре (UNIQUE/RARE/MAGIC) + строка "Unique ID:".
// Эти случаи должны разбираться так же, как и клир-текст из игры.
const pobUnique = [
  'Rarity: UNIQUE',
  'Darkness Enthroned',
  'Fine Belt',
  'Unique ID: 7d959b55872718b4dac67d7d3e686b7471446af3fc75ba626958af777d202cdb',
  'Item Level: 84',
].join('\n');
const parsedPobUnique = core.core.parse.parseItemText(pobUnique);
ok(parsedPobUnique.rarity === 'Unique', 'parse PoB: uppercase UNIQUE -> Unique');
ok(parsedPobUnique.name === 'Darkness Enthroned', 'parse PoB: unique name');
ok(parsedPobUnique.baseType === 'Fine Belt', 'parse PoB: unique baseType');

const pobMagic = [
  'Rarity: MAGIC',
  'Lustrous Stone Charm of the Medic',
  'Unique ID: ba005f96ec16f342cc046d9acf412995183d799eeaaa453c1a2b0f446565cd1c',
  'Item Level: 80',
].join('\n');
const parsedPobMagic = core.core.parse.parseItemText(pobMagic);
ok(parsedPobMagic.rarity === 'Magic', 'parse PoB: uppercase MAGIC -> Magic');
ok(
  !parsedPobMagic.baseType.startsWith('Unique ID:'),
  'parse PoB: magic base не равен строке "Unique ID:"',
);

console.log('unique category inference (inferUniqueCategory)');
const cases = [
  ['Mail Armour', 'body'],
  ['Leather Gloves', 'gloves'],
  ['Iron Greaves', 'boots'],
  ['Felled Axe', 'axes'],
  ['City Stalker Visor', 'helmets'],
  ['Plated Maul', 'maces'],
  ['Siege Crossbow', 'crossbows'],
  ['Primordial Staff', 'staves'],
  ['Spiral Glass Ring', 'rings'],
  ['Steel Amber Belt', 'belts'],
  ['Wraithwrap', null], // не распознаётся → null (не «тело/броня» по ошибке)
];
for (const [base, expected] of cases) {
  ok(inferUniqueCategory(base) === expected, `infer('${base}') = ${expected}`);
}
ok(inferUniqueCategory(null) === null, 'infer(null) = null');
ok(inferUniqueCategory('Mail Armour', 'Boots') === 'boots', 'inner itemClass приоритетнее baseType');
ok(mapItemClassToScoutCategory('Boots') === 'boots', 'mapItemClass boots');
ok(mapItemClassToScoutCategory('Body Armour') === 'body', 'mapItemClass body');
ok(mapItemClassToScoutCategory('Unknown') === null, 'mapItemClass unknown = null');

console.log('build gear extraction (PoB XML, без сети)');
const pobXml = `<?xml version="1.0"?><PathOfBuilding><Build level="20" className="Monk" ascendClassName="Invoker"/>
<Items activeItemSet="1">
  <ItemSet id="1">
    <Slot name="Weapon 1" itemId="1"/>
    <Slot name="Body" itemId="2"/>
    <Slot name="Ring 1" itemId="3"/>
  </ItemSet>
</Items>
<Item id="1">Rarity: UNIQUE
Darkness Enthroned
Fine Belt
Unique ID: abc
Item Level: 84</Item>
<Item id="2">Rarity: RARE
Victory Cloak
Sleek Jacket
Item Level: 80</Item>
<Item id="3">Rarity: UNIQUE
Saitha's Spear
Barbed Spear
Item Level: 75</Item>
</PathOfBuilding>`;
const gear = await core.core.build.buildCodeToGear(pobXml);
ok(gear.length === 3, `buildCodeToGear извлекает ${gear.length} предмета`);
ok(gear[0]?.slot === 'Weapon 1' && gear[0]?.name === 'Darkness Enthroned', 'gear slot+name (item 1)');
ok(gear[0]?.itemText.includes('Rarity: UNIQUE'), 'gear itemText содержит Rarity');
ok(gear[1]?.name === 'Victory Cloak', 'gear item 2 name');
ok(gear[2]?.slot === 'Ring 1' && gear[2]?.name === "Saitha's Spear", 'gear item 3 slot+name');

console.log('build gear extraction (.build JSON — только уники по имени)');
const buildJson = JSON.stringify({
  inventory_slots: [
    { inventory_id: 'Belt1', unique_name: 'Headhunter' },
    { inventory_id: 'Weapon1', name: 'Sinister Quarterstaff' },
  ],
});
const jsonGear = await core.core.build.buildCodeToGear(buildJson);
ok(jsonGear.length === 1, `из .build JSON извлечён 1 уникальный (${jsonGear.length})`);
ok(jsonGear[0]?.name === 'Headhunter' && jsonGear[0]?.slot === 'Belt1', '.build JSON unique slot+name');
ok(jsonGear[0]?.itemText.includes('Rarity: Unique'), '.build JSON itemText формат');

console.log('log parser (Client.txt)');
const { decodeZoneCode, parseLogLine, hasSubstantialLogData, getClientState } = core;
const dz = decodeZoneCode('G1_town');
ok(dz?.act === 1 && dz?.englishName === 'Clearfell Encampment' && dz?.description.includes('Town'), 'decodeZoneCode G1_town');
const dz3 = decodeZoneCode('G3_10_Airlock');
ok(dz3?.act === 3 && dz3?.areaIndex === 10 && dz3?.suffix === 'Airlock' && dz3?.englishName === 'Temple of Chaos (Entrance)', 'decodeZoneCode G3_10_Airlock');
ok(decodeZoneCode('zzz') === null, 'decodeZoneCode rejects unknown');
ok(core.ZONE_NAMES === undefined || typeof core.ZONE_NAMES === 'object', 'module importable');

const evLvlUp = parseLogLine('2026/06/04 10:51:25 77406656 3ef23347 [INFO Client 29396] : TomawarTheSeventh (Infernalist) is now level 66');
ok(evLvlUp?.kind === 'level_up' && evLvlUp?.character === 'TomawarTheSeventh' && evLvlUp?.klass === 'Infernalist' && evLvlUp?.level === 66, 'parseLogLine level_up');
const evZone = parseLogLine('2026/06/04 10:52:01 77410000 3ef23348 [INFO Client 29396] Generating level 62 area "P2_1" with seed 3720906296');
ok(evZone?.kind === 'area_change' && evZone?.areaCode === 'P2_1' && evZone?.areaLevel === 62 && evZone?.seed === 3720906296, 'parseLogLine area_change');
const evDeath = parseLogLine('2026/06/04 11:00:00 77420000 3ef23349 [INFO Client 29396] : TomawarTheSeventh has been slain.');
ok(evDeath?.kind === 'death' && evDeath?.character === 'TomawarTheSeventh', 'parseLogLine death');
const evAfk = parseLogLine('2026/06/04 11:01:00 77430000 3ef2334a [INFO Client 29396] : AFK mode is now ON.');
ok(evAfk?.kind === 'afk' && evAfk?.afkState === 'ON', 'parseLogLine afk');
const evConn = parseLogLine('2026/06/04 11:01:05 77431000 3ef2334b [INFO Client 29396] Connecting to instance server at 64.87.33.204:21360');
ok(evConn?.kind === 'instance_connect' && evConn?.server === '64.87.33.204:21360', 'parseLogLine instance_connect');
ok(parseLogLine('garbage line without prefix') === null, 'parseLogLine rejects garbage');

// getClientState по синтетическому файлу-логу
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tmpDir = mkdtempSync(join(tmpdir(), 'poe2k-log-'));
const tmpLog = join(tmpDir, 'Client.txt');
writeFileSync(tmpLog, [
  '2026/06/04 10:50:00 77400000 3ef23340 [INFO Client 29396] ***** LOG FILE OPENING *****',
  '2026/06/04 10:51:25 77406656 3ef23347 [INFO Client 29396] : TomawarTheSeventh (Infernalist) is now level 66',
  '2026/06/04 10:52:01 77410000 3ef23348 [INFO Client 29396] Generating level 62 area "P2_1" with seed 3720906296',
  '2026/06/04 10:55:00 77415000 3ef2334c [INFO Client 29396] Connecting to instance server at 64.87.33.204:21360',
  '2026/06/04 11:00:00 77420000 3ef23349 [INFO Client 29396] : TomawarTheSeventh has been slain.',
  '2026/06/04 11:01:00 77430000 3ef2334a [INFO Client 29396] : AFK mode is now OFF.',
].join('\r\n') + '\r\n');
const st = getClientState({ logPath: tmpLog });
ok(st.available === true, 'getClientState available on synthetic log');
ok(st.character === 'TomawarTheSeventh' && st.klass === 'Infernalist' && st.level === 66, 'state character/class/level');
ok(st.zone?.areaCode === 'P2_1' && st.zone?.areaLevel === 62, 'state last zone');
ok(st.deathsInWindow === 1, 'state deaths counted');
ok(st.afk === false, 'state afk false');
ok(st.instanceServer === '64.87.33.204:21360', 'state instance server');
ok(hasSubstantialLogData(st) === true, 'hasSubstantialLogData true');
const stMissing = getClientState({ logPath: join(tmpDir, 'nope.txt') });
ok(stMissing.available === false && !!stMissing.reason, 'missing log -> available false + reason');
rmSync(tmpDir, { recursive: true, force: true });

console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);