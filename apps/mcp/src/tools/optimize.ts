/**
 * MCP-инструменты: optimize-этап 1 — read-only аудит билда.
 * ТЗ: docs/SPEC_OPTIMIZE_TOOLS.md. Инвариант: каждое число помечено
 * computed:/estimated:, синтез рекомендаций — работа ИИ, не тулов.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import type { BuildGoals } from '@poe2-kit/core';

const CODE_SCHEMA = z.string().min(20).describe('PoB share-код или PoB-XML билда');

export function registerOptimizeTools(server: McpServer): number {
  let count = 0;

  // ── poe2_evaluate_build ────────────────────────────────────────────────
  server.registerTool(
    'poe2_evaluate_build',
    {
      title: 'PoE2 Build Goal Evaluation',
      description: `Билд против числовых целей (DPS/EHP/резисты/свободный Spirit): каждой цели — verdict (pass/fail/unknown) + разрыв.

Дисциплина чисел (ТЗ optimize-этапа 1):
  - TotalDPS/TotalEHP/SpiritUnreserved из PlayerStat PoB → **computed:**
  - если PoB-чисел нет — геар-оценки (DPS оружия, послойный EHP) → **estimated:** с пометкой «проверь в PoB».

Аргументы:
  - code (нужно): PoB share-код/XML.
  - dps, ehp: цели по урону/выживаемости.
  - fireRes/coldRes/lightningRes/chaosRes: цели по резистам (%).
  - spiritUnreserved: цель по свободному Spirit.
  - hitSize/accuracy: угроза для EHP-оценки (по умолч. 1000/2000).

Пара «оценка → проверка в PoB» обязательна: estimated-числа НЕ точные PoB-значения.`,
      inputSchema: {
        code: CODE_SCHEMA,
        dps: z.number().positive().optional().describe('Цель TotalDPS'),
        ehp: z.number().positive().optional().describe('Цель TotalEHP'),
        fireRes: z.number().optional().describe('Цель fire resistance, %'),
        coldRes: z.number().optional().describe('Цель cold resistance, %'),
        lightningRes: z.number().optional().describe('Цель lightning resistance, %'),
        chaosRes: z.number().optional().describe('Цель chaos resistance, %'),
        spiritUnreserved: z.number().optional().describe('Цель свободного Spirit'),
        hitSize: z.number().positive().optional(),
        accuracy: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const threat = { expectedHitSize: args.hitSize ?? 1000, attackerAccuracy: args.accuracy ?? 2000 };
        const est = await core.estimate.estimateBuild(args.code, threat);
        const goals: BuildGoals = {};
        if (args.dps != null) goals.dps = args.dps;
        if (args.ehp != null) goals.ehp = args.ehp;
        if (args.fireRes != null) goals.fireRes = args.fireRes;
        if (args.coldRes != null) goals.coldRes = args.coldRes;
        if (args.lightningRes != null) goals.lightningRes = args.lightningRes;
        if (args.chaosRes != null) goals.chaosRes = args.chaosRes;
        if (args.spiritUnreserved != null) goals.spiritUnreserved = args.spiritUnreserved;
        const nGoals = Object.keys(goals).length;
        if (!nGoals) {
          return { content: [{ type: 'text', text: 'Не задано ни одной цели (dps/ehp/резисты/spirit) — нечего проверять.' }] };
        }
        const checks = core.optimize.evaluateBuildAgainstGoals(est, goals);
        const lines: string[] = [];
        lines.push(`## Оценка билда против целей (${core.advice.fmtSuffix(est.pobStats['TotalDPS'] ?? est.weapon.totalDps)} DPS, худший EHP ${core.advice.fmtSuffix(est.worstEhp?.effectiveHp ?? null)})`, '');
        lines.push('| Метрика | Текущее | Цель | Разрыв | Verdict | Источник |', '|---|---|---|---|---|---|');
        for (const c of checks) {
          lines.push(`| ${c.metric} | ${c.current != null ? core.advice.fmtSuffix(c.current) : '—'} | ${core.advice.fmtSuffix(c.goal)} | ${c.gap != null ? (c.gap >= 0 ? '+' : '') + core.advice.fmtSuffix(c.gap) : '—'} | ${c.verdict === 'pass' ? '✓ pass' : c.verdict === 'fail' ? '✗ fail' : '? unknown'} | ${c.kind}: |`);
        }
        for (const c of checks) if (c.note) lines.push('', `_${c.metric}: ${c.note}_`);
        const fails = checks.filter((c) => c.verdict === 'fail').length;
        lines.push('', fails === 0 ? 'Все цели выполнены.' : `Провалено целей: ${fails}/${checks.length}. Estimated-числа перед решением проверь в PoB.`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка evaluate_build: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── poe2_rank_levers ───────────────────────────────────────────────────
  server.registerTool(
    'poe2_rank_levers',
    {
      title: 'PoE2 Rank Upgrade Levers',
      description: `Ранжирование «рычагов» апгрейда по маржинальному эффекту в единицах ΔEHP (по 5 типам урона) и ΔDPS-оценки.

Рычаги (фиксированный набор — ограниченный перебор):
  - +80 flat life, +30% к каждому элем-резисту, +500 брони, +300 уклонения
    → **computed:** пересчёт канонических слоёв ehp.ts по одному рычагу
  - +10% урона оружия / замена оружия на ×1.25 DPS → **estimated:** линейная арифметика поверх DPS оружия.

_SUPPORT-множители и пассивы-роутер НЕ ранжируются — нет данных (этап 3 ТЗ)._

Аргументы:
  - code (нужно): PoB share-код/XML.
  - hitSize/accuracy: угроза (по умолч. 1000/2000).`,
      inputSchema: {
        code: CODE_SCHEMA,
        hitSize: z.number().positive().optional(),
        accuracy: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const est = await core.estimate.estimateBuild(args.code);
        const levers = core.optimize.rankLevers(est, { expectedHitSize: args.hitSize ?? 1000, attackerAccuracy: args.accuracy ?? 2000 });
        const lines: string[] = [];
        lines.push('## Рычаги по маржинальному эффекту', '');
        lines.push('| Рычаг | Ср. ΔEHP% | ΔEHP phys | ΔEHP fire/cold/light/chaos | ΔDPS (estimated) |', '|---|---|---|---|---|');
        for (const l of levers) {
          const d = l.deltaEhp;
          const cells = (['fire', 'cold', 'lightning', 'chaos'] as const).map((t) => (d[t] != null ? Math.round(d[t]!) : '—')).join('/');
          lines.push(`| ${l.lever} | ${l.avgPercentGain.toFixed(1)}% | ${d.physical != null ? Math.round(d.physical) : '—'} | ${cells} | ${l.deltaDpsEstimated != null ? core.advice.fmtSuffix(l.deltaDpsEstimated) : '—'} |`);
        }
        lines.push('', 'Пояснения:');
        for (const l of levers) lines.push(`- ${l.lever}: ${l.note}`);
        lines.push('', '_computed = пересчёт канонических формул; estimated = эвристика — проверь в PoB перед крафтом._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка rank_levers: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── poe2_pinnacle_check ─────────────────────────────────────────────────
  server.registerTool(
    'poe2_pinnacle_check',
    {
      title: 'PoE2 Pinnacle Readiness Checklist',
      description: `Чек-лист готовности к эндгейму: verdict per item против табличных статов врага (канон PoB2 Misc.lua).

Пункты:
  - элем-резисты ≥ 75% (кап; с учётом пенетрации босса), chaos ≥ 0% ИЛИ CI-иммунитет (computed)
  - худший EHP ≥ 3× удара босса (удар — computed-таблица; множитель ×3 — estimated-эвристика)
  - ≥ 4 ударов босса до Heavy Stun игрока (computed: формула stun.ts; порог — эвристика)

Аргументы:
  - code (нужно): PoB share-код/XML.
  - enemyLevel (по умолч. 84), boss: none/boss/pinnacle/uber (по умолч. pinnacle).
  - ehpHits/stunHits: переопределить estimated-пороги.`,
      inputSchema: {
        code: CODE_SCHEMA,
        enemyLevel: z.number().int().min(1).max(100).optional().describe('Уровень врага (по умолчанию 84)'),
        boss: z.enum(['none', 'boss', 'pinnacle', 'uber']).optional().describe('Режим босса (по умолчанию pinnacle)'),
        ehpHits: z.number().int().min(1).max(10).optional().describe('Сколько ударов босса должен держать худший EHP (по умолчанию 3)'),
        stunHits: z.number().int().min(1).max(10).optional().describe('Минимум ударов до Heavy Stun игрока (по умолчанию 4)'),
        hitSize: z.number().positive().optional(),
        accuracy: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const est = await core.estimate.estimateBuild(args.code);
        const r = core.optimize.pinnacleChecklist(est, {
          ...(args.enemyLevel ? { enemyLevel: args.enemyLevel } : {}),
          boss: args.boss ?? 'pinnacle',
          ...(args.ehpHits ? { ehpHits: args.ehpHits } : {}),
          ...(args.stunHits ? { stunHits: args.stunHits } : {}),
        });
        const lines: string[] = [];
        lines.push(`## Готовность к эндгейму vs ${args.boss ?? 'pinnacle'} ур. ${r.enemy.level}`, '');
        lines.push(`Удар босса: **${r.enemy.damage}**, хаос ${r.enemy.chaosDamage}, элем-резисты ${r.enemy.elementalResist}%, пенетрация ${r.enemy.elementalPenetration}%, poise ×${r.enemy.poiseMultiplier.toFixed(1)}.`, '');
        lines.push('| Пункт | Verdict | Детали | Источник |', '|---|---|---|---|');
        for (const c of r.checks) {
          lines.push(`| ${c.item} | ${c.verdict === 'pass' ? '✓' : c.verdict === 'fail' ? '✗' : '?'} | ${c.detail} | ${c.kind}: |`);
        }
        const fails = r.checks.filter((c) => c.verdict === 'fail').length;
        lines.push('', fails === 0 ? 'Готов по всем проверяемым пунктам.' : `Провалов: ${fails}/${r.checks.length}. Чини блокеры в порядке списка.`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка pinnacle_check: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  return count;
}
