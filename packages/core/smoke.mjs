// Smoke-тест против собранного dist (Node ESM, без сети).
import { decodeShareCode, encodeShareCode, PobCodeError, importBuild } from './dist/build.js';
import { getLevelingPlan, getZonesByAct, levelDiff } from './dist/leveling.js';
import { getMonkLevelingTips, getMonkLevelingHint, getMonkLevelingPlan, listLevelingClasses, resolveLevelingClass, getClassLevelingTips, getClassLevelingHint, getClassLevelingPlan, validateGuideGems } from './dist/leveling.js';
import { inferUniqueCategory, mapItemClassToScoutCategory, matchStatFilter } from './dist/trade.js';
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
ok(plan[0].hasWaypoint === false && plan.every((z) => z.hasWaypoint === false || z.hasWaypoint === true), 'hasWaypoint present on all zones');
ok((() => { const riverbank = plan.find((z) => z.zone === 'The Riverbank'); const freight = plan.find((z) => z.zone === 'Clearfell'); return (riverbank?.hasWaypoint === false) && (freight?.hasWaypoint === true); })(), 'waypoint: Riverbank none, Clearfell yes');

console.log('Ice Strike Monk guide');
  ok(getMonkLevelingTips().length >= 4, 'monk tips: 4+ ranges');
  ok(getMonkLevelingTips(30).some((t) => t.fromLevel <= 30 && (t.toLevel == null || t.toLevel >= 30)), 'monk tips: lvl30 matched');
  ok(getMonkLevelingHint(1).includes('Ice Strike'), 'monk hint: Ice Strike present at lvl1');
  ok(getMonkLevelingPlan().length === getLevelingPlan().length, 'monk plan: same zone count');
  ok(getMonkLevelingPlan().some((z) => z.steps.some((s) => s.includes('Ice Strike Monk'))), 'monk plan: enriched steps');

console.log('Class guides: all 8 base classes');
const classes = listLevelingClasses();
  ok(classes.length === 8, `8 base classes (got ${classes.length}): ` + classes.map((c) => c.baseClass).join(','));
  for (const c of classes) {
    ok(c.tipCount >= 3, `${c.baseClass}: ${c.tipCount} tip ranges`);
  }
  const guideBy = (q) => resolveLevelingClass(q)?.baseClass;
  ok(guideBy('Invoker') === 'Monk', 'resolve: Invoker→Monk');
  ok(guideBy('Lich') === 'Witch', 'resolve: Lich→Witch');
  ok(guideBy('Titan') === 'Warrior', 'resolve: Titan→Warrior');
  ok(guideBy('Deadeye') === 'Ranger', 'resolve: Deadeye→Ranger');
  ok(guideBy('Witchhunter') === 'Mercenary', 'resolve: Witchhunter→Mercenary');
  ok(guideBy('amazon') === 'Huntress', 'resolve: amazon→Huntress (case-insensitive)');
  ok(guideBy('sorceress') === 'Sorceress', 'resolve: base class itself');
  ok(getClassLevelingTips('Witch', 20).length >= 1, 'witch tips at lvl20');
  ok(getClassLevelingHint('Titan', 5).length > 10, 'titan hint at lvl5 non-empty');
  ok(getClassLevelingPlan('Witch').length === getLevelingPlan().length, 'witch plan: same zone count');
  const badGems = validateGuideGems();
  ok(Object.keys(badGems).length === 0, `validateGuideGems: all gems known (bad: ${JSON.stringify(badGems)})`);

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
	<Tree activeSpec="1">
		<Spec ascendClassId="1" classId="6" treeVersion="0_3" nodes="attributes1,12876"/>
	</Tree>
</PathOfBuilding2>`;
const imp = await importBuild(pob2Xml);
ok(imp.level === 95 && imp.class === 'Monk' && imp.ascendancy === 'Invoker', 'PoB2: Build level/class/asc');
ok(imp.treeVersion === '0_3' && imp.passiveNodes.length === 2 && imp.passiveNodes[0] === 'attributes1', `PoB2: treeVersion из <Spec> = ${imp.treeVersion}, nodes = ${imp.passiveNodes.length}`);
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
// P1 #7: по-слотная разбивка «откуда цифра».
const slots = core.defenseBreakdownBySlot(estGear);
ok(slots.length === 2, `p1-7: по-слотная разбивка (${slots.length} слота)`);
ok(slots[0].life === 100 && slots[0].armour === 900 && slots[0].fireRes === 30, `p1-7: Body жизнь100/броня900/fire30 (${slots[0].life}/${slots[0].armour}/${slots[0].fireRes})`);
ok(slots[1].life === 50 && slots[1].evasion === 300 && slots[1].lightningRes === 12, 'p1-7: Boots жизнь50/уклонение300/light12');
ok(slots[0].percentMods.life === 15, `p1-7: % increased Life 15 на Body (${slots[0].percentMods.life})`);
ok(estGear.some((g) => slots[0].slot === 'Body Armour' && slots[0].name === 'Test Plate'), 'p1-7: slot/name сохранены');
const pctRows = core.percentModsBySlot(estGear);
ok(pctRows.length === 1 && pctRows[0].type === 'Life' && pctRows[0].value === 15, `p1-7: % increased sources (${pctRows.length} → Life 15)`);
ok(JSON.stringify(core.defenseBreakdownBySlot({ 'Body Armour': estGear[0].itemText })[0].armour) === '900', 'p1-7: принимает Record<slot,text>');

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

console.log('advice (P0-3): «следующий апгрейд» — CI/ES/Spirit/мета-референс');
const { adviseBuild, buildReferenceFromRows, fmtSuffix, ADVICE_DEFAULTS } = core;
const ciXml = `<?xml version="1.0"?><PathOfBuilding><Build level="90" className="Monk" ascendClassName="Invoker"/>
<PlayerStat stat="Life" value="1"/><PlayerStat stat="EnergyShield" value="3500"/>
<PlayerStat stat="Spirit" value="236"/><PlayerStat stat="SpiritUnreserved" value="-1"/>
<PlayerStat stat="CritChance" value="75.45"/><PlayerStat stat="CritMultiplier" value="5.29"/>
<Items><ItemSet><Slot name="Body Armour" itemId="1"/></ItemSet>
<Item id="1">Rarity: RARE\nCI Body\nChiselled Vest\nEnergy Shield: 3000\n+80 to maximum Life</Item></Items></PathOfBuilding>`;
const estA = await estimateBuild(ciXml);
const advA = adviseBuild(estA);
ok(advA.priorities.length > 0, `p0-3: advice non-empty (${advA.priorities.length})`);
ok(advA.priorities[0].priority === 'blocking' && advA.priorities[0].area === 'spirit' && advA.priorities[0].title.includes('Spirit в перерасходе'), 'p0-3: Spirit overflow → первый блокер');
ok(advA.priorities.some((p) => p.title.includes('ES-пул ниже порога CI')), 'p0-3: CI ES ниже порога → совет');
ok(advA.totals.blocking >= 1 && advA.checklist.length === advA.priorities.length, 'p0-3: totals+checklist согласованы');
ok(estA.pobStats.Life === 1, 'p0-3: CI детект из PlayerStat Life=1');
const refRows = [
  { classLabel: 'Invoker', 'dps.total': '1m', 'ehp__str': '50k' },
  { classLabel: 'Invoker', 'dps.total': '500k', 'ehp__str': '40k' },
  { classLabel: 'Invoker', 'dps.total': '200k', 'ehp__str': '20k' },
];
const refRef = buildReferenceFromRows(refRows, { className: 'Invoker', dps: 150000, ehp: 15000 });
ok(refRef.poolSize === 3 && refRef.medianDps === 500000 && refRef.topDps === 1000000, 'p0-3: ref median/top');
ok(refRef.dpsPercentile === 0 && refRef.ehpPercentile === 0, 'p0-3: ref процентили (ниже всех)');
const metXml = `<?xml version="1.0"?><PathOfBuilding><Build level="90" className="Monk" ascendClassName="Invoker"/>
<PlayerStat stat="Life" value="1"/><PlayerStat stat="EnergyShield" value="8645"/>
<PlayerStat stat="TotalDPS" value="150000"/><PlayerStat stat="TotalEHP" value="15000"/>
<PlayerStat stat="SpiritUnreserved" value="100"/>
<Items><ItemSet><Slot name="Body Armour" itemId="1"/></ItemSet>
<Item id="1">Rarity: RARE\nMeta Body\nLeather Vest\nEvasion Rating: 5000\n+80 to maximum Life</Item></Items></PathOfBuilding>`;
const estB = await estimateBuild(metXml);
const advB = adviseBuild(estB, { rows: refRows });
ok(advB.classification.includes('проседает'), `p0-3: классификация "${advB.classification}"`);
ok(advB.priorities.some((p) => p.title.includes('DPS просел')), 'p0-3: DPS против меты → совет');
ok(advB.priorities.some((p) => p.title.includes('Живучесть (EHP) ниже меты')), 'p0-3: EHP против меты → совет');
ok(advB.priorities[0].priority === 'high' && advB.checklist[0] === '1. ' + advB.priorities[0].title, 'p0-3: первым high (блокеров нет), checklist согласован');
ok(fmtSuffix(449538) === '450k' && fmtSuffix(3200000) === '3.2M' && fmtSuffix(null) === '—', 'p0-3: fmtSuffix');
const noRef = adviseBuild(estA);
ok(noRef.classification.includes('предварительная оценка'), 'p0-3: без меты → предв. классификация');
ok(ADVICE_DEFAULTS.CI_MIN_ES === 5000 && ADVICE_DEFAULTS.LOW_PERCENTILE === 25, 'p0-3: дефолтные пороги');

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
const { getDatasetVersion, getAscendanciesByClass, searchSkillGems, getSkillGemDetails, searchPassiveTree, searchBaseItems, getStatIds, getPassiveNodeById, resolvePassiveNodes, getPassiveTree, checkTreeVersion } = core;
const ver = getDatasetVersion();
ok(ver.patch_version === '0.5' && ver.data_revision >= 12, `dataset version ${ver.released_as}`);
console.log('version desync check (P0-2): treeVersion vs dataset patch');
const v0 = checkTreeVersion('0_5');
ok(v0.status === 'current' && v0.label === 'актуальна' && v0.datasetPatch === '0.5', `p0-2: "0_5" в†’ current, patch ${v0.datasetPatch}`);
const v1 = checkTreeVersion('0_3');
ok(v1.status === 'older' && v1.message.includes('⚠ билд собран на другой версии дерева'), 'p0-2: "0_3" в†’ older (⚠ предупреждение)');
const v2 = checkTreeVersion('0_6');
ok(v2.status === 'newer' && v2.message.includes('датасет устарел'), 'p0-2: "0_6" в†’ newer (датасет устарел)');
const v3 = checkTreeVersion(null);
ok(v3.status === 'missing' && v3.treeVersion === null, 'p0-2: без treeVersion в†’ missing');
const v4 = checkTreeVersion('bogus');
ok(v4.status === 'unparseable', 'p0-2: "bogus" в†’ unparseable');
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
const symNode = getPassiveNodeById(byStat[0].id);
ok(!!symNode && symNode.source === 'tree' && symNode.name === byStat[0].name, `tree ids: symbolic id "${byStat[0].id}" в†’ "${symNode?.name}"`);
ok(getPassiveTree().length >= 9000, `tree ids: dataset size ${getPassiveTree().length}`);
const faith = getPassiveNodeById('12876');
ok(!!faith && faith.source === 'ascendancy' && faith.isNotable && faith.name === 'Faith is a Choice' && faith.stats.includes('Grants Skill: Meditate'), 'tree ids: numeric 12876 в†’ "Faith is a Choice" (ascendancy)');
const report = resolvePassiveNodes(['attributes1', '12876', '12876', '999999', 'no-such-id']);
ok(report.requested === 4 && report.resolved.length === 2
  && report.missingNumeric.length === 1 && report.missingSymbolic.length === 1
  && report.resolved.some((n) => n.id === 'attributes1') && report.resolved.some((n) => n.id === '12876'),
  `tree ids: report dedupe+missing split (resolved ${report.resolved.length}/${report.requested})`);
// P0 #1b: числовая карта обычного дерева (резолв числовых game ID из PoB <Spec nodes>)
const numMap = core.getNumericTreeMap();
ok(numMap.size >= 4000, `tree ids: numeric map size ${numMap.size} (ожидал >= 4000)`);
const echo = getPassiveNodeById('5703');
ok(!!echo && echo.source === 'tree' && echo.isNotable && echo.name === 'Echoing Thunder' && echo.stats.some((s) => s.includes('Shocked an Enemy')), 'tree ids: numeric 5703 → "Echoing Thunder" (notable, обычное дерево)');
const attr = getPassiveNodeById('11672');
ok(!!attr && attr.source === 'tree' && attr.name === 'Attribute' && attr.stats.includes('+5 to Strength'), 'tree ids: numeric 11672 → "Attribute" (+5 Strength)');
const reportFull = resolvePassiveNodes(['5703', '11672', '12876', '314159']);
ok(reportFull.resolved.length === 3 && reportFull.missing.length === 1 && reportFull.missing[0] === '314159'
  && reportFull.resolved.some((n) => n.id === '12876' && n.source === 'ascendancy'),
  `tree ids: numeric обычное+asc (resolved ${reportFull.resolved.length}/4)`);

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
// Контекст без состояния клиента — fallback на акт 1.
const ctx = getLevelingContext(null, { actFallback: 1 });
ok(ctx.zoneNotes === null && ctx.nextZones.length >= 1 && ctx.hints.length >= 1, `levelingContext fallback act1: ${ctx.hints.length} hints`);
ok(ctx.nextZones[0].zone === 'The Riverbank', 'levelingContext: first zone Riverbank');
// Контекст с «живым» состоянием (синтетика): зона G1_2, уровень 4.
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
// P1 #9: «что влезает в остаток» — жадный наброс по приоритету.
const fit = core.default.spirit.fitSpiritByPriority(
  [
    { name: 'Aura A', cost: 40, priority: 1 },
    { name: 'Minion B', cost: 30, priority: 3 },
    { name: 'Aura C', cost: 40, priority: 4 },
    { name: 'Big D', cost: 200, priority: 2 },
  ],
  100,
);
ok(
  fit.selected.length === 2 &&
    fit.selected[0].name === 'Aura A' &&
    fit.selected[1].name === 'Minion B' &&
    fit.remaining === 30 &&
    fit.costUsed === 70 &&
    fit.skipped.length === 2,
  'p1-9: fitSpiritByPriority брать важные в остаток (2 влезают, остаток 30)',
);
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

console.log('ssf (P0 #4): SSF-разбор предмета вместо цены (без сети)');
const { ssfAssessment, ssfAssessmentFromText, ssfBuildReport, formatSsf } = core;
const ssfText = [
  'Rarity: Rare', 'Tempest Quarterstaff', 'Quarterstaff', '--------',
  'Quality: +20%', 'Physical Damage: 100-150', '--------',
  'Item Level: 83', '--------',
  'Requires Level 60, 110 Dex', '--------',
  '+45% increased Physical Damage (fractured)',
  '+25% to Critical Damage Bonus',
  'Adds 12 to 24 Physical Damage',
].join('\n');
const ssfA = ssfAssessmentFromText(ssfText);
ok(ssfA.heuristic === true, 'ssf: heuristic flag true');
ok(ssfA.baseType === 'Quarterstaff' && ssfA.itemLevel === 83 && ssfA.rarity === 'Rare', `ssf: base/ilvl/rarity (${ssfA.displayName})`);
ok(ssfA.fractured.length === 1 && ssfA.fractured[0].keep === true, 'ssf: fractured phys-dmg классифицирован как важно');
ok(ssfA.crafting.length >= 2 && ssfA.crafting[0].step.includes('Заложить фрактуред'), 'ssf: план крафта стартует с фрактуреда');
ok(ssfA.dropZone !== null && ssfA.dropZone.includes('Акт'), `ssf: зона дропа/крафта базы ("${ssfA.dropZone}")`);
ok(typeof formatSsf(ssfA) === 'string' && formatSsf(ssfA).includes('План крафта'), 'ssf: formatSsf содержит план крафта');
const ssfNone = ssfAssessmentFromText(['Rarity: Magic', 'Stiff Belt', 'Belt', '--------', '+12% to Fire Resistance (fractured)'].join('\n'));
ok(ssfNone.fractured.length === 1 && ssfNone.fractured[0].keep === true, 'ssf: fractured resist -> keep');
const ssfUnique = ssfAssessmentFromText(['Rarity: Unique', 'Darkness Enthroned', 'Fine Belt', '--------'].join('\n'));
ok(ssfUnique.rarity === 'Unique' && ssfUnique.dropNote.includes('не крафтится'), 'ssf: uniq note "не крафтится"');
const ssfReport = ssfBuildReport({ 'Weapon 1': 'Rarity: UNIQUE\nTempest Claw\nClaw\nItem Level: 80', 'Boots': ssfText });
ok(ssfReport.length === 2, `ssf: report 2 slots (${ssfReport.length})`);
ok(ssfReport.every((r) => r.assessment.rarity === 'Unique' || r.assessment.rarity === 'Rare'), 'ssf: report Названия предметов корректны');

console.log('gem source (P0 #5): источник получения гема');
const { getSupportGems, getSkillGems } = core;
const heraldD = getSkillGemDetails('Herald of Ice');
ok(heraldD?.source?.kind === 'UncutSpiritGem', `P0-5: details Herald of Ice source (${heraldD?.source?.item})`);
const iceGem = searchSkillGems('Ice Strike', 1)[0];
ok(iceGem.source?.kind === 'UncutSkillGem' && iceGem.source.item === 'Uncut Skill Gem', `P0-5: Ice Strike источник Uncut Skill Gem (${iceGem.source?.item})`);
ok(iceGem.source?.unlockLevel === 3, `P0-5: Ice Strike открытие ~ур. 3 (levelRequirement 2-го уровня, по данным) → ${iceGem.source?.unlockLevel}`);
ok(iceGem.source?.note && iceGem.source.note.length > 20, 'P0-5: source.note — эвристическое пояснение');
const herald = searchSkillGems('Herald of Ice', 1)[0];
ok(herald.source?.kind === 'UncutSpiritGem' && herald.source.item === 'Uncut Spirit Gem', `P0-5: аур/вестник → Uncut Spirit Gem (${herald.source?.item})`);
const purity = searchSkillGems('Purity of Lightning', 1)[0];
ok(purity.source?.kind === 'UncutSpiritGem', `P0-5: аура Purity of Lightning → Uncut Spirit Gem (${purity.source?.item})`);
const supp = getSupportGems().find((g) => g.name.includes('Concentrated'));
ok(supp?.source?.kind === 'UncutSupportGem' && supp.source.item === 'Uncut Support Gem', 'P0-5: саппорт → Uncut Support Gem');
ok(getSupportGems().every((g) => g.source?.item === 'Uncut Support Gem'), 'P0-5: все саппорт-гемы помечены Uncut Support Gem');
const allActive = searchSkillGems('', 5);
ok(getSkillGems().every((g) => g.source && ['UncutSkillGem', 'UncutSpiritGem'].includes(g.source.kind)), 'P0-5: каждый активный гем имеет source (Skill/Spirit)');

console.log('uniques catalog (P2-уник.): локальный каталог для прайс-чека');
const { getUniqueByName, getUniqueCatalogEntries, searchUniqueNames, scountCategoryForUnique, resolveBaseTypeCategory } = core.core.uniques;
const andv = getUniqueByName('Andvarius');
ok(!!andv && andv.baseType === 'Gold Ring' && andv.category === 'rings', `uniqu: Andvarius → ${andv?.baseType} / ${andv?.category}`);
ok(!!getUniqueByName('Headhunter'), 'uniqu: Headhunter найден');
ok(getUniqueByName('andvarius') !== undefined, 'uniqu: регистр не важен');
ok(getUniqueByName('No Such Unique Xyz') === undefined, 'uniqu: несуществующий → undefined');
const entries = getUniqueCatalogEntries();
ok(entries.length >= 400, `uniqu: каталог ${entries.length} предметов (ожидал ≥400)`);
ok(searchUniqueNames('ring').length >= 1 && searchUniqueNames('Ring').length >= 1, 'uniqu: поиск по подстроке');
ok(scountCategoryForUnique('Andvarius', null) === 'rings', 'uniqu: категория по имени без baseType');
ok(scountCategoryForUnique('Headhunter', 'Heavy Belt') === 'belts', 'uniqu: категория по имени даже при отличном baseType');
ok(resolveBaseTypeCategory('Mail Armour') === 'body', 'uniqu: resolveBaseTypeCategory body');
ok(resolveBaseTypeCategory('Wraithwrap') === null, 'uniqu: resolveBaseTypeCategory null для неизвестного');

console.log('statdesc: рендер игровых описаний статов по значению');
const { renderStatText, findStatIdByPattern, normalizeStatPattern, statDescRenderInfo } = core.core.statdesc;
ok(renderStatText('base_maximum_life', 40) === '+40 to maximum Life', `statdesc: base_maximum_life(40) = "${renderStatText('base_maximum_life', 40)}"`);
ok(renderStatText('base_maximum_life', 40) === '+40 to maximum Life' && renderStatText('base_maximum_life', -10) === '-10 to maximum Life', 'statdesc: {0:+d} спек знака');
const warcryNeg = renderStatText('warcry_damage_+%', -10);
ok(warcryNeg !== null && warcryNeg.includes('reduced'), `statdesc: range "#|-1" + negate handler -> "${warcryNeg}"`);
const warcryPos = renderStatText('warcry_damage_+%', 15);
ok(warcryPos !== null && warcryPos.includes('increased') && !warcryPos.includes('reduced'), `statdesc: range "1|#" positive branch -> "${warcryPos}"`);
ok(renderStatText('no_such_stat_id', 5) === null, 'statdesc: неизвестный stat_id -> null');
const statInfo = statDescRenderInfo();
ok(statInfo.statIds > 9000, `statdesc: индекс покрывает ${statInfo.statIds} stat_id (>9000)`);
ok(
  (() => {
    const hit = findStatIdByPattern('#% to fire resistance');
    return hit !== null && !!hit.statId && normalizeStatPattern(hit.template).includes('fire resistance');
  })(),
  'statdesc: findStatIdByPattern("#% to fire resistance") находит шаблон',
);
ok(
  (() => {
    // проверки тегов: [Tag|Display] должен разрешаться в display-текст
    const id = findStatIdByPattern('#% to fire resistance');
    if (!id) return false;
    const rendered = renderStatText(id.statId, 12);
    return rendered !== null && /^[+-]?\d/.test(rendered) && !rendered.includes('[');
  })(),
  'statdesc: отрендеренный текст без сырых [тегов]',
);

console.log('tradeSnapshot: оффлайн-снапшот каталога trade2');
const { getTradeStatSnapshot, tradeSnapshotInfo } = core.core.tradeSnapshot;
const snap = getTradeStatSnapshot();
ok(snap.length > 8000, `snapshot: ${snap.length} записей (>8000)`);
ok(snap.some((e) => e.id === 'explicit.stat_3299347043' && e.text === '# to maximum Life'), 'snapshot: known explicit life entry присутствует');
const snapInfo = tradeSnapshotInfo();
ok(snapInfo.groups === 10, `snapshot: ${snapInfo.groups} групп каталога (=10)`);
// матчинг мода против снапшота тем же matchStatFilter, что идёт в поиск
const lifeFilter = matchStatFilter('40 to maximum Life', snap);
ok(!!lifeFilter && lifeFilter.id === 'explicit.stat_3299347043' && lifeFilter.min === 36, `snapshot: matchStatFilter(life) -> ${lifeFilter && lifeFilter.id} min=${lifeFilter && lifeFilter.min}`);


// http.ts: GGG rate-limit бэкоф (X-Rate-Limit*, Retry-After) — офлайн-мок fetch.
console.log('http: GGG rate-limit backoff (trade2)');
{
  const realFetch = globalThis.fetch;
  let plan = [];
  const fakeFetch = async (url) => {
    const step = plan.shift() ?? { status: 200, body: '{"ok":true}' };
    const headers = new Map(Object.entries(step.headers ?? {}));
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (h) => headers.get(h.toLowerCase()) ?? null },
      text: async () => step.body ?? '',
    };
  };
  globalThis.fetch = fakeFetch;
  const httpJson = core.httpJson ?? (await import('./dist/http.js')).httpJson;

  plan = [{ status: 200, headers: { 'x-rate-limit-ip': '5:60', 'x-rate-limit-ip-state': '0:60:0' }, body: '{"a":1}' }];
  const r1 = await httpJson('https://www.pathofexile.com/api/trade2/data/smoke-aaa');
  ok(r1.a === 1, 'ggg: 200 с квотными заголовками распарсен');

  plan = [
    { status: 429, headers: { 'retry-after': '1', 'x-rate-limit-ip': '5:60', 'x-rate-limit-ip-state': '5:60:2' }, body: '{}' },
    { status: 200, headers: { 'x-rate-limit-ip': '5:60', 'x-rate-limit-ip-state': '1:60:0' }, body: '{"b":2}' },
  ];
  const t0 = Date.now();
  const r2 = await httpJson('https://www.pathofexile.com/api/trade2/data/smoke-bbb');
  const waited = Date.now() - t0;
  ok(r2.b === 2 && waited >= 1500 && waited < 15000, `ggg: 429 -> Retry-After -> 200 (ждали ${waited}мс)`);

  plan = [
    { status: 429, headers: { 'retry-after': '1' }, body: '{}' },
    { status: 429, headers: { 'retry-after': '1' }, body: '{}' },
    { status: 429, headers: { 'retry-after': '1' }, body: '{}' },
  ];
  let threw = false;
  try { await httpJson('https://www.pathofexile.com/api/trade2/data/smoke-ccc'); }
  catch { threw = true; }
  ok(threw, 'ggg: после лимита ретраев 429 пробрасывается (нет вечного цикла)');

  globalThis.fetch = realFetch;
}


// oauth.ts: GGG OAuth 2.1 PKCE + account API (offline mocks, no network)
console.log('oauth: GGG OAuth 2.1 PKCE (offline)');
{
  process.env['POE2K_GGG_CLIENT_ID'] = 'smoke-client-abc';
  const oa = core; // star-export: функции oauth на верхнем уровне namespace
  const crypto = await import('node:crypto');
  const path = await import('node:path');
  const os = await import('node:os');
  const fsx = await import('node:fs');

  const pk = oa.generatePkce();
  const expected = crypto.createHash('sha256').update(pk.verifier).digest('base64url');
  ok(pk.verifier.length >= 40 && pk.challenge === expected, 'oauth: PKCE S256 challenge == SHA256(verifier)');
  ok(/^[A-Za-z0-9_-]+$/.test(pk.verifier) && /^[A-Za-z0-9_-]+$/.test(pk.challenge), 'oauth: base64url alphabet');
  const state = oa.generateState();
  ok(state.length === 32 && /^[0-9a-f]+$/.test(state), 'oauth: state is 32 hex chars');

  const url = oa.buildAuthorizeUrl({ clientId: 'cid', codeChallenge: pk.challenge, state: 'st' });
  const u = new URL(url);
  ok(
    u.searchParams.get('client_id') === 'cid' &&
      u.searchParams.get('code_challenge_method') === 'S256' &&
      u.searchParams.get('code_challenge') === pk.challenge &&
      u.searchParams.get('response_type') === 'code' &&
      u.searchParams.get('state') === 'st' &&
      u.searchParams.get('redirect_uri') === 'http://127.0.0.1:8080/callback' &&
      u.searchParams.get('scope') === 'account:profile account:characters',
    'oauth: authorize URL well-formed (PKCE + scopes + 127.0.0.1 redirect)',
  );

  const cb = oa.parseCallbackQuery('?code=abc123&state=st');
  ok(cb.code === 'abc123' && cb.state === 'st' && cb.error === null, 'oauth: callback query parsed');
  ok(oa.parseCallbackQuery('?error=access_denied').error === 'access_denied', 'oauth: callback error parsed');

  // token store roundtrip in temp file
  const tmp = path.join(os.tmpdir(), `poe2k-oauth-smoke-${Date.now()}.json`);
  fsx.mkdirSync(path.dirname(tmp), { recursive: true });
  process.env['POE2K_OAUTH_FILE'] = tmp;
  const tok = {
    access_token: 'A1', refresh_token: 'R1', expires_at: Date.now() + 3600_000,
    token_type: 'bearer', scope: 'account:profile account:characters',
    username: 'smoker', obtainedAt: new Date().toISOString(),
  };
  oa.saveOAuthToken(tok);
  const loaded = oa.loadOAuthToken();
  ok(!!loaded && loaded.access_token === 'A1' && loaded.refresh_token === 'R1', 'oauth: token file save/load roundtrip');
  ok(fsx.readFileSync(tmp, 'utf8').includes('A1'), 'oauth: token file written to POE2K_OAUTH_FILE');
  const st1 = oa.oauthStatus();
  ok(st1.clientIdConfigured && st1.authorized && st1.accessTokenValid && st1.refreshable && st1.username === 'smoker', 'oauth: oauthStatus aggregates token state');
  ok((await oa.requireAccessToken()).access_token === 'A1', 'oauth: valid token returned without refresh');
  oa.clearOAuthToken();
  ok(oa.loadOAuthToken() === null, 'oauth: clear removes token file');

  // apiGetJson: 401 -> refresh -> retry (mocked fetch, no network)
  const realFetch = globalThis.fetch;
  const authSeen = [];
  let refreshCalls = 0;
  let refreshFormOk = false;
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.includes('/oauth/token')) {
      refreshCalls++;
      const form = String(init?.body ?? '');
      refreshFormOk = form.includes('grant_type=refresh_token') && form.includes('R1') && form.includes('client_id=smoke-client-abc');
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ access_token: 'A2', refresh_token: 'R2', expires_in: 36000, token_type: 'bearer', scope: 'account:profile account:characters', username: 'smoker' }),
        text: async () => '',
      };
    }
    if (s.includes('api.pathofexile.com/')) {
      const authz = String(init?.headers?.Authorization ?? '');
      authSeen.push(authz);
      if (authz.endsWith('A1')) {
        return { ok: false, status: 401, headers: new Headers(), text: async () => 'unauthorized' };
      }
      return {
        ok: true, status: 200, headers: new Headers(),
        text: async () => JSON.stringify({ characters: [{ name: 'PandarenDeepRover', class: 'Monk', level: 30 }] }),
        json: async () => ({ characters: [{ name: 'PandarenDeepRover', class: 'Monk', level: 30 }] }),
      };
    }
    throw new Error('unexpected fetch in oauth smoke: ' + s);
  };
  oa.saveOAuthToken(tok);
  const chars = await oa.listPoe2Characters();
  ok(chars.length === 1 && chars[0].name === 'PandarenDeepRover' && chars[0].level === 30, 'oauth: listPoe2Characters via 401->refresh->200');
  ok(refreshCalls === 1 && refreshFormOk, 'oauth: exactly one refresh with correct form (grant_type=refresh_token, old R1, client_id)');
  ok(authSeen.length === 2 && authSeen[0].endsWith('A1') && authSeen[1].endsWith('A2'), 'oauth: call1 bore OLD token, call2 bore refreshed token');
  const savedAfter = oa.loadOAuthToken();
  ok(!!savedAfter && savedAfter.access_token === 'A2' && savedAfter.refresh_token === 'R2', 'oauth: refreshed token persisted (old refresh is dead)');

  // name validation happens before any network
  let badName = false;
  try { await oa.getPoe2Character('bad/name'); } catch { badName = true; }
  ok(badName, 'oauth: path injection in character name rejected');
  let badName2 = false;
  try { await oa.getPoe2Character('x'.repeat(80)); } catch { badName2 = true; }
  ok(badName2, 'oauth: overlong character name rejected');
  globalThis.fetch = realFetch;

  // beginOAuthLogin fails fast without client_id
  delete process.env['POE2K_GGG_CLIENT_ID'];
  let noCid = false;
  try { oa.beginOAuthLogin(); } catch (e) { noCid = String(e.message).includes('POE2K_GGG_CLIENT_ID'); }
  ok(noCid, 'oauth: beginOAuthLogin fails fast without client_id');

  delete process.env['POE2K_OAUTH_FILE'];
}


// parse.ts: item flags (Corrupted/Mirrored/Unidentified) - ExileOracle edge-cases
console.log('parse: item flags (corrupted/mirrored/unidentified)');
{
  const { parseItemText } = core;
  const flagItem = [
    'Item Class: Body Armours',
    'Rarity: Rare',
    'Doom Crown',
    'Siege Helmet',
    '--------',
    '+25 to maximum Life',
    '--------',
    'Corrupted',
  ].join('\n');
  const p1 = parseItemText(flagItem);
  ok(p1.corrupted === true, 'parse: Corrupted flag detected');
  ok(!p1.mirrored && !p1.unidentified, 'parse: mirrored/unidentified default false');
  ok(!p1.mods.some((m) => /corrupted/i.test(m.text)), 'parse: "Corrupted" not counted as mod');

  const mirrorItem = ['Rarity: Gem', 'Ice Strike', '--------', 'Mirrored'].join('\n');
  const p2 = parseItemText(mirrorItem);
  ok(p2.mirrored === true && !p2.corrupted, 'parse: Mirrored flag detected');

  const unidItem = ['Rarity: Rare', 'Voltaic Antimony', 'Iron Amulet', '--------', 'Unidentified', '--------', 'Corrupted'].join('\n');
  const p3 = parseItemText(unidItem);
  ok(p3.unidentified === true && p3.corrupted === true, 'parse: Unidentified + Corrupted together');

  const clean = parseItemText(['Rarity: Rare', 'Plain Ring', '--------', '+10 to maximum Life'].join('\n'));
  ok(clean.corrupted === false && clean.mirrored === false && clean.unidentified === false, 'parse: no false flags on clean item');
}

// stun.ts: parity with Hivemind stun_calculator.py (immune = no meter mutation)
console.log('stun: immune hit does not mutate meter (Hivemind parity)');
{
  const stun = core.core.stun;
  const tr = new stun.HeavyStunTracker();
  // normal hit first: 30 dmg phys melee vs 100 life -> buildup 67.5, primed
  const r1 = tr.applyHit(30, 100, 'physical', 'melee', 'e1');
  ok(r1.meter.primed === true && r1.buildupAdded > 67 && r1.buildupAdded < 68, 'stun: hit 30px-melee vs 100hp -> 67.5 buildup, primed');
  const r2 = tr.applyHit(30, 100, 'physical', 'melee', 'e1');
  ok(r2.triggeredHeavyStun === true, 'stun: second hit crosses 100% -> heavy stun triggered');
  // hitsToStun: 40 phys-melee в 100hp -> chance 40%*1.5*1.5=90%, buildup 90/hit -> 2 удара
  const h = stun.hitsToStun(40, 100, 'physical', 'melee');
  ok(h.hitsToLightStun === 1 && h.hitsToHeavyStun === 2 && h.lightChance > 89 && h.lightChance < 91, 'stun: hitsToStun light=1 heavy=2 (40px-melee vs 100hp)');
  // immune: meter must not change
  const hitsBefore = r2.meter.hitsReceived;
  const ri = tr.applyHit(999, 100, 'physical', 'melee', 'e1', { immuneToStun: true });
  ok(ri.buildupAdded === 0 && ri.hitsToHeavyStun === Infinity, 'stun: immune hit -> no buildup, hits=inf');
  ok(ri.meter.hitsReceived === hitsBefore, 'stun: immune hit does not increment hitsReceived (Hivemind parity)');
  ok(ri.meter.percent === r2.meter.percent, 'stun: immune hit leaves meter percent untouched');
}


// --- log sessions + SCENE (P1: sergeyklay parity) ---
{
  const { parseLogLine } = core;
  const evOpen = parseLogLine('2026/09/28 12:00:00 1 0 ***** LOG FILE OPENING *****');
  ok(evOpen?.kind === 'log_opening' && evOpen?.timestamp === '2026/09/28 12:00:00', 'parseLogLine log_opening (no prefix)');
  const evOpen2 = parseLogLine('2026/09/28 12:00:00 1 0 [INFO Client 123] ***** LOG FILE OPENING *****');
  ok(evOpen2?.kind === 'log_opening', 'parseLogLine log_opening (with prefix)');
  const evScene = parseLogLine('2026/09/28 12:00:05 2 0 [INFO Client 123] [SCENE] Set Source [Tower_of_the_Gods]');
  ok(evScene?.kind === 'scene_source' && evScene?.sceneName === 'Tower_of_the_Gods', 'parseLogLine scene_source');
  const evSceneNull = parseLogLine('2026/09/28 12:00:06 2 0 [INFO Client 123] [SCENE] Set Source [(null)]');
  ok(evSceneNull?.kind === 'scene_source' && evSceneNull?.sceneName === '(null)', 'parseLogLine scene_source placeholder kept raw');
}


// --- resources: PoB2-canon base pools (P1: Hivemind parity + divergence fix) ---
{
  const res = core.core.resources;
  ok(res.maxLife(1) === 28, 'resources: maxLife level 1 = 12+16 = 28 (PoB2 canon)');
  ok(res.maxLife(27) === 340, 'resources: maxLife level 27 = 340 (Hivemind would say 352+24str)');
  ok(res.maxMana(1) === 34, 'resources: maxMana level 1 = 34');
  ok(res.maxMana(27) === 138, 'resources: maxMana level 27 = 138');
  ok(res.maxLife(30, { flat: 100, increasedPercent: 20, moreMultipliers: [0.1] }) === Math.floor((12*30+16+100)*1.2*1.1), 'resources: maxLife flat+inc+more composition');
  ok(res.maxLife(0) === 28 && res.maxLife(999) === res.maxLife(100), 'resources: level clamped to 1..100');
  const regen = res.manaRegenPerSec(100);
  ok(Math.abs(regen - 4) < 1e-9, 'resources: mana regen 4%/s (100 mana -> 4/s)');
  ok(Math.abs(res.manaRegenPerSec(100, 50, 1) - 7) < 1e-9, 'resources: mana regen inc% + flat');
  ok(res.maxEnergyShield({ flat: 150, increasedPercent: 30 }) === 195, 'resources: ES no level base, gear mods only');
}
// --- optimize stage 1 (read-only audit: goals / levers / pinnacle) ---
{
  const opt = core.core.optimize;
  ok(typeof opt.evaluateBuildAgainstGoals === 'function' && typeof opt.rankLevers === 'function' && typeof opt.pinnacleChecklist === 'function', 'optimize: stage-1 exports present');
  const est = await core.core.estimate.estimateBuild(estPobXml);

  // goals
  const checks = opt.evaluateBuildAgainstGoals(est, { dps: 1e12, fireRes: 30 });
  const fire = checks.find((c) => c.metric === 'fireRes');
  ok(fire?.verdict === 'pass' && fire?.gap === 10 && fire?.kind === 'estimated', `optimize: fireRes goal pass (cur 40, gap 10) — got ${JSON.stringify(fire)}`);
  const dps = checks.find((c) => c.metric === 'dps');
  ok(dps?.verdict === 'fail' && dps?.gap != null && dps.gap < 0, 'optimize: unreachable dps goal -> fail with negative gap');
  const chaosCI = opt.evaluateBuildAgainstGoals(await core.core.estimate.estimateBuild(ciXml), { chaosRes: 0 });
  const ciChaos = chaosCI.find((c) => c.metric === 'chaosRes');
  ok(ciChaos?.verdict === 'pass' && ciChaos?.current === null, 'optimize: CI chaos goal auto-pass (immunity)');

  // levers (fixed set: 4 computed-EHP + 2 estimated-weapon)
  const levers = opt.rankLevers(est);
  ok(levers.length === 6, `optimize: fixed lever set (${levers.length})`);
  const flatLife = levers.find((l) => l.lever.includes('flat life'));
  ok(flatLife && (flatLife.deltaEhp.chaos ?? 0) > 0, 'optimize: +life raises chaos EHP');
  const armour = levers.find((l) => l.lever.includes('брони'));
  ok(armour && (armour.deltaEhp.physical ?? 0) > 0 && (armour.deltaEhp.fire ?? -1) === 0, 'optimize: +armour affects physical only');
  const sorted = levers.filter((l) => l.avgPercentGain > 0).every((l, i, arr) => i === 0 || arr[i - 1].avgPercentGain >= l.avgPercentGain);
  ok(sorted, 'optimize: levers sorted by avgPercentGain desc');
  const wlevers = levers.filter((l) => l.deltaDpsEstimated);
  ok(wlevers.length === 2 && wlevers.every((l) => l.note.startsWith('estimated')), 'optimize: weapon levers are estimated and flagged');

  // pinnacle checklist
  const pin = opt.pinnacleChecklist(est, { enemyLevel: 84, boss: 'pinnacle' });
  // №130-ф2: к 6 вердикт-чекам добавлена инфо-строка «самый слабый слой EHP»
  // (unknown-вердикт). Считаем по вердиктам, а не по длине — инфо-строка не чек.
  const pinVerdicts = pin.checks.filter((c) => c.verdict !== 'unknown');
  ok(pin.enemy.level === 84 && pinVerdicts.length === 6, `optimize: pinnacle verdict-checks = 6 vs lvl ${pin.enemy.level} (got ${pinVerdicts.length})`);
  const pinInfo = pin.checks.find((c) => c.item.includes('слабый слой EHP'));
  ok(!!pinInfo && /инфо$/.test(pinInfo.item), 'optimize: worst-EHP info row present (№130-ф2)');
  const physRow = pin.checks.find((c) => c.item.includes('физ. удара'));
  ok(!!physRow, 'optimize: EHP threshold compares PHYSICAL layer vs boss hit (№130-ф2)');
  const resists = pin.checks.filter((c) => c.item.startsWith('fire') || c.item.startsWith('cold') || c.item.startsWith('lightning'));
  ok(resists.every((c) => c.verdict === 'fail'), 'optimize: uncapped resists (40/…<75) fail vs pinnacle');
  const stunItem = pin.checks.find((c) => c.item.includes('Heavy Stun'));
  ok(stunItem?.kind === 'computed' && (stunItem.verdict === 'pass' || stunItem.verdict === 'fail'), 'optimize: stun resilience computed');
  const pinCI = opt.pinnacleChecklist(await core.core.estimate.estimateBuild(ciXml), {});
  ok(pinCI.checks.find((c) => c.item.includes('chaos'))?.verdict === 'pass', 'optimize: CI chaos pass in checklist');
}

console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
