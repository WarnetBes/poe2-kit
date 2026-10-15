/**
 * Тесты офлайн-датасета витрины poeshop (poeshopMarket.ts).
 *
 * Датасет data/game/market/poeshop_market.json генерится
 * scripts/gen-poeshop-market.mjs; тесты идут по известным якорям среза
 * (Temporalis — стабильно дорогой уник) и не зависят от точных значений цен.
 */

import { describe, expect, it } from 'vitest';
import {
  lookupPoeshopMarket,
  poeshopMarketMeta,
  poeshopVerdict,
  resolvePoeshopLeague,
  searchPoeshopMarket,
} from '../src/poeshopMarket.js';

describe('poeshopVerdict — пороги тиров в divine', () => {
  it('дорогие уники → jackpot/не выкидывай', () => {
    expect(poeshopVerdict(3900)?.tier).toBe('jackpot');
    expect(poeshopVerdict(10)?.tier).toBe('jackpot');
  });
  it('порог 1..10 div → valuable', () => {
    expect(poeshopVerdict(1)?.tier).toBe('valuable');
    expect(poeshopVerdict(9.99)?.tier).toBe('valuable');
  });
  it('мелочь → keep/sellable/trash', () => {
    expect(poeshopVerdict(0.1)?.tier).toBe('keep');
    expect(poeshopVerdict(0.05)?.tier).toBe('sellable');
    expect(poeshopVerdict(0.001)?.tier).toBe('trash');
  });
  it('null/0 → без вердикта', () => {
    expect(poeshopVerdict(null)).toBeNull();
    expect(poeshopVerdict(0)).toBeNull();
  });
});

describe('resolvePoeshopLeague — человекочитаемые названия', () => {
  it('челлендж-лиги и RU-варианты кодов', () => {
    expect(resolvePoeshopLeague('Forbidden Rites')).toBe('forbidden-rites');
    expect(resolvePoeshopLeague('the forbidden rite')).toBe('forbidden-rites');
    expect(resolvePoeshopLeague('Runes of Aldur')).toBe('new-league');
    expect(resolvePoeshopLeague('new-league')).toBe('new-league');
    expect(resolvePoeshopLeague('HC Forbidden Rites')).toBe('hardcore-forbidden-rites');
  });
  it('standard/hc и пустые', () => {
    expect(resolvePoeshopLeague('Standard')).toBe('standard');
    expect(resolvePoeshopLeague('Hardcore')).toBe('hardcore');
    expect(resolvePoeshopLeague(null)).toBeNull();
  });
});

describe('lookupPoeshopMarket — якорные уники среза', () => {
  it('Temporalis: полное EN-имя → дорогой уник, есть вердикт и цены', () => {
    const lk = lookupPoeshopMarket('Temporalis Silk Robe');
    expect(lk.entry).not.toBeNull();
    expect(lk.entry!.name).toBe('Temporalis');
    expect(lk.entry!.base).toBe('Silk Robe');
    expect(lk.entry!.leagues).toBeTruthy();
    if (lk.prices) {
      // якорь среза: Temporalis стабильно >100 div в challenge-лигах
      expect(lk.prices.divine).toBeGreaterThan(100);
      expect(lk.verdict?.tier).toBe('jackpot');
      expect(lk.freshness).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(lk.matchedBy).toBe('en');
  });

  it('лига подмешивается: new-league резолвится', () => {
    const lk = lookupPoeshopMarket('Temporalis Silk Robe', 'Runes of Aldur');
    if (lk.prices) {
      expect(lk.league).toBe('new-league');
      expect(lk.prices.divine).toBeGreaterThan(0);
    }
  });

  it('RU-имя матчится (RU-клиент Ctrl+C)', () => {
    const meta = lookupPoeshopMarket('Temporalis Silk Robe');
    const ruName = meta.entry?.ru;
    if (ruName) {
      const lk = lookupPoeshopMarket(ruName);
      expect(lk.entry?.en).toBe('Temporalis Silk Robe');
      expect(lk.matchedBy).toBe('ru');
    }
  });

  it('неизвестное имя → пустой lookup без throw', () => {
    const lk = lookupPoeshopMarket('Абсолютно Неизвестный Уник 12345');
    expect(lk.entry).toBeNull();
    expect(lk.verdict).toBeNull();
    expect(lk.caveats.length).toBeGreaterThan(0);
  });

  it('пустой запрос → пустой lookup', () => {
    expect(lookupPoeshopMarket('').entry).toBeNull();
    expect(lookupPoeshopMarket('   ').entry).toBeNull();
  });
});

describe('poeshopMarketMeta + searchPoeshopMarket', () => {
  it('метадата содержит provenance и caveats', () => {
    const m = poeshopMarketMeta();
    expect(m.provenance).toContain('poeshop.ru');
    expect(m.caveats.length).toBeGreaterThan(2);
    expect(m.counts.itemsWithPrices).toBeGreaterThan(500);
  });

  it('поиск по подстроке находит Temporalis', () => {
    const hits = searchPoeshopMarket('temporalis');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].en.toLowerCase()).toContain('temporalis');
  });

  it('пустой запрос поиска → []', () => {
    expect(searchPoeshopMarket('')).toEqual([]);
  });
});
