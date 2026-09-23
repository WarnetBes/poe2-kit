/**
 * Общая логика выбора актуальной лиги для MCP-инструментов.
 *
 * Актуальная лига НЕ хранится в статичном KNOWN_LEAGUES (там устаревший маркер
 * isCurrent). Её надо брать из живого poe2scout. Реализация живёт в ядре
 * (@poe2-kit/core -> core.trade.currentDefaultLeague): лиги с isCurrent=true
 * помечены ✦ и идут первыми; берём первую обычную.
 */

import { core } from '@poe2-kit/core';

/** Название актуальной лиги по умолчанию (из ядра, с fallback). */
export async function currentDefaultLeague(): Promise<string> {
  return core.trade.currentDefaultLeague();
}