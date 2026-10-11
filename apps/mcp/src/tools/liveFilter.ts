/**
 * MCP-инструмент: live-price лут-фильтр (P3, тул поверх этапов A-D — №445).
 *
 * Снимает живой снапшот цен лиги (готовые каналы core: poe2scout/poe.ninja),
 * собирает динамический блок (генератор + SelfCheck + инжектор в базовый
 * NS-фильтр) и — по явному write=true — атомарно пишет готовый .filter
 * в папку игры (Documents\My Games\Path of Exile 2, OneDrive-redirect учтён).
 *
 * Безопасность: по умолчанию dry-run — на диск ничего не пишется;
 * все статусы источников и SelfCheck отдаются честно.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import fs from 'node:fs';
import path from 'node:path';
import { currentDefaultLeague } from '../leagues.js';

const DEFAULT_BASE_NAME = 'ns_regular_github.filter';

/** Найти базовый NS-фильтр: явный путь, иначе поиск вверх от cwd (репо лежит в рабочем дереве владельца). */
function findBaseFilter(explicit?: string): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, DEFAULT_BASE_NAME);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function registerLiveFilterTools(server: McpServer): number {
  let count = 0;

  server.registerTool(
    'poe2_live_filter',
    {
      title: 'PoE2 Live Loot Filter',
      description: `Собрать live-price лут-фильтр PoE2: живые цены лиги (poe2scout/poe.ninja) → динамический ценовой блок → инжект в базовый NeverSink-фильтр (перед его первой секцией, first-match-wins). По умолчанию dry-run: возвращает превью и статистику; write=true — атомарная запись в Documents\\My Games\\Path of Exile 2\\<destName>.filter (выбрать фильтр в игре вручную).

Аргументы:
  - league (string, опц.): лига; по умолчанию актуальная (poe2_leagues).
  - thresholdEx (number, опц., default 10): порог ценности в exalts.
  - alwaysShow (string[], опц.): личные BaseType — всегда показывать.
  - uncutGemMinLevel / waystoneMinTier (number, опц.): слайдеры показа.
  - hideLowRarityGear (boolean, опц., default true): скрывать Normal/Magic гир-классы ниже порога.
  - basePath (string, опц.): путь к базовому NS-фильтру; по умолчанию поиск ns_regular_github.filter вверх от репо.
  - destName (string, опц., default "poe2kit_live"): имя .filter в папке игры.
  - write (boolean, default false): true — записать на диск (atomic temp+rename).
  - previewLines (number, опц., default 15): сколько строк динамического блока показать.

Уники/exceptional-базы без данных листингов не скрываются (guardrails); пустые цены молодой лиги пропускаются.

Примеры:
  - "Собери лут-фильтр по живым ценам" → league по умолчанию, dry-run
  - "Обнови фильтр и запиши в игру" → write=true
`,
      inputSchema: {
        league: z.string().optional(),
        thresholdEx: z.number().positive().optional(),
        alwaysShow: z.array(z.string()).optional(),
        uncutGemMinLevel: z.number().int().min(0).optional(),
        waystoneMinTier: z.number().int().min(0).max(15).optional(),
        hideLowRarityGear: z.boolean().optional(),
        basePath: z.string().optional(),
        destName: z.string().optional(),
        write: z.boolean().optional(),
        previewLines: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const inj = core.livefilterInjector;
        const L = args.league ?? (await currentDefaultLeague());
        core.trade.setLeague(L);

        const basePath = findBaseFilter(args.basePath);
        if (!basePath) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Базовый NS-фильтр не найден (${DEFAULT_BASE_NAME}; basePath=${args.basePath ?? '—'}). Укажите basePath.` }],
          };
        }

        // 1. Живой снапшот из готовых каналов core
        const { snapshot, error: snapErr } = await core.livefilterSnapshot.buildLiveFilterSnapshot(L);
        if (snapErr) {
          const src = Object.entries(snapshot.sources)
            .map(([k, v]) => `${k}: ${v.ok ? 'ok' : `FAIL (${v.error ?? 'нет данных'})`}`)
            .join('; ');
          return {
            isError: true,
            content: [{ type: 'text', text: `Снапшот непригоден: ${snapErr}. Источники: ${src}` }],
          };
        }

        // 2. Генерация + SelfCheck + инжект (чистая функция)
        const baseContent = fs.readFileSync(basePath, 'utf8');
        const cfg = {
          thresholdEx: args.thresholdEx ?? 10,
          alwaysShow: args.alwaysShow,
          uncutGemMinLevel: args.uncutGemMinLevel,
          waystoneMinTier: args.waystoneMinTier,
          hideLowRarityGear: args.hideLowRarityGear ?? true,
        };
        const composed = inj.composeLiveFilter(baseContent, snapshot, cfg);
        const st = composed.stats;
        const sc = composed.selfCheck;

        // 3. Запись (только по явному write)
        let written = '';
        if (args.write) {
          const gameDir = inj.poe2GameDir();
          if (!gameDir) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Папка игры не найдена (Documents\\My Games\\Path of Exile 2, вкл. OneDrive-redirect). Фильтр собран, но не записан.` }],
            };
          }
          const safe = (args.destName ?? 'poe2kit_live').replace(/[\\/:*?"<>|]/g, '_');
          const destPath = path.join(gameDir, `${safe}.filter`);
          inj.writeFilterAtomic(destPath, composed.content);
          written = `\n**ЗАПИСАНО**: \`${destPath}\` — выберите фильтр «${safe}» в настройках игры.`;
        } else {
          written = `\nDry-run: на диск не записано (write=true для записи в папку игры).`;
        }

        const rows: string[] = [
          `## Live лут-фильтр — ${L}`,
          ``,
          `- База: \`${path.basename(basePath)}\` (${baseContent.split('\n').length} строк)`,
          `- Курс: 1 Divine = ${snapshot.rates.divineEx.toFixed(1)} ex; 1 Chaos = ${(1 / snapshot.rates.chaosEx).toFixed(1)} ex`,
          `- Порог: ${st.thresholdEx} ex · валюта: показано ${st.valuableCurrency}, дёшево ${st.cheapCurrency}`,
          `- Уник-базы: ${st.valuableUniqueBases} ценных / ${st.cheapUniqueBases} дёшево (без листингов — не скрываются)`,
          `- Правил в блоке: ${st.stackRules + st.valuableCurrency + st.cheapCurrency}+, выброшено генератором: ${st.droppedRules}`,
        ];
        if (st.warnings.length > 0) {
          rows.push(`- ⚠ Ворнинги (${st.warnings.length}): ${st.warnings.slice(0, 5).join('; ')}${st.warnings.length > 5 ? '…' : ''}`);
        }
        if (sc == null) {
          rows.push(`- SelfCheck: выключен (база ниже порогов <10 классов/<500 баз)`);
        } else {
          rows.push(`- SelfCheck: unknown-значений ${sc.unknown.length}, правил выброшено ${sc.dropped}${sc.unknown.length > 0 ? ` (например: ${sc.unknown.slice(0, 5).join(', ')})` : ''}`);
        }
        const n = args.previewLines ?? 15;
        const lines = composed.dynamicBlock.split('\n');
        rows.push(``, `### Динамический блок (первые ${Math.min(n, lines.length)} строк)`, '```', ...lines.slice(0, n), '```');
        rows.push(written);
        const text = rows.join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );
  count++;
  return count;
}
