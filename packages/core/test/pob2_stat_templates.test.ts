/**
 * E5 (мастер-план §4): stats.po как канон — сверка PoB2-шаблонов с нашим
 * statdesc-индексом по нормализованным формам.
 *
 * Факты от 11.10.2026 (полный прогон, scripts/extract-pob2-stats.mjs):
 *  - PoB2-канон: 31 016 msgid, из них 16 766 с {N}-плейсхолдером.
 *  - Покрытие полного корпуса: 84.7%; подкорпус «каждый 10-й»: 83.4%.
 *  - Спека-гейт плана был ≥95% — НЕ пройден; по плану (>5% расхождений)
 *    это bug-list/gap-list, а не блокер: промахи — контентные пробелы
 *    (скилловые механики: "Adds {0} to {1} Chaos Damage", радиусы, метры),
 *    а не false-fail формата (риск №3 снят риск-промером: 15/20 sample,
 *    нормализация "{0:+d}" ≡ "+" ≡ числа → '#').
 *
 * Гейт здесь: регресс-пол — покрытие подкорпуса не должно падать ниже
 * baseline (80%), и число нормализуемых msgid = 100% (риск-контроль формата).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStatPattern } from '../src/statdesc.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '..', 'data', 'pob2_stat_templates.txt');
const STAT_DIR = join(here, '..', 'data', 'game', 'stat_descriptions');

function loadCorpus(): string[] {
  return readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean);
}

function loadOurPatterns(): Set<string> {
  const set = new Set<string>();
  for (const file of readdirSync(STAT_DIR).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(STAT_DIR, file), 'utf8')) as {
      descriptions?: Array<{ primary_template?: unknown; variants?: Array<{ template?: unknown }> }>;
    };
    for (const d of j.descriptions ?? []) {
      const add = (t: unknown): void => {
        if (typeof t === 'string' && t) {
          const n = normalizeStatPattern(t);
          if (n.includes('#')) set.add(n);
        }
      };
      add(d.primary_template);
      for (const v of d.variants ?? []) add(v.template);
    }
  }
  return set;
}

describe('E5: PoB2 stats.po как канон — сверка с statdesc-индексом', () => {
  it('корпус на месте и полон (31 016 msgid; при патче PoB2 перегенерить extractor-ом)', () => {
    const corpus = loadCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(30_000);
    expect(corpus.length).toBeLessThan(40_000);
  });

  it('риск №3 снят: 100% msgid нормализуются в сопоставимую форму (без {…}-остатков)', () => {
    const corpus = loadCorpus();
    let bad = 0;
    for (const s of corpus) {
      const unescaped = s.replace(/\\n/g, '\n');
      const n = normalizeStatPattern(unescaped);
      if (n.includes('{') || n.includes('}')) {
        if (bad < 5) console.error('не нормализовался:', s);
        bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('покрытие подкорпуса (каждый 10-й с {N}) ≥ 80% (baseline 83.4%, spyка-гейт 95% — gap-list)', () => {
    const corpus = loadCorpus().filter((s) => /\{\d/.test(s));
    const ours = loadOurPatterns();
    let hit = 0;
    let total = 0;
    for (let i = 0; i < corpus.length; i += 10) {
      total++;
      if (ours.has(normalizeStatPattern(corpus[i]!.replace(/\\n/g, '\n')))) hit++;
    }
    const pct = (100 * hit) / total;
    // spyка: >5% расхождений = bug-list в statMatching (мастер-план §6-E5);
    // полный gap-list — scripts/pob2-stat-audit.mjs → docs/pob2_stat_audit.md
    expect(pct).toBeGreaterThanOrEqual(80);
  });
});
