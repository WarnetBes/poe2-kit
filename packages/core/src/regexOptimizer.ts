/**
 * Regex-оптимизатор под 45-символьный лимит поиска PoE2 (P9, №281-W2).
 *
 * Порт: poe2-quest-tracker (MIT, Copyright (c) 2025 Judd) —
 * `_research/poe2-quest-tracker/src/utils/regexOptimizer.ts`,
 * перенос близко к 1:1 (optimizePattern/splitPatternForAND/
 * suggestShorterAlternatives), плюс наш довесок по мастеру-плану L6 §3.2:
 * константа POE2_SEARCH_LIMIT и fit-or-explain контракт — если паттерн не
 * влезает даже после всех стадий, НЕ режем молча (принцип «не silent-null
 * UX» №184), а честно отдаём warning + splitPatternForAND-результат.
 * Комментарии переведены в IR; имена API сохранены для src parity.
 */

/** Лимит строки поиска в стэше/на земле PoE2 (game fact). */
export const POE2_SEARCH_LIMIT = 45;

export interface OptimizationResult {
  /** Оптимизированный паттерн (кавычки, если были, сохранены). */
  pattern: string;
  /** Длина результата. */
  length: number;
  /** Сколько символов сэкономлено относительно исходного. */
  savedChars: number;
  /** Список применённых оптимизаций (человекочитаемые, для UI). */
  optimizations: string[];
  /** Влезает ли результат в лимит (P9: fit-or-explain). */
  fits: boolean;
  /** fit-or-explain (P9): паттерн не влез даже после всех стадий —
   *  здесь AND-разбиение (splitPatternForAND) как рабочий обход. */
  tooLong?: {
    limit: number;
    andSplit: string[];
    warning: string;
  };
}

/**
 * Оптимизировать regex-паттерн под лимит символов поиска PoE2.
 * Стадии (по донору): снятие внешних кавычек/скобок, свёртка
 * character-классов, комбинирование альтернатив с общим суффиксом,
 * обрезка лидирующих/хвостовых `.*` при переполнении.
 */
export function optimizePattern(pattern: string, maxLength: number = POE2_SEARCH_LIMIT): OptimizationResult {
  let optimized = pattern;
  const originalLength = pattern.length;
  const appliedOptimizations: string[] = [];

  // Внешние кавычки снимаем, вернём в конце (порт :24-28).
  const hasQuotes = optimized.startsWith('"') && optimized.endsWith('"');
  if (hasQuotes) {
    optimized = optimized.slice(1, -1);
  }

  // 1. Убираем избыточные внешние скобки в OR-паттернах (порт :30-37).
  if (optimized.includes('|')) {
    const withoutParens = optimized.replace(/^\((.+)\)$/, '$1');
    if (withoutParens !== optimized) {
      optimized = withoutParens;
      appliedOptimizations.push('Removed outer parentheses');
    }
  }

  // 2. Свёртка character-классов (порт :39-51).
  const charClassSimplifications: [RegExp, string, string][] = [
    [/\[0-9\]/g, '\\d', 'Replaced [0-9] with \\d'],
    [/\[a-zA-Z\]/g, '\\w', 'Replaced [a-zA-Z] with \\w'],
  ];

  for (const [p, replacement, description] of charClassSimplifications) {
    const simplified = optimized.replace(p, replacement);
    if (simplified !== optimized) {
      optimized = simplified;
      appliedOptimizations.push(description);
    }
  }

  // 3. Комбинирование альтернатив с общим суффиксом (порт :53-55).
  //    Example: "fire.*res|cold.*res|lightning.*res" -> "(fire|cold|lightning).*res"
  optimized = combineAlternationsWithCommonSuffix(optimized, appliedOptimizations);

  // 4. Обрезка лидирующих/хвостовых `.*`, только если иначе не влезает (порт :57-72).
  if (optimized.length > maxLength) {
    const withoutLeadingWildcard = optimized.replace(/^\.\*/, '');
    if (withoutLeadingWildcard !== optimized && withoutLeadingWildcard.length <= maxLength) {
      optimized = withoutLeadingWildcard;
      appliedOptimizations.push('Removed leading .*');
    }
  }

  if (optimized.length > maxLength) {
    const withoutTrailingWildcard = optimized.replace(/\.\*$/, '');
    if (withoutTrailingWildcard !== optimized && withoutTrailingWildcard.length <= maxLength) {
      optimized = withoutTrailingWildcard;
      appliedOptimizations.push('Removed trailing .*');
    }
  }

  if (hasQuotes) {
    optimized = `"${optimized}"`;
  }

  // P9 (наше): fit-or-explain — не молча выдаём слишком длинный паттерн.
  if (optimized.length > maxLength) {
    const andSplit = splitPatternForAND(pattern, maxLength);
    return {
      pattern: optimized,
      length: optimized.length,
      savedChars: originalLength - optimized.length,
      optimizations: appliedOptimizations,
      fits: false,
      tooLong: {
        limit: maxLength,
        andSplit,
        warning: `Паттерн (${optimized.length} симв.) не влез в лимит ${maxLength} даже после оптимизаций (${appliedOptimizations.join('; ') || 'нет'}). Игра НЕ означает молчаливое усечение — используйте AND-разбиение: ищите по частям (${andSplit.length} паттерн(ов)).`,
      },
    };
  }

  return {
    pattern: optimized,
    length: optimized.length,
    savedChars: originalLength - optimized.length,
    optimizations: appliedOptimizations,
    fits: true,
  };
}

/**
 * Комбинирование альтернатив с общим суффиксом (порт :91-109).
 * Покрывает частый PoE2-кейс «(fire|cold|lightning).*res».
 */
function combineAlternationsWithCommonSuffix(pattern: string, appliedOptimizations: string[]): string {
  // Упрощённая версия донора: полный разбор общих суффиксов — отдельная задача.
  // Match patterns like: "fire.*res|cold.*res|lightning.*res" (порт :96).
  const resPattern = /(\w+)\.\*res\|(\w+)\.\*res(?:\|(\w+)\.\*res)?/g;

  return pattern.replace(resPattern, (_match, g1, g2, g3) => {
    appliedOptimizations.push('Combined resistance patterns');
    if (g3) {
      return `(${g1}|${g2}|${g3}).*res`;
    } else {
      return `(${g1}|${g2}).*res`;
    }
  });
}

/**
 * Разбить паттерн на несколько AND-паттернов, если он длиннее лимита
 * (порт :115-153): длинный OR → несколько коротких «(...)»-паттернов;
 * уже AND (пробелы) → части; единственный — как есть.
 */
export function splitPatternForAND(pattern: string, maxLength: number = POE2_SEARCH_LIMIT): string[] {
  const cleaned = pattern.replace(/^"|"$/g, '');

  if (!cleaned.includes('|')) {
    // AND (пробелы) или одиночный — порт :146-152.
    if (cleaned.includes(' ')) {
      return cleaned.split(' ').map((p) => p.trim()).filter((p) => p.length > 0);
    }
    return [pattern];
  }

  // OR → чанки по лимиту (порт :121-143).
  const parts = cleaned.replace(/^\(|\)$/g, '').split('|');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const part of parts) {
    const partLength = part.length + 3; // +3 за кавычки и разделитель
    if (currentLength + partLength > maxLength && currentChunk.length > 0) {
      chunks.push(`"(${currentChunk.join('|')})"`);
      currentChunk = [part];
      currentLength = partLength;
    } else {
      currentChunk.push(part);
      currentLength += partLength;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(`"(${currentChunk.join('|')})"`);
  }
  return chunks;
}

/**
 * Подсказки более коротких паттернов для частых модов (порт :158-179).
 * Возвращает Map «имя мода → подсказка».
 */
export function suggestShorterAlternatives(modNames: string[]): Map<string, string> {
  const suggestions = new Map<string, string>();
  const shortcuts: [string, string][] = [
    ['Maximum Life', 'Use "maximum l" instead of full pattern'],
    ['Fire Resistance', 'Use "fire.*res" -> "fi.*r"'],
    ['Cold Resistance', 'Use "cold.*res" -> "co.*r"'],
    ['Lightning Resistance', 'Use "lightning.*res" -> "li.*r"'],
    ['Movement Speed', 'Use specific % tier (30, 25, 20, etc.)'],
  ];

  for (const modName of modNames) {
    for (const [pattern, suggestion] of shortcuts) {
      if (modName.includes(pattern)) {
        suggestions.set(modName, suggestion);
      }
    }
  }
  return suggestions;
}
