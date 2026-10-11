import { describe, expect, it } from 'vitest';
import { buildLiveFilterSnapshot, type SnapshotChannels } from '../src/livefilter/snapshot.js';
import { validateSnapshot } from '../src/livefilter/rules.js';
import type { CurrencyRate } from '../src/types.js';

function rate(name: string, chaos: number | null, divine: number | null = null): CurrencyRate {
  return { name, chaosValue: chaos, divineValue: divine, source: 'fixture', updatedAt: 0 };
}

describe('buildLiveFilterSnapshot (каналы — инъекция)', () => {
  it('divine-first: divine-цена приоритетна, chaos — fallback, ambos null — skip', async () => {
    const ch: SnapshotChannels = {
      rates: () => Promise.resolve({ divineRate: 100, chaosRate: 0.5 }),
      currency: () =>
        Promise.resolve([
          rate('Divine Orb', null, 1),        // → 1×100 = 100 ex
          rate('Exalted Orb', 1),             // → 1×0.5 = 0.5 ex
          rate('Mirror of Kalandra', null, 250), // → 250×100 = 25000 ex
          rate('Empty Orb', null),             // young-league null → skip
        ]),
    };
    const { snapshot, error } = await buildLiveFilterSnapshot('L', ch);
    expect(error).toBe('');
    expect(snapshot.rates).toEqual({ divineEx: 100, chaosEx: 0.5 });
    const byName = new Map(snapshot.currency.map((c) => [c.name, c.valueEx] as const));
    expect(byName.get('Divine Orb')).toBe(100);
    expect(byName.get('Exalted Orb')).toBe(0.5);
    expect(byName.get('Mirror of Kalandra')).toBe(25000);
    expect(snapshot.currency.find((c) => c.name === 'Empty Orb')).toBeUndefined();
  });

  it('нет курса divine → снапшот непригоден (divine-first no-fallback, P6)', async () => {
    const ch: SnapshotChannels = {
      rates: () => Promise.resolve({ divineRate: null, chaosRate: 0.5 }),
      currency: () => Promise.resolve([rate('Exalted Orb', 1)]),
    };
    const { snapshot, error } = await buildLiveFilterSnapshot('L', ch);
    expect(error).not.toBe('');
    expect(error).toContain('divine');
    expect(snapshot.sources['rates']?.ok).toBe(false);
  });

  it('упавший канал валют → честный source-статус, снапшот валиден по остатку', async () => {
    const ch: SnapshotChannels = {
      rates: () => Promise.resolve({ divineRate: 120, chaosRate: 0.6 }),
      currency: () => Promise.reject(new Error('scout down')),
    };
    const { snapshot, error } = await buildLiveFilterSnapshot('L', ch);
    expect(error).toBe('нет данных о ценах'); // и currency, и uniqueBases пусты
    expect(snapshot.sources['currency']?.ok).toBe(false);
    expect(snapshot.sources['currency']?.error).toContain('scout down');
    expect(validateSnapshot(snapshot)).not.toBe('');
  });

  it('schemaVersion/лига/generatedAt на месте; уники/exceptional пусты без листингов', async () => {
    const ch: SnapshotChannels = {
      rates: () => Promise.resolve({ divineRate: 90, chaosRate: 0.4 }),
      currency: () => Promise.resolve([rate('Divine Orb', null, 1)]),
    };
    const { snapshot, error } = await buildLiveFilterSnapshot('MyLeague', ch);
    expect(error).toBe('');
    expect(snapshot.league).toBe('MyLeague');
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.uniqueBases).toEqual({});
    expect(snapshot.exceptional).toEqual([]);
  });
});
