// №109: смок обновления bosses.ts до патча 0.5.5.
import {
  CAMPAIGN_BOSSES, ASC_TRIAL_BOSSES, SEKHEMAS_BOSSES, PINNACLE_BOSSES, ALL_BOSSES,
  bossByZoneCode, campaignBossesByAct,
} from '../../packages/core/dist/index.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${extra ? ' :: ' + extra : ''}`); }
};

// 1. Sekhemas: 4 этажа в правильном порядке
check('Sekhemas: 4 этажа', SEKHEMAS_BOSSES.length === 4, String(SEKHEMAS_BOSSES.length));
check('Sekhemas: floor по порядку 1..4',
  SEKHEMAS_BOSSES.every((b, i) => b.floor === i + 1),
  JSON.stringify(SEKHEMAS_BOSSES.map(b => b.floor)));
check('Sekhemas этаж 1 = Rattlecage, The Earthbreaker',
  SEKHEMAS_BOSSES[0].name === 'Rattlecage, The Earthbreaker');
check('Sekhemas этаж 2 = Hadi + Rafiq (пара)',
  SEKHEMAS_BOSSES[1].name.includes('Hadi of the Flaming River') && SEKHEMAS_BOSSES[1].name.includes('Rafiq of the Frozen Spring'));
check('Sekhemas этаж 3 = Ashar, The Sand Mother',
  SEKHEMAS_BOSSES[2].name === 'Ashar, The Sand Mother');

// 2. Zarokh — финалист с Djinn Barya
const zarokh = SEKHEMAS_BOSSES[3];
check('Sekhemas финалист = Zarokh, The Temporal', zarokh && zarokh.name === 'Zarokh, The Temporal');
check('Zarokh: доступ = Djinn Barya', !!zarokh && /Djinn Barya/.test(zarokh.access || ''));

// 3. Arbiter of Ash — Fire Res пометка (0.5.5: НЕ All Elemental Res)
const arbiter = PINNACLE_BOSSES.find(b => b.name === 'The Arbiter of Ash');
check('Arbiter of Ash найден', !!arbiter);
const arbiterTips = (arbiter?.tips || []).join(' ');
const arbiterAll = JSON.stringify(arbiter || {});
check('Arbiter of Ash: сопротивление огню + уязвимость к холоду',
  /fire res|сопротивление огню/i.test(arbiterAll) && /cold vulnerability|уязвимость к холоду/i.test(arbiterAll));
check('Arbiter of Ash: НЕ All Elemental Res',
  !/All Elemental Res(?!istances no longer)/.test(arbiterAll) || !/has All Elemental Res/.test(arbiterAll));
check('Arbiter of Ash: фрагменты с трёх Citadel',
  /Citadel/.test(arbiter?.access || '') && /Doryani/.test(arbiter?.access || ''));

// 4. Aberration — verified:false (не найден в 0.5-источниках)
const aberration = PINNACLE_BOSSES.find(b => b.name === 'The Aberration');
check('Aberration: запись сохранена', !!aberration);
check('Aberration: verified === false', aberration?.verified === false);
check('Aberration: unverifiedNote про боевые механики', /боевые механики НЕ верифицированы/.test(aberration?.unverifiedNote || ''));

// 5. Raven Trickster — verified:false
const raven = PINNACLE_BOSSES.find(b => b.name === 'The Raven Trickster');
check('Raven Trickster: запись сохранена', !!raven);
check('Raven Trickster: verified === false', raven?.verified === false);
check('Raven Trickster: unverifiedNote про патчноут 0.5.5', /0\.5\.5|Raven’s Flock/.test(raven?.unverifiedNote || ''));

// 6. name_ru: строка или undefined у всех записей (тип-контракт)
const allEntries = [...ALL_BOSSES];
check('ALL_BOSSES не пуст', allEntries.length > 0, String(allEntries.length));
check('name_ru: строка или undefined у всех',
  allEntries.every(b => b.name_ru === undefined || (typeof b.name_ru === 'string' && b.name_ru.length > 0)));
const sekNoRuGuess = SEKHEMAS_BOSSES.every(b => b.name_ru === undefined);
check('Sekhemas: RU-имена НЕ выдуманы (undefined)', sekNoRuGuess,
  JSON.stringify(SEKHEMAS_BOSSES.map(b => b.name_ru)));

// 7. Атлас-очки: помечены не-верифицированными, atlasPoints = null
const arbiterDiv = PINNACLE_BOSSES.find(b => b.name === 'The Arbiter of Divinity');
check('Arbiter of Ash: atlasPoints === null', arbiter?.atlasPoints === null);
check('Arbiter of Divinity: найден (Precursor Fortress/Origin Core)',
  !!arbiterDiv && /Precursor|Origin Core/i.test(JSON.stringify(arbiterDiv)));
check('Arbiter of Divinity: atlasPoints === null', arbiterDiv?.atlasPoints === null);
check('Нет утверждающих «+6 очков» в атласе (0.5 не верифицировано)',
  !allEntries.some(b => /6 очк/i.test(b.reward || '') && /атлас/i.test(b.reward || '')));
check('Формулировка «точные цифры 0.5 не верифицированы» присутствует',
  allEntries.some(b => /0\.5 не верифицированы/.test(b.reward || '')));

// 8. Прочие 0.5-обновления
const trialmaster = ASC_TRIAL_BOSSES[0];
check('Trialmaster: 0.5.5 Inscribed Ultimatum', /Inscribed Ultimatum/.test(JSON.stringify(trialmaster)));
const tang = PINNACLE_BOSSES.find(b => b.name === "Tang'Mazu");
check("Tang'Mazu: новая запись (Grand Mirror → Simulacrum → Mirror of Madness)",
  !!tang && /Simulacrum/.test(tang.access || ''));
const olroth = PINNACLE_BOSSES.find(b => /Olroth/.test(b.name));
check('Expedition-пиннакл 0.5 (Olroth): имя подтверждено, механики НЕ верифицированы',
  !!olroth && olroth.verified === false && /НЕ верифицированы/.test(olroth.unverifiedNote || ''));
const kulemak = PINNACLE_BOSSES.find(b => b.name === 'Vessel of Kulemak');
check('Kulemak: 3 Lightless → Invitation → Well of Souls', /Lightless/.test(kulemak?.access || ''));
const atziri = PINNACLE_BOSSES.find(b => b.name.startsWith('Atziri'));
check('Atziri: 6 маяков / Lira Vaal', /6 маяк/.test(atziri?.access || '') && /Lira Vaal/.test(atziri?.zone || ''));
const xesht = PINNACLE_BOSSES.find(b => b.name.startsWith('Xesht'));
check('Xesht: Twisted Domain / Breachstone через Realmgate', /Twisted Domain/.test(xesht?.zone || '') && /Breachstone.*Realmgate/.test(xesht?.access || ''));
const bodach = PINNACLE_BOSSES.find(b => b.name === 'The Bodach');
check('Bodach: Rite of the Nameless, 5 карт', /Rite of the Nameless/.test(bodach?.access || ''));

// 9. Старые API работают
check('bossByZoneCode(G1_15) = Граф Геонор (№143b: Канделмасс НЕ финал)', bossByZoneCode('G1_15')?.name === 'Граф Геонор');
check('bossByZoneCode(unknown) = null', bossByZoneCode('XX_XX') === null);
const act1 = campaignBossesByAct(1);
check('campaignBossesByAct(1) = 11 боссов (№143b: +Граф Геонор)', act1.length === 11, String(act1.length));
check('ALL_BOSSES = campaign + asc + sekhemas + pinnacle',
  ALL_BOSSES.length === CAMPAIGN_BOSSES.length + ASC_TRIAL_BOSSES.length + SEKHEMAS_BOSSES.length + PINNACLE_BOSSES.length,
  `${ALL_BOSSES.length} vs ${CAMPAIGN_BOSSES.length}+${ASC_TRIAL_BOSSES.length}+${SEKHEMAS_BOSSES.length}+${PINNACLE_BOSSES.length}`);

console.log(`\n${fail === 0 ? 'ALL OK' : 'FAILURES: ' + fail} (${ok} passed)`);
process.exit(fail === 0 ? 0 : 1);
