/**
 * Анализ и импорт билдов.
 * Поддерживает:
 *  - декодирование PoB share-кодов: urlsafe(base64(zlib(xml))) с восстановлением Adler-32
 *  - ссылки pobb.in / pastebin
 *  - сырой .build JSON (официальный формат Build Planner)
 * Полный расчёт DPS/EHP полагается на внешний движок (PoB), доступный через MCP.
 */

import { deflateSync, inflateSync } from 'fflate';
import type { BuildImport } from './types.js';

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
 * Формат: urlsafe(base64(zlib(xml))) — +→-, /→_, убираем пробелы, восстанавливаем padding.
 * При ошибке Adler-32 (потеряны последние символы) повторяем без проверки чек-суммы.
 */
export function decodeShareCode(code: string): string {
  if (!code || !code.trim()) throw new PobCodeError('пустой import-код');
  const s0 = code.replace(_WS, '').replace(/-/g, '+').replace(/_/g, '/');
  const s = s0 + '='.repeat((-s0.length) % 4); // восстановить padding

  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    throw new PobCodeError('невалидный base64 в import-коде');
  }

  let xml: Uint8Array;
  try {
    xml = inflateSync(raw);
  } catch {
    // Потерянные последние символы ломают Adler-32, при этом deflate-тело цело.
    // Восстанавливаем декомпрессией без последних 4 байт (чек-сумма).
    try {
      xml = inflateSync(raw.subarray(0, raw.length - 4));
    } catch {
      throw new PobCodeError(
        'import-код повреждён — скопируйте ПОЛНЫЙ код (длинные коды часто обрезаются при вставке), ' +
          'или поделитесь ссылкой pobb.in/pastebin.',
      );
    }
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(xml);
  if (!text.includes('PathOfBuilding')) {
    throw new PobCodeError(
      'раскодированные данные — не билд Path of Building. Перекопируйте полный код.',
    );
  }
  return text;
}

/** Кодировать XML обратно в PoB share-код (для экспорта). */
export function encodeShareCode(xml: string): string {
  const raw = deflateSync(new TextEncoder().encode(xml), { level: 9 });
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

/** Грубый парсер XML PoB: извлекает класс, асcенданси, уровень, гемы, дерево. */
function parseBuildXml(xml: string): Partial<BuildImport> {
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
    raw: { preview: xml.slice(0, 2000) },
  };
}

/** Простые метрики билда (детально — через MCP/PoB). */
export function summarizeBuild(build: BuildImport): string {
  const skills = build.skills.length ? build.skills.slice(0, 3).join(', ') : 'не указаны';
  const nodes = build.passiveNodes.length;
  const gearEntries = Object.keys(build.gear ?? {}).length;
  return [
    `Класс: ${build.class ?? '?'}${build.ascendancy ? ` (${build.ascendancy})` : ''}`,
    `Уровень: ${build.level ?? '?'}`,
    `Основные скиллы: ${skills}`,
    `Узлов дерева: ${nodes}`,
    `Слотов снаряжения: ${gearEntries}`,
  ].join('\n');
}