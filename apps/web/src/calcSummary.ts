/**
 * Калькулятор модификаторов (волна №215b): агрегация статов взятых узлов.
 * Общий для вкладок «Атлас» (atlasMap.ts) и «Карты» (fullMap.ts).
 *
 * Группировка по нормализованному шаблону: ведущее число ("N%" или "(A-B)%")
 * выносится из текста; одинаковые модификаторы стакаются (сумма, счётчик ×N);
 * строки без ведущего числа — уникальные эффекты, только счётчик.
 */

export interface CalcRow {
  tmpl: string;
  sumA: number;
  sumB: number;
  numCount: number;
  rngCount: number;
  plusCount: number;
  pctCount: number;
  count: number;
}

/** "[Tag|Text]" → "Text", "[X]" → "X"; \n → пробел. */
export const cleanStat = (s: string): string =>
  s
    .replace(/\[[^\]|]*\|([^\]]+)\]/g, '$1')
    .replace(/\[([^\]|]+)\]/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

export interface ParsedStat {
  tmpl: string;
  a: number | null;
  b: number | null;
  /** Ведущее "+" (пассивки: "+5 to ...") — нужно для корректного рендера суммы. */
  plus: boolean;
  /** Число было процентом ("N%") — рендер "%" только если он у всех узлов группы. */
  pct: boolean;
}

/**
 * Разбор стата: первое число выносится в шаблон, "N%" → a=N, "(A-B)%" → a=A,b=B.
 * Стат без ведущего числа: a=null (не суммируется, только счётчик).
 */
export const parseStat = (raw: string): ParsedStat => {
  const clean = cleanStat(raw);
  const rng = clean.match(/^\(([+-]?\d+(?:\.\d+)?)-([+-]?\d+(?:\.\d+)?)\)(%?)\s*/);
  if (rng)
    return {
      tmpl: clean.slice(rng[0].length),
      a: parseFloat(rng[1]!),
      b: parseFloat(rng[2]!),
      plus: false,
      pct: rng[3] === '%',
    };
  const one = clean.match(/^([+-]?)(\d+(?:\.\d+)?)(%?)\s*/);
  if (one)
    return {
      tmpl: clean.slice(one[0].length),
      a: parseFloat(one[2]!),
      b: null,
      plus: one[1] === '+',
      pct: one[3] === '%',
    };
  return { tmpl: clean, a: null, b: null, plus: false, pct: false };
};

/** Агрегация: stats-списки узлов → отсортированные строки сводки. */
export const aggregateStats = (nodesStats: (string[] | undefined)[]): CalcRow[] => {
  const rows = new Map<
    string,
    { sumA: number; sumB: number; numCount: number; rngCount: number; plusCount: number; pctCount: number; count: number }
  >();
  for (const stats of nodesStats) {
    for (const raw of stats ?? []) {
      const { tmpl, a, b, plus, pct } = parseStat(raw);
      const r = rows.get(tmpl) ?? { sumA: 0, sumB: 0, numCount: 0, rngCount: 0, plusCount: 0, pctCount: 0, count: 0 };
      if (a !== null) {
        r.numCount++;
        r.sumA += a;
        if (plus) r.plusCount++;
        if (pct) r.pctCount++;
        if (b !== null) {
          r.rngCount++;
          r.sumB += b;
        }
      }
      r.count++;
      rows.set(tmpl, r);
    }
  }
  // суммируемые выше, сильнее — выше, остальное по алфавиту
  return [...rows.entries()]
    .sort((x, y) => {
      const xs = x[1].numCount === x[1].count && x[1].numCount > 0 ? 0 : 1;
      const ys = y[1].numCount === y[1].count && y[1].numCount > 0 ? 0 : 1;
      return xs - ys || y[1].sumA - x[1].sumA || x[0].localeCompare(y[0]);
    })
    .map(([tmpl, r]) => ({ tmpl, ...r }));
};

/** Одна строка сводки (номинал + текст + ×N); esc — локальный escapist. */
export const calcRowToHtml = (r: CalcRow, esc: (s: string) => string): string => {
  const summable = r.numCount === r.count && r.numCount > 0;
  const range = summable && r.rngCount === r.numCount && r.sumB !== r.sumA;
  const plus = summable && r.plusCount === r.numCount ? '+' : '';
  const pct = summable && r.pctCount === r.numCount ? '%' : '';
  const num = summable ? `${plus}${range ? `(${r.sumA}–${r.sumB})${pct}` : `${r.sumA}${pct}`} ` : '';
  const times = r.count > 1 ? ` <span class="dim">×${r.count}</span>` : '';
  return `<li>${num}${esc(r.tmpl)}${times}</li>`;
};

/** Слияние рядов разных источников (атлас + дерево): одинаковые шаблоны стакаются. */
export const mergeRows = (groups: CalcRow[][]): CalcRow[] => {
  const merged = new Map<string, CalcRow>();
  for (const rows of groups) {
    for (const r of rows) {
      const m = merged.get(r.tmpl);
      if (!m) {
        merged.set(r.tmpl, { ...r });
        continue;
      }
      m.sumA += r.sumA;
      m.sumB += r.sumB;
      m.numCount += r.numCount;
      m.rngCount += r.rngCount;
      m.plusCount += r.plusCount;
      m.pctCount += r.pctCount;
      m.count += r.count;
    }
  }
  return [...merged.values()].sort(
    (x, y) =>
      // суммируемые выше, сильнее — выше, остальное по алфавиту
      (Number(y.numCount === y.count && y.numCount > 0) - Number(x.numCount === x.count && x.numCount > 0)) ||
      y.sumA - x.sumA ||
      x.tmpl.localeCompare(y.tmpl),
  );
};

// ── кросс-вкладочный стор: суммарная сводка атлас + дерево пассивок ─────────
export type CalcSource = 'atlas' | 'passives';
const CALCS: Partial<Record<CalcSource, { rows: CalcRow[]; label: string }>> = {};
const CALC_EVENT = 'poe2k-calc-changed';

/** Опубликовать агрегированные ряды источника; событие дергает чужие панели. */
export const publishCalc = (src: CalcSource, rows: CalcRow[], label: string): void => {
  CALCS[src] = { rows, label };
  window.dispatchEvent(new CustomEvent(CALC_EVENT, { detail: { src } }));
};

/** Подписка на изменения любого источника (cb получает источник-инициатор). */
export const subscribeCalc = (cb: (src: CalcSource) => void): void => {
  window.addEventListener(CALC_EVENT, (e) => {
    const d = (e as CustomEvent<{ src: CalcSource }>).detail;
    cb(d.src);
  });
};

/** Все активные источники, кроме указанного (свой передаётся отдельно). */
export const foreignCalcs = (own: CalcSource): { src: CalcSource; rows: CalcRow[]; label: string }[] =>
  (Object.keys(CALCS) as CalcSource[])
    .filter((s) => s !== own && CALCS[s])
    .map((s) => ({ src: s, ...CALCS[s]! }));
