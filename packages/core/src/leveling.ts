/**
 * Гид по прокачке: точные зоны кампании Path of Exile 2 (Акты 1–4).
 *
 * Список зон, порядок следования и ключевые квестовые награды сверены с данными
 * проекта Path of Levelling 2 (Kami-Guru). Порядок зон и награды сохранены,
 * текст заметок переформулирован/сокращён (оригинал под своей лицензией в
 * _research/path-of-levelling-2/src/main/profiles/poe2/referenceData/).
 *
 * Сайд-зоны вне mainline (PoL-2 «Optional Area!», напр. Plunder's Point G4_13)
 * помечены `optional: true`: остаются в плане как опциональный контент, но
 * НЕ предлагаются как «следующая зона» основного сюжета (фикс аудита S3).
 * Интерлюдии (после Акта 4, порядок P1–P3 по PoL-2) вынесены в INTERLUDES:
 * это сайд-хабы без сводной monsterLevel-прогрессии кампании, поэтому в
 * LEVELING_ZONES они не включаются (каждая зона массива требует monsterLevel
 * и участвует в ilvl-подборе зон). Заметки интерлюдий — data/zoneNotes.json.

 */

import type { LevelingZone } from './types.js';
import { getAscendancies, getSkillGems } from './dataset.js';
import { CAMPAIGN_WAYPOINTS } from './waypoints.js';

interface QuestReward {
  /** Название зоны, где получаем награду */
  zone: string;
  /** Босс/событие */
  boss?: string;
  /** Награда */
  reward: string;
}

// Награды по актам (порядок кампании, сверено с зонными заметками).
// №108: экспортируется — источник квестовых наград для questRewards.ts.
export const ACT_REWARDS: QuestReward[] = [
  // Act 1
  { zone: 'Clearfell', boss: 'Beira', reward: '10% Cold Res' },
  { zone: 'Hunting Grounds', boss: 'Crowbell', reward: '2 Passive Points' },
  { zone: 'Freythorn', boss: 'King in the Mists', reward: '30 Spirit + Lvl 4 Spirit Gem' },
  { zone: 'Ogham Farmlands', boss: 'Una\'s Lute', reward: '2 Passive Points' },
  { zone: 'Ogham Manor', boss: 'Candlemass', reward: '+20 Life' },
  // Act 2
  { zone: 'Traitor\'s Passage', boss: 'Balbala', reward: 'Ascendancy' },
  { zone: 'Keth', boss: 'Kabala', reward: '2 Passive Points' },
  { zone: 'Valley of the Titans', boss: 'Ancient Vows', reward: 'Choice' },
  { zone: 'Deshar', boss: 'Final Letter', reward: '2 Passive Points' },
  { zone: 'The Spires of Deshar', boss: 'Sisters of Garukhan', reward: '10% Light Res' },
  // Act 3
  { zone: 'Sandswept Marsh', boss: 'Orok Campfire', reward: 'Lesser Jeweller\'s' },
  { zone: 'Jungle Ruins', boss: 'Mighty Silverfist', reward: '2 Passive Points' },
  { zone: 'The Venom Crypts', boss: 'Venom Draught', reward: 'Choice' },
  { zone: 'The Azak Bog', boss: 'Ignagduk', reward: '30 Spirit / Lvl 10 Spirit Gem' },
  { zone: 'Jiquani\'s Machinarium', boss: 'Blackjaw', reward: '+10% Fire Res' },
  { zone: 'Aggorat', boss: 'Blood Sacrifice', reward: '2 Passive Points' },
  // Act 4
  { zone: 'Journey\'s End', reward: '+2 Passives' },
  { zone: 'Halls of the Dead', reward: '+5 for each Res or Stat' },
  { zone: 'Halls of the Dead', reward: '5% Increased Max Mana' },
  { zone: 'Trial of the Ancestors', reward: '+2 Passives' },
  { zone: 'Abandoned Prison', reward: 'Life/Mana Flask Recovery' },
  { zone: 'Arastas', boss: 'Evening Bell', reward: '3 Exalted Orbs' },
];

/** Перечень точных зон кампании по порядку (Акты 1–4).
 *  `optional: true` — сайд-зона вне mainline («Optional Area!» в PoL-2):
 *  monsterLevel в ней может быть ниже хвоста акта, головы mainline не портит. */
export const LEVELING_ZONES: { act: number; actName: string; zone: string; monsterLevel: number; optional?: boolean }[] = [
  // Act 1 — Пробуждение
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Riverbank', monsterLevel: 1 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Clearfell', monsterLevel: 3 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Mud Burrow', monsterLevel: 3 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Grelwood', monsterLevel: 5 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Red Vale', monsterLevel: 5 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Grim Tangle', monsterLevel: 7 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Cemetery of the Eternals', monsterLevel: 8 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Mausoleum of the Praetor', monsterLevel: 9 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Tomb of the Consort', monsterLevel: 10 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Hunting Grounds', monsterLevel: 11 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Freythorn', monsterLevel: 12 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Ogham Farmlands', monsterLevel: 14 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Ogham Village', monsterLevel: 15 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Manor Ramparts', monsterLevel: 16 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Ogham Manor', monsterLevel: 17 },
  // Act 2 — Пустыня
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Vastiri Outskirts', monsterLevel: 18 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Traitor\'s Passage', monsterLevel: 20 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Halani Gates', monsterLevel: 21 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Keth', monsterLevel: 22 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Lost City', monsterLevel: 23 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Buried Shrines', monsterLevel: 24 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Mastodon Badlands', monsterLevel: 24 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Lightless Passage', monsterLevel: 25 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Bone Pits', monsterLevel: 26 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Valley of the Titans', monsterLevel: 27 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Titan Grotto', monsterLevel: 28 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Deshar', monsterLevel: 29 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Path of Mourning', monsterLevel: 30 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Spires of Deshar', monsterLevel: 31 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Mawdun Quarry', monsterLevel: 32 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Mawdun Mine', monsterLevel: 33 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'The Dreadnought', monsterLevel: 34 },
  { act: 2, actName: 'Акт 2: Пустыня', zone: 'Dreadnought Vanguard', monsterLevel: 35 },
  // Act 3 — Город
  { act: 3, actName: 'Акт 3: Город', zone: 'Sandswept Marsh', monsterLevel: 36 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Jungle Ruins', monsterLevel: 37 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Infested Barrens', monsterLevel: 38 },
  { act: 3, actName: 'Акт 3: Город', zone: 'The Venom Crypts', monsterLevel: 39 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Chimeral Wetlands', monsterLevel: 39 },
  { act: 3, actName: 'Акт 3: Город', zone: 'The Azak Bog', monsterLevel: 40 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Jiquani\'s Machinarium', monsterLevel: 41 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Jiquani\'s Sanctum', monsterLevel: 42 },
  { act: 3, actName: 'Акт 3: Город', zone: 'The Matlan Waterways', monsterLevel: 43 },
  { act: 3, actName: 'Акт 3: Город', zone: 'The Drowned City', monsterLevel: 44 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Apex of Filth', monsterLevel: 44 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Temple of Kopec', monsterLevel: 45 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Utzaal', monsterLevel: 48 },
  { act: 3, actName: 'Акт 3: Город', zone: 'Aggorat', monsterLevel: 49 },
  { act: 3, actName: 'Акт 3: Город', zone: 'The Black Chambers', monsterLevel: 50 },
  // Act 4 — Острова
  { act: 4, actName: 'Акт 4: Острова', zone: 'Isle of Kin', monsterLevel: 51 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Volcanic Warrens', monsterLevel: 52 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Kedge Bay', monsterLevel: 53 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Journey\'s End', monsterLevel: 54 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Whakapanu Island', monsterLevel: 55 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Singing Caverns', monsterLevel: 56 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Eye of Hinekora', monsterLevel: 57 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Halls of the Dead', monsterLevel: 58 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Trial of the Ancestors', monsterLevel: 58 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Abandoned Prison', monsterLevel: 59 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Solitary Confinement', monsterLevel: 60 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Shrike Island', monsterLevel: 60 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Arastas', monsterLevel: 61 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'The Excavation', monsterLevel: 62 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Ngakanu', monsterLevel: 63 },
  { act: 4, actName: 'Акт 4: Острова', zone: 'Heart of the Tribe', monsterLevel: 64 },
  // PoL-2 G4_13: «Optional Area!» — сайд-зона Expedition после финала акта;
  // уровень 56 ниже финального 64, поэтому она optional и не участвует в
  // mainline-цепочке «Следующая зона» / nextZones (фикс аудита S3).
  { act: 4, actName: 'Акт 4: Острова', zone: 'Plunder\'s Point', monsterLevel: 56, optional: true },
];

/**
 * Интерлюдии PoE2 (0.5) — опциональные хаб-зоны между кампанией и эндгеймом.
 * Порядок P1–P3 — по PoL-2 (zoneReferenceData.json: после G4_13 Plunder's Point);
 * по 055-исследованию (ZiggyD 0.5.5) Curse of Holten указан «после акта 2» —
 * расхождение позиционирования, приоритет отдан PoL-2 (см. отчёт фикса S3).
 * Награды — фактические данные PoL-2 (Zone Notes Interludes), уже есть в
 * data/zoneNotes.json (P1_Town..P3_Town).
 */
export const INTERLUDES: { interlude: number; zone: string; zoneCode: string; rewards: string[] }[] = [
  {
    interlude: 1,
    zone: 'Curse of Holten',
    zoneCode: 'P1_Town',
    rewards: ['Soul of the Ferryman (Holten) — дешёвые Greater Runes', '+2 Passive Points (Wolvenhold)'],
  },
  {
    interlude: 2,
    zone: 'The Stolen Barya',
    zoneCode: 'P2_Town',
    rewards: ['+5% Max Life (Skullmaw Stairway, The Khari Crossing)', '+2 Passive Points (Worm and Scorpion)', 'Выбор из 7 баффов (Qimah, можно сменить позже)'],
  },
  {
    interlude: 3,
    zone: "Doriyani's Contingency",
    zoneCode: 'P3_Town',
    rewards: ['+40 Max Spirit (Kriar Village)', '+2 Passive Points (Howling Caves)', 'Уникальный предмет (Elder Maddox, Kriar Peaks)'],
  },
];

/**
 * Собрать полный план прокачки с наградами.
 * Порядок — по массиву зон; награды привязываются по имени зоны.
 * Фикс S3: mainline-цепочка («Следующая зона», финал-босс) строится по
 * не-optional зонам — сайд-зоны не предлагаются как следующий шаг сюжета.
 */
export function buildLevelingPlan(): LevelingZone[] {
  const rewardFor = (zone: string): string[] =>
    ACT_REWARDS.filter((r) => r.zone.toLowerCase() === zone.toLowerCase()).map((r) => r.reward);

  const zones = LEVELING_ZONES;
  // Индекс следующей mainline-зоны (сайд-зоны пропускаются).
  const nextMainlineIdx = (i: number): number | null => {
    for (let j = i + 1; j < zones.length; j++) if (!zones[j]!.optional) return j;
    return null;
  };

  return zones.map((z, i) => {
    const optional = !!z.optional;
    const steps: string[] = [
      z.zone === 'The Riverbank'
        ? 'Пройдите пролог к первому городу (Hillock — босс PoE1, в PoE2 его нет; первый сюжетный босс — Beira в Clearfell)'
        : optional
          ? 'Опциональная зона (сайд-контент, вне сюжетной цепочки акта)'
          : `Пройдите зону "${z.zone}" (рекомендуемый уровень ${z.monsterLevel})`,
    ];
    if (!optional) {
      const nIdx = nextMainlineIdx(i);
      steps.push(nIdx != null ? `Следующая зона: ${zones[nIdx]!.zone}` : 'Финальный босс Акта — Тавакай');
    }
    return {
      act: z.act,
      actName: z.actName,
      zone: z.zone,
      monsterLevel: z.monsterLevel,
      optional: optional || undefined,
      hasWaypoint: CAMPAIGN_WAYPOINTS[z.zone],
      steps,
      rewards: rewardFor(z.zone),
    };
  });
}

/** Кэш плана, чтобы не пересобирать структуру каждый вызов. */
let _cachedPlan: LevelingZone[] | null = null;

/** Полный план прокачки (кэшируется в памяти). */
export function getLevelingPlan(): LevelingZone[] {
  if (!_cachedPlan) _cachedPlan = buildLevelingPlan();
  return _cachedPlan;
}

/** Зоны определённого акта. */
export function getZonesByAct(act: number): LevelingZone[] {
  return getLevelingPlan().filter((z) => z.act === act);
}

/** Рекомендуемый "следующий шаг" по текущей зоне.
 *  Фикс S3: в «следующие» попадают только mainline-зоны ТЕКУЩЕГО акта —
 *  сайд-зоны (напр. Plunder's Point ниже уровнем) и зоны соседних актов
 *  не подмешиваются как «следующая» для сюжета. */
export function nextZones(currentAct: number, currentZone?: string): LevelingZone[] {
  const plan = getLevelingPlan();
  const idx = plan.findIndex((z) => z.act === currentAct && (!currentZone || z.zone === currentZone));
  if (idx < 0) return plan.filter((z) => z.act >= currentAct);
  const cur = plan[idx]!;
  const rest = cur.optional
    ? [] // стоим в сайд-зоне: без mainline-«следующих» внутри неё
    : plan.slice(idx + 1).filter((z) => z.act === currentAct && !z.optional).slice(0, 2);
  return [cur, ...rest];
}

/** Квестовые награды конкретной зоны. */
export function rewardsOf(zone: string): string[] {
  return ACT_REWARDS.filter((r) => r.zone.toLowerCase() === zone.toLowerCase()).map((r) => r.reward);
}

/** Проверить, не ниже ли игрок уровня (недопрокачан). */
export function levelDiff(currentLevel: number, zone: LevelingZone): number {
  return currentLevel - zone.monsterLevel;
}

// ─── Обратная совместимость ─────────────────────────────────────────────
// Старое имя LEVELING_PLAN и getZoneByActAct сохранены, чтобы не ломать
// уже существующие вызовы из оверлея/приложений.
export const LEVELING_PLAN: LevelingZone[] = buildLevelingPlan();
export function getZoneByActAct(act: number): LevelingZone[] {
  return getZonesByAct(act);
}

// ════════════════════════════════════════════════════════════════════════
// Билд-специфичные гиды прокачки — все 8 базовых классов PoE2
// ════════════════════════════════════════════════════════════════════════

/** Совет по прокачке конкретного класса, привязанный к диапазону уровней. */
export interface ClassLevelingTip {
  /** Нижняя граница уровня (включительно). */
  fromLevel: number;
  /** Верхняя граница уровня (включительно), null — до конца. */
  toLevel?: number | null;
  /** Какие камни/способности иметь в этом диапазоне (названия из игры). */
  gems?: string[];
  /** Приоритеты экипировки/статов. */
  gear?: string[];
  /** На что обратить внимание по механике. */
  notes?: string[];
}

/** Гид прокачки одного базового класса. */
export interface ClassLevelingGuide {
  /** Базовый класс: 'Monk', 'Warrior', 'Sorceress', 'Ranger', 'Mercenary', 'Witch', 'Druid', 'Huntress'. */
  baseClass: string;
  /** Краткая характеристика архетипа. */
  tagline: string;
  /** Источник и приоритеты урона. */
  damage: string[];
  /** Приоритеты защиты. */
  defense: string[];
  /** Советы по диапазонам уровней (Акты 1–4, эндгейм). */
  tips: ClassLevelingTip[];
}


/** Ключевые камни и приоритеты Ice Strike Monk для прокачки Актов 1–4.
 *  Камни названы как в игре; уровень — ориентировочный момент получения. */
export const MONK_LEVELING_TIPS: ClassLevelingTip[] = [
  {
    fromLevel: 1,
    toLevel: 11,
    gems: [
      'Ice Strike',
      'Wind Blast',
      'Frozen Locus',
      'Herald of Ice (при доступном Spirit)',
    ],
    gear: [
      'Quarterstaff: как можно больше physical damage и attack speed',
      'Ранние поддержки: Added Cold / Basic Attack Speed / Melee Physical',
    ],
    notes: [
      'Ice Strike конвертирует 80% физического урона в холод — физ на оружии усиляет весь урон.',
      'Третий удар комбо бьёт АоЕ и дальше — научитесь добивать толпу третьим ударом.',
      'Herald of Ice сильно ускоряет зачистку отрядов (холодный взрыв).',
    ],
  },
  {
    fromLevel: 12,
    toLevel: 27,
    gems: [
      'Tempest Flurry (альтернатива на lightning)',
      'Killing Palm',
      'Tempest Bell',
      'Frozen Locus',
    ],
    gear: [
      'Ищите quarterstaff с +Level of all Melee Skills — топовый аффикс.',
      'Добавляйте крит (Critical Hit Chance/Damage Bonus).',
      'Резы: приоритет Fire/Cold/Lightning на броне.',
    ],
    notes: [
      'Из Акта 1 таймайте Killing Palm для генерации Power Charges (усиливают крит).',
      'Tempest Bell — большой АоЕ-берст с кулдауном: стабится под толпой/боссом.',
      'При наличии Spirit держите Herald (ледяной или ярости) для клира.',
    ],
  },
  {
    fromLevel: 28,
    toLevel: 47,
    gems: [
      'Charged Staff',
      'Siphoning Strike',
      'Storm Wave (обзорно)',
      'Tempest Bell',
    ],
    gear: [
      'Цельтесь в 100% крит или высокий крит-шанс + Freeze/Pierce для клира.',
      'Energy Shield + Evasion: бой в ближнем бою требует выживаемости.',
      'Резервация духа: обычно хватает на Herald + один бафф.',
    ],
    notes: [
      'Charged Staff потребляет Power Charges ради большого lightning-буста — связка с Killing Palm/Siphoning Strike.',
      'Siphoning Strike генерирует Power Charges через Shock — для стабильного Charged Staff.',
      'Прокачка после Акта 2 — держитесь близко к рекомендованному уровню зон.',
    ],
  },
  {
    fromLevel: 48,
    toLevel: null,
    gems: [
      'Ice Strike (основной)',
      'Tempest Bell',
      'Herald of Ice',
      'Charged Staff',
      'Killing Palm / Siphoning Strike',
    ],
    gear: [
      'Высокий физический quarterstaff + крит-мультипликатор.',
      'Физ→холод конверсия и аддитивный холод на оружии/кольцах.',
      'Набирайте Spirit-предметы для второго резервного баффа.',
    ],
    notes: [
      'Финальный сетап Ice Strike Monk: ледяной крит-берст + аое третьим ударом.',
      'Держите Tempest Bell для бурста и ломайте вещи на мощных боссах.',
      'При переносе на укрепления/карты — ставьте Herald of Ice в резервацию для клира.',
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════
// Гиды всех 8 базовых классов (камни сверены с датасетом skill_gems 0.5)
// ════════════════════════════════════════════════════════════════════════

/** Гид прокачки одного базового класса. */
export interface ClassLevelingGuide {
  /** Базовый класс: Monk, Warrior, Sorceress, Ranger, Mercenary, Witch, Druid, Huntress. */
  baseClass: string;
  /** Краткая характеристика архетипа. */
  tagline: string;
  /** Приоритеты урона. */
  damage: string[];
  /** Приоритеты защиты. */
  defense: string[];
  /** Советы по диапазонам уровней. */
  tips: ClassLevelingTip[];
}

/** Все 8 базовых классов PoE2 (ключ — lowercase имя базового класса).
 *  Все имена камней проверены по датасету skill_gems (см. validateGuideGems). */
export const CLASS_LEVELING_GUIDES: Record<string, ClassLevelingGuide> = {
  monk: {
    baseClass: 'Monk',
    tagline: 'Ближний бой с quarterstaff: комбо, крит, холод/молния, ES+уклонение.',
    damage: ['Физический урон оружия (конверсия в Cold/Lightning)', 'Critical Hit Chance + Critical Damage Bonus', 'Elemental damage и +Level of All Skills'],
    defense: ['Energy Shield + Evasion гибрид', 'Мобильность (кайт комбо)', 'Резисты на бижутерии'],
    tips: MONK_LEVELING_TIPS,
  },
  warrior: {
    baseClass: 'Warrior',
    tagline: 'Тяжёлые булавы, броня, оглушение и размашистые слэмы.',
    damage: ['Физический урон булав', '% increased Physical Damage', 'Heavy Stun → Boneshatter взрывы'],
    defense: ['Armour + максимум жизни', 'Блок со щитом (Shield Charge)', 'Stun Threshold'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Mace Strike', 'Sunder'],
        gear: ['Булава с высоким физическим уроном', 'Броня: Armour + Flat Life на каждом слоте'],
        notes: [
          'Sunder — основной клир: АоЕ-удар по земле бьёт по линии.',
          'Воин танкует в упор: собирайте жизнь и броню с первого акта.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Sunder', 'Boneshatter', 'Shield Charge', 'Earthquake'],
        gear: ['Булава с % increased Physical Damage', 'Щит с Block Chance для блочного сетапа', 'Резисты'],
        notes: [
          'Boneshatter: сначала heavy stun (длинная полоска над врагом), потом взрыв — цикл stun → shatter.',
          'Shield Charge — мобильность и вход в пачку.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Earthquake', 'Boneshatter', 'Leap Slam', 'Herald of Ash'],
        gear: ['Высокий pdps на булаву', 'Armour + Stun Threshold', 'Spirit-предметы под Herald'],
        notes: [
          'Leap Slam — мгновенное перемещение к пачке.',
          'Earthquake для АоЕ-клира, Boneshatter — по одиночным целям.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Earthquake', 'Boneshatter', 'Rolling Slam', 'Shockwave Slam', 'Herald of Ash'],
        gear: ['Двуручная булава: большой phys + attack speed', 'Полный life/armour сетап', 'Резервация Spirit под Herald'],
        notes: [
          'Асценданси: Titan — усиление слэмов, Warbringer — броня и тотемы, Smith of Kitava — огненный арсенал.',
          'Копите poise-урон: heavy stun боссов = окна для Boneshatter.',
        ],
      },
    ],
  },
  sorceress: {
    baseClass: 'Sorceress',
    tagline: 'Стихийные заклинания: Cold/Lightning/Fire с дистанции, Energy Shield.',
    damage: ['Elemental spell damage', 'Cast Speed + Critical Hit Chance', '+Level of Spell Skills'],
    defense: ['Energy Shield', 'Freeze/Slow контроль', 'Кайт и дистанция'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Spark', 'Frost Bomb', 'Firestorm'],
        gear: ['Wand для кастеров (+Spell Damage)', 'Ранние поддержки основного стихийного гема'],
        notes: [
          'Spark рикошетит от стен — прижимайте паки к замкнутым комнатам.',
          'Frost Bomb замораживает: контроль ранних боссов.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Comet', 'Orb of Storms', 'Lightning Warp', 'Solar Orb'],
        gear: ['+Level of Spell Skills на wand/focus', 'Energy Shield на шлеме и щите', 'Резисты'],
        notes: [
          'Comet — огромный бурст по замороженной цели.',
          'Orb of Storms ставьте в центр пачки — пассивный клир.',
          'Lightning Warp — телепорт-мобильность кастера.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Comet', 'Cast on Critical', 'Orb of Storms', 'Frost Bomb'],
        gear: ['Spell Damage + Cast Speed на wand', 'ES/жизнь гибрид', '+Level of Cold Skills'],
        notes: [
          'Cast on Critical — основа спелл-билдов: crit-шанс триггерит автокаст.',
          'Асценданси Sorceress (0.5): Stormweaver — молния, Chronomancer — время, Disciple of Varashta — стихийные скиллы.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Comet', 'Firestorm', 'Cast on Critical', 'Orb of Storms', 'Herald of Ash'],
        gear: ['Wand+щит или двойной wand с +Spell Level', 'Полный ES или ES/жизнь', 'Резервация под 2 герольда'],
        notes: [
          'Финал: CoC-Comet (молния) или Ignite-Firestorm (огонь).',
          'Список асценданси Sorceress: Stormweaver, Chronomancer, Disciple of Varashta.',
        ],
      },
    ],
  },
  ranger: {
    baseClass: 'Ranger',
    tagline: 'Луки и дальний бой: скорость, снаряды, уклонение.',
    damage: ['Bow damage (физ + Lightning)', 'Attack Speed + Projectile Speed', 'Крит через Deadeye'],
    defense: ['Evasion Rating', 'Movement Speed', 'Кайт'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Galvanic Shards', 'Rain of Arrows'],
        gear: ['Лук с высоким физическим уроном', 'Квиксилвер-фляга — постоянное движение'],
        notes: [
          'Galvanic Shards фрагментирует по пачке — держите дистанцию.',
          'Rain of Arrows перекрывает широкие проходы.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Lightning Arrow', 'Rain of Arrows', 'Snipe', 'Herald of Ice'],
        gear: ['Лук с Added Lightning', 'Evasion на броне', 'Кольца с flat lightning'],
        notes: [
          'Snipe — заряжаемый выстрел по элите (держите кнопку дольше).',
          'Herald of Ice даёт цепные взрывы после убийств — быстрый клир.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Lightning Arrow', 'Twister', 'Snipe', 'Herald of Ice'],
        gear: ['Высокий pdps лук + attack speed', 'Evasion', 'Перчатки с attack speed'],
        notes: [
          'Twister — торнадо затягивает и бьёт АоЕ, топ-клир.',
          'Deadeye усиливает снаряды и разгон атаки.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Lightning Arrow', 'Twister', 'Snipe', 'Herald of Ice'],
        gear: ['Rare-лук с pdps/критом', 'Полный Evasion', 'Spirit под герольда'],
        notes: [
          'Финал Deadeye: разгон лука до 6+ атак/сек.',
          'Pathfinder — альтернатива через фляги и яды.',
        ],
      },
    ],
  },
  mercenary: {
    baseClass: 'Mercenary',
    tagline: 'Арбалеты и гранаты: гибрид Armour + Evasion.',
    damage: ['Physical/Cold/Fire болты', 'Reload + attack speed', 'Гранаты: Gas/Plague комбо'],
    defense: ['Armour + Evasion', 'Stun Threshold', 'Дистанция'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Explosive Shot', 'Permafrost Bolts'],
        gear: ['Арбалет с высоким физическим уроном', 'Гибридная броня (Armour + Evasion)'],
        notes: [
          'Explosive Shot — ранний клир с взрывом.',
          'Permafrost Bolts охлаждают: замедляйте погонь.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Explosive Shot', 'Gas Arrow', 'Salvo', 'Rapid Shot'],
        gear: ['Арбалет с Added Fire/Cold', 'Armour + Evasion', 'Резисты'],
        notes: [
          'Gas Arrow + поджог — мощное АоЕ против пачек.',
          'Salvo — залп для толп в проходах.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Explosive Shot', 'Gas Grenade', 'Plague Bearer', 'Rapid Shot'],
        gear: ['Арбалет с pdps + reload speed', 'Гибрид брони', 'Stun Threshold'],
        notes: [
          'Gas Grenade накрывает площадь — комбо с поджогом.',
          'Асценданси Mercenary (0.5): Witchhunter — против элиты и проклятых, Gemling Legionnaire — статы и гибкость, Tactician — гранаты и тактика.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Explosive Shot', 'Gas Grenade', 'Rapid Shot', 'Salvo'],
        gear: ['Финальный арбалет с критом', 'Armour/Evasion баланс', 'Резиты + Spirit'],
        notes: [
          'Финал: бурсты по кулдаунам + контроль гранатами.',
          'Support-гемы на reloading компенсируют паузы volley.',
        ],
      },
    ],
  },
  witch: {
    baseClass: 'Witch',
    tagline: 'Миньоны, Chaos DoT и Energy Shield.',
    damage: ['Minion Damage (Skeletal Arsonist / Frost Mage / Reaver)', 'Essence Drain + Contagion (Chaos DoT)', 'Raging Spirits'],
    defense: ['Energy Shield', 'Миньоны как щит', 'Spirit для второй армии'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Raise Zombie', 'Skeletal Warrior Minion', 'Skeletal Arsonist Minion', 'Essence Drain'],
        gear: ['Wand с +Minion Damage', 'Ранние minion-поддержки'],
        notes: [
          'Essence Drain — DoT, который лечит вас.',
          'Держите миньонов между собой и пачками.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Skeletal Arsonist Minion', 'Skeletal Frost Mage Minion', 'Skeletal Cleric Minion', 'Contagion', 'Essence Drain'],
        gear: ['Spirit на предметах: больше миньонов', '+Level of Minion Skills', 'ES на шлеме'],
        notes: [
          'Contagion + Essence Drain: DoT распространяется по трупам — цепные пачки.',
          'Skeletal Cleric лечит армию.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Skeletal Reaver Minion', 'Skeletal Storm Mage Minion', 'Raging Spirits', 'Contagion'],
        gear: ['Spirit-экип под вторую армию', 'Energy Shield + Chaos Res', 'Minion-life поддержки'],
        notes: [
          'Raging Spirits — временные короткие бёрсты для дерга боссов.',
          'Lich — ES и сустейн; Blood Mage — касты за жизнь.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Skeletal Reaver Minion', 'Skeletal Storm Mage Minion', 'Raging Spirits', 'Contagion', 'Essence Drain', 'Summon Infernal Hound'],
        gear: ['Полный ES-сетап', '+Level of Minion Skills на wand/focus', 'Spirit под третью армию'],
        notes: [
          'Финал: армия + Contagion-DoT накрывает карты.',
          'Cast on Minion Death — триггер-касты при смерти миньонов.',
        ],
      },
    ],
  },
  druid: {
    baseClass: 'Druid',
    tagline: 'Форма медведя, слэмы и Ferocity.',
    damage: ['Slam-урон (Maul / Shockwave Slam)', 'Физический урон в форме', 'Ferocity: усиленные слэмы'],
    defense: ['Max Life + Armour', 'Формы и само-восстановление', 'Ward/resists от природы'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Maul', 'Leap Slam', 'Sunder'],
        gear: ['Булава с физическим уроном', 'Жизнь и броня на старте'],
        notes: [
          'Maul в форме медведя бьёт АоЕ.',
          'Leap Slam — вход в пачку и мобильность.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Brambleslam', 'Shockwave Slam', 'Ferocious Roar'],
        gear: ['Булава с % increased Physical Damage', 'Armour + Stun Threshold', 'Резисты'],
        notes: [
          'Brambleslam — АоЕ с дистанцией.',
          'Ferocious Roar усиляет следующие слэмы: кастуйте перед боссом.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Shockwave Slam', 'Rolling Slam', 'Leap Slam', 'Ferocious Roar'],
        gear: ['Высокий pdps двуручной булавы', 'Life + Armour приоритет'],
        notes: [
          'Rolling Slam — вращающийся АоЕ по большой пачке.',
          'Ferocity копится на элите: усиленный slam ломает poise боссов.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Shockwave Slam', 'Rolling Slam', 'Ferocious Roar', 'Wild Protector'],
        gear: ['Двуручная булава с большим phys', 'Полный life/armour', 'Spirit под формовые скиллы'],
        notes: [
          'Финал: стаки Ferocity → Ferocious Roar → Shockwave Slam.',
          'Асценданси Druid (0.5): Oracle и Shaman — детали узлов см. poe2_ascendancy_nodes.',
        ],
      },
    ],
  },
  huntress: {
    baseClass: 'Huntress',
    tagline: 'Копья: ближний бой и метание, ловушки охоты.',
    damage: ['Spear damage (melee/thrown)', 'Lightning Spear + Tornado АоЕ', 'Blood Hunt добивания'],
    defense: ['Evasion и движение', 'Контратаки/доги', 'Резисты на бижутерии'],
    tips: [
      {
        fromLevel: 1,
        toLevel: 11,
        gems: ['Spear Stab', 'Spear Throw', 'Rock Throw'],
        gear: ['Копьё с высоким физическим уроном', 'Уклонение и движение'],
        notes: [
          'Spear Throw — ранний дальний бой.',
          'Чередуйте Stab (ближний) и Throw (дальний) под ситуацию.',
        ],
      },
      {
        fromLevel: 12,
        toLevel: 27,
        gems: ['Lightning Spear', 'Tornado', 'Spear Throw', 'Blood Hunt'],
        gear: ['Копьё с Added Lightning', 'Evasion на всех слотах', 'Кольца с flat lightning'],
        notes: [
          'Tornado затягивает врагов — сетап под Lightning Spear.',
          'Blood Hunt: добивайте раненых — восстановление через убийства.',
        ],
      },
      {
        fromLevel: 28,
        toLevel: 47,
        gems: ['Lightning Spear', 'Explosive Spear', 'Spear Throw', 'Hex Bloom'],
        gear: ['Высокий pdps spear + attack speed', 'Evasion', 'Крит-моды'],
        notes: [
          'Explosive Spear втыкается и взрывается АоЕ — топ-клир.',
          'Amazon — ярость охоты и бешенство копьеметания.',
        ],
      },
      {
        fromLevel: 48,
        toLevel: null,
        gems: ['Lightning Spear', 'Tornado', 'Explosive Spear', 'Spear Dash'],
        gear: ['Финальное копьё: крит + speed', 'Полный Evasion', 'Spirit под герольда'],
        notes: [
          'Amazon — копья и ярость; Ritualist — кровавые ритуалы; Spirit Walker — духи и живучесть.',
          'Spear Dash — мобильность и обстановка пачек.',
        ],
      },
    ],
  },
};

/** Список базовых классов с краткой характеристикой. */
export function listLevelingClasses(): Array<{ baseClass: string; tagline: string; tipCount: number }> {
  return Object.values(CLASS_LEVELING_GUIDES).map((g) => ({
    baseClass: g.baseClass,
    tagline: g.tagline,
    tipCount: g.tips.length,
  }));
}

/**
 * Статическое соответствие «асценданси → базовый класс» (факты игры 0.5).
 * Работает без офлайн-датасета — в том числе в браузере (apps/web),
 * где дисковые датасеты недоступны.
 */
const ASCENDANCY_BASE: Record<string, string> = {
  // Druid
  oracle: 'Druid',
  shaman: 'Druid',
  // Huntress
  amazon: 'Huntress',
  ritualist: 'Huntress',
  'spirit walker': 'Huntress',
  // Mercenary
  'gemling legionnaire': 'Mercenary',
  tactician: 'Mercenary',
  witchhunter: 'Mercenary',
  // Monk
  'acolyte of chayula': 'Monk',
  invoker: 'Monk',
  'martial artist': 'Monk',
  // Ranger
  deadeye: 'Ranger',
  pathfinder: 'Ranger',
  // Sorceress
  chronomancer: 'Sorceress',
  'disciple of varashta': 'Sorceress',
  stormweaver: 'Sorceress',
  // Warrior
  'smith of kitava': 'Warrior',
  titan: 'Warrior',
  warbringer: 'Warrior',
  // Witch
  'abyssal lich': 'Witch',
  'blood mage': 'Witch',
  infernalist: 'Witch',
  lich: 'Witch',
};

/** Резолвит гайд по базовому классу ИЛИ асценданси ('Invoker' → Monk, 'Lich' → Witch).
 *  Кейс-инсенсивно; принимает английские имена классов и асценданси. */
export function resolveLevelingClass(query: string | null | undefined): ClassLevelingGuide | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (CLASS_LEVELING_GUIDES[q]) return CLASS_LEVELING_GUIDES[q]!;
  for (const guide of Object.values(CLASS_LEVELING_GUIDES)) {
    if (guide.baseClass.toLowerCase() === q) return guide;
  }
  // Статическая карта асценданси — работает и без датасета (браузер).
  const base = ASCENDANCY_BASE[q];
  if (base) {
    const g = CLASS_LEVELING_GUIDES[base.toLowerCase()];
    if (g) return g;
  }
  // Fallback: датасет PoE2 (только Node — в браузере getAscendancies кидает).
  try {
    for (const asc of getAscendancies()) {
      const name = asc.displayName.toLowerCase();
      if (name === q || name.includes(q)) {
        const g = CLASS_LEVELING_GUIDES[asc.baseClass.toLowerCase()];
        if (g) return g;
      }
    }
  } catch {
    // нет дискового датасета (браузер) — уже попробовали статическую карту
  }
  return null;
}

/** Советы по прокачке для класса/асценданси по диапазону уровней.
 *  query: базовый класс ('Monk') или асценданси ('Invoker'); null → Monk (совместимость). */
export function getClassLevelingTips(
  query?: string | null,
  level?: number,
): ClassLevelingTip[] {
  const guide = resolveLevelingClass(query) ?? CLASS_LEVELING_GUIDES.monk!;
  if (level == null) return guide.tips;
  return guide.tips.filter(
    (t) => level >= t.fromLevel && (t.toLevel == null || level <= t.toLevel),
  );
}

/** Самый приоритетный совет для класса на текущем уровне. */
export function getClassLevelingHint(query?: string | null, level?: number): string {
  const guide = resolveLevelingClass(query) ?? CLASS_LEVELING_GUIDES.monk!;
  const tips = getClassLevelingTips(query, level);
  if (!tips.length) return `${guide.baseClass}: ${guide.tagline}`;
  const parts: string[] = [];
  if (tips[0]?.gems?.length) parts.push('Камни: ' + tips[0].gems.join(', '));
  if (tips[0]?.notes?.length) parts.push(tips[0].notes[0]!);
  if (tips[0]?.gear?.length) parts.push('Экип: ' + tips[0].gear[0]);
  return parts.join(' | ');
}

/** Общий план прокачки, обогащённый советами конкретного класса.
 *  query: базовый класс или асценданси; null/undefined → Monk (совместимость). */
export function getClassLevelingPlan(query?: string | null): LevelingZone[] {
  const guide = resolveLevelingClass(query) ?? CLASS_LEVELING_GUIDES.monk!;
  const tag = guide.baseClass;
  return getLevelingPlan().map((z) => {
    const tip = guide.tips.find(
      (t) => z.monsterLevel >= t.fromLevel && (t.toLevel == null || z.monsterLevel <= t.toLevel),
    );
    if (!tip) return z;
    const extras: string[] = [];
    if (tip.gems?.length) extras.push(`⚔ ${tag}: используйте ${tip.gems.join(', ')}`);
    if (tip.notes?.length) extras.push(`💡 ${tip.notes[0]}`);
    if (tip.gear?.length) extras.push(`🛠 ${tip.gear[0]}`);
    return { ...z, steps: [...z.steps, ...extras] };
  });
}

/** Проверить, что все камни в гайдах существуют в датасете PoE2.
 *  Возвращает словарь className → список неизвестных гемов ('Warrior → ...').
 *  Аннотации в скобках отбрасываются: 'Herald of Ice (при Spirit)' → 'Herald of Ice'. */
export function validateGuideGems(): Record<string, string[]> {
  const known = new Set(getSkillGems().map((g) => g.name.trim().toLowerCase()));
  const bad: Record<string, string[]> = {};
  for (const guide of Object.values(CLASS_LEVELING_GUIDES)) {
    const missing: string[] = [];
    for (const tip of guide.tips) {
      for (const gem of tip.gems ?? []) {
        const base = gem.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
        if (!base || base.includes('/')) continue; // слэши = альтернативы, проверим каждую часть
        for (const part of base.split('/').map((s) => s.trim()).filter(Boolean)) {
          if (!known.has(part)) missing.push(part);
        }
      }
    }
    if (missing.length) bad[guide.baseClass] = [...new Set(missing)];
  }
  return bad;
}

// ─── Совместимость: старые Monk-функции делегируют новым generic ────────────

/** Полный набор советов Ice Strike Monk по порядку кампании (deprecated: getClassLevelingTips). */
export function getMonkLevelingTips(level?: number): ClassLevelingTip[] {
  return getClassLevelingTips('Monk', level);
}

/** Совет Ice Strike Monk, подходящий текущему уровню (deprecated: getClassLevelingHint). */
export function getMonkLevelingHint(level?: number): string {
  return getClassLevelingHint('Monk', level);
}

/** План прокачки с советами Ice Strike Monk (deprecated: getClassLevelingPlan). */
export function getMonkLevelingPlan(): LevelingZone[] {
  return getClassLevelingPlan('Monk');
}