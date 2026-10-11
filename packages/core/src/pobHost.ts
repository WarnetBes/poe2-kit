/**
 * Headless-PoB2 хост: обвязка line-JSON-RPC поверх oracle/headless/pob_host.lua
 * (эпика headless-оракул, Фаза 1 — решение владельца от 11.10.2026).
 *
 * Архитектура (паттерны MIT-донора poe2-exile-architect, © 2026 Max Wilk;
 * протокол/DEFAULT_STATS/lua-utf8-стаб — контрольный файл oracle/headless/pob_host.lua):
 *   - PoB-код НЕ патчится: движок апстрима PathOfBuilding-PoE2 грузится штатным
 *     HeadlessWrapper.lua; билд подаётся готовым XML (наш pobcode.decodeShareCode
 *     уже умеет инфляцию на TS-стороне — патч-бюджет экономим).
 *   - Русским «одним запросом» (one-shot): MCP пишет JSON-RPC строки в stdin,
 *     закрывает его, читает построчный stdout до EOF.
 *   - Фаза 2 закрыта: set_config CAS (снимок before + restore_config на хосте),
 *     валидация enum по спискам движка (Modules/ConfigOptions), авто-резисты
 *     тира босса (Boss 30 / Pinnacle 50 / Uber 50 — GUI-плейсхолдеры апстрима
 *     headless не применяет), полный snapshot_build/restore_build.
 *
 * Рантайм-зависимости (все воспроизводимы, см. oracle/setup-headless.mjs):
 *   - oracle/bin/luajit.exe — LuaJIT 2.1 (luapower mingw64, MIT, SHA256-гейт);
 *   - исходники PathOfBuilding-PoE2 (env POE2K_POB2_SRC; на машинах без клона тул
 *     честно отвечает available:false + setup-инструкция, НЕ ошибкой).
 *   Отключение: env POE2K_RECOMPUTE=0.
 */

import type * as CpType from 'node:child_process';
import { IS_NODE, fsMod, pathMod, urlMod } from './nodeenv.js';
import { decodeShareCode } from './pobcode.js';

// nodeenv-паттерн (см. nodeenv.ts:5-11): статические named-imports node-builtins
// ломают браузерную vite-сборку (rollup подменяет их __vite-browser-external без
// экспортов). Браузерный клиент PoB-оракула ходит в /api/pob сервера, эти модули
// исполняются только под Node (MCP/CLI/serve-dist).
const cpMod = IS_NODE ? await import('node:child_process') : null;
const spawnSync = cpMod?.spawnSync;
const existsSync = (p: string): boolean => !!fsMod?.existsSync(p);
const join = (...segs: string[]): string => (pathMod ? pathMod.join(...segs) : segs.join('/'));
const dirname = (p: string): string => (pathMod ? pathMod.dirname(p) : p.replace(/[\\/][^\\/]*$/, ''));
const fileURLToPath = (u: string): string =>
  urlMod ? urlMod.fileURLToPath(u) : u.replace(/^file:\/\//, '').replace(/^\/(\w:)/, '$1');

export const RECOMPUTE_TIMEOUT_MS = 180_000;

/** Репо-корень: packages/core/dist/... → <repo>/oracle/headless (3 подъёма; в src-режиме их тоже 3). */
const repoRootFromHere = (): string => join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
);

export interface PobHostPaths {
  luajit: string;
  hostLua: string;
  pobSrc: string;
  missing: string[];
}

/** Резолв путей рантайма; missing ≠ пуст → available:false. Инъекция для тестов. */
export function resolvePobHostPaths(env: NodeJS.ProcessEnv = process.env): PobHostPaths {
  const repo = repoRootFromHere();
  const luajit = env.POE2K_LUAJIT ?? join(repo, 'oracle', 'bin', 'luajit.exe');
  const hostLua = env.POE2K_POB_HOST ?? join(repo, 'oracle', 'headless', 'pob_host.lua');
  const pobSrc = env.POE2K_POB2_SRC ?? '';
  const missing: string[] = [];
  if (!existsSync(luajit)) missing.push(luajit);
  if (!pobSrc || !existsSync(join(pobSrc, 'HeadlessWrapper.lua'))) missing.push(pobSrc || '<POE2K_POB2_SRC не задан>');
  return { luajit, hostLua, pobSrc, missing };
}

export interface SkillGroupSummary { label: string; main: string; gems: string[] }
export interface WhatIfScenarioOut {
  index: number;
  name: string;
  ok: boolean;
  errorCode?: string;
  errors?: string[];
  warnings?: string[];
  stats?: Record<string, number | string | boolean>;
  applied?: Record<string, unknown>;
  autoResists?: { tier: string; eleResist: number;[key: string]: unknown };
}
export interface RecomputeStats {
  available: true;
  mainSkill: string | null;
  characterLevel: number | null;
  treeVersion: string | null;
  skillGroups: SkillGroupSummary[];
  stats: Record<string, number | string | boolean>;
  /** ms движка (wall clock спавна). */
  tookMs: number;
  /** Фаза 2: авто-резисты тира босса (enemyIsBoss → enemyXResist), применённые хостом. */
  autoResists?: { tier: string; eleResist: number;[key: string]: unknown };
  /** Фаза 2: предупреждения валидации конфига (неизвестные ключи — применены вслепую). */
  configWarnings?: string[];
  /** Фаза 3: what-if матрица (один boot движка, CAS-изоляция сценариев). */
  scenarios?: WhatIfScenarioOut[];
}
export interface RecomputeUnavailable { available: false; reason: string; setupHint?: string; missing?: string[] }
export type RecomputeResult = RecomputeStats | RecomputeUnavailable;

export interface WhatIfScenarioInput {
  name?: string;
  config?: Record<string, unknown>;
  level?: number;
}
export interface RecomputeInput {
  /** PoB share-code (pobb.in/…/ABcD… или чистый код) — декодируется в XML нашим pobcode. */
  pobCode?: string;
  /** Готовый XML билда (приоритет ниже кода). */
  xml?: string;
  /** What-if: подменить уровень персонажа (1-100). */
  level?: number;
  /** What-if: патч build.configTab.input (боссы, заряды, резисты врага, customMods...). */
  config?: Record<string, unknown>;
  /**
   * Фаза 3: what-if матрица сценариев — ОДИН boot движка на всю матрицу,
   * каждый сценарий поверх baseline с CAS-откатом (не мультипликативно).
   */
  scenarios?: WhatIfScenarioInput[];
  /** Подмножество ключей статов (по умолчанию каталог хоста, ~60 ключей). */
  stats?: string[];
}

/**
 * Реконсиляция: загрузить билд в настоящий движок PoB2 и снять живые статы.
 * Строго one-shot: один или несколько методов, stdin закрывается, движок выходит.
 * Ошибка движка → RecomputeUnavailable (никогда не бросает).
 */
export function recomputeBuild(
  input: RecomputeInput,
  env: NodeJS.ProcessEnv = process.env,
  spawnImpl: typeof CpType.spawnSync = spawnSync!,
): RecomputeResult {
  if (env.POE2K_RECOMPUTE === '0') {
    return { available: false, reason: 'Poe2 recompute отключён (POE2K_RECOMPUTE=0).' };
  }
  if (!input.pobCode && !input.xml) {
    return { available: false, reason: 'Нужен pobCode или xml.' };
  }
  let xml = input.xml ?? '';
  if (input.pobCode) {
    try {
      xml = decodeShareCode(input.pobCode);
    } catch (e) {
      return { available: false, reason: `PoB-код не декодировался: ${(e as Error).message}` };
    }
  }

  const paths = resolvePobHostPaths(env);
  if (paths.missing.length > 0) {
    return {
      available: false,
      reason: 'Headless-PoB рантайм не найден.',
      setupHint:
        'Сетап: (1) node oracle/setup-headless.mjs — поставит LuaJIT в oracle/bin (SHA-гейт); ' +
        '(2) клон PathOfBuildingCommunity/PathOfBuilding-PoE2 и env POE2K_POB2_SRC=<...>/src ' +
        '(движок грузится без патчей через штатный HeadlessWrapper). CI-совместимо: см. oracle/README.md.',
      missing: paths.missing,
    };
  }

  const requests: { id: number; method: string; params?: unknown }[] = [];
  const loadId = 1;
  requests.push({ id: 1, method: 'load_build_xml', params: { xml } });
  const useScenarios = Array.isArray(input.scenarios) && input.scenarios.length > 0;
  if (useScenarios) {
    // Фаза 3: матрица в ОДНОМ boot — хост сам CAS-откатывает между сценариями.
    // Невалидные сценарии движок помечает ok:false точечно (без abort всей матрицы).
    requests.push({
      id: 2,
      method: 'whatif',
      params: {
        scenarios: input.scenarios!.slice(0, 12).map((s) => ({
          name: typeof s.name === 'string' ? s.name.slice(0, 80) : undefined,
          config: s.config && typeof s.config === 'object' ? s.config : undefined,
          level: typeof s.level === 'number' ? s.level : undefined,
        })),
        keys: input.stats ? input.stats.slice(0, 200) : undefined,
      },
    });
  } else {
    if (typeof input.level === 'number') {
      requests.push({ id: 2, method: 'set_level', params: { level: input.level } });
    }
    if (input.config && Object.keys(input.config).length > 0) {
      requests.push({ id: 3, method: 'set_config', params: { input: input.config } });
    }
    if (input.stats) {
      requests.push({ id: 4, method: 'stats', params: { keys: input.stats.slice(0, 200) } });
    }
  }
  const finalId = requests[requests.length - 1]!.id;

  const started = Date.now();
  const r = spawnImpl(paths.luajit, [paths.hostLua], {
    cwd: paths.pobSrc,
    input: requests.map((q) => JSON.stringify(q)).join('\n'),
    encoding: 'utf8',
    timeout: RECOMPUTE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...env,
      CI: 'true',
      LUA_PATH: '?.lua;?\\init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua',
      LUA_CPATH: join(dirname(paths.pobSrc.replace(/[\\/]$/, '')), 'runtime') + '\\?.dll',
    },
  });
  const tookMs = Date.now() - started;

  if (r.error || r.status !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-3).join(' | ');
    return {
      available: false,
      reason: `Движок упал (exit ${r.status ?? 'n/a'}): ${r.error?.message ?? (tail || 'нет вывода')}`,
      missing: paths.missing,
    };
  }

  let loadResult: Record<string, unknown> | null = null;
  let finalResult: Record<string, unknown> | null = null;
  let configFileResult: Record<string, unknown> | null = null;
  let ready = false;
  for (const line of (r.stdout || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (frame.ready === true) { ready = true; continue; }
    if (frame.ready === false) {
      return { available: false, reason: `HeadlessWrapper не поднялся: ${String(frame.error ?? '')}` };
    }
    if (frame.ok === false) {
      return { available: false, reason: `Ошибка RPC ${String(frame.method ?? frame.id)}: ${String(frame.error)}` };
    }
    const frameResult = frame.result as Record<string, unknown> | undefined;
    // Фаза 2: set_config отвечает ok:false ВНУТРИ result (без pcall-ошибки) —
    // невалидное значение конфига обязано звучать громко, а не молчаливым no-op.
    if (frameResult && frameResult.ok === false) {
      const errs = Array.isArray(frameResult.errors) ? (frameResult.errors as string[]).join('; ') : '';
      return {
        available: false,
        reason: `Конфиг отклонён движком (${String(frameResult.errorCode ?? 'invalid')}): ${errs || 'см. autoResists/warnings'}`,
      };
    }
    if (frame.id === loadId) loadResult = frameResult ?? null;
    if (input.config && frame.id === 3) configFileResult = frameResult ?? null;
    if (frame.id === finalId) finalResult = frameResult ?? null;
  }
  if (!ready) return { available: false, reason: 'startup-фрейм не получен (stdout без ready=true)' };
  if (!loadResult || typeof loadResult !== 'object') return { available: false, reason: 'load_build_xml не вернул результат' };

  const merged = { ...loadResult, ...(finalResult ?? {}) } as Record<string, unknown>;
  const res: RecomputeStats = {
    available: true,
    mainSkill: (merged.mainSkill as string | null) ?? null,
    characterLevel: (merged.characterLevel as number | null) ?? null,
    treeVersion: (merged.treeVersion as string | null) ?? null,
    skillGroups: (merged.skillGroups as SkillGroupSummary[]) ?? [],
    // Фаза 3: при сценариях merged.stats = baseline матрицы (stats whatif-фрейма).
    stats: (merged.stats as RecomputeStats['stats']) ?? {},
    tookMs,
  };
  if (useScenarios) {
    const wi = finalResult as { baseline?: unknown; scenarios?: unknown[] } | null;
    // whatif-фрейм не несёт meta (mainSkill/level берём из load), но baseline
    // статов каноничнее, чем stats загрузки до матрицы: перезаписываем.
    if (wi && wi.baseline && typeof wi.baseline === 'object') {
      res.stats = wi.baseline as RecomputeStats['stats'];
    }
    if (wi && Array.isArray(wi.scenarios)) {
      res.scenarios = wi.scenarios.filter((s) => s && typeof s === 'object') as WhatIfScenarioOut[];
    }
  }
  if (configFileResult) {
    const auto = configFileResult.autoResists as RecomputeStats['autoResists'] | undefined;
    const warns = configFileResult.warnings as string[] | undefined;
    if (auto) res.autoResists = auto;
    if (warns && warns.length > 0) res.configWarnings = warns;
  }
  return res;
}
