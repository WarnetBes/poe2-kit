// №112 — смок core-модуля endgame.ts (только данные, без overlay).
// Запуск: node smoke_n112core.mjs
const mod = await import('../../packages/core/dist/index.js');

let fails = 0;
function check(cond, label) {
  if (cond) console.log('OK  ' + label);
  else { fails++; console.log('FAIL ' + label); }
}

// 1. 9 механик на месте
check(Array.isArray(mod.ENDGAME_MECHANICS) && mod.ENDGAME_MECHANICS.length === 9,
  'ENDGAME_MECHANICS.length === 9 (факт: ' + (mod.ENDGAME_MECHANICS || []).length + ')');

// 2. Регионы атласа 0.5
const expectRegions = {
  expedition: 'SE', breach: 'S', ritual: 'W', delirium: 'W', abyss: 'E',
  incursion: 'N', 'precursor-fortress': 'center',
};
for (const [id, region] of Object.entries(expectRegions)) {
  const m = mod.ENDGAME_MECHANICS.find((x) => x.id === id);
  check(!!m && m.region === region, `регион ${id} = ${region}`);
}
const west = mod.mechanicByRegion('W').map((m) => m.id);
check(west.includes('ritual') && west.includes('delirium'), "mechanicByRegion('W') → ritual+delirium");
check(mod.mechanicByRegion('N').length === 1, "mechanicByRegion('N') → только incursion");
check(mod.mechanicById('expedition').bosses.includes('Olroth'), 'mechanicById(expedition).bosses has Olroth');
check(mod.mechanicById('no-such-id') === null, 'mechanicById(unknown) → null');

// 3. Sekhemas-этажность
check(mod.sekhemasFloorsForLevel(30) === 1, 'sekhemasFloorsForLevel(30) === 1');
check(mod.sekhemasFloorsForLevel(50) === 2, 'sekhemasFloorsForLevel(50) === 2');
check(mod.sekhemasFloorsForLevel(65) === 3, 'sekhemasFloorsForLevel(65) === 3');
check(mod.sekhemasFloorsForLevel(80) === 4, 'sekhemasFloorsForLevel(80) === 4');
check(mod.sekhemasFloorsForLevel(75) === 4 && mod.sekhemasFloorsForLevel(44) === 1
  && mod.sekhemasFloorsForLevel(45) === 2 && mod.sekhemasFloorsForLevel(60) === 3,
  'границы Sekhemas (44/45/60/75)');

// 4. Overview: 9 механик + citadel, есть RU-подсказки
const rows = mod.mechanicsOverview();
check(rows.length === 10, 'mechanicsOverview().length === 10 (9 механик + citadel)');
check(rows.every((r) => typeof r.short_ru === 'string' && r.short_ru.length > 0), 'у всех строк overview есть short_ru');
const cit = rows.find((r) => r.id === 'citadel');
check(!!cit && cit.bosses.includes('The Arbiter of Ash'), 'overview содержит citadel → Arbiter of Ash');

// 5. Waystone-подсказки: все verified — пороги тиров верифицированы poe2db (02.10.2026)
const tips = mod.waystoneTips();
check(tips.length >= 3, 'waystoneTips() >= 3');
check(tips.every((t) => t.verified === true), 'все waystoneTips verified (T1=65 … T16=80, poe2db/us/Waystones)');
check(Array.isArray(mod.WAYSTONE_TIERS) && mod.WAYSTONE_TIERS.length === 16
  && mod.WAYSTONE_TIERS[0].areaLevel === 65 && mod.WAYSTONE_TIERS[15].areaLevel === 80,
  'WAYSTONE_TIERS: 16 тиров, T1=65, T16=80');
check(mod.waystoneAreaLevel(1) === 65 && mod.waystoneAreaLevel(16) === 80
  && mod.waystoneAreaLevel(17) === null && mod.waystoneAreaLevel(0) === null,
  'waystoneAreaLevel: границы 1..16 → 65..80, вне диапазона null');

// 6. Экспорт зарегистрирован в dist/index.js
const idxSrc = await import('node:fs').then((fs) => fs.readFileSync(
  'packages/core/dist/index.js', 'utf8'));
check(idxSrc.includes('endgame'), "dist/index.js содержит экспорт 'endgame'");

console.log(fails === 0 ? 'ALL OK' : `FAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
