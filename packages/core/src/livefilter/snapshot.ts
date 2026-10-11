/**
 * Live-price loot filter: сборка ценового снапшота из ГОТОВЫХ каналов core
 * (P3, план §1.2 «liveFilter/snapshot.ts» — №445).
 *
 * Никакой собственной сети: fetch-каналы (trade.fetchLeagueExaltRates /
 * fetchBestCurrencyRates) инъекцируются — тесты и тул подсовывают свои.
 *
 * Честность данных (грабли, зашитые в схему):
 *  - Курсы ДОЛЖНЫ быть живыми (divine-first no-fallback, P6): divineEx <= 0
 *    → снапшот помечен непригодным validateSnapshot — никаких констант.
 *  - poe2scout/poe.ninja НЕ дают листинги → uniqueBases/exceptional пусты:
 *    guardrails уников (min 3 listings) не позволит генератору скрыть уник
 *    по нулевым данным. Сканер листингов — phase-2 (§6.3 плана).
 *  - Валюта без цены (null в молодых лигах) — пропускается, не фантазируется.
 */

import type { CurrencyRate } from '../types.js';
import { fetchBestCurrencyRates, fetchLeagueExaltRates } from '../trade.js';
import {
  LIVE_FILTER_SCHEMA_VERSION,
  validateSnapshot,
  type CurrencyPrice,
  type LiveFilterSnapshot,
  type SourceStatus,
} from './rules.js';

export interface SnapshotChannels {
  /** Курсы divine/chaos к exalt (по умолчанию trade.fetchLeagueExaltRates). */
  rates?: (league: string) => Promise<{ chaosRate: number | null; divineRate: number | null }>;
  /** Список валют с ценами (по умолчанию trade.fetchBestCurrencyRates). */
  currency?: (league: string) => Promise<CurrencyRate[]>;
}

export interface BuildSnapshotResult {
  snapshot: LiveFilterSnapshot;
  /** Пустая строка = снапшот пригоден (см. validateSnapshot). */
  error: string;
}

/** Цена валюты → exalts: divine-цена приоритетна (P6 divine-first), иначе chaos. */
function toExalts(r: CurrencyRate, divineEx: number, chaosEx: number): number | null {
  if (r.divineValue != null && divineEx > 0) return r.divineValue * divineEx;
  if (r.chaosValue != null && chaosEx > 0) return r.chaosValue * chaosEx;
  return null;
}

/**
 * Собрать снапшот одной лиги из каналов. Возвращает снапшот ВО ВСЕХ случаях
 * (валидный или нет — решение вызывающего), плюс результат validateSnapshot.
 */
export async function buildLiveFilterSnapshot(
  league: string,
  channels: SnapshotChannels = {},
): Promise<BuildSnapshotResult> {
  const rates = channels.rates ?? ((l: string) => fetchLeagueExaltRates(l));
  const currency = channels.currency ?? ((l: string) => fetchBestCurrencyRates(l));

  const sources: Record<string, SourceStatus> = {};
  let divineEx = 0;
  let chaosEx = 0;
  try {
    const conv = await rates(league);
    divineEx = conv.divineRate ?? 0;
    chaosEx = conv.chaosRate ?? 0;
    sources['rates'] = { ok: divineEx > 0, fetchedAt: new Date().toISOString(), error: divineEx > 0 ? undefined : 'курс divine не получен' };
  } catch (error) {
    sources['rates'] = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const prices: CurrencyPrice[] = [];
  try {
    const list = await currency(league);
    for (const r of list) {
      if (r.divineValue == null && r.chaosValue == null) continue; // молодая лига без цен
      const valueEx = toExalts(r, divineEx, chaosEx);
      if (valueEx == null || !(valueEx > 0)) continue;
      prices.push({ name: r.name, category: 'currency', valueEx });
    }
    sources['currency'] = { ok: prices.length > 0, fetchedAt: new Date().toISOString(), error: prices.length > 0 ? undefined : 'пустой список валют' };
  } catch (error) {
    sources['currency'] = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const snapshot: LiveFilterSnapshot = {
    schemaVersion: LIVE_FILTER_SCHEMA_VERSION,
    league,
    generatedAt: new Date().toISOString(),
    rates: { divineEx, chaosEx },
    currency: prices,
    uniqueBases: {}, // листингов нет в каналах — уники не скрываем (guardrail §3)
    exceptional: [], // scanner = phase-2 (§6.3)
    sources,
  };
  return { snapshot, error: validateSnapshot(snapshot) };
}
