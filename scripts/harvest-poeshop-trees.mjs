/**
 * harvest-poeshop-trees.mjs — деревья пассивок poeshop-гайдов (№582).
 *
 * Повод: у карточек гайдов не заполнялось дерево пассивок. Разведка (browser-MCP):
 * виджет дерева на странице (blog-tree-embed, React) получает props.code — base64
 * PoB-подобный код: decode → {c, a, n, n1, n2, na, i, s, j}:
 *   c — class id, a — ascendancy, n — узлы основного дерева (GGG node ids),
 *   n1/n2 — наборы weapon-set (подсветки set1/set2), j — самоцветы.
 * Код лежит в RSC-payload сырого HTML (self.__next_f), все такие коды начинаются
 * с base64('{"c":') = 'eyJjIjo' → обычный GET + regex, React не нужен.
 *
 * Результат: packages/core/data/game/guides/guide_trees.json
 *   { source, built, harvester, trees: { [slug]: { a, n, n1?, n2?, na?, j? } } }
 * (класс берём из poeshop_guides.json — там class_en; c-число клиенту не нужно).
 *
 * Запуск: node scripts/harvest-poeshop-trees.mjs [--limit N] [--delay ms]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guidesPath = path.join(here, '..', 'packages', 'core', 'data', 'game', 'guides', 'poeshop_guides.json');
const outPath = path.join(here, '..', 'packages', 'core', 'data', 'game', 'guides', 'guide_trees.json');

const args = new Set(process.argv.slice(2));
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
const delayIdx = process.argv.indexOf('--delay');
const DELAY = delayIdx >= 0 ? Number(process.argv[delayIdx + 1]) : 700;

const { guides } = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));
console.log(`harvest: ${guides.length} гайдов, delay=${DELAY}ms${Number.isFinite(LIMIT) ? ` limit=${LIMIT}` : ''}`);

// ВСЕ коды начинаются с base64('{"c":') = 'eyJjIjo'; алфавит может быть и url-вариантом
// ('-'/'_' вместо '+'/''), поэтому charset расширен и нормализуется перед decode (№581)
const RE = /eyJjIjo[A-Za-z0-9+/=_-]+/g;
const trees = {};
let ok = 0, fail = 0, empty = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'poe2-kit-tree-harvester/1.0' } });
      if (res.ok) return await res.text();
      if (res.status === 429) { console.log(`  429, пауза 5с`); await sleep(5000); continue; }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2000);
    }
  }
  throw new Error('unreachable');
}

const list = guides.slice(0, LIMIT);
let done = 0;
for (const g of list) {
  done++;
  try {
    const html = await fetchWithRetry(g.url);
    // все коды {..} c — их может быть несколько (embed'ы); берём самый «узловой»
    const found = [...html.matchAll(RE)].map((m) => m[0]);
    let best = null;
    for (const code of found) {
      try {
        const j = JSON.parse(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (!j || !Array.isArray(j.n)) continue;
        if (!best || j.n.length > best.n.length) best = j;
      } catch { /* битый base64 — мимо */ }
    }
    if (best?.n?.length) {
      trees[g.slug] = {
        a: typeof best.a === 'string' ? best.a : undefined,
        n: best.n.filter((x) => Number.isInteger(x)),
        ...(Array.isArray(best.n1) && best.n1.length ? { n1: best.n1.filter((x) => Number.isInteger(x)) } : {}),
        ...(Array.isArray(best.n2) && best.n2.length ? { n2: best.n2.filter((x) => Number.isInteger(x)) } : {}),
        ...(Array.isArray(best.j) && best.j.length ? { j: best.j } : {}),
      };
      ok++;
      if (done % 25 === 0) console.log(`  ${done}/${list.length}: ${g.slug} → ${best.n.length} узлов`);
    } else {
      empty++;
    }
  } catch (e) {
    fail++;
    console.log(`  FAIL ${g.slug}: ${e.message}`);
  }
  if (done < list.length) await sleep(DELAY);
}

const payload = {
  source: 'poeshop.ru (виджет дерева гайдов, RSC payload страницы)',
  built: new Date().toISOString().slice(0, 10),
  harvester: 'scripts/harvest-poeshop-trees.mjs',
  trees,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload));
const nodeStats = Object.values(trees).map((t) => t.n.length);
console.log(`Готово: ok=${ok} fail=${fail} empty=${empty}; узлов/гайд: min=${Math.min(...nodeStats, 0)} max=${Math.max(...nodeStats, 0)} медиана≈${nodeStats.sort((a, b) => a - b)[Math.floor(nodeStats.length / 2)]}`);
console.log(`→ ${outPath} (${fs.statSync(outPath).size} Б)`);
if (fail > 0) process.exitCode = 1;
