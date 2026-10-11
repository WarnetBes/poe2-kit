/** Единая точка входа ядра PoE2 Kit. */

export * from './types.js';
export * from './trade.js';
export * from './priceAnalysis.js';
export * from './build.js';
export * from './leveling.js';
export * from './repoe.js';
export * from './ai.js';
export * from './parse.js';
export * from './modTiers.js';
export * from './metaLadder.js';
export * from './livefilter/conditions.js';
export * from './livefilter/rules.js';
export * from './livefilter/selfcheck.js';
export * from './livefilter/injector.js';
export * from './livefilter/pipeline.js';
export * from './livefilter/snapshot.js';
export * from './invokerGuide.js';
export * from './regexOptimizer.js';
export * from './runsTracker.js';
export * from './http.js';
// rate-limit v2 (порт poe-ninja-build-cost, P1): избирательные экспорты с
// алиасами — имя RateLimiter в публичном API ядра уже занято статическим
// лимитером http.ts (та же коллизия, что GemSupportReco/GemSupportRecoLite №262).
export {
  RateLimiter as TradeRateLimiter,
  Bucket as RateBucket,
  createTradeRateState,
  setBudgetShare,
  getUserReserve,
  parsePolicy,
  BUDGET_SHARES,
  DEFAULT_BUDGET_SHARE,
  DESYNC_PAD,
} from './rateLimit.js';
export type { BucketState, BudgetShareId, ParsedPolicy, TradeRateState } from './rateLimit.js';
export * from './result.js';
export * from './log.js';
export * from './wiki.js';
export * from './estimate.js';
export * from './tradeQuery.js';
export * from './dataset.js';
export * from './statdesc.js';
export * from './tradeSnapshot.js';
export * from './statMatching.js';
export * from './oauth.js';
export * from './uniques.js';
export * from './learnlog.js';
export * from './learnedStats.js';

export * from './i18nAliases.js';
export * from './poe2db.js';
export * from './zoneNotes.js';
export * from './bosses.js';
export * from './sources.js';
export * from './freshness.js';
export * from './patches.js';
export * from './radar.js';
export * from './datasetDiff.js';
export * from './ladder.js';
export * from './advice.js';
export * from './runes.js';
export * from './starterBuilds.js';
export * from './ssf.js';
export * from './craftGuide.js';
export * from './endgame.js';
export * from './buildPlanner.js';
export * from './hideout.js';
export * from './keybinds.js';
export * from './slang.js';
export * from './gemSupports.js';
export * from './mapPrep.js';
export * from './simulacrum.js';
import * as buildPlannerMod from './buildPlanner.js';
import * as hideoutMod from './hideout.js';
import * as keybindsMod from './keybinds.js';
import * as gemSupportsMod from './gemSupports.js';
import * as simulacrumMod from './simulacrum.js';
import * as mapPrepMod from './mapPrep.js';
export * from './questRewards.js';
export * from './cache.js';
export * from './gameConfig.js';
// ehp.ts — расширенный standalone-порт hivemind-калькуляторов; не star-export,
// чтобы не конфликтовать с evaluate-слоем estimate.ts (там свои calculateEhp и
// calculateAllEhp от гира). Доступен как core.ehp.
import * as ehpmod from './ehp.js';
import * as spiritmod from './spirit.js';
import * as stunmod from './stun.js';
import * as resmod from './resources.js';
import * as enemymod from './enemy.js';
import * as ailmentsmod from './ailments.js';
import * as optimizemod from './optimize.js';
import * as sourcesmod from './sources.js';
import * as freshnessmod from './freshness.js';
import * as patchesmod from './patches.js';
import * as datasetDiffMod from './datasetDiff.js';

// Типы калькуляторов (значения — через namespace core.ehp/core.spirit/core.stun,
// чтобы не конфликтовать с estimate-слоем).
export type {
  DefensiveStats, DamageType, ThreatProfile as CalcThreatProfile,
} from './ehp.js';
export type { BossMode, MonsterStats, EnemyPlaceholders } from './enemy.js';
export type { DotsAilment, BuildupType, AilmentChanceType } from './ailments.js';
export type {
  SpiritSourceType, SpiritReservationType, SpiritSupportGem, SpiritReservation, SpiritOptimization,
} from './spirit.js';
export type { StunDamageType, StunAttackType, StunModifiers } from './stun.js';
export type { BuildGoals, GoalCheck, GoalVerdict, NumberKind, RankLever, PinnacleCheck } from './optimize.js';

import * as trade from './trade.js';
import * as build from './build.js';
import * as leveling from './leveling.js';
import * as repoe from './repoe.js';
import * as ai from './ai.js';
import * as parse from './parse.js';
import * as http from './http.js';
import * as logmod from './log.js';
import * as wikimod from './wiki.js';
import * as estmod from './estimate.js';
import * as tqmod from './tradeQuery.js';
import * as dsmod from './dataset.js';
import * as statdescmod from './statdesc.js';
import * as tradeSnapshotMod from './tradeSnapshot.js';
import * as statMatchingMod from './statMatching.js';
import * as oauthmod from './oauth.js';
import * as unqmod from './uniques.js';
import * as p2dbmod from './poe2db.js';
import * as znmod from './zoneNotes.js';
import * as bossesmod from './bosses.js';
import * as ladmod from './ladder.js';
import * as advicemod from './advice.js';
import * as ssfmod from './ssf.js';
import * as cachemod from './cache.js';
import * as gameConfigMod from './gameConfig.js';
import * as learnmod from './learnlog.js';
import * as learnedStatsMod from './learnedStats.js';
import * as runesMod from './runes.js';
import * as starterBuildsMod from './starterBuilds.js';
import * as endgameMod from './endgame.js';
import * as questRewardsMod from './questRewards.js';
import * as craftMod from './craftGuide.js';
import * as pobcodeMod from './pobcode.js';
import * as resultMod from './result.js';
import * as priceAnalysisMod from './priceAnalysis.js';
import * as modTiersMod from './modTiers.js';
import * as regexOptimizerMod from './regexOptimizer.js';
import * as runsTrackerMod from './runsTracker.js';
import * as metaLadderMod from './metaLadder.js';
import * as livefilterMod from './livefilter/conditions.js';
import * as livefilterRulesMod from './livefilter/rules.js';
import * as livefilterSelfcheckMod from './livefilter/selfcheck.js';
import * as livefilterInjectorMod from './livefilter/injector.js';
import * as livefilterPipelineMod from './livefilter/pipeline.js';
import * as livefilterSnapshotMod from './livefilter/snapshot.js';
import * as invokerGuideMod from './invokerGuide.js';

export const core = {
  trade,
  build,
  leveling,
  repoe,
  ai,
  parse,
  modTiers: modTiersMod,
  regexOptimizer: regexOptimizerMod,
  runsTracker: runsTrackerMod,
  metaLadder: metaLadderMod,
  livefilter: livefilterMod,
  livefilterRules: livefilterRulesMod,
  livefilterSelfcheck: livefilterSelfcheckMod,
  livefilterInjector: livefilterInjectorMod,
  livefilterPipeline: livefilterPipelineMod,
  livefilterSnapshot: livefilterSnapshotMod,
  invokerGuide: invokerGuideMod,
  http,
  log: logmod,
  wiki: wikimod,
  estimate: estmod,
  tradeQuery: tqmod,
  dataset: dsmod,
  statdesc: statdescmod,
  tradeSnapshot: tradeSnapshotMod,
  statMatching: statMatchingMod,
  oauth: oauthmod,
  uniques: unqmod,
  poe2db: p2dbmod,
  zoneNotes: znmod,
  bosses: bossesmod,
  ladder: ladmod,
  advice: advicemod,
  ssf: ssfmod,
  cache: cachemod,
  gameConfig: gameConfigMod,
  learn: learnmod,
  learnedStats: learnedStatsMod,
  ehp: ehpmod,
  spirit: spiritmod,
  stun: stunmod,
  resources: resmod,
  enemy: enemymod,
  ailments: ailmentsmod,
  optimize: optimizemod,
  sources: sourcesmod,
  freshness: freshnessmod, // №245: kind/update-классификация + stale-логика датасетов
  patches: patchesmod, // №248: офлайн-реестр патчей → knownPatchAt для freshness
  datasetDiff: datasetDiffMod, // №248: снапшоты/diff-отчёт refresh (до/после)
  runes: runesMod,
  starterBuilds: starterBuildsMod,
  endgame: endgameMod,
  questRewards: questRewardsMod,
  craft: craftMod,
  pobcode: pobcodeMod, // №141: encodeShareCode для импорт-кода конструктора связок
  buildPlanner: buildPlannerMod, // экспорт *.build (официальный Build Planner PoE2)
  hideout: hideoutMod, // №198: офлайн-разбор .hideout (PoE2-вкладка «Хайдоуты»)
  gemSupports: gemSupportsMod, // №192/№262: движок рекомендаций саппортов
  keybinds: keybindsMod, // №221: советчик раскладки навыков (геймпад/клавиатура)
  mapPrep: mapPrepMod, // №234: Map Prep Assistant — угроза карты + чек-лист подготовки (Этап 2)
  simulacrum: simulacrumMod, // №239: данные гайда Simulacrum (Delirium 0.5.x) + markdown для MCP-тула
  result: resultMod, // №196 (S9): classifyError/kinds для kind-строк в оверлее
  priceAnalysis: priceAnalysisMod, // анализ трендов/волатильности валют (порт poe2scout-mcp, MIT)
};

export default core;