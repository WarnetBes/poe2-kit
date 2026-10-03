// №197-смок (S10): скам-флаги листингов + чанковый fetch по 10 хэшей.
// Проверяем dist-ы core/overlay на маркеры реализации (после npm run build).
import { readFileSync } from 'node:fs';
let fail = 0;

const coreTrade = readFileSync('packages/core/dist/trade.js', 'utf8');
const coreQuery = readFileSync('packages/core/dist/tradeQuery.js', 'utf8');
const coreTypes = readFileSync('packages/core/dist/types.js', 'utf8');
const html = readFileSync('apps/overlay/dist/rendererHtml.js', 'utf8');
const css = readFileSync('apps/overlay/dist/rendererCss.js', 'utf8');

function need(ok, n, msg) {
  if (!ok) { console.log('FAIL ' + n + ': ' + msg); fail++; }
  else console.log('OK ' + n + ': ' + msg);
}

// 1. Core: экспортированная эвристика с порогами 0.25 / 4
need(/flagSuspiciousListings/.test(coreTrade) && /SUSPICIOUS_CHEAP_REL = 0\.25/.test(coreTrade) && /SUSPICIOUS_EXPENSIVE_REL = 4/.test(coreTrade),
  1, 'core/trade.js: flagSuspiciousListings + пороги 25% / 4x');

// 2. Core: граница применимости — медиана >= 5 и confidence exact/approx
need(/SUSPICIOUS_MIN_MEDIAN = 5/.test(coreTrade) && /'too-cheap'/.test(coreTrade) && /'overpriced'/.test(coreTrade),
  2, 'core/trade.js: мин-медиана 5 + значения флагов');

// 3. Core: проводка в priceCheck после attachListingChaos
need(/attachListingChaos\(listings, league\)[\s\S]{0,400}flagSuspiciousListings\(listings, estimate\)/.test(coreTrade),
  3, 'core/trade.js: priceCheck вызывает flagSuspiciousListings');

// 4. Core: чанковый fetch в trade.ts (i += TRADE_FETCH_CHUNK, цикл)
need(/TRADE_FETCH_CHUNK = 10/.test(coreTrade) && /i \+= TRADE_FETCH_CHUNK/.test(coreTrade) && !/Math\.min\(limit, 10\)/.test(coreTrade),
  4, 'core/trade.js: fetch чанками по 10, молчаливое обрезание удалено');

// 5. Core: тот же чанкинг в tradeQuery.ts
need(/i \+= 10/.test(coreQuery) && !/Math\.min\(limit, 10\)/.test(coreQuery),
  5, 'core/tradeQuery.js: fetch чанками по 10');

// 6. Core: лимит стата-поиска поднят до 20
need(/\{ league, limit: 20 \}/.test(coreTrade),
  6, 'core/trade.js: searchTradeByStats limit 20');

// 7. Тип: TradeListing.flags
need(/flags\?: string\[\]/.test(coreTypes) || readFileSync('packages/core/dist/types.d.ts', 'utf8').match(/flags\?\: string\[\]/),
  7, 'core/types: TradeListing.flags?: string[]');

// 8. Рендерер: маркеры too-cheap / overpriced
need(/too-cheap/.test(html) && /scam-flag/.test(html) && /дороже рынка/.test(html),
  8, 'rendererHtml: маркеры скам-флагов в списке листингов');

// 9. CSS: классы пометок
need(/\.scam-flag[^-]/.test(css) && /\.scam-flag-over/.test(css),
  9, 'rendererCss: .scam-flag / .scam-flag-over');

console.log(fail === 0 ? 'ALL OK' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
