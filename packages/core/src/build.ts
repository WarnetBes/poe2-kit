/**
 * Анализ и импорт билдов.
 * Поддерживает:
 *  - декодирование PoB share-кодов: urlsafe(base64(zlib(xml))) с восстановлением Adler-32
 *  - ссылки pobb.in / pastebin
 *  - сырой .build JSON (официальный формат Build Planner)
 * Полный расчёт DPS/EHP полагается на внешний движок (PoB), доступный через MCP.
 */

import { deflateSync, inflateSync, unzlibSync, zlibSync } from 'fflate';
import type { BuildGearItem, BuildImport } from './types.js';

/** Ошибка при работе с PoB-кодами. */
export class PobCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PobCodeError';
  }
}

const _WS = /\s+/g;
const _POBB = /^https?:\/\/(?:www\.)?pobb\.in\/([A-Za-z0-9_-]+)\/?$/i;
const _PASTEBIN = /^https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)\/?$/i;
// Сайты, отдающие HTML-страницу, а не сырой код — их нельзя скрейпить.
const _PAGE_HOSTS = /^https?:\/\/(?:www\.)?(maxroll\.gg|pobarchives\.com|poe\.ninja|poe2\.ninja|mobalytics\.gg|pathofexile\.com)\//i;

/**
 * Декодировать PoB share-код в XML билда.
 * Формат: urlsafe(base64(сжатый xml)) — +→-, /→_, убираем пробелы, восстанавливаем padding.
 *
 * По умолчанию PoB (и PoB2) пакует XML в zlib-поток (RFC1950: заголовок 0x78.. + deflate + Adler-32),
 * но некоторые коды/экспортёры пишут «сырой» deflate без заголовка/чек-суммы.
 * Поэтому пробуем в порядке: целый zlib c проверкой Adler-32 → raw deflate → попытки восстановить обрезанный хвост.
 * Декод ВСЕГДА проверяет контрольную сумму и, если данные битые, даёт внятную ошибку (не возвращает мусор).
 */
export function decodeShareCode(code: string): string {
  if (!code || !code.trim()) throw new PobCodeError('пустой import-код');
  // Убираем whitespace/кавычки, возвращаем стандартный алфавит (+, /) и срезаем
  // существующий padding «=» — добавим ровно сколько нужно (бывает, что код
  // скопирован вместе с «=», хотя PoB экспортирует без него до Adler-32).
  const s0 = code
    .replace(_WS, '')
    .replace(/=+$/, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const s = s0 + '='.repeat((4 - (s0.length % 4)) % 4); // восстановить padding

  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    throw new PobCodeError('невалидный base64 в import-коде');
  }

  const xml = _tryInflate(raw);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(xml);
  if (!text.includes('PathOfBuilding')) {
    throw new PobCodeError(
      'раскодированные данные — не билд Path of Building. Перекопируйте полный код.',
    );
  }
  return text;
}

/** Проверить, что распакованная строка — осмысленный билд, а не мусор. */
function _looksLikeBuild(b: Uint8Array | null | undefined): b is Uint8Array {
  if (!b || b.length < 20) return false;
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: false }).decode(b);
  } catch {
    return false;
  }
  const head = t.trimStart();
  return head.startsWith('<') && t.includes('PathOfBuilding');
}

function _adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** Распаковать zlib-байты (RFC1950) при совпадении встроенной Adler-32, иначе null. */
function _unzlibVerified(zraw: Uint8Array): Uint8Array | null {
  if (zraw.length < 6) return null;
  try {
    const out = unzlibSync(zraw);
    const stored = ((zraw[zraw.length - 4]! << 24) |
      (zraw[zraw.length - 3]! << 16) |
      (zraw[zraw.length - 2]! << 8) |
      zraw[zraw.length - 1]!) >>> 0;
    if (stored === _adler32(out)) return out;
    return null;
  } catch {
    return null;
  }
}

/**
 * Пробуем распаковать билд из закодированных байтов.
 * Варианты формата: целый zlib (RFC1950 с Adler), «сырой» deflate без заголовка,
 * либо zlib-заголовок + deflate без чек-суммы (PoB срезает Adler-32 перед base64).
 * Каждый кандидат проверяется контрольной суммой ИЛИ повторным сжатием (round-trip),
 * поэтому повреждённый код НЕ молячит — даёт внятную ошибку.
 */
function _tryInflate(raw: Uint8Array): Uint8Array {
  // Целый zlib-поток с проверкой Adler-32.
  {
    const v = _unzlibVerified(raw);
    if (_looksLikeBuild(v)) return v as Uint8Array;
  }
  // «Сырой» deflate без чек-суммы (экспортёры без zlib-заголовка) — проверяем round-trip.
  {
    const r = _rawTry(raw);
    if (_roundtripOk(r, raw)) return r as Uint8Array;
  }
  // zlib-заголовок + deflate без хвостовой Adler-32 (формат PoB-кодов) — проверяем round-trip по телу.
  if (raw.length > 8) {
    const body = raw.subarray(2);
    const r = _rawTry(body);
    if (_roundtripOk(r, body)) return r as Uint8Array;
  }
  // Хвост потерян/обрезан при ручной вставке длинного кода: снимаем 1..48 байт.
  for (let trim = 1; trim <= 48; trim++) {
    if (raw.length - trim <= 4) break;
    const clipped = raw.subarray(0, raw.length - trim);
    {
      const r = _rawTry(clipped);
      if (_roundtripOk(r, clipped)) return r as Uint8Array;
    }
    if (clipped.length > 6) {
      const body = clipped.subarray(2);
      const r = _rawTry(body);
      if (_roundtripOk(r, body)) return r as Uint8Array;
    }
  }
  // Диагностика: если поток РАСПАКОВЫВАЕТСЯ в осмысленный билд, но Adler-32/round-trip
  // не сходится — байты изменены/потеряны в СЕРЕДИНЕ (DESYNC back-references). Такой код
  // выглядит «почти читаемым» с мусором в середине и не чинится локально: нужен оригинал.
  {
    let probe: Uint8Array | null = null;
    try {
      probe = unzlibSync(raw);
    } catch {
      probe = null;
    }
    if (_looksLikeBuild(probe)) {
      throw new PobCodeError(
        'import-код повреждён в СЕРЕДИНЕ (байты потеряны/заменены при копировании) — ' +
          'автовосстановление невозможно. Скопируйте код заново целиком (или поделитесь ссылкой pobb.in).',
      );
    }
  }
  throw new PobCodeError(
    'import-код повреждён — скопируйте ПОЛНЫЙ код (длинные коды часто обрезаются при вставке), ' +
      'или поделитесь ссылкой pobb.in/pastebin.',
  );
}

/** Одиночная попытка «сырого» inflate; null при ошибке. */
function _rawTry(blob: Uint8Array): Uint8Array | null {
  try {
    return inflateSync(blob);
  } catch {
    return null;
  }
}

/**
 * Проверка, что `out` — осмысленный билд И round-trip совпадает: повторно сжатый deflate
 * байт-в-байт равен исходному фрагменту. Отбрасывает повреждённые/обрезанные коды,
 * которые разжимаются в «мусор», похожий на билд.
 */
function _roundtripOk(out: Uint8Array | null | undefined, chunk: Uint8Array): boolean {
  if (!_looksLikeBuild(out)) return false;
  if (out.length > 64 * 1024 * 1024) return false; // защита от гигантского мусора
  try {
    const re = deflateSync(out as Uint8Array, { level: 9 });
    return re.length === chunk.length && (re.length === 0 || _eq(re, chunk));
  } catch {
    return false;
  }
}

function _eq(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Кодировать XML обратно в PoB share-код (для экспорта). Используем zlib-поток (RFC1950), как в PoB/PoB2. */
export function encodeShareCode(xml: string): string {
  const deflatedRaw = zlibSync(new TextEncoder().encode(xml), { level: 9 });
  // Настоящий PoB дополнительно срезает хвостовые 4 байта (Adler-32) перед base64.
  const raw = deflatedRaw.slice(0, Math.max(0, deflatedRaw.length - 4));
  let b64 = '';
  const bytes = Array.from(raw);
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    b64 += _b64[(a >> 2) & 0x3f];
    b64 += _b64[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    b64 += b === undefined ? '=' : _b64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    b64 += c === undefined ? '=' : _b64[c & 0x3f];
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

const _b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Классифицировать вход: ссылка или код. */
function isLink(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/** Сопоставить URL-ссылку с raw-эндпоинтом. */
function toRawUrl(url: string): string {
  const t = url.trim();
  const pb = _POBB.exec(t);
  if (pb) return `https://pobb.in/${pb[1]}/raw`;
  const pin = _PASTEBIN.exec(t);
  if (pin) return `https://pastebin.com/raw/${pin[1]}`;
  return t;
}

/** Скачать сырой PoB-код по ссылке. */
async function fetchCode(url: string, timeoutMs = 15000): Promise<string> {
  const rawUrl = toRawUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'poe2-kit/0.1.0' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new PobCodeError(`не удалось получить билд по ${rawUrl} (HTTP ${res.status})`);
    }
    return (await res.text()).trim();
  } catch (e) {
    if (e instanceof PobCodeError) throw e;
    throw new PobCodeError(`не удалось получить билд по ${rawUrl} (${String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}

/** Превратить любое содержимое ссылки в XML, толерантно к raw-эндпоинтам. */
function coerceToXml(content: string, origin: string): string {
  const c = (content || '').trim();
  if (!c) throw new PobCodeError(`ссылка ${origin} вернула пустой контент`);
  if (c.includes('PathOfBuilding') && c.indexOf('<') < 200) return c;
  const head = c.slice(0, 256).toLowerCase().replace(/^\s+/, '');
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head') || head.includes('<body')) {
    throw new PobCodeError(`ссылка ${origin} вернула HTML-страницу, а не PoB-код`);
  }
  return decodeShareCode(c);
}

/** Принять код ИЛИ ссылку и вернуть XML билда. */
export async function toXml(source: string): Promise<string> {
  const src = (source || '').trim();
  if (isLink(src)) {
    if (_PAGE_HOSTS.test(src)) {
      throw new PobCodeError('это страница-билда, а не сырой PoB-код. Вставьте код экспорта.');
    }
    return coerceToXml(await fetchCode(src), src);
  }
  return decodeShareCode(src);
}

// ─── Разбор форматов ────────────────────────────────────────────────────

/** Грубый парсер XML PoB (PoB1 и PoB2): класс, асcенданси, уровень, гемы, дерево, снаряжение. */
function parseBuildXml(xml: string): Partial<BuildImport> {
  if (xml.includes('<PathOfBuilding2')) return parseBuildXml2(xml);
  const get = (tag: string): string | undefined => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m?.[1]?.trim();
  };
  const asc = get('AscendancyName');
  const cls = get('ClassName') ?? get('AscendancyName');
  const levelRaw = get('characterLevel') ?? get('Level');
  const skillNames: string[] = [];
  const gemRe = /<Gem[^>]*>([\s\S]*?)<\/Gem>/g;
  let m: RegExpExecArray | null;
  while ((m = gemRe.exec(xml))) {
    const name = m[1].trim();
    if (name && !skillNames.includes(name)) skillNames.push(name);
  }
  const passives = (get('Tree') ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: Record<string, string> = {};
  const itemRe = /<Item[^>]*slot="([^"]*)"[^>]*>(?:<Name>([^<]*)<\/Name>)?[\s\S]*?<\/Item>/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(xml))) {
    if (im[1]) items[im[1]] = im[2]?.trim() ?? '';
  }

  return {
    class: cls,
    ascendancy: asc,
    level: levelRaw ? parseInt(levelRaw, 10) : undefined,
    skills: skillNames,
    passiveNodes: passives,
    gear: items,
  };
}

/** Парсер PoB2-формата (`<PathOfBuilding2>`): другие теги, атрибуты и вложенность. */
function parseBuildXml2(xml: string): Partial<BuildImport> {
  // <Build level="95" className="Monk" ascendClassName="Invoker" mainSocketGroup="4">
  const buildMatch = xml.match(/<Build\b([^>]*)>([\s\S]*?)<\/Build>/);
  const buildAttrs = _attrs(buildMatch?.[1] ?? '');
  const levelRaw = buildAttrs.level;
  const cls = buildAttrs.className;
  const asc = buildAttrs.ascendClassName;

  // Расчётные характеристики PoB — <PlayerStat stat="TotalDPS" value="449538..."/>.
  const stats: Record<string, number> = {};
  const psRe = /<PlayerStat\s+stat="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
  let pm: RegExpExecArray | null;
  while ((pm = psRe.exec(buildMatch?.[2] ?? ''))) {
    const v = parseFloat(pm[2]!);
    if (Number.isFinite(v)) stats[pm[1]!] = v;
  }

  // Скиллы — элементы <Gem ... nameSpec="..."/>. Предпочитаем «активный» сет (mainActiveSkill).
  const skills: string[] = [];
  const gemRe = /<Gem\b([^>]*)\/>/g;
  let gm: RegExpExecArray | null;
  while ((gm = gemRe.exec(xml))) {
    const a = _attrs(gm[1]!);
    const name = a.nameSpec ?? a.skillId ?? a.gemId;
    if (name && name !== 'nil' && !skills.includes(name)) skills.push(name);
  }

  // Дерево — <Tree><Spec nodes="id1,id2" .../></Tree>. Берём активный Spec (activeSpec 1-based).
  let passiveNodes: string[] = [];
  const treeEl = xml.match(/<Tree\b([^>]*)>([\s\S]*?)<\/Tree>/);
  if (treeEl) {
    const treeAttrs = _attrs(treeEl[1]!);
    const rawActiveSpec = Math.max(1, parseInt(treeAttrs.activeSpec, 10) || 1);
    const specs = [...treeEl[2]!.matchAll(/<Spec\b([^>]*)\/?>/g)].map((s) => _attrs(s[1]!));
    if (specs.length > 0) {
      const chosen = specs[Math.min(rawActiveSpec, specs.length) - 1] ?? specs[0]!;
      passiveNodes = (chosen.nodes ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // Снаряжение — пул <Item id=..><Name>..</Name>…</Item>, картируем через активный <ItemSet><Slot name=.. itemId=..>.
  const itemNames = new Map<string, string>();
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
  let itm: RegExpExecArray | null;
  while ((itm = itemRe.exec(xml))) {
    const attrs = _attrs(itm[1]!);
    const id = attrs.id ?? '';
    const name = itm[2]!.match(/<Name>([^<]*)<\/Name>/)?.[1]?.trim();
    if (id) itemNames.set(id, name ?? '');
  }
  const gear: Record<string, string> = {};
  // активный ItemSet (1-based activeItemSet) — его слоты <Slot name="Helm" itemId="3">
  const itemsEl = xml.match(/<Items\b([^>]*)>([\s\S]*?)<\/Items>/);
  if (itemsEl) {
    const itemsAttrs = _attrs(itemsEl[1]!);
    const itemSets = [
      ...itemsEl[2]!.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g),
    ].map((s) => ({
      attrs: _attrs(s[1]!),
      slots: s[2]!,
    }));
    let chosenSet: string | undefined;
    const rawActive = parseInt(itemsAttrs.activeItemSet, 10) || 1;
    if (itemSets.length > 0) {
      chosenSet = (itemSets[Math.min(rawActive, itemSets.length) - 1] ?? itemSets[0]!).slots;
    }
    const slotRe = /<Slot\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = slotRe.exec(chosenSet ?? ''))) {
      const a = _attrs(sm[1]!);
      const slotName = a.name;
      const itemId = a.itemId;
      if (slotName && itemId && itemId !== '0') {
        const nm = itemNames.get(itemId) ?? '';
        if (slotName in gear) continue; // первый выигрывает
        gear[slotName] = nm;
      }
    }
    // Подстраховка: если слотов нет, но есть именованные предметы — покажем их как есть.
    if (Object.keys(gear).length === 0) {
      for (const [id, nm] of itemNames) gear[id] = nm;
    }
  }

  return {
    class: cls,
    ascendancy: asc,
    level: levelRaw ? parseInt(levelRaw, 10) : undefined,
    skills,
    passiveNodes,
    gear,
    stats,
  };
}

/** Разобрать атрибуты XML-элемента `<a b="1" c/>` в объект (значения без кавычек). */
function _attrs(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"(.*?)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk))) out[m[1]!] = m[2] ?? '';
  return out;
}

/** Парсер официального .build JSON (Build Planner). */
function parseBuildJson(json: Record<string, unknown>): BuildImport {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const lvl = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v[0] as number | undefined;
    return undefined;
  };
  const passivesRaw = Array.isArray(json.passives) ? json.passives : [];
  const passiveNodes: string[] = [];
  for (const p of passivesRaw) {
    if (typeof p === 'string') passiveNodes.push(p);
    else if (p && typeof p === 'object') passiveNodes.push(String((p as { id?: unknown }).id ?? ''));
  }
  const skillsRaw = Array.isArray(json.skills) ? json.skills : [];
  const skills: string[] = [];
  for (const s of skillsRaw) {
    if (s && typeof s === 'object') {
      const id = (s as { id?: unknown }).id;
      if (id) skills.push(String(id));
    }
  }
  const items: Record<string, string> = {};
  const inv = Array.isArray(json.inventory_slots)
    ? json.inventory_slots
    : Array.isArray(json.items)
      ? json.items
      : [];
  for (const it of inv) {
    if (it && typeof it === 'object') {
      const o = it as { inventory_id?: unknown; unique_name?: unknown };
      if (o.inventory_id) items[String(o.inventory_id)] = o.unique_name ? String(o.unique_name) : '';
    }
  }
  return {
    source: 'build',
    class: str(json.className) ?? str(json.class) ?? str(json.ascendancy),
    ascendancy: str(json.ascendancy),
    level: lvl(json.level),
    skills,
    passiveNodes,
    gear: items,
    raw: json,
  };
}

/** Импортировать билд из кода/ссылки/сырого XML/.build JSON. */
export async function importBuild(input: string): Promise<BuildImport> {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return parseBuildJson(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      throw new Error('Не удалось разобрать .build JSON.');
    }
  }
  if (isLink(trimmed)) {
    const content = await fetchCode(trimmed);
    if (content.startsWith('{') && content.endsWith('}')) {
      return parseBuildJson(JSON.parse(content) as Record<string, unknown>);
    }
    const xml = coerceToXml(content, trimmed);
    return fromXml(xml);
  }
  // Код или сырой XML
  if (trimmed.includes('<PathOfBuilding') || trimmed.startsWith('<')) {
    return fromXml(trimmed);
  }
  const xml = decodeShareCode(trimmed);
  return fromXml(xml);
}

function fromXml(xml: string): BuildImport {
  const parsed = parseBuildXml(xml);
  return {
    source: 'pob',
    class: parsed.class,
    ascendancy: parsed.ascendancy,
    level: parsed.level,
    skills: parsed.skills ?? [],
    passiveNodes: parsed.passiveNodes ?? [],
    gear: parsed.gear ?? {},
    stats: parsed.stats,
    raw: { preview: xml.slice(0, 2000) },
  };
}

/**
 * Извлечь снаряжение билда с полным клир-текстом предметов (для прайс-чека).
 * Принимает share-код, сырой XML или ссылку на PoB.
 *
 * Возвращает по слотам активного ItemSet полный клир-текст каждого предмета —
 * ровно тот формат, который понимает `parseItemText`/`priceCheck`.
 * Предметы, текст которых не удалось распознать, пропускаются.
 */
export async function buildCodeToGear(input: string): Promise<BuildGearItem[]> {
  const trimmed = input.trim();
  let xml: string;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    // .build JSON (официальный Build Planner / mobalytics): уникальные имеют
    // unique_name (минимальный клир-текст Rarity: Unique), у остальных —
    // additional_text, где первая строка — базовый тип, дальше целевые аффиксы
    // («1. +33 to maximum Mana», …). Синтезируем клир-текст рара: прайс-чек
    // построит stat-фильтры по этим аффиксам (searchTradeByStats).
    const result: BuildGearItem[] = [];
    try {
      const json = JSON.parse(trimmed) as {
        inventory_slots?: Array<{
          inventory_id?: string;
          unique_name?: string;
          name?: string;
          additional_text?: string;
        }>;
        items?: Array<{
          inventory_id?: string;
          unique_name?: string;
          name?: string;
          additional_text?: string;
        }>;
      };
      const inv = json.inventory_slots ?? json.items ?? [];
      for (const it of inv) {
        const slot = it.inventory_id ?? '';
        const uname = it.unique_name;
        if (uname) {
          const base = it.name ?? '';
          const itemText = [
            'Rarity: Unique',
            uname,
            base || 'Unknown',
            '--------',
          ].join('\n');
          result.push({ slot, name: uname, itemText });
          continue;
        }
        const add = it.additional_text;
        if (add) {
          const lines = add.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.length) continue;
          const base = lines[0];
          const mods = lines.slice(1).map((l) => l.replace(/^\d+\.\s*/, ''));
          const itemText = [
            'Rarity: Rare',
            `${base} (build target)`,
            base,
            '--------',
            ...mods,
          ].join('\n');
          result.push({ slot, name: base, itemText });
        }
      }
      return result;
    } catch {
      return [];
    }
  }
  if (trimmed.includes('<PathOfBuilding') || trimmed.startsWith('<')) {
    xml = trimmed;
  } else if (isLink(trimmed)) {
    xml = await toXml(trimmed);
  } else {
    xml = decodeShareCode(trimmed);
  }

  const items: BuildGearItem[] = [];

  // Пул предметов: id → клир-текст (до первого вложенного тега <ModRange/> и т.п.)
  const itemTextById = new Map<string, string>();
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const attrs = _attrs(m[1]!);
    if (!attrs.id) continue;
    const raw = m[2]!;
    // клир-текст — это всё до первого вложенного `<`-тега (ModRange и прочее)
    const lt = raw.indexOf('</');
    const text = (lt >= 0 ? raw.slice(0, lt) : raw).trim();
    if (text) itemTextById.set(attrs.id, text);
  }

  // Активные слоты через активный ItemSet
  const itemsEl = xml.match(/<Items\b([^>]*)>([\s\S]*?)<\/Items>/);
  if (itemsEl) {
    const itemsAttrs = _attrs(itemsEl[1]!);
    const itemSets = [
      ...itemsEl[2]!.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g),
    ].map((s) => ({ attrs: _attrs(s[1]!), slots: s[2]! }));
    const rawActive = parseInt(itemsAttrs.activeItemSet, 10) || 1;
    const chosen =
      itemSets.length > 0
        ? (itemSets[Math.min(rawActive, itemSets.length) - 1] ?? itemSets[0]!).slots
        : '';
    const seen = new Set<string>();
    const slotRe = /<Slot\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = slotRe.exec(chosen))) {
      const a = _attrs(sm[1]!);
      const slot = a.name ?? '';
      const itemId = a.itemId ?? '';
      if (!itemId || itemId === '0') continue;
      const text = itemTextById.get(itemId);
      if (!text || seen.has(itemId)) continue;
      seen.add(itemId);
      const parsedName = text.match(/^Rarity:[^\n]*\n([^\n]+)/m)?.[1]?.trim() ?? '';
      items.push({ slot, name: parsedName, itemText: text });
    }
    // Подстраховка: если слотов не оказалось — возьмём все распознанные предметы.
    if (items.length === 0) {
      for (const [id, text] of itemTextById) {
        const parsedName = text.match(/^Rarity:[^\n]*\n([^\n]+)/m)?.[1]?.trim() ?? '';
        items.push({ slot: '', name: parsedName, itemText: text });
      }
    }
  }

  return items;
}

/** Простые метрики билда (детально — через MCP/AI). */
export function summarizeBuild(build: BuildImport): string {
  const skills = build.skills.length ? build.skills.slice(0, 3).join(', ') : 'не указаны';
  const nodes = build.passiveNodes.length;
  const gearEntries = Object.keys(build.gear ?? {}).length;
  const st = build.stats ?? {};
  const dps = st.TotalDPS ?? st.CombinedDPS;
  const life = st.Life ?? st['_Life'] ?? st['LifeUnreservedMax'];
  const es = st['EnergyShield'] ?? st['_EnergyShield'];
  const lines = [
    `Класс: ${build.class ?? '?'}${build.ascendancy ? ` (${build.ascendancy})` : ''}`,
    `Уровень: ${build.level ?? '?'}`,
    `Основные скиллы: ${skills}`,
    `Узлов дерева: ${nodes}`,
    `Слотов снаряжения: ${gearEntries}`,
  ];
  if (dps !== undefined) lines.push(`DPS: ${Math.round(dps).toLocaleString('ru-RU')}`);
  if (life !== undefined) lines.push(`Жизнь: ${Math.round(life).toLocaleString('ru-RU')}`);
  if (es !== undefined) lines.push(`Щит энергии: ${Math.round(es).toLocaleString('ru-RU')}`);
  return lines.join('\n');
}