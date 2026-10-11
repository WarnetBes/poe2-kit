/**
 * Mod-tier enrichment — досье тиров модов предмета по клир-тексту (P2, W1).
 *
 * Связка двух СУЩЕСТВУЮЩИХ слоёв ядра, между которыми раньше был разрыв
 * (мастер-план §2а: «данные есть → тул не обогащён»):
 *   parse.ts (синхронный разбор Ctrl+C-текста) + repoe.ts (индексы тиров
 *   RePoE: matchAllModTiers/lookupBaseItem). Донор-паттерн — poe2-mcp-server
 * (MIT, src/tools/item.ts: maxModSlots/enrichItem/formatEnrichmentSection):
 * слоты Rare 3P/3S, Magic 1P/1S; обогащение никогда не бросает исключений —
 * при недоступности RePoE досье просто пустое, parse_item работает офлайн.
 */

import { parseItemText, parseMod, type ParsedItem } from './parse.js';
import {
  lookupBaseItem,
  matchAllModTiers,
  type BaseItemStats,
  type ModTierResult,
} from './repoe.js';
import type { Rarity } from './parse.js';

/** Максимум слотов префиксов/суффиксов по редкости (по poe2-mcp-server item.ts:341-346). */
export function maxModSlots(rarity: Rarity): { prefixes: number; suffixes: number } {
  if (rarity === 'Rare') return { prefixes: 3, suffixes: 3 };
  if (rarity === 'Magic') return { prefixes: 1, suffixes: 1 };
  return { prefixes: 0, suffixes: 0 };
}

/** Тир одного мода + «est» — совершенство ролла внутри диапазона тира, % (0..100). */
export interface ModTierInfo extends ModTierResult {
  /** Позиция value внутри [min,max] тира: 0 = флот-мин, 100 = идеал.
   *  null, если диапазон вырожден (max === min) — ролл без вариации. */
  rollPct: number | null;
}

export interface ModTierDossier {
  /** База из RePoE (если найдена): теги — ключ матчинга тиров. */
  base: BaseItemStats | null;
  /** Тиры explicit-модов (только найденные в индексе RePoE). */
  modTiers: ModTierInfo[];
  /** Найденные префиксы/суффиксы (по rarity-слотам). */
  prefixCount: number;
  suffixCount: number;
  /** Предел слотов по редкости (Rare 3/3, Magic 1/1, прочее 0/0). */
  maxPrefixes: number;
  maxSuffixes: number;
  /** Свободные слоты (может быть отрицательным, если счёт по донор-эвристике
   *  насчитал больше matching-аффиксов, чем лимит — сигнализирует о гибридах). */
  openPrefix: number;
  openSuffix: number;
  /** Невшитые explicit-моды, не найденные в индексе (уникальные/гибридные). */
  unmatchedExplicits: string[];
}

/** «est»: позиция ролла в диапазоне тира, %. */
function rollPct(value: number, range: [number, number]): number | null {
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return Math.round(((value - min) / (max - min)) * 100);
}

// Секции-заголовки статов (не модов): "Armour: 42", "Quality: +20%".
const HEADER_STAT_LINE = /^[A-Za-z][\w '()]{0,40}[:：]\s*[+-]?\d/;
// Строки-лейблы предмета, не дающие тиров.
const NON_MOD_LINE = /^(?:Item Level|Requires?\b|corrupted|mirrored|unidentified)/i;

/**
 * Explicit-моды из КЛИР-ТЕКСТА: секции ПОСЛЕ шапки (шапка = имя/база/редкость —
 * sections[0]; parseItemText исторически считает их «модами», для тиров это
 * мусор). Заголовки статов и requirements отфильтрованы. Возвращает тексты БЕЗ
 * маркеров типа — implicit/rune/enchant заведомо не тирят.
 */
function extractExplicitModTexts(item: ParsedItem): string[] {
  const texts: string[] = [];
  for (const section of item.sections.slice(1)) {
    for (const raw of section) {
      const line = raw.trim();
      if (!line) continue;
      if (HEADER_STAT_LINE.test(line) || NON_MOD_LINE.test(line)) continue;
      const mod = parseMod(line);
      if (mod.type !== 'explicit') continue;
      texts.push(mod.text);
    }
  }
  return texts;
}

/**
 * Досье тиров модов предмета по клир-тексту. Никогда не бросает — все
 * сетевые/индексные сбои дают частичное досье (сеть — только первый вызов,
 * далее кэш RePoE в памяти/на диске).
 */
export async function resolveModTiers(itemText: string): Promise<ModTierDossier> {
  let item: ParsedItem;
  try {
    item = parseItemText(itemText);
  } catch {
    return emptyDossier();
  }
  const slots = maxModSlots(item.rarity);

  const dossier: ModTierDossier = {
    base: null,
    modTiers: [],
    prefixCount: 0,
    suffixCount: 0,
    maxPrefixes: slots.prefixes,
    maxSuffixes: slots.suffixes,
    openPrefix: slots.prefixes,
    openSuffix: slots.suffixes,
    unmatchedExplicits: [],
  };

  if (item.rarity !== 'Rare' && item.rarity !== 'Magic') return dossier;

  const explicitTexts = extractExplicitModTexts(item);
  if (!explicitTexts.length) return dossier;

  try {
    const base = await lookupBaseItem(item.baseType);
    if (!base) {
      dossier.unmatchedExplicits = explicitTexts;
      return dossier; // база не найдена (не-EN клир-текст/событийная база) — тиры не матчатся без тегов
    }
    dossier.base = base;

    const matched = await matchAllModTiers(explicitTexts, base.tags, item.itemLevel);
    const matchedTexts = new Set(matched.map((m) => m.modText));
    dossier.unmatchedExplicits = explicitTexts.filter((t) => !matchedTexts.has(t));

    dossier.modTiers = matched.map((t) => ({
      ...t,
      rollPct: rollPct(t.value, t.range),
    }));
    dossier.prefixCount = dossier.modTiers.filter((t) => t.prefixSuffix === 'prefix').length;
    dossier.suffixCount = dossier.modTiers.filter((t) => t.prefixSuffix === 'suffix').length;
    dossier.openPrefix = slots.prefixes - dossier.prefixCount;
    dossier.openSuffix = slots.suffixes - dossier.suffixCount;
  } catch {
    /* частичное досье — уже собранные поля остаются */
  }
  return dossier;
}

function emptyDossier(): ModTierDossier {
  return {
    base: null,
    modTiers: [],
    prefixCount: 0,
    suffixCount: 0,
    maxPrefixes: 0,
    maxSuffixes: 0,
    openPrefix: 0,
    openSuffix: 0,
    unmatchedExplicits: [],
  };
}
