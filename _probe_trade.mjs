const TRADE = 'https://www.pathofexile.com/api/trade2';
const LEAGUE = 'Forbidden Rites';

async function probe(label, body) {
  const r = await fetch(`${TRADE}/search/poe2/${LEAGUE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'poe2-kit/0.1 (dev)' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(label, '->', r.status, JSON.stringify({ id: j.id, total: j.total, error: j.error, resultLen: j.result?.length }));
  return j;
}

// 1) только тип
await probe('type-only', {
  query: { status: { option: 'online' }, type: { option: 'Sinister Quarterstaff' }, stats: [] },
  sort: { price: 'asc' },
});

// 2) тип + 1 стат (+3.8% crit → min 3)
await probe('type+crit', {
  query: {
    status: { option: 'online' },
    type: { option: 'Sinister Quarterstaff' },
    stats: [{ type: 'and', filters: [{ disabled: false, id: 'explicit.stat_518292764', value: { min: 3 } }] }],
  },
  sort: { price: 'asc' },
});

// 3) все 6 статов
await probe('all-6', {
  query: {
    status: { option: 'online' },
    type: { option: 'Sinister Quarterstaff' },
    stats: [{ type: 'and', filters: [
      { disabled: false, id: 'explicit.stat_518292764', value: { min: 3.4 } },
      { disabled: false, id: 'explicit.stat_681332047', value: { min: 20.7 } },
      { disabled: false, id: 'explicit.stat_1509134228', value: { min: 139.5 } },
      { disabled: false, id: 'explicit.stat_9187492', value: { min: 3.6 } },
      { disabled: false, id: 'explicit.stat_387439868', value: { min: 90 } },
      { disabled: false, id: 'explicit.stat_4019237939', value: { min: 13.5 } },
    ] }],
  },
  sort: { price: 'asc' },
});
