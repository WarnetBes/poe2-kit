import { core } from './packages/core/dist/index.js';

core.trade.setLeague('Forbidden Rites');
const filters = (await core.trade.matchModsToStatFilters([
  '+3.8% to Critical Hit Chance', '23% increased Attack Speed',
  '155% increased Physical Damage', '+4 to Level of all Melee Skills',
  '100% increased Elemental Damage with Attacks', 'Gain 15% of Damage as Extra Physical Damage',
])).filters;
const listings = await core.trade.searchTradeByStats(
  { type: 'Sinister Quarterstaff', filters,
    group: { type: 'count', value: 4 } },
  { league: 'Forbidden Rites', limit: 10 },
);
console.log('LISTINGS:', JSON.stringify(listings, null, 2));

const rates = await core.trade.fetchBestCurrencyRates('Forbidden rites');
console.log('RATES (первые 12):');
for (const r of rates.slice(0, 12)) console.log(' ', r.name, '| chaos:', r.chaosValue, '| div:', r.divineValue, '| src:', r.source);
