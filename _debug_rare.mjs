import { core } from './packages/core/dist/index.js';

const weaponText = [
  'Rarity: Rare',
  'Sinister Quarterstaff',
  'Sinister Quarterstaff',
  '--------',
  '+3.8% to Critical Hit Chance',
  '23% increased Attack Speed',
  '155% increased Physical Damage',
  '+4 to Level of all Melee Skills',
  '100% increased Elemental Damage with Attacks',
  'Gain 15% of Damage as Extra Physical Damage',
].join('\n');

const parsed = core.parse.parseItemText(weaponText);
console.log('PARSED:', JSON.stringify(parsed, null, 2).slice(0, 2000));

core.trade.setLeague(await core.trade.currentDefaultLeague());
try {
  const res = await core.trade.priceCheck(weaponText);
  console.log('RESULT:', JSON.stringify(res, (k, v) => (k === 'listings' ? `[${v.length}]` : v), 2).slice(0, 3000));
} catch (e) {
  console.log('THROW:', e.message);
}
