#!/usr/bin/env node
/**
 * E5 (мастер-план §4): полный аудит сверки канона PoB2 (stats.po msgid) ↔
 * нашего statdesc-индекса. Двусторонний отчёт → docs/pob2_stat_audit.md.
 *
 * 1. PoB2 → у нас: msgid (только с {N}) не имеющие нормализованного
 *    эквивалента в data/game/stat_descriptions/* — gap-list «есть у PoB2,
 *    нет у нас».
 * 2. У нас → PoB2: наши нормализованные шаблоны, отсутствующие в PoB2-каноне
 *    (trade-side форматы, альтернативные описания).
 *
 * Рантайм НЕ зависит от результатов; отчёт регенерируется при патче PoB2.
 * Запуск: node scripts/pob2-stat-audit.mjs   (нужен свежий build core:
 * импортирует normalizeStatPattern из packages/core/dist).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const coreDistPath = ['file:///', join(here, '..', 'packages', 'core', 'dist', 'index.js').replace(/\\/g, '/')].join('');
const coreDist = await import(coreDistPath);
const norm = coreDist.normalizeStatPattern ?? coreDist.core.statdesc.normalizeStatPattern;

const CORPUS = join(here, '..', 'packages', 'core', 'data', 'pob2_stat_templates.txt');
const STAT_DIR = join(here, '..', 'packages', 'core', 'data', 'game', 'stat_descriptions');
const OUT = join(here, '..', 'docs', 'pob2_stat_audit.md');

const corpus = readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((s) => s.replace(/\\n/g, '\n'));
const withPh = corpus.filter((s) => /\{\d/.test(s));
const pob2Norm = new Map(); // norm → первый原文
for (const s of withPh) {
  const n = norm(s);
  if (n.includes('#') && !pob2Norm.has(n)) pob2Norm.set(n, s);
}

// наш индекс: norm → пример шаблона
const ours = new Map();
for (const file of readdirSync(STAT_DIR).filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(STAT_DIR, file), 'utf8'));
  for (const d of j.descriptions ?? []) {
    const add = (t) => {
      if (typeof t === 'string' && t) {
        const n = norm(t);
        if (n.includes('#') && !ours.has(n)) ours.set(n, t);
      }
    };
    add(d.primary_template);
    for (const v of d.variants ?? []) add(v.template);
  }
}

// 1. есть у PoB2, нет у нас
const gap = [...pob2Norm.entries()].filter(([n]) => !ours.has(n));
// 2. есть у нас, нет у PoB2
const extra = [...ours.entries()].filter(([n]) => !pob2Norm.has(n));
const hit = pob2Norm.size - gap.length;

const pct = (x, y) => ((100 * x) / y).toFixed(1);
const lines = [];
lines.push('# PoB2 stats.po ↔ statdesc-индекс — аудит покрытия (E5)');
lines.push('');
lines.push('> Сгенерировано `scripts/pob2-stat-audit.mjs`. Канон: PathOfBuilding-PoE2-i18n');
lines.push('> stats.po msgid (строки данных GGG; PoB2-i18n — форк MIT-PoB2, LICENSE в клоне нет,');
lines.push('> используются только как data-facts — мастер-план §8). Регенерация при патче PoB2.');
lines.push('');
lines.push('| Метрика | Значение |');
lines.push('|---|---|');
lines.push(`| msgid в каноне (всего) | ${corpus.length} |`);
lines.push(`| msgid с {N}-плейсхолдером | ${withPh.length} |`);
lines.push(`| нормализованных уникалей PoB2 | ${pob2Norm.size} |`);
lines.push(`| наших нормализованных шаблонов | ${ours.size} |`);
lines.push(`| покрыто нами (hit) | ${hit} (${pct(hit, pob2Norm.size)}%) |`);
lines.push(`| gap: есть у PoB2, нет у нас | ${gap.length} |`);
lines.push(`| extra: есть у нас, нет у PoB2 | ${extra.length} |`);
lines.push('');
lines.push(`Спека-гейт ≥95%: ${hit / pob2Norm.size >= 0.95 ? 'пройден' : 'НЕ пройден'} → gap-list ниже (в'>`);
lines.push('');
lines.push('## Gap: есть у PoB2, нет у нас (первые 200)');
lines.push('');
lines.push('```');
for (const [, src] of gap.slice(0, 200)) lines.push(src.replace(/\n/g, ' ⏎ '));
lines.push('```');
lines.push('');
lines.push('## Extra: есть у нас, нет у PoB2 (первые 100)');
lines.push('');
lines.push('```');
for (const [, src] of extra.slice(0, 100)) lines.push(src.replace(/\n/g, ' ⏎ '));
lines.push('```');
lines.push('');

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(` корпоре: ${pob2Norm.size} норм-уникалей | hit ${hit} (${pct(hit, pob2Norm.size)}%) | gap ${gap.length} | extra(наши вне PoB2) ${extra.length}`);
console.log('→', OUT);
