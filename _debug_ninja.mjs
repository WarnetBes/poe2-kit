import { core } from './packages/core/dist/index.js';

const ninja = await core.trade.fetchCurrencyRates('Forbidden Rites');
console.log('NINJA RATES (первые 15):');
for (const r of ninja.slice(0, 15)) console.log(' ', r.name, '| chaos:', r.chaosValue, '| div:', r.divineValue, '| src:', r.source);
const div = ninja.find((r) => /divine/i.test(r.name));
const exa = ninja.find((r) => /exalted/i.test(r.name));
console.log('Divine:', JSON.stringify(div));
console.log('Exalted:', JSON.stringify(exa));

// leagueConversion: базовая валюта лиги
try {
  const leagues = await core.trade.fetchLeagues();
  console.log('LEAGUES:', leagues.map((l) => `${l.id || l.name}`).slice(0, 8));
} catch (e) { console.log('leagues err', e.message); }
