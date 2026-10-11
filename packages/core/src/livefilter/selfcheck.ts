/**
 * Live-price loot filter: SelfCheck + NS-known-sets (P3, этап C — №445).
 *
 * Перенос идей и логики из mrw-overlay-poe2 (MIT):
 * Copyright (c) kadircelebi / mrw-overlay-poe2, MIT — selfcheck.go:9-147
 * (механика и пороги), injector.go:60-66 (структура секций NS).
 * Go→TS — переписывание, атрибуция этой строкой.
 *
 * ЗАЧЕМ: игра молча отвергает ВЕСЬ фильтр, если одно значение Class/BaseType
 * не соответствует ни одному известному игре (v2.8.1: `BaseType == "Catalyst"`
 * — selfcheck.go:9-15). SelfCheck вырезает неизвестные значения ИЗ сгенери-
 * рованного блока до записи: правило (Show/Hide) теряется целиком, а не
 * условие — иначе Hide без фильтра сожрёт всё (selfcheck.go:44-46).
 *
 * Известные множества добываются из САМОГО базового NS-фильтра — он и есть
 * монитор имён, которые знает игра. Обязательно парсить и ЗАКОММЕНТИРОВАННЫЕ
 * правила (uncomment — neversink.go:87-104): строгий фильтр иначе теряет
 * 128 баз (Uber Plus Strict).
 */

// ─── Порог качества (selfcheck.go:20-23): ниже — знания выглядят сломанными ──

export const SELFCHECK_MIN_CLASSES = 10;
export const SELFCHECK_MIN_BASES = 500;

export interface SelfCheckOptions {
  /** lowercase класс → true. */
  classes: ReadonlySet<string>;
  /** lowercase база → каноническое имя. */
  bases: ReadonlyMap<string, string>;
  /** Loose (substring) BaseType-значения базового фильтра, lowercase. */
  loose: readonly string[];
}

export interface SelfCheckResult {
  /** Блок без неизвестных значений (null = не проверялся, вернулся вход). */
  block: string | null;
  /** Unknown-значения вида «Class Foo»/«BaseType Foo», отсортированы. */
  unknown: string[];
  /** Сколько правил выброшено целиком. */
  dropped: number;
}

const RULE_START_RE = /^(Show|Hide|Minimal)\b/;
const NAME_COND_RE = /^(\s+)(Class|BaseType)\b\s*(==|!=|!|=)?\s*(.*)$/;
const QUOTED_RE = /"([^"]*)"/g;

function knownValue(
  opts: SelfCheckOptions,
  checkClasses: boolean,
  checkBases: boolean,
  kind: string,
  op: string,
  value: string,
): boolean {
  const v = value.toLowerCase();
  if (kind === 'Class' && !checkClasses) return true;
  if (kind === 'BaseType' && !checkBases) return true;
  if (kind === 'Class' && op === '==') return opts.classes.has(v);
  if (kind === 'BaseType' && op === '==') return opts.bases.has(v);
  // loose: значение — подстрока известного имени (selfcheck.go:72-81)
  if (kind === 'Class') {
    for (const name of opts.classes) if (name.includes(v)) return true;
    return false;
  }
  for (const name of opts.bases.keys()) if (name.includes(v)) return true;
  for (const name of opts.loose) if (name.includes(v)) return true;
  return false;
}

/**
 * Самопроверка сгенерированного блока: убрать Class/BaseType-значения, которых
 * нет в known-множествах. Правило с опустевшим положительным списком
 * выбрасывается целиком; опустевший отрицательный (!=) — выбрасывается как
 * условие («not any of nothing» верно для всех — selfcheck.go:127-128).
 *
 * Возвращает null вместо блока, если порог качества не достигнут
 * (знания сами выглядят сломанными — проверка отключена, selfcheck.go:20-23).
 */
export function selfCheckBlock(block: string, opts: SelfCheckOptions): SelfCheckResult {
  const checkClasses = opts.classes.size >= SELFCHECK_MIN_CLASSES;
  const checkBases = opts.bases.size >= SELFCHECK_MIN_BASES;
  if (!checkClasses && !checkBases) {
    return { block: null, unknown: [], dropped: 0 };
  }
  const unknown = new Set<string>();
  let dropped = 0;
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!RULE_START_RE.test(lines[i]!)) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    // Право: заголовок + индентированные строки до пустой
    let end = i + 1;
    while (end < lines.length && lines[end]!.trim() !== '' && (lines[end]![0] === ' ' || lines[end]![0] === '\t')) {
      end++;
    }
    const rule: string[] = [lines[i]!];
    let keep = true;
    for (const line of lines.slice(i + 1, end)) {
      const m = NAME_COND_RE.exec(line);
      QUOTED_RE.lastIndex = 0;
      const values = [...line.matchAll(QUOTED_RE)];
      if (!m || values.length === 0) {
        rule.push(line);
        continue;
      }
      const [, indent, kind, op] = m;
      const kept: string[] = [];
      for (const v of values) {
        if (knownValue(opts, checkClasses, checkBases, kind!, op ?? '', v[1]!)) {
          kept.push(`"${v[1]}"`);
        } else {
          unknown.add(`${kind} ${v[1]}`);
        }
      }
      if (kept.length === values.length) {
        rule.push(line);
      } else if (kept.length > 0) {
        let cond = `${indent}${kind} `;
        if (op) cond += `${op} `;
        rule.push(cond + kept.join(' '));
      } else if (op === '!' || op === '!=') {
        // «not any of nothing» верно для каждого предмета — условие вон
      } else {
        keep = false; // положительный список пуст: правило выбрасывается ЦЕЛИКОМ
      }
    }
    if (keep) out.push(...rule);
    else dropped++;
    i = end;
  }
  const sortedUnknown = [...unknown].sort();
  if (sortedUnknown.length === 0) {
    return { block, unknown: [], dropped: 0 };
  }
  return { block: out.join('\n'), unknown: sortedUnknown, dropped };
}

// ─── Known-sets из базового NS-фильтра (uncomment — §4.3) ──────────────────

export interface NsKnownSets extends SelfCheckOptions {
  classCount: number;
  baseCount: number;
  /** Канонический регистр имён классов (для генератора, KnownFilterSets — canonical-case). */
  classesCanonical: ReadonlySet<string>;
}

const COND_LINE_RE = /^\s*(Class|BaseType)\b\s*(==|!=|!|=)?\s*(.*)$/;

/**
 * Добыть известные классы/базы из базового NeverSink-фильтра.
 * Парсит ВСЁ, включая закомментированные правила (строка с ведущим «#»
 * срезается до содержимого — strict-фильтры держат базы в комментариях,
 * neversink.go:87-104: без uncomment теряются 128 баз Uber Plus Strict).
 * Loose-значения = BaseType без оператора (substring-семантика игры).
 */
export function knownSetsFromBaseFilter(content: string): NsKnownSets {
  const classes = new Set<string>();
  const classesCanonical = new Set<string>();
  const bases = new Map<string, string>();
  const loose = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    // вырезаем ведущие # (uncomment); НЕ вырезаем # внутри кавычек значений
    const t = raw.trim();
    if (!t) continue;
    const uncommented = t.startsWith('#') ? t.replace(/^#+\s*/, '') : t;
    const m = COND_LINE_RE.exec(uncommented);
    if (!m) continue;
    const [, kind, op, rest] = m;
    const values = [...rest.matchAll(QUOTED_RE)];
    if (values.length === 0) continue;
    for (const v of values) {
      const name = v[1]!.trim();
      const lower = name.toLowerCase();
      if (!lower) continue;
      if (kind === 'Class') {
        if (!classes.has(lower)) classesCanonical.add(name);
        classes.add(lower);
      } else if (op) {
        if (!bases.has(lower)) bases.set(lower, name);
      } else {
        loose.add(lower); // loose substring из базового фильтра
      }
    }
  }
  return { classes, classesCanonical, bases, loose: [...loose], classCount: classes.size, baseCount: bases.size };
}
