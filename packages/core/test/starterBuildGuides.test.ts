/**
 * Тест «🧬 Билды» (стартовые билды, №257-паттерн):
 * packages/core/data/game/starter_builds.json (18 курируемых билдов
 * PoE2 0.5.x из ресёрч-волн №471-№477).
 *
 * Покрывает:
 *  - data-файл: все записи валидны, id уникальны, схема базовых полей;
 *  - у каждой записи есть sources и mechanics_ru (дисциплина источников);
 *  - фейк-«Титан Вихревой налёт» НЕ билд, а warning внутри titan-earthshatter;
 *  - фильтры byClass/byAscendancy/search + мета-счётчики;
 *  - parse: мусорные payload'ы - стойкая обработка;
 *  - findStarterBuildGuide по id.
 */

import { describe, it, expect } from 'vitest';
import {
  parseStarterBuildGuides,
  listStarterBuildGuides,
  findStarterBuildGuide,
  starterBuildGuidesByClass,
  starterBuildGuidesByAscendancy,
  searchStarterBuildGuides,
  starterBuildClasses,
  starterBuildGuidesMeta,
  type StarterBuildGuide,
} from '../src/starterBuildGuides.js';

describe('starterBuildGuides: стартовые билды 0.5.x (№257-паттерн)', () => {
  it('data-файл: все записи валидны, id уникальны, схема базовых полей', () => {
    const builds = listStarterBuildGuides();
    expect(builds.length).toBe(18);
    const ids = new Set<string>();
    for (const b of builds) {
      expect(b.id.match(/^[\w-]+$/), `id не слаг: ${b.id}`).not.toBeNull();
      expect(ids.has(b.id), `дубль id: ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.title_ru.length, `пустой title_ru: ${b.id}`).toBeGreaterThan(0);
      expect(b.class_ru.length).toBeGreaterThan(0);
      expect(b.mechanics_ru.length).toBeGreaterThan(0);
      expect(typeof b.main_skill).toBe('object');
      expect(b.main_skill.ru || b.main_skill.en, `main_skill без имени: ${b.id}`).toBeTruthy();
      // стадии: только valid-ключи, cost - string|null
      for (const [k, s] of Object.entries(b.stages ?? {})) {
        expect(['starter', 'mid', 'main', 'max']).toContain(k);
        expect(s === undefined || s.cost === null || typeof s.cost === 'string', `cost мусорный: ${b.id}/${k}`).toBe(true);
      }
    }
  });

  it('дисциплина источников: у каждой записи sources и pros/cons непустые', () => {
    for (const b of listStarterBuildGuides()) {
      expect((b.sources ?? []).length, `без sources: ${b.id}`).toBeGreaterThan(0);
      expect((b.pros ?? []).length, `без pros: ${b.id}`).toBeGreaterThan(0);
      expect((b.cons ?? []).length, `без cons: ${b.id}`).toBeGreaterThan(0);
    }
  });

  it('фейк-«Титан Вихревой налёт» - НЕ билд: warning внутри titan-earthshatter', () => {
    const ids = listStarterBuildGuides().map((b) => b.id);
    expect(ids).not.toContain('titan-whirling-assault');
    const titan = findStarterBuildGuide('titan-earthshatter');
    expect(titan).not.toBeNull();
    expect((titan!.warning ?? '').toLowerCase()).toContain('фейк');
    expect(titan!.main_skill.en).toBe('Earthshatter');
    // «Мьёльнир» - EN-канон есть, RU-only уники без EN остаются null
    const noEn = titan!.key_uniques.find((u) => u.ru === 'Наследие Тьмы');
    expect(noEn?.en).toBeNull();
  });

  it('ключевые билды ресёрч-волн на месте (18 позиций: Druid/Witch/digest/№477)', () => {
    for (const id of [
      'druid-oracle-grim-pillars',
      'druid-oracle-entangle',
      'druid-shaman-bear-calamity',
      'chronomancer-incinerate-chaos-dot',
      'spark-stormweaver-mana-remnants',
      'lich-ed-contagion',
      'lich-abyssal',
      'lich-minions',
      'bloodmage-reap',
      'spiritwalker-companions',
      'amazon-twister',
      'witchhunter-galvanic-crossbow',
      'tactician-mortar-grenades',
      'deadeye-lightning-arrow',
      'invoker-hollow-form',
      'invoker-flicker-strike',
      'titan-earthshatter',
      'warbringer-soaring-midnight',
    ]) {
      expect(findStarterBuildGuide(id), `нет билда ${id}`).not.toBeNull();
    }
    expect(findStarterBuildGuide('nope')).toBeNull();
  });

  it('фильтры по классу/асценденси (RU и EN, регистронезависимо)', () => {
    const witch = starterBuildGuidesByClass('Ведьма');
    expect(witch.length).toBe(4);
    expect(starterBuildGuidesByClass('witch').length).toBe(4);
    expect(starterBuildGuidesByClass('Monk').length).toBe(2);
    const lich = starterBuildGuidesByAscendancy('Лич');
    expect(lich.length).toBe(2); // lich-ed-contagion + lich-minions (abyssal - отдельная запись)
    expect(starterBuildGuidesByAscendancy('titan').length).toBe(1);
    expect(starterBuildGuidesByClass('неттакогокласса')).toEqual([]);
  });

  it('поиск по подстроке adviser-полей', () => {
    const flicker = searchStarterBuildGuides('фликер');
    expect(flicker.length).toBe(1);
    expect(flicker[0]!.id).toBe('invoker-flicker-strike');
    const spark = searchStarterBuildGuides('Spark');
    expect(spark.map((b) => b.id)).toContain('spark-stormweaver-mana-remnants');
    expect(searchStarterBuildGuides('x')).toEqual([]); // короткий query - пусто
    expect(searchStarterBuildGuides('Разлом земли').map((b) => b.id)).toEqual(
      expect.arrayContaining(['titan-earthshatter', 'warbringer-soaring-midnight']),
    );
  });

  it('starterBuildClasses + meta согласованы с данными', () => {
    const classes = starterBuildClasses();
    expect(classes.length).toBe(8);
    expect(classes.reduce((a, c) => a + c.total, 0)).toBe(18);
    const m = starterBuildGuidesMeta();
    expect(m.buildsTotal).toBe(18);
    expect(m.classesTotal).toBe(8);
    expect(m.patch).toBe('0.5.5');
    expect(m.league).toBe('Forbidden Rites');
    expect(m.asOf).toBe('2026-10-12');
    expect(m.withPrices).toBeGreaterThan(0);
    expect(m.pobLinksTotal).toBeGreaterThan(30);
    expect(m.note).toBeTruthy();
  });

  it('parseStarterBuildGuides: мусор пропускает, битые записи отбраковывает', () => {
    expect(parseStarterBuildGuides(null)).toEqual([]);
    expect(parseStarterBuildGuides({})).toEqual([]);
    expect(parseStarterBuildGuides({ builds: 'nope' })).toEqual([]);
    expect(parseStarterBuildGuides({ builds: 42 })).toEqual([]);

    const good: StarterBuildGuide = {
      id: 'x',
      title_ru: 'Тест',
      class_ru: 'Класс',
      main_skill: { ru: 'Скилл', en: 'Skill' },
      supports: [],
      ascendancy_order: [],
      key_uniques: [],
      gear_tips: {},
      mechanics_ru: 'механика',
      pros: ['плюс'],
      cons: ['минус'],
      stages: { starter: { cost: null, note: 'н/д' } },
    };
    const bad = [
      { id: 'y', title_ru: 'Нет main_skill', class_ru: 'K', mechanics_ru: 'm' },
      { id: 'z', title_ru: 'Пустой main_skill', class_ru: 'K', mechanics_ru: 'm', main_skill: {} },
      { id: 'w', title_ru: 'cost-число', class_ru: 'K', mechanics_ru: 'm', main_skill: { ru: 's' }, stages: { starter: { cost: 42 } } },
      { id: '', title_ru: 'Пустой id', class_ru: 'K', mechanics_ru: 'm', main_skill: { ru: 's' } },
      null,
      42,
      'str',
    ];
    const out = parseStarterBuildGuides({ builds: [good, ...bad] });
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe('x');
    // supports-мусор (не массив) - запись отбраковывается
    const badSupports = { ...good, id: 's2', supports: 'nope' };
    expect(parseStarterBuildGuides({ builds: [badSupports] })).toEqual([]);
  });
});
