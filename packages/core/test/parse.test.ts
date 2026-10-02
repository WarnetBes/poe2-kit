import { describe, it, expect } from 'vitest';
import { parseItemText, splitSections, itemDisplayName } from '../src/parse.js';

/** EN-фикстура: редкая броня с defensives, требованиями, implicit-модом и флагами. */
const EN_RARE_BODY_ARMOUR = `Item Class: Body Armours
Rarity: Rare
Cataclysm Raiment
Sinner Tricorne
--------
Quality: +20% (augmented)
Armour: 42 (augmented)
Evasion: 100
Energy Shield: 20
--------
Requires Level 35, 98 Int
--------
+40 to maximum Life (implicit)
--------
Item Level: 72
--------
Corrupted
`;

/** EN-фикстура: магическое кольцо (имя-суффикс, base type отсутствует). */
const EN_MAGIC_RING = `Item Class: Rings
Rarity: Magic
Coral Ring of Frost
--------
Requires Level 12
--------
+18 to maximum Life
--------
Item Level: 20
`;

/** RU-фикстура: обычный предмет, RU-заголовки и RU-неявный мод. */
const RU_NORMAL_ARMOUR = `Класс предмета: Броня
Редкость: Обычный
Ar Armour Plating
--------
Качество: +12%
Броня: 100
--------
Требуется Уровень 8
--------
+10 к максимуму жизни (неявный)
--------
Уровень предмета: 15
`;

/** EN-фикстура: уникальный.weapon с физическим и стихийным уроном. */
const EN_UNIQUE_WEAPON = `Item Class: Quarterstaves
Rarity: Unique
Hrakkram, Canker
Vile Staff
--------
Physical Damage: 12-22
Elemental Damage: 5-10 (cold), 15-20 (fire)
Critical Hit Chance: 5.00%
Attacks per Second: 1.20
--------
Requires Level 24, 30 Str, 60 Int
--------
Item Level: 40
`;

describe('parse: splitSections', () => {
  it('делит клир-текст по "--------" и выкидывает пустые секции', () => {
    const sections = splitSections('a: 1\n--------\nb: 2\n--------\n--------');
    expect(sections).toHaveLength(2);
  });

  it('игнорирует CRLF-переносы', () => {
    const sections = splitSections('a: 1\r\n--------\r\nb: 2');
    expect(sections).toHaveLength(2);
    expect(sections[1]).toEqual(['b: 2']);
  });
});

describe('parse: EN Rare броня', () => {
  const item = parseItemText(EN_RARE_BODY_ARMOUR);

  it('шапка: класс, редкость, имя и базовый тип', () => {
    expect(item.itemClass).toBe('Body Armours');
    expect(item.rarity).toBe('Rare');
    expect(item.name).toBe('Cataclysm Raiment');
    expect(item.baseType).toBe('Sinner Tricorne');
  });

  it('качество и защиты (augmented-маркер)', () => {
    expect(item.quality).toEqual({ value: 20, augmented: true });
    expect(item.defences.armour).toEqual({ value: 42, augmented: true });
    expect(item.defences.evasion).toEqual({ value: 100, augmented: false });
    expect(item.defences.energyShield).toEqual({ value: 20, augmented: false });
  });

  it('требования: уровень и атрибут', () => {
    expect(item.requirements.level).toBe(35);
    expect(item.requirements.intelligence).toBe(98);
  });

  it('implicit-мод распознан по маркеру', () => {
    const implicit = item.mods.find((m) => m.type === 'implicit');
    expect(implicit?.text).toBe('+40 to maximum Life');
  });

  it('Item Level и флаг Corrupted', () => {
    expect(item.itemLevel).toBe(72);
    expect(item.corrupted).toBe(true);
    expect(item.mirrored).toBe(false);
  });
});

describe('parse: EN Magic кольцо', () => {
  it('имя-суффикс без базового типа, explicit-мод', () => {
    const item = parseItemText(EN_MAGIC_RING);
    expect(item.rarity).toBe('Magic');
    // Квирк парсера: одиночная строка Magic-имени уходит в baseType (name
    // ставится только при второй строке — PoB-аннотация).
    expect(item.name).toBeNull();
    expect(item.baseType).toBe('Coral Ring of Frost');
    expect(item.mods).toContainEqual({
      text: '+18 to maximum Life',
      type: 'explicit',
    });
  });
});

describe('parse: RU локаль', () => {
  const item = parseItemText(RU_NORMAL_ARMOUR);

  it('RU-редкость и RU-Item Level', () => {
    expect(item.rarity).toBe('Normal');
    expect(item.itemLevel).toBe(15);
  });

  it('RU-мод "(неявный)" → implicit', () => {
    const implicit = item.mods.find((m) => m.type === 'implicit');
    expect(implicit?.text).toBe('+10 к максимуму жизни');
  });

  it('RU-броня распознаётся как defensive-стат', () => {
    expect(item.defences.armour).toEqual({ value: 100, augmented: false });
  });
});

describe('parse: EN Unique оружие', () => {
  const item = parseItemText(EN_UNIQUE_WEAPON);

  it('физический и стихийный урон', () => {
    expect(item.offense.physicalDamage).toEqual({ min: 12, max: 22, augmented: false });
    expect(item.offense.elementalDamage).toEqual([
      { min: 5, max: 10, type: 'cold', augmented: false },
      { min: 15, max: 20, type: 'fire', augmented: false },
    ]);
  });

  it('крит и скорость атаки', () => {
    expect(item.offense.critChance).toEqual({ value: 5, augmented: false });
    expect(item.offense.attacksPerSecond).toEqual({ value: 1.2, augmented: false });
  });

  it('требования с несколькими атрибутами в одной строке', () => {
    expect(item.requirements.level).toBe(24);
    expect(item.requirements.strength).toBe(30);
    expect(item.requirements.intelligence).toBe(60);
  });
});

describe('parse: itemDisplayName', () => {
  it('для Rare — имя, для Normal — базовый тип', () => {
    expect(itemDisplayName(parseItemText(EN_RARE_BODY_ARMOUR))).toBe('Cataclysm Raiment');
    expect(itemDisplayName(parseItemText(RU_NORMAL_ARMOUR))).toBe('Ar Armour Plating');
  });
});
