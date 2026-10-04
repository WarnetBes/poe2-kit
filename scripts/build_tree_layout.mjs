/**
 * Регенерация layout.json из ОФИЦИАЛЬНОГО экспорта GGG (export/data.json).
 *
 * Зачем: единый источник истины для WebGL- и SVG-видов дерева. Старый layout.json
 * был извлечён из PoB2 TreeData (своя система координат, PoB-вариации имён);
 * новый строится из того же data.json, что питает игровой WebGL-рендер (№204–№206).
 *
 * Вход:
 *   packages/core/data/game/passive_tree/export/data.json     — официальный экспорт GGG
 *   packages/core/data/game/passive_tree/export/manifest.json — кадры атласов (build_tree_manifest.mjs)
 *   packages/core/data/game/passive_tree/layout.json         — ТОЛЬКО перенос metadata
 *                                                             (skills/ring/classBgs-арт) +
 *                                                             эталон classStarts/дельт дисков
 * Выход:layout.json (перезапись, формат совместим с fullMap.ts/treeMap.ts).
 *
 * Правила:
 *   - узел включается, если есть numeric `skill` И (имя ИЛИ участие в рёбрах):
 *     безымянные структурные узлы (старты асценданси, связки) важны для геометрии;
 *   - рёбра: верхнеуровневые {from,to}; пары one-group+one-orbit → SVG-дуга
 *     (r = дистанция до центра группы; обе точки лежат на этой окружности),
 *     остальные — прямые; дубликаты (обе стороны) схлопываются;
 *   - ic: кадр `<variant>Active:<icon>` из manifest.json (как WebGL-рендерер);
 *   - asc: display-имя из classes[].ascendancies (ascendancyId → name);
 *   - classBgs.positions: центроид узлов асценданси в новых координатах
 *     + пер-асценданси дельта старого экстрактора (сохраняет авторские смещения).
 *
 * Запуск: node scripts/build_tree_layout.mjs   (см. scripts/refresh-data.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.resolve(import.meta.dirname ?? '.');
const PT = path.join(HERE, '..', 'packages/core/data/game/passive_tree');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const data = readJson(path.join(PT, 'export/data.json'));
const manifest = readJson(path.join(PT, 'export/manifest.json'));
const old = readJson(path.join(PT, 'layout.json'));

// ── Реестры классов/асценданси ──────────────────────────────────────────────
const ascNameById = new Map(); // 'Witch3' -> 'Acolyte of Chayula'
const ascClasses = {}; // displayName -> базовый класс
for (const c of data.classes ?? []) {
  for (const a of c.ascendancies ?? []) {
    if (a.id && a.name) {
      ascNameById.set(a.id, a.name);
      ascClasses[a.name] = c.name;
    }
  }
}

// ── Узлы ────────────────────────────────────────────────────────────────────
const edgeTouched = new Set();
for (const e of data.edges ?? []) {
  if (e.from === 'root') continue;
  edgeTouched.add(String(e.from));
  edgeTouched.add(String(e.to));
}
const frames = manifest.frames ?? {};
const nodes = {};
const bySkill = new Map();
let incl = 0, withIcon = 0, nameless = 0, ascStarts = {};
for (const n of Object.values(data.nodes)) {
  if (!n || typeof n !== 'object' || typeof n.skill !== 'number') continue;
  if (!(n.name && String(n.name).trim()) && !edgeTouched.has(String(n.skill))) continue;
  const id = String(n.skill);
  bySkill.set(id, n);
  const asc = n.ascendancyId ? (ascNameById.get(n.ascendancyId) ?? '') : '';
  const out = {
    name: n.name ?? '',
    stats: n.stats ?? [],
    asc,
    ks: !!n.isKeystone,
    not: !!n.isNotable,
    x: n.x,
    y: n.y,
  };
  // иконка: тот же spriteKey, что и в WebGL (build_tree_manifest.mjs:56-59)
  if (n.icon && !n.isMastery && !n.isAscendancyStart) {
    const variant = n.isKeystone ? 'keystone' : n.isNotable ? 'notable' : 'normal';
    const f = frames[`${variant}Active:${n.icon}`];
    if (f) { out.ic = [f.x, f.y, f.w, f.h]; withIcon++; }
  }
  if (n.isAscendancyStart && asc) ascStarts[asc] = id;
  if (!out.name) nameless++;
  nodes[id] = out;
  incl++;
}

// ── Рёбра (дуги по орбитам + прямые) ────────────────────────────────────────
const groupOf = (id) => {
  const n = bySkill.get(id);
  return n && n.group != null ? data.groups[String(n.group)] : undefined;
};
const angle = (n, g) => Math.atan2(n.y - g.y, n.x - g.x);
const edges = [];
const seenEdge = new Set();
let arcs = 0, lines = 0, dupes = 0, dropped = 0, crossOrbitArcs = 0;
for (const e of data.edges ?? []) {
  if (e.from === 'root') continue;
  const a = String(e.from), b = String(e.to);
  if (!nodes[a] || !nodes[b]) { dropped++; continue; }
  if (a === b) continue;
  const key = a < b ? a + '\u0000' + b : b + '\u0000' + a;
  if (seenEdge.has(key)) { dupes++; continue; }
  seenEdge.add(key);
  const na = bySkill.get(a), nb = bySkill.get(b);
  const ga = groupOf(a), gb = groupOf(b);
  if ((ga === gb) && ga && na.orbit != null && na.orbit === nb.orbit) {
    const r = Math.hypot(na.x - ga.x, na.y - ga.y);
    if (r > 1) {
      // дуга по окружности орбиты; sweep = направление кратчайшей дуги
      let d = angle(nb, ga) - angle(na, ga);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const sweep = d >= 0 ? 1 : 0;
      const large = Math.abs(d) > Math.PI - 1e-6 ? 1 : 0;
      edges.push([a, b, 0, 0, Math.round(r * 100) / 100, large, sweep]);
      arcs++;
      continue;
    }
    crossOrbitArcs++;
  }
  edges.push([a, b]);
  lines++;
}

// ── Старты классов: переносим из старого layout (root-рёбра не дают имён) ────
// Валидация: множество id стартов обязано совпадать с root-рёбрами data.json.
const classStarts = {};
const rootTargets = new Set((data.edges ?? []).filter((e) => e.from === 'root').map((e) => String(e.to)));
for (const [cls, id] of Object.entries(old.classStarts ?? {})) {
  if (!nodes[String(id)]) continue;
  classStarts[cls] = String(id);
}
if (new Set(Object.values(classStarts)).size !== rootTargets.size || [...rootTargets].some((id) => !Object.values(classStarts).includes(id))) {
  console.warn(`⚠️ classStarts (${Object.keys(classStarts).length}) ≠ root-рёбрам (${rootTargets.size}) — проверить вручную`);
}

// ── metadata: арт переносим (атласы не менялись), позиции дисков считаем ───
const newCentroid = {};
for (const [id, n] of Object.entries(nodes)) {
  if (!n.asc) continue;
  (newCentroid[n.asc] ||= [0, 0, 0]);
  newCentroid[n.asc][0] += n.x; newCentroid[n.asc][1] += n.y; newCentroid[n.asc][2]++;
}
const oldCentroid = {};
for (const o of Object.values(old.nodes ?? {})) {
  if (!o.asc) continue;
  (oldCentroid[o.asc] ||= [0, 0, 0]);
  oldCentroid[o.asc][0] += o.x; oldCentroid[o.asc][1] += o.y; oldCentroid[o.asc][2]++;
}
const posDelta = {}; // пер-асц дельта старого экстрактора (сдвиг центроида)
for (const [cls, sheet] of Object.entries(old.metadata?.classBgs ?? {})) {
  for (const p of sheet.positions ?? []) {
    if (!p.asc || !oldCentroid[p.asc]) continue;
    posDelta[p.asc] = [p.x - oldCentroid[p.asc][0] / oldCentroid[p.asc][2],
                      p.y - oldCentroid[p.asc][1] / oldCentroid[p.asc][2]];
  }
}
const classBgs = {};
let discPosOK = 0;
for (const [cls, sheet] of Object.entries(old.metadata?.classBgs ?? {})) {
  const positions = [];
  for (const p of sheet.positions ?? []) {
    if (!p.asc) { positions.push({ asc: '', x: p.x, y: p.y, idx: p.idx }); continue; }
    const c = newCentroid[p.asc];
    if (c && c[2]) {
      const d = posDelta[p.asc] ?? [0, 0];
      positions.push({ asc: p.asc, x: c[0] / c[2] + d[0], y: c[1] / c[2] + d[1], idx: p.idx });
      discPosOK++;
    }
  }
  classBgs[cls] = { ...sheet, positions };
}
const metadata = {
  ...old.metadata,
  dataset: 'passive_tree/layout (generated)',
  source: 'GGG official skill tree export: export/data.json + export/manifest.json',
  source_file: 'export/data.json',
  generated_at: new Date().toISOString().slice(0, 10),
  generation: 'scripts/build_tree_layout.mjs (was: PoB2 TreeData extract)',
  placed_nodes: incl,
  nodes_with_icons: withIcon,
  edges: edges.length,
  class_starts: Object.keys(classStarts).length,
  asc_starts: Object.keys(ascStarts).length,
  // skills/ring/frames атласов переносятся как есть (webp-ассеты не менялись)
};

const layout = { nodes, edges, classStarts, ascStarts, ascClasses, metadata };
const outPath = path.join(PT, 'layout.json');
fs.writeFileSync(outPath, JSON.stringify(layout));

// ── Отчёт ───────────────────────────────────────────────────────────────────
const oldIds = new Set(Object.keys(old.nodes ?? {}));
const incIds = new Set(Object.keys(nodes));
const lost = [...oldIds].filter((id) => !incIds.has(id));
console.log(`layout.json: узлов ${incl} (иконок ${withIcon}, безымянных структурных ${nameless})`);
console.log(`рёбра: ${edges.length} (дуг ${arcs}, прямых ${lines}, дубликатов схлопнуто ${dupes}, отброшено ${dropped}, r≈0-дуг пало в прямые ${crossOrbitArcs})`);
console.log(`асценданси: ascClasses ${Object.keys(ascClasses).length}, ascStarts ${Object.keys(ascStarts).length}, диски позиционированы ${discPosOK}`);
console.log(`vs старый (${oldIds.size}): потеряно ${lost.length}${lost.length ? ': ' + lost.join(',') : ''}, добавлено ${incIds.size - oldIds.size + lost.length}`);
if (lost.length) console.warn('⚠️ Найдены узлы старого layout, отсутствующие в новом — проверить перед коммитом!');
console.log(`размер: ${(fs.statSync(outPath).size / 1024).toFixed(0)} КиБ`);
