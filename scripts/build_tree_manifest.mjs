/**
 * Сборка SpriteManifest для WebGL-рендерера дерева (@poe2-toolkit/tree-react).
 *
 * Источники — официальный экспорт GGG (github.com/grindinggear/poe2-skilltree-export):
 *   packages/core/data/game/passive_tree/assets/skills.json              — иконки узлов
 *   packages/core/data/game/passive_tree/export/frame.json               — фреймы (KeystoneFrame* и т.п.)
 *   packages/core/data/game/passive_tree/export/mastery-effect-active.json — паттерны мастерств
 * Выход: packages/core/data/game/passive_tree/export/manifest.json
 *   { frames: { "<spriteKey>": { atlas, x, y, w, h } } }
 * Идентификаторы атласов: skills | frame | mastery (те же webp лежат рядом/в assets).
 *
 * Печатает отчёт покрытия: какие ключи, требуемые data.json, отсутствуют
 * (отсутствие НЕ фатально — рендерер деградирует без иконки, но узел остаётся).
 * Запуск: node _build_tree_manifest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.');
const PT = path.join(ROOT, 'packages/core/data/game/passive_tree');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const skills = readJson(path.join(PT, 'assets/skills.json'));
const frame = readJson(path.join(PT, 'export/frame.json'));
const mastery = readJson(path.join(PT, 'export/mastery-effect-active.json'));
const data = readJson(path.join(PT, 'export/data.json'));

const frames = {};
let n = 0;
for (const [key, v] of Object.entries(skills.frames)) frames[key] = { atlas: 'skills', ...v.frame }, n++;
for (const [key, v] of Object.entries(frame.frames)) frames[key.replace(/^frame:/, '')] = { atlas: 'frame', ...v.frame }, n++;
for (const [key, v] of Object.entries(mastery.frames)) frames[key] = { atlas: 'mastery', ...v.frame }, n++;

const out = path.join(PT, 'export/manifest.json');
fs.writeFileSync(out, JSON.stringify({ frames }));

// ── Отчёт покрытия по data.json ────────────────────────────────────────────
// Конвенции ключей — spriteKeys.ts из @poe2-toolkit/tree-react:
//   иконка:    `${variant}Active:${icon}` (variant: keystone|notable|normal)
//   фрейм:     frameKeyFor(kind, allocated) — оба state нужны
//   эффeкт:    `masteryEffectActive:${activeEffectImage}.png`
const FRAME_KEYS = [
  'KeystoneFrameAllocated', 'KeystoneFrameUnallocated',
  'NotableFrameAllocated', 'NotableFrameUnallocated',
  'JewelFrameAllocated', 'JewelFrameUnallocated',
  'AscendancyFrameNotableAllocated', 'AscendancyFrameNotableUnallocated',
  'AscendancyFrameNormalAllocated', 'AscendancyFrameNormalUnallocated',
  'AscendancyStartNode', 'PSSkillFrame', 'PSSkillFrameActive',
];
const needIcons = new Set();
const needEffects = new Set();
for (const node of Object.values(data.nodes)) {
  if (!node || typeof node !== 'object' || !('skill' in node)) continue;
  const asc = !!node.ascendancyId;
  const icon = node.icon ?? '';
  if (icon && !node.isMastery && !node.isAscendancyStart) {
    const variant = node.isKeystone ? 'keystone'
      : node.isNotable ? 'notable' : 'normal';
    needIcons.add(`${variant}Active:${icon}`);
  }
  if (node.activeEffectImage) needEffects.add(`masteryEffectActive:${node.activeEffectImage}`);
}
const missIcon = [...needIcons].filter((k) => !frames[k]);
const missEffect = [...needEffects].filter((k) => !frames[k]);
const missFrame = FRAME_KEYS.filter((k) => !frames[k]);

console.log(`manifest.json: ${n} frames`);
console.log(`иконок требуется: ${needIcons.size}, отсутствует: ${missIcon.length}`);
if (missIcon.length) console.log(missIcon.slice(0, 10).join('\n'));
console.log(`эффектов требуется: ${needEffects.size}, отсутствует: ${missEffect.length}`);
if (missEffect.length) console.log(missEffect.slice(0, 10).join('\n'));
console.log(`фреймов отсутствует: ${missFrame.length}${missFrame.length ? ': ' + missFrame.join(', ') : ''}`);
