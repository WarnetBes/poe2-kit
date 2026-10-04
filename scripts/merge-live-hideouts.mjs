// Слияние 12 живых .hideout (нативные экспорты PoE2, от владельца 04.10) в decor.json.
// Добавляет: новые базы (hideout_hash → name), новые имена декора (union), musique не хранится пока.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'C:/Users/mezhavikiserj/Downloads';
const DST = join(ROOT, 'packages/core/data/game/hideout/decor.json');

const FUNCTIONAL = new Set([
  'stash', 'guild stash', 'waypoint', 'map device', 'ziggurat map device', 'relic locker',
  'reforging bench', 'salvage bench', 'well', 'chaos bank', 'gambling stall',
]);
const FUN = ['waypoint', 'map device', 'stash', 'guild stash', 'map table', 'relic locker', 'bench', 'reforging bench', 'salvage bench'];

const decor = JSON.parse(readFileSync(DST, 'utf8'));
decor._meta.source += ' + 12 нативных экспортов PoE2 (владелец, 04.10.2026: Titan Apex, Beacon of Salvation, Bloodreaver Manor, Arcane Isle, Felled×2, Sovereign×3, Limestone, Vastiri Racecourse, Shoreline)';

const files = [
  '1dhideout.hideout', 'Clearfell_Clearing.hideout', 'DefiledForest_Felled0726.hideout',
  'Growth_TheSovereign_0826.hideout', 'Islands_BeaconofSalv0726.hideout', 'Lighted_up_boat.hideout',
  'Limestone_Retreat_Helios.hideout', 'My_Hideout.hideout', 'NaturesVeil_BloodreaverManor_0726.hideout',
  'Tower_of_the_Arcane.hideout', 'VastiriMarkets_VastRacecourse0726.hideout', 'sovereign-shanty-v1.1.hideout',
];

let newBases = 0, newDecor = 0, upgraded = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(join(SRC, f), 'utf8').replace(/^\uFEFF/, ''));
  const key = String(j.hideout_hash);
  if (!decor.hideout_bases[key]) {
    decor.hideout_bases[key] = { name: j.hideout_name, game: 'poe2' };
    newBases++;
  }
  for (const [name, d] of Object.entries(j.doodads ?? {})) {
    const k = name.toLowerCase();
    let e = decor.decor[k];
    if (!e) {
      e = decor.decor[k] = { name, hashes: [], seen_in: [], category: 'unknown', category_source: 'unclassified' };
      newDecor++;
    }
    if (!e.seen_in.includes(f)) e.seen_in.push(f);
    if (!e.hashes.includes(d.hash)) e.hashes.push(d.hash);
    // повторная классификация fresh-имён (не перетираем dataset-категории)
    if (e.category_source === 'unclassified' || e.category === 'unknown') {
      if (FUNCTIONAL.has(k)) { e.category = 'free'; e.category_source = 'base-game functional (seed)'; upgraded++; }
      else {
        const m = k.match(/[\w'’-]+['’]s\s+(.+)/);
        if (m && FUN.some((t) => m[1].includes(t))) { e.category = 'store-mtx'; e.category_source = 'heuristic possessive-name'; upgraded++; }
      }
    }
  }
}
writeFileSync(DST, JSON.stringify(decor, null, 1));
const cats = {};
for (const e of Object.values(decor.decor)) cats[e.category] = (cats[e.category] ?? 0) + 1;
console.log(`bases: ${Object.keys(decor.hideout_bases).length} (+${newBases}), decor names: ${Object.keys(decor.decor).length} (+${newDecor}), reclassified: ${upgraded}`);
console.log('categories:', JSON.stringify(cats));
