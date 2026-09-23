import { core } from './packages/core/dist/index.js';

const helm = [
  'Rarity: Rare', 'Build Target Item', 'Ancestral Tiara', '--------',
  '+33 to maximum Mana', '+31% to Fire Resistance', '+26 to maximum Energy Shield',
  '78% increased Energy Shield', '15% increased Energy Shield Recharge Rate',
].join('\n');

core.trade.setLeague('Forbidden Rites');

const { filters, unmatched } = await core.trade.matchModsToStatFilters(
  helm.split('\n').slice(4),
);
console.log('FILTERS:', filters.map((f) => `${f.id} min=${f.min?.toFixed(0)} <- ${f.text}`).join('\n'));
console.log('UNMATCHED:', unmatched);

const res = await core.trade.searchTradeByStats(
  { type: 'Ancestral Tiara', filters },
  { league: 'Forbidden Rites', limit: 10 },
);
console.log('listings:', JSON.stringify(res, null, 2));

const rates = await core.trade.fetchBestCurrencyRates('Forbidden Rites');
const rateMap = new Map();
for (const r of rates) {
  rateMap.set(r.name.toLowerCase(), r.chaosValue);
  rateMap.set(r.name.toLowerCase().replace(/\s*orb$/, ''), r.chaosValue);
}
console.log('divine rate:', rateMap.get('divine'), '| exalted:', rateMap.get('exalted'), '| chaos:', rateMap.get('chaos'));
