import { describe, expect, it } from 'vitest';
import { normRuEnKey, ruEnExtras, ruEnLocaleMeta, ruModsMeta, ruToEnBase, ruToEnItemClass, ruToEnName, translateRuModLine, translateRuMods } from '../src/ruLocale.js';
import { defenseForItem } from '../src/estimate.js';

describe('ruLocale (items_ru.json, Exiled Exchange 2 MIT)', () => {
  it('датасет загружен и метаданные на месте', () => {
    const meta = ruEnLocaleMeta();
    // Датасет (built 2026-10-08): 2287 item / 766 unique / 861 gem строк
    // + 929 Sidekick-баз (merged 2026-10-24) = 3216 строк. В map меньше
    // (dedup по normKey + ru===en отфильтрованы): ~3197.
    expect(meta.items).toBeGreaterThan(3100);
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

  // ── Additive-слой Sidekick (MIT, merged 2026-10-24): +929 RU-баз ──────────

  it('новые RU-базы из донора Sidekick резолвятся (ruToEnName/ruToEnBase)', () => {
    // До слияния этих RU-имён в датасете не было; EN — из repoe base_items
    // по Metadata-ID донора (см. scripts/_merge_sidekick_ru.mjs).
    expect(ruToEnName('Баклер эгиды')).toBe('Aegis Buckler');
    expect(ruToEnBase('Баклер эгиды')).toBe('Aegis Buckler');
    expect(ruToEnName('Богатая корона')).toBe('Lavish Crown');
    expect(ruToEnName('Такого предмета нет')).toBe(''); // старый промах не сломан
  });

  it('донор даёт metadataId/tradeCat по точному RU-имени (ruEnExtras)', () => {
    // Существующая база, обогащённая Sidekick-baseItemIds.
    expect(ruEnExtras('Абордажная сабля')?.metadataId).toBe(
      'Metadata/Items/Weapons/OneHandWeapons/OneHandSwords/FourOneHandSword9',
    );
    expect(ruEnExtras('Абордажная сабля')?.tradeCat).toBe('weapon');
    // Гем тоже обогащён.
    expect(ruEnExtras('Авангард I')?.metadataId).toBe('Metadata/Items/Gem/SupportGemVanguard');
    // Новая строка донора несёт оба поля.
    const ex = ruEnExtras('Баклер эгиды');
    expect(ex?.metadataId).toBe('Metadata/Items/Armours/Shields/FourShieldDex13');
    expect(ruEnExtras('Нет такого предмета')).toBeUndefined();
  });
});

describe('ruLocale: RU mod-patterns (§5)', () => {
  it('датасеты mods/item_classes загружены (ExE2 stats.ndjson + xiletrade ItemClassTwo, MIT)', () => {
    const meta = ruModsMeta();
    // Сгенерировано gen-ru-locale-data.mjs (2026-10-11): 2449 mods / 89 classes.
    // Датасет может обновиться — проверяем порядок величины, не точное число.
    expect(meta.mods).toBeGreaterThan(2400);
    expect(meta.mods).toBeLessThan(4000);
    expect(meta.classes).toBeGreaterThan(80);
    expect(meta.classes).toBeLessThan(120);
    expect(meta.source).toContain('Exiled-Exchange-2');
    expect(meta.built).toBe('2026-10-11');
  });

  it('моды защиты RU → EN-канон estimate: жизнь/резисты/ES/броня', () => {
    expect(translateRuModLine('+45 к максимуму здоровья')).toBe('+45 to maximum Life');
    expect(translateRuModLine('+28% к сопротивлению молнии')).toBe('+28% to Lightning Resistance');
    expect(translateRuModLine('+48 к максимуму энергетического щита')).toBe('+48 to maximum Energy Shield');
    expect(translateRuModLine('+11 к броне')).toBe('+11 to Armour');
    // alt-форма PoE2 «+11 to Armour» ловится через «(to )?» в estimate — сюда же.
  });

  it('negate-матчер донора: «уменьшение» → минус перед числом', () => {
    const t = translateRuModLine('8% уменьшение максимума энергетического щита');
    expect(t).toBe('-8% increased maximum Energy Shield');
  });

  it('скобки диапазона poe2db/PoB-аннотаций и хвостовые маркеры "(crafted)"', () => {
    expect(translateRuModLine('+45(40-54) к максимуму здоровья')).toBe('+45 to maximum Life');
    expect(translateRuModLine('+11(10-11) к максимуму здоровья (crafted)')).toBe(
      '+11 to maximum Life',
    );
  });

  it('EN-строки и неизвестный RU-текст → null (не identity)', () => {
    expect(translateRuModLine('+45 to maximum Life')).toBeNull();
    expect(translateRuModLine('')).toBeNull();
    expect(translateRuModLine('+5 к счастью гнома')).toBeNull();
  });

  it('translateRuMods проходит немatches насквозь', () => {
    expect(translateRuMods(['+45 to maximum Life', '+28% к сопротивлению молнии'])).toEqual([
      '+45 to maximum Life',
      '+28% to Lightning Resistance',
    ]);
  });

  it('itemClass RU → EN-канон (xiletrade ItemClassTwo, PoE2)', () => {
    expect(ruToEnItemClass('Обувь')).toBe('Boots');
    expect(ruToEnItemClass('Нательные доспехи')).toBe('Body Armours');
    expect(ruToEnItemClass('Боевые посохи')).toBe('Quarterstaves');
    expect(ruToEnItemClass('Фокусы')).toBe('Foci');
    expect(ruToEnItemClass('Boots')).toBe(''); // EN-значение — не переводим
    expect(ruToEnItemClass('')).toBe('');
  });

  it('интеграция: defenseForItem на RU-клире даёт те же числа, что и EN (estimate инжект)', () => {
    const ruText = `Класс предмета: Обувь
Редкость: Редкий
Gale Dash
Wyvernscale Boots
--------
+45 к максимуму здоровья
+28% к сопротивлению молнии
+48 к максимуму энергетического щита
`;
    const enText = `Item Class: Boots
Rarity: Rare
Gale Dash
Wyvernscale Boots
--------
+45 to maximum Life
+28% to Lightning Resistance
+48 to maximum Energy Shield
`;
    const ru = defenseForItem({ slot: 'Boots', name: 'Gale Dash', itemText: ruText });
    const en = defenseForItem({ slot: 'Boots', name: 'Gale Dash', itemText: enText });
    expect(ru.life).toBe(en.life);
    expect(ru.lightningRes).toBe(en.lightningRes);
    expect(ru.energyShield).toBe(en.energyShield);
    expect(en.life).toBeGreaterThan(0); // не «обоим по нулям»
  });
});
