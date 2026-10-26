import { describe, expect, it } from 'vitest';
import { composeBuild } from '../src/buildComposer.js';
import type { LadderRow } from '../src/ladder.js';
import { monsterStats, ENEMY_CONSTANTS } from '../src/enemy.js';
import { OPTIMIZE_CONSTANTS } from '../src/optimize.js';
import { getBaseItems, getMetaSupports } from '../src/dataset.js';

/**
 * Тесты build composer (№497, паттерн poe2-build-mcp MIT):
 *  - дисциплина starterBuilds.ts:149/:176 — unknown класс → null, не заглушка;
 *  - слоты скелета = настоящие white-base из base_items.json (ничего не выдумано);
 *  - саппорты к main-скиллу совместимы (compatible_with офлайн-датасета);
 *  - числа capTargets выводятся только из таблиц канона (enemy/resources/estimate);
 *  - userBuildCode управляет main-скиллом и даёт вердикты движка (goalChecks);
 *  - честный null там, где данных нет (unverified-хвост, dpsGoal без ладдера).
 */

/** Ладдер-фикстура «Invoker»: Ice Strike чаще, чем Falling Thunder. */
const LADDER: LadderRow[] = [
  { name: 'A', level: 96, classLabel: 'Invoker', skills: ['Ice Strike', 'Herald of Ice'], keypassives: ['I am the Thunder'], 'dps.total': '900k', 'ehp__str': '18k' },
  { name: 'B', level: 95, classLabel: 'Invoker', skills: ['Ice Strike'], keypassives: [], 'dps.total': '600k', 'ehp__str': '14k' },
  { name: 'C', level: 94, classLabel: 'Invoker', skills: ['Falling Thunder'], keypassives: [], 'dps.total': '300k', 'ehp__str': '12k' },
  { name: 'D', level: 93, classLabel: 'Invoker', skills: [], keypassives: [], 'dps.total': '1.2m', 'ehp__str': '20k' },
];

/** PoB-билд юзера: socket-group с Ice Strike + саппорт (шаблон №141 combocode). */
const USER_XML = [
  '<PathOfBuilding>',
  '<Build level="95" className="Monk" ascendClassName="Invoker" mainSocketGroup="1">',
  '<PlayerStat stat="Life" value="1539"/>',
  '<PlayerStat stat="TotalDPS" value="900000"/>',
  '<PlayerStat stat="TotalEHP" value="20000"/>',
  '</Build>',
  '<Skills>',
  '<SkillSet id="1">',
  '<Skill enabled="true" label="Ice Strike" mainActiveSkill="1">',
  '<Gem nameSpec="Ice Strike" level="20" quality="0" count="1" enabled="true"/>',
  '<Gem nameSpec="Martial Tempo" level="20" quality="0" count="1" enabled="true"/>',
  '</Skill>',
  '</SkillSet>',
  '</Skills>',
  '</PathOfBuilding>',
].join('\n');

describe('№497: composeBuild — дисциплина и честность', () => {
  it('unknown класс → null (дисциплина starterBuilds:149/:176)', async () => {
    expect(await composeBuild({ classQuery: 'NoSuchClass' })).toBeNull();
    expect(await composeBuild({ classQuery: '' })).toBeNull();
  });

  it('класс резолвится и по асценданси (Invoker → Monk)', async () => {
    const res = await composeBuild({ classQuery: 'Invoker', ladderRows: LADDER });
    expect(res).not.toBeNull();
    expect(res!.className).toBe('Monk');
    expect(res!.classQuery).toBe('Invoker');
  });
});

describe('№497: скелет — только данные датасетов', () => {
  it('слоты:(slot, base) из base_items.json, PoB-имена слотов', async () => {
    const res = await composeBuild({ classQuery: 'Monk', ladderRows: LADDER });
    expect(res!.slots.length).toBeGreaterThan(5);
    const names = new Set(getBaseItems().map((b) => b.name));
    for (const s of res!.slots) {
      expect(names.has(s.base)).toBe(true); // white-base — настоящий, не выдуманный
      expect(s.itemText).toContain(s.base);
    }
    expect(res!.weapon.weapon).toBe('Quarterstaves');
  });

  it('main-скилл из ладдера = самый частый ( Ice Strike ), саппорты совместимы', async () => {
    const res = await composeBuild({ classQuery: 'Monk', ladderRows: LADDER });
    expect(res!.mainSkill).toBe('Ice Strike');
    expect(res!.mainSkillSource).toBe('ladder');
    expect(res!.skillSharePercent).toBe(50); // 2 из 4 строк
    expect(res!.popularSkills[0]).toEqual({ name: 'Ice Strike', count: 2, sharePercent: 50 });
    if (res!.supports.length) {
      // Саппорты взяты из meta_supports.json (кураторский эталон меты) — сверяем
      // с той же записью датасета: ничего сверх датасета composer не добавляет.
      const meta = getMetaSupports()?.entries?.['ice strike']?.[0]?.supports ?? [];
      for (const s of res!.supports) {
        expect(s.tier).toBe('meta');
        expect(meta).toContain(s.en);
      }
    } else {
      expect(res!.unverified.some((u) => u.includes('саппорты'))).toBe(true);
    }
  });

  it('skillHint перекрывает цепочку; без ладдера/гайда честные хвосты', async () => {
    const res = await composeBuild({ classQuery: 'Monk', skillHint: 'Falling Thunder' });
    expect(res!.mainSkill).toBe('Falling Thunder');
    expect(res!.mainSkillSource).toBe('hint');
    expect(res!.capTargets.dpsGoal).toBeNull(); // DPS-цель не выводится из таблиц
    expect(res!.unverified.some((u) => u.includes('DPS-цель'))).toBe(true);
  });

  it('№619: skillHint канонизируется по датасету гемов (регистр)', async () => {
    const res = await composeBuild({ classQuery: 'Monk', skillHint: 'ice strike' });
    expect(res!.mainSkill).toBe('Ice Strike'); // каноничное имя из skill_gems, не сырой hint
    expect(res!.mainSkillSource).toBe('hint');
    expect(res!.unverified.some((u) => u.includes('skillHint'))).toBe(false); // точное попадание — без пометки
  });

  it('№619: неизвестный skillHint не молчит — честная строка в unverified', async () => {
    const res = await composeBuild({ classQuery: 'Monk', skillHint: 'Zzz Fake Skill' });
    expect(res!.mainSkill).toBe('Zzz Fake Skill'); // выбор пользователя не подменяем
    expect(res!.mainSkillSource).toBe('hint');
    expect(res!.unverified.some((u) => u.includes('skillHint «Zzz Fake Skill»') && u.includes('не найден в датасете гемов'))).toBe(true);
    // фолбэк на ладдер НЕ сработал: hint остался main-скиллом даже мимо датасета
    expect(res!.mainSkill).not.toBe('Ice Strike');
  });
});

describe('№497: числа capTargets — только из таблиц канона', () => {
  it('resistCap/baseLifePool/ehpGoal совпадают с каноном', async () => {
    const res = await composeBuild({ classQuery: 'Monk', level: 90, ladderRows: LADDER });
    expect(res!.level).toBe(90);
    expect(res!.capTargets.resistCap).toBe(75); // DEFENSE_CONSTANTS.RESISTANCE_CAP
    // baseLifePool = resources.maxLife(90) = 12*90+16 (canon)
    expect(res!.capTargets.baseLifePool).toBe(12 * 90 + 16);
    // ehpGoal = monsterStats(84).damage × 1.5 × 3 (enemy.ts + PINNACLE_EHP_HITS)
    const expectEhp = Math.round(
      monsterStats(84).damage * ENEMY_CONSTANTS.MONSTER_DAMAGE_FACTOR * OPTIMIZE_CONSTANTS.PINNACLE_EHP_HITS,
    );
    expect(res!.capTargets.ehpGoal).toBe(expectEhp);
    // dpsGoal = медиана 'dps.total' ладдера (600k+900k)/2 = 750k
    expect(res!.capTargets.dpsGoal).toBe(750000);
  });
});

describe('№497: userBuildCode — верификация движком', () => {
  it('main-скилл берётся из билда юзера, goalChecks дают вердикты', async () => {
    const res = await composeBuild({ classQuery: 'Monk', userBuildCode: USER_XML, ladderRows: LADDER });
    expect(res!.mainSkill).toBe('Ice Strike');
    expect(res!.mainSkillSource).toBe('user');
    expect(res!.goalChecks).not.toBeNull();
    const dps = res!.goalChecks!.find((g) => g.metric === 'dps')!;
    expect(dps.current).toBe(900000);
    expect(dps.kind).toBe('computed');
    expect(dps.verdict).toBe('pass'); // 900k ≥ медианы 750k
    const ehp = res!.goalChecks!.find((g) => g.metric === 'ehp')!;
    expect(ehp.verdict).toBe('pass'); // 20000 ≥ цели
  });

  it('budget map: ssf → starter-стадия curated-гайда', async () => {
    const res = await composeBuild({ classQuery: 'Monk', budget: 'ssf' });
    // Гайд по классу есть в data-файле — стадия резолвится; цена либо строка, либо честно null.
    if (res!.budgetStage != null) {
      expect(['starter', 'mid', 'main', 'max']).toContain(res!.budgetStage);
      if (res!.budgetCost == null) {
        expect(res!.unverified.some((u) => u.includes('не опубликована'))).toBe(true);
      }
    } else {
      expect(res!.unverified.some((u) => u.includes('curated-гайда'))).toBe(true);
    }
  });
});
