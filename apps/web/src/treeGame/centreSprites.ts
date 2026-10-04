/**
 * Хаб-арт дерева пассивок (P2: «Игровой вид» → centreSprites).
 *
 * Официальный экспорт GGG уже несёт весь нужный арт — тот же, что донорный
 * buildCentre вырезает из GGPK (PassiveTreeMainCircle / …Active2), только
 * в виде webp-листов в половинном масштабе (meta.scale = 0.5 → 1 px листа
 * = 2 мировых юнита, что точно бьётся с радиусами хаба buildScene):
 *
 *   group-background.webp (4000×2000, два фрейма 2000² → 4000 мир. диаметр):
 *     startNode:MainCircleActive (0,0)      → ringActive  (вращающееся золото)
 *     startNode:MainCircle      (2000,0)    → ringStatic  (резная рамка)
 *   background-<class>.webp (3000×3000, фреймы 1500² → 3000 мир. диаметр):
 *     Class0 (0,0) = базовая иллюстрация класса → portrait (арт activeClass)
 *
 * TreeView грузит URL сам (лениво, onload → пересборка); sub-rect задаём мы.
 *
 * Выключение: URL-параметр `?hubart=0` — векторный фолбэк TreeView, как было.
 * Отсутствие/битость ассета не ломает рендер: спрайт просто не появляется
 * (одна строка в console.debug).
 */
import type { CentreSprite, TreeViewProps } from '@poe2-toolkit/tree-react';
import groupBgUrl from '../../../../packages/core/data/game/passive_tree/assets/group-background.webp?url';
import { classBgUrls } from '../classBgAssets';

/** Проп для TreeView. */
export type HubCentreSprites = TreeViewProps['centreSprites'];

/** Портрет = фрейм Class0 листа класса (1500² px = 3000 мир. юнитов = artRadius·2). */
const CLASS_PORTRAIT: CentreSprite = { url: '', sx: 0, sy: 0, sw: 1500, sh: 1500 };
/** Вращающееся золотое кольцо = startNode:MainCircleActive (2000² = activeRadius·2). */
const RING_ACTIVE: CentreSprite = { url: groupBgUrl, sx: 0, sy: 0, sw: 2000, sh: 2000 };
/** Резная рамка = startNode:MainCircle (2000² = frameRadius·2). */
const RING_STATIC: CentreSprite = { url: groupBgUrl, sx: 2000, sy: 0, sw: 2000, sh: 2000 };

/** `?hubart=0` — выключить хаб-арт (векторный фолбэк). */
export const hubArtEnabled = (): boolean =>
  new URLSearchParams(window.location.search).get('hubart') !== '0';

/** Проверенные URL: 'ok' молчим, 'fail' — одна строка в console.debug. */
const probed = new Set<string>();

/** Мягкий щуп ассета: onerror → одна отладочная строка, рендер не трогаем. */
function probe(url: string): void {
  if (probed.has(url)) return;
  probed.add(url);
  const img = new Image();
  img.onerror = () => {
    console.debug(`[treeGame] хаб-арт недоступен: ${url} — рисуем без него`);
  };
  img.src = url;
}

/** Кэш по имени класса — стабильная ссылка пропа между re-render'ами. */
let memoName: string | undefined;
let memoSprites: HubCentreSprites | undefined;

/**
 * Спрайты хаба: рамки — всегда, портрет — арт активного класса (нет выбора
 * класса → без портрета, кольца остаются). undefined — хаб-арт выключен.
 */
export function buildCentreSprites(className?: string): HubCentreSprites {
  if (!hubArtEnabled()) return undefined;
  if (className === memoName) return memoSprites;

  const sheet = className ? classBgUrls(className) : undefined;
  if (sheet) CLASS_PORTRAIT.url = sheet;

  memoSprites =
    sheet === undefined
      ? { ringStatic: RING_STATIC, ringActive: RING_ACTIVE }
      : { portrait: CLASS_PORTRAIT, ringStatic: RING_STATIC, ringActive: RING_ACTIVE };
  memoName = className;

  probe(groupBgUrl);
  if (sheet) probe(sheet);
  return memoSprites;
}
