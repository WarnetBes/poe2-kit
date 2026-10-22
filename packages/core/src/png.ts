/**
 * png.ts — минимальный PNG-декодер (№584 «Ritual-прайсинг»).
 *
 * Нужен core-распознаванию (этапы 1–3): якорь окна Ritual, иконки каталога.
 * Новых зависимостей нет: zlib-контейнеры распаковывает уже используемый
 * `fflate` (unzlibSync). Датасет проекта проверен: все PNG — 8 бит/канал
 * (IHDR: bitDepth=8), без interlace — формат poe2db/poecdn стабилен.
 *
 * Поддержка: colorType 0 (gray), 2 (RGB), 3 (palette + tRNS), 4 (gray+alpha),
 * 6 (RGBA). 16 бит и Adam7 НЕ поддерживаются — при встрече честный бросок.
 *
 * Выход всегда RGBA32 (даже gray/palette), чтобы потребитель имел один формат.
 */

import { unzlibSync, zlibSync } from 'fflate';

export interface RgbaImage {
  width: number;
  height: number;
  /** Оригинальный PNG colorType (0/2/3/4/6) — донор строит референсы только из RGBA (6). */
  colorType: number;
  /** RGBA, по 4 байта на пиксель, длина = width*height*4. */
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Кросс-платформенное чтение байтов (Buffer в Node — тоже Uint8Array). */
export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++)
    if (bytes[i] !== SIGNATURE[i]) throw new Error('png: не PNG-подпись');

  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = -1,
    interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  let p = 8;
  while (p < bytes.length) {
    const len = readU32(bytes, p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    p += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`png: bitDepth=${bitDepth} не поддерживается`);
  if (interlace !== 0) throw new Error('png: interlace (Adam7) не поддерживается');
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (!(colorType in channels)) throw new Error(`png: colorType=${colorType} не поддерживается`);
  if (colorType === 3 && !palette) throw new Error('png: palette без PLTE');
  if (width <= 0 || height <= 0 || width * height > 64e6) throw new Error('png: подозрительные размеры');

  const ch = channels[colorType];
  const bpp = ch; // bitDepth=8 → байт на канал
  const raw = unzlibSync(concat(idat), { out: new Uint8Array(height * (1 + width * ch)) });
  if (raw.length < height * (1 + width * ch)) throw new Error('png: IDAT короче ожидаемого');

  // Разфильтровка построчно (PNG spec, фильтры 0–4).
  const stride = width * ch;
  const lines = new Uint8Array(height * stride);
  let prev = 0; // оффсет предыдущей строки в lines
  for (let y = 0; y < height; y++) {
    const f = raw[y * (1 + stride)];
    const rowOff = y * stride;
    const src = y * (1 + stride) + 1; // ❗ №585: было (y+1)*(1+stride) — каждая строка читалась как следующая, сдвинутая на байт, последняя — за границей (нули). Тесты якоря были self-referential (кадр строился тем же битым decode) и баг маскировался; живой GDI-кадр не совпадал с шаблоном никогда.
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const left = x >= bpp ? lines[rowOff + x - bpp] : 0;
      const up = y > 0 ? lines[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? lines[prev + x - bpp] : 0;
      let v: number;
      switch (f) {
        case 0: v = cur; break;
        case 1: v = cur + left; break;
        case 2: v = cur + up; break;
        case 3: v = cur + ((left + up) >> 1); break;
        case 4: {
          const pa = Math.abs(up - upLeft),
            pb = Math.abs(left - upLeft);
          v = cur + (pa <= pb && pa <= Math.abs(left - up) ? left : pb <= Math.abs(left - up) ? up : upLeft);
          break;
        }
        default: throw new Error(`png: неизвестный фильтр ${f}`);
      }
      lines[rowOff + x] = v & 0xff;
    }
    prev = rowOff;
  }

  // → RGBA.
  const out = new Uint8Array(width * height * 4);
  const setPx = (i: number, r: number, g: number, b: number, a: number) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  };
  for (let i = 0; i < width * height; i++) {
    switch (colorType) {
      case 0: {
        const v = lines[i];
        setPx(i, v, v, v, 255);
        break;
      }
      case 2:
        setPx(i, lines[i * 3], lines[i * 3 + 1], lines[i * 3 + 2], 255);
        break;
      case 3: {
        const idx = lines[i];
        if (idx * 3 + 2 >= palette!.length) throw new Error('png: индекс вне PLTE');
        const a = trns && idx < trns.length ? trns[idx] : 255;
        setPx(i, palette![idx * 3], palette![idx * 3 + 1], palette![idx * 3 + 2], a);
        break;
      }
      case 4: {
        const v = lines[i * 2];
        setPx(i, v, v, v, lines[i * 2 + 1]);
        break;
      }
      case 6:
        setPx(i, lines[i * 4], lines[i * 4 + 1], lines[i * 4 + 2], lines[i * 4 + 3]);
        break;
    }
  }
  return { width, height, colorType, data: out };
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** RGBA → BGRA in place-копия (раскладка экранного кадра GetDIBits и донорного Mat). */
export function rgbaToBgra(img: RgbaImage): RgbaImage {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    d[i] = d[i + 2];
    d[i + 2] = r;
  }
  return img;
}

// ─── Минимальный энкодер (№585-диагностика: дамп кадра при отказе якоря) ──────

/** BGRA-кадр (GetDIBits/раскладка core) → PNG (colorType 6, filter 0). */
export function encodePngBgra(width: number, height: number, bgra: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  // построчная копия с BGRA→RGBA
  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (1 + stride) + 1;
    for (let x = 0; x < width; x++) {
      raw[dst + x * 4] = bgra[src + x * 4 + 2];
      raw[dst + x * 4 + 1] = bgra[src + x * 4 + 1];
      raw[dst + x * 4 + 2] = bgra[src + x * 4];
      raw[dst + x * 4 + 3] = bgra[src + x * 4 + 3];
    }
  }
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 6; // RGBA
  const idat = zlibSync(raw);
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12 + 12);
  let p = 0;
  out.set(SIGNATURE, p);
  p += 8;
  p = chunk(out, p, 'IHDR', ihdr);
  p = chunk(out, p, 'IDAT', idat);
  p = chunk(out, p, 'IEND', new Uint8Array(0));
  return out.subarray(0, p);
}

function chunk(out: Uint8Array, p: number, type: string, data: Uint8Array): number {
  writeU32(out, p, data.length);
  for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
  out.set(data, p + 8);
  const crc = crc32(type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3), data);
  writeU32(out, p + 8 + data.length, crc);
  return p + 12 + data.length;
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

let crcTable: Uint32Array | null = null;

function crc32(a: number, b: number, c: number, d: number, data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      crcTable[n] = v >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const v of [a, b, c, d]) crc = crcTable[(crc ^ v) & 0xff]! ^ (crc >>> 8);
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
