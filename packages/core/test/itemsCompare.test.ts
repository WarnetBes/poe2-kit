import { describe, expect, it } from 'vitest';
import { compareItems } from '../src/itemsCompare.js';

const RING_A = [
  'Item Class: Rings', 'Rarity: RARE', 'Alpha', 'Iron Ring', '--------',
  '+40 to maximum Life',
  '+30% to Fire Resistance',
].join('\n');

const RING_B = [
  'Item Class: Rings', 'Rarity: RARE', 'Beta', 'Iron Ring', '--------',
  '+55 to maximum Life',
  '+30% to Fire Resistance',
  '+12% to Lightning Resistance',
].join('\n');

const BOOTS = [
  'Item Class: Boots', 'Rarity: RARE', 'Zzz', 'Sinner Trample', '--------',
  'Evasion Rating: 200',
].join('\n');

describe('compareItems (W5-B, №696)', () => {
  it('не-предмет (мусор) → parse не бросает, вердикт unknown, score null', () => {
    const r = compareItems({ itemA: 'мусор', itemB: RING_B });
    expect(r.verdict).toBe('unknown');
    expect(r.reasons.some((x) => /Gearscore недоступен/.test(x))).toBe(true);
  });

  it('upgrade: B сильнее A — вердикт и причина', () => {
    const r = compareItems({ itemA: RING_A, itemB: RING_B });
    expect(r.ok).toBe(true);
    expect(r.verdict).toBe('upgrade');
    // Общий мод (fire res, нормализован) + дифф по life-роллу и lightning-B.
    expect(r.shared.join(' ')).toContain('Fire Resistance');
    expect(r.diff.some((d) => d.side === 'b' && /Lightning/.test(d.text))).toBe(true);
  });

  it('downgrade: наоборот', () => {
    const r = compareItems({ itemA: RING_B, itemB: RING_A });
    expect(r.verdict).toBe('downgrade');
  });

  it('разные слоты → вердикт unknown + честная причина', () => {
    const r = compareItems({ itemA: RING_A, itemB: BOOTS });
    expect(r.ok).toBe(true);
    expect(r.reasons.some((x) => /Слоты разные/.test(x))).toBe(true);
  });
});
