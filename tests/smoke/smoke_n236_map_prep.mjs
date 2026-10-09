// №236-смок (Map Prep, Этап 3): MCP-тул poe2_map_prep — регистрация (62 тула)
// + вызов handler'а собранного dist по кейсам:
//   (a) map+mods+tier → of_exposure смэтчен, debuff max_res, area level по тиру;
//   (b) pob (PoB-XML) и defensiveStats → персональные checks, build_provided;
//   (c) unknown-мод → честный unknown_mods;
//   (d) без билда → build_provided=false + честная пометка в advice.
// Требует собранных dist (npm run build в core и mcp) — как соседние смоки.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMapPrepTools } from '../../apps/mcp/dist/tools/mapPrep.js';

let fail = 0;
function need(ok, n, msg) {
  if (!ok) { console.log('FAIL ' + n + ': ' + msg); fail++; }
  else console.log('OK ' + n + ': ' + msg);
}

// 1. dist тула скомпилирован: имя + structuredContent-контракт
const distSrc = readFileSync('apps/mcp/dist/tools/mapPrep.js', 'utf8');
need(/poe2_map_prep/.test(distSrc) && /structuredContent/.test(distSrc)
  && /unknown_mods/.test(distSrc) && /build_provided/.test(distSrc),
  1, 'dist/tools/mapPrep.js: poe2_map_prep + structured JSON-выход');

// 2. Регистрация: dist/index.js зовёт registerMapPrepTools; --smoke = 62, тул в списке
const distIndex = readFileSync('apps/mcp/dist/index.js', 'utf8');
need(/registerMapPrepTools/.test(distIndex), 2, 'dist/index.js: registerMapPrepTools');
const smoke = spawnSync(process.execPath, ['apps/mcp/dist/index.js', '--smoke'], { encoding: 'utf8' });
const smokeOut = smoke.stderr + smoke.stdout;
const m62 = /\[smoke\] Registered tools: 62\b/.test(smokeOut);
need(smoke.status === 0 && m62, 3, 'index --smoke: exit 0, ровно 62 тулов');
need(/^\s*- poe2_map_prep$/m.test(smokeOut), 4, 'index --smoke: poe2_map_prep в списке __poe2Registered');

// 3. Перехватываем registerTool (как index.ts) и зовём handler напрямую
const server = new McpServer({ name: 'smoke-map-prep', version: '0' });
let captured = null;
const origRegister = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => {
  captured = { name, handler };
  return origRegister(name, config, handler);
};
const added = registerMapPrepTools(server);
need(added === 1 && captured?.name === 'poe2_map_prep', 5, 'registerMapPrepTools: добавлен 1 тул poe2_map_prep');
const { handler } = captured;
const textOf = (r) => r?.content?.map((c) => c.text).join('\n') ?? '';

// (a) map + mods + tier: of_exposure смэтчен, max_res-дебафф, area level по тиру
const resA = await handler({ map: 'Rustbowl', mods: ['Players have minus (9 to 12)% to all maximum Resistances'], tier: 12 }, {});
const a = resA?.structuredContent;
need(a?.threat?.matchedMods?.some((m) => m.mod === 'of_exposure') === true
  && a?.threat?.playerDebuffs?.[0]?.effect === 'max_res'
  && a?.threat?.area_level === 76
  && a?.build_provided === false
  && textOf(resA).includes('Билд не передан'),
  6, '(a) Rustbowl T12 + of Exposure: смэтчен (max_res), area 76, честная пометка про билд');

// (b-1) defensiveStats: персональные checks присутствуют
const resB = await handler({ map: 'Rustbowl', tier: 12, defensiveStats: { life: 5000, fireRes: 60, coldRes: 75, lightningRes: 75, chaosRes: 0 } }, {});
const b = resB?.structuredContent;
need(b?.build_provided === true && Array.isArray(b?.checks) && b.checks.length > 0
  && b.checks.every((c) => typeof c.check === 'string' && typeof c.passed === 'boolean' && typeof c.advice_ru === 'string')
  && b.advice_markdown.includes('Подготовка к карте'),
  7, '(b-1) defensiveStats: checks[' + (b?.checks?.length ?? 0) + '] + advice_markdown');

// (b-2) pob (PoB-XML) через существующий конвейер estimateBuild → checks
const POB_XML = `<PathOfBuilding>
  <Build level="80" className="Monk" ascendClassName="Invoker"/>
  <Items activeItemSet="1">
    <Item id="1">Rarity: Rare
Smoke Vest
Vest
--------
+80 to maximum Life
+20% to Fire Resistance
+30% to Chaos Resistance</Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
</PathOfBuilding>`;
const resC = await handler({ map: 'Rustbowl', tier: 12, mods: ['of Exposure'], pob: POB_XML }, {});
const c = resC?.structuredContent;
const expChk = c?.checks?.find((x) => x.check === 'exposure_max_res_compensation');
need(c?.build_provided === true && Array.isArray(c?.checks) && c.checks.length > 0 && expChk != null
  && c.advice_markdown.includes('Подготовка к карте'),
  8, '(b-2) pob-XML: конвейер estimateBuild → checks + exposure-чек');

// (c) unknown-мод → честный unknown_mods (без выдумки)
const resD = await handler({ map: 'Rustbowl', mods: ['Absolutely Made Up Mod 999'] }, {});
const d = resD?.structuredContent;
need(d?.unknown_mods?.includes('Absolutely Made Up Mod 999') === true
  && d?.threat?.matchedMods?.length === 0,
  9, '(c) выдуманный мод → unknown_mods, matchedMods пуст');

// (d) некорректная карта → isError с подсказкой, не крэш
const resE = await handler({ map: 'No Such Map XYZ' }, {});
need(resE?.isError === true && textOf(resE).includes('Ошибка map_prep'),
  10, '(d) несуществующая карта → isError-ответ, не падение');

if (fail) { console.error('SMOKE N236 FAILED'); process.exit(1); }
console.log('SMOKE N236: ALL OK');
