// №256-смок (Радар, Этап 4-2): MCP-тулы poe2_known_issues + poe2_tricks.
// Проверяет: (1) dist-компиляция тулов, (2) регистрация в index (ровно 65),
// (3) handler-кейсы: live-фильтр, точечный id, query-подстрока, unverified-пометки,
// fixed с fixed_in, tricks query/category, пустой результат - не ошибка.
// Требует собранных dist (npm run build в core и mcp) — как соседние смоки.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRadarTools } from '../../apps/mcp/dist/tools/radar.js';

let fail = 0;
function need(ok, n, msg) {
  if (!ok) { console.log('FAIL ' + n + ': ' + msg); fail++; }
  else console.log('OK ' + n + ': ' + msg);
}

// 1. dist тулов скомпилирован: имена + structured-контракт
const distSrc = readFileSync('apps/mcp/dist/tools/radar.js', 'utf8');
need(/poe2_known_issues/.test(distSrc) && /poe2_tricks/.test(distSrc)
  && /structuredContent/.test(distSrc),
  1, 'dist/tools/radar.js: оба тула + structured JSON-выход');

// 2. Регистрация: dist/index.js зовёт registerRadarTools; --smoke = 65
const distIndex = readFileSync('apps/mcp/dist/index.js', 'utf8');
need(/registerRadarTools/.test(distIndex), 2, 'dist/index.js: registerRadarTools');
const smoke = spawnSync(process.execPath, ['apps/mcp/dist/index.js', '--smoke'], { encoding: 'utf8' });
const smokeOut = smoke.stderr + smoke.stdout;
need(smoke.status === 0 && /\[smoke\] Registered tools: 65\b/.test(smokeOut),
  3, 'index --smoke: exit 0, ровно 65 тулов');
need(/^\s*- poe2_known_issues$/m.test(smokeOut) && /^\s*- poe2_tricks$/m.test(smokeOut),
  4, 'index --smoke: оба радар-тула в списке __poe2Registered');

// 3. Handler напрямую
const server = new McpServer({ name: 'smoke-radar', version: '0' });
const captured = [];
const origRegister = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => {
  captured.push({ name, handler });
  return origRegister(name, config, handler);
};
const added = registerRadarTools(server);
need(added === 2 && captured.length === 2
  && captured[0]?.name === 'poe2_known_issues' && captured[1]?.name === 'poe2_tricks',
  5, 'registerRadarTools: добавлены 2 тулa');
const issuesHandler = captured[0]?.handler;
const tricksHandler = captured[1]?.handler;
const textOf = (r) => r?.content?.map((c) => c.text).join('\n') ?? '';

// (a) issues: status=live — только живые, у каждого источники
const resLive = await issuesHandler({ status: 'live' }, {});
const live = resLive?.structuredContent;
need(live?.issues?.length > 0 && live.issues.every((i) => i.status === 'live')
  && live.issues.every((i) => Array.isArray(i.sources) && i.sources.length > 0)
  && textOf(resLive).includes('Радар PoE2'),
  6, '(a) issues live: непусто, только live, sources у каждой');

// (b) issues: точечный id — delirium-island-arena (волна-2 №256)
const resId = await issuesHandler({ id: 'delirium-island-arena' }, {});
need(resId?.structuredContent?.total === 1
  && resId.structuredContent.issues[0]?.title.includes('unable-to-proceed')
  && textOf(resId).includes('Воркараунд'),
  7, '(b) issues id: delirium-island-arena найден');

// (c) issues: fixed — каждая с fixed_in; Trial of Chaos в 0.5.5b
const resFixed = await issuesHandler({ status: 'fixed' }, {});
need(resFixed?.structuredContent?.issues?.length >= 3
  && resFixed.structuredContent.issues.every((i) => typeof i.fixed_in === 'string' && i.fixed_in.length > 0)
  && resFixed.structuredContent.issues.some((i) => i.fixed_in === '0.5.5b'),
  8, '(c) issues fixed: fixed_in обязателен, Trial-of-Chaos в 0.5.5b');

// (d) issues: query + честность unverified ❓
const resQ = await issuesHandler({ query: 'abyss' }, {});
need(resQ?.structuredContent?.total >= 2
  && textOf(resQ).includes('Abyss'),
  9, '(d) issues query=abyss: >=2 записи');
const resMiss = await issuesHandler({ query: 'zz-nonexistent' }, {});
need(resMiss?.structuredContent?.total === 0 && textOf(resMiss).includes('Ничего не найдено')
  && resMiss.isError == null,
  10, '(d) issues промах: total=0, не ошибка');
const resUnv = await issuesHandler({ status: 'unverified' }, {});
need(resUnv?.structuredContent?.issues?.length > 0
  && resUnv.structuredContent.issues.every((i) => typeof i.unverified === 'string')
  && textOf(resUnv).includes('❓'),
  11, '(e) issues unverified: помечены ❓ и несут пояснение');

// (f) tricks: все + category=party
const resT = await tricksHandler({}, {});
const resParty = await tricksHandler({ category: 'party' }, {});
need(resT?.structuredContent?.tricks?.length >= 5
  && resT.structuredContent.tricks.every((t) => t.risk !== 'ban'),
  12, '(f) tricks: >=5, риск бана в наборе отсутствует');
need(resParty?.structuredContent?.tricks?.length >= 2
  && resParty.structuredContent.tricks.every((t) => t.category === 'party'),
  13, '(f) tricks category=party: изолированная выборка');
const resTId = await tricksHandler({ id: 'ritual-postpone-limit' }, {});
need(resTId?.structuredContent?.total === 1
  && textOf(resTId).includes('Как использовать'),
  14, '(g) tricks id: ritual-postpone-limit + usage-строка');

if (fail) { console.error('SMOKE N256-RADAR FAILED'); process.exit(1); }
console.log('SMOKE N256-RADAR: ALL OK');
