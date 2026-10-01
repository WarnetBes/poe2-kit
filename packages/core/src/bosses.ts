/**
 * №104 «Бестиарий боссов» — локальный датасет боссов PoE2 для панели «Прокачка».
 *
 * Источники (канон проекта, проверено 01.10.2026):
 *  - Сюжет/интерлюдии: packages/core/data/zoneNotes.json (RU-гайды Path of Levelling 2,
 *    имена боссов и награды — как в живых гайдах; имена оставлены в той же форме).
 *  - Триалы и пиннакл: poe2wiki.net через poe2_wiki_lookup:
 *    «Pinnacle encounter» (проверено: список пиннаклов, ключи), «The Trialmaster»
 *    (проверено: механики, Fate-ключи), «Trial of the Sekhemas» / «The Trial of Chaos»
 *    (проверено: Балбала/Xyclucian, ключи доступа).
 *
 * Правило: никаких выдуманных имён — только то, что есть в источниках выше.
 * Боссы без имени в гайдах (Mawdun Mine, Bone Pits и т.п. — «Kill the boss») не внесены.
 */

export type BossKind = 'story' | 'interlude' | 'asc-trial' | 'pinnacle';

export interface BossInfo {
  /** Имя, как в источнике (RU — из zoneNotes, EN — из poe2wiki). */
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
  { name: 'Король в Туманах', kind: 'story', act: 1, zone: 'Freythorn', zoneCode: 'G1_12', reward: '+30 Духа и камень Духа 4 ур.', tips: ['Сложная компоновка. Виспы укажут на оставшиеся ритуалы.'] },
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
  { name: 'Рутредж', kind: 'story', act: 3, zone: 'Sandswept Marsh', zoneCode: 'G3_1', reward: 'камень навыка 9 ур.', tips: ['Обычно в центре болота; в траве Кемп Орока даёт Малый Jeweller\u2019s.'] },
  { name: 'Сереброкулак', kind: 'story', act: 3, zone: 'Jungle Ruins', zoneCode: 'G3_3', reward: '+2 очка пассивок', tips: ['Обычно в верхней трети; возьмите ви-поинт в Venom Crypts.'] },
  { name: 'Игнагдук', kind: 'story', act: 3, zone: 'The Azak Bog', zoneCode: 'G3_7', reward: '+30 Духа / камень Духа 10 ур.', tips: ['Босс обычно в верхне-правом квадранте.'] },
  { name: 'Блэкджоу', kind: 'story', act: 3, zone: "Jiquani's Machinarium", zoneCode: 'G3_6_1', reward: '+10% к сопротивлению огню', tips: ['В дальнем левом или правом краю; слушайте звук квестового предмета.'] },
  { name: 'Дорияни', kind: 'story', act: 3, zone: 'The Black Chambers', zoneCode: 'G3_17', reward: 'финал акта 3', tips: ['Первый мост влево/вправо, далее по мостам, всплывающим из воды.'] },
  // ─── Акт 4 ───
  { name: 'Омнифобия', kind: 'story', act: 4, zone: "Journey's End", zoneCode: 'G4_2_2', reward: 'чекпоинт перед боем → +2 очка пассивок', tips: ['Извилистая зона, идите до конца.'] },
  { name: 'Тавакаи', kind: 'story', act: 4, zone: 'Heart of the Tribe', zoneCode: 'G4_11_2', reward: 'конец акта 4', tips: ['Жмите на север; чекпоинт = неверная развилка.'] },
  // ─── Интерлюдии ───
  { name: 'Элдер Мэддокс', kind: 'interlude', act: 'III', zone: 'Пики Криар', reward: 'уникальный предмет', tips: ['Интерлюдия «Запасной план Дорияни»; рядом: Деревня Криар → +40 духу, Воющие пещеры → +2 пассивок.'] },
];

/** Боссы Trials of Ascension (асценданси). */
export const ASC_TRIAL_BOSSES: BossInfo[] = [
  {
    name: 'The Trialmaster',
    kind: 'asc-trial',
    zone: "Trialmaster's Tower",
    access: '3 Fate-ключа: Deadly Fate + Cowardly Fate + Victorious Fate (после полного Trial of Chaos)',
    reward: 'эндгейм-дроп уников',
    tips: [
      'Булава: телепорты, двойной свайп, Sunder-слэмы, Timestop Sunder (три отложенных слэма), Bloodburst (каналируемая зона взрывается), Cyclone c шоквейвами.',
      'Нельзя ставить игру на паузу во время боя. Уровень босса — 80.',
    ],
  },
];

/** Пиннакл-боссы (Pinnacle encounter) — проверено по poe2wiki «Pinnacle encounter». */
export const PINNACLE_BOSSES: BossInfo[] = [
  { name: 'The Arbiter of Ash', kind: 'pinnacle', zone: 'The Burning Monolith', access: 'Ancient/Faded/Weathered Crisis Fragment', reward: '+6 очков дерева атласа, уники', tips: ['Нет опыта за бой, но и без потери опыта при смерти. Квестовые ключи первой попытки — с бесконечными возрождениями.'] },
  { name: 'The Arbiter of Divinity', kind: 'pinnacle', zone: 'The Origin Tower', access: 'Origin Core (Origin Spark + Origin Cradle)', reward: '+6 очков дерева атласа, уники' },
  { name: 'The Raven Trickster', kind: 'pinnacle', zone: 'Delirium (энкаунтер)', access: "Raven's Reflection", reward: 'уники' },
  { name: 'Xesht, We That Are One', kind: 'pinnacle', zone: 'Breach (энкаунтер)', access: 'Breachlord Sac', reward: 'уники' },
  { name: 'The Bodach', kind: 'pinnacle', zone: 'Ritual (энкаунтер)', access: 'Frayed/Ragged Cloth, Tangled Torso, Brittle/Mossy Arm (квест) или 5× Call of the Shadows', reward: 'уники' },
  { name: 'The Aberration', kind: 'pinnacle', zone: 'Expedition (энкаунтер)', access: 'The Triskelion Reforged', reward: 'уники' },
  { name: 'Vessel of Kulemak', kind: 'pinnacle', zone: 'Abyss (энкаунтер)', access: "Kulemak's Invitation", reward: 'уники' },
  { name: 'Atziri, the Red Queen', kind: 'pinnacle', zone: "Atziri's Temple", access: 'без ключа', reward: 'уники' },
];

/** Все боссы одним списком. */
export const ALL_BOSSES: BossInfo[] = [...CAMPAIGN_BOSSES, ...ASC_TRIAL_BOSSES, ...PINNACLE_BOSSES];

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

/** Сюжетные боссы одного акта (1..4). */
export function campaignBossesByAct(act: number): BossInfo[] {
  return CAMPAIGN_BOSSES.filter((b) => b.act === act);
}
