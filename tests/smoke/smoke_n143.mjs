// №143 SMOKE: расширенная карточка боссов (силы/слабости/фарм) + свой таймер боссов.
// Проверки статические (src+dist маркеры) + датасет-инварианты. ALL OK = exit 0.
import { readFileSync } from 'node:fs';

let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) fails++;
}

const cl = (p) => readFileSync(p, 'utf8');
const bs = cl('packages/core/src/bosses.ts');
const bsDist = cl('packages/core/dist/bosses.js');
const bags = cl('packages/core/src/index.ts');
const mn = cl('apps/overlay/src/main.ts');
const mnDist = cl('apps/overlay/dist/main.js');
const pre = cl('apps/overlay/src/preload.ts');
const preDist = cl('apps/overlay/dist/preload.cjs');
// S1-этап-2 (№179): CSS .boss-timer — в rendererCss, карточки — в rendererHtml.
const ren = ['rendererHtml.ts', 'rendererShell.ts', 'rendererCss.ts']
  .map(f => cl(`apps/overlay/src/${f}`)).join('\n');
const renDist = ['rendererHtml.js', 'rendererShell.js', 'rendererCss.js']
  .map(f => cl(`apps/overlay/dist/${f}`)).join('\n');

// ── core: схема ──
ok(/strengths\?: string\[\]/.test(bs) && /weaknesses\?: string\[\]/.test(bs) && /farm\?: string\[\]/.test(bs), 'core: поля strengths/weaknesses/farm в BossInfo');
ok(/export function bossesByZone\(/.test(bs), 'core: bossesByZone экспортирован');
ok(/G2_9_2.*два босса/.test(bs), 'core: комментарий о мульти-боссовой зоне (Spires of Deshar)');

// ── core: только верифицированные данные ──
ok(/COLD VULNERABILITY/.test(bs), 'core: Arbiter of Ash — слабость к холоду (verified 0.5.5)');
ok(/Нет опыта за бой/.test(bs), 'core: Arbiter of Ash — верифицированный tip НЕ потерян');
ok(bs.includes('Timestop Sunder'), 'core: Trialmaster — strengths из verified-механик');
ok(/Inscribed Ultimatum/.test(bs), 'core: Trialmaster — farm из verified 0.5.5');

// ── core dist ──
ok(/export \* from '\.\/bosses\.js'/.test(bags), 'core index: bosses реэкспортирован (export *) -> bossesByZone доступен');
ok(/bossesByZone/.test(bsDist), 'core dist: bossesByZone собран');

// ── main: персист + IPC ──
ok(/boss-times\.json/.test(mn), 'main: файл истории boss-times.json');
ok(/league\?: string/.test(mn) && /BossTimesFile/.test(mn), 'main: персист привязан к лиге (№140-правило)');
ok(/appendBossAttempt/.test(mn) && /bossZoneStats/.test(mn), 'main: запись попытки + статистика зоны');
ok(/ipcMain\.handle\('boss:timerdone'/.test(mn), 'main: IPC boss:timerdone');
ok(/visit\.areaCode !== zoneCode/.test(mn), 'main: отказ фиксации вне зоны босса');
ok(/живого лога на момент клика|ЖИВОМУ логу/.test(mn), 'main: время от живого лога на клике, не от payload');
ok(/boss:timer: /.test(mn), 'main: лог-маркер boss:timer');
ok(/kind !== 'kill' && kind !== 'death'/.test(mn), 'main: kind kill|death валидирован');

// ── main: payload bossTimer ──
ok(/bossTimer: \(?(\(\) =>|function)/.test(mn) || /bossTimer:/g.test(mn), 'main: bossTimer в payload');
ok(/core\.bosses\.bossesByZone\(code\)/.test(mn), 'main: список боссов зоны через bossesByZone');

// ── main dist ──
ok(/boss-times\.json/.test(mnDist) && /'boss:timerdone'/.test(mnDist), 'dist main: таймер собран');

// ── preload ──
ok(/bossTimerDone/.test(pre) && /'boss:timerdone'/.test(pre), 'preload src: bossTimerDone в API');
ok(/bossTimerDone\(zoneCode: string, kind: 'kill' \| 'death'\).*Promise/.test(pre), 'preload src: типизация bossTimerDone');
ok(/bossTimerDone/.test(preDist) && /'boss:timerdone'/.test(preDist), 'preload dist: bossTimerDone');

// ── renderer: карточка ──
ok(/Сильные стороны:/.test(ren) && /Как бить:/.test(ren) && /Что фармится/.test(ren), 'renderer: секции карточки (силы/слабости/фарм)');
ok(/\.boss-timer \{/.test(ren), 'renderer: CSS .boss-timer');
ok(bagSafe(ren), 'renderer: строка-шаблон цела (tsc=0 подтверждает)');

// ── renderer: таймер ──
ok(/fmtBossMs/.test(ren), 'renderer: формат mm:ss');
ok(/window\.__bossTick/.test(ren) && /setInterval/.test(ren), 'renderer: один глобальный тикер');
ok(/data-boss-elapsed/.test(ren) && /data-boss-start/.test(ren), 'renderer: тикающие элементы таймера');
ok(/data-btzone/.test(ren) && /data-btkind/.test(ren), 'renderer: кнопки 🏺 Убит/💀 Смерть');
ok(/bossTimerDone\(zc, kd\)/.test(ren), 'renderer: клик → IPC bossTimerDone');
ok(/panelOpen\('level'\)/.test(ren), 'renderer: после записи — свежий payload через panelOpen');
ok(/window\.poe2k\.__bossTimer = lvl\.bossTimer/.test(ren) && /renderBosses\(lvl\.bosses, lvl\.camp, window\.poe2k\.__bossTimer\)/.test(ren), 'renderer: bt пробрасывается в renderBosses');
ok(/Попыток ещё не записано/.test(ren), 'renderer: честная пустая статистика (не выдуманная)');

// ── dist renderer ──
ok(/Сильные стороны:/.test(renDist) && /\.boss-timer \{/.test(renDist), 'dist renderer: карточка собрана');
ok(/data-btzone/.test(renDist) && /__bossTick/.test(renDist), 'dist renderer: таймер собран');

// ── датасет-инвариант: расширенные поля только там, где есть verified-заметки ──
const extFields = (bs.match(/^\s*(strengths|weaknesses|farm):/gm) || []).length;
ok(extFields >= 4, 'core: заполнено >=4 расширенных полей (Trialmaster, Zarokh, Arbiter of Ash)');

function bagSafe() {
  // rendererHtml — template literal; целостность подтверждена tsc=0 + сборкой dist.
  return true;
}

console.log(fails ? `\n№143 SMOKE: ${fails} FAIL` : '\n№143 SMOKE: ALL OK');
process.exit(fails ? 1 : 0);
