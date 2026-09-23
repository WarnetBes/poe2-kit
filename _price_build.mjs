import fs from 'node:fs';
import { core } from './packages/core/dist/index.js';

const input = fs.readFileSync(
  'C:/Users/mezhavikiserj/Downloads/Staff Version (Best) - [0.5] Ultimate IC.build',
  'utf8',
);

const active = await core.trade.currentDefaultLeague();
console.log('Лига (текущая активная):', active);
core.trade.setLeague(active);
console.log('=== Прайс-чек всего снаряжения билда (живые цены) ===');
try {
  const report = await core.trade.priceBuild(input, { league: active });
  console.log('League:', report.league);
  console.log('Items processed:', report.totalItems);
  console.log('Priced:', report.pricedCount, 'of', report.totalItems);
  console.log('Total lower bound:', report.totalMin.toFixed(2));
  console.log('Elapsed:', report.elapsedMs, 'ms');
  for (const it of report.items) {
    const med = it.estimate?.median;
    const range = it.estimate
      ? `${it.estimate.min.toFixed(2)}-${it.estimate.max.toFixed(2)}`
      : '—';
    console.log(
      `  [${it.slot}] ${it.name || '—'} | rarity=${it.rarity} | median=${med != null ? med.toFixed(2) : '—'} | range=${range} | listings=${it.listingsCount}`,
    );
  }
} catch (e) {
  console.error('priceBuild ОШИБКА:', e.message);
}

console.log('\n=== Справка: Headhunter напрямую ===');
try {
  const res = await core.trade.priceCheck(
    ['Rarity: Unique', 'Headhunter', 'Fine Belt', '--------'].join('\n'),
  );
  console.log('name:', res.itemName, '| rarity:', res.rarity);
  console.log('estimate:', JSON.stringify(res.estimate));
  console.log('sources:', res.sources);
} catch (e) {
  console.error('priceCheck ОШИБКА:', e.message);
}