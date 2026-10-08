/**
 * №225: триггер-сетапы «Cast on X» в совете раскладки.
 * Живые кейсы 09.10.2026 (poe.ninja, L100 Forbidden Rites, эталонные PoB-коды):
 *  - Ice Nova через Cast on Block (KingPinUwU_Youtube, Gemling);
 *  - Spark/Orb of Storms — primary/secondary, а Comet-подобные связаны с триггерами
 *    (BABYROSHANCOM, Oracle CoC).
 * PoB-коды сохранены из model API (Temp/opencode); тест работает офлайн.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviseKeybinds, keybindsToMarkdown } from '../src/keybinds.js';
import { importBuild } from '../src/build.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'keybinds');
const read = (f: string): string => readFileSync(join(FIXTURES, f), 'utf8');

const castOnBlockBuild = () => importBuild(read('kingpin_coblock.pobcode.txt'));
const castOnCritBuild = () => importBuild(read('babyroshan_coc.pobcode.txt'));

describe('№225: триггер-сетапы «Cast on X»', () => {
  it('Cast on Block: Ice Nova видна в triggered, не в слотах', { timeout: 30000 }, async () => {
    const b = await castOnBlockBuild();
    const adv = adviseKeybinds(b);
    expect(adv.triggered.length).toBeGreaterThan(0);
    const cob = adv.triggered.find((t) => t.trigger === 'Cast on Block');
    expect(cob).toBeTruthy();
    expect(cob!.skills).toContain('Ice Nova');
    // саппорты PoE2 с уникальными именами отсеиваются по датасету (пустые skillTypes)
    expect(cob!.skills).not.toContain('Efficiency II');
    expect(cob!.skills).not.toContain('Lifetap');
    // Ice Nova не биндится и не теряется молча
    expect(adv.assignments.some((a) => a.gem === 'Ice Nova')).toBe(false);
    expect(adv.unassigned).not.toContain('Ice Nova');
    // мета-триггер: без «кастуется раз»
    const spiritCoB = adv.spirit.find((s) => s.gem === 'Cast on Block');
    expect(spiritCoB).toBeTruthy();
    expect(spiritCoB!.note).toMatch(/мета-триггер/);
    expect(spiritCoB!.note).not.toMatch(/кастуется раз/);
    // markdown: отдельный блок, скилл упомянут
    const md = keybindsToMarkdown(adv);
    expect(md).toMatch(/Триггер-сетапы/);
    expect(md).toContain('Ice Nova');
  });

  it('CoC-оракул: триггеры не заняты слотами, физика раскладки не сломана', { timeout: 30000 }, async () => {
    const b = await castOnCritBuild();
    const adv = adviseKeybinds(b);
    // основной скилл Spark остаётся primary-биндом
    expect(adv.assignments.some((a) => a.gem === 'Spark' && a.role === 'primary')).toBe(true);
    // Comet виден в triggered-блоке через Cast on Critical, саппорты отсеяны
    const coc = adv.triggered.find((t) => t.trigger === 'Cast on Critical');
    expect(coc?.skills).toContain('Comet');
    expect(coc?.skills ?? []).not.toContain('Elemental Focus');
    // триггеры не занимают боевые слоты
    expect(adv.assignments.some((a) => /Cast on/.test(a.gem ?? ''))).toBe(false);
    // аура-херальды по-прежнему «кастуется раз» (не затронуты правкой)
    const herald = adv.spirit.find((s) => /Herald|Sacrifice/.test(s.gem) && !/Cast on/.test(s.gem));
    if (herald) expect(herald.note).toMatch(/кастуется раз/);
  });

  it('представление KeybindAdvice обратно совместимо: triggered на билде без CoX-сетапов эталона', { timeout: 30000 }, async () => {
    const flicker = await importBuild(read('pob_28880.xml'));
    const adv = adviseKeybinds(flicker);
    expect(Array.isArray(adv.triggered)).toBe(true);
    // эталон 28880 содержит Cast on Critical в Spirit-блоке (№222) — он же
    // мета-триггер: остаётся в spirit с новой формулировкой, связанные скиллы
    // не попадают в боевые слоты.
    expect(adv.spirit.some((s) => s.gem === 'Cast on Critical')).toBe(true);
    for (const t of adv.triggered) {
      for (const sk of t.skills) {
        expect(adv.assignments.some((a) => a.gem === sk)).toBe(false);
      }
    }
  });
});
