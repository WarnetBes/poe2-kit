/**
 * №112 «Эндгейм-модель»: данные endgame PoE2 0.5 для панели «Карты» (куда идти на картах).
 *
 * Источники (прочитано 01.10.2026, задачи №112/№114):
 *  - maxroll endgame-activities + патчноуты 0.5.2/0.5.5 (сводка передана в ТЗ задачи №112).
 *  - Журнал №114 (сессия разведки 0.5.x): Sekhemas-лестница боссов, флаги «не верифицировано»
 *    по bosses.ts (Aberration, «+6 атлас-очков»), баланс 0.5.5 = no balance changes.
 *  - bosses.ts (канон проекта): ключи доступа пиннакл-боссов.
 *
 * Правила те же, что в bosses.ts: никаких выдуманных фактов. Всё, что не из
 * источников выше, помечено verified:false / «unverified» в тексте.
 * Численные пороги Waystone-тиров НЕ верифицированы — вынесены отдельно,
 * НЕ использовать для логики, только как подсказки.
 *
 * Специфика интерфейса: 9 механик в ENDGAME_MECHANICS (6 атлас-регионов
 * + 2 триала + центр Precursor Fortress); Citadel/Burning Monolith —
 * пиннакл-финал, живёт в CITADEL_ENCOUNTER и попадает в mechanicsOverview(),
 * но не в список механик (требование смока №112: ровно 9).
 */

/** Регион атласа 0.5 (фиксированные зоны механик). */
export type AtlasRegion = 'N' | 'E' | 'SE' | 'S' | 'W' | 'center';

/** Тип эндгейм-активности. */
export type EndgameKind = 'atlas' | 'trial' | 'pinnacle-hub';

/** Одна эндгейм-механика (для панели «Карты»). */
export interface EndgameMechanic {
  /** Ключ (ascii, стабильный для wiring панели). */
  id: string;
  /** Имя в EN — RU-локализацию имён не выдумываем (см. name_ru). */
  name: string;
  /** RU-имя только если уверен в официальной локализации; иначе не заполнять. */
  name_ru?: string;
  kind: EndgameKind;
  /** Фиксированный регион атласа 0.5 (для триалов отсутствует). */
  region?: AtlasRegion;
  /** Как попасть / из чего состоит активность. */
  access_ru?: string;
  /** Боссы активности (EN-имена из источников). */
  bosses?: string[];
  /** Подсказки по Precursor-планшетам этой механики (0.5-система). */
  tablets_ru?: string[];
  /** Короткие подсказки «что делать» для панели. */
  notes_ru: string[];
  /** Патч, к которому относится факт (последнее изменение). */
  patch?: string;
  /** false = численные детали не верифицированы (по умолчанию true). */
  verified?: boolean;
}

/** Пиннакл-финал «Citadel / Burning Monolith» — вне списка механик (см. шапку). */
export interface CitadelEncounter {
  name: string;
  /** Способ доступа. */
  access_ru: string;
  /** Финальный босс. */
  boss: string;
  notes_ru: string[];
  patch?: string;
  verified?: boolean;
}

/** Строка сводки механик для первой версии панели «Карты». */
export interface MechanicsOverviewRow {
  id: string;
  name: string;
  name_ru?: string;
  kind: EndgameKind;
  region?: AtlasRegion;
  /** Однострочное «что это и что делать». */
  short_ru: string;
  access_ru?: string;
  bosses?: string[];
}

/** Подсказка по waystone-крафту. */
export interface WaystoneTip {
  text_ru: string;
  verified: boolean;
}

/**
 * 9 эндгейм-механик атласа 0.5: регионы фиксированы
 * (Expedition ЮВ, Breach Ю, Ritual З, Delirium З, Abyss В, Incursion С,
 * центр — Precursor Fortress) + 2 триала без региона.
 */
export const ENDGAME_MECHANICS: EndgameMechanic[] = [
  {
    id: 'expedition',
    name: 'Expedition',
    name_ru: 'Экспедиция',
    kind: 'atlas',
    region: 'SE',
    access_ru: 'Море на ЮВ атласа; каждый Logbook гарантирует Grand Expedition',
    bosses: ['Uhtred', 'Olroth', 'Vorana'],
    tablets_ru: [
      'Expedition-планшеты стакаются: 1–4 шт; моды — от +1 Expedition до +70% плотности монстров.',
    ],
    notes_ru: [
      'ЮВ атласа: исследуйте океан (морская часть Expedition).',
      'Каждый Logbook даёт гарантированный Grand Expedition (0.5.2).',
      'Боссы экспедиций: Uhtred, Olroth, Vorana.',
    ],
    patch: '0.5.2',
  },
  {
    id: 'breach',
    name: 'Breach',
    name_ru: 'Разлом',
    kind: 'atlas',
    region: 'S',
    access_ru: 'Breach-энкаунтеры на картах юга атласа',
    bosses: ['Tul', 'Esh', 'Xesht, We That Are One'],
    tablets_ru: [
      '0.5.5: моды Breach-планшетов переналажены (rebalanced).',
    ],
    notes_ru: [
      'Genesis Tree: кластеры Hiveblood/womb-gifts — крафт jewelry до 40% качества (точная формулировка источников: Hiveblood/Wombgifts).',
      'Hiveborn Strongholds — укрепления в мид-эндгейме юга; Breachlords Tul/Esh — в Hive Fortress.',
      'Пиннакл механики — Xesht, We That Are One (ключ Breachlord Sac, см. bosses.ts).',
    ],
    patch: '0.5.5',
  },
  {
    id: 'ritual',
    name: 'Ritual',
    name_ru: 'Ритуал',
    kind: 'atlas',
    region: 'W',
    access_ru: 'Алтари Ritual на картах запада атласа',
    bosses: ['The Bodach'],
    tablets_ru: ['Ritual-планшет добавляет алтарь (altar) на карту.'],
    notes_ru: [
      'Tribute → закупка; Royal Lenience уменьшает цены (0.5.5 — defer стоит предложенный tribute +500%).',
      'Sacred Blossom → Viridian Wisps на карте: синий = magic-монстры, жёлтый = +моды на rare, фиолетовый = rarity монстров.',
      'Цепочка Rite of the Nameless ведёт к пиннаклу — The Bodach (ключи — см. bosses.ts).',
    ],
    patch: '0.5.5',
  },
  {
    id: 'delirium',
    name: 'Delirium',
    kind: 'atlas',
    region: 'W',
    access_ru: 'Grand Mirror → Simulacrum → Mirror of Madness',
    bosses: ["Tang'Mazu", 'The Raven Trickster'],
    notes_ru: [
      "Цепочка: Grand Mirror → Simulacrum → Mirror of Madness. Босс активности — Tang'Mazu.",
      'Distilled Emotions: instill-крафт на амулеты/jewels.',
      '0.5.5: туман Delirium (Fog) с Grand Mirror распространяется ровно на 10 карт.',
      'В bosses.ts пиннакл-энкаунтером Delirium записан The Raven Trickster (Raven’s Reflection) — присутствие двух имён отражает источники; смысла не выдумываем.',
    ],
    patch: '0.5.5',
  },
  {
    id: 'abyss',
    name: 'Abyss',
    name_ru: 'Бездна',
    kind: 'atlas',
    region: 'E',
    access_ru: 'Abyss-трещины на картах востока атласа; Depths',
    bosses: ['Vessel of Kulemak'],
    tablets_ru: ['0.5.5: моды Abyss-планшетов переналажены.'],
    notes_ru: [
      'Depths — подземный слой Abyss; 3 Lightless-босса внутри.',
      'Kulemak’s Invitation + Well of Souls — доступ к пиннаклу, Vessel of Kulemak (см. bosses.ts).',
      '0.5.5: Large Abyssal Ravines по атласу — гарантированные Abyss.',
    ],
    patch: '0.5.5',
  },
  {
    id: 'incursion',
    name: 'Incursion / Vaal',
    kind: 'atlas',
    region: 'N',
    access_ru: '6 маяков (beacons) → Vaal Temple',
    bosses: ['Atziri, the Red Queen'],
    notes_ru: [
      'Соберите 6 маяков → Vaal Temple на севере атласа.',
      'Corruption Chamber — повторная коррозия предметов (double-corrupt-стиль, PoE1-терминология — не выдумываем деталей).',
      'Sacrificial Chamber — жертвенный сервис-интерьер Atziri. Финал — Atziri, the Red Queen (проверено по poe2wiki в №104).',
    ],
    patch: '0.5',
  },
  {
    id: 'trial-of-chaos',
    name: 'Trial of Chaos',
    kind: 'trial',
    access_ru: 'Стандартный Trial of Chaos (как в кампании); продолжение — Inscribed Ultimatum',
    bosses: ['Xyclucian', 'The Trialmaster'],
    notes_ru: [
      '10 раундов триала → Inscribed Ultimatum-продолжения (до 30 комнат).',
      'Финал цепочки — The Trialmaster (в №104 acesso: 3 Fate-ключа — Deadly/Cowardly/Victorious Fate).',
      'Xyclucian — асценсионный босс триала (№104: ключи доступа проверены по poe2wiki).',
    ],
    patch: '0.5',
  },
  {
    id: 'trial-of-the-sekhemas',
    name: 'Trial of the Sekhemas',
    kind: 'trial',
    access_ru: 'Djinn Barya (Balbala’s Barya с кампании, акт 2)',
    bosses: ['Rattlecage', 'Hadi + Rafiq', 'Ashar, The Sand Mother', 'Zarokh, The Temporal'],
    notes_ru: [
      'Этажность по уровню зоны: 24–44 → 1, 45–59 → 2, 60–74 → 3, 75+ → 4 (см. sekhemasFloorsForLevel).',
      'Honor = Life + ES; рекомендация — сумма реликвий ≥ 75% Honour Res.',
      '0.5.5: встроенные бонусы Sekhemas с area level 65+.',
      'Лестница боссов (журнал №114, разведка maxroll/патчноутов): Rattlecage → Hadi+Rafiq → Ashar, The Sand Mother → финалист Zarokh, The Temporal.',
    ],
    patch: '0.5.5',
  },
  {
    id: 'precursor-fortress',
    name: 'Precursor Fortress',
    kind: 'pinnacle-hub',
    region: 'center',
    access_ru: 'Центр атласа; Origin Core (Origin Spark + Origin Cradle)',
    bosses: ['The Arbiter of Divinity'],
    notes_ru: [
      'Центральная точка атласа 0.5 — вокруг неё регионы механик.',
      'Origin Core (Origin Spark + Origin Cradle) открывает пиннакл The Arbiter of Divinity (зона The Origin Tower, см. bosses.ts).',
    ],
    patch: '0.5',
  },
];

/**
 * Citadel / Burning Monolith — финал атласа 0.5. Держим ОТДЕЛЬНО от механик
 * (смок №112 expects ровно 9 в ENDGAME_MECHANICS), но включаем в mechanicsOverview().
 */
export const CITADEL_ENCOUNTER: CitadelEncounter = {
  name: 'Citadel / The Burning Monolith',
  access_ru: 'Фрагменты с трёх Citadel uber-актов',
  boss: 'The Arbiter of Ash',
  notes_ru: [
    'Фрагменты падают с трёх Citadel uber-актов; модификаторы карт типа Waystone Drop Chance влияют на качество фрагментов.',
    'Финал — The Arbiter of Ash (The Burning Monolith, ключи — Ancient/Faded/Weathered Crisis Fragment, см. bosses.ts).',
  ],
  patch: '0.5',
};

/**
 * ⚠️ UNVERIFIED: точные численные пороги Waystone-тиров не верифицированы.
 * Не использовать для логики/автоматизации — только как текст-подсказки.
 */
export const WAYSTONE_TIERS_UNVERIFIED: WaystoneTip[] = [
  { text_ru: 'Точные численные пороги Waystone-тиров НЕ верифицированы (unverified) — не закладывать в логику.', verified: false },
];

/** Карта этажности Sekhemas (проверено: maxroll/патчноуты 0.5/0.5.5, журнал №114). */
export const SEKHEMAS_FLOOR_TABLE: { minLevel: number; floors: 1 | 2 | 3 | 4 }[] = [
  { minLevel: 24, floors: 1 },
  { minLevel: 45, floors: 2 },
  { minLevel: 60, floors: 3 },
  { minLevel: 75, floors: 4 },
];

/**
 * Этажность Trial of the Sekhemas по уровню зоны: 24–44 → 1, 45–59 → 2,
 * 60–74 → 3, 75+ → 4. Уровень ниже 24 формально вне таблицы — клампится в 1
 * (триал доступен с Djinn Barya, но таблица этажности начинается с 24).
 */
export function sekhemasFloorsForLevel(level: number): 1 | 2 | 3 | 4 {
  let floors: 1 | 2 | 3 | 4 = 1;
  for (const row of SEKHEMAS_FLOOR_TABLE) if (level >= row.minLevel) floors = row.floors;
  return floors;
}

/** Механика по id (или null). */
export function mechanicById(id: string): EndgameMechanic | null {
  return ENDGAME_MECHANICS.find((m) => m.id === id) ?? null;
}

/** Все механики фиксированного региона атласа 0.5 (например 'W' → Ritual + Delirium). */
export function mechanicByRegion(region: AtlasRegion): EndgameMechanic[] {
  return ENDGAME_MECHANICS.filter((m) => m.region === region);
}

/**
 * Сводка для первой версии панели «Карты»: 9 механик + Citadel-финал,
 * плоские строки (short_ru = первая подсказка), чтобы wiring был тривиален.
 */
export function mechanicsOverview(): MechanicsOverviewRow[] {
  const rows: MechanicsOverviewRow[] = ENDGAME_MECHANICS.map((m) => ({
    id: m.id,
    name: m.name,
    ...(m.name_ru ? { name_ru: m.name_ru } : {}),
    kind: m.kind,
    ...(m.region ? { region: m.region } : {}),
    short_ru: m.notes_ru[0] ?? m.name,
    ...(m.access_ru ? { access_ru: m.access_ru } : {}),
    ...(m.bosses ? { bosses: m.bosses } : {}),
  }));
  rows.push({
    id: 'citadel',
    name: CITADEL_ENCOUNTER.name,
    kind: 'pinnacle-hub',
    short_ru: CITADEL_ENCOUNTER.notes_ru[0],
    access_ru: CITADEL_ENCOUNTER.access_ru,
    bosses: [CITADEL_ENCOUNTER.boss],
  });
  return rows;
}

/**
 * Подсказки по Waystone-крафту для панели. Верифицированное — из ТЗ №112;
 * численные пороги тиров — отдельно, см. WAYSTONE_TIERS_UNVERIFIED.
 */
export function waystoneTips(): WaystoneTip[] {
  return [
    { text_ru: 'Крафтите Waystone на difficulty-стат или на drop-шанс — модификаторы «Waystone Drop Chance» влияют на качество фрагментов Citadel.', verified: true },
    { text_ru: 'Precursor-планшеты (0.5) заменили старую систему: дроп с монстров активностей, явные моды, стаки.', verified: true },
    { text_ru: 'Планшет «of Champions» (0.5.5): 2–3 rare-планшета вместо 1–2.', verified: true },
    ...WAYSTONE_TIERS_UNVERIFIED,
  ];
}
