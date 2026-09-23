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
export * from './poe2db.js';
export * from './zoneNotes.js';

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
import * as p2dbmod from './poe2db.js';
import * as znmod from './zoneNotes.js';

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
  poe2db: p2dbmod,
  zoneNotes: znmod,
};

export default core;