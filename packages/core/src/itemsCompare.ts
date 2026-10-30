/**
 * Items Compare (head-to-head) — W5-B (№696).
 *
 * Сравнение двух предметов «лоб в лоб» для SSF-решений «что надеть/чем
 * заменить»: мод-дифф (общие / только в A / только в B) + gearscore обеих
 * сторон по одному профилю + честный вердикт.
 *
 * Идея сравнения «текущий vs кандидат» перенята у poe2-upgrade-checker
 * (GPL-3) — idea reference, код собственный (см. NOTICE.md).
 */

import { parseItemText, type ParsedItem } from './parse.js';
// W5-B: bring it in from the scoring module instead of re-implementing here.
import { gearScoreItem, type GearscoreProfileId, type GearscoreResult } from './gearscore.js';

export interface ItemsCompareInput {
  /** Текущий предмет (клир-текст RU/EN). */
  itemA: string;
  /** Кандидат на замену (клир-текст RU/EN). */
  itemB: string;
  /** Профиль оценки (default 'life-res'). */
  profile?: GearscoreProfileId;
}

export interface ModSideDiff {
  /** Текст мода. */
  text: string;
  /** 'a' | 'b' — где встречается. */
  side: 'a' | 'b';
}

export interface ItemsCompareResult {
  ok: boolean;
  error?: string;
  itemA?: ParsedItem;
  itemB?: ParsedItem;
  /** Названия (name/base) сторон для читаемого вывода. */
  nameA?: string;
  nameB?: string;
  scoreA?: GearscoreResult;
  scoreB?: GearscoreResult;
  /** Моды, совпадающие по тексту (без учёта чисел — нормализация ниже). */
  shared: string[];
  /** Моды-дифф: side 'a' = есть только в A (в B нет ИЛИ другой ролл). */
  diff: ModSideDiff[];
  /** 'upgrade' | 'downgrade' | 'sidegrade' | 'unknown'. */
  verdict: 'upgrade' | 'downgrade' | 'sidegrade' | 'unknown';
  reasons: string[];
}

/** Нормализация мода для сверки: числа → '#' (сравниваем суть, не роллы). */
function normalizeMod(text: string): string {
  return text.trim().replace(/-?\d+(?:\.\d+)?/g, '#');
}

export function compareItems(input: ItemsCompareInput): ItemsCompareResult {
  const profile: GearscoreProfileId = input.profile ?? 'life-res';
  let a: ParsedItem;
  let b: ParsedItem;
  try {
    a = parseItemText(input.itemA);
    b = parseItemText(input.itemB);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      shared: [],
      diff: [],
      verdict: 'unknown',
      reasons: [],
    };
  }

  const nameA = [a.name, a.baseType].filter(Boolean).join(', ') || 'item A';
  const nameB = [b.name, b.baseType].filter(Boolean).join(', ') || 'item B';

  // Разные слоты — сравнение бессмысленно, но не блокируем (кольца RU/EN).
  // Вердикт в этом случе 'unknown' с честной причиной.

  const modsA = a.mods.map((m) => m.text.trim());
  const modsB = b.mods.map((m) => m.text.trim());
  const normA = new Map(modsA.map((t) => [normalizeMod(t), t] as const));
  const normB = new Map(modsB.map((t) => [normalizeMod(t), t] as const));

  const shared: string[] = [];
  const diff: ModSideDiff[] = [];
  for (const [norm, text] of normA) {
    if (normB.has(norm)) shared.push(text);
    else diff.push({ text, side: 'a' });
  }
  for (const [norm, text] of normB) {
    if (!normA.has(norm)) diff.push({ text, side: 'b' });
  }

  const scoreA = gearScoreItem(input.itemA, { profile });
  const scoreB = gearScoreItem(input.itemB, { profile });

  const reasons: string[] = [];
  let verdict: ItemsCompareResult['verdict'] = 'unknown';
  if (scoreA.score != null && scoreB.score != null) {
    const delta = scoreB.score - scoreA.score;
    if (delta >= 5) {
      verdict = 'upgrade';
      reasons.push(`Gearscore: ${nameB} (${scoreB.score}) на ${delta} очков выше текущего (${scoreA.score}).`);
    } else if (delta <= -5) {
      verdict = 'downgrade';
      reasons.push(`Gearscore: ${nameB} (${scoreB.score}) на ${-delta} очков НИЖЕ текущего (${scoreA.score}).`);
    } else {
      verdict = 'sidegrade';
      reasons.push(`Gearscore почти равен: ${nameA} ${scoreA.score} vs ${nameB} ${scoreB.score} — решайте по мод-диффу ниже.`);
    }
  } else {
    reasons.push('Gearscore недоступен (уник/флак/не-предмет хотя бы у одной стороны) — смотрите мод-дифф.');
  }

  if (scoreA.slot !== scoreB.slot) {
    reasons.push(`⚠ Слоты разные: ${scoreA.slot} vs ${scoreB.slot} — сравнение условное.`);
  }

  return {
    ok: true,
    itemA: a,
    itemB: b,
    nameA,
    nameB,
    scoreA,
    scoreB,
    shared,
    diff,
    verdict,
    reasons,
  };
}
