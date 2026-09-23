const TRADE = 'https://www.pathofexile.com/api/trade2';
const LEAGUE = 'Forbidden Rites';

async function raw(label, body) {
  const r = await fetch(`${TRADE}/search/poe2/${LEAGUE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'poe2-kit/0.1 (dev)' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(label, 'search', r.status, 'total=', j.total);
  if (!j.result?.length) return;
  const hashes = j.result.slice(0, 10).join(',');
  const f = await fetch(`${TRADE}/fetch/${hashes}?query=${j.id}`, {
    headers: { 'User-Agent': 'poe2-kit/0.1 (dev)' },
  });
  const fj = await f.json();
  for (const e of fj.result ?? []) {
    console.log('  price:', JSON.stringify(e.listing?.price), '|', e.item?.typeLine?.slice(0, 40));
  }
}

// шлем: только тип (как фолбэк priceCheck)
await raw('Helm Ancestral Tiara type-only', {
  query: { status: { option: 'online' }, type: { option: 'Ancestral Tiara' }, stats: [] },
  sort: { price: 'asc' },
});
