/**
 * Руны и аугменты PoE2 (класс Augment: руны + soul cores).
 *
 * Источник — офлайн-датасет base_items.json (RePoE-snapshot). Руны — торгуемые
 * base-типы: прайс-чек через trade2 search по `type` (см. MCP poe2_rune_prices).
 *
 * Проверено живьём 2026-09-30: trade2 «Desert Rune» во Forbidden Rites =
 * 239 листингов, `Verisium Remnant` — НЕ base-тип (400 Unknown item base type),
 * ремнанты — энкаунтер, не предмет.
 */

import { getBaseItems } from './dataset.js';

export type AugmentTier = 'lesser' | 'regular' | 'greater' | 'perfect';
export type AugmentKind = 'rune' | 'soul core' | 'other';

export interface AugmentEntry {
  /** Английское имя base-типа («Desert Rune», «Greater Storm Rune»). */
  name: string;
  tier: AugmentTier;
  kind: AugmentKind;
}

let augmentsCache: AugmentEntry[] | null = null;

/** Все аугменты из датасета (~313: руны едомии/калгуураны + soul cores). */
export function getAugments(): AugmentEntry[] {
  if (!augmentsCache) {
    augmentsCache = getBaseItems()
      .filter(
        (b) =>
          /augment/i.test(b.itemClass) ||
          /augment/i.test(b.itemClassName),
      )
      .map((b) => {
        const name = b.name;
        const tier: AugmentTier = name.startsWith('Lesser ')
          ? 'lesser'
          : name.startsWith('Greater ')
            ? 'greater'
            : name.startsWith('Perfect ')
              ? 'perfect'
              : 'regular';
        const kind: AugmentKind = /soul core/i.test(name)
          ? 'soul core'
          : /rune/i.test(name)
            ? 'rune'
            : 'other';
        return { name, tier, kind };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return augmentsCache;
}

/**
 * Подбор аугментов: подстрока имени (EN) + фильтры тира/вида.
 * Пустая строка = все, подходящие под фильтры (до limit).
 */
export function searchAugments(
  query: string,
  opts: { tier?: AugmentTier | 'all'; kind?: AugmentKind | 'all'; limit?: number } = {},
): AugmentEntry[] {
  const q = query.trim().toLowerCase();
  const tier = opts.tier ?? 'all';
  const kind = opts.kind ?? 'rune';
  const limit = opts.limit ?? 10;
  const all = getAugments();
  let list = all;
  if (tier !== 'all') list = list.filter((a) => a.tier === tier);
  if (kind !== 'all') list = list.filter((a) => a.kind === kind);
  if (q) {
    // Точное включение имени; «desert» найдёт и Lesser/Greater Desert Rune.
    const hit = list.filter((a) => a.name.toLowerCase().includes(q));
    return hit.slice(0, limit);
  }
  return list.slice(0, limit);
}
