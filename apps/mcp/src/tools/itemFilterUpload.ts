/**
 * MCP-инструмент: GGG Item Filters API (P3-E) — загрузка лут-фильтра в аккаунт.
 *
 * Две ветки доставки фильтра (разведены с самого начала, план §1):
 *  - диск (poe2_live_filter write=true) — папка игры, работает без OAuth;
 *  - аккаунт GGG (этот тул) — фильтр виден в игре через Settings → Lists без
 *    ручного файла; требует входа poe2_oauth_login (scope account:item_filter).
 *
 * Источник тела: fromGameFilter (файл из папки игры, продукт live_filter) >
 * fromPath (явный файл) > content (короткий фильтр прямо в аргументе).
 *
 * Безопасность: по умолчанию mode=list (только чтение аккаунта); upload —
 * idempotent upsert по filterName+realm, существующие чужие фильтры не трогает.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import fs from 'node:fs';
import path from 'node:path';

const o = core.oauth;

export function registerItemFilterUploadTools(server: McpServer): number {
  let count = 0;

  server.registerTool(
    'poe2_item_filter_upload',
    {
      title: 'PoE2 Item Filter Upload (GGG API)',
      description: `Работа с аккаунтными онлайн-фильтрами GGG (Item Filters API, realm poe2). mode=list — показать фильтры на аккаунте; mode=upload — идемпотентная загрузка (upsert по имени): тело берётся из файла в папке игры (fromGameFilter, напр. после poe2_live_filter write=true), явного файла (fromPath) или прямо из content. Требует вход poe2_oauth_login с scope account:item_filter.

Аргументы:
  - mode ("list" | "upload", default "list"): list — чтение; upload — upsert на аккаунт.
  - filterName (string, опц., default из имени файла): имя фильтра НА аккаунте GGG.
  - fromGameFilter (string, опц., default "poe2kit_live"): файл .filter в папке игры (Documents\\My Games\\Path of Exile 2).
  - fromPath (string, опц.): явный путь к .filter-файлу.
  - content (string, опц.): тело фильтра прямо в аргументе (для коротких фильтров).
  - realm (string, опц., default "poe2"): pc | xbox | sony | poe2.
  - description / version / type (string, опц.): метаданные фильтра GGG.
  - validate (boolean, default true): провалидировать против текущей версии игры.

Примеры:
  - "Загрузи фильтр в аккаунт GGG" → mode=upload, fromGameFilter="poe2kit_live"
  - "Какие фильтры на аккаунте?" → mode=list`,
      inputSchema: {
        mode: z.enum(['list', 'upload']).optional(),
        filterName: z.string().optional(),
        fromGameFilter: z.string().optional(),
        fromPath: z.string().optional(),
        content: z.string().optional(),
        realm: z.enum(['pc', 'xbox', 'sony', 'poe2']).optional(),
        description: z.string().optional(),
        version: z.string().optional(),
        type: z.enum(['Normal', 'Ruthless']).optional(),
        validate: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        if ((args.mode ?? 'list') === 'list') {
          const filters = await o.listAccountItemFilters();
          const header = `## Фильтры на аккаунте GGG — ${filters.length}`;
          if (filters.length === 0) {
            return { content: [{ type: 'text', text: `${header}\n\nПусто. mode=upload создаст первый.` }] };
          }
          const rows = filters.map((f) => {
            const v = f.validation;
            const val = v ? (v.valid ? `валиден (${v.version ?? '?'})` : `⚠ НЕвалиден`) : '—';
            return `- **${f.filter_name}** [${f.realm}] ${f.type ?? 'Normal'}, версия ${f.version ?? '?'}, ${val}, id \`${f.id ?? '?'}\``;
          });
          return { content: [{ type: 'text', text: [header, '', ...rows].join('\n') }] };
        }

        // mode=upload: источник тела фильтра.
        const source =
          args.content !== undefined
            ? { body: args.content, label: 'content (аргумент)' }
            : args.fromPath !== undefined
              ? {
                  body: fs.readFileSync(args.fromPath, 'utf8'),
                  label: args.fromPath,
                }
              : (() => {
                  const dir = core.livefilterInjector.poe2GameDir();
                  const name = (args.fromGameFilter ?? 'poe2kit_live').replace(/[\\/:*?"<>|]/g, '_');
                  if (!dir) {
                    throw new Error(
                      'Папка игры не найдена, fromPath/content не заданы: нет источника тела фильтра.',
                    );
                  }
                  const p = path.join(dir, `${name}.filter`);
                  return { body: fs.readFileSync(p, 'utf8'), label: p };
                })();
        if (source.body.trim() === '') {
          return { isError: true, content: [{ type: 'text', text: `Источник пуст: ${source.label}` }] };
        }

        const filterName =
          args.filterName ?? path.basename(source.label).replace(/\.filter$/i, '') ?? 'poe2kit_live';
        const r = await o.upsertAccountItemFilter({
          filterName,
          content: source.body,
          realm: args.realm ?? 'poe2',
          description: args.description,
          version: args.version,
          type: args.type,
          validate: args.validate ?? true,
        });

        const v = r.filter.validation;
        const rows: string[] = [
          `## GGG Item Filter — ${r.action === 'created' ? 'СОЗДАН' : r.action === 'updated' ? 'ОБНОВЛЁН' : 'БЕЗ ИЗМЕНЕНИЙ (тело совпало)'}`,
          ``,
          `- Имя на аккаунте: **${r.filter.filter_name}** [${r.filter.realm}], id \`${r.filter.id ?? '?'}\``,
          `- Источник тела: \`${source.label}\` (${source.body.split('\n').length} строк)`,
          `- Валидация GGG: ${v ? (v.valid ? `✅ валиден (${v.version ?? '?'}, ${v.validated ?? '?'})` : '⚠ НЕвалиден') : 'нет данных'}`,
        ];
        if (r.acceptedWithErrors) {
          rows.push(
            ``,
            `### ⚠ 202 Accepted: фильтр сохранён, но GGG нашёл проблемы`,
            '```',
            JSON.stringify(r.validationError, null, 2).slice(0, 2000),
            '```',
          );
        }
        rows.push(``, `В игре: Settings → Lists → Item Filters выберите «${r.filter.filter_name}».`);
        return { content: [{ type: 'text', text: rows.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const hint = /401|403|scope/.test(msg)
          ? ' Токен выдан ДО scope account:item_filter — повторите poe2_oauth_login.'
          : '';
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}.${hint}` }] };
      }
    },
  );
  count++;
  return count;
}
