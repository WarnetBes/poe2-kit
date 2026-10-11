/**
 * MCP-тул poe2_recompute: что-если пересчёт билда НАСТОЯЩИМ движком PoB2 headless
 * (эпика headless-оракул, Фаза 1 — решение владельца от 11.10.2026).
 *
 * Ядро: core.pobHost.recomputeBuild — one-shot line-JSON-RPC к oracle/headless/pob_host.lua
 * (движок апстрима PoB2 без патчей, штатный HeadlessWrapper; PoB-код → XML нашим pobcode).
 *
 * Каноны: без рантайма — честное available:false с setup-инструкцией (как LSP-традиция
 * глубокой диагностики у MIT-донора poe2-exile-architect server.py), НЕ ложная ошибка.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerRecomputeTools(server: McpServer): number {
  let count = 0;

  // ── poe2_recompute ───────────────────────────────────────────────────
  server.registerTool(
    'poe2_recompute',
    {
      title: 'PoE2 Recompute (Headless PoB)',
      description: `Живой пересчёт билда настоящим движком Path of Building 2 (headless, без GUI).
Возвращает РЕАЛЬНЫЕ числа движка: TotalDPS/FullDPS/CombinedDPS, Life/ES/Mana/Spirit, TotalEHP,
резисты, Max Hit, крит, блочные слои, саппорт-группы — то, что наш статический декодер не считает.

Аргументы:
  - pob_code: PoB share-код (из pobb.in/poe.ninja или Ctrl+C из PoB) или
  - xml: готовый XML билда.
  - level (опц.): what-if уровень персонажа 1-100.
  - config (опц.): what-if патч input-конфига PoB — {"enemyIsBoss":"Uber","customMods":"..."}.
    Значения enum-ключей валидируются списками движка (невалид → отказ, не молчаливый no-op).
    enemyIsBoss автоматически проставляет резисты тира (Boss 30 / Pinnacle 50 / Uber 50 / None 0):
    апстрим в headless применяет их только как GUI-плейсхолдеры.
  - stats (опц.): узкий список ключей статов (по умолчанию каталог ~60 ключей).

Примеры:
  - poe2_recompute(pob_code="...") → панельные статы билда из глубин движка;
  - poe2_recompute(pob_code, config={"enemyIsBoss":"Pinnacle"}) → DPS vs босс;
  - poe2_recompute(pob_code, level=95) → что даст 95-й уровень.`,
      inputSchema: {
        pob_code: z.string().min(20).optional().describe('PoB share-код (декодируется автоматически)'),
        xml: z.string().min(100).optional().describe('XML билда PoB2 (приоритет ниже кода)'),
        level: z.number().int().min(1).max(100).optional().describe('What-if уровень персонажа'),
        config: z.record(z.string(), z.unknown()).optional().describe('What-if патч configTab.input (ключ: значение)'),
        stats: z.array(z.string()).max(200).optional().describe('Только эти ключи статов'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
        const result = core.pobHost.recomputeBuild({
          pobCode: args.pob_code,
          xml: args.xml,
          level: args.level,
          config: (args.config as Record<string, unknown> | undefined) ?? undefined,
          stats: args.stats,
        });

        if (!result.available) {
          const missing = result.missing?.length
            ? `\nНе хватает:\n${result.missing.map((m) => `  - ${m}`).join('\n')}`
            : '';
          return {
            content: [{
              type: 'text' as const,
              text:
                `⚠ Headless-PoB недоступен: ${result.reason}` +
                (result.setupHint ? `\n\nСетап:\n${result.setupHint}` : '') +
                missing,
            }],
          };
        }

        const s = result.stats as Record<string, number | string | boolean>;
        const num = (k: string): string => (typeof s[k] === 'number' ? fmt(s[k] as number) : '—');
        const fmt = (v: number): string =>
          Number.isInteger(v) ? v.toLocaleString('ru-RU') : v.toFixed(1).replace('.', ',');
        const dps = [
          `**TotalDPS**: ${num('TotalDPS')}`,
          `**FullDPS**: ${num('FullDPS')}`,
          `**CombinedDPS**: ${num('CombinedDPS')}`,
          `**WithIgniteDPS**: ${num('WithIgniteDPS')}`,
        ];
        const def = [
          `**Life**: ${num('Life')} | **ES**: ${num('EnergyShield')} | **Mana**: ${num('Mana')} | **Spirit**: ${num('Spirit')}`,
          `**TotalEHP**: ${num('TotalEHP')}`,
          `**Резисты (F/C/L/Ch)**: ${num('FireResist')}/${num('ColdResist')}/${num('LightningResist')}/${num('ChaosResist')}`,
          `**Max Hit (Ph/F/C/L/Ch)**: ${num('PhysicalMaximumHitTaken')}/${num('FireMaximumHitTaken')}/${num('ColdMaximumHitTaken')}/${num('LightningMaximumHitTaken')}/${num('ChaosMaximumHitTaken')}`,
          `**Armour**: ${num('Armour')} | **Evasion**: ${num('EvasionRating')} | **Block**: ${num('BlockChance')}%`,
          `**Crit**: ${num('CritChance')}% ×${num('CritMultiplier')}`,
        ];
        const groups = result.skillGroups.length
          ? result.skillGroups
            .slice(0, 12)
            .map((g) => `- ${g.main}${g.gems.length > 1 ? ` (+${g.gems.length - 1} сапп.)` : ''}`)
            .join('\n')
          : '(групп нет)';

        const header =
          `Скилл-групп: ${result.skillGroups.length}; главное: **${result.mainSkill ?? '—'}**; ` +
          `уровень ${result.characterLevel ?? '—'}; дерево ${result.treeVersion ?? '—'}; движок ${result.tookMs} мс.`;

        const cfgInfo: string[] = [];
        if (result.autoResists) {
          const a = result.autoResists;
          cfgInfo.push(`Босс-тир **${a.tier}** → авто-резисты: F/C/L=${a.eleResist}%, Chaos=0% (headless плейсхолдеры апстрима движок не применяет).`);
        }
        if (result.configWarnings?.length) {
          cfgInfo.push(`⚠ Предупреждения конфига:\n${result.configWarnings.map((w) => `- ${w}`).join('\n')}`);
        }
        const cfgBlock = cfgInfo.length ? `\n#### What-if конфиг\n${cfgInfo.join('\n')}\n` : '\n';

        return {
          content: [{
            type: 'text' as const,
            text:
              `### Headless-PoB2 пересчёт (живой движок)\n${header}\n` +
              cfgBlock +
              `\n#### Урон\n${dps.join('\n')}\n\n` +
              `#### Оборона и ресурсы\n${def.join('\n')}\n\n` +
              `#### Скиллы (первые группы)\n${groups}\n\n` +
              `Полный каталог статов (JSON):\n\`\`\`json\n${JSON.stringify(s, null, 1)}\n\`\`\``,
          }],
        };
      },
  );
  count++;
  return count;
}