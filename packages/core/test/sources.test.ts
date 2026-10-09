/**
 * Тесты источников и свежести данных (№245, Этап 1 «источники + автообновление»).
 *
 * Покрывают:
 *  - kind/update-классификацию реестра источников (каждый источник обязан
 *    иметь валидную пару, без исключений);
 *  - stale-логику по возрасту (auto 30 дн / manual 90 дн) и «старше патча»;
 *  - свежесть датасетов: дата из меты, честное «нет меты» (не падение),
 *    schema_version/_meta.rev passthrough.
 */

import { describe, it, expect } from 'vitest';
import {
  listWebSources,
  getWebSource,
  staleThresholdDays,
  sourceStaleness,
  STALE_DAYS_AUTO,
  STALE_DAYS_MANUAL,
  type SourceKind,
  type SourceUpdate,
} from '../src/sources.js';
import {
  FRESHNESS_DATASETS,
  datasetFreshnessFromRaw,
  datasetFreshnessList,
} from '../src/freshness.js';

const KINDS: SourceKind[] = ['datamined', 'community', 'official'];
const UPDATES: SourceUpdate[] = ['auto', 'manual'];
const DAY = 86_400_000;

describe('sources: kind/update-классификация реестра (№245)', () => {
  it('у КАЖДОГО источника заданы валидные kind и update (без default-дыр)', () => {
    const all = listWebSources();
    expect(all.length).toBeGreaterThanOrEqual(13);
    for (const s of all) {
      expect(KINDS, `kind ${s.kind} у ${s.id}`).toContain(s.kind);
      expect(UPDATES, `update ${s.update} у ${s.id}`).toContain(s.update);
    }
  });

  it('классификация по факту происхождения (спот-чеки)', () => {
    const byId = (id: string) => {
      const s = getWebSource(id);
      expect(s, id).toBeDefined();
      return s!;
    };
    // датамайн/авто: poe2db, PoB2 (локальный клон), RePoE, агрегаторы GGG API
    expect(byId('poe2db')).toMatchObject({ kind: 'datamined', update: 'auto' });
    expect(byId('pob2')).toMatchObject({ kind: 'datamined', update: 'auto' });
    expect(byId('repoe')).toMatchObject({ kind: 'datamined', update: 'auto' });
    expect(byId('poe-ninja')).toMatchObject({ kind: 'datamined', update: 'auto' });
    expect(byId('poe2scout')).toMatchObject({ kind: 'datamined', update: 'auto' });
    // сообщество/ручное: гайды, вики, reddit
    expect(byId('maxroll-poe2')).toMatchObject({ kind: 'community', update: 'manual' });
    expect(byId('poe2wiki')).toMatchObject({ kind: 'community', update: 'manual' });
    expect(byId('reddit-poe2')).toMatchObject({ kind: 'community', update: 'manual' });
    // официальное: новости/dev-docs вручную, живой trade2 API — авто
    expect(byId('official-news')).toMatchObject({ kind: 'official', update: 'manual' });
    expect(byId('trade2')).toMatchObject({ kind: 'official', update: 'auto' });
  });

  it('PoB2/RePoE — накопители датасетов, не fetchable (host-guard не задействован)', () => {
    for (const id of ['pob2', 'repoe']) {
      const s = getWebSource(id)!;
      expect(s.fetchable).toBe(false);
      expect(s.base).toMatch(/^https:\/\//);
    }
  });
});

describe('sources: stale-пороги (№245)', () => {
  it('auto=30 дн, manual=90 дн', () => {
    expect(STALE_DAYS_AUTO).toBe(30);
    expect(STALE_DAYS_MANUAL).toBe(90);
    expect(staleThresholdDays('auto')).toBe(30);
    expect(staleThresholdDays('manual')).toBe(90);
  });

  it('auto: 29 дн свежий, 31 дн протух', () => {
    const now = Date.now();
    const fresh = sourceStaleness({ update: 'auto', fetchedAtMs: now - 29 * DAY, nowMs: now });
    expect(fresh.stale).toBe(false);
    const stale = sourceStaleness({ update: 'auto', fetchedAtMs: now - 31 * DAY, nowMs: now });
    expect(stale.stale).toBe(true);
    expect(stale.staleReason).toContain('30');
  });

  it('manual: 89 дн свежий, 91 дн протух', () => {
    const now = Date.now();
    expect(sourceStaleness({ update: 'manual', fetchedAtMs: now - 89 * DAY, nowMs: now }).stale).toBe(false);
    const stale = sourceStaleness({ update: 'manual', fetchedAtMs: now - 91 * DAY, nowMs: now });
    expect(stale.stale).toBe(true);
    expect(stale.staleReason).toContain('90');
  });

  it('auto: данные ДО известного патча — stale независимо от возраста', () => {
    const now = Date.now();
    const patchAt = now - 5 * DAY;
    const r = sourceStaleness({ update: 'auto', fetchedAtMs: now - 10 * DAY, nowMs: now, knownPatchAtMs: patchAt });
    expect(r.stale).toBe(true);
    expect(r.staleReason).toContain('патча');
    // а полученные ПОСЛЕ патча той же давности — свежие
    const ok = sourceStaleness({ update: 'auto', fetchedAtMs: now - 3 * DAY, nowMs: now, knownPatchAtMs: patchAt });
    expect(ok.stale).toBe(false);
  });

  it('manual-источники правилом «старше патча» не затрагиваются', () => {
    const now = Date.now();
    const r = sourceStaleness({ update: 'manual', fetchedAtMs: now - 10 * DAY, nowMs: now, knownPatchAtMs: now - 5 * DAY });
    expect(r.stale).toBe(false);
  });
});

describe('freshness: датасеты (№245)', () => {
  it('реестр свежести покрывает и датасеты №234 (maps/waystone, 9 файлов)', () => {
    const rels = FRESHNESS_DATASETS.map((s) => s.rel);
    expect(rels).toContain('maps/maps.json');
    expect(rels).toContain('maps/waystone_mods.json');
    expect(rels).toContain('trade/trade_stats.json');
    expect(rels).toContain('support_gems/support_gems.json');
    expect(FRESHNESS_DATASETS.every((s) => KINDS.includes(s.kind) && UPDATES.includes(s.update))).toBe(true);
  });

  it('мета есть: дата, возраст, kind/update, git_rev как схема', () => {
    const spec = {
      rel: 'maps/maps.json',
      sourceId: 'pob2',
      kind: 'datamined' as const,
      update: 'auto' as const,
      datePath: ['_meta', 'fetched'],
      schemaPath: ['_meta', 'git_rev'],
    };
    const now = Date.parse('2026-10-09T00:00:00Z');
    const d = datasetFreshnessFromRaw(
      spec,
      { _meta: { fetched: '2026-10-09', git_rev: 'bb52d6b368307457eb9c54bb13f1829993d390b1' } },
      now,
    );
    expect(d.fetchedAt).toBe('2026-10-09');
    expect(d.ageDays).toBe(0);
    expect(d.stale).toBe(false);
    expect(d.schemaVersion).toBe('bb52d6b368307457eb9c54bb13f1829993d390b1');
  });

  it('старый auto-датасет (2025-12-12, вид support_gems) — честный stale', () => {
    const spec = {
      rel: 'support_gems/support_gems.json',
      sourceId: 'hivemind',
      kind: 'datamined' as const,
      update: 'auto' as const,
      datePath: ['metadata', 'extraction_date'],
    };
    const d = datasetFreshnessFromRaw(spec, { metadata: { extraction_date: '2025-12-12' } }, Date.parse('2026-10-09T00:00:00Z'));
    expect(d.stale).toBe(true);
    expect(d.ageDays!).toBeGreaterThan(300);
  });

  it('НЕТ меты — не падение, а честная пометка (fresh, fetchedAt=null)', () => {
    const spec = {
      rel: 'x/y.json',
      sourceId: 'poe2db',
      kind: 'datamined' as const,
      update: 'auto' as const,
      datePath: ['_meta', 'fetchedAt'],
    };
    const d = datasetFreshnessFromRaw(spec, { something: 1 });
    expect(d.fetchedAt).toBeNull();
    expect(d.ageDays).toBeNull();
    expect(d.stale).toBe(false); // без даты не клевещем «протух» — пометка ниже
    expect(d.note).toContain('нет меты');
    // битая дата — тоже честная пометка, не исключение
    // (⚠ грабля V8: loose-Date.parse распарсил 'not-a-date-2026' как янв.2026 — тест обязан брать непарсябую 'abc')
    const bad = datasetFreshnessFromRaw(spec, { _meta: { fetchedAt: 'abc' } });
    expect(bad.note).toBeTruthy();
  });

  it('datasetFreshnessList читает реальные файлы data/game (Node) — maps.json от №234 на месте', () => {
    const list = datasetFreshnessList(Date.parse('2026-10-09T00:00:00Z'));
    expect(list.length).toBe(FRESHNESS_DATASETS.length);
    const maps = list.find((d) => d.rel === 'maps/maps.json')!;
    expect(maps.sourceId).toBe('pob2');
    expect(maps.fetchedAt).toBe('2026-10-09');
    expect(maps.schemaVersion).toMatch(/^bb52d6b/);
    // у всех записей либо дата, либо честная note
    for (const d of list) {
      expect(d.fetchedAt != null || d.note != null).toBe(true);
    }
  });
});
