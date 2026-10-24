/**
 * Build Composer — синтез скелета билда под параметры пользователя (№497).
 *
 * Паттерн adapted from poe2-build-mcp (MIT © 2026 MaxWilk): LLM/движок
 * собирает только СКЕЛЕТ (класс → оружие → main-skill → саппорты → бюджетная
 * стадия → числовые цели), а все числа проверяются каноническими модулями
 * ядра (estimate/optimize/enemy/resources/ladder). Ничего не выдумано:
 * где данных нет — поле null + строка в unverified[] (паттерн buildTargets.ts).
 *
 * Дисциплина (как starterBuilds.ts:149/:176): неизвестный класс → null,
 * а не заглушка. Сеть ядром не используется: ладдер-строки передаются
 * снаружи (request.ladderRows) — их качает оверлей/тест-фикстура.
 *
 * Цепочка выбора main-skill (первое непустое звено):
 *  1. skillHint (явный EN-скилл пользователя);
 *  2. userBuildCode → buildGemSetups (первый socket-активный камень);
 *  3. ladderRows → popularSkills топ-1 (sharePercent = доля строк класса);
 *  4. curated-гайд (starterBuildGuides: main_skill.en);
 *  5. gemRanges стартового билда (последний непустой диапазон, первый камень);
 *  все пусто → mainSkill null + unverified.
 */

import { buildGemSetups } from './build.js';
import { estimateBuild, DEFENSE_CONSTANTS } from './estimate.js';
import { evaluateBuildAgainstGoals, OPTIMIZE_CONSTANTS } from './optimize.js';
import type { GoalCheck, BuildGoals } from './optimize.js';
import { monsterStats, ENEMY_CONSTANTS } from './enemy.js';
import { maxLife } from './resources.js';
import { popularSkills, parseNinjaNumber, filterRowsBySkill } from './ladder.js';
import type { LadderRow } from './ladder.js';
import { makeStarterBuild, ascendancyKeystones, CLASS_WEAPON } from './starterBuilds.js';
import { supportsForActive } from './gemSupports.js';
import type { GemSupportRecoLite } from './gemSupports.js';
import type { StarterBuild, StarterSlot } from './starterBuilds.js';
import {
  starterBuildGuidesByClass,
  starterBuildGuidesByAscendancy,
} from './starterBuildGuides.js';
import type { StarterBuildGuide, StarterBuildStage } from './starterBuildGuides.js';
import { getAscendanciesByClass } from './dataset.js';

/** Бюджет пользователя → стадия curated-гайда. */
export type ComposeBudget = 'ssf' | 'budget' | 'mid' | 'rich';

export interface ComposeRequest {
  /** Базовый класс ИЛИ асценданси (EN, как(resolveLevelingClass). */
  classQuery: string;
  /** Уровень персонажа/цели (default 90 — эндгейм-планка окна compose). */
  level?: number;
  /** Бюджет → стадия гайда (default 'ssf'). */
  budget?: ComposeBudget;
  /** Явная подсказка main-скилла (EN-имя). */
  skillHint?: string;
  /** PoB share-код/XML билда пользователя: main-skill + верификация целей. */
  userBuildCode?: string;
  /** Ладдер-строки poe.ninja (снаружи; core офлайн). */
  ladderRows?: LadderRow[];
  /** Уровень врага для EHP-цели (default 84 — pinnacle-планка optimize.ts). */
  enemyLevel?: number;
}

export interface ComposePopularSkill {
  name: string;
  count: number;
  /** Доля строк с этим скиллом, % (0, если строк нет). */
  sharePercent: number;
}

export interface ComposeResult {
  /** Резолвнутый базовый класс (EN). */
  className: string;
  /** Запрошенный classQuery как есть (может быть асценданси). */
  classQuery: string;
  /** Ключевые ноты асценданси, если запрос по асценданси; null — не резолвнут/не просили. */
  ascendancyKeystones: string[] | null;
  level: number;
  /** Main-скилл скелета; null — не выведен (см. unverified). */
  mainSkill: string | null;
  /** Откуда mainSkill: 'hint' | 'user' | 'ladder' | 'guide' | 'starter'. */
  mainSkillSource: 'hint' | 'user' | 'ladder' | 'guide' | 'starter' | null;
  /** Доля ладдер-строк с main-скиллом, %; null — ладдера нет/скилл не из ладдера. */
  skillSharePercent: number | null;
  /** Саппорты к main-скиллу (движок gemSupports); пусто — рекомендаций нет. */
  supports: GemSupportRecoLite[];
  /** Оружие класса (CLASS_WEAPON, из starterBuilds); null — маппинга нет. */
  weapon: { weapon: string | null; offhand: string | null };
  /** Шопинг-лист слотов (makeStarterBuild, white-base предметных типов). */
  slots: StarterSlot[];
  /** Бюджетная стадия curated-гайда. */
  budgetStage: keyof Pick<StarterBuildGuide['stages'], 'starter' | 'mid' | 'main' | 'max'> | null;
  /** Публичная цена стадии (строкой, как в гайде); null — не опубликована. */
  budgetCost: string | null;
  /** Числовые цели — только из таблиц канона. */
  capTargets: {
    /** Кап элем-резистов, % (DEFENSE_CONSTANTS.RESISTANCE_CAP). */
    resistCap: number;
    /** Базовый пул жизни уровня (resources.maxLife, canon). */
    baseLifePool: number;
    /** EHP-цель: удар врага таблицы × MONSTER_DAMAGE_FACTOR × PINNACLE_EHP_HITS. */
    ehpGoal: number;
    /** DPS-цель: медиана 'dps.total' ладдера; null — ладдера нет. */
    dpsGoal: number | null;
  };
  /** Вердикты целей PoB-движка по userBuildCode; null — кода не было. */
  goalChecks: GoalCheck[] | null;
  /** Частые скиллы ладдера с долями (контекст «что играют»). */
  popularSkills: ComposePopularSkill[];
  /** Что НЕ выведено из данных и почему (честные хвосты, паттерн buildTargets). */
  unverified: string[];
}

const BUDGET_STAGE: Record<ComposeBudget, 'starter' | 'mid' | 'main' | 'max'> = {
  ssf: 'starter',
  budget: 'mid',
  mid: 'main',
  rich: 'max',
};

function rowsSkills(rows: LadderRow[]): string[][] {
  return rows
    .map((r) => (Array.isArray(r.skills) ? (r.skills as unknown[]).filter((s): s is string => typeof s === 'string') : []))
    .filter((s) => s.length > 0);
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Синтезировать скелет билда. null — класс не резолвится (дисциплина
 * starterBuilds: не выдумываем билд для неизвестного класса).
 */
export async function composeBuild(request: ComposeRequest): Promise<ComposeResult | null> {
  const classQuery = String(request.classQuery ?? '').trim();
  if (!classQuery) return null;
  // Дисциплина starterBuilds.ts:149/:176: unknown класс → null (не заглушка).
  const starter: StarterBuild | null = makeStarterBuild(classQuery);
  if (!starter) return null;

  const level = Math.max(1, Math.min(100, Math.round(request.level ?? 90)));
  const budget: ComposeBudget = request.budget ?? 'ssf';
  const rows = request.ladderRows ?? [];
  const unverified: string[] = [];

  // ─── main-skill: цепочка hint → user → ladder → guide → starter-gems ──────
  let mainSkill: string | null = null;
  let mainSkillSource: ComposeResult['mainSkillSource'] = null;

  const hint = String(request.skillHint ?? '').trim();
  if (hint) {
    mainSkill = hint;
    mainSkillSource = 'hint';
  }

  if (!mainSkill && request.userBuildCode) {
    try {
      // Первый socket-активный камень билда пользователя (passive-группы мимо).
      const setups = await buildGemSetups(request.userBuildCode);
      const first = setups.find((s) => s.source === 'socket') ?? setups[0];
      if (first?.active) {
        mainSkill = first.active;
        mainSkillSource = 'user';
      }
    } catch {
      unverified.push('userBuildCode не разобран (buildGemSetups) — источник main-скилла пропущен');
    }
  }

  if (!mainSkill && rows.length) {
    const top = popularSkills(rows, 1)[0];
    if (top) {
      mainSkill = top.name;
      mainSkillSource = 'ladder';
    }
  }

  // Curated-гайды по классу/асценданси (двойной шанс: asc-запрос богаче).
  const guides: StarterBuildGuide[] = [
    ...starterBuildGuidesByAscendancy(classQuery),
    ...starterBuildGuidesByClass(starter.className).filter(
      (g) => !starterBuildGuidesByAscendancy(classQuery).includes(g),
    ),
  ];
  if (!mainSkill && guides.length) {
    const ms = guides[0]!.main_skill.en ?? guides[0]!.main_skill.ru;
    if (ms) {
      mainSkill = ms;
      mainSkillSource = 'guide';
    }
  }

  if (!mainSkill) {
    // Последний непустой диапазон стартового билда, первый камень.
    const lastGems = [...starter.gemRanges].reverse().find((r) => r.gems.length > 0);
    const g0 = lastGems?.gems[0];
    if (g0) {
      mainSkill = g0;
      mainSkillSource = 'starter';
    } else {
      unverified.push('main-скилл не выведен: нет hint/user-билда/ладдера/гайда/камней гайда');
    }
  }

  // ─── доля скилла в ладдере + частые скиллы (контекст) ─────────────────────
  const skillsPerRow = rowsSkills(rows);
  const nRowsWithSkills = skillsPerRow.length;
  let skillSharePercent: number | null = null;
  if (mainSkill && rows.length && filterRowsBySkill(rows, mainSkill).length > 0) {
    const hits = filterRowsBySkill(rows, mainSkill).length;
    skillSharePercent = Math.round((hits / rows.length) * 1000) / 10;
  }
  const popular: ComposePopularSkill[] = popularSkills(rows, 8).map((s) => ({
    name: s.name,
    count: s.count,
    sharePercent: nRowsWithSkills > 0 ? Math.round((s.count / rows.length) * 1000) / 10 : 0,
  }));

  // ─── саппорты к main-скиллу (движок gemSupports, офлайн) ──────────────────
  const supports: GemSupportRecoLite[] = mainSkill ? supportsForActive(mainSkill) : [];
  if (mainSkill && !supports.length) {
    unverified.push(`саппорты для «${mainSkill}»: датасет рекомендаций пуст (нет meta/base записи)`);
  }

  // ─── бюджет → стадия curated-гайда ────────────────────────────────────────
  const stageKey = BUDGET_STAGE[budget];
  let budgetStage: ComposeResult['budgetStage'] = null;
  let budgetCost: string | null = null;
  if (guides.length) {
    budgetStage = stageKey;
    const stage: StarterBuildStage | undefined = guides[0]!.stages[stageKey];
    budgetCost = stage?.cost ?? null;
    if (budgetCost == null) {
      unverified.push(`стоимость стадии «${stageKey}» гайдом не опубликована (cost: null)`);
    }
  } else {
    unverified.push('бюджетная стадия: curated-гайда по классу нет — стадии не выводим');
  }

  // ─── числовые цели: только таблицы канона ────────────────────────────────
  const enemyLevel = Math.max(1, Math.min(100, Math.round(request.enemyLevel ?? 84)));
  const boss = monsterStats(enemyLevel);
  const ehpGoal = Math.round(boss.damage * ENEMY_CONSTANTS.MONSTER_DAMAGE_FACTOR * OPTIMIZE_CONSTANTS.PINNACLE_EHP_HITS);
  const dpsVals = rows
    .map((r) => parseNinjaNumber(r['dps.total']))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const dpsGoal = median(dpsVals);
  if (dpsGoal == null) {
    unverified.push('DPS-цель не задана: не выводится из таблиц врага, а ладдер-строк нет');
  }
  const capTargets: ComposeResult['capTargets'] = {
    resistCap: DEFENSE_CONSTANTS.RESISTANCE_CAP,
    baseLifePool: maxLife(level),
    ehpGoal,
    dpsGoal: dpsGoal == null ? null : Math.round(dpsGoal),
  };

  // ─── верификация: userBuildCode против целей (движок optimize, READ-ONLY) ─
  let goalChecks: GoalCheck[] | null = null;
  if (request.userBuildCode) {
    try {
      const est = await estimateBuild(request.userBuildCode);
      const goals: BuildGoals = {
        ehp: ehpGoal,
        ...(dpsGoal != null ? { dps: Math.round(dpsGoal) } : {}),
        fireRes: DEFENSE_CONSTANTS.RESISTANCE_CAP,
        coldRes: DEFENSE_CONSTANTS.RESISTANCE_CAP,
        lightningRes: DEFENSE_CONSTANTS.RESISTANCE_CAP,
      };
      goalChecks = evaluateBuildAgainstGoals(est, goals);
    } catch {
      unverified.push('верификация целей: estimateBuild по userBuildCode не удался — вердиктов нет');
    }
  } else {
    unverified.push('верификация целей: User-build не приложен — вердиктов движка нет (добавь PoB-код билда)');
  }

  // Если запрос был асценданси — резолвим его ключевые ноты через датасет
  // (id из ascendancies.json → ascendancyKeystones, starterBuilds.ts:135).
  let ascKeys: string[] | null = null;
  if (starter.className.toLowerCase() !== classQuery.toLowerCase()) {
    const asc = getAscendanciesByClass(starter.className).find(
      (a) => a.displayName.toLowerCase() === classQuery.toLowerCase(),
    );
    if (asc) ascKeys = ascendancyKeystones(asc.id).slice(0, 6);
  }

  // Оружие класса: CLASS_WEAPON для базового класса стартового билда.
  const weapon = CLASS_WEAPON[starter.className] ?? null;
  const weaponInfo: ComposeResult['weapon'] = {
    weapon: weapon?.weapon ?? null,
    offhand: weapon?.offhand ?? null,
  };
  if (!weapon) unverified.push('оружие класса: CLASS_WEAPON-маппинга нет — слот оружия не заполнен');

  return {
    className: starter.className,
    classQuery,
    ascendancyKeystones: ascKeys,
    level,
    mainSkill,
    mainSkillSource,
    skillSharePercent,
    supports,
    weapon: weaponInfo,
    slots: starter.slots,
    budgetStage,
    budgetCost,
    capTargets,
    goalChecks,
    popularSkills: popular,
    unverified,
  };
}
