import { describe, it, expect } from 'vitest';
import { getInvokerGuide, getInvokerStage, getNextInvokerStage } from '../src/invokerGuide.js';

/**
 * P8 ч.2 (№281-W2): invoker_leveling.json — слияние poe2-leveling (MIT) +
 * builds_roadmap.md (КУБ-1) в зонно-этапный датасет. Инварианты против
 * рассинхрона данных и «без дублей» (гемы — в MONK_LEVELING_TIPS).
 */
describe('invokerGuide (P8, №281-W2)', () => {
  it('датасет: 4 этапа, границы 1-30/30-60/60-80/80-95 без дыр и перекрытий', () => {
    const g = getInvokerGuide();
    expect(g.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4]);
    expect(g.stages[0]!.levelRange).toEqual([1, 30]);
    expect(g.stages[1]!.levelRange).toEqual([30, 60]);
    expect(g.stages[2]!.levelRange).toEqual([60, 80]);
    expect(g.stages[3]!.levelRange).toEqual([80, 95]);
    // смежность: конец этапа == начало следующего (переходные уровни принадлежат обоим — резолвит getInvokerStage по порядку)
    for (let i = 1; i < g.stages.length; i++) {
      expect(g.stages[i]!.levelRange[0]).toBe(g.stages[i - 1]!.levelRange[1]);
    }
  });

  it('билд-карточка: Invoker/Monk, Ice Strike, CI, эталон PoB 28880, таргеты на месте', () => {
    const b = getInvokerGuide().build;
    expect(b.ascendancy).toBe('Invoker');
    expect(b.mainSkill).toBe('Ice Strike');
    expect(b.pobRef).toContain('28880');
    expect(b.targets.totalDps).toBeGreaterThan(400000);
    expect(b.targets.es).toBeGreaterThan(8000);
    expect(b.targets.critChancePct).toBeGreaterThan(75);
  });

  it('этап 3 несёт CI-гейт; в остальных его нет', () => {
    const g = getInvokerGuide();
    expect(g.stages.find((s) => s.stage === 3)!.ciGate).toContain('ES >= 2.5-3x');
    for (const s of g.stages.filter((s) => s.stage !== 3)) {
      expect(s.ciGate).toBeUndefined();
    }
  });

  it('атрибутция: MIT poe2-leveling и builds_roadmapdeclared в _meta.sources', () => {
    const srcs = getInvokerGuide()._meta.sources;
    expect(srcs.some((s) => s.license === 'MIT' && s.name.includes('poe2-leveling'))).toBe(true);
    expect(srcs.some((s) => /builds_roadmap/i.test(s.name || s.path))).toBe(true);
  });

  it('этап 2 يذكر Plunder\'s Point (кросс-ссылка на P8 ч.1)', () => {
    const s2 = getInvokerGuide().stages.find((s) => s.stage === 2)!;
    expect(s2.theme).toContain("Plunder's Point");
  });

  it('getInvokerStage: резолв по уровню, границы включительно', () => {
    expect(getInvokerStage(1)?.stage).toBe(1);
    expect(getInvokerStage(27)?.stage).toBe(1); // наш PandarenDeepRover
    expect(getInvokerStage(30)?.stage).toBe(1); // граница: первый подходящий
    expect(getInvokerStage(31)?.stage).toBe(2);
    expect(getInvokerStage(45)?.stage).toBe(2);
    expect(getInvokerStage(60)?.stage).toBe(2);
    expect(getInvokerStage(75)?.stage).toBe(3);
    expect(getInvokerStage(95)?.stage).toBe(4);
    expect(getInvokerStage(120)?.stage).toBe(4); // за 95 — финальный
    expect(getInvokerStage(0)?.stage).toBe(1); // до 1 — стартовый
  });

  it('getInvokerStage(null) — первый этап; getNextInvokerStage — цепочка 1→2→3→4→null', () => {
    expect(getInvokerStage(null)?.stage).toBe(1);
    expect(getNextInvokerStage(1)?.stage).toBe(2);
    expect(getNextInvokerStage(2)?.stage).toBe(3);
    expect(getNextInvokerStage(3)?.stage).toBe(4);
    expect(getNextInvokerStage(4)).toBeNull();
  });

  it('этап 4: целевые слоты PoB (шлем/перчатки/амулет — ключевые мультипликаторы)', () => {
    const s4 = getInvokerGuide().stages.find((s) => s.stage === 4)!;
    expect(Object.keys(s4.gearSlots!)).toContain('helmet');
    expect(s4.gearSlots!.gloves).toContain('+2 Melee Skills');
    expect(s4.gearSlots!.amulet).toContain('+3 Melee Skills');
  });
});
