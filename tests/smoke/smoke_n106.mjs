// smoke_n106.mjs — №106: привязка умений к оружейному набору (set1/set2)
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '  OK  ' : 'FAIL  ') + n + (c ? '' : ' :: ' + e)); if (!c) fails++; };

const { buildGemSetups } = await import('../../packages/core/dist/index.js');

function skillGroup(attrs, gems) {
  return `<Skill ${attrs}>` + gems.map((g) =>
    `<Gem nameSpec="${g}" gemId="Metadata/Items/Gems/${g.replace(/\s/g, '')}" level="10" quality="0" count="1" enabled="true"/>`
  ).join('') + `</Skill>`;
}
const xml = '<PathOfBuilding2><Build level="95" className="Monk" ascendClassName="Invoker">' +
  // set2-only: Herald of Ice — должен получить weaponSet='2' + предупреждение
  skillGroup('enabled="true" set1="false" set2="true" label="HoI"', ['Herald of Ice']) +
  // both: обычная группа без привязки
  skillGroup('enabled="true" set1="true" set2="true" label="IceStrike"', ['Ice Strike']) +
  // только set1 (set2="false")
  skillGroup('enabled="true" set1="true" set2="false" label="Bell"', ['Tempest Bell']) +
  // легаси: без атрибутов → undefined
  skillGroup('enabled="true" label="Legacy"', ['Convalescence']) +
  '</Build></PathOfBuilding2>';

const setups = await buildGemSetups(xml);
const byName = Object.fromEntries(setups.map((s) => [s.active, s]));

ok('HoI: weaponSet === "2"', byName['Herald of Ice']?.weaponSet === '2', JSON.stringify(byName['Herald of Ice']));
ok('HoI: where содержит набор II + текст ошибки', /набор оружия II/.test(byName['Herald of Ice']?.where ?? '') && /нельзя использовать/.test(byName['Herald of Ice']?.where ?? ''), byName['Herald of Ice']?.where);
ok('Ice Strike: weaponSet === "both"', byName['Ice Strike']?.weaponSet === 'both', JSON.stringify(byName['Ice Strike']));
ok('Ice Strike: where БЕЗ предупреждения о наборе', !/нельзя использовать/.test(byName['Ice Strike']?.where ?? ''), byName['Ice Strike']?.where);
ok('Tempest Bell: weaponSet === "1"', byName['Tempest Bell']?.weaponSet === '1', JSON.stringify(byName['Tempest Bell']));
ok('Tempest Bell: where содержит набор I', /набор оружия I/.test(byName['Tempest Bell']?.where ?? ''), byName['Tempest Bell']?.where);
ok('Legacy: weaponSet === undefined', byName['Convalescence']?.weaponSet === undefined, JSON.stringify(byName['Convalescence']));
ok('Legacy: where без предупреждения', !/нельзя использовать/.test(byName['Convalescence']?.where ?? ''), byName['Convalescence']?.where);

// Marker-checks рендерера и main
const html = (await import('../../apps/overlay/dist/rendererHtml.js')).rendererHtml;
for (const m of ['wset-badge', '⚔ набор', 'любой набор', 'нельзя использовать с текущими настройками оружия', 'weaponSet'])
  ok('HTML marker: ' + m, html.includes(m));
const mainSrc = readFileSync('apps/overlay/src/main.ts', 'utf8');
ok('main.ts: weaponSet в типе BuildState (в dist стирается — payload через spread)', mainSrc.includes("weaponSet?: 'both' | '1' | '2'"));

console.log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
