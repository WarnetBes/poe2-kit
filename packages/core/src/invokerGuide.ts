/**
 * Invoker-гайд по этапам прокачки (P8 ч.2, №281-W2): Ice Strike Invoker (CI),
 * SSF-дорожная карта по уровням 1–95.
 *
 * Датасет: data/game/guides/invoker_leveling.json — слияние трёх источников
 * (MIT poe2-leveling акты 1-4 + наш builds_roadmap.md КУБ-1 + PoL-2 G-коды);
 * inline-ится в сборку (браузер+Node), по образцу simulacrum_facts (№239).
 *
 * «Без дублей»: зонный чейн кампании живёт в leveling.ts (LEVELING_ZONES),
 * гемы по диапазонам уровней — в MONK_LEVELING_TIPS (poe2_leveling_class),
 * награды — в ACT_REWARDS. Здесь только этапные цели/переходы и PoB-таргеты.
 */

import invokerGuideFile from '../data/game/guides/invoker_leveling.json' with { type: 'json' };

export interface InvokerGuideSource {
  name: string;
  license: string;
  path: string;
  used_for: string;
}

export interface InvokerGuideTargets {
  totalDps: number;
  totalEhp: number;
  es: number;
  evasion: number;
  spirit: number;
  critChancePct: number;
  critMulti: number;
  resistsEndgame: number[];
  keyBuffs: string[];
  curse: string;
}

export interface InvokerGuideStage {
  stage: number;
  levelRange: [number, number];
  acts: string;
  title: string;
  theme: string;
  skillOrder?: string[];
  supportPriority?: string;
  gear?: string;
  gearSlots?: Record<string, string>;
  tree?: string;
  ciGate?: string;
  watchOut?: string;
}

export interface InvokerGuide {
  _meta: { id: string; title: string; patch: string; as_of: string; sources: InvokerGuideSource[]; note: string };
  build: {
    class: string;
    ascendancy: string;
    mainSkill: string;
    defense: string;
    mode: string;
    pobRef: string;
    league: string;
    targets: InvokerGuideTargets;
  };
  stages: InvokerGuideStage[];
  ssfPriorities: string[];
}

/** Полный Invoker-гайд (этапы 1–4 + билд-карточка + PoB-таргеты). */
export function getInvokerGuide(): InvokerGuide {
  return invokerGuideFile as InvokerGuide;
}

/** Этап по уровню персонажа; границы — включительно (диапазоны 1-30/30-60/60-80/80-95).
 *  null — вне диапазонов (например level 96+: этап 4 последний, всё равно возвращаем его
 *  как «финальная сборка и далее»). */
export function getInvokerStage(level?: number | null): InvokerGuideStage | null {
  const stages = getInvokerGuide().stages;
  const sorted = [...stages].sort((a, b) => a.levelRange[0] - b.levelRange[0]);
  if (level == null) return sorted[0] ?? null;
  for (const s of sorted) {
    if (level >= s.levelRange[0] && level <= s.levelRange[1]) return s;
  }
  const last = sorted[sorted.length - 1]!;
  if (level > last.levelRange[1]) return last; // за 95 — финальный этап и далее
  if (level < sorted[0]!.levelRange[0]) return sorted[0]!; // до 1 — стартовый
  return null;
}

/** Следующий этап (для чеклиста «что дальше»); null на последнем. */
export function getNextInvokerStage(stage: number): InvokerGuideStage | null {
  return getInvokerGuide().stages.find((s) => s.stage === stage + 1) ?? null;
}
