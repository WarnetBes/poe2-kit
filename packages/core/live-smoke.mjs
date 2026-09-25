// Live-смок против ЖИВЫХ API (P2 #19). Запускается по расписанию в CI и локально.
// Отличие от smoke.mjs: smoke.mjs — офлайн (без сети, против dist), этот файл —
// реально ходит в poe2scout / trade2 (pathofexile.com) / poe.ninja.
//
// Цель — регресс-защита от изменения схемы у провайдеров:
//   • poe2scout   — лиги и курсы валют, цены уников (BASE: api.poe2scout.com/poe2)
//   • trade2      — каталог статов /data/stats (ломается почти каждый патч),
//                   поиск раров; BASE: www.pathofexile.com/api/trade2
//   • poe.ninja   — история курса валют (economy/exchange).
//
// Выход: 0 = всё ок; 1 = какой-то живой провайдер сломался (менялась схема ИЛИ
// сеть недоступна). Фиксируем и то и другое — CI падает на регрессе схемы.

// --- Небольшой harness -----------------------------------------------------
let failed = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg, extra); failed++; }
};

// --- Импорт функций из собранного dist (как в smoke.mjs) ------------------
import {
  fetchLeagues,
  currentDefaultLeague,
  fetchBestCurrencyRates,
  fetchScoutCurrencyRates,
  fetchTradeStats,
  searchTradeByStats,
  priceUnique,
  fetchCurrencyHistory,
} from './dist/trade.js';

const started = Date.now();

async function main() {
  console.log('LIVE-SMOKE против живых API (poe2scout / trade2 / poe.ninja)');

  // ═══ 1. poe2scout — актуальный список лиг ═════════════════════════════════
  console.log('\n[1] poe2scout · лиги');
  let leagues = [];
  try {
    leagues = await fetchLeagues();
  } catch (e) {
    ok(false, `fetchLeagues не бросила исключение`, String(e?.message ?? e));
  }
  ok(Array.isArray(leagues) && leagues.length >= 1, `лиг получено: ${leagues.length}`);
  ok(leagues.every((l) => typeof l?.id === 'string' && l.id), 'каждая лига имеет id');
  ok(leagues.some((l) => typeof l.shortName === 'string'), 'есть лиги с shortName (для URL poe2scout)');
  ok(leagues.some((l) => l.isCurrent === true), 'есть актуальная (isCurrent) лига');

  // ═══ 2. активная лига по умолчанию ═══════════════════════════════════════
  console.log('\n[2] активная лига');
  let league = null;
  try {
    league = await currentDefaultLeague();
  } catch (e) {
    ok(false, 'currentDefaultLeague не бросила исключение', String(e?.message ?? e));
  }
  ok(typeof league === 'string' && league.length > 0, `активная лига: ${league}`);
  if (league && leagues.length) {
    const names = new Set(leagues.flatMap((l) => [l.id, l.shortName]).filter(Boolean));
    const known = [...names].some((n) => String(n).toLowerCase() === String(league).toLowerCase());
    ok(known, 'активная лига есть в списке poe2scout');
  }

  // ═══ 3. poe2scout — курсы валют в активной лиге ═══════════════════════════
  console.log('\n[3] poe2scout · курсы валют в активной лиге');
  let rates = [];
  try {
    rates = await fetchBestCurrencyRates(league ?? undefined);
  } catch (e) {
    ok(false, 'fetchBestCurrencyRates не бросила исключение', String(e?.message ?? e));
  }
  ok(Array.isArray(rates) && rates.length >= 5, `курсов получено: ${rates.length} (ожидал >= 5)`);
  ok(rates.every((r) => typeof r?.name === 'string' && r.name), 'каждый курс имеет name');
  ok(rates.some((r) => typeof r.chaosValue === 'number' && Number.isFinite(r.chaosValue)), 'есть числовые chaosValue');
  const chaos = rates.find((r) => r.name && /chaos/i.test(r.name));
  ok(!chaos || (Number.isFinite(chaos.chaosValue) && chaos.chaosValue > 0), chaos ? `chaos = ${chaos.chaosValue}` : 'chaos не найден — ок (имя может отличаться)');

  // ═══ 4. trade2 — stat-id таблица (КЛЮЧЕВОЙ РЕГРЕСС-ГЕЙТ) ══════════════════
  console.log('\n[4] trade2 · каталог статов /data/stats (ломается на патчах)');
  let stats = [];
  try {
    stats = await fetchTradeStats();
  } catch (e) {
    ok(false, 'fetchTradeStats не бросила исключение', String(e?.message ?? e));
  }
  ok(Array.isArray(stats) && stats.length >= 5000, `stat-id записей: ${stats.length} (ожидал >= 5000)`);
  ok(stats.every((s) => typeof s?.id === 'string' && typeof s?.text === 'string'), 'каждая запись имеет id и text');
  const knownPseudo = stats.some((s) => s.id === 'pseudo.pseudo_total_life');
  ok(knownPseudo, 'известный псевдо-стат pseudo.pseudo_total_life присутствует (схема не изменилась)');
  // Жизнеспособность матчинга: соберём фильтр из реального мода текста, который должен совпасть.
  const { matchStatFilter } = await import('./dist/trade.js');
  const matched = matchStatFilter('+62 to maximum Life', stats);
  ok(!!matched && typeof matched.id === 'string', matched ? `match "+62 to maximum Life" → ${matched.id}` : 'не сопоставил +life: схема изменилась?');

  // ═══ 5. trade2 — живой поиск рара по стату ════════════════════════════════
  console.log('\n[5] trade2 · поиск рара (Ruby Ring + life)');
  if (league) {
    try {
      const listings = await searchTradeByStats(
        { type: 'Ruby Ring', filters: stats.filter((s) => s.id === 'pseudo.pseudo_total_life').slice(0, 1).map((s) => ({ id: s.id, min: 40 })) },
        { limit: 3, league },
      );
      ok(Array.isArray(listings), `поиск вернул массив (${listings?.length ?? '!'} листингов)`);
      if (listings && listings.length) {
        const first = listings[0];
        ok(typeof first === 'object' && first !== null, 'первый листинг — объект');
        ok(typeof first.price === 'number' && Number.isFinite(first.price), `листинг.price = ${first?.price}`);
        ok(typeof first.currency === 'string' && first.currency, `листинг.currency = ${first?.currency}`);
      }
    } catch (e) {
      ok(false, 'searchTradeByStats не бросила исключение', String(e?.message ?? e));
    }
  } else {
    console.log('  — пропуск: нет активной лиги');
  }

  // ═══ 6. poe2scout — цена уника (Andvarius). null допустим (молодая лига/нет листинга),
  //     но выбрасывание исключения — регресс.
  console.log('\n[6] poe2scout · цена уника Andvarius');
  try {
    const v = await priceUnique('Andvarius', league ?? undefined, undefined, 'Gold Ring');
    if (v === null) {
      console.log('  (info) Andvarius не оценён — либо нет листинга в лиге, либо схема изменилась');
      // не засчитываем как fail: это валидная ситуация; схему ловит п.4
    } else {
      ok(Number.isFinite(v) && v > 0, `Andvarius = ${v} chaos`);
    }
  } catch (e) {
    ok(false, 'priceUnique не бросила исключение', String(e?.message ?? e));
  }

  // ═══ 7. poe.ninja — история курса валют ═══════════════════════════════════
  console.log('\n[7] poe.ninja · история курса валют');
  try {
    const hist = await fetchCurrencyHistory(league ?? undefined);
    ok(Array.isArray(hist) && hist.length >= 3, `точек истории: ${hist.length} (ожидал >= 3)`);
    if (hist.length) {
      const h = hist[0];
      ok(typeof h?.id !== 'undefined', 'точка истории имеет id');
      ok(Number.isFinite(h?.chaosValue), `точка истории chaosValue = ${h?.chaosValue}`);
      ok('totalChange' in h, 'точка истории имеет totalChange');
    }
  } catch (e) {
    ok(false, 'fetchCurrencyHistory не бросила исключение', String(e?.message ?? e));
  }

  // ═══ Итог ═════════════════════════════════════════════════════════════════
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failed === 0) {
    console.log(`\nLIVE-SMOKE: ALL OK (${secs}s) — все живые API отвечают, схема не сломана.`);
    process.exit(0);
  }
  console.error(`\nLIVE-SMOKE: ${failed} FAILED (${secs}s) — живые API/схема изменились или сеть недоступна.`);
  process.exit(1);
}

// По умолчанию при запуске: основной сценарий. Если передан пас-флаг — уже отфильтрован выше.
main().catch((e) => { console.error('LIVE-SMOKE: необработанная ошибка:', e); process.exit(1); });