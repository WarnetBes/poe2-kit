// Эксперимент: выводится ли game-хеш декора из его имени?
// Имеем 234 пары name→hash из нативных POE2-экспортов. Прогоняем кандидаты:
// crc32, fnv1a-32, fnv1-32, djb2, sdbm — на name, name.toLowerCase(),
// с/без пробелов и апострофов. Совпадение = генератор сможет выводить хеш
// для ЛЮБОГО декора (не только каталожного).
import { readFileSync } from 'node:fs';

const pairs = [];
const dir = new URL('../../_research/hideout_sites/native/', import.meta.url);
for (const f of readFileSync ? [] : []) { /* noop */ }
import { readdirSync } from 'node:fs';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.hideout'))) {
  const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8').replace(/^\uFEFF/, ''));
  for (const [n, d] of Object.entries(j.doodads)) pairs.push([n, d.hash]);
}
const uniq = new Map(pairs);
console.log('unique pairs:', uniq.size);

// candidates
function crc32(s) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let h = 0xFFFFFFFF;
  for (let i = 0; i < s.length; i++) h = table[(h ^ s.charCodeAt(i)) & 0xFF] ^ (h >>> 8);
  return (h ^ 0xFFFFFFFF) >>> 0;
}
function fnv1a(s) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = (h * 0x01000193) >>> 0; } return h >>> 0; }
function fnv1(s) { let h = 0x811c9dc5; for (const ch of s) { h = (h * 0x01000193) >>> 0; h ^= ch.codePointAt(0); } return h >>> 0; }
function djb2(s) { let h = 5381; for (const ch of s) h = ((h * 33) + ch.codePointAt(0)) >>> 0; return h >>> 0; }
function sdbm(s) { let h = 0; for (const ch of s) h = (ch.codePointAt(0) + (h << 6) + (h << 16) - h) >>> 0; return h >>> 0; }

const variants = (n) => [
  n, n.toLowerCase(), n.toUpperCase(), n.replace(/ /g, ''), n.toLowerCase().replace(/ /g, ''),
  n.toLowerCase().replace(/'/g, ''), n.toLowerCase().replace(/[^a-z0-9]/g, ''),
  n.toLowerCase().replace(/ /g, '_'), n.trim(),
];
const algos = { crc32, fnv1a, fnv1, djb2, sdbm };

let hits = 0;
const hitAlgo = {};
for (const [name, hash] of uniq) {
  for (const [an, fn] of Object.entries(algos)) {
    for (const v of variants(name)) {
      if (fn(v) === hash) { hits++; hitAlgo[an] = (hitAlgo[an] || 0) + 1; break; }
    }
  }
}
console.log('hits:', hits, JSON.stringify(hitAlgo));
console.log(hits === 0
  ? 'ВЫВОД: хеш НЕ выводится из имени тривиальными алгоритмами — хеши из внутреннего metadata-пути игры. Генератор = только каталог.'
  : 'ВЫВОД: алгоритм найден!');
