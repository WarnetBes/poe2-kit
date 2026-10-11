import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toBuildPlanner,
  buildPlannerFilename,
  clearBuildPlannerCache,
  validateBuildPlanner,
} from '../src/buildPlanner.js';
import { importBuild } from '../src/build.js';
import type { BuildImport } from '../src/types.js';

const FIXTURES_KEYBINDS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'keybinds');

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

  it('мапит имена камней в Metadata-пути, саппорты — в support_skills, level_interval — из датасета (E7)', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    expect(res.build.skills).toEqual([
      {
        id: 'Metadata/Items/Gems/SkillGemIceStrike',
        // Ice Strike L20 → требование ступени из skill_gems_v2 (req@L20 = 90)
        level_interval: [90, 100],
        support_skills: ['Metadata/Items/Gems/SupportGemMartialTempo'],
      },
    ]);
  });

  it('level_interval гейта: гем L20 без данных уровня — по уровню открытия из датасета', () => {
    clearBuildPlannerCache();
    const legacy = { ...MONK_BUILD, skillGroups: undefined };
    const res = toBuildPlanner(legacy);
    // Легаси-ветка: уровень гема неизвестен → первый req>0 (Ice Strike: 0,0,…→ уровень открытия).
    const ice = res.build.skills!.find((s) => /IceStrike$/.test(s.id))!;
    expect(ice.level_interval?.[1]).toBe(100);
    expect(ice.level_interval![0]).toBeGreaterThanOrEqual(1);
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

  it('без gearItems предупреждает, что gear не экспортирован (слоты — пустой массив)', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    // SCHEMA v1: ключ обязателен — пишем пустой массив, а не пропускаем.
    expect(res.build.inventory_slots).toEqual([]);
    expect(res.warnings.some((w) => w.includes('inventory_slots'))).toBe(true);
  });

  it('эмиттит все шесть обязательных ключей SCHEMA v1', () => {
    clearBuildPlannerCache();
    const res = toBuildPlanner(MONK_BUILD);
    const b = res.build as unknown as Record<string, unknown>;
    for (const key of ['author', 'ascendancy', 'name', 'inventory_slots', 'passives', 'skills']) {
      expect(key in b).toBe(true);
    }
    expect(typeof b.author).toBe('string');
  });
});

// ── Валидатор (гейт до записи: игра на малформ отвечает молчаливым отказом) ──

describe('validateBuildPlanner', () => {
  it('валидный экспорт эталона 28880 проходит валидацию (e2e)', async () => {
    const xml = readFileSync(join(FIXTURES_KEYBINDS, 'pob_28880.xml'), 'utf8');
    const imported = await importBuild(xml);
    const res = toBuildPlanner(imported, {});
    const v = validateBuildPlanner(res.json);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
    expect(res.build.ascendancy).toBe('Monk2');
    expect(res.build.passives!.length).toBeGreaterThan(0);
    expect(res.build.skills!.length).toBeGreaterThan(0);
  }, 30000);

  it('битый JSON ловится как error', () => {
    const v = validateBuildPlanner('{"name": "x", ошибка');
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toContain('битый JSON');
  });

  it('отсутствие обязательных ключей и пустое name — errors', () => {
    const v = validateBuildPlanner({ name: '   ' });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('«author»'))).toBe(true);
    expect(v.errors.some((e) => e.includes('«ascendancy»'))).toBe(true);
    expect(v.errors.some((e) => e.includes('name'))).toBe(true);
    expect(v.errors.some((e) => e.includes('«inventory_slots»'))).toBe(true);
  });

  it('слот без unique_name/additional_text и пассивка без id — errors', () => {
    const v = validateBuildPlanner({
      author: 'a',
      ascendancy: 'Monk2',
      name: 'n',
      inventory_slots: [{ inventory_id: 'Weapon1' }],
      passives: [{ additional_text: 'x' }, 'melee17'],
      skills: [{ id: 'Metadata/Items/Gems/SkillGemIceStrike', support_skills: [] }],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('inventory_slots[0]: нет ни unique_name'))).toBe(true);
    expect(v.errors.some((e) => e.includes('passives[0]: нет id'))).toBe(true);
  });

  it('невалидный shape асценданси — error; длинное name и пустые секции — warnings', () => {
    const v = validateBuildPlanner({
      author: 'a',
      ascendancy: 'Invoker',
      name: 'очень длинное имя билда которое игра обрежет в display',
      inventory_slots: [],
      passives: [],
      skills: [],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('ascendancy'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('40 симв'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('passives пуст'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('skills пуст'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('inventory_slots пуст'))).toBe(true);
  });

  it('неизвестный код асценданси валидного shape — warning, не error', () => {
    const v = validateBuildPlanner({
      author: 'a',
      ascendancy: 'Zzz9',
      name: 'n',
      inventory_slots: [],
      passives: [],
      skills: [],
    });
    expect(v.valid).toBe(true);
    expect(v.warnings.some((w) => w.includes('Zzz9'))).toBe(true);
  });

  it('скилл с support_skills не-массивом и битым level_interval — errors', () => {
    const v = validateBuildPlanner({
      author: 'a',
      ascendancy: 'Monk2',
      name: 'n',
      inventory_slots: [{ inventory_id: 'Weapon1', unique_name: 'X' }],
      passives: [],
      skills: [{ id: 'Metadata/Items/Gems/SkillGemIceStrike', support_skills: 'nope', level_interval: [1] }],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('support_skills — массив'))).toBe(true);
    expect(v.errors.some((e) => e.includes('level_interval'))).toBe(true);
  });
});

describe('buildPlannerFilename', () => {
  it('санирует запрещённые символы и добавляет .build', () => {
    expect(buildPlannerFilename('Invoker: Ice <Strike>?')).toBe('Invoker Ice Strike.build');
    expect(buildPlannerFilename('')).toBe('build.build');
  });
});
