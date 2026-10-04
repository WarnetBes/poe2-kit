/**
 * Hideout-модуль PoE2 Kit №198: офлайн-разбор файла .hideout.
 *
 * Формат (реверс по живым образцам, 2026-10-03): JSON (UTF-8, возможен BOM) вида
 *   { "version": 1, "language": "English", "hideout_name": "...", "hideout_hash": N,
 *     "music_name"?: "...", "music_hash"?: N,
 *     "doodads": { "<Имя декора>": { "hash": N, "x": N, "y": N, "r": N, "fv"?: N }, … } }
 * Источник образцов — публичные скачивания pathofhideouts.com /hideout/{id}/download/
 * (5 файлов: PoE1 id 126 + PoE2 id 30/31/41/69). Лимит декора — 750 (см. POH-калькулятор:
 * «Path of Exile restricts hideouts to a strict limit of 750 decorations»).
 *
 * ❓ НЕ ПРОВЕРЕНО: совпадает ли этот формат с нативным экспортом игры (POH мог
 * канонизировать). fv — вероятно, флаг вариантов (значения 0..14 и 128..137:
 * бит 0x80 выглядит флагом, 🔎 гипотеза). r — угол, диапазон 0..65535
 * (≈ 0..360° с шагом 1/182, 🔎). Живой файл владельца уточнит.
 *
 * Дизайн-решения:
 *  - парсер толерантен к неизвестным полям (forward-compat) и битым записям
 *    (сбор в warnings, никогда — молчаливый успех с мусором);
 *  - категория декора (free/store-mtx/exclusive-mtx/pet) — из датасета
 *    data/game/hideout/decor.json + эвристики; непокрытые — честно 'unknown';
 *  - share-код сводки — zlib+base64 (round-trip проверяется при декоде).
 */

import { zlibSync, unzlibSync } from 'fflate';
import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

// ─── типы ──────────────────────────────────────────────────────────────────

export class HideoutParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HideoutParseError';
  }
}

/** Лимит декораций хайдоута (PoE1 подтверждён POH; для PoE2 ❓). */
export const HIDEOUT_DECOR_LIMIT = 750;

export type DecorCategory = 'free' | 'store-mtx' | 'exclusive-mtx' | 'pet' | 'unknown';

export interface DecorMeta {
  category: DecorCategory;
  /** Откуда классификация: dataset | heuristic-possessive | unclassified. */
  source: string;
}

/** Индекс декора: lowercase-имя → метаданные. */
export type DecorIndex = Record<string, DecorMeta>;

export interface HideoutDoodad {
  /** Имя декора, как в файле (ключ doodads). */
  name: string;
  /** Game-хеш объектного типа (стабилен между файлами — сверено по 5 образцам). */
  hash: number;
  x: number;
  y: number;
  /** Угол, диапазон 0..65535 (≈ 0..360° с шагом 1/182 — 🔎 гипотеза). */
  r: number;
  /** Флаг вариантов (значения 0..14, 128..137) — 🔎 гипотеза: вариант объекта, бит 0x80 — флаг. */
  fv?: number;
}

export interface ParsedHideout {
  version: number | null;
  language: string | null;
  hideoutName: string;
  hideoutHash: number;
  musicName?: string;
  musicHash?: number;
  doodads: HideoutDoodad[];
  /** Неизвестные top-level поля (forward-compat, перечислены, не выброшены). */
  extraTopLevel: string[];
  /** Некритичные проблемы разбора. */
  warnings: string[];
}

export interface DecorStat {
  name: string;
  count: number;
  hashes: number[];
  category: DecorCategory;
  categorySource: string;
  placements: { x: number; y: number; r: number; fv?: number }[];
}

export interface HideoutSummary {
  base: string;
  baseHash: number;
  music?: string;
  totalPlacements: number;
  uniqueDecor: number;
  limit: number;
  overLimit: boolean;
  /** Декор по категориям: имя категории → суммарное число размещений. */
  byCategory: Record<DecorCategory, number>;
  /** Сколько имен классифицировано (не unknown) / всего имен. */
  coverage: { known: number; unknown: number };
  decor: DecorStat[];
  warnings: string[];
}

// ─── парсер ─────────────────────────────────────────────────────────────────

const KNOWN_TOP = new Set([
  'version', 'language', 'hideout_name', 'hideout_hash', 'music_name', 'music_hash', 'doodads',
]);

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

/**
 * Разобрать текст .hideout (JSON, допускается UTF-8 BOM — реальные файлы POH
 * содержат BOM). Битые записи пропускаются с warning; структурный мусор —
 * HideoutParseError (никакого молчаливого успеха).
 */
export function parseHideout(text: string): ParsedHideout {
  const src = text.replace(/^\uFEFF/, '').trim();
  if (!src) throw new HideoutParseError('пустой файл .hideout');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(src) as Record<string, unknown>;
  } catch (e) {
    throw new HideoutParseError(
      `не JSON (.hideout): ${e instanceof Error ? e.message : String(e)} — ` +
        'ожидается файл, экспортированный игрой/POH (версия JSON). Если это старый PoE1-текстовый экспорт — формат пока не поддерживается.',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HideoutParseError('корень .hideout — не объект JSON');
  }
  const warnings: string[] = [];
  const base = raw['hideout_name'];
  const baseHash = asInt(raw['hideout_hash']);
  if (typeof base !== 'string' || !base) throw new HideoutParseError('нет hideout_name — это не .hideout файл');
  if (baseHash === null) throw new HideoutParseError(`нет числового hideout_hash (получено: ${JSON.stringify(raw['hideout_hash'])})`);
  const doodadsRaw = raw['doodads'];
  if (typeof doodadsRaw !== 'object' || doodadsRaw === null || Array.isArray(doodadsRaw)) {
    throw new HideoutParseError('нет объекта doodads — это не .hideout файл');
  }

  const doodads: HideoutDoodad[] = [];
  for (const [name, d] of Object.entries(doodadsRaw as Record<string, unknown>)) {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) {
      warnings.push(`декор "${name}": запись не объект — пропущена`);
      continue;
    }
    const rec = d as Record<string, unknown>;
    const hash = asInt(rec['hash']);
    const x = asInt(rec['x']);
    const y = asInt(rec['y']);
    const r = asInt(rec['r']);
    if (hash === null || x === null || y === null || r === null) {
      warnings.push(`декор "${name}": неполные координаты/hash — пропущен`);
      continue;
    }
    const fv = asInt(rec['fv']) ?? undefined;
    doodads.push({ name, hash, x, y, r, fv });
  }
  if (!doodads.length) throw new HideoutParseError('в doodads нет ни одной валидной записи');

  const rawMusicName = raw['music_name'];
  const rawMusicHash = asInt(raw['music_hash']);
  const extraTopLevel = Object.keys(raw).filter((k) => !KNOWN_TOP.has(k));
  if (extraTopLevel.length) warnings.push(`неизвестные top-level поля (оставлены): ${extraTopLevel.join(', ')}`);

  return {
    version: asInt(raw['version']),
    language: typeof raw['language'] === 'string' ? raw['language'] : null,
    hideoutName: base,
    hideoutHash: baseHash,
    musicName: typeof rawMusicName === 'string' ? rawMusicName : undefined,
    musicHash: rawMusicHash ?? undefined,
    doodads,
    extraTopLevel,
    warnings,
  };
}

// ─── датасет декора ─────────────────────────────────────────────────────────

let decorIndexCache: DecorIndex | null = null;

/** Загрузить индекс декора из data/game/hideout/decor.json (Node/MCP/overlay; в браузере — см. web-src, ?url import). */
export function loadDecorIndex(): DecorIndex {
  if (decorIndexCache) return decorIndexCache;
  if (!HAS_DISK) throw new HideoutParseError('decor.json недоступен без диска (браузер должен загрузить его через ?url и передать в summarizeHideout)');
  const path = pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..', 'data', 'game', 'hideout', 'decor.json',
  );
  interface FileDecorEntry { name: string; category?: DecorCategory; category_source?: string }
  interface DecorFile { decor: Record<string, FileDecorEntry> }
  const file = JSON.parse(fsMod!.readFileSync(path, 'utf8')) as DecorFile;
  const idx: DecorIndex = {};
  for (const [k, e] of Object.entries(file.decor)) {
    idx[k] = { category: e.category ?? 'unknown', source: e.category_source ?? 'dataset' };
  }
  decorIndexCache = idx;
  return idx;
}

export function clearDecorIndexCache(): void {
  decorIndexCache = null;
}

// Функциональные объекты базовой игры: есть в хайдоутах первого дня (видны во всех 5 образцах).
const FREE_FUNCTIONAL = new Set([
  'stash', 'guild stash', 'waypoint', 'map device', 'ziggurat map device', 'relic locker',
  'reforging bench', 'salvage bench', 'well', 'chaos bank', 'gambling stall',
]);

/**
 * Классифицировать декор: датасет → эвристики. Всё непокрытое — честно 'unknown',
 * категория никогда не выдумывается (см. проверку на 5 образцах: 8 free / 2 store-mtx / 128 unknown).
 */
export function classifyDecor(name: string, index?: DecorIndex): DecorMeta {
  const key = name.trim().toLowerCase();
  if (!key) return { category: 'unknown', source: 'unclassified' };
  const hit = index?.[key];
  if (hit) return hit;
  // Эвристика: <Владелец>'s <функциональный объект> — косметический вариант (MTX).
  const m = key.match(/[\w'’-]+['’]s\s+(.+)/);
  if (m && FREE_FUNCTIONAL.has(m[1]!.trim())) {
    return { category: 'store-mtx', source: 'heuristic-possessive' };
  }
  return { category: 'unknown', source: 'unclassified' };
}

// ─── сводка ─────────────────────────────────────────────────────────────────

/**
 * Сводка по хайдоуту: агрегация декора по именам, классификация, счёт против
 * лимита 750. decorIndex в браузере передаёт web (?url import), в Node —
 * loadDecorIndex().
 */
export function summarizeHideout(parsed: ParsedHideout, opts: { decorIndex?: DecorIndex } = {}): HideoutSummary {
  const index = opts.decorIndex;
  const byName = new Map<string, DecorStat>();
  for (const d of parsed.doodads) {
    const key = d.name.trim().toLowerCase();
    let stat = byName.get(key);
    if (!stat) {
      const meta = classifyDecor(d.name, index);
      stat = { name: d.name, count: 0, hashes: [], category: meta.category, categorySource: meta.source, placements: [] };
      byName.set(key, stat);
    }
    stat.count++;
    if (!stat.hashes.includes(d.hash)) stat.hashes.push(d.hash);
    stat.placements.push({ x: d.x, y: d.y, r: d.r, fv: d.fv });
  }
  const decor = [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const byCategory: Record<DecorCategory, number> = {
    free: 0, 'store-mtx': 0, 'exclusive-mtx': 0, pet: 0, unknown: 0,
  };
  for (const s of decor) byCategory[s.category] += s.count;
  return {
    base: parsed.hideoutName,
    baseHash: parsed.hideoutHash,
    music: parsed.musicName,
    totalPlacements: parsed.doodads.length,
    uniqueDecor: decor.length,
    limit: HIDEOUT_DECOR_LIMIT,
    overLimit: parsed.doodads.length > HIDEOUT_DECOR_LIMIT,
    byCategory,
    coverage: {
      known: decor.filter((s) => s.category !== 'unknown').length,
      unknown: decor.filter((s) => s.category === 'unknown').length,
    },
    decor,
    warnings: parsed.warnings,
  };
}

// ─── share-код (zlib + base64, свой round-trip — не PoB-формат) ─────────────

const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 3 <= bytes.length; i += 3) {
    s += _B64[(bytes[i]! >> 2) & 63] + _B64[((bytes[i]! & 3) << 4) | (bytes[i + 1]! >> 4)] +
      _B64[((bytes[i + 1]! & 15) << 2) | (bytes[i + 2]! >> 6)] + _B64[bytes[i + 2]! & 63];
  }
  const tail = bytes.length % 3;
  if (tail === 1) s += _B64[(bytes[bytes.length - 1]! >> 2) & 63] + _B64[(bytes[bytes.length - 1]! & 3) << 4] + '==';
  else if (tail === 2) {
    s += _B64[(bytes[bytes.length - 2]! >> 2) & 63] + _B64[((bytes[bytes.length - 2]! & 3) << 4) | (bytes[bytes.length - 1]! >> 4)] +
      _B64[(bytes[bytes.length - 1]! & 15) << 2] + '=';
  }
  return s;
}

function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = _B64.indexOf(clean[i]!);
    if (v < 0) throw new HideoutParseError(`невалидный символ "${clean[i]}" в share-коде хайдоута (позиция ${i})`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Компактное представление для share-кода: массивы вместо вложенных объектов (сжатие в ~2.5 раза лучше). */
interface CompactHideout {
  v: 1;
  n: string;
  h: number;
  m?: [string, number];
  d: [string, number, number, number, number, number?][]; // [name, hash, x, y, r, fv?]
}

/** Кодировать разобранный хайдоут в share-код PoE2 Kit (zlib+base64). */
export function encodeHideoutCode(parsed: ParsedHideout): string {
  const compact: CompactHideout = {
    v: 1,
    n: parsed.hideoutName,
    h: parsed.hideoutHash,
    m: parsed.musicName !== undefined ? [parsed.musicName, parsed.musicHash ?? 0] : undefined,
    d: parsed.doodads.map((d) => [d.name, d.hash, d.x, d.y, d.r, d.fv]),
  };
  const json = JSON.stringify(compact);
  const z = zlibSync(new TextEncoder().encode(json), { level: 9 });
  return bytesToB64(z);
}

/** Декодировать share-код PoE2 Kit обратно в ParsedHideout. */
export function decodeHideoutCode(code: string): ParsedHideout {
  if (!code || !code.trim()) throw new HideoutParseError('пустой share-код хайдоута');
  const z = b64ToBytes(code);
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(unzlibSync(z));
  } catch (e) {
    throw new HideoutParseError(`share-код повреждён (zlib/UTF-8): ${e instanceof Error ? e.message : String(e)} — скопируйте код целиком`);
  }
  let compact: CompactHideout;
  try {
    compact = JSON.parse(json) as CompactHideout;
  } catch {
    throw new HideoutParseError('share-код повреждён: данные — не сводка хайдоута');
  }
  if (compact?.v !== 1 || typeof compact.n !== 'string' || typeof compact.h !== 'number' || !Array.isArray(compact.d)) {
    throw new HideoutParseError('share-код повреждён: структура сводки хайдоута не распознана');
  }
  const doodads: HideoutDoodad[] = [];
  const warnings: string[] = [];
  for (const rec of compact.d) {
    if (!Array.isArray(rec) || typeof rec[0] !== 'string' || typeof rec[1] !== 'number') {
      warnings.push('запись в share-коде бессмысленна — пропущена');
      continue;
    }
    doodads.push({ name: rec[0], hash: rec[1], x: rec[2] ?? 0, y: rec[3] ?? 0, r: rec[4] ?? 0, fv: rec[5] ?? undefined });
  }
  if (!doodads.length) throw new HideoutParseError('share-код повреждён: нет валидных декораций');
  return {
    version: 1,
    language: null,
    hideoutName: compact.n,
    hideoutHash: compact.h,
    musicName: compact.m?.[0],
    musicHash: compact.m?.[1],
    doodads,
    extraTopLevel: [],
    warnings,
  };
}

// ─── экспорт в текст (форум/блокнот) ────────────────────────────────────────

/** Markdown-сводка для форума (по приёму POH: полный список декора до импорта). */
export function formatHideoutPost(summary: HideoutSummary, opts: { owned?: Set<string>; game?: string } = {}): string {
  const owned = opts.owned;
  const lines: string[] = [];
  const game = opts.game ?? 'Path of Exile 2';
  lines.push(`# ${summary.base} (${game})`);
  lines.push('');
  lines.push(`Декораций: **${summary.totalPlacements} / ${summary.limit}**${summary.overLimit ? ' ⚠ ПРЕВЫШЕН ЛИМИТ' : ''}`);
  if (summary.music) lines.push(`Музыка: ${summary.music}`);
  const free = summary.byCategory['free'];
  const storeMtx = summary.byCategory['store-mtx'] + summary.byCategory['exclusive-mtx'];
  lines.push(`Бесплатная часть: ${free}; MTX: ${storeMtx}; вне классификации: ${summary.byCategory['unknown']}.`);
  if (owned) {
    const canBuild = summary.decor.filter((s) => s.category === 'free' || (owned.has(s.name.toLowerCase()) && s.category !== 'unknown'));
    const canCount = canBuild.reduce((a, s) => a + s.count, 0);
    lines.push(`Собираемо из вашего инвентаря (${game}): ${Math.round((canCount / summary.totalPlacements) * 100)}%.`);
  }
  lines.push('');
  lines.push('## Декор');
  for (const s of summary.decor) {
    lines.push(`- ${s.name} ×${s.count}${s.category !== 'unknown' ? ` [${s.category}]` : ''}`);
  }
  return lines.join('\n');
}
