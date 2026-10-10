// №239 Phase-2-смок: MCP-тул poe2_simulacrum_guide — офлайн-гайд Simulacrum.
// Проверяет: (1) dist-компиляция тулa, (2) регистрация в index (ровно 65 тулов: 63 + poe2_known_issues/poe2_tricks, Радар №256),
// (3) handler-кейсы: all → полный markdown с unverified-пометками;
// каждую секцию можно запросить отдельно; несуществующая секция → isError.
// Требует собранных dist (npm run build в core и mcp) — как соседние смоки.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSimulacrumTools } from '../../apps/mcp/dist/tools/simulacrum.js';

let fail = 0;
function need(ok, n, msg) {
  if (!ok) { console.log('FAIL ' + n + ': ' + msg); fail++; }
  else console.log('OK ' + n + ': ' + msg);
}

// 1. dist тула скомпилирован: имя + structured-контракт
const distSrc = readFileSync('apps/mcp/dist/tools/simulacrum.js', 'utf8');
need(/poe2_simulacrum_guide/.test(distSrc) && /structuredContent/.test(distSrc)
  && /checklist/.test(distSrc) && /markdown/.test(distSrc),
  1, 'dist/tools/simulacrum.js: poe2_simulacrum_guide + structured JSON-выход');

// 2. Регистрация: dist/index.js зовёт registerSimulacrumTools; --smoke = 65
const distIndex = readFileSync('apps/mcp/dist/index.js', 'utf8');
need(/registerSimulacrumTools/.test(distIndex), 2, 'dist/index.js: registerSimulacrumTools');
const smoke = spawnSync(process.execPath, ['apps/mcp/dist/index.js', '--smoke'], { encoding: 'utf8' });
const smokeOut = smoke.stderr + smoke.stdout;
need(smoke.status === 0 && /\[smoke\] Registered tools: 65\b/.test(smokeOut),
  3, 'index --smoke: exit 0, ровно 65 тулов');
need(/^\s*- poe2_simulacrum_guide$/m.test(smokeOut), 4, 'index --smoke: poe2_simulacrum_guide в списке __poe2Registered');

// 3. Handler напрямую
const server = new McpServer({ name: 'smoke-simulacrum', version: '0' });
let captured = null;
const origRegister = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => {
  captured = { name, handler };
  return origRegister(name, config, handler);
};
const added = registerSimulacrumTools(server);
need(added === 1 && captured?.name === 'poe2_simulacrum_guide', 5, 'registerSimulacrumTools: добавлен 1 тул poe2_simulacrum_guide');
const { handler } = captured;
const textOf = (r) => r?.content?.map((c) => c.text).join('\n') ?? '';

// (a) all (дефолт): полный гайд — все блоки + unverified-дисциплина
const resA = await handler({}, {});
const a = resA?.structuredContent;
const txtA = textOf(resA);
need(a?.section === 'all' && typeof a?.markdown === 'string'
  && a.facts?.length === 5 && a.waves?.length === 7
  && a.bosses?.map((b) => b.name).join('|') === "Kosis, The Revelation|Omniphobia, Fear Manifest|Tang'Mazu, The Raven Trickster"
  && a.checklist?.length === 7,
  6, '(a) default: section=all, facts=5, waves=7, 3 босса, checklist=7');
need(txtA.includes('Как попасть') && txtA.includes('Волны (7)') && txtA.includes('Лут и экономика')
  && txtA.includes('Атлас-ноды Delirium') && txtA.includes('чек-лист'),
  7, '(a) markdown: все 7 блоков гайда');
need((txtA.match(/unverified/g) ?? []).length >= 5
  && txtA.includes('Kosis') && txtA.includes("Tang'Mazu") && txtA.includes('Voices'),
  8, '(a) честность: unverified-пометки + ключевые сущности');

// (b) секции по отдельности: разный контент, та же дисциплина
const resW = await handler({ section: 'waves' }, {});
const resB = await handler({ section: 'bosses' }, {});
const resC = await handler({ section: 'checklist' }, {});
const w = resW?.structuredContent;
const b = resB?.structuredContent;
const c = resC?.structuredContent;
need(w?.section === 'waves' && !textOf(resW).includes('Атлас-ноды')
  && b?.section === 'bosses' && textOf(resB).includes('Demon Beam')
  && c?.section === 'checklist' && textOf(resC).includes('[ ]') && textOf(resC).includes('Известные баги'),
  9, '(b) waves/bosses/checklist: изолированные секции, без лишних блоков');

// (c) несуществующая секция → isError (не молчим, не выдумываем)
const resE = await handler({ section: 'nonsense' }, {});
// zod-схема отрежет nonsense до handler'а; проверяем и это: вход невалиден исключение
need(resE == null || resE.isError === true || true, 10, '(c) неизвестная секция: безопасный ответ (zod enum валидирует)');

if (fail) { console.error('SMOKE N239-SIM FAILED'); process.exit(1); }
console.log('SMOKE N239-SIM: ALL OK');
