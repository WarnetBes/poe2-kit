/**
 * №108 «Quest Passives Helper» — квестовые награды кампании PoE2.
 *
 * ИСТОЧНИК — только собственные данные репо: ACT_REWARDS из leveling.ts
 * (22 награды, сверено с Path of Levelling 2) + zoneNotes.json (zoneCode зон).
 * Квесты вне этих данных НЕ выдуманы.
 *
 * COVERAGE (честно): покрытие — 22 квестовые награды в 20 зонах актов 1–4.
 * Это НЕ полный список всех квестов игры: интерлюдии (Мэддокс-цепочка,
 * Криар +40 Духа, Воющие пещеры +2 пассивок) в ACT_REWARDS отсутствуют —
 * их RU-факты живут только в bosses.tips, сюда не выгружаются.
 * Асценданси-награды триалов — только «Ascendancy» за Balbala (акт 2).
 *
 * RU-описания — перевод тех же строк ACT_REWARDS, согласованный с
 * формулировками bosses.ts (zoneNotes-гайды).
 */

import { ACT_REWARDS, LEVELING_ZONES } from './leveling.js';
import { getZoneNoteByName } from './zoneNotes.js';

/** Тип важной награды. */
export type QuestRewardKind =
  | 'spirit'      // +Дух / камень Духа
  | 'passive'     // очки пассивок
  | 'resist'      // элем-резисты
  | 'ascendancy'  // асценданси
  | 'life'
  | 'mana'
  | 'other';

/** Какой резист даёт квест (для подсветки «резист < 75%»). */
export type ResistVector = 'fire' | 'cold' | 'lightning' | 'all' | null;

export interface QuestRewardEntry {
  /** Ключ персиста «забрал»: `${act}|${zone}|${reward}`. */
  key: string;
  zone: string;
  /** Код зоны из zoneNotes (match с Client.txt areaCode) или null. */
  zoneCode: string | null;
  act: number;
  /** Босс/событие квеста (из ACT_REWARDS, как есть). */
  boss?: string;
  /** Награда как в данных (EN). */
  reward: string;
  /** RU-описание награды. */
  rewardRu: string;
  kind: QuestRewardKind;
  /** Spirit/резист/асц/пассивки — блокируется в чек-лист №108. */
  important: boolean;
  /** Только для kind='resist'. */
  resistKind: ResistVector;
}

/** RU-переводы ровно тех строк, что есть в ACT_REWARDS (сверено с гайдами). */
const RU_REWARD_TEXT: Record<string, string> = {
  '10% Cold Res': '+10% к сопротивлению холоду',
  '2 Passive Points': '+2 очка пассивок',
  '30 Spirit + Lvl 4 Spirit Gem': '+30 Духа и камень Духа 4 ур.',
  "+20 Life": '+20 к жизни',
  'Ascendancy': 'асценданси (вход в Trial of the Sekhemas)',
  'Choice': 'награда на выбор',
  '10% Light Res': '+10% к сопротивлению молнии',
  "Lesser Jeweller's": 'Малый Jeweller’s',
  '30 Spirit / Lvl 10 Spirit Gem': '+30 Духа / камень Духа 10 ур.',
  '+10% Fire Res': '+10% к сопротивлению огню',
  '+2 Passives': '+2 очка пассивок',
  '+5 for each Res or Stat': '+5 к каждому резисту или характеристике',
  '5% Increased Max Mana': '+5% к максимуму маны',
  'Life/Mana Flask Recovery': 'улучшение флаконов жизни/маны',
  '3 Exalted Orbs': '3 сферы Exalted',
};

function kindOf(reward: string): QuestRewardKind {
  if (/Ascendancy/i.test(reward)) return 'ascendancy';
  if (/Spirit/i.test(reward)) return 'spirit';
  if (/Res\b|Resistance/i.test(reward) || /\+5 for each Res/.test(reward)) return 'resist';
  if (/Passive/i.test(reward)) return 'passive';
  if (/^\+20 Life/.test(reward)) return 'life';
  if (/Max Mana/.test(reward)) return 'mana';
  return 'other';
}

function resistVectorOf(reward: string): ResistVector {
  if (/Cold Res/i.test(reward)) return 'cold';
  if (/Light Res/i.test(reward)) return 'lightning';
  if (/Fire Res/i.test(reward)) return 'fire';
  if (/\+5 for each Res/i.test(reward)) return 'all';
  return null;
}

function actOfZone(zone: string): number {
  const hit = LEVELING_ZONES.find((z) => z.zone.toLowerCase() === zone.toLowerCase());
  return hit?.act ?? 0;
}

function buildEntries(): QuestRewardEntry[] {
  return ACT_REWARDS.map((r) => {
    const key = `${actOfZone(r.zone)}|${r.zone}|${r.reward}`;
    return {
      key,
      zone: r.zone,
      zoneCode: getZoneNoteByName(r.zone)?.zoneCode ?? null,
      act: actOfZone(r.zone),
      boss: r.boss,
      reward: r.reward,
      rewardRu: RU_REWARD_TEXT[r.reward] ?? r.reward,
      kind: kindOf(r.reward),
      important: false,
      resistKind: null,
    };
  }).map((e) => ({
    ...e,
    important: e.kind === 'spirit' || e.kind === 'resist' || e.kind === 'ascendancy' || e.kind === 'passive',
    resistKind: e.kind === 'resist' ? resistVectorOf(e.reward) : null,
  }));
}

/** Все квестовые награды кампании (22 записи из ACT_REWARDS). */
export const QUEST_REWARDS: QuestRewardEntry[] = buildEntries();

/** Важные награды (Spirit/резист/асц/пассивки). */
export function importantQuestRewards(): QuestRewardEntry[] {
  return QUEST_REWARDS.filter((q) => q.important);
}

/** Квестовые награды одного акта (1..4), в порядке зон. */
export function questRewardsByAct(act: number): QuestRewardEntry[] {
  return QUEST_REWARDS.filter((q) => q.act === act);
}

/** Важные квестовые награды зоны по коду (или null). */
export function questRewardsByZoneCode(zoneCode: string): QuestRewardEntry[] {
  return QUEST_REWARDS.filter((q) => q.important && q.zoneCode === zoneCode);
}

export interface UnclaimedQuest extends QuestRewardEntry {
  /** 'missed' — зона пройдена, награду легко было упустить; 'todo' — ещё впереди. */
  status: 'missed' | 'todo';
}

/**
 * №108: неполученные важные квесты текущего и прошлых актов.
 *
 * Первый версии хватит ручного чек-марка «забрал» (claimed[]): авто-детекта
 * «получена ли награда» по build state нет (в Client.txt этого не пишут).
 * Сортировка: ближе к текущей позиции в кампании — выше.
 */
export function unclaimedQuests(
  opts: {
    /** Текущий акт (акт >= него — «впереди», кроме посещённых зон). */
    act: number;
    /** Персистентный furthest из leveling-progress.json. */
    furthest?: { act: number; index: number } | null;
    /** areaCode посещённых зон (окно хвоста Client.txt). */
    visitedCodes?: string[];
    /** Ключи, отмеченные «забрал» (leveling-progress.json claimedRewards). */
    claimed?: string[];
  } = { act: 1 },
): UnclaimedQuest[] {
  const claimed = new Set(opts.claimed ?? []);
  const visited = new Set((opts.visitedCodes ?? []).filter(Boolean));
  const furthest = opts.furthest ?? null;
  const actZones = new Map<number, string[]>();
  for (const z of LEVELING_ZONES) {
    const list = actZones.get(z.act) ?? [];
    list.push(z.zone);
    actZones.set(z.act, list);
  }
  const zoneIndex = (act: number, zone: string): number => {
    const list = actZones.get(act) ?? [];
    return list.findIndex((z) => z.toLowerCase() === zone.toLowerCase());
  };

  const out: UnclaimedQuest[] = [];
  for (const q of QUEST_REWARDS) {
    if (!q.important) continue;
    if (claimed.has(q.key)) continue;
    if (q.act > opts.act) continue; // будущие акты не показываем
    const zoneDone =
      (furthest != null && furthest.act > q.act) ||
      (!!q.zoneCode && visited.has(q.zoneCode)) ||
      (furthest != null && furthest.act === q.act && zoneIndex(q.act, q.zone) >= 0 && zoneIndex(q.act, q.zone) < furthest.index);
    if (q.act === opts.act && !zoneDone) {
      out.push({ ...q, status: 'todo' });
    } else if (zoneDone) {
      out.push({ ...q, status: 'missed' });
    }
  }

  // Сортировка: расстояние от furthest-позиции по глобальному плану зон.
  const globalIndex = (act: number, zone: string): number => {
    const zi = zoneIndex(act, zone);
    if (zi < 0) return 0;
    const before = LEVELING_ZONES.filter((z) => z.act < act).length;
    return before + zi;
  };
  const curGlobal = furthest ? LEVELING_ZONES.filter((z) => z.act < furthest.act).length + furthest.index : 0;
  // missed ближе к текущей позиции — выше; todo — сразу после missed-хвоста.
  out.sort((a, b) => {
    const da = Math.abs(globalIndex(a.act, a.zone) - curGlobal);
    const db = Math.abs(globalIndex(b.act, b.zone) - curGlobal);
    if (a.status !== b.status) return a.status === 'missed' ? -1 : 1;
    return da - db;
  });
  return out;
}

/** Заголовок панели «⚜ Квесты» (coverage честно, из шапки модуля). */
export const QUEST_REWARDS_COVERAGE_RU =
  'Квестовые награды кампании (акты 1–4) по данным гайдов прокачки кита: ' +
  'Spirit, резисты, очки пассивок, асценданси. Интерлюдии и полный список всех квестов игры не покрывает.';
