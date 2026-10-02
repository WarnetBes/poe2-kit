// smoke_n103.mjs — №103 Campaign Companion: buildCampaignPlan (core, живой dist)
import { buildCampaignPlan, getZoneNoteByName } from '../../packages/core/dist/zoneNotes.js';

let fails = 0;
function check(name, cond, extra = '') {
  console.log(cond ? `  OK  ${name}` : `FAIL  ${name} ${extra}`);
  if (!cond) fails++;
}

// 1. База: 65-зонный план, акт 1
const p1 = buildCampaignPlan(null, { actFallback: 1 });
check('act1 total=15', p1.total === 15, `got ${p1.total}`);
check('act1 actName RU', /Акт 1/.test(p1.actName), p1.actName);
check('act1 all todo (no state)', p1.rows.every(r => r.status === 'todo'));
check('act1 currentIndex=-1', p1.currentIndex === -1);
check('act1 actNote non-empty', p1.actNote.length > 10);
const riverbank = p1.rows[0];
check('row has note', riverbank.note.length > 0, JSON.stringify(riverbank));

// 2. Зона-код резолвится и матчится как current
const code = getZoneNoteByName('Clearfell')?.zoneCode;
check('Clearfell zoneCode resolved', !!code, String(code));
const st = {
  available: true,
  act: 1,
  level: null,
  zone: { areaCode: code, areaLevel: 3, zoneName: 'Clearfell' },
  zoneVisits: [{ areaCode: getZoneNoteByName('The Riverbank')?.zoneCode, areaLevel: 1, zoneName: 'The Riverbank' }],
};
const p2 = buildCampaignPlan(st, { visitedCodes: st.zoneVisits.map((v) => v.areaCode) });
check('Clearfell is current', p2.rows[1].status === 'current');
check('Riverbank done (visited)', p2.rows[0].status === 'done');
check('currentIndex=1', p2.currentIndex === 1);
check('done count=1', p2.done === 1);
check('level proxy=3', p2.level === 3);
check('levelDelta for Clearfell=0', p2.rows[1].levelDelta === 0);
check('todo остальное', p2.rows.slice(2).every(r => r.status === 'todo'));

// 3. furthest-прогресс: перекрывает потерянное окно хвоста
const p3 = buildCampaignPlan(null, { actFallback: 1, furthest: { act: 1, index: 5 } });
check('furthest: 5 done', p3.done === 5, `got ${p3.done}`);
check('furthest: currentIndex=-1 (без клиента)', p3.currentIndex === -1);

// 4. furthest акт > текущего: весь акт пройден
const p4 = buildCampaignPlan(null, { actFallback: 1, furthest: { act: 2, index: 0 } });
check('act cleared: все done', p4.rows.every(r => r.status === 'done') && p4.done === 15);

// 5. RU-имя текущей зоны (клиент RU, areaCode null)
const p5 = buildCampaignPlan({ available: true, act: 1, level: null, zone: { areaCode: null, areaLevel: 3, zoneName: 'Clearfell' }, zoneVisits: [] }, {});
check('RU?? EN-name match current', p5.rows[1].status === 'current');

// 6. Акт 2 без состояния
const pA2 = buildCampaignPlan(null, { actFallback: 2 });
check('act2 total=18', pA2.total === 18, `got ${pA2.total}`);

console.log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
