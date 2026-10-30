/**
 * W2-2: swap-слой — «примерка» предмета в слоты PoB-билда через oracle-сессию.
 *
 * Механика (всё поверх существующих методов хоста, контракт verified 30.10):
 *   session.load(build) → stats(baseline) → snapshot_build →
 *   для каждого слота-кандидата: restore_build(snap) → swap_item(itemText, slot)
 *     → stats(after) → verdictForSlot(...) → restore_build(snap).
 *
 * Примерка в несколько слотов (кольца 1/2 — идея reference poe2-upgrade-checker
 * «Rings, jewels tried in each slot they fit», №686; реализация своя).
 *
 * Движок недоступен (POE2K_POB2_SRC не задан / luajit нет) → честный
 * available:false (никогда не бросаем, паттерн pobHost.RecomputeUnavailable).
 */

import { PobSession } from './pobSession.js';
import { resolvePobHostPaths } from './pobHost.js';
import { decodeShareCode } from './pobcode.js';
import {
  verdictForSlot,
  pickBestSlot,
  DEFAULT_PRIORITIES,
  type UpgradePriorities,
  type UpgradeVerdict,
  type PobStatsLike,
} from './upgradeVerdict.js';
import { slotForItem } from './itemVerdict.js';
import { parseItemText } from './parse.js';

export interface SwapItemInput {
  /** PoB share-код (pobb.in/…/code или чистый) — приоритет. */
  pobCode?: string;
  /** Готовый XML билда. */
  xml?: string;
  /** Клир-текст кандидата (Ctrl+C, RU/EN). */
  itemText: string;
  /** Явные слоты PoB (например ['Ring 1','Ring 2']); по умолчанию — мультиплекс по классу. */
  slots?: string[];
  priorities?: Partial<UpgradePriorities>;
  /** Подмножество ключей статов (по умолчанию каталог хоста ~60). */
  stats?: string[];
}

export type SwapItemResult =
  | {
      available: true;
      /** Вердикт лучшей примерки (нулевая попытка тоже возможна: все слоты отвергнуты). */
      best: UpgradeVerdict | null;
      /** Все примерки: слот → вердикт/отказ. */
      attempts: Array<{ slot: string; verdict?: UpgradeVerdict; failed?: string }>;
      /** Baseline-статы билда без кандидата. */
      baseline: PobStatsLike;
    }
  | { available: false; reason: string; setupHint?: string };

/** Канон PoB-слотов (ItemsTab.baseSlots, verified исходником 30.10). */
const CANON_SLOTS = new Set([
  'Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots',
  'Amulet', 'Ring 1', 'Ring 2', 'Belt', 'Charm 1', 'Charm 2', 'Charm 3', 'Flask 1', 'Flask 2',
]);

/**
 * Мультиплекс слотов-кандидатов из класса предмета:
 * Ring → оба кольца; Weapon → Weapon 1 (swap-наборы не трогаем — активный
 * ItemSet сам решает через useSecondWeaponSet); Flask → оба слота фляг;
 * прочие → [свой слот].
 */
export function candidateSlotsFor(itemText: string, explicit?: string[]): string[] {
  if (explicit?.length) {
    const ok = explicit.filter((s) => CANON_SLOTS.has(s));
    return ok.length ? ok : [];
  }
  let canon = '';
  try {
    canon = slotForItem(parseItemText(itemText));
  } catch {
    return [];
  }
  switch (canon) {
    case 'Weapon':
      return ['Weapon 1'];
    case 'Shield':
      return ['Weapon 2'];
    case 'Ring':
      return ['Ring 1', 'Ring 2'];
    case 'Flask':
      return ['Flask 1', 'Flask 2'];
    case 'Belt':
      return ['Belt'];
    case 'Amulet':
      return ['Amulet'];
    case 'Helm':
      return ['Helmet'];
    case 'BodyArmour':
      return ['Body Armour'];
    case 'Gloves':
      return ['Gloves'];
    case 'Boots':
      return ['Boots'];
    default:
      return [];
  }
}

/**
 * Прогнать swap-цикл в ЖИВОМ движке. Один boot, все слоты в одной сессии.
 * Ошибка движимых шагов честно отражается в attempts[].failed.
 */
export async function swapVerdictForItem(
  input: SwapItemInput,
  env: NodeJS.ProcessEnv = process.env,
  session?: PobSession,
): Promise<SwapItemResult> {
  const own = !session;
  const ses = session ?? new PobSession(env);
  try {
    if (env.POE2K_RECOMPUTE === '0') {
      return { available: false, reason: 'Poe2 recompute отключён (POE2K_RECOMPUTE=0).' };
    }
    const paths = resolvePobHostPaths(env);
    if (paths.missing.length > 0) {
      return {
        available: false,
        reason: 'Headless-PoB рантайм не найден.',
        setupHint:
          'Сетап: node oracle/setup-headless.mjs (LuaJIT); клон PathOfBuildingCommunity/PathOfBuilding-PoE2 и env POE2K_POB2_SRC=<...>/src. Вердикт swap требует живого движка (эвристики нет — честный отказ).',
      };
    }
    let xml = input.xml ?? '';
    if (input.pobCode) {
      try {
        xml = decodeShareCode(input.pobCode);
      } catch (e) {
        return { available: false, reason: `PoB-код не декодировался: ${(e as Error).message}` };
      }
    }
    if (!xml) return { available: false, reason: 'Нужен pobCode или xml.' };

    const loaded = (await ses.load({ xml })) as { stats?: PobStatsLike };
    const baseline = (loaded.stats ?? {}) as PobStatsLike;
    const slots = candidateSlotsFor(input.itemText, input.slots);
    if (!slots.length) {
      return {
        available: true,
        best: null,
        attempts: [{ slot: '?', failed: 'класс предмета не определён — слот-кандидатов нет' }],
        baseline,
      };
    }

    // Снимок для откатов между примерками.
    const snap = (await ses.call<{ xml: string }>('snapshot_build', {})) as { xml: string };

    const list: Array<{ slot: string; verdict?: UpgradeVerdict; failed?: string }> = [];
    for (const slot of slots) {
      if (list.length > 0) {
        await ses.call('restore_build', { xml: snap.xml }).catch(() => undefined);
      }
      const res = (await ses.call<{ ok?: boolean; stats?: PobStatsLike; error?: string; errorCode?: string }>(
        'swap_item',
        { itemText: input.itemText, slot, ...(input.stats ? { keys: input.stats } : {}) },
      )) as { ok?: boolean; stats?: PobStatsLike; error?: string; errorCode?: string };
      if (res?.ok === false || !res?.stats) {
        list.push({ slot, failed: res?.error ?? `swap_item отклонён (${res?.errorCode ?? 'unknown'})` });
        continue;
      }
      const verdict = verdictForSlot(slot, baseline, res.stats, { ...DEFAULT_PRIORITIES, ...input.priorities });
      list.push({ slot, verdict });
    }
    // Вернуть билд в исходное состояние (гигиена сессии).
    await ses.call('restore_build', { xml: snap.xml }).catch(() => undefined);
    const best = pickBestSlot(list.map((a) => a.verdict).filter((v): v is UpgradeVerdict => v != null));
    return { available: true, best, attempts: list, baseline };
  } catch (err) {
    return { available: false, reason: `oracle-сессия: ${(err as Error).message}` };
  } finally {
    if (own) ses.dispose();
  }
}
