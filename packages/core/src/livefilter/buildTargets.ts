/**
 * Live-price loot filter: build-aware targets (P3, этап F — §3.5 плана).
 *
 * Adapter PoB → LiveFilterBuildTargets: READ-ONLY чтение данных билда через
 * существующие экспорты core (build.ts / parse.ts — зоны других агентов,
 * здесь только потребление). Минимальный жизнеспособный набор: baseTypes из
 * носимого гира — базы, которые билд уже носит, ищутся апгрейдом и не должны
 * прятаться фильтром.
 *
 * НЕ реализовано (данных декодера недостаточно / ненадёжно — без выдумок,
 * честные unverified-хвосты в отчёте):
 *  - resistances: PoB-XML не отдаёт капы/ресайз-цели напрямую, а фильтр
 *    не умеет «resist >= X» (условия только из каталога conditions.json);
 *  - hasExplicitMods: надёжного мод→фильтр-текст маппинга нет (ModLine
 *    клир-текста ≠ точный текст, который игра ждёт в HasExplicitMod);
 *  - minIlvl: выводить пол из gear itemLevel — эвристика, не цель билда.
 */

import { buildCodeToGear } from '../build.js';
import { parseItemText } from '../parse.js';
import type { LiveFilterBuildTargets } from './rules.js';

export interface BuildTargetsFromPobResult {
  targets: LiveFilterBuildTargets;
  /** Что НЕ выведено из данных и почему (unverified-хвосты для отчёта). */
  unverified: string[];
}

/** Лишние для loot-filter категории носимого: камни и самоцветы. */
function isFilterIrrelevant(itemClass: string, rarity: string): boolean {
  if (/gems?/i.test(itemClass)) return true;
  if (rarity === 'Gem') return true;
  return false;
}

/**
 * Собрать build-targets из кода/ссылки/XML PoB (READ-ONLY через
 * buildCodeToGear): базы носимого гира активного ItemSet.
 */
export async function buildTargetsFromPob(input: string): Promise<BuildTargetsFromPobResult> {
  const items = await buildCodeToGear(input);
  const baseTypes = new Set<string>();
  for (const it of items) {
    const parsed = parseItemText(it.itemText);
    const bt = parsed.baseType.trim();
    if (!bt) continue;
    if (isFilterIrrelevant(parsed.itemClass, parsed.rarity)) continue;
    baseTypes.add(bt);
  }
  const targets: LiveFilterBuildTargets = {
    baseTypes: [...baseTypes].sort(),
    source: 'pob',
  };
  const unverified = [
    'hasExplicitMods: нет надёжного мод→HasExplicitMod маппинга — заполнить вручную после проверки в игре',
    'resistances: капы/resist-цели PoB-XML не отдаёт; фильтр «resist >= X» не выражает',
    'minIlvl: не выводится из gear itemLevel (эвристика, не цель билда)',
  ];
  return { targets, unverified };
}
