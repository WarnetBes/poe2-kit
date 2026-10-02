// Smoke №130: каталог рецептов CRAFT_RECIPES + waystone-план + пиннакл-фиксы.
import { CRAFT_RECIPES, craftPlan, waystoneCraftPlan } from '../../packages/core/dist/index.js';
import { pinnacleChecklist } from '../../packages/core/dist/optimize.js';

let fails = 0;
function chk(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL ') + name);
  if (!cond) fails++;
}

// 1. Каталог: объём и покрытие систем
const sys = new Set(CRAFT_RECIPES.map((r) => r.system));
chk('N130 recipes >= 30', CRAFT_RECIPES.length >= 30);
for (const s of ['currency', 'essence', 'omen', 'rune', 'quality', 'bench', 'desecration', 'special', 'waystone']) {
  chk(`N130 system "${s}" присутствует`, sys.has(s));
}
chk('N130 нет пустых recipe/name', CRAFT_RECIPES.every((r) => r.recipe && r.name && r.id));

// 2. Waystone-план: и через craftPlan (роут), и напрямую
const ws = craftPlan({ itemClass: 'Waystones', baseType: 'Waystone', itemLevel: 79 });
chk('N130 craftPlan роутит Waystone', /3:1|переков/i.test(ws.map((s) => s.step + s.detail).join(' ')));
chk('N130 waystone шаг про Т16-коррупцию', ws.some((s) => /Т16|коррупц/i.test(s.step + ' ' + s.detail)));
chk('N130 waystone шаг про возрождения', ws.some((s) => /возрожд/i.test(s.step + ' ' + s.detail)));
const wsParsed = waystoneCraftPlan({ itemClass: 'Waystones', baseType: 'Waystone', itemLevel: 79, parsed: fakeWs(15) });
chk('N130 waystoneCraftPlan видит тир 15', wsParsed.some((s) => /15/.test(s.step)));
function fakeWs(tier) {
  return {
    rarity: 'Normal', name: null, baseType: 'Waystone', itemClass: 'Waystones',
    itemLevel: 79, quality: null, defences: {}, offense: {},
    requirements: {}, mods: [{ text: `Waystone Tier ${tier}`, type: 'explicit' }],
    corrupted: false, mirrored: false, unidentified: false, sections: [],
  };
}

// 3. Пиннакл: резисты из pobStats (pass при 75+) + fail-подсказка + физ-слой EHP
const est75 = {
  pobStats: { FireResist: 75, ColdResist: 75, LightningResist: 75, ChaosResist: 40, Life: 1, EnergyShield: 6000 },
  defenses: { fireRes: 30, coldRes: 30, lightningRes: 30, chaosRes: -20, life: 1, energyShield: 5000 },
  ehp: { physical: { effectiveHp: 20000 }, chaos: { effectiveHp: 8000 } },
  worstEhp: { damageType: 'chaos', effectiveHp: 5246 },
};
const r75 = pinnacleChecklist(est75, {});
const bulletin = r75.checks.map((c) => `${c.item} ${c.verdict} ${c.detail}`).join(' | ');
chk('N130 fire pass по PoB-стату 75', /fire resistance ≥ 75%.{0,3}pass/.test(bulletin) || bulletin.includes('fire resistance') && !/fire resistance[^|]*fail/.test(bulletin));
chk('N130 source-подпись computed (PoB total)', bulletin.includes('PoB total'));
const estLow = {
  pobStats: {},
  defenses: { fireRes: 30, coldRes: 30, lightningRes: 30, chaosRes: -20, life: 1, energyShield: 5000 },
  ehp: { physical: { effectiveHp: 20000 }, chaos: { effectiveHp: 8000 } },
  worstEhp: { damageType: 'chaos', effectiveHp: 5246 },
};
const rLow = pinnacleChecklist(estLow, {});
const low = rLow.checks.map((c) => `${c.item} ${c.verdict} ${c.detail}`).join(' | ');
chk('N130 fail-подсказка эссенции при недоборе', low.includes('Essence of Insulation'));
chk('N130 физ-слой EHP вместо худшего', low.includes('EHP против физ. удара'));
chk('N130 worst-слой ушёл в инфо (unknown)', /слабый слой[^|]*unknown/.test(low));

console.log(fails === 0 ? '\nSMOKE N130: ALL OK' : `\nSMOKE N130: ${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
