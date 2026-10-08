/**
 * Тесты №223b/№223c (keybinds.ts): «имба-атаки».
 *  - авто-повышение лучшего атакующего до primary при отсутствии main-группы
 *    (каскад: FullDPSSkill PoB → теговый fallback по датасету);
 *  - сортировка внутри роли: дэмедж-скиллы раньше утилити;
 *  - дедупликация имени камня между группами;
 *  - overrides-пин primary блокирует авто-повышение.
 *
 * Датасетные имена камней сверены с skill_gems_v2.json:
 *  - Lightning Spear: Attack, без Cooldown/Travel/Movement → кандидат promote;
 *  - Tame Beast: без Attack/Spell/Damage/Buff/Cooldown тегов → не дэмедж;
 *  - Ice Strike: Attack (main-группа эталона);
 *  - 'Mystery …' — отсутствуют в датасете → classifyRole → unknown, isDamage=false.
 */
import { describe, it, expect } from 'vitest';
import { adviseKeybinds } from '../src/keybinds.js';
import type { BuildImport } from '../src/types.js';

function fakeBuild(
  groups: Array<{ name: string; main?: boolean; label?: string }>,
  fullDps?: Array<{ stat: string; value: number }>,
): BuildImport {
  return {
    source: 'test',
    skills: [],
    passiveNodes: [],
    gear: {},
    skillGroups: groups.map((g, i) => ({
      label: g.label ?? `G${i + 1}`,
      enabled: true,
      main: g.main || undefined,
      gems: [{ name: g.name, level: 20, quality: null }],
    })),
    ...(fullDps ? { fullDps } : {}),
  };
}

describe('adviseKeybinds — №223b: promote без main-группы, сортировка bounded', () => {
  it('нет main-группы: теговый fallback повышает атакующего до primary (RB), есть unverified-пометка', () => {
    // Mantra of Destruction = Buff → не дэмедж, promote не ему.
    const pad = adviseKeybinds(fakeBuild([{ name: 'Lightning Spear' }, { name: 'Mantra of Destruction' }]), {
      platform: 'xbox',
    });
    const primary = pad.assignments.find((a) => a.role === 'primary');
    expect(primary).toBeTruthy();
    expect(primary!.gem).toBe('Lightning Spear');
    expect(primary!.slot).toBe('RB'); // primary → R1 (GGG)
    expect(pad.unverifiedNotes).toEqual(
      expect.arrayContaining([expect.stringContaining('Lightning Spear: повышен до primary автоматически')]),
    );
    expect(primary!.unverified).toContain('main-группа не помечена');
  });

  it('нет main-группы, но есть FullDPSSkill: повышен скилл с max DPS (приоритет над теговым fallback)', () => {
    // Полный DPS-брейкдаун PoB называет Tempest Bell (Cooldown-тег — теговый
    // fallback его бы пропустил), FullDPSSkill — авторитетнее.
    const pad = adviseKeybinds(
      fakeBuild(
        [{ name: 'Lightning Spear' }, { name: 'Tempest Bell' }],
        [
          { stat: '2x Lightning Spear', value: 1000 },
          { stat: 'Tempest Bell', value: 900000 },
        ],
      ),
      { platform: 'xbox' },
    );
    const primary = pad.assignments.find((a) => a.role === 'primary');
    expect(primary!.gem).toBe('Tempest Bell');
    expect(primary!.slot).toBe('RB');
    expect(primary!.unverified).toContain('FullDPSSkill');
    expect(pad.unverifiedNotes.some((n) => n.includes('повышен до primary автоматически'))).toBe(false);
  });

  it('main-группа = аура (mainSocketGroup указывает на ресурс): primary-слоты спасает promote, не пустуют', () => {
    // Реальный сценарий №223c: PoB2 дефолтит mainSocketGroup в 1, первая группа — аура.
    const pad = adviseKeybinds(
      fakeBuild([{ name: 'Herald of Ice', main: true, label: 'Aura default' }, { name: 'Ice Strike' }]),
      { platform: 'xbox' },
    );
    expect(pad.spirit.some((s) => s.gem === 'Herald of Ice')).toBe(true);
    const primary = pad.assignments.find((a) => a.role === 'primary');
    expect(primary!.gem).toBe('Ice Strike');
    expect(primary!.slot).toBe('RB');
  });

  it('нет main-группы и дэмедж-тегов (все unknown): ничего не повышено, слоты не дублируются', () => {
    const pad = adviseKeybinds(fakeBuild([{ name: 'Mystery Skill Alpha' }, { name: 'Mystery Skill Beta' }]), {
      platform: 'xbox',
    });
    expect(pad.assignments.some((a) => a.role === 'primary')).toBe(false);
    for (const g of ['Mystery Skill Alpha', 'Mystery Skill Beta']) {
      expect(pad.assignments.some((a) => a.gem === g) || pad.unassigned.includes(g)).toBe(true);
    }
    const slots = pad.assignments.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(pad.unverifiedNotes.some((n) => n.includes('повышен до primary автоматически'))).toBe(false);
  });

  it('внутри secondary: дэмедж-скилл раньше утилити (RT раньше Y)', () => {
    // Основная задача «имба-атак»: при равных ролях атакующие — на удобных слотах.
    const pad = adviseKeybinds(
      fakeBuild([{ name: 'Ice Strike', main: true }, { name: 'Tame Beast' }, { name: 'Lightning Spear' }]),
      { platform: 'xbox' },
    );
    const ls = pad.assignments.find((a) => a.gem === 'Lightning Spear')!;
    const tb = pad.assignments.find((a) => a.gem === 'Tame Beast')!;
    expect(ls.role).toBe('secondary');
    expect(tb.role).toBe('secondary');
    expect(pad.assignments.indexOf(ls)).toBeLessThan(pad.assignments.indexOf(tb));
    expect(ls.slot).toBe('RT');
    expect(tb.slot).toBe('Y');
  });

  it('дубль имени камня в двух группах: слот назначается один раз (дедуп в activeGems)', () => {
    const pad = adviseKeybinds(
      fakeBuild([
        { name: 'Lightning Spear', label: 'Weapon 1' },
        { name: 'Lightning Spear', label: 'Weapon 2' },
        { name: 'Mantra of Destruction' },
      ]),
      { platform: 'xbox' },
    );
    expect(pad.assignments.filter((a) => a.gem === 'Lightning Spear').length).toBe(1);
    const slots = pad.assignments.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('overrides-пин primary от пользователя: авто-повышение не срабатывает', () => {
    const pinned = adviseKeybinds(fakeBuild([{ name: 'Lightning Spear' }, { name: 'Tame Beast' }]), {
      platform: 'xbox',
      overrides: { 'Tame Beast': 'primary' },
    });
    const primary = pinned.assignments.find((a) => a.role === 'primary');
    expect(primary!.gem).toBe('Tame Beast');
    expect(primary!.slot).toBe('RB');
    expect(pinned.assignments.find((a) => a.gem === 'Lightning Spear')!.role).not.toBe('primary');
    expect(pinned.unverifiedNotes.some((n) => n.includes('повышен до primary автоматически'))).toBe(false);
  });
});
