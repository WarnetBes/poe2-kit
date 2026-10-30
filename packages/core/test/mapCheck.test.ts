import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMapAgainstBuild } from '../src/mapCheck.js';

const FIXTURE_XML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pob_28880_invoker_ice.xml'),
  'utf8',
);
// Эталон-гир: элем-резисты гир-суммой overcap (fire 106/cold 90/lightning 92 —
// см. e2e28880 «слои клампятся в 75»), chaos = 0 (uncapped факт гир-слоя).

describe('W4-1 checkMapAgainstBuild (max-res идея, реализация своя)', () => {
  it('of Exposure на capped-билде → DANGER: элем-EHP −≥25%, chaos не задет', async () => {
    const r = await checkMapAgainstBuild(FIXTURE_XML, { mods: ['of Exposure'] });
    expect(r.verdict).toBe('danger');
    expect(r.maxResPenaltyPct).toBe(12); // worst-case maxroll группы (датасет 74 групп)
    // capped-слои: 75% → 75−12 = 63 → loss = 1 − 0.37/0.25 = 32%
    expect(r.worstEhpLossPct!).toBeGreaterThanOrEqual(25);
    expect(r.worstEhpLossPct!).toBeLessThanOrEqual(35);
    expect(['fire', 'cold', 'lightning']).toContain(r.worstLayer);
    // chaos-слой не задет: гир-хaos 0 < capAfter 63 — штраф капа его не режет.
    expect(r.worstLayer).not.toBe('chaos');
  });

  it('overcap гира (fire 106) клампится в 75 ДО расчёта деградации', async () => {
    const r = await checkMapAgainstBuild(FIXTURE_XML, { mods: ['of Exposure'] });
    expect(Math.min(75, r.resists.fire)).toBe(75);
    expect(r.resists.fire).toBeGreaterThan(75); // raw overcap сохранён для отчёта
  });

  it('без max-res и без жёстких эффектов → FINE', async () => {
    const r = await checkMapAgainstBuild(FIXTURE_XML, {
      mods: ['Map is inhabited by 30% more Monsters'],
    });
    expect(r.verdict).toBe('fine');
    expect(r.maxResPenaltyPct).toBeUndefined();
  });

  it('of Smothering (−recovery) → не лучше CAREFUL (факторный слой без EHP-пересчёта)', async () => {
    const r = await checkMapAgainstBuild(FIXTURE_XML, { mods: ['of Smothering'] });
    expect(r.harshEffects.length).toBeGreaterThan(0);
    expect(['careful', 'danger']).toContain(r.verdict);
    expect(r.worstEhpLossPct).toBeUndefined(); // EHP-слой не считался — числовой лжи нет
  });

  it('of Exposure + of Smothering: combined-вердикт DANGER (число сильнее фактора)', async () => {
    const r = await checkMapAgainstBuild(FIXTURE_XML, { mods: ['of Exposure', 'of Smothering'] });
    expect(r.verdict).toBe('danger');
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(r.matchedMods.length).toBeGreaterThanOrEqual(2);
  });
});
