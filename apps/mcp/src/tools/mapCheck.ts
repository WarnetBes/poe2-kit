/**
 * MCP-инструмент: poe2_map_check — W4-1.
 *
 * Вердикт DANGER/CAREFUL/FINE карты против ВАШЕГО билда: моды waystone
 * (особенно -max Resistance) прогоняются через estimate гира —_elem-EHP
 * проседание считается честной механикой капа. Core: mapCheck.ts
 * (idea reference poe2-upgrade-checker, GPL-3 — только эвристика, код свой).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerMapCheckTools(server: McpServer): number {
  server.registerTool(
    'poe2_map_check',
    {
      title: 'PoE2 Map Check (vs build)',
      description: `Вердикт «выдержит ли билд ЭТУ карту»: DANGER / CAREFUL / FINE. Моды waystone (например 'of Exposure' = −до 12% к капу ВСЕХ максимальных резистов) прогоняются против вашего билда:.elem-слои EHP пересчитываются по честной механике капа (capped 75% → 63% = −32% EHP слоя); жёсткие немоделируемые моды (Smothering/Stasis/Rust/Carnage) поднимают вердикт не выше CAREFUL с объяснением.

Вход: build (PoB share-код ИЛИ XML билда) + mods (строки модов карты: имя группы 'of Exposure' / 'of Smothering' / точный stat_text EN) + опц. map/tier.

Границы честно: оценка estimate-слоя (гир, без дерева/аур — числа ниже PoB2-точных); точный PoB-вердикт max-res (oracle override) — следующий этап кита.`,
      inputSchema: {
        build: z.string().min(20).describe('PoB share-код ИЛИ XML билда'),
        mods: z.array(z.string().min(2)).min(1).describe('Моды waystone: имя группы ("of Exposure") или точный stat_text EN'),
        map: z.string().optional().describe('Id/EN-имя карты (контекст босса)'),
        tier: z.number().int().min(1).max(16).optional().describe('Waystone-тир (1-16)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ build, mods, map, tier }) => {
      try {
        const r = await core.mapCheck.checkMapAgainstBuild(build, {
          mods,
          ...(map ? { map } : {}),
          ...(tier != null ? { tier } : {}),
        });
        const lines: string[] = ['## Map check (vs ваш билд)', ''];
        const v: Record<string, string> = {
          danger: '⛔ **DANGER** — карту лучше скратить/перекатить',
          careful: '⚠️ **CAREFUL** — играбельно, на грани',
          fine: '✅ **FINE** — билд держит эти моды',
        };
        lines.push(v[r.verdict] ?? r.verdict, '');
        if (r.maxResPenaltyPct) {
          lines.push(
            r.worstEhpLossPct != null
              ? `−${r.maxResPenaltyPct}% к капу максимальных резистов; худший слой: **${r.worstLayer}** теряет **${r.worstEhpLossPct}%** EHP.`
              // №695-ревью P1-3: все элем-резисты ниже нового капа — штраф НЕ режет
              // (uncapped не страдает: res < capAfter → слой не считается в core).
              : `−${r.maxResPenaltyPct}% к капу максимальных резистов — но ВСЕ ваши элем-резисты ниже нового капа (${75 - r.maxResPenaltyPct}%): штраф капа вас НЕ затрагивает.`,
            `Резисты гира (estimate): fire ${r.resists.fire} / cold ${r.resists.cold} / lightning ${r.resists.lightning} / chaos ${r.resists.chaos} (кап 75, гир может overcap — слои клампятся).`,
            '',
          );
        }
        for (const rsn of r.reasons) lines.push(`- ${rsn}`);
        if (r.matchedMods.length) {
          lines.push('', `Распознанные моды: ${r.matchedMods.join(', ')}`);
        }
        if (r.unknownMods.length) {
          lines.push(`⚠ Не распознаны: ${r.unknownMods.join(' | ')} (вставляйте имя группы или точный stat_text EN)`);
        }
        lines.push('', '_Estimate-слой (гир); PoB2-точный max-res-вердикт — roadmap кита._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка map-check: ${msg}` }] };
      }
    },
  );

  return 1;
}
