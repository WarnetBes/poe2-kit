/**
 * Трёхслойный движок рекомендаций саппортов для активного гема (№192).
 * №262 Этап 4: вынесен из apps/overlay/src/main.ts (supportsForActive,
 * ~:4067–4090) — единый источник для оверлея, web и MCP-тулов.
 *
 * Слои: meta_supports.json (эталон меты: билд+дата) → recommended_supports.json
 * (base-список с рангами) → пусто (нет рекомендаций старения данных).
 *
 * Данные — core.dataset (в оверлее читается с диска, в web — через
 * installBrowserDataset('skill_gems/...'); ). Кэши заполняются один раз
 * за процесс — то же поведение, что было в оверлее до выноса.
 */

import * as dsmod from './dataset.js';

/**
 * Рекомендация одного саппорта для активного гема (lite-форма рендера:
 * tier 'meta'|'base', note для «эталон меты: <билд>»). Не путать с
 * dataset.GemSupportReco — это строка recommended_supports.json.
 */
export interface GemSupportRecoLite {
  en: string;
  tier: 'meta' | 'base';
  rank: number | null;
  note: string | null; // «эталон меты: <билд>» | null
}

/**
 * Нормализация имени гема для ключей датасетов: без диакритики (poe2db-слаг),
 * ё→е, й→и (RU-имена poe2db пишут «и»), без кавычек/апострофов, нижний регистр.
 */
export function normGemName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // Oisín's -> Oisins: percent-encoded слаги poe2db без диакритики
    .replace(/ё/g, 'е')
    .replace(/й/g, 'и') // poe2db RU-имена пишут «и» вместо «й» — сворачиваем обе стороны одинаково
    .replace(/[''`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

let metaSupportsCache: Record<string, { supports: string[]; build: string; date?: string }[]> | null =
  null;
let recoSupportsCache: Record<string, Array<{ rank: number; ru: string; en: string }>> | null =
  null;

/** Сброс кэшей (тесты/web: после installBrowserDataset). */
export function resetGemSupportCaches(): void {
  metaSupportsCache = null;
  recoSupportsCache = null;
}

/** Рекомендации саппортов для активного гема (EN-имя): меты или base-ранги. */
export function supportsForActive(en: string): GemSupportRecoLite[] {
  metaSupportsCache ??= dsmod.getMetaSupports()?.entries ?? {};
  recoSupportsCache ??= dsmod.getRecommendedSupports()?.map ?? {};
  const key = normGemName(en);
  const meta = metaSupportsCache[key];
  if (meta?.length) {
    const m = meta[0]!;
    const note = `эталон меты: ${m.build}${m.date ? ` (${m.date})` : ''}`;
    return m.supports.map((s) => ({ en: s, tier: 'meta' as const, rank: null, note }));
  }
  const base = recoSupportsCache[key];
  if (base?.length) {
    return base
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ en: r.en, tier: 'base' as const, rank: r.rank, note: null }));
  }
  return [];
}
