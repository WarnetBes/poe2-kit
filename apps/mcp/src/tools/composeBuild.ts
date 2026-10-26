/**
 * MCP-инструмент: poe2_compose_build — синтез скелета билда (№497).
 *
 * Обёртка над core.buildComposer.composeBuild() (async, ядро офлайн):
 * ладдер-строки poe.ninja качает ЗДЕСЬ, в слое MCP-тула, с таймаутом
 * и try/catch — при недоступной сети composeBuild продолжит с пустыми
 * rows (null-поля + unverified), без крашей.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core, type LadderRow } from '@poe2-kit/core';

/** Таймаут сетевого добора ладдера, мс (паттерн http.ts: явный потолок ожидания). */
const LADDER_TIMEOUT_MS = 20000;

export function registerComposeBuildTools(server: McpServer): number {
  server.registerTool(
    'poe2_compose_build',
    {
      title: 'PoE2 Build Composer (skeleton + goal checks)',
      description: `Синтез скелета билда PoE2 под параметры (паттерн poe2-build-mcp, MIT): класс/асценданси → оружие → main-скилл → саппорты → бюджетная стадия curated-гайда → числовые цели (resist cap / EHP / DPS-медиана ладдера). Все числа — из канонических модулей ядра; чего нет в данных — null + строка в «Не выведено».

Main-скилл выводится цепочкой: skill_hint → user_build_code (первый socket-активный камень) → ладдер poe.ninja → curated-гайд → камни стартового билда.

Аргументы:
  - class (string, обяз.): базовый класс ИЛИ асценданси (EN): "Monk", "Invoker", "Acolyte of Chayula"…
  - level (number, опц., по умолч. 90): цель по уровню (1–100).
  - budget (опц., 'ssf'|'budget'|'mid'|'rich', по умолч. 'ssf'): стадия curated-гайда.
  - skill_hint (string, опц.): явный EN-скилл main-скилла. Алиас: skill.
  - user_build_code (string, опц.): PoB share-код/XML вашего билда — main-скилл + верификация целей (GoalCheck-вердикты).
  - enemy_level (number, опц., по умолч. 84): уровень врага для EHP-цели.
  - league (string, опц.): slug лиги poe.ninja для ладдер-контекста (по умолч. — текущая; при недоступности сети ладдер молча пропускается).

Hint сверяется с датасетом гемов: точное имя → канонизация регистра, неизвестное имя → честная пометка в «Не выведено», а не молчаливый фолбэк на ладдер.`,
      inputSchema: {
        class: z.string().min(2).describe('Базовый класс или асценданси (EN): Monk / Invoker / …'),
        level: z.number().int().min(1).max(100).optional().describe('Целевой уровень (по умолч. 90)'),
        budget: z.enum(['ssf', 'budget', 'mid', 'rich']).optional().describe('Бюджет → стадия гайда (по умолч. ssf)'),
        skill_hint: z.string().optional().describe('Явная подсказка main-скилла (EN)'),
        skill: z
          .string()
          .optional()
          .describe('Алиас skill_hint (main-скилл, EN); при задании обоих приоритет у skill_hint'),
        user_build_code: z.string().optional().describe('PoB share-код/XML билда пользователя'),
        enemy_level: z.number().int().min(1).max(100).optional().describe('Уровень врага для EHP-цели (по умолч. 84)'),
        league: z.string().optional().describe('Slug лиги poe.ninja (иначе текущая)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ class: classQuery, level, budget, skill_hint, skill, user_build_code, enemy_level, league }) => {
      try {
        // Ладдер-контекст: сеть с таймаутом, неудача — не фатальна
        // (composeBuild продолжит с пустыми rows, честно пометив хвосты).
        let ladderRows: LadderRow[] = [];
        try {
          const slug =
            league ?? (await core.trade.currentDefaultLeague()).toLowerCase().replace(/\s+/g, '');
          const res = await Promise.race([
            core.ladder.searchLadderBuilds(slug, { class: classQuery, sort: 'level' }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), LADDER_TIMEOUT_MS)),
          ]);
          ladderRows = res?.rows ?? [];
        } catch {
          ladderRows = [];
        }
        const enemyLvl = Math.max(1, Math.min(100, Math.round(enemy_level ?? 84)));
        const result = await core.buildComposer.composeBuild({
          classQuery: classQuery ?? '',
          level,
          budget,
          skillHint: skill_hint ?? skill,
          userBuildCode: user_build_code,
          ladderRows,
          enemyLevel: enemyLvl,
        });
        if (!result) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Класс «${classQuery}» не резолвится в известные классы/асценданси PoE2 (дисциплина: не выдумываем билд). Проверьте написание (EN), примеры: Monk, Invoker, Warrior, Warbringer, Sorceress, Stormweaver.`,
              },
            ],
          };
        }
        const lines: string[] = [];
        lines.push(`## Скелет билда: ${result.className}${result.classQuery !== result.className ? ` (${result.classQuery})` : ''}`);
        lines.push('');
        lines.push(
          `- Уровень: **${result.level}** | Бюджет-стадия: ${result.budgetStage ?? '—'}${result.budgetCost ? ` (≈ ${result.budgetCost})` : ''}`,
        );
        lines.push(
          `- Main-скилл: **${result.mainSkill ?? '—'}**` +
            (result.mainSkillSource ? ` (источник: ${result.mainSkillSource})` : '') +
            (result.skillSharePercent != null ? `, доля в ладдере: ${result.skillSharePercent}%` : ''),
        );
        if (result.ascendancyKeystones?.length) {
          lines.push(`- Ключевые ноты асценданси: ${result.ascendancyKeystones.join(', ')}`);
        }
        lines.push(
          `- Оружие класса: ${result.weapon.weapon ?? '—'}${result.weapon.offhand ? ` / ${result.weapon.offhand}` : ''}`,
        );
        if (result.supports.length) {
          lines.push(
            `- Саппорты: ${result.supports.map((s) => `${s.en}${s.tier ? ` (${s.tier})` : ''}`).join(', ')}`,
          );
        }
        const c = result.capTargets;
        lines.push('', '### Числовые цели (канон)', '');
        lines.push(
          `- Резисты: ${c.resistCap}% | Базовый пул жизни (L${result.level}): ${c.baseLifePool}`,
          `- EHP-цель (удар врага L${enemyLvl} × пиннакл-фактор): **${c.ehpGoal}**`,
          `- DPS-цель (медиана ладдера): ${c.dpsGoal != null ? `~${c.dpsGoal}` : '— (нет ладдер-строк)'}`,
        );
        lines.push('', '### Слоты шопинг-листа', '');
        if (result.slots.length) {
          for (const s of result.slots) {
            lines.push(`- ${s.slot}: ${s.base}${s.note ? ` — ${s.note}` : ''}`);
          }
        } else {
          lines.push('_Пусто — слоты не выведены._');
        }
        if (result.popularSkills.length) {
          lines.push('', '### Что играют топы (ладдер-контекст)', '');
          lines.push(result.popularSkills.map((s) => `- ${s.name}: ${s.count} (${s.sharePercent}%)`).join('\n'));
        }
        if (result.goalChecks?.length) {
          lines.push('', '### Вердикты целей (по user_build_code)', '', '| Цель | Текущее | Цель | Разрыв | Вердикт |', '|---|---|---|---|---|');
          for (const g of result.goalChecks) {
            const gap = g.gap == null ? '—' : g.gap >= 0 ? `+${g.gap}` : `${g.gap}`;
            lines.push(`| ${g.metric} | ${g.current ?? '—'} (${g.kind}) | ${g.goal} | ${gap} | ${g.verdict === 'pass' ? '✅' : g.verdict === 'fail' ? '❌' : '❔'} ${g.note ?? ''} |`);
          }
        }
        if (result.unverified.length) {
          lines.push('', '### Не выведено из данных (честно)', '');
          for (const u of result.unverified) lines.push(`- ⚠️ ${u}`);
        }
        if (!ladderRows.length) {
          lines.push('', '_Ладдер недоступен (сеть/таймаут) — мета-контекст и DPS-цель из ладдера опущены._');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка compose: ${msg}` }] };
      }
    },
  );

  return 1;
}
