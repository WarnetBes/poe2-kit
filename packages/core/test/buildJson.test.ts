/**
 * E6 (мастер-план §3): углубление parseBuildJson — .build-парсер до уровня
 * PoB-XML: skillGroups с support_skills (Metadata-путь → display-имя),
 * level_interval, weapon_set пассивок, unique/rare-shape gear.
 * Фикстуры — реальные .build из корпуса Tincture (MIT), 4 показательных файла.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { importBuild } from '../src/build.js';

const FIX = 'test/fixtures/build/';
const FILES = readdirSync(FIX).filter((f) => f.endsWith('.build'));

describe('E6: importBuild(.build JSON) — реальные фикстуры Tincture', () => {
  it('4 фикстуры на месте', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FILES.map((f) => [f]))('%s: полный разбор без потерь', async (file) => {
    const b = await importBuild(readFileSync(FIX + file, 'utf8'));
    expect(b.source).toBe('build');
    expect(b.passiveNodes.length).toBeGreaterThan(50); // реальные прогрессии
    expect(b.skillGroups).toBeTruthy();
    expect(b.skillGroups!.length).toBeGreaterThan(5);
    // Имена резолвятся: ни один гем не остался Metadata-путём.
    for (const g of b.skillGroups!) {
      for (const gem of g.gems) {
        expect(gem.name).toBeTruthy();
        expect(gem.name).not.toMatch(/^Metadata\//);
      }
      expect(g.gems.length).toBeGreaterThanOrEqual(1); // активный минимум
    }
    // У каждой группы первый гем — активный, саппорты после (SCHEMA-структура).
    expect(b.skills.length).toBe(b.skillGroups!.length);
  });

  it('abyssal-lich: Witch3b, weapon_set на 46 пассивках', async () => {
    const b = await importBuild(readFileSync(FIX + 'tincture_abyssal_lich.build', 'utf8'));
    expect(b.ascendancy).toBe('Witch3b');
    expect(b.passiveWeaponSets).toBeTruthy();
    expect(Object.keys(b.passiveWeaponSets!).length).toBe(46);
    for (const v of Object.values(b.passiveWeaponSets!)) expect([1, 2]).toContain(v);
    // weapon_set-узлы не дублируются в passiveNodes
    expect(b.passiveNodes.length).toBe(160);
  });

  it('martial-artist-3: Gem/(sing)+Gems/ микс — сегменты сохранены, имена резолвлены', async () => {
    const b = await importBuild(readFileSync(FIX + 'tincture_martial_artist_3.build', 'utf8'));
    expect(b.ascendancy).toBe('Monk1');
    // первый скилл — Tornado Shot с 5 саппортами (факт фикстуры)
    const g0 = b.skillGroups![0]!;
    expect(g0.gems.length).toBe(6); // активный + 5 support_skills
    expect(g0.gems[0]!.name).not.toMatch(/^Metadata\//);
    expect(g0.gems[0]!.levelInterval).toEqual([84, 100]); // level_interval сохранён
    expect(g0.gems[1]!.levelInterval).toEqual([1, 100]);
    expect(b.passiveWeaponSets).toBeUndefined(); // weapon_set нет в этом .build
  });

  it('gear: unique_name и additional_text (rare-shape) оба попадают', async () => {
    const b = await importBuild(readFileSync(FIX + 'tincture_pathfinder.build', 'utf8'));
    // pathfinder: 4 уникаля + 5 rares с additional_text (факт фикстуры)
    const vals = Object.values(b.gear);
    const named = vals.filter((v) => v.trim().length > 0);
    expect(named.length).toBeGreaterThanOrEqual(9);
    // rare-shape: additional_text начинается с базового имени + «1. …» аффиксы
    expect(vals.some((v) => /^[\s\S]*\n1\. /.test(v))).toBe(true);
  });
});

describe('E6: parseBuildJson — юнит-объекты', () => {
  const build = (over: object) =>
    importBuild(
      JSON.stringify({
        name: 't',
        author: 'a',
        ascendancy: 'Monk1',
        passives: [{ id: 'criticals45' }, { id: 'melee17', weapon_set: 2 }, 'plain-slug'],
        skills: [],
        inventory_slots: [],
        ...over,
      }),
    );

  it('легаси: строки-пассивки и строка-объект оба читаются', async () => {
    const b = await build({});
    expect(b.passiveNodes).toEqual(['criticals45', 'melee17', 'plain-slug']);
    expect(b.passiveWeaponSets).toEqual({ melee17: 2 });
  });

  it('скилл без support_skills — группа из одного активного', async () => {
    const b = await build({
      skills: [{ id: 'Metadata/Items/Gems/SkillGemWhirlingAssault', level_interval: [10, 100] }],
    });
    expect(b.skills).toEqual(['Whirling Assault']);
    expect(b.skillGroups![0]!.gems).toEqual([
      { name: 'Whirling Assault', level: null, quality: null, levelInterval: [10, 100] },
    ]);
  });

  it('неизвестный Metadata-путь — хвост пути как имя, без выдумывания', async () => {
    const b = await build({
      skills: [
        { id: 'Metadata/Items/Gems/SupportGemSomethingNew', support_skills: [{ id: 'Metadata/Items/Gem/SkillGemAlsoNew', level_interval: [1, 100] }] },
      ],
    });
    expect(b.skills).toEqual(['SomethingNew']);
    expect(b.skillGroups![0]!.gems[1]).toEqual({
      name: 'AlsoNew',
      level: null,
      quality: null,
      levelInterval: [1, 100],
    });
  });

  it('битые поля не роняют парсер: скилл без id пропускается', async () => {
    const b = await build({ skills: [{ level_interval: [1, 100] }, { id: 'Metadata/Items/Gems/SkillGemHeraldOfIce' }] });
    expect(b.skills).toEqual(['Herald of Ice']);
    expect(b.skillGroups).toHaveLength(1);
  });

  it('weapon_set вне 1|2 игнорируется', async () => {
    const b = await build({ passives: [{ id: 'x', weapon_set: 3 }, { id: 'y', weapon_set: '1' }] });
    expect(b.passiveNodes).toEqual(['x', 'y']);
    expect(b.passiveWeaponSets).toBeUndefined();
  });
});
