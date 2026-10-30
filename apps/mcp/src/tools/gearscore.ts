/**
 * MCP-инструмент: poe2_gearscore — W4-2.
 *
 * Gearscore предмета БЕЗ билда (SSF/левелинг): 0–100 по generic-профилю
 * (life-res / es-caster), grade S–D, вклад каждого стата, что «мимо профиля»
 * (wasted) и чего не хватает (missing). Core: packages/core/src/gearscore.ts
 * (idea reference poe2-upgrade-checker, GPL-3 — только эвристика, свой код).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerGearscoreTools(server: McpServer): number {
  server.registerTool(
    'poe2_gearscore',
    {
      title: 'PoE2 Gear Score (no build)',
      description: `Оценить предмет 0–100 БЕЗ билда (SSF/левелинг): life-res-профиль (ниверсал: жизнь, резисты, базовая оборона, DPS оружия, скорость) или es-caster (щит, скорость каста, Spirit). Возвращает grade S/D, вклад каждого стата в очках, «мимо профиля» (wasted) и топ-3 недостающих статов (missing). Уники/фляги/чармы/неопознанные честно не оцениваются. res_need (сколько каждого резиста ещё нужно до капа) обрезает вес уже закрытых резистов.

Ограничения: это эвристика generic-профиля, НЕ ваш билд — для точного вердикта «vs билд» используйте poe2_item_upgrade_verdict (требует oracle PoB2).`,
      inputSchema: {
        item_text: z.string().min(5).describe('Клир-текст предмета (Ctrl+C в игре, RU/EN)'),
        profile: z.enum(['life-res', 'es-caster']).optional().describe('Профиль оценки (default: life-res — ниверсал)'),
        res_need_fire: z.number().int().optional().describe('Сколько Fire Res ещё нужно до капа (0 = закрыт, почти не весит)'),
        res_need_cold: z.number().int().optional(),
        res_need_lightning: z.number().int().optional(),
        res_need_chaos: z.number().int().optional(),
        // W5-C (№696): веса приоритетов из гира (autoWeights) → буст профильных статов.
        gear: z.array(z.string()).optional().describe('Клир-тексты НОШЕНЫХ предметов (для boost_from_gear: что ваш гир уже стекает — то важнее)'),
        boost_from_gear: z.boolean().optional().describe('Бустить ×1.5 важность статов, которые ваш гир уже стекает (нужен gear[])'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ item_text, profile, res_need_fire, res_need_cold, res_need_lightning, res_need_chaos, gear, boost_from_gear }) => {
      try {
        const resNeed = {
          ...(res_need_fire != null ? { fire: res_need_fire } : {}),
          ...(res_need_cold != null ? { cold: res_need_cold } : {}),
          ...(res_need_lightning != null ? { lightning: res_need_lightning } : {}),
          ...(res_need_chaos != null ? { chaos: res_need_chaos } : {}),
        };
        // W5-C (№696): kind autoWeights → id профильного стата gearscore.
        const FOCUS_KIND_TO_PROFILE_ID: Record<string, string> = {
          life: 'life', es: 'es', spirit: 'spirit',
          fres: 'fres', cres: 'cres', lres: 'lres', chaores: 'chres',
          ms: 'ms', str: 'attrs', dex: 'attrs', int: 'attrs',
          evasion: 'evflat', armour: 'arbase',
        };
        let boostIds: string[] | undefined;
        let focusInfo: string[] = [];
        if (boost_from_gear && gear?.length) {
          const boostIdsSet = new Set<string>();
          for (const f of core.autoWeights.suggestGearFocus(gear)) {
            const id = FOCUS_KIND_TO_PROFILE_ID[f.kind];
            if (id) boostIdsSet.add(id);
          }
          boostIds = boostIdsSet.size ? [...boostIdsSet] : undefined;
          if (boostIds) {
            focusInfo = ['### Буст из вашего гира (×1.5)', '', `Статы: ${boostIds.join(', ')}`, ''];
          }
        }
        const r = core.gearscore.gearScoreItem(item_text, {
          ...(profile ? { profile } : {}),
          ...(Object.keys(resNeed).length ? { resNeed } : {}),
          ...(boostIds ? { boostIds } : {}),
        });
        const lines: string[] = ['## Gearscore (без билда)', ''];
        if (!r.rated) {
          const why: Record<string, string> = {
            unique: 'уник — фиксированные моды, generic-профиль не применим (оценку оставьте прайс-чеку/вердикту)',
            unidentified: 'не опознан — сначала идентифицировать',
            flask: 'фляга — не оценивается',
            charm: 'чарм — не оценивается',
            'not-item': 'это не предмет (парсер не нашёл базовый тип)',
          };
          lines.push(`Не оценён: ${why[r.unratedReason ?? ''] ?? r.unratedReason}`);
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        lines.push(`**${r.score}/100 — grade ${r.grade}** · слот: ${r.slot} · профиль: ${r.profileName}`, '');
        lines.push(...focusInfo);
        if (r.contributions.length) {
          lines.push('### Что дало очки', '');
          for (const c of r.contributions) {
            lines.push(`- ${c.label}: ${c.value} (качество ${c.qualityPct}%) → ${c.points} очк. [${c.source}]`);
          }
        }
        if (r.penalties.length) {
          lines.push('', '### Штрафы', '');
          for (const p of r.penalties) lines.push(`- ${p.label}: ${p.value} → ${p.points} очк.`);
        }
        if (r.wasted.length) {
          lines.push('', '### Мимо профиля (не points, но не мусор)', '');
          for (const w of r.wasted) lines.push(`- ${w}`);
        }
        if (r.missing.length) {
          lines.push('', `### Чего не хватает (top-3): ${r.missing.join(', ')}`);
        }
        lines.push('', '_Эвристика generic-профиля; точный вердикт «vs ваш билд» — poe2_item_upgrade_verdict._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка gearscore: ${msg}` }] };
      }
    },
  );

  return 1;
}
