/**
 * Делириум-анoint-рецепты PoE2 (№736/№738): очищенные эмоции (Liquid Emotions)
 * → пассивный узел, наносимый на амулет у Увядшей Ивы (Withered Ivy) на Атласе.
 *
 * Данные — data/game/delirium/delirium_recipes.json: курируемый харвест
 * фан-сайта poe2-biblioteka.ru (RU; калькулятор Делириума, обновление страницы
 * 12.06.2026, харвест 08.11.2026). ⚠️ Данные сообщества, НЕ датамайн GGG:
 * рецепты НЕ сверены живой игрой — в выдаче помечаются «community/unverified»
 * (дисциплина kit: честность вместо выдуманного канона).
 *
 * Механика (по данным страницы): 3 слота эмоций; повтор иконки = +1 ед. той же
 * эмоции; порядок сохранён; 3 эмоции верстака = 1 эмоция более высокого уровня.
 * Секретные рецепты («secret»: узлы вне дерева) используют доп. эмоции
 * Презрение/Свирепость/Меланхолия.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

// ─── Типы (shape датасета, сгенерирован парсером №738) ────────────────────────

export interface DeliriumEmotion {
  id: string;
  ru: string;
  /** true для эмоций, встречающихся только в секретных рецептах. */
  secret_only?: boolean;
}

export interface DeliriumAnointRecipe {
  name_ru: string;
  stats_ru: string[];
  /** Ключи эмоций по слотам ('red', 'blank', 'em_prez', …). */
  emotions: string[];
  /** RU-имена из title-атрибутов иконок (независимая проверка иконок). */
  emotion_titles: Array<string | null>;
  has_recipe: boolean;
  secret: boolean;
  /** Маркер донорской разметки: 'block' | 'aaa' | 'secret_plain'. */
  div_class: string;
}

export interface DeliriumDataset {
  _meta: {
    source: string;
    fetchedAt: string;
    license: string;
    page_updated?: string;
    counters_mode?: string;
    anomalies?: Record<string, unknown>;
  };
  emotions: DeliriumEmotion[];
  secret_emotions: DeliriumEmotion[];
  recipes: DeliriumAnointRecipe[];
}

// ─── Загрузка (кэш; браузер = throw, датасет для web не shipped) ─────────────

let cache: DeliriumDataset | null = null;

/** Полный датасет делириум-рецептов (офлайн-файл, Node). */
export function getDeliriumDataset(): DeliriumDataset {
  if (cache) return cache;
  if (!HAS_DISK) {
    throw new Error('Делириум-датасет недоступен в браузере: нужен Node/офлайн-файл.');
  }
  const dir = pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'delirium',
  );
  cache = JSON.parse(fsMod!.readFileSync(pathMod!.join(dir, 'delirium_recipes.json'), 'utf8')) as DeliriumDataset;
  return cache;
}

/** Словарь id → RU-имя для всех эмоций (легенда + секретные). */
export function deliriumEmotionNames(): Record<string, string> {
  const ds = getDeliriumDataset();
  const out: Record<string, string> = {};
  for (const e of [...ds.emotions, ...ds.secret_emotions]) out[e.id] = e.ru;
  out['blank'] = out['blank'] ?? '—';
  return out;
}

// ─── Поиск ──────────────────────────────────────────────────────────────────

export interface DeliriumSearchOptions {
  /** Подстрока в имени узла или строках статов (case-insensitive). */
  query?: string;
  /**
   * Ключи эмоций (['red','black']); рецепт подходит, если содержит КАЖДУЮ
   * emotion минимум столько раз, сколько перечислено (мультимножество).
   */
  emotions?: string[];
  /** Только секретные (true) / только обычные (false) / все (undefined). */
  secret?: boolean;
  /** undefined = все; true = только с рецептом; false = только без рецепта. */
  hasRecipe?: boolean;
  limit?: number;
}

export interface DeliriumSearchResult {
  recipe: DeliriumAnointRecipe;
  /** RU-строка рецепта («Гнев ×2 + Страдание»), null если рецепт не опубликован. */
  recipe_ru: string | null;
}

/** Содержит ли мультимножество emotions рецепта все запрошенные эмоции кратности. */
function containsAllEmotions(recipeEmotions: string[], wanted: string[]): boolean {
  const have = new Map<string, number>();
  for (const e of recipeEmotions) have.set(e, (have.get(e) ?? 0) + 1);
  const need = new Map<string, number>();
  for (const e of wanted) need.set(e, (need.get(e) ?? 0) + 1);
  for (const [id, n] of need) if ((have.get(id) ?? 0) < n) return false;
  return true;
}

/** Поиск рецептов по имени/статам и/или набору эмоций. */
export function searchDeliriumRecipes(opts: DeliriumSearchOptions = {}): DeliriumSearchResult[] {
  const ds = getDeliriumDataset();
  const names = deliriumEmotionNames();
  const q = opts.query?.trim().toLowerCase() ?? '';
  const wanted = (opts.emotions ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((e) => !(e in names));
  if (unknown.length > 0) {
    throw new Error(
      `Неизвестные эмоции: ${unknown.join(', ')}. Легенда: ${Object.entries(names).map(([id, ru]) => `${id}=${ru}`).join(', ')}.`,
    );
  }
  const out: DeliriumSearchResult[] = [];
  for (const r of ds.recipes) {
    if (opts.secret !== undefined && r.secret !== opts.secret) continue;
    if (opts.hasRecipe !== undefined && r.has_recipe !== opts.hasRecipe) continue;
    if (wanted.length > 0 && (!r.has_recipe || !containsAllEmotions(r.emotions, wanted))) continue;
    if (q) {
      const nameHit = r.name_ru.toLowerCase().includes(q);
      const statHit = r.stats_ru.some((s) => s.toLowerCase().includes(q));
      if (!nameHit && !statHit) continue;
    }
    let recipe_ru: string | null = null;
    if (r.has_recipe) {
      const counts = new Map<string, number>();
      for (const e of r.emotions) if (e !== 'blank') counts.set(e, (counts.get(e) ?? 0) + 1);
      const parts = [...counts.entries()].map(([id, n]) => (n > 1 ? `${names[id] ?? id} ×${n}` : (names[id] ?? id)));
      recipe_ru = parts.length > 0 ? parts.join(' + ') : '—';
    }
    out.push({ recipe: r, recipe_ru });
  }
  if (opts.limit && out.length > opts.limit) out.length = opts.limit;
  return out;
}

/** Краткая статистика датасета (для гайдов/диагностики). */
export function deliriumDatasetStats(): { total: number; withRecipe: number; noRecipe: number; secret: number } {
  const rs = getDeliriumDataset().recipes;
  return {
    total: rs.length,
    withRecipe: rs.filter((r) => r.has_recipe).length,
    noRecipe: rs.filter((r) => !r.has_recipe).length,
    secret: rs.filter((r) => r.secret).length,
  };
}

// ─── Markdown-выдача ─────────────────────────────────────────────────────────

/** Честная шапка происхождения данных — дисциплина unverified (№222). */
export const DELIRIUM_PROVENANCE_NOTE =
  'Данные — фан-сайт poe2-biblioteka.ru (RU, калькулятор Делириума, обновление страницы 12.06.2026, харвест 08.11.2026). ' +
  '⚠️ Community-данные, НЕ датамайн GGG: рецепты НЕ сверены живой игрой; при расхождении с игрой верь игре. ' +
  'Механика: 3 слота эмоций у Увядшей Ивы (Withered Ivy, Атлас); верстак: 3 эмоции → 1 эмоция выше уровнем.';

/**
 * Markdown по найденным рецептам. Контекст — только факты датасета + шапка
 * происхождения (unverified), без выдуманных деталей.
 */
export function formatDeliriumResults(results: DeliriumSearchResult[], totalMatched: number): string {
  const lines: string[] = [];
  lines.push(`## Делириум-анoint: ${totalMatched} совпад.${totalMatched !== results.length ? ` (показано ${results.length})` : ''}`);
  lines.push('');
  for (const { recipe, recipe_ru } of results) {
    lines.push(`### ${recipe.name_ru}${recipe.secret ? ' 🔒 секретный' : ''}`);
    if (recipe_ru) lines.push(`- Рецепт: ${recipe_ru}`);
    else lines.push('- Рецепт: не опубликован донором (узел известен, комбинация эмоций — нет)');
    for (const s of recipe.stats_ru) lines.push(`- ${s}`);
    lines.push('');
  }
  lines.push(DELIRIUM_PROVENANCE_NOTE);
  return lines.join('\n');
}
