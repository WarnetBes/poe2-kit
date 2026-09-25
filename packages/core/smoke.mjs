// Smoke-С‚РµСЃС‚ РїСЂРѕС‚РёРІ СЃРѕР±СЂР°РЅРЅРѕРіРѕ dist (Node ESM, Р±РµР· СЃРµС‚Рё).
import { decodeShareCode, encodeShareCode, PobCodeError, importBuild } from './dist/build.js';
import { getLevelingPlan, getZonesByAct, levelDiff } from './dist/leveling.js';
import { getMonkLevelingTips, getMonkLevelingHint, getMonkLevelingPlan } from './dist/leveling.js';
import { inferUniqueCategory, mapItemClassToScoutCategory } from './dist/trade.js';
import * as core from './dist/index.js';

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  вњ“', msg);
  else { console.error('  вњ—', msg); failed++; }
};

console.log('plan: zones by act distributed 1-4');
const plan = getLevelingPlan();
ok(plan.length > 40, `many zones (${plan.length})`);
ok(JSON.stringify([...new Set(plan.map(z => z.act))].sort()) === '[1,2,3,4]', 'acts 1-4 present');
ok(plan[0].monsterLevel < plan[plan.length-1].monsterLevel, 'monster level rises');
ok(getZonesByAct(1).length > 10, 'act1 zones');
ok(levelDiff(5, getZonesByAct(1)[0]) === 5 - getZonesByAct(1)[0].monsterLevel, 'levelDiff');

console.log('Ice Strike Monk guide');
  ok(getMonkLevelingTips().length >= 4, 'monk tips: 4+ ranges');
  ok(getMonkLevelingTips(30).some((t) => t.fromLevel <= 30 && (t.toLevel == null || t.toLevel >= 30)), 'monk tips: lvl30 matched');
  ok(getMonkLevelingHint(1).includes('Ice Strike'), 'monk hint: Ice Strike present at lvl1');
  ok(getMonkLevelingPlan().length === getLevelingPlan().length, 'monk plan: same zone count');
  ok(getMonkLevelingPlan().some((z) => z.steps.some((s) => s.includes('Ice Strike Monk'))), 'monk plan: enriched steps');

console.log('PoB roundtrip');
const xml = `<?xml version="1.0"?><PathOfBuilding><Build level="20"/></PathOfBuilding>`;
const decoded = decodeShareCode(encodeShareCode(xml));
ok(decoded.includes('PathOfBuilding'), 'roundtrip decode/includes PathOfBuilding');

console.log('PobCodeError handling');
let threw = false;
try { decodeShareCode(''); } catch(e){ threw = e instanceof PobCodeError; }
ok(threw, 'empty code throws PobCodeError');

console.log('PoB2 XML import: skill groups / buffs / config / notes (docs/POB2_XML_REFERENCE.md)');
const pob2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
\t<Build level="95" className="Monk" ascendClassName="Invoker" mainSocketGroup="2">
\t\t<PlayerStat stat="Life" value="1"/>
\t\t<Buffs buffList="Herald of Ice,Precision" combatList="" curseList="Temporal Chains"/>
\t</Build>
\t<Skills activeSkillSet="1">
\t\t<SkillSet id="1" title="Default">
\t\t\t<Skill enabled="true" label="Ice Strike" mainActiveSkillCalcs="1" source="Item:Weapon 1">
\t\t\t\t<Gem nameSpec="Ice Strike" level="21" quality="20" enabled="true" count="1"/>
\t\t\t\t<Gem nameSpec="Rapid Attacks II" level="5" quality="0" enabled="true" count="1"/>
\t\t\t</Skill>
\t\t\t<Skill enabled="true" label="Herald of Ice" source="Item:Body Armour">
\t\t\t\t<Gem nameSpec="Herald of Ice" level="20" quality="0" enabled="true" count="1"/>
\t\t\t</Skill>
\t\t</SkillSet>
\t</Skills>
\t<Config activeConfigSet="1">
\t\t<ConfigSet id="1" title="Bossing">
\t\t\t<Input name="enemyIsBoss" string="Pinnacle"/>
\t\t\t<Input name="enemyLevel" number="84"/>
\t\t</ConfigSet>
\t</Config>
\t<Notes>CI билд, приоритет — резисты.</Notes>
</PathOfBuilding2>`;
const imp = await importBuild(pob2Xml);
ok(imp.level === 95 && imp.class === 'Monk' && imp.ascendancy === 'Invoker', 'PoB2: Build level/class/asc');
ok(imp.skillGroups?.length === 2, `PoB2: skill groups = ${imp.skillGroups?.length}`);
ok(imp.skillGroups?.[1]?.main === true && imp.skillGroups?.[1]?.gems[0]?.name === 'Herald of Ice', 'PoB2: main group = Herald of Ice (mainSocketGroup=2)');
ok(imp.skillGroups?.[0]?.gems[0]?.name === 'Ice Strike' && imp.skillGroups?.[0]?.gems[0]?.level === 21 && imp.skillGroups?.[0]?.gems[1]?.name === 'Rapid Attacks II', 'PoB2: первая группа — Ice Strike L21 + support');
ok(imp.buffs?.buffList.join(',') === 'Herald of Ice,Precision' && imp.buffs?.curseList[0] === 'Temporal Chains', 'PoB2: buffs/curse lists');
ok(imp.config?.enemyIsBoss === 'Pinnacle' && imp.config?.enemyLevel === '84', 'PoB2: config inputs (boss/level)');
ok((imp.notes ?? '').includes('CI '), 'PoB2: notes');

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

// PoB-Р°РЅРЅРѕС‚Р°С†РёРё: Rarity РІ РІРµСЂС…РЅРµРј СЂРµРіРёСЃС‚СЂРµ (UNIQUE/RARE/MAGIC) + СЃС‚СЂРѕРєР° "Unique ID:".
// Р­С‚Рё СЃР»СѓС‡Р°Рё РґРѕР»Р¶РЅС‹ СЂР°Р·Р±РёСЂР°С‚СЊСЃСЏ С‚Р°Рє Р¶Рµ, РєР°Рє Рё РєР»РёСЂ-С‚РµРєСЃС‚ РёР· РёРіСЂС‹.
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
  'parse PoB: magic base РЅРµ СЂР°РІРµРЅ СЃС‚СЂРѕРєРµ "Unique ID:"',
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
  ['Wraithwrap', null], // РЅРµ СЂР°СЃРїРѕР·РЅР°С‘С‚СЃСЏ в†’ null (РЅРµ В«С‚РµР»Рѕ/Р±СЂРѕРЅСЏВ» РїРѕ РѕС€РёР±РєРµ)
];
for (const [base, expected] of cases) {
  ok(inferUniqueCategory(base) === expected, `infer('${base}') = ${expected}`);
}
ok(inferUniqueCategory(null) === null, 'infer(null) = null');
ok(inferUniqueCategory('Mail Armour', 'Boots') === 'boots', 'inner itemClass РїСЂРёРѕСЂРёС‚РµС‚РЅРµРµ baseType');
ok(mapItemClassToScoutCategory('Boots') === 'boots', 'mapItemClass boots');
ok(mapItemClassToScoutCategory('Body Armour') === 'body', 'mapItemClass body');
ok(mapItemClassToScoutCategory('Unknown') === null, 'mapItemClass unknown = null');

console.log('build gear extraction (PoB XML, Р±РµР· СЃРµС‚Рё)');
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
ok(gear.length === 3, `buildCodeToGear РёР·РІР»РµРєР°РµС‚ ${gear.length} РїСЂРµРґРјРµС‚Р°`);
ok(gear[0]?.slot === 'Weapon 1' && gear[0]?.name === 'Darkness Enthroned', 'gear slot+name (item 1)');
ok(gear[0]?.itemText.includes('Rarity: UNIQUE'), 'gear itemText СЃРѕРґРµСЂР¶РёС‚ Rarity');
ok(gear[1]?.name === 'Victory Cloak', 'gear item 2 name');
ok(gear[2]?.slot === 'Ring 1' && gear[2]?.name === "Saitha's Spear", 'gear item 3 slot+name');

console.log('build gear extraction (.build JSON вЂ” С‚РѕР»СЊРєРѕ СѓРЅРёРєРё РїРѕ РёРјРµРЅРё)');
const buildJson = JSON.stringify({
  inventory_slots: [
    { inventory_id: 'Belt1', unique_name: 'Headhunter' },
    { inventory_id: 'Weapon1', name: 'Sinister Quarterstaff' },
  ],
});
const jsonGear = await core.core.build.buildCodeToGear(buildJson);
ok(jsonGear.length === 1, `РёР· .build JSON РёР·РІР»РµС‡С‘РЅ 1 СѓРЅРёРєР°Р»СЊРЅС‹Р№ (${jsonGear.length})`);
ok(jsonGear[0]?.name === 'Headhunter' && jsonGear[0]?.slot === 'Belt1', '.build JSON unique slot+name');
ok(jsonGear[0]?.itemText.includes('Rarity: Unique'), '.build JSON itemText С„РѕСЂРјР°С‚');

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

// getClientState РїРѕ СЃРёРЅС‚РµС‚РёС‡РµСЃРєРѕРјСѓ С„Р°Р№Р»Сѓ-Р»РѕРіСѓ
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

console.log('estimate: PoE2 defense formulas (сверено с PoB2 — docs/POB2_CALC_FORMULAS.md)');
const { armorDr, hitChance, armorNeededForDr, calculateEhp, mergeGearDefenses, estimateBuild } = core;
ok(Math.abs(armorDr(9000, 1000) - 47.368) < 0.01, `armorDr 9000 vs 1000-hit = ${armorDr(9000, 1000).toFixed(1)}%`);
ok(armorDr(999999, 100) <= 90, 'armorDr capped at 90');
ok(armorDr(0, 1000) === 0, 'armorDr zero armor');
// Уклонение ЗАЩИЩАЮЩЕГОСЯ (CalcDefence.lua:41-47): hit = 100 − 95·Ev/(Ev + 4·Acc)
ok(hitChance(0, 2000) === 100, 'hitChance no evasion = 100%');
ok(Math.abs(hitChance(8000, 1000) - 36.667) < 0.01, `hitChance Ev=8000 Acc=1000 = ${hitChance(8000, 1000).toFixed(2)}% (100 − 63.33)`);
ok(hitChance(999999, 2000) > 5 && hitChance(999999, 2000) < 6, `hitChance огромное уклонение → почти минимум 5% (${hitChance(999999, 2000).toFixed(2)}%)`);
ok(hitChance(300, 0) === 5, 'hitChance нулевая точность → минимум 5% (кап уворота 95%)');
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
ok(estDef.life === 172.5, `def flat life (+100, +50) + 15% в†’ ${estDef.life}`);
ok(estDef.armour === 900, 'def armour 900');
ok(estDef.evasion === 300, 'def evasion 300');
ok(estDef.fireRes === 30 && estDef.lightningRes === 12, 'def resists fire30/light12');

const physEhp = calculateEhp(estDef, 'physical');
ok(physEhp.effectiveHp > estDef.life, 'physical EHP > life (armor+evasion layers)');
const chaosEhp = calculateEhp(estDef, 'chaos');
ok(chaosEhp.rawHp === estDef.life, 'chaos rawHp excludes ES (no ES in gear) and chaos res 0 в†’ mitigation 0');
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
ok(q2.query.type === 'Sleek Jacket', 'buildTradeQuery unknown type в†’ type string');
const st1 = modsToStatFilters(['+62 to maximum Life', '+30% to Fire Resistance', 'this is unknown mod']);
ok(st1.length === 2 && st1.some((s) => s.id === 'pseudo.pseudo_total_life' && s.min === 62) && st1.some((s) => s.id === 'pseudo.pseudo_total_fire_resistance' && s.min === 30), 'modsToStatFilters maps life+fire res, skips unknown');
const tqItem = buildTradeQueryFromItem([
  'Rarity: Rare', 'Test Ring', 'Ruby Ring', '--------', 'Ring', '--------',
  '+62 to maximum Life', '+30% to Fire Resistance',
].join('\n'));
ok(tqItem.query.type === 'Ruby Ring', 'buildTradeQueryFromItem baseType');
ok((tqItem.query.stats?.[0]?.filters ?? []).length === 2, 'buildTradeQueryFromItem modsв†’stats');

console.log('offline datasets (data/game)');
const { getDatasetVersion, getAscendanciesByClass, searchSkillGems, getSkillGemDetails, searchPassiveTree, searchBaseItems, getStatIds } = core;
const ver = getDatasetVersion();
ok(ver.patch_version === '0.5' && ver.data_revision >= 12, `dataset version ${ver.released_as}`);
const monkAsc = getAscendanciesByClass('Monk');
ok(monkAsc.some((a) => a.displayName === 'Invoker'), 'ascendancies: Monkв†’Invoker');
const ice = searchSkillGems('Ice Strike');
ok(ice.length >= 1 && ice[0].name === 'Ice Strike', 'gems: Ice Strike found');
const iceDet = getSkillGemDetails('Ice Strike');
ok(!!iceDet && iceDet.levels.length > 5 && iceDet.firstLevelCost && 'Mana' in iceDet.firstLevelCost, `gems: Ice Strike levels=${iceDet?.levels.length}, mana=${iceDet?.firstLevelCost?.Mana}`);
const ks = searchPassiveTree('Shockproof');
ok(ks.length >= 1 && ks[0].isNotable && ks[0].stats.some((s) => s.includes('Shock')), `tree: "Shockproof" notable в†’ ${ks.length} nodes`);
const byStat = searchPassiveTree('increased chance to Shock', { limit: 5 });
ok(byStat.length >= 1 && byStat.some((n) => n.stats.join(' ').includes('chance to Shock')), 'tree: search by stat text');
const ring = searchBaseItems('Ruby Ring');
ok(ring.length >= 1 && ring.some((b) => b.name === 'Ruby Ring'), 'base_items: Ruby Ring found');
ok(getStatIds().length > 20000, `stats: ${getStatIds().length} stat ids`);

console.log('poe2db.tw service (scraper)');
const { normalizeTrailingArabicToRoman, parsePoe2dbHtml } = core;
ok(normalizeTrailingArabicToRoman('Urgent_Totems_2') === 'Urgent_Totems_II', 'poe2db: arabicв†’roman slug');
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

console.log('zoneNotes + leveling context');
const { getZoneNote, getZoneNoteByName, getActNote, listZoneNotes, getLevelingContext } = core;
const zn = getZoneNote('G1_2');
ok(zn?.zoneName === 'Clearfell' && zn.notes.includes('Mud Burrow'), 'zoneNote: G1_2 Clearfell');
const znByName = getZoneNoteByName('clearfell');
ok(znByName?.zoneCode === 'G1_2', 'zoneNote: by name в†’ G1_2');
const an = getActNote(1);
ok(an?.notes.includes('Hunting Ground') || (an?.notes.length ?? 0) > 50, 'actNote: Act 1 summary');
ok(listZoneNotes().length >= 60, `listZoneNotes: ${listZoneNotes().length} zones`);
// РљРѕРЅС‚РµРєСЃС‚ Р±РµР· СЃРѕСЃС‚РѕСЏРЅРёСЏ РєР»РёРµРЅС‚Р° вЂ” fallback РЅР° Р°РєС‚ 1.
const ctx = getLevelingContext(null, { actFallback: 1 });
ok(ctx.zoneNotes === null && ctx.nextZones.length >= 1 && ctx.hints.length >= 1, `levelingContext fallback act1: ${ctx.hints.length} hints`);
ok(ctx.nextZones[0].zone === 'The Riverbank', 'levelingContext: first zone Riverbank');
// РљРѕРЅС‚РµРєСЃС‚ СЃ В«Р¶РёРІС‹РјВ» СЃРѕСЃС‚РѕСЏРЅРёРµРј (СЃРёРЅС‚РµС‚РёРєР°): Р·РѕРЅР° G1_2, СѓСЂРѕРІРµРЅСЊ 4.
const ctx2 = getLevelingContext({
  available: true, logPath: 'x', character: 'Test', klass: 'Monk', level: 4,
  zone: { timestamp: '', areaCode: 'G1_2', areaLevel: 4, zoneName: 'Clearfell', decoded: null },
  act: 1, deathsInWindow: 0, afk: null, instanceServer: null, lastEventTime: null, events: [], zoneVisits: [],
});
ok(ctx2.zoneNotes?.zoneName === 'Clearfell' && ctx2.hints.length >= 1, 'levelingContext: live-like state -> zone notes');


console.log('calculators (ehp/spirit/stun)');
const armor5000 = core.default.ehp.armorDr(5000, 1000);
ok(Math.abs(armor5000.drPercent - 33.333333) < 0.001, `ehp: armor 5000 vs 1000 = ${armor5000.drPercent.toFixed(2)}%`);
ok(core.default.ehp.blockChance(60).blockChancePercent === 50, 'ehp: block cap 50');
const allEhp = core.default.ehp.calculateAllEhp({ life: 5000, energyShield: 2000, chaosRes: 0 }, {});
ok(allEhp.chaos.rawHp === 6000, 'ehp: chaos rawHp = life + ES/2');
ok(core.default.ehp.calculateAllEhp({ life: 4000, fireRes: 75 }, {}).fire.effectiveHp === 16000, 'ehp: 75% fire res x4');
const sc = new core.default.spirit.SpiritCalculator();
sc.addSource('base', 100, 'quest');
sc.addReservation('Aura', 100, 'aura', [], 1);
sc.addReservation('Minion', 60, 'permanent_minion', [], 8);
ok(sc.availableSpirit() === -60 && sc.overflowAmount() === 60, 'spirit: overflow 60');
ok(core.default.spirit.supportGemCost(20, [1.5, 1.3]) === 39, 'spirit: ceil(20*1.5*1.3) = 39');
const scAuto = new core.default.spirit.SpiritCalculator();
scAuto.addSource('base', 100, 'quest');
scAuto.addReservation('Main', 60, 'aura', [], 1);
scAuto.addReservation('Extra', 50, 'other', [], 9);
scAuto.autoResolveOverflow();
ok(scAuto.availableSpirit() >= 0, 'spirit: autoResolveOverflow frees >= 0');
const ls = core.default.stun.lightStunChance(200, 1000, 'physical', 'melee');
ok(Math.abs(ls.finalChance - 45) < 0.001 && ls.willStun, `stun: light 200/1000 phys melee = ${ls.finalChance}%`);
ok(core.default.stun.hitsToStun(200, 1000, 'physical', 'melee').hitsToHeavyStun === 3, 'stun: 3 hits to heavy stun');

console.log('ladder skill-meta helpers');
ok(core.default.ladder.parseNinjaNumber('143k') === 143000, 'ninjaNum: 143k');
ok(core.default.ladder.parseNinjaNumber('1.2m') === 1200000, 'ninjaNum: 1.2m');
ok(core.default.ladder.parseNinjaNumber('95') === 95 && core.default.ladder.parseNinjaNumber('x') === null, 'ninjaNum: plain/null');
const rows = [
  { name: 'A', level: 100, skills: ['Comet', 'Spark'], classLabel: 'Stormweaver', 'dps.total': '1.5m', 'ehp__str': '23k' },
  { name: 'B', level: 95, skills: ['Ice Strike'], classLabel: 'Invoker', 'dps.total': '500k' },
  { name: 'C', level: 90, skills: ['comet'], classLabel: 'Oracle', 'dps.total': '900k' },
];
ok(core.default.ladder.filterRowsBySkill(rows, 'comet').length === 2, 'filterBySkill: case-insensitive 2 rows');
ok(core.default.ladder.popularSkills(rows).length >= 3, 'popularSkills: counts');
const cmp = core.default.ladder.compareWithLadderRows(rows, { level: 97, dps: 800000, ehp: 20000, classLabel: 'Oracle' });
ok(cmp.dps && Math.abs(cmp.dps.percentile - 33.3) < 0.1, 'compare: dps p33');
ok(cmp.level && Math.abs(cmp.level.percentile - 66.7) < 0.1, 'compare: level p67');
ok(cmp.classMeta === true, 'compare: classMeta true');

console.log('dataset: support gems / ascendancy nodes / stat descriptions');
ok(core.default.dataset.getSupportGems().length === 680, 'support gems: 680 records');
ok(core.default.dataset.searchSupportGems('concentrated').some(g => g.name === 'Concentrated Area Support'), 'support gems: search case-insensitive');
const inv = core.default.dataset.getAscendancyNodesByName('Invoker');
ok(inv.length === 20 && inv.filter(n => n.kind === 'notable').length === 9, 'asc nodes: Invoker 20/9 notables');
ok(core.default.dataset.searchAscendancyNodes('Elemental', { notablesOnly: true, limit: 5 }).length === 5, 'asc nodes: notable search by text');
const glory = core.default.dataset.getStatDescription('%_attack_damage_per_glory_consumed_for_6_seconds_up_to_100');
ok(!!glory && glory.template.includes('Glory'), 'stat desc: glory template resolved');
ok(core.default.dataset.searchStatDescriptions('glory', 3).length === 3, 'stat desc: search by substring');
console.log('cache: disk TTL + stale-if-error');
process.env.POE2_KIT_CACHE_DIR = process.env.TEMP + '/opencode/_poe2smoke_cache';
core.default.cache.clearHttpCache();
ok(core.default.cache.httpCacheInfo().length === 0, 'cache: empty after clear');
{
  const { createHash } = await import('node:crypto');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(process.env.POE2_KIT_CACHE_DIR, { recursive: true });
  const url = 'http://127.0.0.1:9/x';
  const h = createHash('sha1').update(url).digest('hex');
  writeFileSync(process.env.POE2_KIT_CACHE_DIR + '/' + h + '.json',
    JSON.stringify({ url, fetchedAt: Date.now() - 864e5, data: { saved: true } }));
  const r = await core.default.cache.cachedJson(url, { ttlMs: 3600_000, timeoutMs: 2000 });
  ok(r.stale === true && r.data.saved === true, 'cache: stale-if-error returns snapshot');
  const info = core.default.cache.httpCacheInfo();
  ok(info.length === 1 && info[0].ageHours > 23, 'cache: info reports age');
}
console.log('gameConfig: INI parse + act hints + discovery');
{
  const { writeFileSync } = await import('node:fs');
  const ini = '\uFEFF[LOGIN]\naccount_name=\n\n[GENERAL]\nlast_selected_KBM_input_mode=0\n\n[CACHED_DATA]\ncurrent_act_environment=6\n\n[DISPLAY]\nresolution_width=1920\nresolution_height=1080\n';
  const p = process.env.TEMP + '/opencode/_poe2_smoke_ini.ini';
  writeFileSync(p, ini);
  const s = core.default.gameConfig.getGameConfigSummary(p);
  ok(s.available === true, 'gameConfig: fixture parsed');
  ok(s.actEnvironment === '6' && s.actHint === 'Act 3 (Cruel) / endgame', 'gameConfig: act env 6 hint');
  ok(s.resolution === '1920x1080', 'gameConfig: resolution');
  ok(s.accountNameNote !== null, 'gameConfig: empty account_name note (Steam)');
}
console.log('enemy tables + boss presets (Misc.lua / ConfigOptions.lua)');
ok(core.default.enemy.monsterEvasionTable.length === 100
  && core.default.enemy.monsterPoiseThresholdTable.length === 100, 'enemy: tables 100 entries');
const ms82 = core.default.enemy.monsterStats(82);
ok(ms82.evasion === 941 && ms82.life === 32956 && ms82.poiseThreshold === 236905, 'enemy: level 82 sentinel');
const pTop = core.default.enemy.enemyPlaceholders(84, 'pinnacle');
ok(pTop.level === 84 && pTop.elementalResist === 50 && pTop.elementalPenetration === 3, 'enemy: pinnacle lvl>=82, res 50, pen 3');
const pBoss = core.default.enemy.enemyPlaceholders(84, 'boss');
ok(Math.abs(pBoss.poiseMultiplier - 18.78) < 0.01, `enemy: boss poise x${pBoss.poiseMultiplier.toFixed(2)}`);
ok(Math.abs(pTop.poiseMultiplier - 56.28) < 0.01, `enemy: pinnacle poise x${pTop.poiseMultiplier.toFixed(2)}`);
const pUber = core.default.enemy.enemyPlaceholders(84, 'uber');
ok(pUber.chaosDamage === Math.round(pUber.damage / 4), 'enemy: uber chaos /4');
ok(core.default.enemy.ENEMY_CONSTANTS.SERVER_TICK_RATE > 30.3
  && core.default.enemy.ENEMY_CONSTANTS.SERVER_TICK_RATE < 30.31, 'enemy: server tick 1/0.033');

console.log('ailments: dot / buildup / chance (CalcOffence.lua)');
const ignite = core.default.ailments.ailmentDotDps({ hitDamage: 1000, ailment: 'ignite' });
ok(Math.abs(ignite.damagePerSecond - 200) < 1e-9 && ignite.durationSeconds === 4, 'ailments: ignite 1000 hit -> 200 dps, 4s');
const poison3 = core.default.ailments.ailmentDotDps({ hitDamage: 1000, ailment: 'poison', stacks: 3, targetResistPercent: 40 });
ok(Math.abs(poison3.damagePerSecond - (200 * 3 * 0.6)) < 1e-9, `ailments: poison x3 vs 40% res -> ${poison3.damagePerSecond}`);
const cap = core.default.ailments.ailmentDotDps({ hitDamage: 1e12, ailment: 'bleed', stacks: 10 });
ok(cap.capped && cap.damagePerSecond === 35791394, 'ailments: DotDpsCap 35791394');
const bu = core.default.ailments.buildupPerHit({
  hitDamage: 1000, type: 'heavyStun',
  enemyPoiseThreshold: Math.round(236905 * 18.78),
});
ok(Math.abs(bu.buildupPercentPerHit - (0.58 * 1000 / (236905 * 18.78)) * 100) < 1e-6
  && bu.hitsToTrigger === Math.ceil(100 / bu.buildupPercentPerHit), 'ailments: heavyStun buildup scale 0.58');
const ach = core.default.ailments.ailmentChance({
  hitDamage: 50000, enemyAilmentThreshold: 71303, type: 'ignite',
});
ok(Math.abs(ach.chancePercent - (50000 / 71303 * 20)) < 1e-6, `ailments: ignite chance ${ach.chancePercent.toFixed(2)}%`);
ok(core.default.ailments.chillThreshold(10000) === 10000
  && core.default.ailments.AILMENT_CONSTANTS.CHILL_MAX_EFFECT === 50, 'ailments: chill multiplier 100');

console.log('ehp: dodge / suppression / ward / lucky layers');
const dodged = core.default.ehp.calculateAllEhp({ life: 4000, spellDodgeChance: 50, fireRes: 0 }, {});
// spell-урон (fire): (1-0 dodge) x (1-0 res) -> x2
ok(Math.abs(dodged.fire.effectiveHp - 8000) < 1e-9, `ehp: spell dodge 50% -> x${(dodged.fire.effectiveHp / 4000).toFixed(0)}`);
const sup = core.default.ehp.calculateAllEhp({ life: 4000, spellSuppressionChance: 100, fireRes: 0 }, {});
ok(Math.abs(sup.fire.effectiveHp - 8000) < 1e-9, 'ehp: suppression 100% -> -50% spell dmg');
const sup90 = core.default.ehp.calculateAllEhp({ life: 4000, spellSuppressionChance: 90, fireRes: 0 }, {});
ok(Math.abs(sup90.fire.effectiveHp - 4000) < 1e-9, 'ehp: suppression <100% ignored');
const warded = core.default.ehp.calculateAllEhp({ life: 4000, ward: 1000, fireRes: 75 }, {});
ok(Math.abs(warded.fire.rawHp - 5000 * 4) < 1e-9 || warded.fire.rawHp === 5000, 'ehp: ward added to pool');
ok(Math.abs(core.default.ehp.luckyChance(50) - 75) < 1e-9, 'ehp: lucky 50% -> 75%');
ok(Math.abs(core.default.ehp.luckyChance(75) - (1 - 0.25 ** 2) * 100) < 1e-9, 'ehp: lucky formula 1-(1-c)^2');
ok(Math.abs(core.default.ehp.chanceWithExtraRolls(50, 1) - 75) < 1e-9, 'ehp: extra rolls');

console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
