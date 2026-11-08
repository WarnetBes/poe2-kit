/**
 * MCP-тул `poe2_delirium_recipes` (№738): делириум-анoint-рецепты PoE2 —
 * какие очищенные эмоции (Liquid Emotions) наносят какой пассивный узел на
 * амулет у Увядшей Ивы (Withered Ivy, Атлас). Офлайн-датасет; данные —
 * фан-сайт poe2-biblioteka.ru (community, НЕ датамайн) — честная пометка
 * unverified в выдаче (дисциплина №222: не выдаём community-данные за канон GGG).
 *
 * Вход: query (имя узла / подстрока стата) и/или emotions (ключи из легенды),
 * secret / has_recipe / limit (опц.). Выход: markdown + structured.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

/** Регистрация тула `poe2_delirium_recipes`. Возвращает число добавленных инструментов (1). */
export function registerDeliriumTools(server: McpServer): number {
  let n = 0;
  core.delirium.getDeliriumDataset(); // fail-fast при отсутствии датасета — лучше на старте, чем в ручке

  server.registerTool(
    'poe2_delirium_recipes',
    {
      title: 'PoE2 Delirium Anoint Recipes',
      description: `Делириум-анoint PoE2: очищенные эмоции (Liquid Emotions) → пассивный узел, наносимый на амулет у Увядшей Ивы (Withered Ivy, Атлас). Поиск по имени узла/стату И/ИЛИ по набору эмоций; секретные рецепты (узлы вне дерева: Дополненная плоть, Бастион света, Thaumaturgic Generator и др.) — параметр secret: true.

Легенда эмоций (id=RU): red=Гнев, violet=Вина, orange=Жадность, yellow=Паранойя, green=Зависть, grass=Отвращение, blue=Отчаяние, purple=Страх, black=Страдание, white=Отчуждение; секретные: em_prez=Презрение, em_svir=Свирепость, em_melan=Меланхолия. Слотов 3; повтор ключа = кратность («red»+«red»+«black» → emotions: ["red","red","black"]).

⚠️ Данные — фан-сайт poe2-biblioteka.ru (community), НЕ датамайн GGG; рецепты НЕ сверены живой игрой — при расхождении верь игре.

Примеры:
  - "Как анoint-нуть Charges генерацию?" → query: "заряд"
  - "Что сделать из 2 Гнева и Страдания?" → emotions: ["red","red","black"]
  - "Секретные рецепты делириума" → secret: true
  - "Есть ли рецепт у узла Неукротимость?" → query: "Неукротимость"`,
      inputSchema: {
        query: z.string().optional().describe('Подстрока в имени узла или строках статов (RU)'),
        emotions: z
          .array(z.string())
          .optional()
          .describe('Ключи эмоций по слотам с кратностью: ["red","red","black"] = Гнев×2 + Страдание'),
        secret: z.boolean().optional().describe('Только секретные (true) / только обычные (false) / все (undefined)'),
        has_recipe: z
          .boolean()
          .optional()
          .describe('Только с рецептом (true) / только без опубликованного рецепта (false) / все (undefined)'),
        limit: z.number().int().min(1).max(50).optional().describe('Лимит выдачи (по умолчанию 20)'),
      },
      outputSchema: {
        matched: z.number(),
        shown: z.number(),
        recipes: z.array(z.any()),
        stats: z.any(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, emotions, secret, has_recipe, limit }) => {
      try {
        if (!query && !(emotions && emotions.length > 0)) {
          const stats = core.delirium.deliriumDatasetStats();
          const ds = core.delirium.getDeliriumDataset();
          const leg = [...ds.emotions, ...ds.secret_emotions].map((e) => `${e.id}=${e.ru}`).join(', ');
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Укажите query и/или emotions (пример: query: "заряд", emotions: ["red","red","black"]).\n` +
                  `Датасет: ${stats.total} узлов, ${stats.withRecipe} с рецептом, ${stats.secret} секретных.\n` +
                  `Легенда: ${leg}.\n` +
                  core.delirium.DELIRIUM_PROVENANCE_NOTE,
              },
            ],
            structuredContent: {
              matched: 0,
              shown: 0,
              recipes: [],
              stats,
            },
          };
        }
        const results = core.delirium.searchDeliriumRecipes({
          query,
          emotions,
          secret,
          hasRecipe: has_recipe,
        });
        const total = results.length;
        const shown = results.slice(0, limit ?? 20);
        const markdown = core.delirium.formatDeliriumResults(shown, total);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: {
            matched: total,
            shown: shown.length,
            recipes: shown.map(({ recipe, recipe_ru }) => ({
              name_ru: recipe.name_ru,
              stats_ru: recipe.stats_ru,
              emotions: recipe.emotions,
              recipe_ru,
              has_recipe: recipe.has_recipe,
              secret: recipe.secret,
            })),
            stats: core.delirium.deliriumDatasetStats(),
          },
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: `Ошибка delirium_recipes: ${e instanceof Error ? e.message : String(e)}` },
          ],
        };
      }
    },
  );
  n++;
  return n;
}
