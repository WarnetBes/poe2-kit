// Прайс-чек mobalytics/Build Planner .build JSON (цели аффиксов) по всем слотам.
// Уникалы — по имени (poe2scout), рары — синтез клир-текста из additional_text + trade2.
import fs from 'node:fs';
import { core } from './packages/core/dist/index.js';

const input = fs.readFileSync(
  'C:/Users/mezhavikiserj/Downloads/Staff Version (Best) - [0.5] Ultimate IC.build',
  'utf8',
);
const json = JSON.parse(input);
console.log('Билд:', json.name, '| ascendancy:', json.ascendancy);

const active = await core.trade.currentDefaultLeague();
core.trade.setLeague(active);
console.log('Лига:', active);

/** Синтез клир-текста рара из additional_text. */
function rareText(additional) {
  const lines = additional.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const base = lines[0];
  const mods = lines.slice(1).map((l) => l.replace(/^\d+\.\s*/, ''));
  return ['Rarity: Rare', base, base, '--------', ...mods].join('\n');
}

const jobs = [];
for (const it of json.inventory_slots ?? []) {
  const slot = it.inventory_id ?? '?';
  if (it.unique_name) {
    jobs.push({
      slot,
      title: it.unique_name,
      text: ['Rarity: Unique', it.unique_name, it.name ?? 'Unknown', '--------'].join('\n'),
    });
  } else if (it.additional_text) {
    const text = rareText(it.additional_text);
    if (text) jobs.push({ slot, title: it.additional_text.split('\n')[0], text });
  }
}

console.log(`Слотов к оценке: ${jobs.length}\n`);

// Раунды: пустые и безоценочные слоты добираем повторами (trade2 лимитирует жёстко,
// успешные результаты уходят в дисковый кэш ядра и больше не запрашиваются).
const ROUNDS = 5;
const ROUND_PAUSE_MS = 150_000;
let rows = new Array(jobs.length).fill(null);
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n=== Раунд ${round} ===`);
  for (let i = 0; i < jobs.length; i++) {
    if (rows[i]?.median != null) continue;
    const job = jobs[i];
    try {
      const res = await core.trade.priceCheck(job.text, { league: active });
      rows[i] = {
        slot: job.slot,
        name: res.itemName,
        median: res.estimate?.median,
        min: res.estimate?.min,
        max: res.estimate?.max,
        confidence: res.estimate?.confidence,
        listings: res.listings?.length ?? 0,
        sources: res.sources?.join('+') ?? '',
        currencies: (res.listings ?? []).map((l) => `${l.price}${l.currency?.[0] ?? '?'}`).join(','),
        error: null,
      };
    } catch (e) {
      rows[i] = {
        slot: job.slot, name: job.title, median: null, min: null, max: null,
        confidence: null, listings: 0, sources: '', currencies: '', error: e.message,
      };
    }
    const r = rows[i];
    const price = r.median != null ? `${r.median.toFixed(2)}c` : '—';
    console.log(
      `  [${r.slot}] ${r.name}: ${price} (listings=${r.listings})`,
    );
  }
  const left = rows.filter((r) => !r || r.median == null).length;
  console.log(`Осталось без оценки: ${left}`);
  if (!left || round === ROUNDS) break;
  console.log(`Пауза ${ROUND_PAUSE_MS / 1000} с перед следующим раундом...`);
  await new Promise((r2) => setTimeout(r2, ROUND_PAUSE_MS));
}
rows = rows.map((r, i) => r ?? {
  slot: jobs[i].slot, name: jobs[i].title, median: null, min: null, max: null,
  confidence: null, listings: 0, sources: '', currencies: '', error: 'no data',
});

let total = 0;
for (const r of rows) {
  const price = r.median != null ? `${r.median.toFixed(0)} chaos (${r.min.toFixed(0)}–${r.max.toFixed(0)}c)` : '—';
  if (r.median != null) total += r.median;
  console.log(
    `[${r.slot}] ${r.name} | ${price} | conf=${r.confidence ?? '—'} | listings=${r.listings} | src=${r.sources}${r.currencies ? ' | cur=[' + r.currencies + ']' : ''}${r.error ? ' | ERR: ' + r.error : ''}`,
  );
}
console.log(`\nИтого (сумма медиан, chaos): ${total.toFixed(0)} chaos ≈ ${(total / 8).toFixed(1)} divine`);
