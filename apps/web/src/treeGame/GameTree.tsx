/**
 * WebGL-рендер полного дерева пассивок (P2 #24b «Игровой вид»).
 *
 * Тонкая обёртка над @poe2-toolkit/tree-react: вся геометрия — в
 * @poe2-toolkit/tree-core (buildScene), весь арт — GGG-экспорт (см.
 * scripts-комментарий в mount.ts). React живёт только в этом lazy-чанке
 * (таб «Карта» → тумблер «Игровой вид»), остальной web им не заражён.
 */
import { TreeView } from '@poe2-toolkit/tree-react';
import type { Scene, SpriteManifest } from '@poe2-toolkit/tree-core';

export interface GameTreeProps {
  scene: Scene;
  manifest: SpriteManifest;
  atlases: Record<string, CanvasImageSource>;
  activeClassId?: number;
  /** Display-имя асценданси («Invoker») — его диск переносится в хаб. */
  activeAscendancy?: string;
  onNodeClick?: (skill: number, screen: { x: number; y: number }) => void;
}

export function GameTree({
  scene,
  manifest,
  atlases,
  activeClassId,
  activeAscendancy,
  onNodeClick,
}: GameTreeProps) {
  return (
    <TreeView
      scene={scene}
      resources={{ manifest, atlases }}
      wheelZoom
      activeClassId={activeClassId}
      activeAscendancy={activeAscendancy}
      onNodeClick={onNodeClick}
      className="tree-game-canvas"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
