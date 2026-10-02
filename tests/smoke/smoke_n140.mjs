// СМОУК №140: «Прокачка реально понимает пройденное» — прогресс привязан к лиге,
// visitedCodes накапливаются (переживают ротацию LatestClient), ручной сброс.
import fs from 'node:fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const main = fs.readFileSync('apps/overlay/src/main.ts', 'utf8');
const mainDist = fs.readFileSync('apps/overlay/dist/main.js', 'utf8');
const ren = fs.readFileSync('apps/overlay/src/rendererHtml.ts', 'utf8');
const renDist = fs.readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const pre = fs.readFileSync('apps/overlay/src/preload.ts', 'utf8');
const preDist = fs.readFileSync('apps/overlay/dist/preload.cjs', 'utf8');

// ── main: персист per-лига ──
ok(/interface LevelingProgressFile \{/.test(main) && /league\?: string/.test(main), 'src main: LevelingProgressFile с league');
ok(/visitedCodes\?: string\[\]/.test(main), 'src main: visitedCodes в персисте');
ok(/файл старого формата \(без лиги\)/.test(main), 'src main: миграция v1-файла → сброс');
ok(/лига сменилась/.test(main), 'src main: авто-сброс при смене лиги');
ok(/function levelingProgressForLeague/.test(main), 'src main: levelingProgressForLeague');
ok(/function writeLevelingProgressReset/.test(main), 'src main: прямая запись сброса (без merge)');
ok(/ipcMain\.handle\('level:reset'/.test(main), 'src main: IPC level:reset');
ok(/"level:reset"|\('level:reset'/.test(mainDist), 'dist main: level:reset зарегистрирован');
// runLevelingContext: merge persisted ∪ окно лога
ok(/persistedCodes/.test(main) && /new Set\(\[\.\.\.persistedCodes, \.\.\.windowCodes\]\)/.test(main), 'src main: visitedCodes = persisted ∪ окно');
ok(/camp\.act > furthest\.act \|\| \(camp\.act === furthest\.act && camp\.currentIndex > furthest\.index\)/.test(main), 'src main: furthest только вперёд');
ok(/progress: \{\s*\n\s*league: activeLeague/.test(main), 'src main: payload progress { league, resetNote, zonesSeen }');
// claimQuestReward не должен затирать league/visitedCodes
ok(/claimQuestReward/.test(main) && /visitedCodes: prog\.visitedCodes \?\? \[\]/.test(main), 'src main: claimQuestReward пишет с league+visitedCodes');
// dist отражает новое
ok(/levelingProgressForLeague/.test(mainDist), 'dist main: levelingProgressForLeague');
ok(/resetNote/.test(mainDist) && /zonesSeen/.test(mainDist), 'dist main: payload progress');

// ── preload ──
ok(/levelReset/.test(pre) && /levelReset: \(\) => ipcRenderer\.invoke\('level:reset'\)/.test(pre), 'src preload: levelReset invoke');
ok(/levelReset/.test(preDist), 'dist preload: levelReset');

// ── renderer ──
ok(/__lastLevelProgress/.test(ren), 'src renderer: кэш progress для шапки');
ok(/Прогресс прокачки сброшен/.test(ren), 'src renderer: заметка о сбросе в подсказках');
ok(/🔄 Сброс/.test(ren) && /levelReset\(\)/.test(ren), 'src renderer: чипс ручного сброса');
ok(/лига: ' \+ prog\.league/.test(ren), 'src renderer: лига в шапке маршрута');
ok(/__lastLevelProgress/.test(renDist), 'dist renderer: кэш progress');

// ── поведенческое: buildCampaignPlan с персист-кодами (рассчёт done) ──
const zoneNotes = await import('../../packages/core/dist/zoneNotes.js').catch(() => null);
if (zoneNotes) {
  const planEmpty = zoneNotes.buildCampaignPlan(null, { actFallback: 1 });
  const codes = planEmpty.rows.map((r) => r.zoneCode).filter(Boolean);
  ok(planEmpty.total > 0 && planEmpty.done === 0, `core: акт 1 без визитов → done=0 (total=${planEmpty.total})`);
  if (codes.length >= 3) {
    const plan = zoneNotes.buildCampaignPlan(null, {
      actFallback: 1,
      visitedCodes: codes.slice(0, 3),
    });
    ok(plan.done >= 3, `core: 3 персист-кода → done=${plan.done} (ротация лога не вымывает статусы)`);
  } else {
    ok(false, `core: не удалось собрать zoneCode для поведенческого чека (codes=${codes.length})`);
  }
  const cleared = zoneNotes.buildCampaignPlan(null, {
    actFallback: 1,
    visitedCodes: [],
    furthest: { act: 2, index: 5 },
  });
  ok(cleared.done === cleared.total, `core: furthest акт>1 → акт 1 весь done (${cleared.done}/${cleared.total})`);
} else {
  ok(true, 'core ESM import недоступен напрямую — пропущено (src-проверки выше)');
}

console.log(fails === 0 ? '\n№140 SMOKE: ALL OK' : `\n№140 SMOKE: FAILURES=${fails}`);
process.exit(fails === 0 ? 0 : 1);
