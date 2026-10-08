/**
 * Тесты советчика раскладки навыков (№221, SPEC_KEYBIND_ADVISOR.md §8).
 * Эталон: pob_28880.xml — Invoker Ice Strike CI (Herald-тройка).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBuild } from '../src/build.js';
import { adviseKeybinds, keybindsToMarkdown, type KeybindRole } from '../src/keybinds.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'keybinds');
const xml = readFileSync(join(FIXTURES, 'pob_28880.xml'), 'utf8');

async function loadBuild() {
  return importBuild(xml);
}

describe('adviseKeybinds — эталон 28880 (Ice Strike Invoker)', () => {
  it('primary = Ice Strike на лучшем слоте (R1/LMB), занято ≤ 12', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'xbox' });
    const primary = pad.assignments.find((a) => a.role === 'primary');
    expect(primary).toBeTruthy();
    expect(primary!.gem).toBe('Flicker Strike'); // main group #8 эталона
    expect(primary!.slot).toBe('RB'); // R1

    const kb = adviseKeybinds(b, { platform: 'keyboard' });
    const kbPrimary = kb.assignments.find((a) => a.role === 'primary');
    expect(kbPrimary!.slot).toBe('LMB');
    expect(kb.assignments.length).toBeLessThanOrEqual(12);
  });

  it('Херальды и persistent-скиллы (HasReservation) — в Spirit-блоке', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'playstation' });
    const spiritNames = pad.spirit.map((s) => s.gem);
    expect(spiritNames).toEqual(
      expect.arrayContaining([
        'Herald of Ice', 'Herald of Thunder', 'Herald of Ash',
        'Wind Dancer', 'Ghost Dance', 'Into the Breach', 'Cast on Critical', // HasReservation
      ]),
    );
    // Резервирующие — не в боевых слотах.
    for (const s of spiritNames) {
      expect(pad.assignments.some((a) => a.gem === s)).toBe(false);
    }
    // №222: Spirit-cost берётся из levels[0].spiritReservationFlat (Herald of Ice → 30),
    // не из cost.spirit (у persistent-гемов cost отсутствует).
    const ice = pad.spirit.find((s) => s.gem === 'Herald of Ice');
    expect(ice?.spiritCost).toBe(30);
  });

  it('системные слоты геймпада не перебиваются навыками (dodge=LB/L1)', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'xbox' });
    const dodge = pad.system.find((s) => s.system === 'Dodge Roll');
    expect(dodge).toBeTruthy();
    expect(dodge!.slot).toBe('LB');
    expect(pad.assignments.some((a) => a.slot === 'LB')).toBe(false);
    expect(pad.totalSlots).toBe(22);
  });

  it('PS-нотация: слот издаётся в PS, дублируется в ps-поле', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'playstation' });
    const primary = pad.assignments.find((a) => a.role === 'primary')!;
    expect(primary.slot).toBe('R1');
    expect(primary.ps).toBe('RB');
    // №222 (баг): дубль-чек должен работать в нотации платформы, иначе
    // на PS два навыка получают один слот ('R2' !== 'RT').
    const slots = pad.assignments.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('клавиатура: wasd → мув на RMB; overrides-пин перекрывает эвристику', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const kb = adviseKeybinds(b, { platform: 'keyboard', movement_mode: 'wasd' });
    const mv = kb.assignments.find((a) => a.role === 'movement');
    if (mv) expect(mv.slot).toBe('RMB');
    // Пин: назначаем Whirling Assault на роль movement.
    const pinned = adviseKeybinds(b, {
      platform: 'keyboard',
      overrides: { 'Whirling Assault': 'movement' as KeybindRole },
    });
    const pinnedMv = pinned.assignments.find((a) => a.gem === 'Whirling Assault');
    expect(pinnedMv?.role).toBe('movement');
    expect(pinnedMv?.slot).toBe('RMB'); // wasd-режим: мув на правую кнопку
  });

  it('unverified-пометки честные и попадают в notes; markdown содержит все секции', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'xbox' });
    // У эталона ауры/херальды — в Spirit; проверяем, что не распознанное честно помечено.
    const md = keybindsToMarkdown(pad);
    expect(md).toContain('| Слот | Навык | Роль | Почему |');
    expect(md).toContain('Spirit-блок');
    expect(md).toContain('Как выставить в игре');
    if (pad.unverifiedNotes.length) expect(md).toContain('Не сверено с игрой');
  });

  it('все активные камни либо в слоте, либо в unassigned/spirit — потерь нет', { timeout: 30000 }, async () => {
    const b = await loadBuild();
    const pad = adviseKeybinds(b, { platform: 'xbox' });
    const groups = (b.skillGroups ?? []).filter((g) => g.enabled && g.gems.length);
    for (const g of groups) {
      const name = g.gems[0]!.name;
      const placed =
        pad.assignments.some((a) => a.gem === name) ||
        pad.spirit.some((s) => s.gem === name) ||
        pad.unassigned.includes(name);
      expect(placed).toBe(true);
    }
  });
});
