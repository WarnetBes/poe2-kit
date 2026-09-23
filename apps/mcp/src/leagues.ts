/**
 * Общая логика выбора актуальной лиги для MCP-инструментов.
 *
 * Актуальная лига НЕ хранится в статичном KNOWN_LEAGUES (там устаревший маркер
 * isCurrent). Её надо брать из живого poe2scout через fetchLeagues(): лиги с
 * isCurrent=true помечены ✦ и идут первыми; берём первую (обычный, не HC).
 */

import { core } from '@poe2-kit/core';

/** Название лиги по умолчанию. Попытка: живой список → первый isCurrent → fallback. */
export async function currentDefaultLeague(): Promise<string> {
  try {
    const leagues = await core.trade.fetchLeagues();
    const current = leagues.find((l) => l.isCurrent);
    if (current?.name) return current.name;
    if (leagues[0]?.name) return leagues[0].name;
  } catch {
    /* fallback ниже */
  }
  return 'Forbidden Rites';
}