/** Единая точка входа ядра PoE2 Kit. */

export * from './types.js';
export * from './trade.js';
export * from './build.js';
export * from './leveling.js';
export * from './repoe.js';
export * from './ai.js';
export * from './parse.js';
export * from './http.js';
export * from './log.js';
export * from './wiki.js';
export * from './estimate.js';
export * from './tradeQuery.js';
export * from './dataset.js';
export * from './statdesc.js';
export * from './tradeSnapshot.js';
export * from './oauth.js';
export * from './uniques.js';
export * from './learnlog.js';
export * from './learnedStats.js';
export * from './poe2db.js';
export * from './zoneNotes.js';
export * from './bosses.js';
export * from './sources.js';
export * from './ladder.js';
export * from './advice.js';
export * from './runes.js';
export * from './starterBuilds.js';
export * from './ssf.js';
export * from './endgame.js';
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

export const core = {
  trade,
  build,
  leveling,
  repoe,
  ai,
  parse,
  http,
  log: logmod,
  wiki: wikimod,
  estimate: estmod,
  tradeQuery: tqmod,
  dataset: dsmod,
  statdesc: statdescmod,
  tradeSnapshot: tradeSnapshotMod,
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
  runes: runesMod,
  starterBuilds: starterBuildsMod,
  endgame: endgameMod,
  questRewards: questRewardsMod,
};

export default core;