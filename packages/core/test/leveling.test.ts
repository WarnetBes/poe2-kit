import { describe, it, expect } from 'vitest';
import type { LevelingZone } from '../src/types.js';
import {
  LEVELING_ZONES,
  INTERLUDES,
  ACT_REWARDS,
  buildLevelingPlan,
  getLevelingPlan,
  nextZones,
  rewardsOf,
  levelDiff,
  resolveLevelingClass,
  getClassLevelingTips,
} from '../src/leveling.js';

/**
 * Сайд-зоны («Optional Area!» по PoL-2): monsterLevel вне прогрессии mainline,
 * поэтому инвариант монотонности на них не проверяется. Любая ДРУГАЯ зона
 * с убывающим уровнем — баг данных (аудит S3).
 */
const OPTIONAL_ZONES = new Set(LEVELING_ZONES.filter((z) => z.optional).map((z) => z.zone));

describe('leveling: данные LEVELING_ZONES', () => {
  it('ИНВАРИАНТ: monsterLevel внутри mainline-акта не убывает', () => {
    const violations: string[] = [];
    let prevAct = -1;
    let prevLvl = -Infinity;
    for (const z of LEVELING_ZONES) {
      if (z.optional) continue; // сайд-зоны вне mainline-прогрессии
      if (z.act !== prevAct) {
        prevAct = z.act;
        prevLvl = z.monsterLevel;
        continue;
      }
      if (z.monsterLevel < prevLvl) {
        violations.push(
          `Акт ${z.act}: "${z.zone}" (lvl ${z.monsterLevel}) после зоны с lvl ${prevLvl}`,
        );
      }
      prevLvl = Math.max(prevLvl, z.monsterLevel);
    }
    expect(violations).toEqual([]);
  });

  it('известные сайд-зоны явно помечены optional (зафиксировано аудитом S3)', () => {
    expect([...OPTIONAL_ZONES]).toEqual(["Plunder's Point"]);
  });

  it('акты идут в порядке 1→4, mainline-хвосты монотонны на стыках', () => {
    const acts = [...new Set(LEVELING_ZONES.map((z) => z.act))];
    expect(acts).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < 3; i++) {
      const endPrev = LEVELING_ZONES.filter((z) => z.act === i && !z.optional).at(-1)!;
      const startNext = LEVELING_ZONES.find((z) => z.act === i + 1 && !z.optional)!;
      expect(startNext.monsterLevel).toBeGreaterThanOrEqual(endPrev.monsterLevel);
    }
    // стык 4→интерлюдии не проверяем: интерлюдии не в LEVELING_ZONES
  });

  it('интерлюдии: 3 штуки, P-коды PoL-2, у каждой есть награды', () => {
    expect(INTERLUDES.map((i) => i.zoneCode)).toEqual(['P1_Town', 'P2_Town', 'P3_Town']);
    expect(INTERLUDES.every((i) => i.rewards.length > 0)).toBe(true);
  });
});

describe('leveling: buildLevelingPlan / getLevelingPlan', () => {
  const plan = buildLevelingPlan();

  it('план покрывает все зоны и консистентен с кэшем', () => {
    expect(plan).toHaveLength(LEVELING_ZONES.length);
    expect(getLevelingPlan()).toBe(getLevelingPlan()); // кэш
    expect(getLevelingPlan()).toHaveLength(LEVELING_ZONES.length);
  });

  it('mainline-зоны ссылаются на следующую MAINLINE-зону (сайд-зоны пропускаются)', () => {
    for (let i = 0; i < plan.length; i++) {
      const z = plan[i]!;
      if (z.optional) continue;
      const nextMainline = plan.slice(i + 1).find((p) => !p.optional);
      const joined = z.steps.join(' ');
      if (nextMainline) {
        expect(joined).toContain(`Следующая зона: ${nextMainline.zone}`);
      } else {
        // последняя mainline-зона — терминальный шаг без «Следующая зона»
        expect(joined).not.toContain('Следующая зона');
        expect(joined).toContain('Финальный босс Акта — Тавакай');
      }
    }
  });

  it('сайд-зона помечена optional и не зовётся «следующей» (фикс S3)', () => {
    const plunder = plan.find((z) => z.zone === "Plunder's Point")!;
    expect(plunder.optional).toBe(true);
    expect(plunder.steps.join(' ')).not.toContain('Следующая зона');
    expect(plunder.steps.join(' ')).not.toContain('Тавакай');
    // Heart of the Tribe — финал акта, а не Plunder's Point:
    const heart = plan.find((z) => z.zone === 'Heart of the Tribe')!;
    expect(heart.steps.join(' ')).toContain('Финальный босс Акта — Тавакай');
    expect(heart.steps.join(' ')).not.toContain("Plunder's Point");
  });

  it('план передаёт optional-флаг каждой зоне', () => {
    for (let i = 0; i < plan.length; i++) {
      expect(plan[i]!.optional).toBe(LEVELING_ZONES[i]!.optional || undefined);
    }
  });

  it('награды плана совпадают с rewardsOf по каждой зоне', () => {
    for (const z of plan) {
      expect(z.rewards).toEqual(rewardsOf(z.zone));
    }
  });
});

describe('leveling: rewardsOf', () => {
  it('Clearfell — награда Beira: 10% Cold Res', () => {
    expect(rewardsOf('Clearfell')).toContain('10% Cold Res');
  });

  it('поиск независим от регистра', () => {
    expect(rewardsOf('clearfell')).toEqual(rewardsOf('Clearfell'));
  });

  it('каждая зона из ACT_REWARDS резолвится (зоны наград валидны)', () => {
    for (const r of ACT_REWARDS) {
      expect(rewardsOf(r.zone)).toContain(r.reward);
    }
  });

  it('неизвестная зона → пусто', () => {
    expect(rewardsOf('No Such Zone')).toEqual([]);
  });
});

describe('leveling: nextZones', () => {
  it('старт Акта 1: текущая + 2 следующие зоны подряд', () => {
    const next = nextZones(1, 'The Riverbank');
    expect(next.map((z) => z.zone)).toEqual([
      'The Riverbank',
      'Clearfell',
      'Mud Burrow',
    ]);
  });

  it('без currentZone: первые зоны акта', () => {
    const next = nextZones(4);
    expect(next[0]!.zone).toBe('Isle of Kin');
    expect(next).toHaveLength(3);
  });

  it('середина Акта 3: три подряд идущие зоны из LEVELING_ZONES', () => {
    const idx = LEVELING_ZONES.findIndex((z) => z.zone === 'Utzaal');
    const expected = LEVELING_ZONES.slice(idx, idx + 3).map((z) => z.zone);
    expect(nextZones(3, 'Utzaal').map((z) => z.zone)).toEqual(expected);
  });

  it('последняя зона акта не выпадает в соседний акт', () => {
    const lastAct1 = LEVELING_ZONES.filter((z) => z.act === 1).at(-1)!;
    const next = nextZones(1, lastAct1.zone);
    for (const z of next) expect(z.act).toBe(1);
  });

  it('ФИКС S3: финал Акта 4 не предлагает сайд-зону ниже уровнем', () => {
    const next = nextZones(4, 'Heart of the Tribe');
    expect(next.map((z) => z.zone)).toEqual(['Heart of the Tribe']);
    expect(next.some((z) => z.zone === "Plunder's Point")).toBe(false);
  });

  it('сайд-зона сама по себе: без mainline-«следующих» из соседних актов', () => {
    const next = nextZones(4, "Plunder's Point");
    expect(next.map((z) => z.zone)).toEqual(["Plunder's Point"]);
  });

  it('монотонность подсказок: «следующие» не ниже текущей зоны уровнем', () => {
    for (const z of LEVELING_ZONES.filter((z) => !z.optional)) {
      const next = nextZones(z.act, z.zone);
      for (const n of next.slice(1)) {
        expect(n.monsterLevel).toBeGreaterThanOrEqual(z.monsterLevel);
      }
    }
  });

  it('несуществующая зона акта → fallback на акт и выше', () => {
    const next = nextZones(3, 'Ghost Zone');
    expect(next.at(0)!.act).toBe(3);
    expect(next.map((z) => z.act)).toEqual([...next].sort((a, b) => a - b).map((z) => z.act));
  });
});

describe('leveling: прочее', () => {
  it('levelDiff = уровень игрока − monsterLevel', () => {
    const zone: LevelingZone = {
      act: 1,
      actName: 'Акт 1',
      zone: 'Test',
      monsterLevel: 30,
      steps: [],
      rewards: [],
    };
    expect(levelDiff(35, zone)).toBe(5);
  });

  it('resolveLevelingClass: асценданси → базовый класс', () => {
    expect(resolveLevelingClass('Invoker')?.baseClass).toBe('Monk');
    expect(resolveLevelingClass('invoker')?.baseClass).toBe('Monk');
    expect(resolveLevelingClass('Lich')?.baseClass).toBe('Witch');
    expect(resolveLevelingClass('Monk')?.baseClass).toBe('Monk');
    expect(resolveLevelingClass(null)).toBeNull();
    expect(resolveLevelingClass('Нет такого')).toBeNull();
  });

  it('getClassLevelingTips: фильтрация по диапазону уровней', () => {
    const monk12 = getClassLevelingTips('Monk', 12);
    expect(monk12.length).toBeGreaterThan(0);
    for (const t of monk12) {
      expect(12).toBeGreaterThanOrEqual(t.fromLevel);
      if (t.toLevel != null) expect(12).toBeLessThanOrEqual(t.toLevel);
    }
    expect(getClassLevelingTips('Invoker', 3)[0]!.gems).toContain('Ice Strike');
  });
});
