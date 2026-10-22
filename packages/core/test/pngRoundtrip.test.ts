/**
 * Регрессионный №585: decodePng читал строку y с офсета (y+1)*(1+stride) —
 * каждая строка декодировалась как следующая, сдвинутая на байт, последняя
 * уходила за границу (нули). Тесты якоря были self-referential (кадр строился
 * тем же битым decode) и маскировали баг; живой GDI-кадр с шаблоном не
 * совпадал никогда (ritual: якорь tribute-bar не совпал при t=1.3-1.9 c).
 *
 * Гоняет связку encodePngBgra → decodePng: пока decode был бит, закодированный
 * кадр декодировался в нули.
 */
import { describe, expect, it } from 'vitest';
import { decodePng, encodePngBgra } from '../src/png.js';

describe('png round-trip (№585: off-by-stride bug)', () => {
  it('многострочный BGRA-кадр декодируется попиксельно верно', () => {
    const w = 17;
    const h = 9;
    const bgra = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        bgra[i] = (x * 14) & 0xff; // B
        bgra[i + 1] = (y * 25) & 0xff; // G
        bgra[i + 2] = 200; // R
        bgra[i + 3] = 255;
      }
    const back = decodePng(encodePngBgra(w, h, bgra));
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // BGRA → RGBA
        expect(back.data[i]).toBe(bgra[i + 2]);
        expect(back.data[i + 1]).toBe(bgra[i + 1]);
        expect(back.data[i + 2]).toBe(bgra[i]);
        expect(back.data[i + 3]).toBe(255);
      }
  });

  it('последняя строка не нулевая (за границу decode не ходит)', () => {
    const w = 4;
    const h = 3;
    const bgra = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) bgra[i * 4 + 2] = 77; // R=77 везде
    const back = decodePng(encodePngBgra(w, h, bgra));
    for (let i = 0; i < w; i++) {
      const px = (h - 1) * w + i;
      expect(back.data[px * 4]).toBe(77); // Decode хвост
    }
  });
});
