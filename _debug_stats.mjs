import { core } from './packages/core/dist/index.js';

const mods = [
  '+3.8% to Critical Hit Chance',
  '23% increased Attack Speed',
  '155% increased Physical Damage',
  '+4 to Level of all Melee Skills',
  '100% increased Elemental Damage with Attacks',
  'Gain 15% of Damage as Extra Physical Damage',
];

const { filters, unmatched } = await core.trade.matchModsToStatFilters(mods);
console.log('FILTERS:', JSON.stringify(filters, null, 2));
console.log('UNMATCHED:', unmatched);

if (filters.length) {
  // не-search напрямую
  const listings = await core.trade.searchTradeByStats(
    { type: 'Sinister Quarterstaff', filters },
    { league: 'Forbidden Rites', limit: 10 },
  );
  console.log('LISTINGS:', JSON.stringify(listings));
}
