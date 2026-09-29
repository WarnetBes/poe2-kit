/**
 * Оптимизированный декодер/энкодер PoB share-кодов.
 *
 * Формат: urlsafe(base64(deflate-stream(xml))), где PoB срезает хвостовую
 * Adler-32 перед base64 («zlib-заголовок + сырой deflate»).
 *
 * Отличия от старой реализации (build.ts, до 5788a93+):
 *  - base64: один LUT-проход в предвыделенный Uint8Array (was: atob + Uint8Array.from(cb));
 *  - кандидаты по вероятности: сначала PoB-формат (zlib header, deflate без Adler),
 *    повторное deflate-9-сжатие для round-trip — ТОЛЬКО для победителя (было: на каждого
 *    кандидата, включая цикл починки хвоста 48×2 ≈ до 96 лишних сжатий);
 *  - LRU-кэш декодированного XML: один импорт в оверлее гоняет один и тот же код
 *    через importBuild/buildCodeToGear/buildGemSetups — теперь распаковка один раз;
 *  - гарантии без изменений: битые коди НЕ декодируются молча — Adler-32 или
 *    byte-точный round-trip, иначе внятная ошибка (середина/хвост).
 */

import { deflateSync, inflateSync, unzlibSync, zlibSync } from 'fflate';

/** Ошибка при работе с PoB-кодами. */
export class PobCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PobCodeError';
  }
}

const _WS = /\s+/g;
const _STRIP = /["'«»„“”`]/g;

// ─── base64: LUT-декод, один проход, без atob ────────────────────────────────

const _B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const _LUT = new Int16Array(256).fill(-1);
for (let i = 0; i < _B64_STD.length; i++) _LUT[_B64_STD.charCodeAt(i)] = i;

/** Одиночная попытка «сырого» inflate; null при ошибке. */
function _rawTry(blob: Uint8Array): Uint8Array | null {
  try {
    return inflateSync(blob);
  } catch {
    return null;
  }
}

/** Раскодировать urlsafe-base64 в байты: один проход, предвыделенный буфер. */
function _b64ToBytes(code: string): Uint8Array {
  const s0 = code.replace(_WS, '').replace(_STRIP, '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = '===='.slice(0, (4 - (s0.length % 4)) % 4);
  const s = s0 + pad;

  const outLen = Math.floor(s.length / 4) * 3 - pad.length;
  let bad = -1;
  for (let i = 0; i < s0.length; i++) {
    const c = s0.charCodeAt(i);
    if (c > 255 || _LUT[c] < 0) {
      bad = i;
      break;
    }
  }
  if (bad >= 0) {
    const ch = s0[bad]!;
    const ctx = ` (символ "${ch}", код U+${ch.codePointAt(0)!.toString(16)}, позиция ${bad}, контекст "${s0.slice(Math.max(0, bad - 12), bad + 12)}")`;
    throw new PobCodeError(`невалидный base64 в import-коде: длина ${s0.length}${bad === s0.length - 1 ? ', мусор в конце' : ''}${ctx}`);
  }

  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i + 4 <= s.length; i += 4) {
    const a = _LUT[s.charCodeAt(i)];
    const b = _LUT[s.charCodeAt(i + 1)];
    const c = _LUT[s.charCodeAt(i + 2)];
    const d = _LUT[s.charCodeAt(i + 3)];
    if (a < 0 || b < 0) throw new PobCodeError('невалидный base64 в import-коде');
    out[o++] = (a << 2) | (b >> 4);
    const ch3 = s[i + 2];
    if (ch3 !== '=') {
      if (c < 0) throw new PobCodeError('невалидный base64 в import-коде');
      out[o++] = ((b & 0x0f) << 4) | (c >> 2);
      if (s[i + 3] !== '=') {
        if (d < 0) throw new PobCodeError('невалидный base64 в import-коде');
        out[o++] = ((c & 0x03) << 6) | d;
      }
    }
  }
  return out.subarray(0, o);
}

// ─── проверки кандидатов ─────────────────────────────────────────────────────

/** Осмысленный ли билд: UTF-8-декод + '<' в начале + маркер PathOfBuilding. */
function _looksLikeBuild(b: Uint8Array | null | undefined): b is Uint8Array {
  if (!b || b.length < 20) return false;
  const t = new TextDecoder('utf-8', { fatal: false }).decode(b);
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

/** Распаковать zlib (RFC1950), если встроенная Adler-32 сходится. */
function _unzlibVerified(zraw: Uint8Array): Uint8Array | null {
  if (zraw.length < 6) return null;
  try {
    const out = unzlibSync(zraw);
    const stored =
      ((zraw[zraw.length - 4]! << 24) | (zraw[zraw.length - 3]! << 16) | (zraw[zraw.length - 2]! << 8) | zraw[zraw.length - 1]!) >>> 0;
    return stored === _adler32(out) ? out : null;
  } catch {
    return null;
  }
}

function _eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Финальная верификация победителя: round-trip — повторное сжатие deflate-9
 * байт-в-байт совпадает с исходным куском. Гарантия против «мусора, похожего
 * на билд». Платится ОДИН раз на успешный декод (не на каждого кандидата).
 */
function _roundtripOk(out: Uint8Array, chunk: Uint8Array): boolean {
  if (!_looksLikeBuild(out)) return false;
  if (out.length > 64 * 1024 * 1024) return false;
  try {
    const re = deflateSync(out, { level: 9 });
    return re.length === chunk.length && (re.length === 0 || _eq(re, chunk));
  } catch {
    return false;
  }
}

/** Валидный ли zlib-заголовок RFC1950 (CM=deflate, checksum кратен 31). */
function _zlibHeader(b: Uint8Array): boolean {
  return b.length > 2 && (b[0]! & 0x0f) === 0x08 && (((b[0]! << 8) | b[1]!) % 31) === 0;
}

/**
 * Распаковать байты кода в XML. Порядок — по вероятности в реальных данных:
 *  1. PoB-формат: zlib-заголовок + deflate БЕЗ Adler (экспорт PoB её срезает);
 *  2. целый zlib-поток с Adler;
 *  3. «сырой» deflate без заголовка;
 *  4. починка хвоста (1..48 лишних/битых байт) — только inflate+структура,
 *     deflate-верификация уникальных пре-кандидатов;
 *  5. диагностика: распаковывается «похоже на билд», но round-trip не сходится —
 *     байт потеряны в СЕРЕДИНЕ, локально не чинится.
 */
function _tryInflate(raw: Uint8Array): Uint8Array {
  // 1+2. zlib-заголовок: сначала PoB-вариант без Adler (самый частый).
  if (_zlibHeader(raw) && raw.length > 8) {
    const body = raw.subarray(2);
    let r = _rawTry(body);
    if (r) {
      if (_roundtripOk(r, body)) return r;
      r = null; // композиция «заголовок+deflate» не подтвердилась
    }
    const v = _unzlibVerified(raw);
    if (v && _looksLikeBuild(v)) return v;
  } else {
    // 3. сырой deflate без заголовка.
    const r = _rawTry(raw);
    if (r && _roundtripOk(r, raw)) return r;
  }

  // 4. хвост: лишние/битые байты в конце. Прогоняем inflate по усечённым
  // вариантам; deflate-9 верификация — только когда inflate дал осмысленный
  // билд (кандидаты редкие, обычно 0–2).
  for (let trim = 1; trim <= 48; trim++) {
    if (raw.length - trim <= 4) break;
    const clipped = raw.subarray(0, raw.length - trim);
    const probes = _zlibHeader(clipped) && clipped.length > 8 ? [clipped.subarray(2), clipped] : [clipped];
    for (const chunk of probes) {
      const r = _rawTry(chunk);
      if (r && _looksLikeBuild(r)) {
        if (_roundtripOk(r, chunk)) return r;
        return _midCorruption();
      }
    }
  }

  // 5. середина: поток разжимается «в билд», но round-trip не сходится.
  {
    let probe: Uint8Array | null = null;
    if (_zlibHeader(raw)) probe = _rawTry(raw.subarray(2)) ?? (() => { try { return unzlibSync(raw); } catch { return null; } })();
    else probe = _rawTry(raw);
    if (_looksLikeBuild(probe)) return _midCorruption();
  }
  throw new PobCodeError(
    'import-код повреждён — скопируйте ПОЛНЫЙ код (длинные коды часто обрезаются при вставке), ' + 'или поделитесь ссылкой pobb.in/pastebin.',
  );
}

function _midCorruption(): never {
  throw new PobCodeError(
    'import-код повреждён в СЕРЕДИНЕ (байты потеряны/заменены при копировании) — ' +
      'автовосстановление невозможно. Скопируйте код заново целиком (или поделитесь ссылкой pobb.in).',
  );
}

// ─── LRU-кэш: тот же код → тот же XML без повторной распаковки ───────────────

const _CACHE_MAX = 8;
const _cache = new Map<string, string>();

export function clearPobCodeCache(): void {
  _cache.clear();
}

// ─── публичный API ──────────────────────────────────────────────────────────

/** Декодировать PoB share-код в XML билда. Кэш LRU по коду (импорт гоняет код 3–4×). */
export function decodeShareCode(code: string): string {
  if (!code || !code.trim()) throw new PobCodeError('пустой import-код');
  const hit = _cache.get(code);
  if (hit !== undefined) {
    // LRU: обновить свежесть
    _cache.delete(code);
    _cache.set(code, hit);
    return hit;
  }
  const raw = _b64ToBytes(code);
  const xmlBytes = _tryInflate(raw);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
  if (!text.includes('PathOfBuilding')) {
    throw new PobCodeError('раскодированные данные — не билд Path of Building. Перекопируйте полный код.');
  }
  if (_cache.size >= _CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(code, text);
  return text;
}

/** Кодировать XML в PoB share-код (urlsafe base64, Adler-32 срезана, как в PoB). */
export function encodeShareCode(xml: string): string {
  // zlib-поток (RFC1950: заголовок + deflate + Adler-32), как в PoB; Adler срезаем перед base64.
  const deflatedRaw = zlibSync(new TextEncoder().encode(xml), { level: 9 });
  const raw = deflatedRaw.subarray(0, Math.max(0, deflatedRaw.length - 4));
  let b64 = '';
  const n = raw.length;
  const tail = n % 3;
  const whole = n - tail;
  for (let i = 0; i < whole; i += 3) {
    const a = raw[i]!;
    const b = raw[i + 1]!;
    const c = raw[i + 2]!;
    b64 += _B64_STD[(a >> 2) & 0x3f] + _B64_STD[((a & 0x03) << 4) | (b >> 4)] + _B64_STD[((b & 0x0f) << 2) | (c >> 6)] + _B64_STD[c & 0x3f];
  }
  if (tail === 1) {
    const a = raw[whole]!;
    b64 += _B64_STD[(a >> 2) & 0x3f] + _B64_STD[(a & 0x03) << 4] + '==';
  } else if (tail === 2) {
    const a = raw[whole]!;
    const b = raw[whole + 1]!;
    b64 += _B64_STD[(a >> 2) & 0x3f] + _B64_STD[((a & 0x03) << 4) | (b >> 4)] + _B64_STD[(b & 0x0f) << 2] + '=';
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}
