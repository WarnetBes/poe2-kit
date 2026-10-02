// smoke_n104.mjs — №104 Бестиарий боссов (живой core dist)
import { CAMPAIGN_BOSSES, ASC_TRIAL_BOSSES, SEKHEMAS_BOSSES, PINNACLE_BOSSES, ALL_BOSSES, bossByZoneCode, campaignBossesByAct } from '../../packages/core/dist/bosses.js';
import { buildCampaignPlan } from '../../packages/core/dist/zoneNotes.js';

let fails = 0;
const check = (n, c, e = '') => { console.log((c ? '  OK  ' : 'FAIL  ') + n + (c ? '' : ' ' + e)); if (!c) fails++; };

check('ALL = story+trials+sekhemas+pinnacle', ALL_BOSSES.length === CAMPAIGN_BOSSES.length + ASC_TRIAL_BOSSES.length + SEKHEMAS_BOSSES.length + PINNACLE_BOSSES.length, `${ALL_BOSSES.length} vs ${CAMPAIGN_BOSSES.length}+${ASC_TRIAL_BOSSES.length}+${SEKHEMAS_BOSSES.length}+${PINNACLE_BOSSES.length}`);
check('pinnacle 10 (Arbiter x2, Xesht, Bodach, Aberration, Raven, Kulemak, Atziri, Tang.Mazu, Olroth)', PINNACLE_BOSSES.length === 10, String(PINNACLE_BOSSES.length));
check('sekhemas: лестница этажей 1..4', SEKHEMAS_BOSSES.length === 4 && SEKHEMAS_BOSSES.map(b => b.floor).join(',') === '1,2,3,4', JSON.stringify(SEKHEMAS_BOSSES.map(b => b.floor)));
check('каждый пиннакл имеет access', PINNACLE_BOSSES.every(b => !!b.access && !!b.zone));
check('каждый сюжетный босс имеет act и zone', CAMPAIGN_BOSSES.every(b => b.act != null && !!b.zone));
check(' сюжетные боссы уникальны по имени+зоне',
  new Set(CAMPAIGN_BOSSES.map(b => b.name + '@' + b.zone)).size === CAMPAIGN_BOSSES.length);

const b = bossByZoneCode('G1_2');
check('G1_2 (Clearfell) → Беира', b && b.name === 'Беира', JSON.stringify(b));
check('G1_15 → Граф Геонор (финал акта 1, №143b)', bossByZoneCode('G1_15')?.reward?.includes('финал акта') && bossByZoneCode('G1_15')?.name === 'Граф Геонор');
check('G2_2 → Балбала (+асценданси)', bossByZoneCode('G2_2')?.reward?.includes('асценданси'));
check('G3_17 → Дорияни', bossByZoneCode('G3_17')?.name === 'Дорияни');
check('G4_11_2 → Тавакаи', bossByZoneCode('G4_11_2')?.name === 'Тавакаи');
check('неизвестный код → null', bossByZoneCode('G9_9') === null);

const perAct = [1, 2, 3, 4].map(a => campaignBossesByAct(a).length);
check('акты 1..4 непусты', perAct.every(n => n > 0), JSON.stringify(perAct));

// кампания-план несёт boss в строках
const plan = buildCampaignPlan({ available: true, act: 1, level: null, zone: { areaCode: 'G1_2', areaLevel: 3, zoneName: 'Clearfell' }, zoneVisits: [] }, {});
const cf = plan.rows.find(r => r.zone === 'Clearfell');
check('маршрут: Clearfell c боссом', cf && cf.boss && cf.boss.name === 'Беира', JSON.stringify(cf && cf.boss));
const nb = plan.rows.find(r => r.zone === 'Mud Burrow');
check('маршрут: Mud Burrow с боссом Девор', nb && nb.boss && nb.boss.name === 'Девор', JSON.stringify(nb && nb.boss));
check('маршрут: зоны без босса → boss undefined', plan.rows.some(r => !r.boss));

console.log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
