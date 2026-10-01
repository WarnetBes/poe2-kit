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
        'Числовые пороги тиров НЕ верифицированы — см. WAYSTONE_TIERS_UNVERIFIED (endgame.ts).',
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
