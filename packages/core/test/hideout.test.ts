import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHideout,
  summarizeHideout,
  classifyDecor,
  loadDecorIndex,
  clearDecorIndexCache,
  encodeHideoutCode,
  decodeHideoutCode,
  formatHideoutPost,
  HIDEOUT_DECOR_LIMIT,
  HideoutParseError,
} from '../src/hideout.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hideout');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('parseHideout', () => {
  it('разбирает реальный PoE2-файл (Shoreline, POH id 69) с BOM', () => {
    const parsed = parseHideout(fixture('shoreline_poe2.hideout'));
    // ✅ Сверено с файлом: base, hash, 37 doodads, первым объектом Stash.
    expect(parsed.hideoutName).toBe('Shoreline Hideout');
    expect(parsed.hideoutHash).toBe(4638);
    expect(parsed.doodads).toHaveLength(37);
    expect(parsed.doodads[0]).toMatchObject({ name: 'Stash', hash: 3230065491, x: 533, y: 460, r: 63630, fv: 0 });
    expect(parsed.warnings).toHaveLength(0);
  });

  it('разбирает PoE2-файл с music_name/music_hash (POH id 31)', () => {
    const parsed = parseHideout(fixture('vastiri_poe2.hideout'));
    expect(parsed.hideoutName).toBe('Vastiri Racecourse Hideout');
    expect(parsed.doodads).toHaveLength(79);
    // trained has 128+ fv flags (variant bit hypothesis); we don't reject them.
    expect(parsed.doodads.some((d) => (d.fv ?? 0) >= 128)).toBe(true);
  });

  it('разбирает PoE1-файл (Sovereign, id 126) — формат общий', () => {
    const parsed = parseHideout(fixture('sovereign_poe1.hideout'));
    expect(parsed.hideoutName).toBe('The Sovereign Hideout');
    expect(parsed.hideoutHash).toBe(47588);
    expect(parsed.doodads).toHaveLength(43);
  });

  it('собирает warning на битой записи и неизвестных полях, но не падает', () => {
    const text = JSON.stringify({
      version: 1, hideout_name: 'X', hideout_hash: 1,
      future_field: 123,
      doodads: {
        'Good': { hash: 1, x: 0, y: 0, r: 0 },
        'Bad': 'not-an-object',
        'Worse': { hash: 2 },
      },
    });
    const parsed = parseHideout(text);
    expect(parsed.doodads).toHaveLength(1);
    expect(parsed.warnings.some((w) => w.includes('Bad'))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes('Worse'))).toBe(true);
    expect(parsed.extraTopLevel).toContain('future_field');
  });

  it('отклоняет мусор (никакого молчаливого успеха)', () => {
    expect(() => parseHideout('')).toThrow(HideoutParseError);
    expect(() => parseHideout('not json at all')).toThrow(HideoutParseError);
    expect(() => parseHideout('[]')).toThrow(HideoutParseError);
    expect(() => parseHideout(JSON.stringify({ version: 1, doodads: {} }))).toThrow(/hideout_name/);
    expect(() => parseHideout(JSON.stringify({ hideout_name: 'X', hideout_hash: 'n', doodads: {} }))).toThrow(/hideout_hash/);
    expect(() => parseHideout(JSON.stringify({ hideout_name: 'X', hideout_hash: 1, doodads: { a: 'b' } }))).toThrow(/ни одной валидной/);
  });
});

describe('classifyDecor + датасет', () => {
  it('датасет классифицирует функциональные объекты как free', () => {
    const idx = loadDecorIndex();
    expect(classifyDecor('Stash', idx).category).toBe('free');
    expect(classifyDecor('Ziggurat Map Device', idx).category).toBe('free');
  });

  it('косметические варианты (Divine Tinker\'s Waypoint) — store-mtx', () => {
    const idx = loadDecorIndex();
    expect(classifyDecor("Divine Tinker's Waypoint", idx).category).toBe('store-mtx');
    // той же эвристикой — даже без датасета
    expect(classifyDecor("Bronze Timekeeper's Map Device").category).toBe('store-mtx');
    expect(classifyDecor("Bronze Timekeeper's Map Device").source).toBe('heuristic-possessive');
  });

  it('честный unknown: категория не выдумывается', () => {
    expect(classifyDecor('Absolutely Unknown Tree').category).toBe('unknown');
    expect(classifyDecor("Someone's Unknown Gadget").category).toBe('unknown');
  });

  it('round-trip датасета: файл reader стабилен', () => {
    clearDecorIndexCache();
    expect(Object.keys(loadDecorIndex()).length).toBeGreaterThan(100);
  });
});

describe('summarizeHideout', () => {
  it('агрегирует размещения по именам и считает лимит', () => {
    const parsed = parseHideout(fixture('shoreline_poe2.hideout'));
    const sum = summarizeHideout(parsed, { decorIndex: loadDecorIndex() });
    expect(sum.totalPlacements).toBe(37);
    expect(sum.uniqueDecor).toBeLessThanOrEqual(37);
    expect(sum.decor.reduce((a, s) => a + s.count, 0)).toBe(37);
    expect(sum.limit).toBe(HIDEOUT_DECOR_LIMIT);
    expect(sum.overLimit).toBe(false);
    // Stash в топе имеет count 1; сортировка по count desc
    expect(sum.decor[0]!.count).toBeGreaterThanOrEqual(sum.decor[1]!.count);
    // ✅ Файл: 8 записей Stash/Guild Stash/Waypoint/... — 8 функциональных free имен в файле
    expect(sum.byCategory['free']).toBeGreaterThan(0);
  });

  it('детектит превышение лимита 750', () => {
    const doodads = Array.from({ length: 751 }, (_, i) => ({ name: `Tree ${i}`, hash: i, x: 0, y: 0, r: 0, fv: 0 }));
    const sum = summarizeHideout({ version: null, language: null, hideoutName: 'X', hideoutHash: 1, doodads, extraTopLevel: [], warnings: [] });
    expect(sum.overLimit).toBe(true);
    expect(sum.totalPlacements).toBe(751);
  });
});

describe('share-код', () => {
  it('round-trip encode→decode без потерь', () => {
    const parsed = parseHideout(fixture('vastiri_poe2.hideout'));
    const code = encodeHideoutCode(parsed);
    expect(code).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const back = decodeHideoutCode(code);
    expect(back.hideoutName).toBe(parsed.hideoutName);
    expect(back.musicName).toBe(parsed.musicName);
    expect(back.doodads).toEqual(parsed.doodads);
  });

  it('битый код отклоняется (без молчаливого мусора)', () => {
    expect(() => decodeHideoutCode('')).toThrow(HideoutParseError);
    expect(() => decodeHideoutCode('abc!!')).toThrow(HideoutParseError);
    expect(() => decodeHideoutCode('eJwAAAAAAA==')).toThrow(HideoutParseError);
  });
});

describe('formatHideoutPost', () => {
  it('markdown собирается и содержит весь декор', () => {
    const parsed = parseHideout(fixture('shoreline_poe2.hideout'));
    const sum = summarizeHideout(parsed, { decorIndex: loadDecorIndex() });
    const post = formatHideoutPost(sum, { owned: new Set(['stash']) });
    expect(post).toContain('# Shoreline Hideout (Path of Exile 2)');
    expect(post).toContain(`**37 / ${HIDEOUT_DECOR_LIMIT}**`);
    expect(post).toContain('- Stash ×1');
  });
});
