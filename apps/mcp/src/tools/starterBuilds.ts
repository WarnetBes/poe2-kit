/**
 * MCP-тул «🧬 Билды» (№257/этап 4-3): стартовые билды PoE2 0.5.x,
 * курируемые по ресёрч-волнам №471-№477 (lootkeeper/maxroll/poe.ninja).
 * Источник - core/starterBuildGuides.ts (starter_builds.json).
 *
 * Тул `poe2_starter_builds`: карточки билдов - стадии с ценами
 * (неопубликованные - честно «не опубликована»), уники, порядок
 * асценденси, PoB-ссылки, warning-позиции (фейк-связки) заметно.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listStarterBuildGuides,
  findStarterBuildGuide,
  starterBuildGuidesByClass,
  starterBuildGuidesByAscendancy,
  searchStarterBuildGuides,
  starterBuildGuidesMeta,
  type StarterBuildGuide,
  type StarterBuildNameRef,
  type StarterBuildStage,
} from '@poe2-kit/core';

const STAGE_LABEL: Record<'starter' | 'mid' | 'main' | 'max', string> = {
  starter: 'Старт',
  mid: 'Мид',
  main: 'Мейн',
  max: 'Макс',
};

function nameRef(r: StarterBuildNameRef | undefined): string {
  if (!r) return '';
  const name = r.ru ?? r.en ?? '';
  const other = r.ru && r.en ? ` (${r.en})` : '';
  const note = r.note ? ` ❓ ${r.note}` : '';
  return `${name}${other}${note}`.trim();
}

function stageBlock(key: 'starter' | 'mid' | 'main' | 'max', s: StarterBuildStage): string {
  const lines = [`  - ${STAGE_LABEL[key]}: ${s.cost ?? 'цена не опубликована'}`];
  if (s.lootkeeper_rub) lines.push(`    · витрина услуг lootkeeper (НЕ стоимость гира): ${s.lootkeeper_rub}`);
  if (s.delta) lines.push(`    · что меняется: ${s.delta}`);
  if (s.note) lines.push(`    · примечание: ${s.note}`);
  return lines.join('\n');
}

function buildBlock(b: StarterBuildGuide): string {
  const lines: string[] = [
    `### ${b.title_ru}${b.title_en ? ` (${b.title_en})` : ''} (${b.id})`,
    `- Класс: ${b.class_ru}${b.class_en && b.class_en !== b.class_ru ? ` (${b.class_en})` : ''}` +
      `${b.ascendancy_ru || b.ascendancy_en ? `; асценденси: ${b.ascendancy_ru ?? b.ascendancy_en}${b.ascendancy_en && b.ascendancy_ru && b.ascendancy_en !== b.ascendancy_ru ? ` (${b.ascendancy_en})` : ''}` : ''}`,
    `- Главный скилл: ${nameRef(b.main_skill as StarterBuildNameRef & { gem_level?: number })}${b.main_skill.gem_level ? ` (гем ур. ${b.main_skill.gem_level})` : ''}`,
  ];
  if (b.warning) lines.push(`- ⚠️ ВНИМАНИЕ: ${b.warning}`);
  if (b.variant_note) lines.push(`- Вариант: ${b.variant_note}`);
  if (b.seller_note) lines.push(`- Продавец: ${b.seller_note}${b.seller_prices_ru ? `; цены: ${b.seller_prices_ru}` : ''}`);
  if (b.author) lines.push(`- Автор: ${b.author}`);
  if (b.supports?.length) {
    const sup = b.supports.map(nameRef).filter(Boolean);
    if (sup.length) lines.push(`- Саппорты: ${sup.join(', ')}`);
  }
  if (b.ascendancy_order?.length) {
    lines.push(`- Порядок асценденси: ${b.ascendancy_order.map(nameRef).filter(Boolean).join(' → ')}`);
  }
  if (b.key_uniques?.length) {
    const uniq = b.key_uniques.map(nameRef).filter(Boolean);
    if (uniq.length) lines.push(`- Ключевые уники: ${uniq.join(', ')}`);
  }
  if (b.gear_tips && Object.keys(b.gear_tips).length) {
    lines.push(`- Гир: ${Object.entries(b.gear_tips).map(([k, v]) => `${k} - ${v}`).join('; ')}`);
  }
  lines.push(`- Механика: ${b.mechanics_ru}`);
  if (b.note_ru) lines.push(`- Заметка: ${b.note_ru}`);
  if (b.pros?.length) lines.push(`- Плюсы: ${b.pros.join('; ')}`);
  if (b.cons?.length) lines.push(`- Минусы: ${b.cons.join('; ')}`);
  if (b.stages && Object.keys(b.stages).length) {
    lines.push('- Стадии (цены гайдов):');
    for (const key of ['starter', 'mid', 'main', 'max'] as const) {
      const s = b.stages[key];
      if (s) lines.push(stageBlock(key, s));
    }
  }
  if (b.pob_links?.length) lines.push(`- PoB: ${b.pob_links.join(', ')}`);
  if (b.sources?.length) lines.push(`- Источники: ${b.sources.join('; ')}`);
  return lines.join('\n');
}

/** Регистрация тулов «Стартовые билды». Возвращает число зарегистрированных (1). */
export function registerStarterBuildsTools(server: McpServer): number {
  server.registerTool(
    'poe2_starter_builds',
    {
      title: 'PoE2 Starter Builds (0.5.x curated)',
      description: `Курируемые стартовые билды PoE2 0.5.x (18 позиций, патч 0.5.5, Forbidden Rites): стадии с ценами (что купить на старте/миде/мейне/максе), ключевые уники, порядок узлов асценденси, PoB-ссылки, плюсы/минусы. Позиции с field warning - фейк-связки/предостережения, читать обязательно. Неопубликованные цены честно null - не выдуманы.

Вход:
  - id (string, опц.): точечный поиск по id (например "invoker-ice-strike").
  - class (string, опц.): фильтр по классу, RU или EN («Ведьма», «Witch», «Монах»...).
  - ascendancy (string, опц.): фильтр по асценденси («Invoker», «Лич»...).
  - query (string, опц.): подстрока в id/заголовке/классе/асценденси/скилле.

Примеры:
  - "стартовые билды для ведьмы" → class: Ведьма
  - "что по билду на фликер" → query: фликер
  - "расскажи про lich-minions" → id: lich-minions`,
      inputSchema: {
        id: z.string().min(2).optional().describe('точный id билда'),
        class: z.string().min(2).optional().describe('фильтр по классу (RU/EN)'),
        ascendancy: z.string().min(2).optional().describe('фильтр по асценденси (RU/EN)'),
        query: z.string().min(2).optional().describe('подстрока в id/заголовках/скилле'),
      },
      outputSchema: {
        markdown: z.string(),
        builds: z.array(z.any()),
        total: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, class: cls, ascendancy, query }) => {
      try {
        let matched: StarterBuildGuide[];
        if (id) {
          const one = findStarterBuildGuide(id);
          matched = one ? [one] : [];
        } else if (ascendancy) {
          matched = starterBuildGuidesByAscendancy(ascendancy);
        } else if (cls) {
          matched = starterBuildGuidesByClass(cls);
        } else if (query) {
          matched = searchStarterBuildGuides(query);
        } else {
          matched = listStarterBuildGuides();
        }
        const m = starterBuildGuidesMeta();
        const header = [
          `## 🧬 Стартовые билды PoE2 - ${m.patch ?? '?'}, лига ${m.league ?? '?'}, срез ${m.asOf ?? '?'}`,
          `Всего ${m.buildsTotal} (с ценами ${m.withPrices}, классов ${m.classesTotal}, PoB-ссылок ${m.pobLinksTotal})`,
          '',
        ];
        const md = header
          .concat(matched.length ? matched.map(buildBlock) : ['Ничего не найдено.'])
          .join('\n');
        return { content: [{ type: 'text', text: md }], structuredContent: { markdown: md, builds: matched, total: matched.length } };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Билды недоступны: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  return 1;
}
