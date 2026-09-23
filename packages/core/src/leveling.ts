/**
 * Гид по прокачке: точные зоны кампании Path of Exile 2 (Акты 1–4 + интерлюдии).
 *
 * Список зон, порядок следования и ключевые квестовые награды сверены с данными
 * проекта Path of Levelling 2 (Kami-Guru). Порядок зон и награды сохранены,
 * текст заметок переформулирован/сокращён (оригинал под своей лицензией в
 * _research/path-of-levelling-2/src/main/profiles/poe2/referenceData/).
 */

import type { LevelingZone } from './types.js';

interface QuestReward {
  /** Название зоны, где получаем награду */
  zone: string;
  /** Босс/событие */
  boss?: string;
  /** Награда */
  reward: string;
}

// Награды по актам (порядок кампании, сверено с зонными заметками).
const ACT_REWARDS: QuestReward[] = [
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

/** Перечень точных зон кампании по порядку (Акты 1–4). */
export const LEVELING_ZONES: { act: number; actName: string; zone: string; monsterLevel: number }[] = [
  // Act 1 — Пробуждение
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Riverbank', monsterLevel: 1 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Clearfell', monsterLevel: 3 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Mud Burrow', monsterLevel: 3 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Grelwood', monsterLevel: 5 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Red Vale', monsterLevel: 5 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'The Grim Tangle', monsterLevel: 7 },
  { act: 1, actName: 'Акт 1: Пробуждение', zone: 'Cemetary of the Eternals', monsterLevel: 8 },
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
  { act: 4, actName: 'Акт 4: Острова', zone: 'Plunder\'s Point', monsterLevel: 56 },
];

/**
 * Собрать полный план прокачки с наградами.
 * Порядок — по массиву зон; награды привязываются по имени зоны.
 */
export function buildLevelingPlan(): LevelingZone[] {
  const rewardFor = (zone: string): string[] =>
    ACT_REWARDS.filter((r) => r.zone.toLowerCase() === zone.toLowerCase()).map((r) => r.reward);

  return LEVELING_ZONES.map((z, i) => ({
    act: z.act,
    actName: z.actName,
    zone: z.zone,
    monsterLevel: z.monsterLevel,
    steps: [
      z.zone === 'The Riverbank'
        ? 'Убить Хиллока и выйти в город'
        : `Пройдите зону "${z.zone}" (рекомендуемый уровень ${z.monsterLevel})`,
      ...(i < LEVELING_ZONES.length - 1
        ? [`Следующая зона: ${LEVELING_ZONES[i + 1]!.zone}`]
        : ['Финальный босс Акта — Тавакай']),
    ],
    rewards: rewardFor(z.zone),
  }));
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

/** Рекомендуемый "следующий шаг" по текущей зоне. */
export function nextZones(currentAct: number, currentZone?: string): LevelingZone[] {
  const plan = getLevelingPlan();
  const idx = plan.findIndex((z) => z.act === currentAct && (!currentZone || z.zone === currentZone));
  if (idx < 0) return plan.filter((z) => z.act >= currentAct);
  return plan.slice(idx, idx + 3);
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