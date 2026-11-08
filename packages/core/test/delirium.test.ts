/**
 * Тесты делириум-анoint-датасета (№738): целостность данных + поиск.
 *
 * Датасет — харвест фан-сайта poe2-biblioteka.ru (community, unverified);
 * тесты фиксируют КАНОН СТРУКТУРЫ (не игровые факты): 946 записей, легенда
 * 10+3 эмоций, все рецепты — валидные ключи, поиск по эмоциям/имени/стату.
 */
import { describe, expect, it } from 'vitest';
import {
  getDeliriumDataset,
  deliriumEmotionNames,
  deliriumDatasetStats,
  searchDeliriumRecipes,
  formatDeliriumResults,
  DELIRIUM_PROVENANCE_NOTE,
} from '../src/delirium.js';

describe('delirium dataset integrity (№738)', () => {
  it('загружается и держит счётчики сабагент-харвеста (946/893/53/18)', () => {
    const stats = deliriumDatasetStats();
    expect(stats.total).toBe(946);
    expect(stats.withRecipe).toBe(893);
    expect(stats.noRecipe).toBe(53);
    expect(stats.secret).toBe(18);
  });

  it('легенда: 10 обычных + 3 секретные эмоции, все ключи уникальны', () => {
    const ds = getDeliriumDataset();
    expect(ds.emotions).toHaveLength(10);
    expect(ds.secret_emotions).toHaveLength(3);
    const names = deliriumEmotionNames();
    const ids = Object.keys(names);
    expect(new Set(ids).size).toBe(ids.length);
    expect(names['red']).toBe('Гнев');
    expect(names['black']).toBe('Страдание');
    expect(names['em_prez']).toBe('Презрение');
  });

  it('каждый рецепт: непустое имя, статы, эмоции из легенды, has_recipe согласован', () => {
    const ds = getDeliriumDataset();
    const names = deliriumEmotionNames();
    expect(ds.recipes.length).toBeGreaterThan(900);
    for (const r of ds.recipes) {
      expect(r.name_ru.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(r.stats_ru)).toBe(true);
      expect(r.emotions.length).toBeGreaterThanOrEqual(3);
      for (const e of r.emotions) expect(names[e], `эмоция «${e}» вне легенды (${r.name_ru})`).toBeDefined();
      if (r.has_recipe) {
        expect(r.emotions.some((e) => e !== 'blank'), `has_recipe без эмоций: ${r.name_ru}`).toBe(true);
      } else {
        expect(r.emotions.every((e) => e === 'blank'), `no-recipe c эмоциями: ${r.name_ru}`).toBe(true);
      }
    }
  });

  it('_meta: источник/лицензия/unverified-дисциплина зафиксированы', () => {
    const m = getDeliriumDataset()._meta;
    expect(m.source).toContain('poe2-biblioteka.ru');
    expect(m.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(m.license).toContain('Grinding Gear Games');
    expect(DELIRIUM_PROVENANCE_NOTE).toContain('НЕ сверены живой игрой');
  });
});

describe('searchDeliriumRecipes (№738)', () => {
  it('поиск по имени/стату, case-insensitive', () => {
    const byName = searchDeliriumRecipes({ query: 'дополненная плоть' });
    expect(byName.length).toBe(1);
    expect(byName[0]!.recipe.secret).toBe(true);
    expect(byName[0]!.recipe_ru).toContain('Презрение');
    const byStat = searchDeliriumRecipes({ query: 'критическ' });
    expect(byStat.length).toBeGreaterThan(5);
  });

  it('поиск по эмоциям — мультимножество с кратностями', () => {
    const exact = searchDeliriumRecipes({ emotions: ['red', 'red', 'black'] });
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.length).toBeLessThan(searchDeliriumRecipes({ emotions: ['red'] }).length);
    const single = searchDeliriumRecipes({ emotions: ['red', 'black'] });
    for (const { recipe } of single) {
      const reds = recipe.emotions.filter((e) => e === 'red').length;
      const blacks = recipe.emotions.filter((e) => e === 'black').length;
      expect(reds).toBeGreaterThanOrEqual(1);
      expect(blacks).toBeGreaterThanOrEqual(1);
    }
  });

  it('неизвестная эмоция — громкая ошибка с легендой, не тихий ноль', () => {
    expect(() => searchDeliriumRecipes({ emotions: ['crimson'] })).toThrow(/Неизвестные эмоции: crimson/);
  });

  it('фильтры secret/has_recipe и limit', () => {
    const secrets = searchDeliriumRecipes({ secret: true });
    expect(secrets.length).toBe(18);
    expect(searchDeliriumRecipes({ hasRecipe: false }).length).toBe(53);
    const limited = searchDeliriumRecipes({ query: 'урон', limit: 3 });
    expect(limited.length).toBe(3);
  });

  it('markdown содержит рецепт, статы и provenance-пометку', () => {
    const md = formatDeliriumResults(searchDeliriumRecipes({ query: 'дополненная плоть' }), 1);
    expect(md).toContain('### Дополненная плоть');
    expect(md).toContain('Рецепт:');
    expect(md).toContain('ячейки умений');
    expect(md).toContain('poe2-biblioteka.ru');
  });
});
