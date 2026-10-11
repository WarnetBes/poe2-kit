import { describe, expect, it } from 'vitest';
import { normRuEnKey, ruEnLocaleMeta, ruToEnBase, ruToEnName } from '../src/ruLocale.js';

describe('ruLocale (items_ru.json, Exiled Exchange 2 MIT)', () => {
  it('датасет загружен и метаданные на месте', () => {
    const meta = ruEnLocaleMeta();
    // Датасет (built 2026-10-08): 2287 item / 766 unique / 861 gem строк.
    // В map меньше: пустые и ru===en (в RU-клиенте часть имён не переведена) отфильтрованы.
    expect(meta.items).toBeGreaterThan(2200);
    expect(meta.uniques).toBeGreaterThan(400);
    expect(meta.gems).toBeGreaterThan(800);
    expect(meta.source).toContain('Exiled-Exchange-2');
    expect(meta.built).toBe('2026-10-08');
  });

  it('уник: «Адская пряжка» → Infernoclasp', () => {
    expect(ruToEnName('Адская пряжка')).toBe('Infernoclasp');
  });

  it('база: «Абордажная сабля» → Cutlass; ruToEnBase отдельно от имени', () => {
    expect(ruToEnName('Абордажная сабля')).toBe('Cutlass');
    expect(ruToEnBase('Абордажная сабля')).toBe('Cutlass');
  });

  it('нормализация ключа: ё→е, й→и, диакритика, апострофы, lowercase', () => {
    expect(normRuEnKey('Ёлка Йожная ... ')).toBe('елка иожная ...');
    expect(normRuEnKey("Oisín's")).toBe('oisins');
  });

  it('lookup безболезненно к регистру/й-вариантам poe2db', () => {
    const ru = ruToEnName('Адская пряжка');
    expect(ru).not.toBe('');
    // Тот же ключ с «й»-заменой и верхним регистром должен резолвиться одинаково.
    const alt = ruToEnName('АДСкая прЯжка');
    expect(alt).toBe(ru);
  });

  it('промах → пустая строка (НЕ identity): вызывающий решает фолбэк', () => {
    expect(ruToEnName('Такого предмета нет')).toBe('');
    expect(ruToEnName('')).toBe('');
    expect(ruToEnName(null)).toBe('');
    expect(ruToEnBase('Такой базы нет')).toBe('');
  });

  it('EN-имена как вход — не ломают API (возвращают пусто, не мусор)', () => {
    expect(ruToEnName('Cutlass')).toBe('');
  });
});
