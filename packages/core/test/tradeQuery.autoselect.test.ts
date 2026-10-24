import { describe, it, expect } from 'vitest';
import { buildTradeQueryFromItem, buildTradeQuery } from '../src/tradeQuery.js';

/** EN-фикстура: редкий тело-броня с защитами и модами (формат клир-текста PoE2). */
const RARE_BODY = `Item Class: Body Armours
Rarity: Rare
Cataclysm Raiment
Sinner Tricorne
--------
Quality: +20% (augmented)
Armour: 100
Evasion: 1000
Energy Shield: 500
--------
Requires Level 35, 98 Int
--------
+80 to maximum Life
+30 to Cold Resistance
--------
Item Level: 72
`;

/** EN-фикстура: кольцо без защит — не должно порождать equipment_filters. */
const PLAIN_RING = `Item Class: Rings
Rarity: Rare
Loop of Ashes
Two-Stone Ring
--------
+18 to maximum Life
+15 to Fire Resistance
--------
Item Level: 30
`;

/** Оружие с физ. уроном (проверка dps-допуска 0.7 при defaul). */
const RARE_WEAPON = `Item Class: Quarterstaves
Rarity: Rare
Wind Piper
Vile Staff
--------
Physical Damage: 20-30
Elemental Damage: 10-20 (cold)
Attacks per Second: 1.00
--------
+40 to maximum Life
--------
Item Level: 40
`;

describe('tradeQuery AutoSelect-lite: equipment_filters (баг №590)', () => {
  it('ar/ev/es пишутся в equipment_filters, мёртвой группы armour_filters нет', () => {
    const q = buildTradeQueryFromItem(RARE_BODY);
    const filters = q.query.filters ?? {};
    expect(filters.equipment_filters?.filters?.ar?.min).toBe(80); // 100×0.8
    expect(filters.equipment_filters?.filters?.ev?.min).toBe(800); // 1000×0.8
    expect(filters.equipment_filters?.filters?.es?.min).toBe(400); // 500×0.8
    expect((filters as Record<string, unknown>).armour_filters).toBeUndefined();
    expect((filters as Record<string, unknown>).weapon_filters).toBeUndefined();
  });

  it('не-броневой предмет НЕ порождает equipment_filters вообще', () => {
    const q = buildTradeQueryFromItem(PLAIN_RING);
    expect(q.query.filters?.equipment_filters).toBeUndefined();
    // но моды распознаны
    expect(q.query.stats?.[0].filters.some((f) => f.id === 'pseudo.pseudo_total_life')).toBe(true);
  });

  it('plain buildTradeQuery: dps из input тоже уходит в equipment_filters', () => {
    const q = buildTradeQuery({ dpsMin: 100, esMin: 50 });
    expect(q.query.filters?.equipment_filters?.filters?.dps?.min).toBe(100);
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(50);
    expect(q.query.filters?.type_filters?.filters?.dps).toBeUndefined();
  });
});

describe('tradeQuery AutoSelect-lite: tolerancePct-нормализация', () => {
  it('default: защиты ×0.8, dps ×0.7 (как раньше, но floor)', () => {
    const q = buildTradeQueryFromItem(RARE_BODY);
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(400);
    const w = buildTradeQueryFromItem(RARE_WEAPON);
    // pdps = 25×1.0, edps = 15×1.0 → dps 40, pdps 25, edps 15
    expect(w.query.filters?.equipment_filters?.filters?.dps?.min).toBe(28); // 40×0.7
    expect(w.query.filters?.equipment_filters?.filters?.pdps?.min).toBe(17); // 25×0.7 = 17.5 → 17
    expect(w.query.filters?.equipment_filters?.filters?.edps?.min).toBe(10); // 15×0.7 = 10.5 → 10
  });

  it('tolerancePct=30 → защиты ×0.7', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { tolerancePct: 30 });
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(350); // 500×0.7
    expect(q.query.filters?.equipment_filters?.filters?.ev?.min).toBe(700);
  });

  it('tolerancePct капится сверху на 50', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { tolerancePct: 90 });
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(250); // 500×0.5
  });

  it('моды: без опций — точные значения (легаси-поведение)', () => {
    const q = buildTradeQueryFromItem(RARE_BODY);
    const life = q.query.stats?.[0].filters.find((f) => f.id === 'pseudo.pseudo_total_life');
    expect(life?.value?.min).toBe(80);
  });

  it('моды: явный tolerancePct нормализует их тоже', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { tolerancePct: 50 });
    const life = q.query.stats?.[0].filters.find((f) => f.id === 'pseudo.pseudo_total_life');
    expect(life?.value?.min).toBe(40); // 80×0.5
  });

  it('легаси opts.tolerance (абсолютный) сохранён и блокирует проценты для модов', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { tolerance: 10 });
    const life = q.query.stats?.[0].filters.find((f) => f.id === 'pseudo.pseudo_total_life');
    expect(life?.value?.min).toBe(70); // 80−10
    // защиты при этом остаются на дефолтном 20%
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(400);
  });
});

describe('tradeQuery AutoSelect-lite: statOverrides (режим 2, приоритет)', () => {
  it('override {name:"es", min:500} бьёт автозаполнение', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { statOverrides: [{ name: 'es', min: 500 }] });
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(500);
    // остальные фильтры авто как были
    expect(q.query.filters?.equipment_filters?.filters?.ar?.min).toBe(80);
  });

  it('override по алиасу "Energy Shield" и max для numeric-фильтра', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, {
      statOverrides: [{ name: 'Energy Shield', min: 510, max: 700 }],
    });
    expect(q.query.filters?.equipment_filters?.filters?.es).toEqual({ min: 510, max: 700 });
  });

  it('disabled:true убирает numeric-фильтр', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { statOverrides: [{ name: 'evasion', disabled: true }] });
    expect(q.query.filters?.equipment_filters?.filters?.ev).toBeUndefined();
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(400);
  });

  it('override по label мода ("Cold Res") переопределяет stat-мин', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, { statOverrides: [{ name: 'Cold Res', min: 40 }] });
    const cold = q.query.stats?.[0].filters.find((f) => f.id === 'pseudo.pseudo_total_cold_resistance');
    expect(cold?.value?.min).toBe(40);
  });

  it('override по stat-id с disabled убирает мод из запроса', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, {
      statOverrides: [{ name: 'pseudo.pseudo_total_life', disabled: true }],
    });
    expect(q.query.stats?.[0].filters.some((f) => f.id === 'pseudo.pseudo_total_life')).toBe(false);
    expect(q.query.stats?.[0].filters.some((f) => f.id === 'pseudo.pseudo_total_cold_resistance')).toBe(true);
  });

  it('оба режима совместимы: override + tolerancePct одновременно', () => {
    const q = buildTradeQueryFromItem(RARE_BODY, {
      tolerancePct: 30,
      statOverrides: [{ name: 'es', min: 450 }, { name: 'Spirit', disabled: true }],
    });
    expect(q.query.filters?.equipment_filters?.filters?.es?.min).toBe(450); // override
    expect(q.query.filters?.equipment_filters?.filters?.ev?.min).toBe(700); // нормализация
  });
});
