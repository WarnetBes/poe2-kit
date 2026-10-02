import { describe, it, expect } from 'vitest';
import {
  toBuildPlanner,
  buildPlannerFilename,
  clearBuildPlannerCache,
} from '../src/buildPlanner.js';
import type { BuildImport } from '../src/types.js';

/** Эталонный кейс: Invoker, числовой PoB-id узла «The Soul Springs Eternal». */
const MONK_BUILD: BuildImport = {
  source: 'pob',
  class: 'Monk',
  ascendancy: 'Invoker',
  level: 48,
  // 63236 = AscendancyMonk2Notable9 (The Soul Springs Eternal, PoB TreeData 0_5)
  passiveNodes: ['63236', 'melee17', '999999999'],
  skills: ['Ice Strike', 'Rapid Attacks I'],
  skillGroups: [
    {
      label: 'Weapon 1',
      enabled: true,
      gems: [
        { name: 'Ice Strike', level: 20, quality: null },
        { name: 'Rapid Attacks I', level: 1, quality: null },
      ],
    },
  ],
  gear: { 'Weapon 1': 'Sinister Quarterstaff' },
};

describe('toBuildPlanner', () => {
  it('конвертирует асценданси в код формата («Invoker» → «Monk2»)', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    expect(res.build.ascendancy).toBe('Monk2');
  });

  it('мапит числовые PoB-id узлов в GGG-slug и пропускает существующие slug-и', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    expect(res.build.passives).toContain('AscendancyMonk2Notable9');
    expect(res.build.passives).toContain('melee17');
    // неизвестный id не попадает в файл, а попадает в warnings
    expect(res.build.passives).not.toContain('999999999');
    expect(res.warnings.some((w) => w.includes('999999999'))).toBe(true);
  });

  it('мапит имена камней в Metadata-пути, саппорты — в support_skills', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    expect(res.build.skills).toEqual([
      {
        id: 'Metadata/Items/Gems/SkillGemIceStrike',
        support_skills: ['Metadata/Items/Gems/SupportGemMartialTempo'],
      },
    ]);
  });

  it('даёт валидный JSON c обязательным name', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    const parsed = JSON.parse(res.json) as Record<string, unknown>;
    expect(parsed.name).toContain('Invoker');
    expect(Array.isArray(parsed.passives)).toBe(true);
    expect(Array.isArray(parsed.skills)).toBe(true);
  });

  it('уникаль из gearItems идёт unique_name, рар — additional_text с номерами модов', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD, {
      gearItems: [
        {
          slot: 'Weapon 1',
          name: 'Sinister Quarterstaff',
          itemText: 'Rarity: Unique\nSinarat\nSinister Quarterstaff\n--------\nGrants Skill: X',
        },
        {
          slot: 'Helm',
          name: 'Frost Cowl',
          itemText: 'Rarity: Rare\nFrost Cowl\nTeddie Cap\n--------\n+20 to maximum Life\nItem Level: 40',
        },
      ],
    });
    expect(res.build.inventory_slots).toEqual([
      { inventory_id: 'Weapon1', unique_name: 'Sinarat' },
      {
        inventory_id: 'Helm1',
        additional_text: 'Frost Cowl\n1. +20 to maximum Life',
      },
    ]);
  });

  it('без gearItems предупреждает, что gear не экспортирован', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    expect(res.build.inventory_slots).toBeUndefined();
    expect(res.warnings.some((w) => w.includes('inventory_slots'))).toBe(true);
  });
});

describe('buildPlannerFilename', () => {
  it('санирует запрещённые символы и добавляет .build', () => {
    expect(buildPlannerFilename('Invoker: Ice <Strike>?')).toBe('Invoker Ice Strike.build');
    expect(buildPlannerFilename('')).toBe('build.build');
  });
});
