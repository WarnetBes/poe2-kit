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

console.log('estimate: PoE2 defense formulas (портировано из hivemind-калькуляторов)');
const { armorDr, hitChance, armorNeededForDr, calculateEhp, mergeGearDefenses, estimateBuild } = core;
ok(Math.abs(armorDr(9000, 1000) - 47.368) < 0.01, `armorDr 9000 vs 1000-hit = ${armorDr(9000, 1000).toFixed(1)}%`);
ok(armorDr(999999, 100) <= 90, 'armorDr capped at 90');
ok(armorDr(0, 1000) === 0, 'armorDr zero armor');
ok(hitChance(0, 2000) === 100, 'hitChance no evasion = 100%');
ok(hitChance(999999, 2000) === 5, 'hitChance capped min 5%');
ok(Math.abs(armorNeededForDr(50, 1000) - 10000) < 0.01, 'armorNeededForDr 50% vs 1000 = 10k');

const estGear = [
  { slot: 'Body Armour', name: 'Test Plate', itemText: [
    'Rarity: Rare', 'Test Plate', 'Plate Armour', '--------',
    'Armour: 900', '--------',
    '+100 to maximum Life', '+30% to Fire Resistance', '15% increased maximum Life',
  ].join('\n') },
  { slot: 'Boots', name: 'Test Boots', itemText: [
    'Rarity: Rare', 'Test Boots', 'Leather Boots', '--------',
    'Evasion Rating: 300', '--------',
    '+50 to maximum Life', '+12% to Lightning Resistance',
  ].join('\n') },
];
const estDef = mergeGearDefenses(estGear);
ok(estDef.life === 172.5, `def flat life (+100, +50) + 15% → ${estDef.life}`);
ok(estDef.armour === 900, 'def armour 900');
ok(estDef.evasion === 300, 'def evasion 300');
ok(estDef.fireRes === 30 && estDef.lightningRes === 12, 'def resists fire30/light12');

const physEhp = calculateEhp(estDef, 'physical');
ok(physEhp.effectiveHp > estDef.life, 'physical EHP > life (armor+evasion layers)');
const chaosEhp = calculateEhp(estDef, 'chaos');
ok(chaosEhp.rawHp === estDef.life, 'chaos rawHp excludes ES (no ES in gear) and chaos res 0 → mitigation 0');
const chaosNeg = calculateEhp({ ...estDef, chaosRes: -30 }, 'chaos');
ok(chaosNeg.effectiveHp < chaosEhp.effectiveHp, 'negative chaos res amplifies damage (EHP lower)');

const estPobXml = `<?xml version="1.0"?><PathOfBuilding><Build level="70" className="Monk" ascendClassName="Invoker"/><PlayerStat stat="AverageDamage" value="145162.34"/>
<Items><ItemSet><Slot name="Body Armour" itemId="1"/><Slot name="Weapon 1" itemId="2"/><Slot name="Ring 1" itemId="3"/></ItemSet>
<Item id="1">Rarity: RARE\nTest Plate\nPlate Armour\nArmour: 900\n+100 to maximum Life\n+30% to Fire Resistance</Item>
<Item id="2">Rarity: RARE\nTest Staff\nStaff\nPhysical Damage: 40-60\nAttacks per Second: 1.20\n+80 to maximum Life</Item>
<Item id="3">Rarity: RARE\nTest Ring\nRuby Ring\n+20 to maximum Life\n+10% to Fire Resistance</Item></Items></PathOfBuilding>`;
const est = await estimateBuild(estPobXml);
ok(est.source === 'pob+gear', 'estimateBuild source pob+gear (PlayerStat found)');
ok(est.characterLevel === 70 && est.className === 'Monk' && est.ascendancy === 'Invoker', 'estimateBuild build tag parsed');
ok(est.pobStats['AverageDamage'] === 145162.34, 'estimateBuild pobStats captured');
ok(est.defenses.fireRes === 40, `estimateBuild gear resists summed (fire=${est.defenses.fireRes})`);
ok(est.weapon.weapon !== null && est.weapon.physDps > 0, `estimateBuild weaponDps (${est.weapon.totalDps})`);
ok(est.gaps.length > 0 && est.gaps[0].severity >= est.gaps[est.gaps.length-1].severity, `estimateBuild gaps sorted (${est.gaps.length})`);
ok(est.notes.length >= 2, 'estimateBuild honest notes');

console.log('trade query builder (trade2)');
const { buildTradeQuery, buildTradeQueryFromItem, modsToStatFilters, TRADE_CATEGORY_MAP } = core;
const q1 = buildTradeQuery({ type: 'ring', stats: [{ id: 'pseudo.pseudo_total_life', min: 60 }], priceMax: 50 });
ok(q1.query.filters?.type_filters?.filters?.category?.option === 'accessory.ring', 'buildTradeQuery category ring');
ok(q1.query.stats?.[0]?.filters[0].id === 'pseudo.pseudo_total_life' && q1.query.stats[0].filters[0].value?.min === 60, 'buildTradeQuery stat filter');
ok(q1.query.filters?.trade_filters?.filters?.price?.max === 50, 'buildTradeQuery price max');
ok(q1.sort?.price === 'asc', 'buildTradeQuery sort asc');
const q2 = buildTradeQuery({ type: 'Sleek Jacket', rarity: 'rare' });
ok(q2.query.type === 'Sleek Jacket', 'buildTradeQuery unknown type → type string');
const st1 = modsToStatFilters(['+62 to maximum Life', '+30% to Fire Resistance', 'this is unknown mod']);
ok(st1.length === 2 && st1.some((s) => s.id === 'pseudo.pseudo_total_life' && s.min === 62) && st1.some((s) => s.id === 'pseudo.pseudo_total_fire_resistance' && s.min === 30), 'modsToStatFilters maps life+fire res, skips unknown');
const tqItem = buildTradeQueryFromItem([
  'Rarity: Rare', 'Test Ring', 'Ruby Ring', '--------', 'Ring', '--------',
  '+62 to maximum Life', '+30% to Fire Resistance',
].join('\n'));
ok(tqItem.query.type === 'Ruby Ring', 'buildTradeQueryFromItem baseType');
ok((tqItem.query.stats?.[0]?.filters ?? []).length === 2, 'buildTradeQueryFromItem mods→stats');

console.log('offline datasets (data/game)');
const { getDatasetVersion, getAscendanciesByClass, searchSkillGems, getSkillGemDetails, searchPassiveTree, searchBaseItems, getStatIds } = core;
const ver = getDatasetVersion();
ok(ver.patch_version === '0.5' && ver.data_revision >= 12, `dataset version ${ver.released_as}`);
const monkAsc = getAscendanciesByClass('Monk');
ok(monkAsc.some((a) => a.displayName === 'Invoker'), 'ascendancies: Monk→Invoker');
const ice = searchSkillGems('Ice Strike');
ok(ice.length >= 1 && ice[0].name === 'Ice Strike', 'gems: Ice Strike found');
const iceDet = getSkillGemDetails('Ice Strike');
ok(!!iceDet && iceDet.levels.length > 5 && iceDet.firstLevelCost && 'Mana' in iceDet.firstLevelCost, `gems: Ice Strike levels=${iceDet?.levels.length}, mana=${iceDet?.firstLevelCost?.Mana}`);
const ks = searchPassiveTree('Shockproof');
ok(ks.length >= 1 && ks[0].isNotable && ks[0].stats.some((s) => s.includes('Shock')), `tree: "Shockproof" notable → ${ks.length} nodes`);
const byStat = searchPassiveTree('increased chance to Shock', { limit: 5 });
ok(byStat.length >= 1 && byStat.some((n) => n.stats.join(' ').includes('chance to Shock')), 'tree: search by stat text');
const ring = searchBaseItems('Ruby Ring');
ok(ring.length >= 1 && ring.some((b) => b.name === 'Ruby Ring'), 'base_items: Ruby Ring found');
ok(getStatIds().length > 20000, `stats: ${getStatIds().length} stat ids`);

console.log('poe2db.tw service (scraper)');
const { normalizeTrailingArabicToRoman, parsePoe2dbHtml } = core;
ok(normalizeTrailingArabicToRoman('Urgent_Totems_2') === 'Urgent_Totems_II', 'poe2db: arabic→roman slug');
ok(normalizeTrailingArabicToRoman('Ice_Strike') === 'Ice_Strike', 'poe2db: slug unchanged without numeral');
const fakeHtml = [
  '<html><head><meta property="og:title" content="Ice Strike"><meta property="og:description" content="Ice Strike is a skill gem."></head>',
  '<body><div class="gemPopup"><span class="property">Attack, Melee, Cold</span><span class="explicitMod">Deals 1.65x base damage</span></div>',
  '<div class="card-header">Recommended Support Gems /29</div><div class="table-responsive"><table><tr><th>Gem</th></tr><tr><td>Fanatical Charge</td></tr></table></div>',
  '<div class="card-header">Level Effect /40</div>',
  '</body></html>',
].join('');
const parsed = parsePoe2dbHtml(fakeHtml);
ok(parsed.title === 'Ice Strike', 'poe2db: parse title');
ok(parsed.description.includes('skill gem'), 'poe2db: parse description');
ok(parsed.stats.includes('Melee'), 'poe2db: parse stats');
ok(parsed.sections.get('supports')?.content.includes('Fanatical Charge') && parsed.sections.get('supports')?.itemCount === 29, 'poe2db: parse supports section');

console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);