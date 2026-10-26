/**
 * MCP-инструмент: вердикт «предмет vs билд» (P10, ядро core/itemVerdict.ts).
 *
 * Отвечает на главный вопрос лута: «надевать это или нет?» — upgrade /
 * minor_upgrade / sidegrade / downgrade / uncertain / not_viable, с гвардов
 * ExileLens-паттернов (res-cap-lost never upgrade, unequipable → not_viable,
 * UNMEASURED ≠ upgrade) и однострочной причинностью.
 *
 * Вход: Ctrl+C кандидата (+ опц. Ctrl+C текущего предмета слота, гир-контекст,
 * пулы/персонаж). Чистый расчёт без сети; точный DPS/EHP с деревом — это
 * фаза 2 (PoB-оракул), честно отражено в guards.offenseUnmeasured.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

const iv = core.itemVerdict;

export function registerItemVerdictTools(server: McpServer): number {
  let count = 0;

  server.registerTool(
    'poe2_item_verdict',
    {
      title: 'PoE2 Item Verdict (upgrade or not)',
      description: `Вердикт предмета для слота билда: upgrade / minor_upgrade / sidegrade / downgrade / uncertain / not_viable. Оси: EHP по 5 типам урона (phys/fire/cold/lightning/chaos) поверх gear-контекста, DPS оружия (собственный урон предмета). Гварды: требования персонажа, потеря резист-капа (никогда не upgrade), неизмеримые оси (UNMEASURED ≠ upgrade). Sidegrade-полоса скора 47–53 (дилемма-основа ExileLens).

Аргументы:
  - candidateText (string, обяз.): клир-текст Ctrl+C кандидата (EN-клиент).
  - currentSlotText (string, опц.): клир-текст текущего предмета того же слота; без него — candidate-only (по умолчанию без current вердикт uncertain).
  - gear (object: слот → клир-текст, опц.): остальной эквип для EHP-контекста; слот с тем же Item Class автоматически заменяется кандидатом.
  - basePools (object, опц.): { life, energyShield } базовые пулы с уровней/дерева, если известны.
  - character (object, опц.): { level, strength, dexterity, intelligence } для проверки требований.

Примеры:
  - "Надевать этот шлем?" (после Ctrl+C предмета и Ctrl+C текущего шлема)
  - "Оцени кольцо против текущего, гир приложить"`,
      inputSchema: {
        candidateText: z.string().min(10).optional().describe('Клир-текст Ctrl+C кандидата (EN-клиент); алиас: candidate_text'),
        candidate_text: z.string().min(10).optional().describe('Алиас candidateText (snake_case; при задании обоих приоритет у candidateText)'),
        currentSlotText: z.string().min(5).optional(),
        gear: z.record(z.string(), z.string()).optional(),
        basePools: z.object({ life: z.number().optional(), energyShield: z.number().optional() }).optional(),
        character: z
          .object({
            level: z.number().optional(),
            strength: z.number().optional(),
            dexterity: z.number().optional(),
            intelligence: z.number().optional(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const candidateText = args.candidateText ?? args.candidate_text; // №621: алиас camel/snake
        if (!candidateText) throw new Error('Укажите candidateText (или алиас candidate_text) — клир-текст Ctrl+C кандидата');
        const v = iv.itemVerdict({
          candidateText,
          currentSlotText: args.currentSlotText,
          gear: args.gear,
          basePools: args.basePools,
          character: args.character,
        });

        const icon: Record<string, string> = {
          upgrade: '✅ UPGRADE',
          minor_upgrade: '🔼 MINOR UPGRADE',
          sidegrade: '⚖ SIDEGRADE',
          downgrade: '❌ DOWNGRADE',
          uncertain: '❓ UNCERTAIN',
          not_viable: '⛔ NOT VIABLE',
        };
        const rows: string[] = [
          `## ${icon[v.verdict] ?? v.verdict} — ${v.candidate.name || v.candidate.baseType}`,
          ``,
          `**${v.headline}**`,
          ``,
          `- Слот: ${v.slot || '?'}; скор ${v.score.toFixed(0)} (sidegrade-полоса 47–53)`,
          v.current
            ? `- Текущий: ${v.current.name || v.current.baseType}`
            : '- Текущий предмет слота не передан — EHP-сравнение отключено.',
        ];

        if (v.axes.length > 0) {
          rows.push('', '### Оси');
          for (const a of v.axes) {
            rows.push(`- ${a.axis}: ${a.deltaPct >= 0 ? '+' : ''}${a.deltaPct.toFixed(1)}% ${a.loss ? '⚠' : ''}`);
          }
        }
        const g = v.guards;
        const guardNotes: string[] = [];
        if (!g.equipable) guardNotes.push('⛔ персонаж НЕ может надеть (требования)');
        else if (g.equipabilityUnknown) guardNotes.push('❓ требования не сверены (нет данных персонажа) — plain upgrade кэпится');
        if (g.resistCapLost) guardNotes.push('⚠ теряется резист-кап — NEVER upgrade (ExileLens guard)');
        if (g.offenseUnmeasured) guardNotes.push('❓ offense-ось не измерима без PoB-оракула (UNMEASURED ≠ upgrade)');
        if (guardNotes.length > 0) rows.push('', '### Гварды', ...guardNotes.map((n) => `- ${n}`));

        if (v.reasons.length > 0) {
          rows.push('', '### Причины');
          for (const r of v.reasons) {
            rows.push(`- ${r.direction === 'gain' ? '+' : r.direction === 'loss' ? '−' : '·'} ${r.text}`);
          }
        }
        return { content: [{ type: 'text', text: rows.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );
  count++;
  return count;
}
