/**
 * W4-1: map-check «выдержит ли билд ЭТУ карту» — вердикт DANGER/CAREFUL/FINE
 * по модам waystone против вашего билда.
 *
 * Idea reference: poe2-upgrade-checker (GPL-3) map check — НИ СТРОКИ кода
 * не скопировано: перенята эвристика «моды max-res против вашего билда →
 * DANGER/CAREFUL/FINE» (не охраняема).
 *
 * Реализация — своя, поверх существующего ядра кита:
 *  - mapThreat (№234, waystone_mods.json 74 группы) → playerDebuffs (max_res,
 *    recovery, regen_block, …);
 *  - estimateBuild гира → текущие EHP-слои и резисты игрока;
 *  - слой max_res пересчитывается ГИДРАВЛИКОЙ ЭЛЕМ-СЛОЯ: EHP ∝ 1/(1−res/100),
 *    res_effective = min(res, 75 − maxresDebuff) — механика PoE честная:
 *    штраф капа не режет резист ниже его текущего значения (uncapped игрок
 *    не страдает);
 *  - пороги: потеря EHP слоя ≥25% → DANGER, ≥10% → CAREFUL, иначе FINE.
 *    Наследование PoE-механики: capped игрок −12% капа: 0.37/0.25 → −32%;
 *    −5% (мин. ступень of Exposure 5-8): ≤ −16% → CAREFUL.
 *
 * Сознательные границы (честно в ответе тула):
 *  - оценка estimate-слоя (без дерева/аур), НЕ PoB2-точная; CI-decyclers:
 *    chaos-слой для жизни ~0 обнуляется движком сам;
 *  - кроме max_res числовых модов НЕТ пересчёта (recovery/regen/slow —
 *    факторные строки в reasoning, поднимают вердикт не ниже CAREFUL);
 *  - точный PoB-вердикт max-res (oracle override) — следующий этап.
 */

import { estimateBuild } from './estimate.js';
import { mapThreat, type MapPlayerDebuff } from './mapPrep.js';

export type MapVerdict = 'danger' | 'careful' | 'fine';

export interface MapCheckResult {
  verdict: MapVerdict;
  /** Максимальная потеря EHP одного элем-слоя, % (undefined — max_res-модов нет). */
  worstEhpLossPct?: number;
  /** Какой слой просел сильнее. */
  worstLayer?: 'fire' | 'cold' | 'lightning' | 'chaos';
  /** Текущие резисты игрока (geres+дерево, estimate) и эффективный кап после max-res. */
  resists: { fire: number; cold: number; lightning: number; chaos: number };
  maxResPenaltyPct?: number;
  /** Немоделируемые жёсткие дебаффы (recovery/regen/slow/блокировки) — факторные. */
  harshEffects: string[];
  reasons: string[];
  /** Веса элементов карты (0..100) — к чему готовить сопротивление. */
  elements?: Record<string, number>;
  matchedMods: string[];
  unknownMods: string[];
}

const BASE_RES_CAP = 75; // canon кап PoE2 (ehp.ts клампит слои в 75)
const DANGER_LOSS_PCT = 25;
const CAREFUL_LOSS_PCT = 10;

export interface MapCheckInput {
  /** Моды waystone как в игре (строки stat_text или имена 'of Exposure'). */
  mods: string[];
  /** Id/EN-имя карты (опц., даёт boss-контекст в reasoning). */
  map?: string;
  /** Waystone-тир 1–16. */
  tier?: number;
}

/**
 * Вердикт карты против билда. buildRaw — PoB share-код или XML (то, что
 * оверлей хранит в buildState.rawInput).
 */
export async function checkMapAgainstBuild(
  buildRaw: string,
  input: MapCheckInput,
): Promise<MapCheckResult> {
  const threat = mapThreat(input);
  const est = await estimateBuild(buildRaw);

  const resists = {
    fire: est.defenses.fireRes,
    cold: est.defenses.coldRes,
    lightning: est.defenses.lightningRes,
    chaos: est.defenses.chaosRes,
  };

  const maxResMods = threat.playerDebuffs.filter((d) => d.effect === 'max_res');
  const maxResPenalty = maxResMods.reduce((a, d) => Math.max(a, d.value ?? 0), 0);

  const reasons: string[] = [];
  let worstLossPct: number | undefined;
  let worstLayer: MapCheckResult['worstLayer'];
  let verdict: MapVerdict = 'fine';

  if (maxResPenalty > 0) {
    const capAfter = BASE_RES_CAP - maxResPenalty;
    reasons.push(`−${maxResPenalty}% к капу всех максимальных резистов (кап 75 → ${capAfter}).`);
    const layers = ['fire', 'cold', 'lightning', 'chaos'] as const;
    for (const layer of layers) {
      const res = Math.max(-200, Math.min(resists[layer], BASE_RES_CAP)); // canon: floor −200
      if (res < capAfter) {
        // Штраф капа не режет текущий резист — этого слоя не касается.
        continue;
      }
      const damageMultOld = 1 - res / 100;
      const damageMultNew = 1 - capAfter / 100;
      // EHP ∝ 1/damageMult → loss = 1 − EHP_new/EHP_old = 1 − mOld/mNew.
      const lossPct = (1 - damageMultOld / damageMultNew) * 100;
      if (lossPct <= 0) continue;
      const layerEhp = est.ehp[layer]?.effectiveHp ?? 0;
      reasons.push(
        `${layer}: резист ${res}% → ${capAfter}% (кап), EHP слоя ${layerEhp} → −${lossPct.toFixed(1)}%.`,
      );
      if (worstLossPct === undefined || lossPct > worstLossPct) {
        worstLossPct = lossPct;
        worstLayer = layer;
      }
    }
  } else {
    reasons.push('Модов -max Resistance на карте нет — элем-EHP не проседает.');
  }

  // Жёсткие немоделируемые дебаффы — факторный слой: правило «не радуйся FINE
  // с включённым Stasis при реген-зависимой защите» (без угадывания билда —
  // просто позиционируем ухудшение на одну ступень).
  const harsh = threat.playerDebuffs.filter(
    (d) => d.effect === 'recovery' || d.effect === 'regen_block' || d.effect === 'defence_reduction' || d.effect === 'slow',
  );
  const harshEffects: string[] = [];
  for (const d of harsh) {
    const label = HARSH_RU[d.effect] ?? d.effect;
    harshEffects.push(label);
    reasons.push(label);
  }

  if (worstLossPct != null && worstLossPct >= DANGER_LOSS_PCT) verdict = 'danger';
  else if ((worstLossPct ?? 0) >= CAREFUL_LOSS_PCT || harshEffects.length > 0) verdict = 'careful';
  // №696 P2-4: третья эскалация удалена — недостижима (ветка выше уже 'danger').

  if (verdict === 'danger') {
    reasons.push(`Вердикт DANGER: худший слой теряет ≥${DANGER_LOSS_PCT}% EHP — карту лучше скрафтить заново/перекатить.`);
  } else if (verdict === 'careful') {
    reasons.push(`Вердикт CAREFUL: играбельно, но на грани — см. строки выше.`);
  } else {
    reasons.push('Вердикт FINE: билд держит эти моды.');
  }

  return {
    verdict,
    ...(worstLossPct != null
      ? { worstEhpLossPct: Math.round(worstLossPct * 10) / 10, worstLayer: worstLayer! }
      : {}),
    resists,
    ...(maxResPenalty ? { maxResPenaltyPct: maxResPenalty } : {}),
    harshEffects,
    reasons,
    ...(threat.elements ? { elements: threat.elements as Record<string, number> } : {}),
    matchedMods: threat.matchedMods.map((m) => m.name ?? m.mod),
    unknownMods: threat.unknownMods,
  };
}

const HARSH_RU: Record<string, string> = {
  recovery: '−восстановление (Smothering): регены/фляги слабее — полагающимся на реген быть осторожнее.',
  regen_block: 'РЕГЕН БЛОКИРОВАН (Stasis): без фляг/лийк-защиты — жёсткий мод.',
  defence_reduction: '−защита брони (Rust/Miring): EHP ниже, чем показывает панель.',
  slow: 'ЗАМЕДЛЕНИЕ (Carnage/Impedance): уклоняться сложнее.',
};
