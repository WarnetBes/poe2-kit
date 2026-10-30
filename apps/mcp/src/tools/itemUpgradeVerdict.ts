/**
 * MCP-инструмент: poe2_item_upgrade_verdict — W2-3.
 *
 * Swap-вердикт «предмет vs билд» через НАСТОЯЩИЙ движок PoB2 (oracle-сессия):
 * candidate надевается в каждый подходящий слот, движок пересчитывает билд,
 * вердикт = UPGRADE / MINOR / SIDEGRADE / LOSES RESISTANCE / DOWNGRADE /
 * NOT VIABLE / UNCERTAIN (см. core.upgradeVerdict).
 *
 * Движок не настроен (POE2K_POB2_SRC/luajit) → честный available:false
 * с setup-подсказкой; эвристической подмены нет (null-дисциплина).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerItemUpgradeVerdictTools(server: McpServer): number {
  server.registerTool(
    'poe2_item_upgrade_verdict',
    {
      title: 'PoE2 Item Upgrade Verdict (PoB2 engine)',
      description: `Вердикт «предмет vs билд» движком Path of Building 2: кандидат (клир-текст Ctrl+C, RU/EN) примеряется в каждый подходящий слот билда (кольца/фляги — оба слота), оверлей-движок PoB2 пересчитывает билд до/после, вердикт = upgrade/minor/sidegrade/loses_resistance/downgrade/not_viable/uncertain с дельтами DPS/EHP/резистов/скорости.
Требует живой oracle-рантайм (POE2K_POB2_SRC + luajit, как poe2_recompute); без него — честный отказ, эвристики нет.
Гварды: потеря резист-капа кэпит апгрейд; Spirit в минус/невыполненные атрибуты = not_viable; keep-MS приоритет по умолчанию.

Аргументы:
  - pob_share_code | xml (обяз. один из): эталонный билд.
  - item_text (обяз.): клир-текст кандидата (как Ctrl+C в игре).
  - slots (string[], опц.): явные слоты PoB ("Ring 1", "Weapon 1", "Helmet", …); по умолчанию — авто по классу предмета.
  - chaos_resist (boolean, опц.): считать хаос-резист (default false; CI — не нужен).
  - keep_movement_speed (boolean, опц.): держать 30%-скорость (default true).
  - resist_buffer, ms_break_points (number, опц.): пороги гвардов (5 / 3).`,
      inputSchema: {
        pob_share_code: z.string().optional().describe('PoB share-код (pobb.in/…/code или чистый)'),
        xml: z.string().optional().describe('Готовый PoB-XML билда'),
        item_text: z.string().min(1).describe('Клир-текст предмета-кандидата (Ctrl+C в игре, RU или EN)'),
        slots: z.array(z.string().min(1)).optional().describe('Явные слоты PoB (Ring 1 / Weapon 1 / Helmet / …)'),
        chaos_resist: z.boolean().optional().describe('Считать хаос-резист (default false)'),
        keep_movement_speed: z.boolean().optional().describe('Кэп-гвард скорости передвижения (default true)'),
        resist_buffer: z.number().min(0).max(30).optional().describe('Буфер капа (default 5)'),
        ms_break_points: z.number().min(0).max(30).optional().describe('Порог потери MS-пунктов (default 3)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({
      pob_share_code,
      xml,
      item_text,
      slots,
      chaos_resist,
      keep_movement_speed,
      resist_buffer,
      ms_break_points,
    }) => {
      try {
        if (!pob_share_code && !xml) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Нужен pob_share_code или xml — билд-эталон для примерки.' }],
          };
        }
        const res = await core.swapItem.swapVerdictForItem({
          pobCode: pob_share_code,
          xml,
          itemText: item_text,
          slots,
          priorities: {
            chaos: chaos_resist,
            keepMs: keep_movement_speed,
            ...(resist_buffer != null ? { resistBuffer: resist_buffer } : {}),
            ...(ms_break_points != null ? { msBreakPoints: ms_break_points } : {}),
          },
        });
        if (!res.available) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Oracle недоступен: ${res.reason}${res.setupHint ? `\n\n${res.setupHint}` : ''}` }],
          };
        }
        const lines: string[] = ['## Вердикт: предмет vs билд (движок PoB2)', ''];
        const b = res.best;
        if (b) {
          lines.push(
            `**${b.slot} → ${bold(b.verdict)}** (score ${b.score})`,
            '',
            b.headline,
            '',
            `| Ось | До | После | Δ% |`,
            `|---|---|---|---|`,
            `| DPS (${b.dpsKey ?? '?'}) | ${b.dps.before ?? '—'} | ${b.dps.after ?? '—'} | ${fmt(b.dps.deltaPct)} |`,
            `| TotalEHP | ${b.ehp.before ?? '—'} | ${b.ehp.after ?? '—'} | ${fmt(b.ehp.deltaPct)} |`,
            `| Скорость передвижения | ${pct(b.ms.before)} | ${pct(b.ms.after)} | ${fmt(b.ms.deltaPct)} |`,
          );
          if (b.reasons.length) {
            lines.push('', 'Причинность:', ...b.reasons.map((r: { direction: string; text: string }) => `- ${r.direction === 'gain' ? '⬆️' : r.direction === 'loss' ? '⬇️' : '•'} ${r.text}`));
          }
          lines.push(
            '',
            `Гварды: резист-кап потерян: ${b.guards.resistCapLost ? 'да' : 'нет'} · Spirit-брейк: ${b.guards.spiritBreak ? 'да' : 'нет'} · атрибуты: ${b.guards.attrsBreak ? 'не выполнены' : 'ок'} · MS-брейк: ${b.guards.msBreak ? 'да' : 'нет'}`,
          );
        } else {
          lines.push('**Вердикт не вынесен**: ни один слот не подошёл (см. примерки ниже).');
        }
        if (res.attempts.length) {
          lines.push('', '### Примерки по слотам', '');
          for (const a of res.attempts) {
            lines.push(a.verdict ? `- ${a.slot}: **${a.verdict.verdict}** (score ${a.verdict.score})` : `- ${a.slot}: ✖ ${a.failed}`);
          }
        }
        lines.push('', '_Движок PoB2, swap-слой №685+; veriфицировано на эталонах; ответ — совет, решение за игроком._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка swap-вердикта: ${msg}` }] };
      }
    },
  );

  return 1;
}

const RU: Record<string, string> = {
  upgrade: 'UPGRADE — брать',
  minor_upgrade: 'UPGRADE (слабый плюс)',
  sidegrade: 'SIDEGRADE — трейд-офф',
  loses_resistance: 'LOSES RESISTANCE — усиление за резист-кап',
  downgrade: 'NOT AN UPGRADE — просадка',
  not_viable: 'NOT VIABLE — надеть нельзя',
  uncertain: 'UNCERTAIN — движок не дал чисел',
};

function bold(kind: string): string {
  return RU[kind] ?? kind;
}

function fmt(v: number | null): string {
  if (v == null) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}
