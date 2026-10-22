/**
 * currency.ts — доступ к датасету иконок валют PoE2 (№586).
 *
 * Иконки: packages/core/data/game/currency/icons/*.webp (38 шт., харвест
 * scripts/fetch-currency-icons.mjs с poe2db). В portable-сборке НЕ вырезаются
 * (make-portable вырезает только data/game/ritual), поэтому путь устойчив.
 *
 * Потребитель — Electron-оверлей: main копирует иконки в userData рядом с
 * overlay.html (renderer грузится file://, CSP img-src 'self'), renderer
 * подставляет <img class="cur-ico"> рядом с ценой.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

function currencyDataDir(): string {
  // dist/currency.js → ../data/game/currency; в браузере не вызывается.
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data', 'game', 'currency');
}

/** Каталог webp-иконок валют (Node-only: overlay main / MCP / скрипты). */
export function currencyIconsDir(): string {
  if (!HAS_DISK) throw new Error('иконки валют доступны только под Node');
  return pathMod!.join(currencyDataDir(), 'icons');
}

/**
 * Список доступных валют — ключи currency_index.json
 * (lowercase, одинарные пробелы) + факт существования файла иконки.
 */
export function availableCurrencyIcons(): string[] {
  if (!HAS_DISK) return [];
  try {
    return fsMod!
      .readdirSync(currencyIconsDir())
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -5)) // minus '.webp', имя содержит пробелы
      .sort();
  } catch {
    return [];
  }
}
