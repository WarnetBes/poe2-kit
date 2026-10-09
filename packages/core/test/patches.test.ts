/**
 * Тесты Этапа 4 (№248): офлайн-реестр патчей + подключение knownPatchAt
 * в freshness + datasetDiff (снапшоты/отчёт refresh).
 *
 * Покрывают:
 *  - patches.json: формат, все даты парсятся, спот-чеки дат из дайджестов;
 *  - knownPatchAtMs: только ПОДТВЕРЖДЁННЫЕ записи, latestKnownPatch = 0.5.5e;
 *  - unverified-записи (0.5.3/0.5.4) в knownPatchAt НЕ попадают;
 *  - parseKnownPatches: битые/пустые payload'ы — честная отработка;
 *  - freshness: дефолтный knownPatchAt из patches.json (данные, полученные
 *    после патча 06.10 — свежие, до — stale «получены до известного патча»
 *    даже моложе 30-дн порога), переопределение параметром;
 *  - datasetDiff: снапшоты, счётчики записей (trade_stats-форма), fingerprint.
 */

import { describe, it, expect } from 'vitest';
import {
  listKnownPatches,
  findKnownPatch,
  knownPatchAtMs,
  latestKnownPatch,
  parseKnownPatches,
  knownPatchesMeta,
  type KnownPatch,
} from '../src/patches.js';
import {
  datasetFreshnessFromRaw,
  datasetFreshnessList,
  FRESHNESS_DATASETS,
  type FreshnessSpec,
} from '../src/freshness.js';
import {
  countRecords,
  snapshotDataset,
  diffDatasetSnapshots,
  formatDatasetDiff,
} from '../src/datasetDiff.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-09T00:00:00Z'); // as_of дайджестов
// последняя подтверждённая дата патча в реестре: 0.5.5e = 06.10.2026
const PATCH_055E_MS = Date.parse('2026-10-06T00:00:00Z');

const autoSpec: FreshnessSpec = {
  rel: 'x/test.json',
  sourceId: 'poe2db',
  kind: 'datamined',
  update: 'auto',
  datePath: ['_meta', 'fetchedAt'],
};

describe('patches: офлайн-реестр патчей (№248)', () => {
  it('все записи валидны: version + парсящаяся ISO-дата, хронологический порядок', () => {
    const all = listKnownPatches();
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const p of all) {
      expect(p.version).toMatch(/^0\.\d+/);
      expect(Number.isFinite(p.dateMs)).toBe(true);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.dateMs).toBeGreaterThanOrEqual(all[i - 1]!.dateMs);
    }
  });

  it('спот-чеки дат из дайджестов ресёрча (не выдуманные)', () => {
    const by = (v: string) => {
      const p = findKnownPatch(v);
      expect(p, v).not.toBeNull();
      return p!;
    };
    expect(by('0.4.0').date).toBe('2025-12-12');
    expect(by('0.5.0').date).toBe('2026-05-29');
    expect(by('0.5.1').date).toBe('2026-06-04');
    expect(by('0.5.2').date).toBe('2026-06-11');
    expect(by('0.5.5').date).toBe('2026-09-02');
    expect(by('0.5.5b').date).toBe('2026-09-11');
    expect(by('0.5.5c').date).toBe('2026-09-17');
    expect(by('0.5.5d').date).toBe('2026-09-28');
    expect(by('0.5.5e').date).toBe('2026-10-06');
  });

  it('unverified-записи (0.5.3, 0.5.4) помечены и в knownPatchAt НЕ попадают', () => {
    const all = listKnownPatches();
    const unverified = all.filter((p) => p.unverified != null).map((p) => p.version);
    expect(unverified).toContain('0.5.3');
    expect(unverified).toContain('0.5.4');
    expect(knownPatchAtMs()).toBe(PATCH_055E_MS); // свежее unverified-дат нет
  });

  it('latestKnownPatch = 0.5.5e; мета файла самоотчитывается', () => {
    const latest = latestKnownPatch();
    expect(latest?.version).toBe('0.5.5e');
    const m = knownPatchesMeta();
    expect(m.patch).toBe('0.5.5e');
    expect(m.asOf).toBe('2026-10-09');
    expect(m.total).toBeGreaterThanOrEqual(11);
    expect(m.unverified).toBeGreaterThanOrEqual(2);
  });

  it('findKnownPatch: точный матч; неизвестная версия — null', () => {
    expect(findKnownPatch(' 0.5.5e ')?.version).toBe('0.5.5e'); // trim
    expect(findKnownPatch('9.9.9')).toBeNull();
  });

  it('parseKnownPatches: битые/пустые payload-ы — честная отработка', () => {
    expect(parseKnownPatches(null)).toEqual([]);
    expect(parseKnownPatches({})).toEqual([]);
    expect(parseKnownPatches({ patches: 'not-array' })).toEqual([]);
    // записи без даты/версии отфильтрованы, непарсящаяся дата — тоже
    expect(parseKnownPatches({ patches: [{ version: '1.0' }, { date: '2026-01-01' }, { version: '1.0', date: 'abc' }] })).toEqual([]);
    // валидная запись проходит
    const ok = parseKnownPatches({ patches: [{ version: '0.9.9', date: '2026-01-01' }] });
    expect(ok).toHaveLength(1);
    expect(ok[0]!.dateMs).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });
});

describe('freshness: knownPatchAt из patches.json по умолчанию (№248)', () => {
  it('данные, полученные ДО известного патча — stale, даже моложе 30-дн порога', () => {
    // fetched 2026-10-04, патч 0.5.5e 06.10 → возраст 5 дн < 30, но stale
    const d = datasetFreshnessFromRaw(autoSpec, { _meta: { fetchedAt: '2026-10-04' } }, NOW);
    expect(d.ageDays).toBe(5);
    expect(d.stale).toBe(true);
    expect(d.staleReason).toContain('патча');
  });

  it('данные, полученные ПОСЛЕ патча — свежие (возраст в норме)', () => {
    const d = datasetFreshnessFromRaw(autoSpec, { _meta: { fetchedAt: '2026-10-08' } }, NOW);
    expect(d.stale).toBe(false);
    expect(d.staleReason).toBeNull();
  });

  it('явный параметр ПЕРЕОПРЕДЕЛЯЕТ дефолт (свежесть на момент патча X)', () => {
    // fetched 03.10: на момент 0.5.5 (02.09) — ПОСЛЕ патча → свежие (возраст 6 дн < 30);
    // на дефолтном 0.5.5e (06.10) — ДО патча → stale «получены до известного патча».
    // (даты >30 дн от NOW брать нельзя: сработает возрастной порог и завалит тест.)
    const at055 = Date.parse('2026-09-02T00:00:00Z');
    const d = datasetFreshnessFromRaw(autoSpec, { _meta: { fetchedAt: '2026-10-03' } }, NOW, at055);
    expect(d.stale).toBe(false);
    const def = datasetFreshnessFromRaw(autoSpec, { _meta: { fetchedAt: '2026-10-03' } }, NOW);
    expect(def.stale).toBe(true);
    expect(def.staleReason).toContain('патча');
  });

  it('null-параметр отключает правило «старше патча» (только возрастной порог)', () => {
    const d = datasetFreshnessFromRaw(autoSpec, { _meta: { fetchedAt: '2026-10-04' } }, NOW, null);
    expect(d.stale).toBe(false); // 5 дн < 30, патч-правило выключено
  });

  it('manual-датасеты правилом патча не затрагиваются (№245 сохранён)', () => {
    const manualSpec: FreshnessSpec = { ...autoSpec, update: 'manual' };
    const d = datasetFreshnessFromRaw(manualSpec, { _meta: { fetchedAt: '2026-10-04' } }, NOW);
    expect(d.stale).toBe(false); // 5 дн < 90
  });

  it('datasetFreshnessList: живые датасеты изменили вердикты там, где мета старее патча', () => {
    const list = datasetFreshnessList(NOW);
    expect(list.length).toBe(FRESHNESS_DATASETS.length);
    const maps = list.find((x) => x.rel === 'maps/maps.json')!;
    expect(maps.fetchedAt).toBe('2026-10-09'); // после патча 06.10 →
    expect(maps.stale).toBe(false); // fresh и по возрасту, и по патчу
    // support_gems (2025-12-12) остаётся stale по возрасту
    const support = list.find((x) => x.rel === 'support_gems/support_gems.json')!;
    expect(support.stale).toBe(true);
  });
});

describe('datasetDiff: снапшоты и отчёт refresh (№248)', () => {
  it('countRecords: массив / trade_stats-форма / словарь / прочий объект', () => {
    expect(countRecords([1, 2, 3])).toBe(3);
    expect(countRecords(null)).toBeNull();
    // trade_stats: result → группы с entries → сумма
    const tradeShape = { result: [{ id: 'a', entries: [1, 2] }, { id: 'b', entries: [1] }] };
    expect(countRecords(tradeShape)).toBe(3);
    // группы без entries → длина result
    expect(countRecords({ result: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    expect(countRecords({ patches: [{}, {}, {}] })).toBe(3);
    expect(countRecords({ a: 1, b: 2 })).toBe(2); ///key fallback
  });

  it('snapshotDataset: null-сырьё/битый JSON — null; BOM прощается', () => {
    expect(snapshotDataset(null)).toBeNull();
    expect(snapshotDataset(null, 'not json')).toBeNull();
    const snap = snapshotDataset(null, '\uFEFF{"patches":[1,2]}');
    expect(snap?.records).toBe(2);
  });

  it('diff: контент изменился — fingerprint и счётчики ловят разницу', () => {
    const before = snapshotDataset({ _meta: { fetchedAt: '2026-10-01' }, patches: [1, 2, 3] });
    const afterSame = snapshotDataset({ _meta: { fetchedAt: '2026-10-01' }, patches: [1, 2, 3] });
    const afterChanged = snapshotDataset({ _meta: { fetchedAt: '2026-10-09' }, patches: [1, 2, 3, 4] });
    expect(diffDatasetSnapshots(before, afterSame).contentChanged).toBe(false);
    const changed = diffDatasetSnapshots(before, afterChanged);
    expect(changed.contentChanged).toBe(true);
    expect(changed.recordsDelta).toBe(1);
    // изменение ТОЛЬКО мета-даты (числа те же) — контент.changed, delta=0
    const metaOnly = snapshotDataset({ _meta: { fetchedAt: '2026-10-09' }, patches: [1, 2, 3] });
    const mo = diffDatasetSnapshots(before, metaOnly);
    expect(mo.contentChanged).toBe(true);
    expect(mo.recordsDelta).toBe(0);
  });

  it('formatDatasetDiff: человеком читается, факт изменения виден', () => {
    const before = snapshotDataset(null, '{"patches":[1,2]}');
    const after = snapshotDataset(null, '{"patches":[1,2,3,4,5]}');
    const line = formatDatasetDiff('x/y.json', diffDatasetSnapshots(before, after));
    expect(line).toContain('x/y.json');
    expect(line).toContain('ИЗМЕНЁН');
    expect(line).toContain('+3');
  });

  it('diff до/после с исчезнувшим файлом — тревожная пометка, не молчание', () => {
    const before = snapshotDataset(null, '{"patches":[1]}');
    const d = diffDatasetSnapshots(before, null);
    expect(d.contentChanged).toBe(true);
    const line = formatDatasetDiff('x/y.json', d);
    expect(line).toContain('ИСЧЕЗ');
  });
});
