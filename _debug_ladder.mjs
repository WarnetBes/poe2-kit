import { core } from './packages/core/dist/index.js';

core.trade.setLeague('Forbidden Rites');

// 1) полная лестница priceCheck на шлеме
const helm = [
  'Rarity: Rare', 'Build Target Item', 'Ancestral Tiara', '--------',
  '+33 to maximum Mana', '+31% to Fire Resistance', '+26 to maximum Energy Shield',
  '78% increased Energy Shield', '15% increased Energy Shield Recharge Rate',
].join('\n');
const res = await core.trade.priceCheck(helm, { league: 'Forbidden Rites' });
console.log('HELM priceCheck:', JSON.stringify({
  estimate: res.estimate, listings: res.listings, sources: res.sources,
}, null, 2));

// 2) валюты листингов посоха (count-группа)
const { filters } = await core.trade.matchModsToStatFilters([
  '+3.8% to Critical Hit Chance', '23% increased Attack Speed',
  '155% increased Physical Damage', '+4 to Level of all Melee Skills',
  '100% increased Elemental Damage with Attacks', 'Gain 15% of Damage as Extra Physical Damage',
]);
const lst = await core.trade.searchTradeByStats(
  { type: 'Sinister Quarterstaff', filters, group: { type: 'count', value: 4 } },
  { league: 'Forbidden Rites', limit: 10 },
);
console.log('STAFF count-4 listings:', JSON.stringify(lst, null, 2));
