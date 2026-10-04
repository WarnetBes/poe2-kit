/**
 * WebGL-рендер полного дерева пассивок (P2 #24b «Игровой вид»).
 *
 * Тонкая обёртка над @poe2-toolkit/tree-react: вся геометрия — в
 * @poe2-toolkit/tree-core (buildScene), весь арт — GGG-экспорт (см.
 * scripts-комментарий в mount.ts). React живёт только в этом lazy-чанке
 * (таб «Карта» → тумблер «Игровой вид»), остальной web им не заражён.
 */
import { TreeView } from '@poe2-toolkit/tree-react';
import type { Scene, SpriteManifest, WorldRect } from '@poe2-toolkit/tree-core';
import type { TreeColors } from '@poe2-toolkit/tree-react';
import type { HubCentreSprites } from './centreSprites';

/**
 * Палитра diff-режима (№210 «Diff vs PoB»): weapon-set-тинты WebGL-сцены
 * переиспользуются как два цвета расхождений план ↔ PoB-билд.
 *   set 1 (оранжевый) — missing: узел есть в PoB-билде, но не взят в план;
 *   set 2 (фиолетовый) — extra: узел взят в план, но в PoB-билде его нет.
 * Совпадает со SVG-подсветкой (.mdiff-missing / .mdiff-extra в style.css).
 */
export const DIFF_TREE_COLORS: TreeColors = {
  weaponSet1: 0xff7847,
  weaponSet2: 0xb06bff,
};

export interface GameTreeProps {
  scene: Scene;
  manifest: SpriteManifest;
  atlases: Record<string, CanvasImageSource>;
  activeClassId?: number;
  /** Display-имя асценданси («Invoker») — его диск переносится в хаб. */
  activeAscendancy?: string;
  /** Хаб-арт (портрет класса + кольца), см. treeGame/centreSprites.ts. */
  centreSprites?: HubCentreSprites;
  onNodeClick?: (skill: number, screen: { x: number; y: number }) => void;
  /** Кастомные цвета weapon-set-ов; в diff-режиме — оранжевый/фиолетовый. */
  colors?: TreeColors;
  /** World rect для ре-фрейминга viewport (prop `focus` TreeView): центровка на узле. */
  focus?: WorldRect | null;
  /** Skill ids со стоячим teal-кольцом (prop `highlight` TreeView): хиты поиска. */
  highlight?: Set<number> | null;
}

export function GameTree({
  scene,
  manifest,
  atlases,
  activeClassId,
  activeAscendancy,
  centreSprites,
  onNodeClick,
  colors,
  focus,
  highlight,
}: GameTreeProps) {
  return (
    <TreeView
      scene={scene}
      resources={{ manifest, atlases }}
      wheelZoom
      activeClassId={activeClassId}
      activeAscendancy={activeAscendancy}
      centreSprites={centreSprites}
      focus={focus}
      highlight={highlight}
      onNodeClick={onNodeClick}
      className="tree-game-canvas"
      style={{ width: '100%', height: '100%' }}
      {...(colors ? { colors } : {})}
    />
  );
}
