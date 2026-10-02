/**
 * Целевой крафт-план по базе знаний PoE2 0.5.5 (см. docs/crafting_knowledge_base.md).
 *
 * Отличие от старых эвристик ssf.ts: план строится по МЕТОДОЛОГИИ «двух якорей»
 * (maxroll «How to Craft in PoE 2», 0.5-мета) с именованными эссенциями и
 * оменами — «крафт с целью», а не «накинь орбы».
 *
 * Честность (см. правила ядра):
 *  - все механики ниже верифицированы источниками (poe2db.tw, maxroll,
 *    официальные патчноуты 0.5.x) — см. crafting_knowledge_base.md;
 *  - ВЕСА модов нами НЕ известны офлайн — вероятности не считаем и цифры
 *    шансов не выдумываем; вместо этого честная отсылка к poe2db (Weight)
 *    и Craft of Exile (?game=poe2);
 *  - RU-имена эссенций верифицированы по poe2db.tw/ru/Essence (02.10.2026):
 *    RU-локаль — «Сущность X» (не «Эссенция»); Lesser = «Малая …»,
 *    Greater = «Большая …», Perfect = «Совершенная …».
 */

import type { ParsedItem } from './parse.js';

// ─── Верифицированные данные 0.5.5 ─────────────────────────────────────────

/** Действие эссенции по тиру (п.2 базы знаний). */
export type EssenceAction = 'magicToRare' | 'rareReplace';

export interface EssenceInfo {
  /** Каноническое EN-имя (матчится poe2db/CoE). */
  en: string;
  /** RU-имя, если верифицировано (poe2db.tw/ru/Essence); иначе null. */
  ru: string | null;
  /** Гарантированный мод (кратко, русским; диапазон Lesser→Greater). */
  guaranteed: string;
  /** Что даёт Perfect-версия (действует на Rare: удалить случайный мод + добавить этот). */
  perfect?: string;
  /** Что делает эссенция. */
  action: EssenceAction;
  /** Слоты, где эссенция осмысленна. */
  slots: 'weapon' | 'armour' | 'jewellery' | 'any' | 'caster';
}

/**
 * Полная таблица семейств эссенций 0.5.5 — poe2db.tw/us/Essence (проверено
 * 01.10.2026, страница «Essence /95»). Тиры Lesser/Normal/Greater = Magic →
 * Rare + гарантированный мод (диапазон растёт с тиром). Действие Perfect —
 * отдельное (remove random + add), записано в `perfect` каждого семейства.
 */
export const CRAFT_ESSENCES: EssenceInfo[] = [
  // Резисты (Armour/Belt/Jewellery: 11-15 → 21-25 → 31-35%)
  { en: 'Essence of Grounding', ru: 'сущность заземления', guaranteed: '+(11-15)% … +(31-35)% к сопротивлению молнии', perfect: 'Перчатки: (26-30)% урона молнией, полученного при ударах, восполняется жизнью (Recoup)', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Thawing', ru: 'сущность таяния', guaranteed: '+% к сопротивлению холоду (11-15 … 31-35%)', perfect: 'Шлем: (26-30)% урона холодом Recoup жизнью', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Insulation', ru: 'сущность изоляции', guaranteed: '+% к сопротивлению огню (11-15 … 31-35%)', perfect: 'Пояс: (26-30)% урона огнём Recoup жизнью', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Ruin', ru: 'сущность гибели', guaranteed: '+(4-7)% … +(16-19)% к сопротивлению хаосу — самый ценный резист', perfect: 'Броня: (10-15)% физ. урона от ударов принимается как хаос', action: 'magicToRare', slots: 'any' },
  // Жизнь/мана/защита
  { en: 'Essence of the Body', ru: 'сущность тела', guaranteed: '+(30-39) … +(100-119) к жизни (броня/пояс выше, бижутерия ниже)', perfect: 'Броня: +(8-10)% к максимуму жизни', action: 'magicToRare', slots: 'armour' },
  { en: 'Essence of the Mind', ru: 'сущность разума', guaranteed: '+(25-34) … +(90-104) к мане', perfect: 'Кольцо: +(4-6)% к максимуму маны', action: 'magicToRare', slots: 'jewellery' },
  { en: 'Essence of Enhancement', ru: 'сущность улучшения', guaranteed: '(27-42) … (68-79)% брони/уклонения/ЭС', perfect: 'Амулет: (20-30)% глобальной брони/уклонения/ЭС', action: 'magicToRare', slots: 'armour' },
  // Урон оружию (Lesser→Greater: 1H/Bow и 2H/Crossbow разные диапазоны)
  { en: 'Essence of Abrasion', ru: 'сущность разрушения', guaranteed: '+физ. урон оружию (1H 4-6d7-11 … 16-24d28-42; 2H выше)', perfect: '1H/Bow: +(15-20)% урона как Extra Physical (2H: 25-33%)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Flames', ru: 'сущность пламени', guaranteed: '+урон огнём оружию (1H 4-6d7-10 … 35-44d56-71; 2H выше)', perfect: '1H/Bow: +(15-20)% урона как Extra Fire (2H: 25-33%)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Ice', ru: 'сущность льда', guaranteed: '+урон холодом оружию (1H 3-5d6-9 … 31-38d47-59; 2H выше)', perfect: '1H/Bow: +(15-20)% урона как Extra Cold (2H: 25-33%)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Electricity', ru: 'сущность электричества', guaranteed: '+урон молнией оружию (1H 1d13-19 … 1-6d85-107; 2H выше)', perfect: '1H/Bow: +(15-20)% урона как Extra Lightning (2H: 25-33%)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Sorcery', ru: 'сущность колдовства', guaranteed: '+% урона чарам (Focus/Wand 35-44% … 75-89%; Staff 69-88% … 149-188%)', perfect: 'Wand: +3 / Staff: +5 к уровню всех чар', action: 'magicToRare', slots: 'caster' },
  { en: 'Essence of Battle', ru: 'сущность битвы', guaranteed: '+точность (Martial 61-84 … 237-346; Greater — также перчатки/колчан)', perfect: '1H/Bow: +2 к уровню всех атакующих умений (2H: +3)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Haste', ru: 'сущность спешки', guaranteed: '+% скорости атаки (Melee 11-13% … 23-25%; Bow/Crossbow ниже)', perfect: 'Оружие: (20-25)% шанс Onslaught при убийстве ударом', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Seeking', ru: 'сущность искания', guaranteed: '+шанс крита (Martial +1.5-2.1% … +3.1-3.8%; чары: Focus/Wand/Staff — increased)', perfect: 'Броня: удары по тебе — (40-50)% сниженный крит-бонус', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Alacrity', ru: 'сущность живости', guaranteed: '+% скорости каста (Focus/Wand 13-16% … 25-28%; Staff 20-25% … 38-43%)', perfect: 'Focus/Wand: (18-20)% эффективности маны (Staff 28-32%)', action: 'magicToRare', slots: 'caster' },
  // Прочее
  { en: 'Essence of the Infinite', ru: 'сущность бесконечности', guaranteed: '+СИЛ/ЛОВ/ИНТ (9-12 … 25-27)', perfect: 'Амулет: +(7-10)% СИЛ/ЛОВ/ИНТ', action: 'magicToRare', slots: 'jewellery' },
  { en: 'Essence of Opulence', ru: 'сущность изобилия', guaranteed: '+% редкости предметов (боты/перчатки/шлем/бижутерия 6-10 … 15-18%)', perfect: 'Перчатки: +(10-15)% золота с убитых', action: 'magicToRare', slots: 'armour' },
  { en: 'Essence of Command', ru: 'сущность повеления', guaranteed: 'Скипетр: союзники рядом наносят +(35-44 … 75-89)% урона', perfect: 'Скипетр: ауры +(15-20)% силы эффектов', action: 'magicToRare', slots: 'caster' },
];

/** Спец-эссенции (действие как Perfect: Rare — удалить случайный мод + гарантированный), poe2db «Removes a random modifier…». */
export interface SpecEssenceInfo { en: string; perSlot: string }
export const CRAFT_SPEC_ESSENCES: SpecEssenceInfo[] = [
  { en: 'Essence of Hysteria', perSlot: 'Шлем: +1 к уровню умений прислужников · Броня: физ. шипы 64-97d98-145 · Перчатки: +(25-29)% крит-множителя · Боты: +30% скорости бега · Кольцо: +(50-59)% реген маны · Амулет: (19-21)% урона Recoup жизнью · Пояс: +(254-304) порога оглушения · Щит: +(20-24)% блока · Колчан: +(43-50)% урона луками · Фокус: +(20-23)% скорости восстановления ЭС' },
  { en: 'Essence of Delirium', perSlot: 'Броня: даёт случайный Notable из пассивного дерева (Allocation!)' },
  { en: 'Essence of Horror', perSlot: 'Перчатки/боты: +60% эффекта вставленных рун/сокол (Augment Items)' },
  { en: 'Essence of Insanity', perSlot: 'Пояс: при коррупции предмет получает ДВА энчанта' },
  { en: 'Essence of the Abyss', perSlot: 'Любой слот: «Mark of the Abyssal Lord» (Abyssal Depths-дроп)' },
  { en: 'Essence of the Breach', perSlot: 'Бижутерия: +20% к максимуму качества (под катализаторы Breach)' },
];

/** Alloys — валюта Экспедиции (лига Runes of Aldur): Rare — удалить случайный мод + гарантированный; занимают crafted-слот. */
export const CRAFT_ALLOYS: SpecEssenceInfo[] = [
  { en: 'Runic Alloy', perSlot: 'Кольцо: +(37-49) Runic Ward · Амулет: +(6-10)% макс. Runic Ward · Пояс: +(15-20)% реген Runic Ward' },
  { en: 'Adaptive Alloy', perSlot: 'Staff: +(42-52)% урона как Extra Fire без Runic Ward · Wand: +(21-26)% · Скипетр/Перчатки: свои бонусы' },
  { en: 'Protective Alloy', perSlot: 'Пояс: восстановить (32-45) Runic Ward при использовании чарма · Оружие: +(51-74) Runic Ward · Щит: (10-15) Ward при блоке' },
  { en: 'Expansive Alloy', perSlot: 'Броня: +(35-50)% радиуса присутствия · Шлем: +(18-29)% эффективности маны · Боты: +1-2 к лимиту временных прислужников' },
  { en: 'Swift Alloy', perSlot: 'Перчатки: +(9-12)% скорости каста · Кольцо: +(7-9)% скорости атаки · Пояс: фласки +(0.75-1) заряда/сек · Щит/Фокус: +(30-49)% скорости тотемов' },
  { en: 'Cyclonic Alloy', perSlot: 'Броня: −(15-30)% силы замедлений · Боты: +(15-19)% длительности умений · Перчатки: +(20-25)% длительности негатив. состояний · Шлем: +(35-42)% длительности Archon-бафа' },
  { en: 'Prismatic Alloy', perSlot: 'Перчатки: урон пробивает +(9-15)% резистов · Martial: +(20-30)% силы состояний · Focus/Staff/Wand: +(40-50)% эффекта Exposure' },
  { en: 'Mystic Alloy', perSlot: 'Шлем: +(10-15)% области чар · Перчатки: +(10-15)% области атак · Боты: +(10-15) духа · Колчан: +(25-35)% шанс доп. цепи · Caster-оружие: +1 к лимиту элементных инфузий' },
  { en: 'Sovereign Alloy', perSlot: 'Оружие: +(20-30)% эффекта вставленных рун/сокол · Броня: +(24-30)% Runic Ward · Бижутерия/пояс: +(20-30)% величины резист-модов' },
  { en: 'Celestial Alloy', perSlot: 'Staff/Wand: +(142-188) маны и +1 к уровню всех чар · Martial: +(327-427) точности и +(5-8)% скорости атаки' },
  { en: 'Transcendent Alloy', perSlot: 'Staff: +(39-47)% скорости каста, +(11-16)% элем. урона как Extra Cold · Focus/Wand: +(26-31)% каст, +(7-11)% Extra Cold · Martial: +(15-20)% физ. урона, +(7-10) ко всем атрибутам' },
  { en: "The Runebinder's Alloy", perSlot: 'Staff: (25-50)% шанс Nature Archon при переросте растений · Wand: +1 к лимиту элементных умений · Скипетр: +(4-5) стаков Puppet Master · Crossbow: +2 баллиста-тотема · Bow: +(40-50)% эффекта Mark-умений' },
  { en: "The Runefather's Alloy", perSlot: 'Mace: (60-75)% шанс сохранить 40% Glory · Quarterstaff: Tempest Bells +4-5 ударов · Spear: +(8-10) к дальности оружия · Talisman: молния даёт Flammability/Ignite' },
];

/** Perfect-эссенции (действие: удалить случайный мод у Rare + добавить гарантированный). */
export const CRAFT_PERFECT_ESSENCES_HINT =
  'Perfect-версия (действует на Rare: удаляет случайный мод и добавляет гарантированный; ' +
  'с Omen of Sinistral/Dextral Crystallisation удаление — только нужная сторона)';

export interface OmenInfo {
  en: string;
  purpose: string;
  /** Где/почём дропает или статус дропа (напр. «не дропается с 0.3.0, существующие работают»). */
  drop?: string;
}

/**
 * Полный список оменов 0.5.5 — poe2db.tw/us/Omen (проверено 01.10.2026,
 * страница «Omen /50»); статусы дропа — версия-история poe2wiki «Omen».
 * Активируется правым кликом; меняет поведение СЛЕДУЮЩЕЙ валюты; после
 * срабатывания расходуется. Связанные омены стакаются, несовместимые —
 * деактивируют прежний (poe2wiki «Omen»).
 *
 * Патчноуты 0.5.0 (pathofexile.com/forum/view-thread/3932540, проверено 02.10.2026):
 * Omen of Recombination УДАЛЁН; Omen of Corruption — unobtainable; Catalysts больше
 * не дропаются (только Genesis Tree); Abyss-омены не дропаются ниже monster level 65;
 * все награды эндгейм-Ritual — только Unique или Omens; новый Omen of Chaotic
 * Effectiveness (до 3 одновременно).
 */
export const CRAFT_OMENS: OmenInfo[] = [
  // Chaos Orb
  { en: 'Omen of Whittling', purpose: 'Chaos Orb удалит мод МИНИМАЛЬНОГО уровня (не случайный)' },
  { en: 'Omen of Sinistral Erasure', purpose: 'Chaos Orb удалит ТОЛЬКО префиксы', drop: 'дорогой, хай-энд' },
  { en: 'Omen of Dextral Erasure', purpose: 'Chaos Orb удалит ТОЛЬКО суффиксы', drop: 'дорогой, хай-энд' },
  // Orb of Alchemy
  { en: 'Omen of Sinistral Alchemy', purpose: 'Orb of Alchemy даст максимум префиксов', drop: '⚠️ не дропается с 0.3.0; существующие работают' },
  { en: 'Omen of Dextral Alchemy', purpose: 'Orb of Alchemy даст максимум суффиксов', drop: '⚠️ не дропается с 0.3.0; существующие работают' },
  // Regal Orb
  { en: 'Omen of Sinistral Coronation', purpose: 'Regal Orb добавит только префикс', drop: '⚠️ не дропается с 0.3.0; существующие работают' },
  { en: 'Omen of Dextral Coronation', purpose: 'Regal Orb добавит только суффикс', drop: '⚠️ не дропается с 0.3.0; существующие работают' },
  { en: 'Omen of Homogenising Coronation', purpose: 'Regal добавит мод ТИПА существующего на предмете', drop: '⚠️ отключён с 0.4.0; существующие работают' },
  // Exalted Orb
  { en: 'Omen of Greater Exaltation', purpose: 'Exalted Orb добавит ДВА мода' },
  { en: 'Omen of Sinistral Exaltation', purpose: 'Exalted Orb добавит только ПРЕФИКС' },
  { en: 'Omen of Dextral Exaltation', purpose: 'Exalted Orb добавит только СУФФИКС' },
  { en: 'Omen of Homogenising Exaltation', purpose: 'Exalted Orb добавит мод типа существующего', drop: '⚠️ отключён с 0.4.0; существующие работают' },
  { en: 'Omen of Catalysing Exaltation', purpose: 'Exalted Orb съест качество катализаторов ради шанса мода их тега' },
  // Orb of Annulment
  { en: 'Omen of Greater Annulment', purpose: 'Orb of Annulment удалит ДВА мода', drop: '⚠️ не дропается с 0.3.0; существующие работают' },
  { en: 'Omen of Sinistral Annulment', purpose: 'Orb of Annulment удалит только префиксы' },
  { en: 'Omen of Dextral Annulment', purpose: 'Orb of Annulment удалит только суффиксы' },
  { en: 'Omen of Light', purpose: 'Orb of Annulment удалит ТОЛЬКО desecrated-мод (перезапуск провала Дезекрации)' },
  // Perfect/Corrupted Essence
  { en: 'Omen of Sinistral Crystallisation', purpose: 'Perfect/Corrupted-эссенция удалит только префиксы' },
  { en: 'Omen of Dextral Crystallisation', purpose: 'Perfect/Corrupted-эссенция удалит только суффиксы' },
  // Desecration (Abyss)
  { en: 'Omen of Sinistral Necromancy', purpose: 'Desecration добавит только префиксы' },
  { en: 'Omen of Dextral Necromancy', purpose: 'Desecration добавит только суффиксы' },
  { en: 'Omen of Abyssal Echoes', purpose: 'Один переролл тройки опций Well of Souls при раскрытии' },
  { en: 'Omen of the Sovereign', purpose: 'Desecration оружия/бижутерии даст случайный Ulaman-мод' },
  { en: 'Omen of the Liege', purpose: 'Desecration оружия/бижутерии даст случайный Amanamu-мод' },
  { en: 'Omen of the Blackblooded', purpose: 'Desecration оружия/бижутерии даст случайный Kurgal-мод' },
  { en: 'Omen of Putrefaction', purpose: 'Desecration заменит ВСЕ моды предмета (до 6 нераскрытых) и скорруптит его', drop: 'экстремальный риск' },
  // Divine / Vaal / Chance
  { en: 'Omen of the Blessed', purpose: 'Divine Orb рероллит только ИМПЛИЦИТЫ' },
  { en: 'Omen of Sanctification', purpose: 'Divine Orb на Rare — Sanctify (без негатива)' },
  { en: 'Omen of Corruption', purpose: 'Vaal Orb ВСЕГДА изменит предмет (без исхода «ничего»)', drop: '⚠️ unobtainable с 0.5.0 (патчноут); существующие работают' },
  { en: 'Omen of Chance', purpose: 'Orb of Chance НЕ уничтожит предмет при провале' },
  { en: 'Omen of the Ancients', purpose: 'Orb of Chance апгрейдит до случайного уника того же класса' },
  // Waystone-плитки
  { en: 'Omen of Chaotic Rarity', purpose: 'Chaos на плитке заменит моды на НЕ дающие Item Rarity' },
  { en: 'Omen of Chaotic Quantity', purpose: 'Chaos на плитке заменит моды на НЕ дающие Pack Size' },
  { en: 'Omen of Chaotic Monsters', purpose: 'Chaos на плитке заменит моды на НЕ дающие Monster Rarity' },
  { en: 'Omen of Chaotic Effectiveness', purpose: 'Chaos на плитке заменит моды на НЕ дающие Monster Effectiveness' },
  // Экспедиция-саги (Logbook)
  { en: "Aldur's Saga", purpose: 'Следующий Logbook добавит спец-моды в раскрытые Grand Expedition-зоны', drop: 'Expedition' },
  { en: "Medved's Saga", purpose: 'Следующий Logbook гарантирует встречу Medved', drop: 'Expedition' },
  { en: "Vorana's Saga", purpose: 'Следующий Logbook гарантирует встречу Vorana', drop: 'Expedition' },
  { en: "Uhtred's Saga", purpose: 'Следующий Logbook гарантирует встречу Uhtred', drop: 'Expedition' },
  { en: "Olroth's Saga", purpose: 'Следующий Logbook гарантирует встречу Olroth', drop: 'Expedition' },
  // Некрафтовые (кратко)
  { en: 'Omen of Refreshment', purpose: 'При Low Life полностью восстановить заряды фласок/чармов', drop: 'некрафтовый' },
  { en: 'Omen of Resurgence', purpose: 'При Low Life полностью восстановить жизнь/ману/ЭС', drop: 'некрафтовый' },
  { en: 'Omen of Amelioration', purpose: 'При смерти сохранить 75% опыта (смягчение потери)', drop: 'некрафтовый' },
  { en: 'Omen of Answered Prayers', purpose: 'Следующий Святилище (Shrine) даст дополнительный эффект', drop: 'некрафтовый' },
  { en: 'Omen of Secret Compartments', purpose: 'Следующий Strongbox можно открыть повторно', drop: 'некрафтовый' },
  { en: 'Omen of the Hunt', purpose: 'Следующий Possessed-монстр выпустит всех Azmeri-духов', drop: 'Wildwood' },
  { en: 'Omen of Reinforcements', purpose: 'Следующий Rogue Exile призовёт союзника', drop: 'некрафтовый' },
  { en: 'Omen of Gambling', purpose: 'Следующая покупка-гэмблинг: 50% шанс бесплатно', drop: 'некрафтовый' },
  { en: 'Omen of Bartering', purpose: 'Следующая продажа — вендор «ошибётся» в твою пользу', drop: 'некрафтовый' },
];

// ─── №130: Полный каталог крафт-систем/рецептов 0.5.5 ────────────────────────
// Источник каждой записи — docs/crafting_knowledge_base.md (§1–§5), все
// механики верифицированы (пометки ✅ в базе). Веса/шансы не выдумываем.

export type CraftSystem =
  | 'currency'
  | 'essence'
  | 'omen'
  | 'rune'
  | 'quality'
  | 'bench'
  | 'desecration'
  | 'special'
  | 'waystone';

export interface CraftRecipe {
  id: string;
  system: CraftSystem;
  name: string;
  /** Рецепт: что делаем + чем + результат. */
  recipe: string;
  /** SSF-примечание (когда жечь, чем заменить). */
  ssfNote?: string;
}

/** Все крафтовые рецепты PoE2 0.5.5, известные киту (см. базы знаний §1–§5). */
export const CRAFT_RECIPES: CraftRecipe[] = [
  // §1 Базовая валюта (линейки Greater: floor 44/35, Perfect: 70/50)
  { id: 'transmute', system: 'currency', name: 'Orb of Transmutation (G/P)', recipe: 'White → Magic (+1 мод). Greater — минимальный уровень мода 44, Perfect — 70: мусорные тиры вырезаны из пула.', ssfNote: 'Расходник основы; G-версия экономит дешёвые резисты на бижутерии.' },
  { id: 'augment', system: 'currency', name: 'Orb of Augmentation (G/P)', recipe: 'Magic +1 мод (доливает второй слот Magic 1+1).', ssfNote: 'Расходник №1 по объёму.' },
  { id: 'regal', system: 'currency', name: 'Regal Orb (G/P)', recipe: 'Magic → Rare (+1 мод; полный набор дальше слэмится Exalt).', ssfNote: 'С оменом Sinistral/Dextral Coronation — таргет-сторона.' },
  { id: 'alchemy', system: 'currency', name: 'Orb of Alchemy', recipe: 'White/Magic → Rare сразу 4 мода.', ssfNote: 'Дороже PoE1-аналога: в SSF жечь только на базе ilvl 81+.' },
  { id: 'exalt', system: 'currency', name: 'Exalted Orb (G/P)', recipe: 'Rare +1 мод (слэм).', ssfNote: '«Валюта» PoE2: основной ресурс эндгейм-крафта.' },
  { id: 'chaos', system: 'currency', name: 'Chaos Orb (G/P)', recipe: 'Удалить 1 случайный мод + добавить 1 (НЕ реролл всего предмета).', ssfNote: 'Чистка с оменами Whittling/Erasure; без оменов — только на расходных слотах.' },
  { id: 'annul', system: 'currency', name: 'Orb of Annulment', recipe: 'Удалить случайный мод.', ssfNote: 'С Omen of Light — снять только desecrated-мод (перезапуск провала Дезекрации).' },
  { id: 'divine', system: 'currency', name: 'Divine Orb', recipe: 'Рероллить числа модов ВНУТРИ их тиров.', ssfNote: 'Топ-капитал: только на готовом предмете, у которого правильные моды.' },
  { id: 'vaal', system: 'currency', name: 'Vaal Orb', recipe: 'Коррупт: +1 сокет / реролл части модов / энчант / ничего (случайный исход).', ssfNote: 'Финализатор — последним, когда терять предмет уже не страшно.' },
  { id: 'chance', system: 'currency', name: 'Orb of Chance', recipe: 'White → Unique (шанс) ИЛИ уничтожить предмет.', ssfNote: 'Гэмблинг: только на базы, уникальный вариант которых реально нужен.' },
  { id: 'fracturing', system: 'currency', name: 'Fracturing Orb', recipe: 'Закрепить (фракчер) случайный мод на Rare с 4+ модами — мод переживёт дальнейший крафт.', ssfNote: 'Атласный дроп, high-end; закрепится случайный мод — только на предмете, где «любой из 4 не жалко».' },
  { id: 'hinekora', system: 'currency', name: "Hinekora's Lock", recipe: 'Показать результат СЛЕДУЮЩЕЙ валюты до её применения (без расхода при отказе).', ssfNote: 'Планирование Perfect-крафта: лочим, смотрим, отменяем плохое.' },
  { id: 'artificer', system: 'currency', name: "Artificer's Orb", recipe: "Добавить augment-сокет предмету (из 10 Artificer's Shards с Salvage Bench).", ssfNote: 'Путь к рунам/соколам; шардья копятся разборкой мусора.' },
  { id: 'extraction', system: 'currency', name: 'Orb of Extraction', recipe: 'Уничтожить предмет, вернуть сокетабл (руну/сокол).', ssfNote: 'Спасение дорогой руны из провального предмета.' },
  { id: 'jeweller', system: 'currency', name: "Jeweller's Orb (L/G/P)", recipe: '3/4/5 сокета саппортов камню навыка.', ssfNote: 'Камни — отдельная трата; 5 сокетов — Perfect, только на основной сетап.' },
  // §1 Мифы (запрещённые рецепты PoE1)
  { id: 'no-scouring', system: 'special', name: 'НЕТ Scouring/Alteration/Regret/Chromatic', recipe: 'Удалены из PoE2 — «откатить» предмет нельзя, а кулер не крафтится Color Orb-ом.', ssfNote: 'Вали проигранного редкого — Salvage/Reforging Bench, не «пере-альтить».' },
  { id: 'one-crafted', system: 'special', name: 'ОДИН crafted-мод на предмет', recipe: 'Эссенции и Alloys делят один crafted-слот: вторая эссенция мод НЕ заменит, а зря сгорит.', ssfNote: 'Якорь выбирай один раз — затем только Exalt/Chaos/Desecration.' },
  // §5 Спец-системы
  { id: 'alloy', system: 'special', name: 'Alloys (Runes of Aldur)', recipe: 'Экспедиция-валюта: добавить гарантированный мод, заменив случайный (занимает crafted-слот).', ssfNote: 'Прямой таргет-инструмент достать сложно — беречь для ключевого слота.' },
  { id: 'flux', system: 'special', name: 'Flux-валюта (Blazing/Chilling/Crackling/Void)', recipe: 'Конвертировать резист на предмете в другой тип (fire→cold и т.п.).', ssfNote: 'Спасение «не того» резиста на готовом предмете без переделки.' },
  { id: 'runeforging', system: 'special', name: 'Runeforging (Verisium, Ward)', recipe: "Ward-моды и апгрейд уникального оружия (Aldur's Legacy руна из уникала, Uhtred's Sidereum — Chronomancy-моды в пул ботинок).", ssfNote: 'Система нишевая; для CI-Invoker не приоритет.' },
  // §2 Эссенции (полная таблица — CRAFT_ESSENCES выше) + правило Perfect
  { id: 'essence-anchor', system: 'essence', name: 'Lesser/Normal/Greater эссенция — якорь №1', recipe: 'Magic → Rare + ГАРАНТИРОВАННЫЙ мод (таблица модов — CRAFT_ESSENCES). Тир ограничен ilvl базы.', ssfNote: 'Ядро SSF-крафта: резисты/ЭС/урон детерминантом, без лотереи.' },
  { id: 'essence-perfect', system: 'essence', name: 'Perfect эссенция', recipe: 'Rare: удалить случайный мод + добавить гарантированный (аналог управляемого Chaos).', ssfNote: 'С Omen of Sinistral/Dextral Crystallisation удаление — только нужная сторона.' },
  // §3 Омены (полная таблица — CRAFT_OMENS выше)
  { id: 'omen-rule', system: 'omen', name: 'Омены = детерминизм слэмa', recipe: 'Активный омен меняет поведение СЛЕДУЮЩЕЙ валюты: сторона слэма, число модов, что удалится (таблица — CRAFT_OMENS).', ssfNote: 'Дроп: Ritual/Tribute; дорогие Erasure — только на хай-энде.' },
  // §4 Руны, сокеты, качество
  { id: 'rune-socket', system: 'rune', name: 'Augment-сокет: руна', recipe: '2 сокета: body/2H; 1: 1H/шлем/перчатки/боты/щит/фокус. Руны Lesser→Perfect; две ОДИНАКОВЫЕ = усиленный «Bonded»-бонус.', ssfNote: 'Комбинирование рун 3:1 на Reforging Bench — апгрейд тира из мусора.' },
  { id: 'soul-core', system: 'rune', name: 'Soul Cores (+ Jiquani\u2019s)', recipe: "Сокеты: Trial of Chaos-соколы, сильнее рун (Limited 1). Jiquani's Soul Cores (Forbidden Rites): «+1 к уровню Strike/Storm/Herald/… умений» на оружии. Atziri's — детерминированная коррупция («всегда изменит»).", ssfNote: 'Актуальный путь к +уровням скиллов в 0.5.5.' },
  { id: 'quality-weapon', system: 'quality', name: 'Качество оружия', recipe: "Blacksmith's Whetstone: +1% more физ. урона за 1% (макс 20%; Vaal Infusers — +10% сверх с риском коррупта).", ssfNote: 'Дёшево и навсегда — делать на любом рабочем оружии.' },
  { id: 'quality-armour', system: 'quality', name: 'Качество брони', recipe: "Armourer's Scrap: +1% more защиты за 1% (макс 20%).", ssfNote: 'Аналогично — дешёвый апгрейд.' },
  { id: 'quality-caster', system: 'quality', name: 'Качество жезлов/посохов', recipe: "Arcanist's Etcher для основы; Glassblower's Baubles — фласки; GCP — гемы.", ssfNote: 'Фласки/гемы качаются первым делом — это чистый бонус.' },
  { id: 'quality-jewellery', system: 'quality', name: 'Катализаторы (бижутерия)', recipe: 'Теговые катализаторы (Breach): +Quality и усиление модов своего тега; Omen of Catalysing Exaltation жрёт это качество ради шанса мода нужного тега.', ssfNote: ' Essence of the Breach: +20% max quality кольцам.' },
  { id: 'quality-waystone', system: 'waystone', name: "Cartographer's Chisel", recipe: 'Качество Waystone-плитки: повышает силу её модов при активации карты.', ssfNote: 'Стандартный расходник на T15–16 перед коррупцией.' },
  // §5 Бенчи и Desecration
  { id: 'salvage', system: 'bench', name: 'Salvage Bench (Act 1)', recipe: 'Разборка предмета → материалы + Artificer\u2019s Shards.', ssfNote: 'Мусорный рарник → шардья сокетов; точная доля возврата ❓ (база знаний).' },
  { id: 'reforge', system: 'bench', name: 'Reforging Bench (Act 3, Ziggurat)', recipe: '3 одинаковых → 1 новая база того же типа (базы, руны, соколы, эссенции; 3 Magic → 1 Rare-заготовка; шанс Greater у эссенций — ~2.5% краудсорс ❓).', ssfNote: 'Рецикл ВСЕХ провальных крафтов — не выбрасывать слабые краты.' },
  { id: 'desecration', system: 'desecration', name: 'Desecration (Abyss) — якорь №2', recipe: 'Preserved Rib (броня) / Jawbone (оружие) / Collarbone (бижутерия) → скрытый desecrated-мод → Well of Souls: выбор 1 из 3. Слот отдельный (crafted не занимает). На 4-модовом — новый 4-й мод; на 6-модовом — замена случайного.', ssfNote: 'Управление: Sinistral/Dextral Necromancy (сторона), Abyssal Echoes (переролл тройки). Провал: Omen of Light + Annulment → повтор.' },
  // Waystone-плитки (§ панели Плитки, poe2wiki 30.09.2026)
  { id: 'waystone-t16', system: 'waystone', name: 'Тир 16 — только коррупция Т15', recipe: 'Vaal Orb на Т15: 25% шанс «тир ±1» (исходы: ничего / тир±1 / лок префиксов+reroll суффиксов (или наоборот) / лок обоих + 0–4 доп. мода до 8).', ssfNote: 'Единственный путь к Т16; корруптить только готовую Т15.' },
  { id: 'waystone-31', system: 'waystone', name: '3:1 перековка тиров', recipe: 'Reforging Bench: 3 плитки одинакового тира и редкости → 1 плитка тиром выше.', ssfNote: 'Стабильный ап-тир без риска — основной SSF-путь Т10→Т15.' },
  { id: 'waystone-omen', system: 'waystone', name: 'Omens для плиток', recipe: 'Omen of Chaotic Rarity/Quantity/Monsters/Effectiveness — реролл модов карты без потери нужного.', ssfNote: 'Ritual-дроп; беречь для T15–16.' },
  { id: 'waystone-mods', system: 'waystone', name: 'Правило модов плитки', recipe: 'Модов до 6 (3 префикса + 3 суффикса), обычная/волшебная/редкая; моды переносятся на карту при активации; каждый явный мод = −1 возрождение карты (6 без модов → 0 при 6+).', ssfNote: 'Жирная карта = без права на ошибку: сначала выживаемость, потом жадность.' },
];

// Waystone-плитки: базовый класс в EN-клиенте — «Waystones»; RU-имя не
// верифицировано живым логом — матчим и «плитк» (терминология панели «Плитки»).
const WAYSTONE_RE = /waystone|плитк/i;

/**
 * №130: крафт-план для Waystone-плитки (источник: панель «Плитки»,
 * poe2wiki.net «Waystone», проверено 30.09.2026; см. CRAFT_RECIPES system='waystone').
 */
export function waystoneCraftPlan(input: CraftPlanInput): CraftPlanStep[] {
  const ilvl = input.itemLevel ?? null;
  const tier = input.parsed ? waystoneTierFromText(input.parsed) : null;
  return [
    {
      step: tier ? `1. Плитка тира ${tier}: выбор стратегии` : '1. Определи тир плитки (строка «Waystone Tier» в описании)',
      detail:
        (tier != null && tier >= 15
          ? `Тир ${tier}: цель — Т16, путь один — коррупция Vaal Orb (см. шаг 3). `
          : tier != null && tier >= 10
            ? `Тир ${tier}: до Т15 — стабильный путь 3:1 перековки (шаг 2), дальше только коррупция. `
            : 'Низкие тиры: не вкладывать валюту — фарм и 3:1 перековка. ') +
        'Модов до 6 (3 префикса + 3 суффикса); моды переносятся на карту при активации.',
    },
    {
      step: '2. Ап-тир без риска: Reforging Bench 3:1',
      detail:
        '3 плитки ОДИНАКОВОГО тира и редкости → 1 плитка тиром выше (Act 3, Ziggurat Encampment). ' +
        (ilvl != null ? `ilvl предмета ${ilvl} — влияет на пул модов новой плитки. ` : '') +
        'Основной SSF-путь от Т10 к Т15; неудачные дубликаты — не выбрасывать, копить в тройки. ' +
        'Пороги тиров → уровни зоны верифицированы (WAYSTONE_TIERS, endgame.ts: T1=65 … T16=80, poe2db).',
    },
    {
      step: '3. Т16 — только коррупция Т15 (25% тир±1)',
      detail:
        'Vaal Orb на Т15: исходы по 25% каждый — ничего · тир ±1 · лок префиксов + реролл суффиксов (или наоборот, игнор лимита) · лок обоих + 0–4 доп. мода (до 8 всего). ' +
        'Единственный путь к Т16. Корруптить только готовую Т15 с нужными модами; перед этим — Omen of Chaotic-серия (реролл отдельных групп модов без потери остальных).',
    },
    {
      step: '4. Качество и омены перед активацией',
      detail:
        "Cartographer's Chisel: качество плитки — усиливает её моды при активации карты. " +
        'Omens (Ritual-дроп): Chaotic Rarity/Quantity/Monsters/Effectiveness — точечно рероллят нужную группу модов. Беречь для Т15–16.',
    },
    {
      step: '5. Правило возрождений: жирная карта = без права на ошибку',
      detail: 'Каждый явный мод плитки = −1 возрождение карты: 6 без модов → 0 при 6+ модах. ' +
        'Сначала выживаемость билда (чекап Ctrl+F7), потом жадные моды количества/редкости.',
    },
  ];
}

/** Тир Waystone из разобранного текста (моды + сырые секции: «Waystone Tier 15» / «Тир: 15»). */
function waystoneTierFromText(parsed: ParsedItem): number | null {
  const texts: string[] = (parsed.mods || []).map((x) => x.text);
  for (const sec of parsed.sections || []) texts.push(...sec);
  for (const t of texts) {
    const m = /(?:waystone\s*)?(?:tier|тир)\D{0,4}(\d{1,2})/i.exec(t);
    if (m) return parseInt(m[1]!, 10);
  }
  return null;
}

// ─── Определение роли предмета ─────────────────────────────────────────────

const WEAPON_RE = /quarterstaff|quarterstave|staff|sceptre|bow|crossbow|wand|mace|sword|axe|claw|dagger|spear|flail|weapon|weapon Set/i;
const CASTER_RE = /wand|staff|sceptre|focus/i;
const ARMOUR_RE = /body armour|gloves|boots|helmet|shield|quiver|armour|доспех/i;
const JEWEL_RE = /ring|amulet|belt|jewel/i;

type SlotRole = 'weapon' | 'armour' | 'jewellery' | 'other';

function slotRole(itemClass: string, baseType: string): SlotRole {
  const s = `${itemClass} ${baseType}`;
  if (WEAPON_RE.test(s)) return 'weapon';
  if (JEWEL_RE.test(s)) return 'jewellery';
  if (ARMOUR_RE.test(s)) return 'armour';
  return 'other';
}

function isCaster(itemClass: string, baseType: string): boolean {
  return CASTER_RE.test(`${itemClass} ${baseType}`);
}

/** Подбор якорных эссенций под роль слота (список, а не одна: цель выбирает игрок). */
export function essenceSuggestions(itemClass: string, baseType: string): EssenceInfo[] {
  const role = slotRole(itemClass, baseType);
  const caster = isCaster(itemClass, baseType);
  return CRAFT_ESSENCES.filter((e) => {
    if (role === 'weapon') return caster ? e.slots === 'caster' || e.slots === 'weapon' : e.slots === 'weapon';
    if (role === 'armour') return e.slots === 'armour' || e.slots === 'any';
    if (role === 'jewellery') return e.slots === 'jewellery' || e.slots === 'any';
    return e.slots === 'any';
  }).slice(0, 6);
}

function fmtEss(e: EssenceInfo): string {
  const ru = e.ru ? ` (в игре: «…${e.ru}…») ` : ' (EN-имя для poe2db; в RU-клиенте ищи по слову «сущность») ';
  return `${e.en}${ru}→ ${e.guaranteed}`;
}

// ─── Генератор плана ──────────────────────────────────────────────────────

export interface CraftPlanStep {
  step: string;
  detail: string;
}

export interface CraftPlanInput {
  itemClass?: string;
  baseType?: string;
  /** Item Level предмета-донора базы (null — неизвестен). */
  itemLevel?: number | null;
  /** Редкость текущего предмета (если крафтим существующий). */
  rarity?: string;
  /** Опционально: разобранный предмет со своими модами (для контекста). */
  parsed?: ParsedItem;
}

/**
 * Целевой план крафта «двух якорей» (0.5-мета, верифицировано —
 * docs/crafting_knowledge_base.md §6). Шаги нумеруются вызывающим.
 */
export function craftPlan(input: CraftPlanInput): CraftPlanStep[] {
  // №130: Waystone-плитка — отдельная методология (ап-тиры/коррупция, не аффикс-крафт)
  if (WAYSTONE_RE.test(`${input.itemClass ?? ''} ${input.baseType ?? ''}`)) {
    return waystoneCraftPlan(input);
  }
  const role = slotRole(input.itemClass ?? '', input.baseType ?? '');
  const ilvl = input.itemLevel ?? null;
  const ess = essenceSuggestions(input.itemClass ?? '', input.baseType ?? '')[0];
  const essList = essenceSuggestions(input.itemClass ?? '', input.baseType ?? '');
  const suggestions = essList.map(fmtEss).join('; ');
  const essenceLine = ess
    ? `${fmtEss(ess)}. Кандидаты под этот слот: ${suggestions}`
    : 'Подбери эссенцию по цели: резисты — Grounding/Thawing/Insulation/Ruin, ЭС — Enhancement, урон оружию — Abrasion/Electricity/Ice';

  const steps: CraftPlanStep[] = [
    {
      step: '1. Определи ЦЕЛЬ: 3 префикса + 3 суффикса',
      detail:
        'Выпиши 6 целевых аффиксов на этот слот ДО начала (Rare = 3 префикса + 3 суффикса в PoE2). ' +
        'Проверь пул модов и их веса на poe2db (страница класса, якорь #ModifiersCalc: Level = требуемый ilvl тира, Weight = вес в пуле) — ' +
        'вероятность мода = weight/Σweight открытой стороны, среднее число Exalted = 1/p. Калькулятор: Craft of Exile (?game=poe2).',
    },
    {
      step: '2. База: Magic с нужным модом, ilvl под главный тир',
      detail:
        (ilvl != null && ilvl < 81
          ? `ilvl базы ${ilvl} — тиры T1 (моды уровня 81–82) на неё НЕ выпадут; для топ-резистов нужна база ilvl 81+. `
          : 'Для T1-модов (вкл. резисты 41–45%) база должна быть ilvl 81–82. ') +
        'Крафт начинается с Magic-предмета, на котором УЖЕ есть нужный мод (дроп/фильтр), а не с белого и не с рандомного Rare.',
    },
    {
      step: '3. Якорь №1 (crafted-слот): Greater-эссенция',
      detail:
        essenceLine + '. Greater-эссенция: Magic → Rare с ГАРАНТИРОВАННЫМ модом (аналог Regal без случайности). ' +
        '⚠️ На предмете может быть только ОДИН crafted-мод (эссенции/Alloys делят слот) — спам эссенций мёртв.',
    },
    {
      step: '4. Якорь №2 (desecrated-слот): кость Бездны + Well of Souls',
      detail:
        'Desecration (Abyss): Preserved Rib (броня) / Jawbone (оружие) / Collarbone (бижутерия) → скрытый мод → Well of Souls: выбор 1 из 3. ' +
        'Слот отдельный, crafted не занимает. Управление: Omen of Sinistral/Dextral Necromancy (только нужная сторона), Abyssal Echoes (переролл тройки). ' +
        'Провал: Omen of Light + Orb of Annulment — снять только desecrated-мод и повторить.',
    },
    {
      step: '5. Заполнение: Greater/Perfect Exalted + омен стороны',
      detail:
        'Greater/Perfect-валюта поднимает минимальный уровень мода (44/70 для Transmute+Augment; 35/50 для Exalt/Regal/Chaos) — мусорные тиры вырезаются из пула. ' +
        'Сторона: Omen of Sinistral/Dextral Exaltation (slam только по префиксам/суффиксам). Финальный слем: Omen of Greater Exaltation (+2 мода).',
    },
    {
      step: '6. Чистка: Chaos-орб с оменом',
      detail:
        'В PoE2 Chaos Orb = «удалить 1 случайный мод + добавить 1», НЕ реролл. Управление: Omen of Whittling (уберёт худший мод), ' +
        'Omen of Sinistral/Dextral Erasure (только нужная сторона; дорогие — жечь только на хай-энде).',
    },
    {
      step: '7. Финал: Divine → (опц.) Fracturing → Vaal',
      detail:
        'Divine Orb рероллит только числа в рамках тиров — жги на почти готовом предмете. Fracturing Orb закрепит случайный мод на Rare с 4+ модами. ' +
        'Vaal Orb — самым последним (риск: +1 сокет / реролл модов / энчант / ничего).',
    },
    {
      step: 'SSF-провал: Reforging Bench 3→1, не жечь Perfect-валюту',
      detail:
        'Провалившийся крафт — в Reforging Bench (Act 3): 3 одинаковых → 1 новая база того же типа (3 Magic → Rare-заготовка). ' +
        'Divine/Prefect-валюта и Erasure-омены — только когда база уже ilvl 81+ и план доведён до конца.',
    },
  ];

  // Слот-специфика: подсказка по роли
  if (role === 'weapon') {
    steps.splice(2, 0, {
      step: '2a. Оружие: сокеты-руны и +уровни умений',
      detail:
        'Augment-сокеты: руны (Greater/Perfect тиры; две ОДИНАКОВЫЕ руны = усиленный «Bonded»-бонус) или Soul Cores (Trial of Chaos). ' +
        '«+1 к уровню умений» на оружии — soket-валюта Jiquani\u2019s Soul Core (лига Forbidden Rites), НЕ крафт. Качество меча: Blacksmith\u2019s Whetstone (+1% more физ. урона за 1%).',
    });
  }
  if (role === 'armour') {
    steps.splice(2, 0, {
      step: '2a. Броня: качество и руны',
      detail:
        'Качество (макс 20%): Armourer\u2019s Scrap (+1% more защиты за 1%). Augment-сокеты на body — 2 (руны Iron/Body/Mind/Stone), на шлем/перчатки/боты — 1. ' +
        'Резист-эссенции (Grounding/Thawing/Insulation/Ruin) — главный SSF-инструмент добивания 75% капов.',
    });
  }
  if (role === 'jewellery') {
    steps.splice(2, 0, {
      step: '2a. Бижутерия: лучший слот для Greater-валюты',
      detail:
        'Кольца/амулеты — сильный пул модов даже на низком ilvl: Greater Transmutation/Augmentation здесь дают максимум за редкую в SSF валюту. ' +
        'Катализаторы (Breach) дают Quality + усиливают моды своего тега; Omen of Catalysing Exaltation жрёт это качество ради таргет-префикса.',
    });
  }
  return steps;
}
