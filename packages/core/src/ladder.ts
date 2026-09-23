/**
 * poe.ninja PoE2 builds-ladder (лэддер/мета-билды).
 *
 * Порт `_research/hivemind-poe2-mcp/src/api/poe_ninja_ladder.py`
 * (копирование разрешено): после миграции poe.ninja 0.5 builds-API отвечает
 * protobuf'ом в колонко-ориентированном формате; wire-разбор сделан без
 * .proto-схемы и без protobuf-зависимости.
 *
 * Endpoint map:
 *   GET /poe2/api/data/index-state         → JSON: snapshotVersions[]
 *   GET /poe2/api/builds/{version}/search  → protobuf; params: overview=<snapshotName>,
 *                                            фильтры: name=, class=, sort=
 *
 * Политика: данные персонажей/билдов poe.ninja — разрешённый источник
 * (данные игроков, не игровые механики).
 */

import { httpBytes, httpJson } from './http.js';

// ─── Protobuf wire-примитивы (без схемы) ───────────────────────────────────

type Field = [number, string, unknown]; // [field_no, wire_kind, value]

function readVarint(buf: Uint8Array, i: number, n: number): [number, number] | [null, number] {
  let v = 0;
  let shift = 0;
  while (i < n) {
    const b = buf[i]!;
    v |= (b & 0x7f) << shift;
    i += 1;
    if (!(b & 0x80)) return [v, i];
    shift += 7;
  }
  return [null, i];
}

/**
 * Разобрать protobuf-сообщение без схемы. Length-delimited чанки рекурсивно
 * пробуются как вложенные сообщения, затем как UTF-8 строки, иначе — байты.
 * null = буфер не является валидным сообщением (лист).
 */
export function parseProtobufMessage(buf: Uint8Array, depth = 0, maxDepth = 10): Field[] | null {
  const out: Field[] = [];
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const [tag, i1] = readVarint(buf, i, n);
    i = i1;
    if (tag === null || tag === 0) return null;
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 0 || field > 4000) return null;
    if (wire === 0) {
      const [v, i2] = readVarint(buf, i, n);
      i = i2;
      if (v === null) return null;
      out.push([field, 'int', v]);
    } else if (wire === 1) {
      if (i + 8 > n) return null;
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 8);
      out.push([field, 'f64', dv.getFloat64(0, true)]);
      i += 8;
    } else if (wire === 2) {
      const [ln, i3] = readVarint(buf, i, n);
      i = i3;
      if (ln === null || i + ln > n) return null;
      const chunk = buf.subarray(i, i + ln);
      i += ln;
      const sub = depth < maxDepth && chunk.length > 1 ? parseProtobufMessage(chunk, depth + 1, maxDepth) : null;
      if (sub) {
        out.push([field, 'msg', sub]);
      } else {
        try {
          out.push([field, 'str', new TextDecoder('utf-8', { fatal: true }).decode(chunk)]);
        } catch {
          out.push([field, 'bytes', chunk]);
        }
      }
    } else if (wire === 5) {
      if (i + 4 > n) return null;
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 4);
      out.push([field, 'f32', dv.getFloat32(0, true)]);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

// ─── Разбор колонко-ориентированного ответа поиска ─────────────────────────

export interface NinjaSnapshot {
  url: string;
  version: string;
  snapshotName: string;
}

export interface LadderRow {
  [column: string]: unknown;
}

export interface LadderSearchResult {
  total: number | null;
  columns: string[];
  rows: LadderRow[];
  /** name → sha1-хэш словарей poe.ninja (class/gem/keypassive/...), env field 6. */
  dictionaries: Record<string, string>;
  /** колонка → имя словаря для расшифровки ссылок (column field 11). */
  columnDicts: Record<string, string>;
}

/** Первый field с данным номером/типом в сообщении. */
function firstOf(fields: Field[] | null, no: number, kind: 'int'): number | null;
function firstOf(fields: Field[] | null, no: number, kind: 'str'): string | null;
function firstOf(fields: Field[] | null, no: number, kind: 'str' | 'int'): unknown {
  if (!fields) return null;
  for (const [f, k, v] of fields) {
    if (f === no && k === kind) return v;
  }
  return null;
}

/** bytes → latin1-строка (для packed varint-колонок, пришедших как bytes). */
function bytesToLatin1(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return s;
}

/** Значение ячейки колонки: str — как есть, int — число, msg — display(f1) и/или number(f2). */
function cellValue(entry: Field): unknown {
  const [ , kind, v] = entry;
  if (kind === 'str' || kind === 'int') return v;
  if (kind === 'msg') {
    const inner = v as Field[];
    const display = firstOf(inner, 1, 'str');
    if (display !== null) return display;
    return firstOf(inner, 2, 'int');
  }
  return null;
}

/**
 * Разобрать /builds/{version}/search → { total, columns, rows }.
 *
 * Актуальный (2026-09, post-0.5-миграция) формат: env field 12 (repeated) —
 * КОЛОНКИ { 1: name, 7: repeated cells, 13: count }. Ячейки — str (готовый
 * display: '143k', 'ResurrectGodAura'), int (raw-число) или msg.
 * Легаси-формат июня 2026 (колонки в field 5) оставлен как fallback.
 */
export function decodeLadderSearch(payload: Uint8Array): LadderSearchResult {
  const msg = parseProtobufMessage(payload);
  if (!msg || msg[0]![1] !== 'msg') throw new Error('unrecognized search response shape');
  const env = msg[0]![2] as Field[];

  const total = firstOf(env, 1, 'int') as number | null;
  const columns = new Map<string, unknown[]>();
  const order: string[] = [];
  // Словари poe.ninja: env field 6 { 1: name, 2: sha1 }; колонка: field 11 = имя словаря.
  const dictionaries: Record<string, string> = {};
  for (const [, , v] of env.filter(([f, k]) => f === 6 && k === 'msg')) {
    const name = firstOf(v as Field[], 1, 'str');
    let hash: string | null = null;
    for (const [g, w, x] of v as Field[]) {
      // f2 — простой nDIC-словарь строк; f3 — NOVL-вариант с иконками (не нужен).
      if (g === 2 && w === 'str' && /^[0-9a-f]{40}$/.test(String(x))) hash = String(x);
    }
    if (name && hash) dictionaries[name] = hash;
  }
  const columnDicts: Record<string, string> = {};

  const isNew = env.some(([f, k]) => f === 12 && k === 'msg');

  if (isNew) {
    // Новый формат (2026-09): env field 12 (repeated) — КОЛОНКИ
    // { 1: name, 2: базовое имя, 7: repeated display-строки, 6: packed varints,
    //   9: repeated словарные ссылки, 11: имя словаря ('gem', 'class'), 13: count }.
    const colMsgs = env.filter(([f, k]) => f === 12 && k === 'msg').map(([, , v]) => v as Field[]);
    for (const colMsg of colMsgs) {
      let colName = firstOf(colMsg, 1, 'str');
      if (!colName) continue;
      if (columns.has(colName)) colName = `${colName}_2`;
      const dictName = firstOf(colMsg, 11, 'str');
      const display = colMsg.filter(([f]) => f === 7).map((e) => cellValue(e));
      const packedRaw = colMsg.find(([f]) => f === 6);
      const packed = packedRaw ? (packedRaw[1] === 'str' ? (packedRaw[2] as string) : packedRaw[1] === 'bytes' ? bytesToLatin1(packedRaw[2] as Uint8Array) : null) : null;
      if (display.length > 0) {
        columns.set(colName, display);
      } else if (packed !== null) {
        columns.set(colName, unpackVarints(packed));
      } else {
        // Словарные ссылки (skills/keypassives/...): ячейка f9 → msg{1: bytes},
        // bytes = упакованные varint-индексы словаря.
        const refs: Array<number[] | null> = [];
        for (const entry of colMsg.filter(([f]) => f === 9)) {
          if (entry[1] === 'msg') {
            const inner = entry[2] as Field[];
            const b = inner.find(([g, w]) => g === 1 && w === 'bytes');
            if (b) refs.push(unpackVarints(bytesToLatin1(b[2] as Uint8Array)));
            else refs.push(null);
          } else if (entry[1] === 'str') {
            refs.push(entry[2] ? unpackVarints(entry[2] as string) : []);
          } else {
            refs.push(null);
          }
        }
        columns.set(colName, refs);
      }
      if (dictName) columnDicts[colName] = dictName;
      order.push(colName);
    }
  } else {
    // Легаси-формат июня 2026 (колонки в field 5).
    for (const [f, kind, value] of env) {
      if (f !== 5 || kind !== 'msg') continue;
      const colMsg = value as Field[];
      let colName = firstOf(colMsg, 1, 'str');
      if (!colName) continue;
      // 'ehp' встречается дважды (ehp + tooltip-вариант) — держим первый
      if (columns.has(colName)) colName = `${colName}_2`;
      const cells: unknown[] = [];
      const refs: unknown[] = [];
      for (const [ff, kk, cell] of colMsg) {
        if (ff !== 2) continue;
        if (kk === 'msg') {
          const cellMsg = cell as Field[];
          const display = firstOf(cellMsg, 1, 'str');
          const number = firstOf(cellMsg, 2, 'int');
          cells.push(display !== null ? display : number);
          let ref: unknown = null;
          for (const [g, w, v] of cellMsg) {
            if (g === 3 && (w === 'str' || w === 'bytes')) ref = v;
          }
          refs.push(ref);
        } else {
          cells.push(kk === 'str' ? cell : null);
          refs.push(null);
        }
      }
      columns.set(colName, cells);
      order.push(colName);
      if (refs.some((r) => r !== null)) columns.set(colName + '_refs', refs);
    }
  }

  const rowCount = Math.max(
    0,
    ...[...columns.entries()].filter(([k]) => !k.endsWith('_refs')).map(([, v]) => v.length),
  );
  const rows: LadderRow[] = [];
  for (let idx = 0; idx < rowCount; idx++) {
    const row: LadderRow = {};
    for (const name of order) {
      const vals = columns.get(name) ?? [];
      row[name] = idx < vals.length ? vals[idx] : null;
    }
    rows.push(row);
  }

  return { total, columns: order, rows, dictionaries, columnDicts };
}

// ─── Клиент лэддера ────────────────────────────────────────────────────────

interface RawSnapshot {
  url?: string;
  version?: string;
  snapshotName?: string;
}

/** Распаковать строку упакованных varint'ов (колонка f6: level=100 → 100,100,...). */
function unpackVarints(packed: string): number[] {
  const buf = Uint8Array.from([...packed].map((c) => c.codePointAt(0)! & 0xff));
  const out: number[] = [];
  let v = 0;
  let shift = 0;
  for (const b of buf) {
    v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) {
      out.push(v);
      v = 0;
      shift = 0;
    } else {
      shift += 7;
    }
  }
  return out;
}

let snapshotCache: { at: number; list: NinjaSnapshot[] } | null = null;

// ─── Словари poe.ninja (nDIC) ─────────────────────────────────────────────

const dictCache = new Map<string, string[]>();

/**
 * Разобрать бинарный словарь poe.ninja: 'nDIC' + version + ... + count(u32) +
 * count байт длин строк + склеенные UTF-8 строки. Индекс массива == индекс
 * ссылки в колонках лэддера. Массив длин ищем самовалидирующимся сканом
 * (сумма длин == остаток байтов), чтобы не зависеть от точного заголовка.
 */
export function parseNinjaDictionary(db: Uint8Array): string[] {
  if (db.length < 16) return [];
  const dv = new DataView(db.buffer, db.byteOffset, db.byteLength);
  const count = dv.getUint32(12, true);
  if (count === 0 || count > 20000 || 12 + 4 + count > db.length) return [];
  for (let off = 32; off + count <= db.length; off++) {
    let sum = 0;
    let zero = false;
    for (let i = 0; i < count; i++) {
      const l = db[off + i]!;
      if (l === 0) {
        zero = true;
        break;
      }
      sum += l;
    }
    if (zero || off + count + sum !== db.length || sum === 0) continue;
    const out: string[] = [];
    let p = off + count;
    for (let i = 0; i < count; i++) {
      const l = db[off + i]!;
      out.push(bytesToLatin1(db.subarray(p, p + l)));
      p += l;
    }
    return out;
  }
  return [];
}

/** Словарь poe.ninja по sha1-хэшу (кэш навсегда — контент адресуется хэшем). */
export async function getLadderDictionary(hash: string): Promise<string[]> {
  const hit = dictCache.get(hash);
  if (hit) return hit;
  const db = await httpBytes(`https://poe.ninja/poe2/api/builds/dictionary/${hash}`);
  const list = parseNinjaDictionary(db);
  dictCache.set(hash, list);
  return list;
}

/** Актуальные снапшоты poe.ninja PoE2 (кэш 10 минут). */
export async function getLadderSnapshots(): Promise<NinjaSnapshot[]> {
  if (snapshotCache && Date.now() - snapshotCache.at < 10 * 60 * 1000) return snapshotCache.list;
  const raw = await httpJson<{ snapshotVersions?: RawSnapshot[] }>(
    'https://poe.ninja/poe2/api/data/index-state',
  );
  const list = (raw.snapshotVersions ?? [])
    .filter((s) => s.url && s.version && s.snapshotName)
    .map((s) => ({ url: s.url!, version: s.version!, snapshotName: s.snapshotName! }));
  snapshotCache = { at: Date.now(), list };
  return list;
}

/** Слаг лиги (например "forbidden-rites") → текущий снапшот. */
export async function resolveLadderSnapshot(leagueSlug: string): Promise<NinjaSnapshot | null> {
  const slug = leagueSlug.toLowerCase().replace(/\s+/g, '-');
  const list = await getLadderSnapshots();
  return list.find((s) => s.url === slug) ?? null;
}

/** Все доступные лиги-снапшоты (slug'и). */
export async function listLadderLeagues(): Promise<string[]> {
  return (await getLadderSnapshots()).map((s) => s.url);
}

export interface LadderSearchFilters {
  /** Имя персонажа (подстрока). */
  name?: string;
  /** Класс/асценданси (например "Invoker"). */
  class?: string;
  /** Сортировка: level, dps, ehp... */
  sort?: string;
}

/**
 * Поиск по билдам poe.ninja PoE2. Фильтры передаются как query-параметры.
 * null — снапшот лиги не найден или запрос не удался.
 */
export async function searchLadderBuilds(
  leagueSlug: string,
  filters: LadderSearchFilters = {},
): Promise<LadderSearchResult | null> {
  const snap = await resolveLadderSnapshot(leagueSlug);
  if (!snap) return null;
  const params = new URLSearchParams({ overview: snap.snapshotName });
  if (filters.name) params.set('name', filters.name);
  if (filters.class) params.set('class', filters.class);
  if (filters.sort) params.set('sort', filters.sort);
  const payload = await httpBytes(
    `https://poe.ninja/poe2/api/builds/${snap.version}/search?${params.toString()}`,
  );
  try {
    const res = decodeLadderSearch(payload);
    await enrichLadderRows(res);
    return res;
  } catch {
    return null;
  }
}

/**
 * Расшифровать словарные ссылки в строках: колонка class → classLabel,
 * skills/keypassives → массивы имён. Словари качаются по хэшам из ответа
 * (кэш по хэшу), неудачи расшифровки не ломают строки — остаются индексы.
 */
async function enrichLadderRows(res: LadderSearchResult): Promise<void> {
  const dicts = new Map<string, string[]>();
  for (const [col, dictName] of Object.entries(res.columnDicts)) {
    const hash = res.dictionaries[dictName];
    if (!hash) continue;
    if (!dicts.has(dictName)) {
      try {
        dicts.set(dictName, await getLadderDictionary(hash));
      } catch {
        dicts.set(dictName, []);
      }
    }
    const dict = dicts.get(dictName)!;
    if (!dict.length) continue;
    for (const row of res.rows) {
      const v = row[col];
      if (col === 'class' && typeof v === 'number') {
        row.classIdx = v;
        row.classLabel = dict[v] ?? `#${v}`;
      } else if (Array.isArray(v)) {
        row[col] = v.map((i) => (typeof i === 'number' ? (dict[i] ?? `#${i}`) : i));
      }
    }
  }
}

/** Первая страница лэддера (до 100 строк), опционально с фильтром по классу. */
export async function topLadderBuilds(
  leagueSlug: string,
  opts: { className?: string; sort?: string; limit?: number } = {},
): Promise<LadderRow[]> {
  const res = await searchLadderBuilds(leagueSlug, {
    class: opts.className,
    sort: opts.sort ?? 'level',
  });
  return (res?.rows ?? []).slice(0, opts.limit ?? 100);
}

/** Форматировать строки лэддера в markdown-таблицу (для MCP/CLI). */
export function formatLadderRows(rows: LadderRow[], limit = 20): string {
  if (!rows.length) return 'Лэддер пуст или недоступен.';
  const head = ['#', 'Персонаж', 'Ур.', 'Класс', 'EHP', 'DPS', 'Скиллы'];
  const lines = ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |'];
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const r = rows[i]!;
    const skills = Array.isArray(r.skills) ? (r.skills as unknown[]).slice(0, 4).join(', ') : '';
    lines.push(
      `| ${i + 1} | ${r.name ?? '—'} | ${r.level ?? '—'} | ${r.classLabel ?? r.class ?? '—'} | ${
        r['ehp__str'] ?? r.ehp ?? '—'
      } | ${r['dps.total'] ?? '—'} | ${skills} |`,
    );
  }
  return lines.join('\n');
}
