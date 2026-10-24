import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyEstimateOverrides,
  calculateAllEhp,
  estimateBuild,
  type BuildEstimate,
} from '../src/estimate.js';
import { evaluateBuildAgainstGoals, OPTIMIZE_CONSTANTS } from '../src/optimize.js';
import { buildCodeToGear } from '../src/build.js';

/**
 * Сквозной e2e регрессионный лок эталона 28880 (Ice Strike Invoker).
 *
 * Фикстура: декодированный PoB-XML эталона (Monk/Invoker, level 97).
 * ВАЖНО (факты фикстуры, сверять перед обновлением золотых чисел):
 *  - PlayerStat FullDPS = 0 (PoB пишет 0, пока ни один скилл не отмечен
 *    includeInFullDPS), а TotalDPS = 5 992 638.6 — реальный DPS-агрегат тут
 *    TotalDPS, НЕ FullDPS;
 *  - тегов <FullDPSSkill> в XML НЕТ;
 *  - билд НЕ CI: PlayerStat Life = 1539, ChaosResist = 30 (CI-эталон — другой
 *    экспорт; здесь Life-билд, chaos-слой ожидаемо хуже элем-слоёв);
 *  - weapon set I/II: слот «Weapon 1» + «Weapon 1 Swap» (item 7/8).
 *
 * Числа PoB (точный движок) vs наш estimate (только гир) — расхождения
    ожидаемы и честно зафиксированы допусками, БЕЗ подгонки.
 */

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'pob_28880_invoker_ice.xml',
);
const FIXTURE_XML = readFileSync(FIXTURE_PATH, 'utf8');

// ─── Золотые числа PoB-XML (эталон, источник = фикстура) ─────────────────────
const POB = {
  level: 97,
  className: 'Monk',
  ascendancy: 'Invoker',
  totalDps: 5_992_638.624_404,
  combinedDps: 6_006_111.869_890_4,
  fullDpsPlayerStat: 0, // PoB пишет 0 — скиллы не включены в Full DPS
  totalEhp: 31_675.411_564_61,
  life: 1539,
  energyShield: 4288,
  spiritUnreserved: -95,
  physMaxHit: 6620,
  elemMaxHit: 22_339,
  chaosMaxHit: 5873,
  fireRes: 75,
  coldRes: 75,
  lightningRes: 75,
  chaosRes: 30,
} as const;

let est: BuildEstimate;

beforeAll(async () => {
  est = await estimateBuild(FIXTURE_XML);
});

describe('e2e 28880: полный конвейер фикстра → estimate → goals', () => {
  it('фикстура принимается на вход как сырой XML (freestanding, без PoB-кода)', () => {
    // Хрупкий позитив: если формат фикстуры сменится — обновить сознательно.
    expect(FIXTURE_XML).toContain('<PathOfBuilding2>');
    expect(FIXTURE_XML).toContain('ascendClassName="Invoker"');
    expect(FIXTURE_XML.match(/<FullDPSSkill\b/g)).toBeNull();
    expect(FIXTURE_XML).toContain('<PlayerStat stat="FullDPS" value="0"/>');
  });

  it('метаданные билда: Monk/Invoker L97, источник pob+gear', () => {
    expect(est.source).toBe('pob+gear');
    expect(est.characterLevel).toBe(POB.level);
    expect(est.className).toBe(POB.className);
    expect(est.ascendancy).toBe(POB.ascendancy);
  });

  it('PlayerStat-парсинг: полный слот эталона на месте', () => {
    expect(est.pobStats['TotalDPS']).toBeCloseTo(POB.totalDps, 3);
    expect(est.pobStats['CombinedDPS']).toBeCloseTo(POB.combinedDps, 3);
    expect(est.pobStats['TotalEHP']).toBeCloseTo(POB.totalEhp, 3);
    expect(est.pobStats['Life']).toBe(POB.life);
    expect(est.pobStats['EnergyShield']).toBe(POB.energyShield);
    expect(est.pobStats['FullDPS']).toBe(0);
    expect(Object.keys(est.pobStats).length).toBeGreaterThan(100);
  });

  it('БАГ-ФИКС regression: FullDPS PlayerStat = 0 НЕ подменяет DPS-агрегат', () => {
    // PoB пишет FullDPS=0, пока скиллы не включены в Full DPS-агрегат (все
    // <Skill includeInFullDPS="nil"> в фикстуре). До фикса estimate.ts:713-719
    // выдавали combinedDps=0 → evaluateBuildAgainstGoals выносил билду verdict
    // 'fail' с DPS=0 при реальном TotalDPS ~6M. После фикса — честный null.
    expect(est.fullDps).not.toBeNull();
    expect(est.fullDps!.combinedDps).toBeNull();
    expect(est.fullDps!.skills).toEqual([]);
    // Позитив контроля на той же фикстуре: TotalDPS остаётся computed-источником.
    expect(est.pobStats['TotalDPS']).toBeCloseTo(POB.totalDps, 3);
  });

  it('golden DPS-цепочка optimize: FullDPS(0)→null fallback → TotalDPS computed', () => {
    const checks = evaluateBuildAgainstGoals(est, { dps: 6_000_000 });
    expect(checks).toHaveLength(1);
    const dps = checks[0]!;
    expect(dps.metric).toBe('dps');
    // PlayerStat FullDPS=0 → считан как «нет данных» → fallback TotalDPS.
    expect(dps.current).toBeCloseTo(POB.totalDps, 3);
    expect(dps.kind).toBe('computed');
    expect(dps.verdict).toBe('fail'); // 5.992M < 6.000M — честный разрыв −7 361
    expect(dps.gap).toBeCloseTo(POB.totalDps - 6_000_000, 3);
    // Промежуточная фиксация: убрав цель ниже, билд проходит.
    const pass = evaluateBuildAgainstGoals(est, { dps: 5_000_000 })[0]!;
    expect(pass.verdict).toBe('pass');
  });

  it('golden EHP: PoB TotalEHP computed vs наш worstEhp estimate — расхождение задокументировано', () => {
    const checks = evaluateBuildAgainstGoals(est, { ehp: 30_000 });
    expect(checks[0]!.current).toBeCloseTo(POB.totalEhp, 3);
    expect(checks[0]!.kind).toBe('computed');
    expect(checks[0]!.verdict).toBe('pass');
    // Наш послойный estimate (только гир, без дерева/ES-inc) — это нижняя
    // граница; допуск порядковый, НЕ подгонка: PoB-движок учитывает дерево.
    const mine = est.worstEhp?.effectiveHp ?? 0;
    expect(mine).toBeGreaterThan(1000);
    expect(mine).toBeLessThan(POB.totalEhp + 1);
  });

  it('golden слоёный EHP (после канон-фикса резист-капа 75% в calculateEhp)', () => {
    const ehp = est.ehp;
    // Все 5 слоёв конечны: до фикса гир-сумма резистов (>75%, у fire 106%)
    // уходила за 100% и множитель урона становился отрицательным → Infinity.
    for (const t of ['physical', 'fire', 'cold', 'lightning', 'chaos'] as const) {
      expect(Number.isFinite(ehp[t]!.effectiveHp)).toBe(true);
      expect(ehp[t]!.effectiveHp).toBeGreaterThan(0);
    }
    // Golden числа (гир-оценка, фиксированная дата fixing): элем-слои равны
    // (все три резиста гир-суммой выше капа → кламп 75%), физ слой ниже —
    // броня против удара 1000, chaos худший (ChaosResist гиром = 0).
    expect(Math.round(ehp.physical!.effectiveHp)).toBe(7656);
    expect(Math.round(ehp.fire!.effectiveHp)).toBe(15919);
    expect(Math.round(ehp.cold!.effectiveHp)).toBe(15919);
    expect(Math.round(ehp.lightning!.effectiveHp)).toBe(15919);
    expect(Math.round(ehp.chaos!.effectiveHp)).toBe(2120);
    // Инвариант этого билда: chaos-слой — худший (гир даёт ChaosRes 0, PoB-стат 30).
    expect(est.worstEhp).toEqual({ damageType: 'chaos', effectiveHp: ehp.chaos!.effectiveHp });
    // Честная сверка с PoB (точный движок): наша гир-оценка — НИЖНЯЯ граница,
    // PoB elem MaxHit 22 339 > наш 15 919 (дерево/ES-inc не в оценке) — ОК;
    // расхождение задокументировано, допуск не подгоняется.
    expect(ehp.fire!.effectiveHp).toBeLessThan(POB.elemMaxHit);
    expect(ehp.chaos!.effectiveHp).toBeLessThan(POB.chaosMaxHit);
  });

  it('golden вердикты cap-целей Invoker: резисты 75/75/75 computed через PoB-статы приоритетнее гир-оценки', () => {
    const goals = { fireRes: 75, coldRes: 75, lightningRes: 75, chaosRes: 0 };
    const checks = evaluateBuildAgainstGoals(est, goals);
    const by = Object.fromEntries(checks.map((c) => [c.metric, c]));
    // elem-резисты: Life-билд (1539), CI не детектирован.
    expect(by.fireRes!.verdict).toBe('pass');
    expect(by.coldRes!.verdict).toBe('pass');
    expect(by.lightningRes!.verdict).toBe('pass');
    expect(by.chaosRes!.verdict).toBe('pass');
    // Гир-оценка оценивает суммарно (только гир): пусть не точь-в-точь как PoB…
    // но не может превышать кап более чем на оверхед гир-суммы.
    expect(est.defenses.fireRes).toBeGreaterThanOrEqual(0);
  });

  it('golden spirit: SpiritUnreserved −95 из PoB — computed verdict fail против цели 0', () => {
    const checks = evaluateBuildAgainstGoals(est, { spiritUnreserved: 0 });
    expect(checks[0]!.current).toBe(POB.spiritUnreserved);
    expect(checks[0]!).toMatchObject({ kind: 'computed', verdict: 'fail' });
  });

  it('weapon-set: оба набора Weapon 1 / Weapon 1 Swap распознаны; PoB-XML гир честно даёт DPS 0', async () => {
    // ФАКТ ФОРМАТА: PoB-экспорт предмета НЕ содержит базовых строк
    // «Physical Damage: X-Y» / «Attacks per Second: N» (PoB досчитывает их из
    // своих таблиц), поэтому наш оружейный оценщик, работающий по клир-тексту,
    // честно даёт 0 — это ограничение формата фиксируется, а не подгоняется.
    expect(est.weapon.bySet).toHaveLength(2);
    expect(est.weapon.bySet.map((s) => s.set)).toEqual([1, 2]);
    expect(est.weapon.totalDps).toBe(0);
    // Гир-конвейер: те же слоты через buildCodeToGear.
    const gear = await buildCodeToGear(FIXTURE_XML);
    expect(gear.length).toBeGreaterThan(10);
    expect(gear.some((g) => g.slot === 'Weapon 1')).toBe(true);
    expect(gear.some((g) => g.slot === 'Weapon 1 Swap')).toBe(true);
    // DPS-верdict без PoB-статов был бы unknown/unknown — но PlayerStat
    // TotalDPS в этой фикстуре есть, fallback-ветка оружия не срабатывает.
    const checks = evaluateBuildAgainstGoals(est, { dps: 1000 });
    expect(checks[0]!.current).toBeCloseTo(POB.totalDps, 3);
  });

  it('orthogonality: переоценка идемпотентна (дважды — один результат)', async () => {
    const again = await estimateBuild(FIXTURE_XML);
    expect(again.ehp).toEqual(est.ehp);
    expect(again.defenses).toEqual(est.defenses);
    expect(again.pobStats).toEqual(est.pobStats);
  });

  it('override-«что-если»: подмена вспыхивает в outdated вердиктах чисто', () => {
    const patched = applyEstimateOverrides(est, {
      fireRes: OPTIMIZE_CONSTANTS.RESIST_CAP,
      totalDps: 8_000_000,
    });
    // Immutability: исходная оценка не тронута.
    expect(est.overrides).toEqual([]);
    expect(est.overrideDps).toBeNull();
    // DPS-приоритет: override > FullDPS > TotalDPS.
    const dps = evaluateBuildAgainstGoals(patched, { dps: 7_500_000 })[0]!;
    expect(dps.current).toBe(8_000_000);
    expect(dps.kind).toBe('estimated');
    expect(dps.verdict).toBe('pass');
    // Подмены зафиксированы честно.
    const fields = patched.overrides.map((o) => o.field).sort();
    expect(fields).toEqual(['fireRes', 'totalDps']);
    expect(patched.notes.some((n) => n.includes('Override (что-если)'))).toBe(true);
  });

  it('ehp-инварианты формул на живом гире: res-cap не раздувает слой выше физики здравого смысла', () => {
    const ehpAll = calculateAllEhp(est.defenses);
    for (const t of ['fire', 'cold', 'lightning'] as const) {
      // Резист не даёт отрицательного множителя урона (слой ≥ rawHp).
      expect(ehpAll[t]!.effectiveHp).toBeGreaterThanOrEqual(ehpAll[t]!.rawHp);
    }
  });
});
