import Phaser from 'phaser';
import {
  DEFAULT_ISLAND_FOAM,
  type FishingLayerId,
  type FishingLayerLayout,
  type IslandFoamConfig,
} from './layout';

export const ISLAND_LAYER_IDS: FishingLayerId[] = ['islandForest', 'islandSmall', 'islandRocky'];

export function isIslandLayerId(id: string): id is FishingLayerId {
  return ISLAND_LAYER_IDS.includes(id as FishingLayerId);
}

export function isIslandLayer(layer: FishingLayerLayout) {
  return isIslandLayerId(layer.sourceId) || isIslandLayerId(layer.id);
}

export function getIslandFoam(layer: FishingLayerLayout): IslandFoamConfig {
  return { ...DEFAULT_ISLAND_FOAM, ...(layer.foam ?? {}) };
}

export function ensureIslandFoam(layer: FishingLayerLayout): IslandFoamConfig {
  if (!layer.foam) layer.foam = structuredClone(DEFAULT_ISLAND_FOAM);
  return layer.foam;
}

export function getIslandFoamWorldY(sprite: Phaser.GameObjects.Image, foam: IslandFoamConfig) {
  return sprite.y - sprite.displayHeight * 0.5
    + sprite.displayHeight * foam.waterlineRatio
    + foam.yOffset;
}

export function getIslandFoamHalfWidth(sprite: Phaser.GameObjects.Image, foam: IslandFoamConfig) {
  return sprite.displayWidth * foam.halfWidthRatio;
}

export function setIslandFoamFromWorldY(
  sprite: Phaser.GameObjects.Image,
  foam: IslandFoamConfig,
  worldY: number,
) {
  const top = sprite.y - sprite.displayHeight * 0.5;
  foam.waterlineRatio = Phaser.Math.Clamp(
    (worldY - foam.yOffset - top) / Math.max(1, sprite.displayHeight),
    0.08,
    0.92,
  );
}

/**
 * 沿一条水平线绘制手绘感的连续泡沫段，用于水面/水下分界线。
 * 与 drawContinuousFoamRing 同族，但没有边缘收窄，可以铺满整个可视范围。
 * 波纹基于绝对 X 坐标而非进度，随镜头滚动依然保持相同的波长与厚度。
 */
export function drawFoamStrip(
  target: Phaser.GameObjects.Graphics,
  startX: number,
  endX: number,
  waterY: number,
  yOffset: number,
  color: number,
  alpha: number,
  maxWidth: number,
  phase: number,
) {
  if (endX <= startX) return;
  const totalWidth = endX - startX;
  const segments = Math.max(24, Math.floor(totalWidth / 20));
  const points: Phaser.Math.Vector2[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const x = Phaser.Math.Linear(startX, endX, progress);
    const wobble = Math.sin(x * 0.021 + phase) * 1.35
      + Math.sin(x * 0.058 - phase * 0.6) * 0.6
      + Math.sin(x * 0.11 + phase * 1.35) * 0.25;
    points.push(new Phaser.Math.Vector2(x, waterY + yOffset + wobble));
  }
  for (let index = 0; index < segments; index += 1) {
    const midX = points[index].x + (points[index + 1].x - points[index].x) * 0.5;
    const thicknessVariation = 0.72
      + Math.sin(midX * 0.029 + phase) * 0.22
      + Math.sin(midX * 0.078 - phase * 0.85) * 0.1;
    const strokeWidth = Math.max(0.4, maxWidth * thicknessVariation);
    target.lineStyle(strokeWidth, color, alpha);
    target.lineBetween(
      points[index].x,
      points[index].y,
      points[index + 1].x,
      points[index + 1].y,
    );
  }
}

export function drawContinuousFoamRing(
  target: Phaser.GameObjects.Graphics,
  centerX: number,
  halfWidth: number,
  waterY: number,
  yOffset: number,
  color: number,
  alpha: number,
  maxWidth: number,
  phase: number,
) {
  const segments = 46;
  const startX = centerX - halfWidth;
  const endX = centerX + halfWidth;
  const points: Phaser.Math.Vector2[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const x = Phaser.Math.Linear(startX, endX, progress);
    const edgeLift = Math.pow(Math.abs(progress - 0.5) * 2, 3) * 1.4;
    const watercolorWobble = Math.sin(progress * Math.PI * 7 + phase) * 0.75
      + Math.sin(progress * Math.PI * 17 - phase * 0.6) * 0.3;
    const y = waterY + yOffset + edgeLift + watercolorWobble;
    points.push(new Phaser.Math.Vector2(x, y));
  }
  for (let index = 0; index < segments; index += 1) {
    const progress = (index + 0.5) / segments;
    const taper = Math.pow(Math.sin(progress * Math.PI), 0.55);
    const thicknessVariation = 0.78
      + Math.sin(progress * Math.PI * 5 + phase) * 0.18
      + Math.sin(progress * Math.PI * 11 - phase) * 0.08;
    const width = Math.max(0.35, maxWidth * taper * thicknessVariation);
    target.lineStyle(width, color, alpha);
    target.lineBetween(
      points[index].x,
      points[index].y,
      points[index + 1].x,
      points[index + 1].y,
    );
  }
}
