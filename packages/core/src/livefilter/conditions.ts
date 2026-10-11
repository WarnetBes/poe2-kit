/**
 * Каталог условий лут-фильтра PoE2: модель, сериализация, парсинг, ordering
 * (live-price filter, этап A — P3, №281-W2).
 *
 * Данные каталога живут в JSON (паттерн «Data lives in JSON, never in source»):
 * `data/game/livefilter/conditions.json` — там же происхождение источников
 * (Filtration-Fork GPL-2.0 — только факты; divine-view — LICENSE-файла нет,
 * только факты; канон — GGG docs). Здесь — только код поверх данных;
 * реализация своя, портов чужого кода нет.
 *
 * Ключевые семантики (иначе игра молча отвергает ВЕСЬ фильтр):
 *  - loose-список (`BaseType "Catalyst"` без `==`) — substring-семантика;
 *    НЕ сериализовать обратно как exact (найдено у Donald's neversink tools:
 *    neversink.go:106-108);
 *  - «GemLevel 19» — валидный shorthand для «>= 19» (факт divine-view
 *    filterValidator.ts:109-111); парсер понимает оба, сериализатор пишет
 *    канонический явный оператор;
 *  - порядок условий внутри Show/Hide-блока нормализован (паттерн
 *    Filtration BlockItemOrdering.cs:9-76), действия — строго после условий.
 */

import { getFilterConditionCatalog } from '../dataset.js';

// ─── Типы модели ──────────────────────────────────────────────────────────

/** Операторы фильтра (объединение PoE1/PoE2-клона; canonical: = == > < >= <=, negation != !). */
export type FilterOperator = '=' | '==' | '>' | '<' | '>=' | '<=' | '!=' | '!';

/** Числовое условие: `ItemLevel >= 75` (или shorthand-парс «GemLevel 19»). */
export interface NumericCondition {
  kind: 'numeric';
  name: string;
  op?: FilterOperator;
  value: number;
}

/** Парное условие: `Identified True` (value=false — редкая, но валидная форма). */
export interface BooleanCondition {
  kind: 'boolean';
  name: string;
  value: boolean;
}

/**
 * Списочное условие: Class/BaseType/HasExplicitMod/…
 * exact: оператор записан (`==`/`!=`/`!`) — точные имена.
 * НЕ exact (loose): оператора нет — substring-семантика, обратная запись
 * как exact запрещена (грабля neversink.go:106-108).
 */
export interface ListCondition {
  kind: 'list';
  name: string;
  /** '=|==' (positive exact) | '!='|'!' (negated exact) | '' (loose). */
  op: '' | '=' | '==' | '!=' | '!';
  exact: boolean;
  values: string[];
}

export type FilterCondition = NumericCondition | BooleanCondition | ListCondition;

/** Тип блока правила. Minimal — PoE2-специфичный «тихий показ». */
export type FilterBlockType = 'Show' | 'Hide' | 'Minimal';

/** Строка действия блока (проверяется по каталогу actions). */
export interface FilterAction {
  command: string;
  /** Аргументы как есть, но без самого ключевого слова (не валидируются на этапе A). */
  args: string;
}

/** Show/Hide-блок: условия + действия; условия сериализуются в ordering. */
export interface FilterBlock {
  type: FilterBlockType;
  /** Заголовок-комментарий над блоком (одна #строка), опц. */
  comment?: string;
  conditions: FilterCondition[];
  actions: FilterAction[];
  /** Если true — блок выключен (ShowDisabled-семантика в PoE1; PoE2 — флаг комментария). */
  enabled?: boolean;
}

export interface ConditionValidationIssue {
  condition: string;
  error: string;
}

// ─── Каталог ──────────────────────────────────────────────────────────────

const ORDER_FALLBACK = 10_000;

function orderingIndexMap(): Map<string, number> {
  const m = new Map<string, number>();
  const ord = getFilterConditionCatalog().ordering;
  ord.forEach((name: string, i: number) => m.set(name, i));
  return m;
}

let orderCache: Map<string, number> | null = null;

/** Индекс порядка условия (pattnern Filtration SortOrder); неизвестные — в конец, стабильным порядком. */
function orderOf(name: string): number {
  if (!orderCache) orderCache = orderingIndexMap();
  return orderCache.get(name) ?? ORDER_FALLBACK;
}

/**
 * Отсортировать условия блока в канонический порядок (детерминированный,
 * стабильный: одинаковый набор и порядок входа → одинаковый выход).
 */
export function sortConditions(conditions: FilterCondition[]): FilterCondition[] {
  return conditions
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const oa = orderOf(a.c.name);
      const ob = orderOf(b.c.name);
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

// ─── Сериализация ─────────────────────────────────────────────────────────

const NUM_OP: Record<string, string> = { '=': '=', '==': '==', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };

/** Сериализовать одно условие в строку фильтра (без отступа). */
export function serializeCondition(c: FilterCondition): string {
  if (c.kind === 'numeric') {
    const op = c.op && NUM_OP[c.op] ? NUM_OP[c.op]! : '>=';
    return `${c.name} ${op} ${c.value}`;
  }
  if (c.kind === 'boolean') {
    return `${c.name} ${c.value ? 'True' : 'False'}`;
  }
  // list
  const quoted = c.values.map((v) => `"${v}"`).join(' ');
  if (!c.exact) return `${c.name} ${quoted}`; // loose — БЕЗ оператора (substring)
  const op = c.op === '!' || c.op === '!=' ? c.op : c.op === '=' ? '=' : '==';
  return `${c.name} ${op} ${quoted}`;
}

/** Сериализовать блок: [комментарий] заголовок, условия (ordering), действия. */
export function serializeBlock(b: FilterBlock): string[] {
  const lines: string[] = [];
  if (b.comment) lines.push(`# ${b.comment}`);
  lines.push(b.type);
  for (const c of sortConditions(b.conditions)) lines.push(`    ${serializeCondition(c)}`);
  for (const a of b.actions) lines.push(`    ${a.command}${a.args ? ' ' + a.args : ''}`);
  if (b.enabled === false) lines.push('    # disabled');
  return lines;
}

// ─── Парсинг (обратный, паттерн divine-view filterParser) ─────────────────

const NUMERIC_RE = /^([A-Za-z]+)\s*(==|=|>=|<=|>|<)?\s*(-?\d+(?:\.\d+)?)$/;
const LIST_RE = /^([A-Za-z]+)\s*(==|!=|=|!)?\s*(.*)$/;
const QUOTED_RE = /"([^"]*)"/g;

/**
 * Распарсить строку условия (без отступа, без ключевого слова блока).
 * Shorthand «GemLevel 19» → op '>=' (факт divine-view filterValidator.ts:109).
 * null — строка не является условием (действие/заголовок/комментарий).
 */
export function parseConditionLine(line: string): FilterCondition | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const cat = getFilterConditionCatalog();
  const numericNames: ReadonlySet<string> = cat._numericSet;
  const booleanNames: ReadonlySet<string> = cat._booleanSet;
  const listMeta: Map<string, { loose: boolean; values?: string[] }> = cat._listMeta;

  const nm = NUMERIC_RE.exec(t);
  if (nm && (numericNames.has(nm[1]!) || nm[1] === 'UnidentifiedItemTier')) {
    return { kind: 'numeric', name: nm[1]!, op: (nm[2] as FilterOperator) ?? '>=', value: Number(nm[3]) };
  }
  const bm = /^([A-Za-z]+)\s+(True|False)$/.exec(t);
  if (bm && booleanNames.has(bm[1]!)) {
    return { kind: 'boolean', name: bm[1]!, value: bm[2] === 'True' };
  }
  const lm = LIST_RE.exec(t);
  if (lm && listMeta.has(lm[1]!)) {
    const name = lm[1]!;
    const op = (lm[2] ?? '') as '' | '=' | '==' | '!=' | '!';
    const values: string[] = [];
    let m: RegExpExecArray | null;
    QUOTED_RE.lastIndex = 0;
    while ((m = QUOTED_RE.exec(lm[3] ?? '')) !== null) values.push(m[1]!);
    if (values.length === 0) return null;
    const exact = op !== '';
    const meta = listMeta.get(name)!;
    if (!exact && !meta.loose) return null; // loose разрешён не всем (Rarity — только exact)
    if (meta.values) {
      const bad = values.find((v) => !meta.values!.includes(v));
      if (bad) return null; // Rarity "Foo" — невалидное значение
    }
    return { kind: 'list', name, op, exact, values };
  }
  return null;
}

/**
 * Распарсить текст блока (заголовок Show/Hide/Minimal + индентированные строки
 * до пустой строки). null — первая строка не заголовок блока.
 */
export function parseFilterBlock(text: string): FilterBlock | null {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return null;
  const head = lines[0]!.trim();
  const typeMatch = /^(Show|Hide|Minimal)\b/.exec(head);
  if (!typeMatch) return null;
  const block: FilterBlock = { type: typeMatch[1] as FilterBlockType, conditions: [], actions: [] };
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (!t) break; // конец блока
    if (t.startsWith('#')) continue;
    const cond = parseConditionLine(t);
    if (cond) {
      block.conditions.push(cond);
      continue;
    }
    const am = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(t);
    if (am && (getFilterConditionCatalog()._actionSet as ReadonlySet<string>).has(am[1]!)) {
      block.actions.push({ command: am[1]!, args: am[2] ?? '' });
    }
    // неизвестное — молча пропускаем
  }
  return block;
}

// ─── Валидация против каталога ────────────────────────────────────────────

const NEG_OPS: ReadonlySet<string> = new Set(['!=', '!']);

/** Проверить условие против каталога. Пустой список = всё валидно. */
export function validateCondition(c: FilterCondition): ConditionValidationIssue[] {
  const cat = getFilterConditionCatalog();
  const q = serializeCondition(c);
  const out: ConditionValidationIssue[] = [];
  if (c.kind === 'numeric') {
    if (!(cat._numericSet as ReadonlySet<string>).has(c.name)) {
      out.push({ condition: q, error: `неизвестное числовое условие «${c.name}»` });
    } else if (c.op && NEG_OPS.has(c.op)) {
      out.push({ condition: q, error: `оператор «${c.op}» не поддерживается числовыми условиями` });
    } else if (!Number.isFinite(c.value)) {
      out.push({ condition: q, error: 'значение не число' });
    }
  } else if (c.kind === 'boolean') {
    if (!(cat._booleanSet as ReadonlySet<string>).has(c.name)) {
      out.push({ condition: q, error: `неизвестное парное условие «${c.name}»` });
    }
  } else {
    const meta = (cat._listMeta as Map<string, { loose: boolean; values?: string[] }>).get(c.name);
    if (!meta) {
      out.push({ condition: q, error: `неизвестное списочное условие «${c.name}»` });
    } else if (!c.exact && !meta.loose) {
      out.push({ condition: q, error: `условие «${c.name}» не поддерживает loose-форму` });
    } else if (c.values.length === 0) {
      out.push({ condition: q, error: 'пустой список значений' });
    } else if (meta.values) {
      const bad = c.values.find((v) => !meta.values!.includes(v));
      if (bad) out.push({ condition: q, error: `значение «${bad}» вне допустимых (${meta.values.join('|')})` });
    }
  }
  return out;
}

/**
 * Машиночитаемый дамп каталога (для ревью против GGG docs / регламента свежести).
 * Возвращает копию внутренностей JSON без вычисляемых множеств (_*).
 */
export function dumpConditionCatalog(): Record<string, unknown> {
  const raw = getFilterConditionCatalog() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('_') && !k.startsWith('$')) out[k] = v;
  }
  return out;
}
