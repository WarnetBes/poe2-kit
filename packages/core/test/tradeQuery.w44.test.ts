import { describe, expect, it } from 'vitest';
import { buildTradeQuery, buildTradeQueryFromItem, modsToStatFilters } from '../src/tradeQuery.js';

interface StatFilterOut { id: string; value?: { min?: number } }

const filtersOf = (q: { query: { stats?: Array<{ filters: StatFilterOut[] }> } }): StatFilterOut[] =>
  q.query.stats?.[0]?.filters ?? [];
const FIND = (arr: StatFilterOut[], suffix: string) => arr.find((f) => f.id.endsWith(suffix));
const minOf = (f?: StatFilterOut) => f?.value?.min;

/** EN-ботинки с передвижением (баг «движение»: MS-мода не было в маппинге). */
const BOOTS = [
  'Item Class: Boots', 'Rarity: Rare', 'Sprintstep', 'Sinner Trample', '--------',
  'Evasion: 250', '--------',
  '+30% increased Movement Speed', '+70 to maximum Life', '+11 to Evasion Rating',
].join('\n');

const RU_RING = [
  'Класс предмета: Кольца', 'Редкость: Редкий', 'Петля', 'Кольцо с гнездом', '--------',
  '+55 к максимуму здоровья', '+31% к сопротивлению молнии', '+22 к уклонению',
].join('\n');

const BODY = [
  'Item Class: Body Armours', 'Rarity: Rare', 'Wrap', 'Sleek Jacket', '--------',
  'Energy Shield: 500', '--------',
  '+100 to Spirit', '+74 to Armour',
].join('\n');

const AMULET_ES = [
  'Item Class: Amulets', 'Rarity: Rare', 'A', 'Onyx Amulet', '--------',
  '+41 to maximum Energy Shield',
].join('\n');

describe('W4-4 trade_search: мёртвые pseudo-id и RU-статы', () => {
  it('НЕТ мёртвых pseudo_total_armour/evasion/spirit в выходном JSON (живой API отдаёт им 400)', () => {
    const q = buildTradeQueryFromItem(BODY);
    const ids = JSON.stringify(q);
    expect(ids).not.toContain('pseudo_total_armour');
    expect(ids).not.toContain('pseudo_total_evasion_rating');
    expect(ids).not.toContain('pseudo_total_spirit');
  });

  it('Spirit → explicit.stat_3981240776 (живой факт: body/amulet 10000 листингов)', () => {
    const q = buildTradeQueryFromItem(BODY);
    const f = FIND(filtersOf(q), 'stat_3981240776');
    expect(f).toBeDefined();
    expect(minOf(f)).toBe(100);
  });

  it('армор-слот: flat Evasion → LOCAL-id stat_53045048, НЕ глобальный', () => {
    // Boots с колонкой Evasion → армор-слот; +11 to Evasion Rating — локальный.
    const q = buildTradeQueryFromItem(BOOTS);
    const stats = filtersOf(q);
    const ev = stats.find((f) => /stat_(53045048|2144192055)$/.test(f.id));
    expect(ev?.id).toBe('explicit.stat_53045048');
    expect(stats.some((f) => f.id === 'explicit.stat_2144192055')).toBe(false);
  });

  it('jewelry: flat Evasion → глобальный id stat_2144192055 (ring — живой факт 10000)', () => {
    const q = buildTradeQueryFromItem(RU_RING);
    const ev = filtersOf(q).find((f) => /stat_(53045048|2144192055)$/.test(f.id));
    expect(ev?.id).toBe('explicit.stat_2144192055');
  });

  it('RU-статы становятся фильтрами: жизнь + молния + уклонение (баг №680/№681)', () => {
    const q = buildTradeQueryFromItem(RU_RING);
    const stats = filtersOf(q);
    expect(minOf(FIND(stats, 'pseudo_total_life'))).toBe(55);
    expect(minOf(FIND(stats, 'pseudo_total_lightning_resistance'))).toBe(31);
    expect(minOf(FIND(stats, 'stat_2144192055'))).toBe(22);
  });

  it('«движение»: MS-мод даёт фильтр stat_2250533757 (живой факт, ботинки 10000)', () => {
    const q = buildTradeQueryFromItem(BOOTS);
    const ms = FIND(filtersOf(q), 'stat_2250533757');
    expect(ms).toBeDefined();
    expect(minOf(ms)).toBe(30);
  });

  it('RU MS «повышение скорости передвижения» тоже матчится', () => {
    const f = modsToStatFilters(['15% повышение скорости передвижения']);
    expect(f.some((x) => x.id === 'explicit.stat_2250533757')).toBe(true);
  });

  it('flat ES на амулете → pseudo_total_energy_shield (прежний путь не деградировал)', () => {
    const q = buildTradeQueryFromItem(AMULET_ES);
    expect(FIND(filtersOf(q), 'pseudo_total_energy_shield')).toBeDefined();
  });

  it('чарм-категория flask.charm в маппинге (живой факт фильтров 30.10.2026)', () => {
    const q = buildTradeQuery({ type: 'charm' });
    expect(q.query.filters?.type_filters?.filters?.category?.option).toBe('flask.charm');
    expect(buildTradeQuery({ type: 'spear' }).query.filters?.type_filters?.filters?.category?.option).toBe('weapon.spear');
  });
});
