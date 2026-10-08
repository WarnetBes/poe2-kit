
/**
 * MCP-инструменты: poe.ninja PoE2 builds-лэддер (топы, мета, фильтры).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerLadderTools(server: McpServer): number {
  server.registerTool(
    'poe2_ladder_top',
    {
      title: 'PoE2 Ladder Top (poe.ninja)',
      description: `Топ-билды poe.ninja PoE2 (protobuf builds-API, колонки декодируются, классы/скиллы расшифровываются через nDIC-словари).

Аргументы:
  - league (string, опц.): slug лиги poe.ninja (например "forbiddenrites"); по умолчанию — текущая лига (Forbidden Rites).
  - class (string, опц.): фильтр по классу/асценданси, например "Invoker", "Pathfinder".
  - sort (string, опц., по умолч. "level"): сортировка — level, dps, ehp...
  - limit (number, опц., по умолч. 20): сколько строк показать (макс. 100).

Полезно для вопроса «что играют топы» и мета-обзоров.`,
      inputSchema: {
        league: z.string().optional().describe('Slug лиги poe.ninja (иначе текущая лига)'),
        class: z.string().optional().describe('Фильтр по классу/асценданси'),
        sort: z.string().optional().describe('Сортировка: level / dps / ehp'),
        limit: z.number().int().min(1).max(100).optional().describe('Число строк (1-100)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ league, class: className, sort, limit }) => {
      try {
        const leagueSlug = league ?? (await core.trade.currentDefaultLeague()).toLowerCase().replace(/\s+/g, '');
        const res = await core.ladder.searchLadderBuilds(leagueSlug, {
          class: className,
          sort: sort ?? 'level',
        });
        if (!res) {
          const avail = (await core.ladder.listLadderLeagues()).slice(0, 12).join(', ');
          return {
            content: [
              { type: 'text', text: `Лэддер недоступен. Доступные лиги: ${avail}` },
            ],
          };
        }
        const rows = res.rows.slice(0, limit ?? 20);
        const lines: string[] = [];
        lines.push(`## poe.ninja PoE2 — топ ${leagueSlug}${className ? ` / ${className}` : ''}${sort ? ` / sort=${sort}` : ''}`);
        lines.push(`Всего билдов в выборке: **${res.total ?? '?'}**`, '');
        lines.push(core.ladder.formatLadderRows(rows, rows.length));
        if (res.columns.length) {
          lines.push('', `_Колонки ответа: ${res.columns.join(', ')}_`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка лэддера: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_ladder_leagues',
    {
      title: 'PoE2 Ladder Leagues (poe.ninja)',
      description: 'Список доступных снапшотов-лиг poe.ninja PoE2 (slug для poe2_ladder_top): lobbying-лиги, HC/SSF варианты, event-лиги.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const snaps = await core.ladder.getLadderSnapshots();
        const lines = snaps.map(
          (s) => `- \`${s.url}\` (snapshot: ${s.snapshotName}, v${s.version})`,
        );
        return {
          content: [
            { type: 'text', text: `## Лиги poe.ninja PoE2 (${snaps.length})\n\n${lines.join('\n')}` },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка списка лиг: ${msg}` }] };
      }
    },
  );
  server.registerTool(
    'poe2_skill_meta',
    {
      title: 'PoE2 Skill Meta (tops by skill)',
      description: `Что играют топы poe.ninja PoE2 с этим скиллом: классы/асценданси, сопутствующие скиллы (комбо), уровни, разброс DPS/EHP. Плюс опциональное сравнение вашего билда с топами (перцентили).

Отвечает на «в чём силен этот скилл у топов» и «кто его играет» без POESESSID — только публичный poe.ninja builds-API.

Аргументы:
  - skill (нужно): имя скилла, например "Comet", "Ice Strike" (регистр не важен, можно подстроку).
  - league (опц.): slug лиги poe.ninja; по умолчанию — текущая.
  - sort (опц., "level"): сортировка выборки лэддера (level / dps / ehp) — ЧЬИ топы смотрим.
  - user_level, user_dps, user_ehp, user_class (опц.): сравнить ваш билд с топами по этому скиллу.

Выборка — первая страница лэддера (топ-100 по выбранной сортировке); доля = игроки со скиллом / 100.`,
      inputSchema: {
        skill: z.string().min(2).describe('Имя скилла (подстрока, регистр не важен)'),
        league: z.string().optional().describe('Slug лиги poe.ninja (иначе текущая лига)'),
        sort: z.string().optional().describe('Сортировка выборки: level / dps / ehp'),
        user_level: z.number().optional().describe('Ваш уровень (для сравнения)'),
        user_dps: z.number().optional().describe('Ваш DPS (для сравнения)'),
        user_ehp: z.number().optional().describe('Ваш EHP (для сравнения)'),
        user_class: z.string().optional().describe('Ваш класс/асценданси (для сравнения)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const leagueSlug =
          args.league ?? (await core.trade.currentDefaultLeague()).toLowerCase().replace(/\s+/g, '');
        const meta = await core.ladder.skillLadderMeta(args.skill, {
          league: leagueSlug,
          sort: args.sort,
        });
        if (!meta) {
          return { isError: true, content: [{ type: 'text', text: `Лэддер лиги "${leagueSlug}" недоступен.` }] };
        }
        const fmt = (v: number | null) =>
          v === null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${v}`;
        const lines: string[] = [];
        if (meta.players === 0) {
          const res = await core.ladder.searchLadderBuilds(leagueSlug, { sort: args.sort ?? 'level' });
          const popular = core.ladder.popularSkills(res?.rows ?? []);
          lines.push(
            `Скилл "${args.skill}" не найден в топ-100 лиги ${leagueSlug} (sort=${args.sort ?? 'level'}).`,
            '',
            'Популярные скиллы этой выборки: ' + (popular.map((s) => `${s.name} (${s.count})`).join(', ') || '—'),
            '',
            '_Возможно, скилл нишевый: попробуйте sort=dps/ehp, другую лигу или проверьте написание._',
          );
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        lines.push(`## Мета: ${args.skill} (${leagueSlug}, sort=${args.sort ?? 'level'})`, '');
        lines.push(
          `Игроков в топ-100: **${meta.players} (${meta.sharePercent.toFixed(0)}%)** | средний уровень ${
            meta.avgLevel?.toFixed(1) ?? '—'
          } | урон (медиана): **${fmt(meta.medianDps)}**, топ: **${fmt(meta.topDps)}** | EHP (медиана): ${fmt(
            meta.medianEhp,
          )}`,
        );
        if (meta.classes.length) {
          lines.push('', '### Классы');
          for (const c of meta.classes.slice(0, 6)) {
            lines.push(`- ${c.label}: ${c.count} (${c.percent.toFixed(0)}%)`);
          }
        }
        if (meta.comboSkills.length) {
          lines.push('', '### Берут вместе с этим скиллом');
          lines.push(meta.comboSkills.slice(0, 8).map((s) => `${s.name} (${s.count})`).join(', '));
        }
        if (args.user_level !== undefined || args.user_dps !== undefined || args.user_ehp !== undefined) {
          const cmp = core.ladder.compareWithLadderRows(meta.rows, {
            level: args.user_level,
            dps: args.user_dps,
            ehp: args.user_ehp,
            classLabel: args.user_class,
          });
          lines.push('', `### Ваш билд vs топы (${cmp.poolSize} игроков)`);
          const row = (label: string, m: { value: number; percentile: number } | null) =>
            m ? `- ${label}: ${fmt(m.value)} — лучше ${(m.percentile).toFixed(0)}% топов` : `- ${label}: —`;
          lines.push(row('Уровень', cmp.level));
          lines.push(row('DPS', cmp.dps));
          lines.push(row('EHP', cmp.ehp));
          if (cmp.classMeta !== null) {
            lines.push(
              `- Класс "${cmp.classLabel}": ${
                cmp.classMeta ? 'встречается среди топов с этим скиллом' : 'редок/не встречается у топов с этим скиллом'
              }`,
            );
          }
        }
        lines.push('', '### Примеры топов');
        lines.push(core.ladder.formatLadderRows(meta.topRows, 8));
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка мета-запроса: ${msg}` }] };
      }
    },
  );
  return 3;
}
