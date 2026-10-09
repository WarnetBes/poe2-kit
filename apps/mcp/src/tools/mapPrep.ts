/**
 * MCP-тул `poe2_map_prep` (№234, Этап 3): персональная подготовка к карте.
 *
 * Вход — waystone (id или EN-имя карты) + моды как в игре (строки) + тир,
 * опционально билд: PoB-код ИЛИ готовые defensiveStats.
 * Выход — структурированный JSON {threat, checks, advice_markdown,
 * unknown_mods, build_provided} + человекочитаемый advice-markdown.
 *
 * Спецификация: docs/SPEC_MAP_PREP.md §5. Ядро: core.mapPrep (Этап 2).
 * Конвейер PoB-кода → DefensiveStats переиспользует core.estimate.estimateBuild
 * (тот же путь, что poe2_evaluate_build / poe2_rank_levers). Ядро экспортирует
 * только тип DefensiveStats; маппинг defenses→stats повторяет приватный
 * defensesToStats из core/optimize.ts:154 (9 полей, без дублирования логики).
 *
 * Дисциплина verified (SPEC §2): без билда персональные EHP-чеки НЕ строятся —
 * честная пометка, никаких выдуманных pass/fail по нулям.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import type { MapThreat, MapPrepCheck, DefensiveStats } from '@poe2-kit/core';

/** Advice-markdown ВЕТКИ «билд не передан»: только threat, без EHP-чеков. */
function adviceWithoutBuild(t: MapThreat): string {
  const lines: string[] = [];
  lines.push(`## Подготовка к карте (area level ${t.area_level})`);
  lines.push('');
  lines.push('**⚠ Билд не передан — персональные EHP-чеки пропущены.** Для персонального вердикта (какие резисты/EHP добить) передай `pob` (share-код/XML) или `defensiveStats` (life + резисты).');
  lines.push('');
  if (t.matchedMods.length) {
    lines.push('**Распознанные моды:**');
    for (const m of t.matchedMods) {
      const th = m.threat;
      const desc = th
        ? th.kind === 'player_debuff'
          ? `эффект на игроке: ${th.effect}`
          : th.kind === 'monster_res'
            ? `резисты монстров ( capped 75%)`
            : `${th.element}-угроза`
        : 'механизм не выражается моделью угрозы';
      lines.push(`- ${m.name} (${m.kind}, ступень ${m.tierIndex + 1}): ${desc}.`);
    }
    lines.push('');
  }
  if ((t.monsterEleBonus ?? 0) > 0 || (t.monsterChaosRes ?? 0) > 0) {
    lines.push(`- У монстров +${t.monsterEleBonus ?? 0}% элем / +${t.monsterChaosRes ?? 0}% chaos резист — элем-DPS с запасом.`);
  }
  if (t.unknownMods.length) {
    lines.push(`**❓ Не распознанные моды (проверь вручную):** ${t.unknownMods.join(' | ')}.`);
    lines.push('');
  }
  if (t.unverifiedNotes.length) {
    lines.push('**⚠️ Unverified-пункты:**');
    lines.push(...t.unverifiedNotes.map((n) => `- ${n}`));
  }
  return lines.join('\n');
}

/** Регистрация тула `poe2_map_prep`. Возвращает число добавленных инструментов (1). */
export function registerMapPrepTools(server: McpServer): number {
  server.registerTool(
    'poe2_map_prep',
    {
      title: 'PoE2 Map Prep Assistant',
      description: `Персональная подготовка к карте (waystone): какие моды опасны, какие резисты/EHP добить, что взять с собой, перероллить ли камень — офлайн, под ТВОЙ билд.

Вход:
  - map (string, опц.): id ('MapRustbowl') или EN-имя карты ('Rustbowl') — даёт босса, пул трэша, базовый area level.
  - mods (string[], опц.): моды камня КАК В ИГРЕ (полная строка стата или имя, напр. 'of Exposure'). Пусто/нет — безмодовая карта.
  - tier (number, опц.): waystone-тир 1–16 (задаёт area level 65–80; точнее, чем уровень карты).
  - pob (string, опц.): PoB share-код/XML билда — статы обороны берутся существующим конвейером импорта (как poe2_evaluate_build).
  - defensiveStats (object, опц.): готовые статы {life, energyShield?, armor?, evasion?, blockChance?, fireRes?, coldRes?, lightningRes?, chaosRes?} — если PoB-кода нет под рукой.

Без pob/defensiveStats вердикт строится по угрозе карты (моды/босс/уровень), персональные EHP-чеки пропускаются с честной пометкой.

Дисциплина verified: unbeknown-моды попадают в unknown_mods без выдумки; пороги maxroll помечены unverified.

Примеры:
  - "Подготовь к Rustbowl T12 с 'of Exposure (9 to 12)' и '+30% Monster Elemental Resistances'" + pob
  - "Опасен ли камень? Моды: of Smothering" (без билда — общий вердикт)`,
      inputSchema: {
        map: z.string().optional().describe('id карты (MapRustbowl) или EN-имя (Rustbowl); опц.'),
        mods: z.array(z.string()).optional().describe('Моды камня как в игре: строка стата или имя мода; пусто = безмодовая карта'),
        tier: z.number().int().min(1).max(16).optional().describe('Waystone-тир 1–16 (area level 65–80)'),
        pob: z.string().min(20).optional().describe('PoB share-код или XML билда (как в poe2_evaluate_build)'),
        defensiveStats: z
          .object({
            life: z.number().describe('Life'),
            energyShield: z.number().optional().describe('Energy Shield'),
            armor: z.number().optional().describe('Броня'),
            evasion: z.number().optional().describe('Evasion'),
            blockChance: z.number().optional().describe('Шанс блока, %'),
            fireRes: z.number().optional().describe('Fire resistance, %'),
            coldRes: z.number().optional().describe('Cold resistance, %'),
            lightningRes: z.number().optional().describe('Lightning resistance, %'),
            chaosRes: z.number().optional().describe('Chaos resistance, %'),
          })
          .optional()
          .describe('Готовые статы обороны вместо PoB-кода'),
      },
      outputSchema: {
        threat: z.any(),
        checks: z.array(z.any()),
        advice_markdown: z.string(),
        unknown_mods: z.array(z.string()),
        build_provided: z.boolean(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ map, mods, tier, pob, defensiveStats }) => {
      try {
        if ((map == null || map === '') && !mods?.length && tier == null) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Не передано ничего: укажи map (id или EN-имя) и/или mods, и/или tier — иначе вердикт бессодержателен.',
              },
            ],
            isError: true,
          };
        }

        // 1) Угроза карты: матчинг модов → каталог угроз (core.mapPrep).
        const threat = core.mapPrep.mapThreat({
          map: map ?? undefined,
          mods: mods ?? [],
          tier: tier ?? undefined,
        });

        // 2) Статы обороны: переиспользуем конвейер estimateBuild (optimize-тулы).
        let stats: DefensiveStats | null = null;
        let statsNote = '';
        if (pob != null && pob !== '') {
          const est = await core.estimate.estimateBuild(pob);
          // Маппинг defenses→DefensiveStats — тот же набор полей, что приватный
          // defensesToStats в core/optimize.ts:154 (ядро его не экспортирует).
          stats = {
            life: est.defenses.life,
            energyShield: est.defenses.energyShield,
            armor: est.defenses.armour,
            evasion: est.defenses.evasion,
            blockChance: est.defenses.blockChance,
            fireRes: est.defenses.fireRes,
            coldRes: est.defenses.coldRes,
            lightningRes: est.defenses.lightningRes,
            chaosRes: est.defenses.chaosRes,
          };
          statsNote =
            `Статы обороны: PoB-конвейер estimateBuild (${est.source === 'pob+gear' ? 'PlayerStat + gear' : 'только gear — приближённо'}${est.defenses.emptySlots > 0 ? `, ${est.defenses.emptySlots} слотов без клир-текста не учтены` : ''}).`;
        } else if (defensiveStats != null) {
          stats = { ...defensiveStats };
          statsNote = 'Статы обороны: переданы defensiveStats как есть.';
        }

        // 3) Чек-лист + advice: без билда персональные чеки НЕ строятся (honest).
        const checks: MapPrepCheck[] = stats ? core.mapPrep.mapPrepChecklist(stats, threat) : [];
        const advice = stats ? core.mapPrep.mapPrepAdvice(stats, threat) : adviceWithoutBuild(threat);

        const payload = {
          threat,
          checks,
          advice_markdown: advice,
          unknown_mods: threat.unknownMods,
          build_provided: stats != null,
        };
        const text = statsNote ? `${advice}\n\n_${statsNote}_` : advice;
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: payload,
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Ошибка map_prep: ${e instanceof Error ? e.message : String(e)}\nПроверь имя карты (id/EN), тир 1–16 и формат модов (строка стата из игры или имя, напр. 'of Exposure').`,
            },
          ],
        };
      }
    },
  );
  return 1;
}
