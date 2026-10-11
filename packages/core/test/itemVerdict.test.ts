/**
 * Тесты вердикт-слоя «предмет vs билд» (P10, itemVerdict.ts).
 *
 * Фикстуры — EN-клир-текст (парсер мультиязычен, но моды резистов в estimate
 * считываются по EN-шаблонам: RU-моды — за locale-таблицей, отдельный пункт).
 * Guardrails-паттерны ExileLens (MIT): res-cap-lost never upgrade,
 * unequipable → not_viable, UNMEASURED ≠ upgrade, sidegrade-полоса скора.
 */

import { describe, expect, it } from 'vitest';
import { flatDefenseDelta, itemVerdict, slotForItem } from '../src/itemVerdict.js';
import { parseItemText } from '../src/parse.js';

const CURRENT_BODY = `Item Class: Body Armours
Rarity: Rare
Sorrow Shroud
Sleek Jacket
--------
Energy Shield: 300
--------
Requires Level 60
--------
+40 to maximum Life
+30% to Fire Resistance
--------
Item Level: 80
`;

const BETTER_BODY = `Item Class: Body Armours
Rarity: Rare
Doom Vestment
Sleek Jacket
--------
Energy Shield: 500
--------
Requires Level 60
--------
+60 to maximum Life
+40% to Fire Resistance
--------
Item Level: 82
`;

const IDENTICAL_BODY = CURRENT_BODY;

const CAP_CONTEXT_GEAR = [
  {
    slot: 'Gloves',
    name: '',
    itemText: `Item Class: Gloves
Rarity: Rare
Ash Gauntlets
Wrapped Greaves
--------
+55% to Fire Resistance
--------
`,
  },
  {
    slot: 'BodyArmour',
    name: '',
    itemText: CURRENT_BODY,
  },
];

const KEEPS_CAP_BODY = BETTER_BODY;

const LOSES_CAP_BODY = `Item Class: Body Armours
Rarity: Rare
Doom Vestment
Sleek Jacket
--------
Energy Shield: 500
--------
Requires Level 60
--------
+60 to maximum Life
--------
Item Level: 82
`;

describe('itemVerdict', () => {
  it('slotForItem: канонические PoE2 gear-классы (rules.ts) → слоты', () => {
    for (const [text, want] of [
      ['Item Class: Quarterstaves', 'Weapon'],
      ['Item Class: Talismans', 'Amulet'],
      ['Item Class: Foci', 'Focus'],
      ['Item Class: Bucklers', 'Shield'],
      ['Item Class: Body Armours', 'BodyArmour'],
    ] as const) {
      const p = parseItemText(`${text}\nRarity: Normal\nBase\n`);
      expect(slotForItem(p)).toBe(want);
    }
  });

  it('явный апгрейд по всем осям: ES/life/res лучше — verdict upgrade/minor_upgrade', () => {
    const v = itemVerdict({
      candidateText: BETTER_BODY,
      currentSlotText: CURRENT_BODY,
      basePools: { life: 1000, energyShield: 1500 },
    });
    expect(['upgrade', 'minor_upgrade']).toContain(v.verdict);
    expect(v.score).toBeGreaterThan(53);
    expect(v.guards.resistCapLost).toBe(false);
    expect(v.axes.length).toBeGreaterThan(0);
  });

  it('кап резиста: потеря капа (fire 75% → ниже) — никогда не upgrade (ExileLens guard)', () => {
    // Гир-контекст: 55% fire с перчаток + 30% с текущего тела = кап 75.
    // Кандидат БЕЗ fire-резиста выкидывает из капа — несмотря на +200 ES.
    const v = itemVerdict({
      candidateText: LOSES_CAP_BODY,
      currentSlotText: CURRENT_BODY,
      gear: CAP_CONTEXT_GEAR,
      basePools: { life: 1000, energyShield: 1500 },
    });
    expect(v.guards.resistCapLost).toBe(true);
    expect(v.verdict).not.toBe('upgrade');
    expect(v.verdict).not.toBe('minor_upgrade');
    expect(v.reasons.some((r) => /выводит из капа резист/i.test(r.text))).toBe(true);
  });

  it('тот же кандидат, но fire-резист сохранён — кап не теряется', () => {
    const v = itemVerdict({
      candidateText: KEEPS_CAP_BODY,
      currentSlotText: CURRENT_BODY,
      gear: CAP_CONTEXT_GEAR,
      basePools: { life: 1000, energyShield: 1500 },
    });
    expect(v.guards.resistCapLost).toBe(false);
    expect(['upgrade', 'minor_upgrade']).toContain(v.verdict);
  });

  it('нельзя надеть (требования выше персонажа) — not_viable, трестовые гварды', () => {
    const v = itemVerdict({
      candidateText: `Item Class: Body Armours
Rarity: Rare
Doom Vestment
Sleek Jacket
--------
Energy Shield: 500
--------
Requires Level 85, 120 Int
--------
Item Level: 90
`,
      currentSlotText: CURRENT_BODY,
      character: { level: 80, intelligence: 90 },
    });
    expect(v.verdict).toBe('not_viable');
    expect(v.guards.equipable).toBe(false);
    expect(v.headline).toMatch(/не может надеть/);
  });

  it('кандидат другого слота, чем current — not_viable', () => {
    const v = itemVerdict({
      candidateText: `Item Class: Helmets
Rarity: Rare
Crown
 Reaper Cowl
--------
Energy Shield: 400
`,
      currentSlotText: CURRENT_BODY,
    });
    expect(v.verdict).toBe('not_viable');
  });

  it('одинаковые предметы — sidegrade (замена 1-в-1, score 50)', () => {
    const v = itemVerdict({
      candidateText: IDENTICAL_BODY,
      currentSlotText: CURRENT_BODY,
      basePools: { life: 1000, energyShield: 1500 },
    });
    expect(v.verdict).toBe('sidegrade');
    expect(v.score).toBe(50);
  });

  it('candidate-only (current не передан) — uncertain: UNMEASURED ≠ upgrade', () => {
    const v = itemVerdict({ candidateText: BETTER_BODY });
    expect(v.verdict).toBe('uncertain');
    expect(v.guards.offenseUnmeasured).toBe(true);
  });

  it('без персонажа проверка требований неизвестна — гвард не даёт plain upgrade', () => {
    const v = itemVerdict({
      candidateText: `Item Class: Body Armours
Rarity: Rare
Doom Vestment
Sleek Jacket
--------
Energy Shield: 900
--------
Requires Level 85, 120 Int
--------
`,
      currentSlotText: CURRENT_BODY,
      basePools: { life: 1000, energyShield: 1500 },
    });
    expect(v.guards.equipabilityUnknown).toBe(true);
    // Сильный рост, но requirements не сверены → не plain upgrade.
    expect(v.verdict).not.toBe('upgrade');
  });

  it('оружие: DPS-дельта собственных статов (без дерева/гемов — honest axis)', () => {
    const sword = (name: string, min: number, max: number, aps: number) => `Item Class: One Hand Swords
Rarity: Rare
${name}
Rusted Sword
--------
Physical Damage: ${min}-${max}
Attacks per Second: ${aps}
--------
`;

    const v = itemVerdict({
      candidateText: sword('Blade', 40, 60, 1.5),
      currentSlotText: sword('Old Blade', 10, 20, 1.2),
    });
    expect(v.slot).toBe('Weapon');
    // dps после = 50*1.5=75, до = 15*1.2=18 → score 50+20(кэп)… upgrade-полоса,
    // но equipability неизвестна → minor_upgrade, и всё равно не downgrade.
    expect(v.score).toBeGreaterThan(53);
    expect(v.reasons.some((r) => /DPS оружия/.test(r.text))).toBe(true);
  });

  it('flatDefenseDelta: резисты/ES/life дельты по модам', () => {
    const d = flatDefenseDelta(CURRENT_BODY, BETTER_BODY);
    expect(d.energyShield).toBeGreaterThan(0);
    expect(d.life).toBeGreaterThan(0);
    expect(d.fireRes).toBe(10);
  });
});
