/**
 * №104 «Бестиарий боссов» + №109 «Обновление до патча 0.5.5» — локальный датасет боссов PoE2.
 *
 * Источники (канон проекта):
 *  - Сюжет/интерлюдии: packages/core/data/zoneNotes.json (RU-гайды Path of Levelling 2,
 *    имена боссов и награды — как в живых гайдах; имена оставлены в той же форме).
 *  - Триалы и пиннакл (обновление 0.5/0.5.5, проверено 01.10.2026):
 *    maxroll.gg endgame-activities + патчноуты 0.5.2/0.5.5.
 *
 * Правила:
 *  - Никаких выдуманных имён: каждый босс либо verified (источник выше),
 *    либо явно помечен verified: false.
 *  - Атлас-очки за пиннаклов в 0.5 НЕ верифицированы (атлас переработан) —
 *    в записях только пометка «проверить в игре», поле atlasPoints = null.
 *  - RU-имена (name_ru): только официальная RU-локализация. Ни одно RU-имя
 *    пиннаклов/триал-боссов не подтверждено по источникам 0.5 — оставляем undefined
 *    (НЕ выдумывать; кандидаты вроде «Зарох» для Zarokh требуют проверки в RU-клиенте).
 *
 * Боссы без имени в гайдах (Mawdun Mine, Bone Pits и т.п. — «Kill the boss») не внесены.
 */

export type BossKind = 'story' | 'interlude' | 'asc-trial' | 'pinnacle';

export interface BossInfo {
  /** Имя, как в источнике (RU — из zoneNotes, EN — из maxroll/патчноутов). */
  name: string;
  kind: BossKind;
  /** Акт (1..4) или номер интерлюдии (I, II, III). */
  act?: number | 'I' | 'II' | 'III';
  /** Зона сражения. */
  zone?: string;
  /** Код зоны (для матчинга с маршрутом актов из Client.txt). */
  zoneCode?: string;
  /** Награда за первое убийство / смысл боя. */
  reward?: string;
  /** Советы по бою (механики, подготовка). */
  tips?: string[];
  /** Способ доступа (для триалов/пиннакла — ключи). */
  access?: string;
  /** Официальное RU-имя (локализация клиента). НЕ заполнять без проверки — см. шапку. */
  name_ru?: string;
  /** Подтверждён факт/имя источниками 0.5 (по умолчанию — true,legacy-записи №104
   *  помечаются false, если не найдены в 0.5-источниках). */
  verified?: boolean;
  /** Пояснение к verified: false / unverifiable-name. */
  unverifiedNote?: string;
  /** Атлас-очки за убийство. Точные значения 0.5 НЕ верифицированы — null = проверить в игре. */
  atlasPoints?: number | null;
  /** Этаж триала (Sekhemas: 1..4). */
  floor?: number;
  /** №143: чем босс опасен (механики, урон) — только верифицированные источники, НЕ выдумывать. */
  strengths?: string[];
  /** №143: чем босса удобно бить (урезистентности, уязвимости, окна). Только верифицированное. */
  weaknesses?: string[];
  /** №143: что и зачем с него фармят (дроп-фокус, частота) — верифицированные заметки. */
  farm?: string[];
}

/** Сюжетные боссы кампании (акты 1–4) + интерлюдии. */
export const CAMPAIGN_BOSSES: BossInfo[] = [
  // ─── Акт 1 ───
  { name: 'Хиллока', kind: 'story', act: 1, zone: 'The Riverbank', zoneCode: 'G1_1', reward: 'выход в город (старт кампании)', tips: ['Убейте и выходите в город.'] },
  { name: 'Беира', kind: 'story', act: 1, zone: 'Clearfell', zoneCode: 'G1_2', reward: '+10% к сопротивлению холоду', tips: ['Основной босс акта-стартера; после неё опционально Mud Burrow.'] },
  { name: 'Девор', kind: 'story', act: 1, zone: 'Mud Burrow', zoneCode: 'G1_3', reward: 'камень навыка 2 ур. + поддержка 1 ур.', tips: ['Пропускаемая зона, босс прямо от входа.'] },
  { name: 'Бремблегаст', kind: 'story', act: 1, zone: 'The Grelwood', zoneCode: 'G1_4', reward: 'камень навыка 1 ур.', tips: ['4 локации ромбом; по пути хата Арене — зелья + камень 1 ур.'] },
  { name: 'Гнилой Друид', kind: 'story', act: 1, zone: 'The Grim Tangle', zoneCode: 'G1_6', reward: 'поддержка 1 ур.', tips: ['Опционально; идите вверх и влево (компоновка может быть отзеркалена).'] },
  { name: 'Кроубэлл', kind: 'story', act: 1, zone: 'Hunting Grounds', zoneCode: 'G1_11', reward: '+2 очка пассивок', tips: ['Рядом с гигантской ямой; идти по краю по часовой стрелке.'] },
  { name: 'Король в Туманах', kind: 'story', act: 1, zone: 'Freythorn', zoneCode: 'G1_12', reward: '+30 Духа и камень Духа 4 ур.', tips: ['Сложная компоновка. Виспы укажут на оставшиеся ритуалы.', 'В 0.5 King in the Mist — только страж Ritual-цепочки, НЕ пиннакл (см. The Bodach).'] },
  { name: 'Лютня Уны', kind: 'story', act: 1, zone: 'Ogham Farmlands', zoneCode: 'G1_13_1', reward: '+2 очка пассивок', tips: ['За разбитыми караванами; вниз и влево.'] },
  { name: 'Палач', kind: 'story', act: 1, zone: 'Ogham Village', zoneCode: 'G1_13_2', reward: 'выход в The Manor Ramparts', tips: ['Идите по краю на север; если босс раньше инструментов Ренли — вернитесь и на юг.'] },
  { name: 'Канделмасс', kind: 'story', act: 1, zone: 'Ogham Manor', zoneCode: 'G1_15', reward: '+20 к жизни (финал акта 1)', tips: ['На каждом этаже мост в середине; 2-й и 3-й этажи — в противоположную от прошлого сторону.'] },
  // ─── Акт 2 ───
  { name: 'Рэтбрейкер', kind: 'story', act: 2, zone: 'Vastiri Outskirts', zoneCode: 'G2_1', reward: 'проход к каравану', tips: ['Стойте на краю утёса, чтобы избежать копий.'] },
  { name: 'Балбала, Предательница', kind: 'story', act: 2, zone: "Traitor's Passage", zoneCode: 'G2_2', reward: "Balbala's Barya — вход в Trial of the Sekhemas (асценданси!)", tips: ['Следуйте за страницами на стене; Шесть Сестёр указывают верный путь.'] },
  { name: 'Кабала', kind: 'story', act: 2, zone: 'Keth', zoneCode: 'G2_4_1', reward: '+2 очка пассивок', tips: ['Головоподобная плитка у босса; обход по часовой стрелке. Хороший опыт.'] },
  { name: 'Сёстры Гарухан', kind: 'story', act: 2, zone: 'The Spires of Deshar', zoneCode: 'G2_9_2', reward: '+10% к сопротивлению молнии', tips: ['G-образная плитка, метод исключения (опционально).'] },
  { name: 'Тор Гул', kind: 'story', act: 2, zone: 'The Spires of Deshar', zoneCode: 'G2_9_2', reward: 'Караван → The Dreadnought (прогресс акта)' },
  // ─── Акт 3 ───
  { name: 'Рутредж', kind: 'story', act: 3, zone: 'Sandswept Marsh', zoneCode: 'G3_1', reward: 'камень навыка 9 ур.', tips: ['Обычно в центре болота; в траве Кемп Орока даёт Малый Jeweller’s.'] },
  { name: 'Сереброкулак', kind: 'story', act: 3, zone: 'Jungle Ruins', zoneCode: 'G3_3', reward: '+2 очка пассивок', tips: ['Обычно в верхней трети; возьмите ви-поинт в Venom Crypts.'] },
  { name: 'Игнагдук', kind: 'story', act: 3, zone: 'The Azak Bog', zoneCode: 'G3_7', reward: '+30 Духа / камень Духа 10 ур.', tips: ['Босс обычно в верхне-правом квадранте.'] },
  { name: 'Блэкджоу', kind: 'story', act: 3, zone: "Jiquani's Machinarium", zoneCode: 'G3_6_1', reward: '+10% к сопротивлению огню', tips: ['В дальнем левом или правом краю; слушайте звук квестового предмета.'] },
  { name: 'Дорияни', kind: 'story', act: 3, zone: 'The Black Chambers', zoneCode: 'G3_17', reward: 'финал акта 3 (Citadel-фрагменты для Arbiter of Ash — с uber-версии акта)', tips: ['Первый мост влево/вправо, далее по мостам, всплывающим из воды.'] },
  // ─── Акт 4 ───
  { name: 'Омнифобия', kind: 'story', act: 4, zone: "Journey's End", zoneCode: 'G4_2_2', reward: 'чекпоинт перед боем → +2 очка пассивок', tips: ['Извилистая зона, идите до конца.'] },
  { name: 'Тавакаи', kind: 'story', act: 4, zone: 'Heart of the Tribe', zoneCode: 'G4_11_2', reward: 'конец акта 4', tips: ['Жмите на север; чекпоинт = неверная развилка.'] },
  // ─── Интерлюдии ───
  { name: 'Элдер Мэддокс', kind: 'interlude', act: 'III', zone: 'Пики Криар', reward: 'уникальный предмет', tips: ['Интерлюдия «Запасной план Дорияни»; рядом: Деревня Криар → +40 духу, Воющие пещеры → +2 пассивок.'] },
];

/** Боссы Trials of Ascension (асценданси). */
export const ASC_TRIAL_BOSSES: BossInfo[] = [
  {
    // Trial of Chaos, 0.5.5 (verified maxroll 0.5.4 endgame-activities + патчноут 0.5.5):
    // ран можно продолжать до 30 комнат (Inscribed Ultimatum, 2 продолжения),
    // за каждое продолжение — Trialmaster-фрагменты; награды только Currency + Soul Cores.
    name: 'The Trialmaster',
    kind: 'asc-trial',
    zone: "Trialmaster's Tower",
    access: '3 Fate-ключа: Deadly Fate + Cowardly Fate + Victorious Fate (Trial of Chaos; 0.5.5: до 30 комнат через Inscribed Ultimatum ×2, Trialmaster-фрагменты за каждое продолжение)',
    reward: 'эндгейм-дроп уников; 0.5.5 — продолжения рана дают только Currency + Soul Cores',
    // №143: сильные стороны — разбор механики из verified-гайда (без новых фактов).
    strengths: [
      'Телепорты + двойной свайп, Sunder-слэмы, Timestop Sunder (три отложенных слэма).',
      'Каналируемая Bloodburst-зона (взрывается), Cyclone c шоквейвами.',
      'Уровень босса — 80; паузы в игре во время боя нет.',
    ],
    // №143: зачем фармят — 0.5.5 (verified патчноут).
    farm: [
      '0.5.5: продолжения рана (Inscribed Ultimatum ×2, до 30 комнат) — Trialmaster-фрагменты за каждое продолжение; награды продолжений — Currency + Soul Cores.',
    ],
    tips: [
      'Булава: телепорты, двойной свайп, Sunder-слэмы, Timestop Sunder (три отложенных слэма), Bloodburst (каналируемая зона взрывается), Cyclone c шоквейвами.',
      'Нельзя ставить игру на паузу во время боя. Уровень босса — 80.',
    ],
  },
];

/**
 * Trial of the Sekhemas — полная лестница этажей (0.5, verified maxroll 0.5.4
 * endgame-activities + патчноуты 0.5.2/0.5.5; прочтено 01.10.2026).
 *
 * Ключ доступа: Djinn Barya (за Балбалу в акте 2). Финалист — Zarokh, The Temporal
 * (ранее «The Eternal», переименован до 0.5; 4-й этаж, манипуляции временем).
 * Этажность по уровню зоны (area level): 24–44 → 1, 45–59 → 2, 60–74 → 3, 75+ → 4 этажа.
 * Honor = Life + ES; восстановления Honor — шрайнами за Sacred Water.
 * Рекомендация: сумма 75% Honour Resistance на реликвиях.
 * 0.5.5: встроенные бонусы Sekhemas на картах area level 65+
 * (magic/rare шанс, pack size, качество/количество с боссов).
 */
export const SEKHEMAS_BOSSES: BossInfo[] = [
  {
    name: 'Rattlecage, The Earthbreaker',
    kind: 'asc-trial',
    floor: 1,
    zone: 'Trial of the Sekhemas, Floor 1',
    access: 'Djinn Barya (Balbala’s Barya, акт 2)',
    reward: 'асценданси (Sekhemas)',
    tips: ['Вулканцы, 3-ступенчатый AoE растущим радиусом.'],
  },
  {
    name: 'Hadi of the Flaming River + Rafiq of the Frozen Spring',
    kind: 'asc-trial',
    floor: 2,
    zone: 'Trial of the Sekhemas, Floor 2',
    access: 'Djinn Barya',
    reward: 'асценданси (Sekhemas)',
    tips: ['Пара боссов; выживший полностью лечится — киллить почти одновременно.'],
  },
  {
    name: 'Ashar, The Sand Mother',
    kind: 'asc-trial',
    floor: 3,
    zone: 'Trial of the Sekhemas, Floor 3',
    access: 'Djinn Barya',
    reward: 'асценданси (Sekhemas)',
    tips: ['Скорпион: нажимные плиты, прыжок из-под земли, quicksand.'],
  },
  {
    name: 'Zarokh, The Temporal',
    kind: 'asc-trial',
    floor: 4,
    zone: 'Trial of the Sekhemas, Floor 4',
    access: 'Djinn Barya',
    reward: 'асценданси (Sekhemas); 0.5.5 бонусы Sekhemas на area level 65+',
    // Кандидат «Зарох» НЕ подтверждён по RU-клиенту — name_ru не заполняем (см. шапку).
    name_ru: undefined,
    // №143: верифицированные данные (см. комментарии блока Sekhemas).
    strengths: ['Манипуляции временем (финал Sekhemas).'],
    farm: [
      'Асценданси; 0.5.5 бонусы Sekhemas на картах area level 65+ (magic/rare шанс, pack size, качество/количество с боссов).',
    ],
    tips: [
      'Финальный босс Sekhemas: манипуляции временем.',
      'Honor = Life + ES; восстанавливайте Honor шрайнами за Sacred Water; рекомендация — 75% Honour Resistance на реликвиях.',
      'Этажность по уровню зоны: 24–44 → 1, 45–59 → 2, 60–74 → 3, 75+ → 4.',
    ],
  },
];

/**
 * Пиннакл-боссы 0.5/0.5.5 (verified: maxroll 0.5.4 endgame-activities + патчноуты 0.5.2/0.5.5,
 * прочтено 01.10.2026; отдельные пометки verified: false — см. записи).
 * Атлас-очки за пиннаклов в 0.5 НЕ верифицированы (атлас переработан) — atlasPoints: null.
 */
export const PINNACLE_BOSSES: BossInfo[] = [
  {
    name: 'The Arbiter of Ash',
    kind: 'pinnacle',
    zone: 'The Burning Monolith',
    access: 'Фрагменты с трёх Citadel: Doryani / Jamanra / Geonor (uber-акты)',
    reward: 'уники; атлас-очки (сумма за 4 сложности механики, точные цифры 0.5 не верифицированы — проверить в игре)',
    atlasPoints: null,
    tips: [
      // 0.5.5 (verified, патчноут): НЕ All Elemental Res — вместо этого Fire Res + Cold Vulnerability.
      'Нет опыта за бой, но и без потери опыта при смерти. Квестовые ключи первой попытки — с бесконечными возрождениями.',
    ],
    // №143: cold-уязвимость — verified 0.5.5 патчноут.
    weaknesses: ['С 0.5.5 босс: fire res + COLD VULNERABILITY (не All Elemental Res) — берите cold-урон.'],
    farm: [
      'Уники пиннакла. Ключ доступа (фрагменты Citadels: Doryani / Jamanra / Geonor — uber-акты) — сам по себе регулирует частоту фарма.',
    ],
  },
  {
    name: 'The Arbiter of Divinity',
    kind: 'pinnacle',
    zone: 'The Precursor Fortress (центр атласа)',
    access: 'Origin Core (quest и non-quest версии)',
    reward: 'уники; атлас-очки (сумма за 4 сложности механики, точные цифры 0.5 не верифицированы — проверить в игре)',
    atlasPoints: null,
    tips: ['Главный пиннакл патча 0.5 (verified maxroll 0.5.4 endgame-activities).'],
  },
  {
    name: 'The Raven Trickster',
    kind: 'pinnacle',
    zone: 'Delirium (энкаунтер)',
    access: "Способ доступа НЕ верифицирован (см. unverifiedNote)",
    reward: 'уники',
    verified: false,
    unverifiedNote: 'Подтверждён как босс 0.5 патчноутом 0.5.5: «Raven Trickster no longer has All Elemental Resistances»; связан со стаффом The Raven’s Flock. Способ доступа НЕ верифицирован.',
  },
  {
    name: "Tang'Mazu",
    kind: 'pinnacle',
    zone: 'Mirror of Madness (Delirium)',
    access: 'Grand Mirror → Simulacrum → Mirror of Madness',
    reward: 'уники',
    tips: ['Omniphobia и Kosis — подчинённые боссы внутри Simulacrum, НЕ пиннаклы.'],
  },
  {
    name: 'Xesht, We That Are One',
    kind: 'pinnacle',
    zone: 'Breach — Hiveborn Strongholds',
    access: 'Breachstone (Genesis Tree); в Hive Fortress — Breachlords Tul и Esh (подчинённые, не пиннаклы)',
    reward: 'уники',
  },
  {
    name: 'The Bodach',
    kind: 'pinnacle',
    zone: 'Ritual — цепочка Rite of the Nameless',
    access: '5 карт цепочки Rite of the Nameless (боссы переносятся вперёд)',
    reward: 'уники',
    tips: ['King in the Mist — только страж цепочки, НЕ пиннакл.'],
  },
  {
    name: 'The Aberration',
    kind: 'pinnacle',
    zone: 'Expedition (энкаунтер)',
    access: 'The Triskelion Reforged',
    reward: 'уники',
    verified: false,
    // Обратная совместимость: запись НЕ удалена, но в 0.5-источниках не найдена.
    unverifiedNote: 'НЕ найден в 0.5-источниках (maxroll 0.5.4 endgame-activities, патчноуты 0.5.2/0.5.5); кандидат на удаление после проверки в игре. Expedition-пиннакл 0.5 — см. запись Olroth ниже.',
  },
  {
    name: 'Olroth (имя не верифицировано)',
    kind: 'pinnacle',
    zone: 'Tomb of Olroth / Triskalion Flame',
    access: 'Expedition Ocean-квест: Tomb of Uhtred → Tomb of Olroth → Triskalion Flame',
    reward: 'уники',
    verified: false,
    unverifiedNote: 'unverifiable-name: Expedition-пиннакл 0.5 (Tomb of Uhtred → Tomb of Olroth → Triskalion Flame, метеорит Verisium — «гигантский паук в метеорите»); точное имя финального босса НЕ верифицировано, кандидат — Olroth (verified maxroll 0.5.4 endgame-activities).',
  },
  {
    name: 'Vessel of Kulemak',
    kind: 'pinnacle',
    zone: 'Well of Souls (Abyss)',
    access: '3 Lightless-босса в Abyssal Depths → Kulemak’s Invitation',
    reward: 'уники',
  },
  {
    name: 'Atziri, The Red Queen',
    kind: 'pinnacle',
    zone: 'Vaal Temple / Incursion — храм Lira Vaal, Royal Access Chamber',
    access: '6 маяков',
    reward: 'уники',
  },
];

/** Все боссы одним списком. */
export const ALL_BOSSES: BossInfo[] = [
  ...CAMPAIGN_BOSSES,
  ...ASC_TRIAL_BOSSES,
  ...SEKHEMAS_BOSSES,
  ...PINNACLE_BOSSES,
];

/** Индекс по zoneCode — для маркировки боссовских зон в маршруте кампании. */
const byZoneCode: Map<string, BossInfo> = (() => {
  const m = new Map<string, BossInfo>();
  for (const b of CAMPAIGN_BOSSES) if (b.zoneCode) m.set(b.zoneCode, b);
  return m;
})();

/** Босс зоны по её коду (или null). */
export function bossByZoneCode(zoneCode: string): BossInfo | null {
  return byZoneCode.get(zoneCode) ?? null;
}

/**
 * №143: ВСЕ боссы зоны по её коду. В G2_9_2 (The Spires of Deshar) два босса
 * (Гарухан + Тор Гул) — одиночная карта затирала второго; таймеру нужен список.
 */
export function bossesByZone(zoneCode: string): BossInfo[] {
  return ALL_BOSSES.filter((b) => b.zoneCode === zoneCode);
}

/** Сюжетные боссы одного акта (1..4). */
export function campaignBossesByAct(act: number): BossInfo[] {
  return CAMPAIGN_BOSSES.filter((b) => b.act === act);
}
