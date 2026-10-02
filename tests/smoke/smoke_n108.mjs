// smoke_n108.mjs — №108 Quest Passives Helper + №109-рендер + №110 augment + №111 hotkey + №112-lite панель
// core dist (questRewards/endgame) + overlay dist (main.js/rendererHtml.js/preload.cjs). Readable markers only.
import * as qr from '../../packages/core/dist/questRewards.js';
import * as eg from '../../packages/core/dist/endgame.js';
import { readFileSync } from 'node:fs';

const ROOT = '.';
const main = readFileSync(ROOT + '/apps/overlay/dist/main.js', 'utf8');
const renderer = readFileSync(ROOT + '/apps/overlay/dist/rendererHtml.js', 'utf8');
const preload = readFileSync(ROOT + '/apps/overlay/dist/preload.cjs', 'utf8');

let fails = 0;
const check = (n, c, e = '') => { console.log((c ? '  OK  ' : 'FAIL  ') + n + (c ? '' : ' ' + e)); if (!c) fails++; };
const inTxt = (label, txt, needle) => check(label, txt.includes(needle), 'нет: ' + needle);

// ── №108 core: questRewards ────────────────────────────────────────────────
check('QUEST_REWARDS 22 записи', qr.QUEST_REWARDS.length === 22, String(qr.QUEST_REWARDS.length));
const spires = qr.QUEST_REWARDS.find(q => q.zone === 'The Spires of Deshar');
check('Spires of Deshar: ключ/зона/resist-lightning',
  !!spires && spires.key.includes('The Spires of Deshar') && spires.kind === 'resist' && spires.resistKind === 'lightning',
  JSON.stringify(spires));
check('importantQuests непусты и только spirit/resist/asc/passive',
  qr.importantQuestRewards().length > 0 && qr.importantQuestRewards().every(q => ['spirit','resist','ascendancy','passive'].includes(q.kind)));
check('questRewardsByZoneCode(G2_9_2) → Spires', qr.questRewardsByZoneCode('G2_9_2').some(q => q.zone === 'The Spires of Deshar'));
check('coverage RU строка заполнена', typeof qr.QUEST_REWARDS_COVERAGE_RU === 'string' && qr.QUEST_REWARDS_COVERAGE_RU.length > 20);

const unclaimed1 = qr.unclaimedQuests({ act: 1, furthest: { act: 1, index: 3 }, visitedCodes: [], claimed: [] });
check('unclaimed: act1 непусто со статусами missed/todo', Array.isArray(unclaimed1) && unclaimed1.length > 0 && unclaimed1.every(q => q.status === 'missed' || q.status === 'todo'));
check('unclaimed: claimed убирает награду',
  qr.unclaimedQuests({ act: 1, furthest: { act: 1, index: 3 }, visitedCodes: [], claimed: [unclaimed1[0].key] }).length === unclaimed1.length - 1);

// ── №112-lite core: endgame ────────────────────────────────────────────────
check('mechanicsOverview непусто с short_ru', eg.mechanicsOverview().length >= 10 && eg.mechanicsOverview().every(r => !!r.short_ru));
check('sekhemasFloorsForLevel 30/50/65/80 → 1/2/3/4',
  [30, 50, 65, 80].map(l => eg.sekhemasFloorsForLevel(l)).join(',') === '1,2,3,4');
check('waystoneTips непусто', eg.waystoneTips().length > 0);

// ── №108/№111/№110 overlay: main.js маркеры ───────────────────────────────
inTxt('main: claimedRewards персист', main, 'claimedRewards');
inTxt('main: ipc level:claim', main, 'level:claim');
inTxt('main: канал pinnacle:result', main, 'pinnacle:result');
inTxt('main: хоткей Control+F7', main, 'Control+F7');
inTxt('main: PINNACLE_HOTKEY/пиннакл', main, 'PINNACLE_HOTKEY');
inTxt('main: augment-детект (getAugments)', main, 'getAugments');
inTxt('main: unclaimedQuests в payload', main, 'unclaimedQuests');
inTxt('main: sekhemasFloorsForLevel в payload', main, 'sekhemasFloorsForLevel');

// ── рендерер + preload ────────────────────────────────────────────────────
inTxt('preload: levelClaim', preload, 'levelClaim');
inTxt('preload: onPinnacleResult', preload, 'onPinnacleResult');
inTxt('renderer: секция «Неполученные квесты»', renderer, 'Неполученные квесты');
inTxt('renderer: renderQuests + claim-клик', renderer, 'renderQuests');
inTxt('renderer: levelClaim вызов', renderer, 'levelClaim');
inTxt('renderer: подсветка резистов < 75', renderer, 'меньше 75%)');
inTxt('renderer: секция Эндгейм', renderer, 'Эндгейм');
inTxt('renderer: renderPinnacle + pin-rows', renderer, 'renderPinnacle');
inTxt('renderer: onPinnacleResult подписка', renderer, 'onPinnacleResult');
inTxt('renderer: строка аугмента', renderer, 'augLine');
inTxt('renderer: хоткей в панели настроек', renderer, 'Чекап перед пиннакл');
inTxt('renderer: группа Sekhemas в бестиарии', renderer, 'Trial of the Sekhemas');
inTxt('renderer: маркер «не подтверждено» №109', renderer, 'не подтверждено');

// (синтаксис dist проверяет smoke_renderer.mjs: файлы — ESM, new Function тут неприменим)
console.log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
