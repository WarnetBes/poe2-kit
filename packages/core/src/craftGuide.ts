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
 *  - RU-имена эссенций даём только верифицированные (из логов живого
 *    RU-клиента: «сущность заземления»); остальные — канонические EN
 *    (по ним матчатся poe2db/CoE), с пометкой искать в игре по слову
 *    «сущность».
 */

import type { ParsedItem } from './parse.js';

// ─── Верифицированные данные 0.5.5 ─────────────────────────────────────────

/** Действие эссенции по тиру (п.2 базы знаний). */
export type EssenceAction = 'magicToRare' | 'rareReplace';

export interface EssenceInfo {
  /** Каноническое EN-имя (матчится poe2db/CoE). */
  en: string;
  /** RU-имя, если верифицировано живым клиентом; иначе null. */
  ru: string | null;
  /** Гарантированный мод (кратко, русским). */
  guaranteed: string;
  /** Что делает эссенция. */
  action: EssenceAction;
  /** Слоты, где эссенция осмысленна. */
  slots: 'weapon' | 'armour' | 'jewellery' | 'any' | 'caster';
}

/** Ключевая эссенция-таблица (подборка из полного списка poe2db/us/Essence). */
export const CRAFT_ESSENCES: EssenceInfo[] = [
  { en: 'Essence of Grounding', ru: 'сущность заземления', guaranteed: '+% к сопротивлению молнии', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Thawing', ru: null, guaranteed: '+% к сопротивлению холоду', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Insulation', ru: null, guaranteed: '+% к сопротивлению огню', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of Ruin', ru: null, guaranteed: '+% к сопротивлению хаосу — самый ценный резист эндгейма', action: 'magicToRare', slots: 'any' },
  { en: 'Essence of the Body', ru: null, guaranteed: '+жизнь', action: 'magicToRare', slots: 'armour' },
  { en: 'Essence of the Mind', ru: null, guaranteed: '+мана', action: 'magicToRare', slots: 'jewellery' },
  { en: 'Essence of Enhancement', ru: null, guaranteed: '+% брони/уклонения/ЭС', action: 'magicToRare', slots: 'armour' },
  { en: 'Essence of Abrasion', ru: null, guaranteed: '+физ. урон оружию (Perfect: «Gain % as Extra Physical»)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Electricity', ru: null, guaranteed: '+урон молнией (Perfect: «Gain % as Extra Lightning»)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Ice', ru: null, guaranteed: '+урон холодом (Perfect: «Gain % as Extra Cold»)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Sorcery', ru: null, guaranteed: '+% урона чарам (Focus/Wand/Staff)', action: 'magicToRare', slots: 'caster' },
  { en: 'Essence of Battle', ru: null, guaranteed: '+точность (Perfect: +2/+3 к уровню атакующих умений на оружии)', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Haste', ru: null, guaranteed: '+% скорости атаки', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of Seeking', ru: null, guaranteed: '+% шанса крит. удара', action: 'magicToRare', slots: 'weapon' },
  { en: 'Essence of the Infinite', ru: null, guaranteed: '+сила/ловкость/интеллект', action: 'magicToRare', slots: 'jewellery' },
];

/** Perfect-эссенции (действие: удалить случайный мод у Rare + добавить гарантированный). */
export const CRAFT_PERFECT_ESSENCES_HINT =
  'Perfect-версия (действует на Rare: удаляет случайный мод и добавляет гарантированный; ' +
  'с Omen of Sinistral/Dextral Crystallisation удаление — только нужная сторона)';

export interface OmenInfo {
  en: string;
  purpose: string;
}

/** Ключевые крафтовые омены (Ritual). Полный список: poe2db.tw/us/Omen. */
export const CRAFT_OMENS: OmenInfo[] = [
  { en: 'Omen of Sinistral Exaltation', purpose: 'Exalted Orb добавит только ПРЕФИКС' },
  { en: 'Omen of Dextral Exaltation', purpose: 'Exalted Orb добавит только СУФФИКС' },
  { en: 'Omen of Greater Exaltation', purpose: 'Exalted Orb добавит ДВА мода' },
  { en: 'Omen of Whittling', purpose: 'Chaos Orb удалит худший (минимального уровня) мод' },
  { en: 'Omen of Sinistral/Dextral Erasure', purpose: 'Chaos Orb удалит только префикс/суффикс (дорогие!)' },
  { en: 'Omen of Sinistral/Dextral Coronation', purpose: 'Regal Orb добавит только префикс/суффикс' },
  { en: 'Omen of Sinistral/Dextral Crystallisation', purpose: 'Perfect-эссенция удалит только нужную сторону' },
  { en: 'Omen of Light', purpose: 'Orb of Annulment удалит только desecrated-мод (перезапуск провала)' },
  { en: 'Omen of Sanctification', purpose: 'Divine Orb — Sanctify (без негатива)' },
];

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
