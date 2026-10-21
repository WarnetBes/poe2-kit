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

import { unzlibSync } from 'fflate';

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
    const src = (y + 1) * (1 + stride);
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
