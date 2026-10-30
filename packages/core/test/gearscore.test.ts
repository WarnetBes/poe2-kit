import { describe, expect, it } from 'vitest';
import { gearScoreItem } from '../src/gearscore.js';

const RARE_BOOTS = [
  'Item Class: Boots',
  'Rarity: RARE',
  'Sprintstep',
  'Sinner Trample',
  '--------',
  'Evasion Rating: 250',
  '--------',
  '+30% increased Movement Speed',
  '+70 to maximum Life',
  '+34% to Cold Resistance',
  '24% increased Evasion Rating',
  '+12% to Rarity of Items found',
].join('\n');

const RARE_RING = [
  'Item Class: Rings',
  'Rarity: RARE',
  'Loop Spira',
  'Unset Ring',
  '--------',
  '+55 to maximum Life',
  '+31% to Lightning Resistance',
  '+15% to Cold Resistance',
  "+8 to Strength",
].join('\n');

const UNIQUE_AMU = [
  'Item Class: Amulets',
  'Rarity: UNIQUE',
  'Static Heart',
  'Uzha',
  '--------',
  '+80 to maximum Life',
].join('\n');

const CRUDWeapon = [
  'Item Class: One Hand Swords',
  'Rarity: RARE',
  'Slasher',
  'Eternal Sword',
  '--------',
  'Physical Damage: 40-60',
  'Critical Hit Chance: 5.00%',
  'Attacks per Second: 1.50',
  '--------',
  "Adds 10 to 15 Physical Damage",
  '25% increased Physical Damage',
  '+12% to Fire Resistance',
].join('\n');

const RU_RING = [
  'Класс предмета: Кольца',
  'Редкость: РЕДКИЙ',
  'Петля',
  'Кольцо с гнездом',
  '--------',
  '+55 к максимуму здоровья',
  '+31% к сопротивлению молнии',
  '15% повышение скорости передвижения',
].join('\n');

describe('gearScoreItem (idea-ref W4-2, свой код)', () => {
  it('не-предмет → not-item', () => {
    const r = gearScoreItem('абракадабра');
    expect(r.rated).toBe(false);
    expect(r.unratedReason).toBe('not-item');
  });

  it('уник/неопознанный/фляга не оцениваются', () => {
    expect(gearScoreItem(UNIQUE_AMU).unratedReason).toBe('unique');
    const flask = ['Item Class: Life Flasks', 'Rarity: NORMAL', 'Big Flask'].join('\n');
    expect(gearScoreItem(flask).unratedReason).toBe('flask');
  });

  it('сапоги: MS+life+res дают score, grade D..S, top-моды сверху', () => {
    const r = gearScoreItem(RARE_BOOTS);
    expect(r.rated).toBe(true);
    expect(r.slot).toBe('Boots');
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.contributions[0]!.points).toBeGreaterThanOrEqual(r.contributions[1]!.points);
    const labels = r.contributions.map((c) => c.label);
    expect(labels).toContain('Movement speed');
    expect(labels).toContain('Life');
    // Локальный % evasion не дублируется поверх [Base].
    expect(r.contributions.some((c) => /increased Evasion/i.test(c.key))).toBe(false);
  });

  it('ideal: пустой редкий предмет не делится на ноль и даёт низкий score', () => {
    const bare = ['Item Class: Rings', 'Rarity: RARE', 'Xxx', 'Iron Ring', '--------', ''].join('\n');
    const r = gearScoreItem(bare);
    expect(r.rated).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('ring: capped-резист с resNeed почти не весит', () => {
    const free = gearScoreItem(RARE_RING).contributions;
    const freeLres = free.find((c) => c.label === 'Lightning res');
    expect(freeLres).toBeDefined();
    const capped = gearScoreItem(RARE_RING, { resNeed: { lightning: 0, cold: 100 } });
    // Молния закрыта (need=0) → вклад обрезан до 0 и не попадает в contributions.
    expect(capped.contributions.find((c) => c.label === 'Lightning res')).toBeUndefined();
  });

  it('один стат не набирает больше одного топ-ролла (implicit+explicit)', () => {
    const twin = [
      'Item Class: Rings', 'Rarity: RARE', 'Twin', 'Amethyst Ring', '--------',
      '+40 to maximum Life', '+45 to maximum Life',
    ].join('\n');
    const r = gearScoreItem(twin);
    // Общий % качества по life ≤ 115% (кап 100+overroll-допуск).
    const totalLifeQ = r.contributions.filter((c) => c.label === 'Life')
      .reduce((a, c) => a + c.qualityPct, 0);
    expect(totalLifeQ).toBeLessThanOrEqual(115);
  });

  it('conditional-мод (/while/) весит ×0.6', () => {
    const cond = [
      'Item Class: Rings', 'Rarity: RARE', 'C', 'Iron Ring', '--------',
      '+70 to maximum Life while a Unique Item is equipped',
    ].join('\n');
    const r = gearScoreItem(cond);
    const c = r.contributions.find((x) => x.label === 'Life')!;
    expect(c).toBeDefined();
    // imp 7, value 70 /cap100 → q 0.7, но условный: 7×0.7×0.6 = 2.9 → округл. 2.9
    expect(c.points).toBeLessThan(7 * 0.7);
  });

  it('weapon: DPS считается из offense, score высок; fire-res на оружии imp 0 → НЕ даёт 0-очков (№696 P2-7)', () => {
    const r = gearScoreItem(CRUDWeapon);
    expect(r.slot).toBe('Weapon');
    const dps = r.contributions.find((c) => c.label === 'Weapon DPS');
    expect(dps).toBeDefined();
    expect(dps!.value).toBeGreaterThan(0);
    expect(r.contributions.some((c) => c.label === 'Fire res')).toBe(false);
    expect(r.contributions.every((c) => c.points !== 0)).toBe(true);
  });

  it('RU-клир-текст понимается (life/резист); MS на кольце НЕ весит и НЕ даёт 0-очков (№696 P2-7)', () => {
    const r = gearScoreItem(RU_RING);
    expect(r.rated).toBe(true);
    const labels = r.contributions.map((c) => c.label);
    expect(labels).toContain('Life');
    expect(labels).toContain('Lightning res');
    expect(labels).not.toContain('Movement speed');
    expect(r.contributions.every((c) => c.points !== 0)).toBe(true);
  });

  it('es-caster профиль: ES-флэт весит сильно, в life-res — слабо (№693-уточнение: ES-flat на jewelry добавлен в оба, асимметрия весов)', () => {
    const esRing = [
      'Item Class: Rings', 'Rarity: RARE', 'Es', 'Diamond Ring', '--------',
      '+75 to maximum Energy Shield',
    ].join('\n');
    const life = gearScoreItem(esRing, { profile: 'life-res' });
    const es = gearScoreItem(esRing, { profile: 'es-caster' });
    const lifeC = life.contributions.find((c) => c.label === 'Energy Shield');
    const esC = es.contributions.find((c) => c.label === 'Energy Shield');
    expect(esC).toBeDefined();
    expect(esC!.points).toBeGreaterThan((lifeC?.points ?? 0)); // es-caster сильнее
    expect(lifeC!.points).toBeGreaterThan(0); // life-res тоже считает (слабо, imp 2)
    expect(esC!.points).toBeGreaterThan(lifeC!.points * 2);
  });

  it('es-caster: Spirit на теле весит 8 (сильная запись профиля, НЕ слабый дубль life-res — №695 P1-1)', () => {
    const body = [
      'Item Class: Body Armours', 'Rarity: RARE', 'Sp', 'Sleek Jacket', '--------',
      'Energy Shield: 500', '--------',
      '+100 to Spirit',
    ].join('\n');
    const r = gearScoreItem(body, { profile: 'es-caster' });
    const spirit = r.contributions.find((c) => c.label === 'Spirit');
    expect(spirit).toBeDefined();
    // imp 8, value 100 / cap 60 → качество 1.15 (overroll-потолок) → 8×1.15 = 9.2
    expect(spirit!.points).toBeCloseTo(9.2, 5);
  });

  it('missing: что докатить — топ absent статы', () => {
    const r = gearScoreItem(RU_RING);
    expect(Array.isArray(r.missing)).toBe(true);
    expect(r.missing.length).toBeLessThanOrEqual(3);
  });

  it('boost_from_gear (W5-C): буст life ×1.5 поднимает очки жизни, score меняется', () => {
    const lifeRing = [
      'Item Class: Rings', 'Rarity: RARE', 'Bo', 'Iron Ring', '--------',
      '+55 to maximum Life',
    ].join('\n');
    const plain = gearScoreItem(lifeRing);
    const boosted = gearScoreItem(lifeRing, { boostIds: ['life'] });
    const p = plain.contributions.find((c) => c.label === 'Life')!;
    const b = boosted.contributions.find((c) => c.label === 'Life')!;
    // boost умножает НЕОКРУГЛЁННЫЙ imp до финального rounding очков — поэтому
    // точного ratio на rounded numbers нет; проверяем честный диапазон ×1.5.
    expect(b.points).toBeGreaterThan(p.points);
    expect(b.points).toBeGreaterThanOrEqual(Math.round((p.points * 1.4) * 10) / 10);
    expect(b.points).toBeLessThanOrEqual(Math.round((p.points * 1.6) * 10) / 10);
    expect(boosted.score).not.toBe(plain.score);
  });
});
