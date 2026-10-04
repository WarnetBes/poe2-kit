#!/usr/bin/env node
/**
 * Волна №215: переливка RePoE Atlas.json (PoE2 4.5.x) → компактный atlas.json для poe2-kit.
 *
 * Вход:  _research/atlas-study/repoe/passive_skill_trees-Atlas.json (RePoE-fork export)
 * Выход: packages/core/data/game/atlas/atlas.json
 *
 * Геометрия (расшифрована, конвенция совпадает с PoE1 tree-export):
 *   radius            = индекс орбиты → orbit_radii[r] пикселей от центра группы
 *   position_clockwise = индекс слота → угол = slot * 360 / skills_per_orbit[r], 0 = вверх, по часовой
 *   корень (r=0)      = центр группы
 *   splines           = декоративные индексы GGG-арта (точек кривых в экспорте нет) → игнорируем,
 *                       рёбра рисуем сами
 *
 * Иконки: poe2db CDN, формула проверена вживую (HTTP 200, image/webp):
 *   https://cdn.poe2db.tw/image/ + art-путь, .dds → .webp
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = String.raw`C:\Users\mezhavikiserj\BildPOE2\_research\atlas-study\repoe\passive_skill_trees-Atlas.json`;
const OUT_DIR = path.join(__dirname, '..', 'packages', 'core', 'data', 'game', 'atlas');
const OUT = path.join(OUT_DIR, 'atlas.json');

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const orbitRadii = src.orbit_radii;
const skillsPerOrbit = src.skills_per_orbit;

/** Конвенция PoE1 tree-export: 0 = вверх, по часовой. */
function nodePos(g, p) {
  const R = orbitRadii[p.radius] || 0;
  if (!R) return { x: g.x, y: g.y };
  const slots = skillsPerOrbit[p.radius] || 1;
  const ang = ((p.position_clockwise % slots) + slots) % slots;
  const theta = (ang * 2 * Math.PI) / slots - Math.PI / 2;
  return { x: g.x + R * Math.cos(theta), y: g.y + R * Math.sin(theta) };
}

function iconUrl(art) {
  if (!art) return '';
  return 'https://cdn.poe2db.tw/image/' + art.replace(/^Art\//, 'Art/').replace(/\.dds$/, '.webp');
}

const nodes = {};
const edgeSet = new Set();
const edges = [];

let processed = 0;
for (const g of src.groups) {
  for (const gp of g.passives) {
    const meta = src.passives[String(gp.hash)];
    if (!meta) continue; // узел без метаданных — не должен случиться, но не падаем
    if (meta.is_icon_only) continue; // 38 декоративных mastery-иконок: не узлы, без рёбер и статов
    const { x, y } = nodePos(g, gp);
    nodes[gp.hash] = {
      id: meta.id,
      name: meta.name || (meta.is_atlas_root ? `Начало: ${meta.atlas_subtree ? meta.atlas_subtree.id : 'центр'}` : meta.id),
      ks: !!meta.is_keystone,
      not: !!meta.is_notable,
      root: !!meta.is_atlas_root,
      subtree: meta.atlas_subtree ? meta.atlas_subtree.id : '',
      stats: Array.isArray(meta.stat_text) ? meta.stat_text : [],
      icon: iconUrl(meta.icon),
      x: +x.toFixed(2),
      y: +y.toFixed(2),
    };
    processed++;
    for (const to of gp.connections || []) {
      const key = gp.hash < to ? `${gp.hash}|${to}` : `${to}|${gp.hash}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([gp.hash, to]);
      }
    }
  }
}

// корни, реально попавшие в nodes
const roots = (src.roots || []).filter((h) => nodes[h]);

// принадлежность веток (subtree) по узлам
const subtrees = {};
for (const h of Object.keys(nodes)) {
  const st = nodes[h].subtree;
  if (st) (subtrees[st] ||= []).push(Number(h));
}

const out = {
  version: '4.5.5.2',
  title: src.title || 'Atlas Skills',
  totalPoints: 40, // 30 (Nexus T3/6/9/12/15 по 6) + 10 (Pinnacle-боссы), зафиксировано ресёрчем №214
  roots,
  nodes,
  edges,
  subtrees,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`nodes: ${processed}/575, edges: ${edges.length}, roots: ${roots.length}`);
console.log(`subtrees: ${Object.entries(out.subtrees).map(([k, v]) => `${k}:${v.length}`).join(', ')}`);
console.log(`size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB → ${OUT}`);
// проверка координатной сетки
const xs = Object.values(nodes).map((n) => n.x);
const ys = Object.values(nodes).map((n) => n.y);
console.log(`bounds: x [${Math.min(...xs).toFixed(0)} .. ${Math.max(...xs).toFixed(0)}], y [${Math.min(...ys).toFixed(0)} .. ${Math.max(...ys).toFixed(0)}]`);
const noMeta = [];
for (const g of src.groups) for (const p of g.passives) if (!src.passives[String(p.hash)]) noMeta.push(p.hash);
console.log('nodes without meta:', noMeta.length ? JSON.stringify(noMeta) : 'none');
