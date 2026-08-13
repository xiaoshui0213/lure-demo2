import Phaser from 'phaser';
import {
  loadSceneAssetUrls,
  saveSceneAsset,
} from '../fishing-scene/customAssets';
import {
  cloneDefaultFishingLayout,
  DEFAULT_WATER_FLOW,
  loadFishingSceneLayout,
  saveFishingSceneLayout,
  type FishingLayerId,
  type FishingLayerLayout,
  type FishingSceneLayout,
} from '../fishing-scene/layout';
import {
  drawContinuousFoamRing,
  ensureIslandFoam,
  getIslandFoam,
  getIslandFoamHalfWidth,
  getIslandFoamWorldY,
  isIslandLayer,
  setIslandFoamFromWorldY,
} from '../fishing-scene/islandFoam';
import {
  FISHING_MAPS,
  getFishingMapIdFromLocation,
} from '../fishing-scene/maps';

const VIEW_W = 1280;
const VIEW_H = 720;
const BOAT_VERTICAL_SHIFT = 0;
const EDITOR_MAP_ID = getFishingMapIdFromLocation() ?? 'fishing-map-01';
const EDITOR_MAP = FISHING_MAPS[EDITOR_MAP_ID];
let customAssetUrls = new Map<string, string>();
const PLAYER_LAYER_IDS = ['player-boat', 'player-fisher', 'player-rod'] as const;
type PlayerLayerId = typeof PLAYER_LAYER_IDS[number];

const PLAYER_LAYER_NAMES: Record<PlayerLayerId, string> = {
  'player-boat': '人物与船（含倒影）',
  'player-fisher': '旧旅人图层（已停用）',
  'player-rod': '鱼竿',
};

function isPlayerLayerId(id: string): id is PlayerLayerId {
  return PLAYER_LAYER_IDS.includes(id as PlayerLayerId);
}

const LAYER_ORDER: FishingLayerId[] = [
  'sky',
  'far',
  'middle',
  'forest',
  'islandForest',
  'islandSmall',
  'islandRocky',
  'water',
  'underwater',
];

function byId<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing editor element: ${id}`);
  return element as T;
}

class FishingSceneEditor extends Phaser.Scene {
  private layout: FishingSceneLayout = loadFishingSceneLayout(EDITOR_MAP_ID);
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private selectedId = 'far';
  private copiedLayer?: FishingLayerLayout;
  private pasteCount = 0;
  private selection!: Phaser.GameObjects.Graphics;
  private waterlineGuide!: Phaser.GameObjects.Graphics;
  private foamPreview!: Phaser.GameObjects.Graphics;
  private foamHandle!: Phaser.GameObjects.Zone;
  private waterFlowPreview?: Phaser.GameObjects.TileSprite;
  private waterFlowTime = 0;
  private boatPreview!: Phaser.GameObjects.Image;
  private characterGlowPreview!: Phaser.GameObjects.Image;
  private fisherPreview!: Phaser.GameObjects.Image;
  private rodPreview!: Phaser.GameObjects.Graphics;
  private rodHitZone!: Phaser.GameObjects.Zone;
  private routeScrollX = 0;

  constructor() {
    super('FishingSceneEditor');
  }

  preload() {
    this.load.image('scene-sky', EDITOR_MAP.assets.sky);
    this.load.image('scene-far', EDITOR_MAP.assets.far);
    this.load.image('scene-middle', EDITOR_MAP.assets.middle);
    this.load.image('scene-forest', EDITOR_MAP.assets.forest);
    this.load.image('scene-island-small', EDITOR_MAP.assets.islandSmall);
    this.load.image('scene-island-forest', EDITOR_MAP.assets.islandForest);
    this.load.image('scene-island-rocky', EDITOR_MAP.assets.islandRocky);
    this.load.image('scene-water', EDITOR_MAP.assets.water);
    this.load.image('scene-underwater', EDITOR_MAP.assets.underwater);
    this.load.image('player-boat', EDITOR_MAP.assets.boat);
    this.load.image('player-fisher', '/fishing/fisher.png');
    for (const layer of this.layout.copies) {
      if (!layer.assetId) continue;
      const url = customAssetUrls.get(layer.assetId);
      if (url) this.load.image(layer.textureKey, url);
    }
  }

  create() {
    this.cameras.main.setBounds(0, 0, VIEW_W + 3000, VIEW_H);
    this.registerWaterFrame();
    this.registerSeamlessWaterTexture();
    for (const layer of this.getAllLayers()) this.createLayerSprite(layer);
    this.createPlayerPreviews();

    this.waterlineGuide = this.add.graphics().setDepth(1000).setScrollFactor(0, 1);
    this.foamPreview = this.add.graphics().setDepth(998);
    this.foamHandle = this.add.zone(0, 0, 120, 16)
      .setDepth(999)
      .setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(this.foamHandle);
    this.selection = this.add.graphics().setDepth(1001);
    this.bindDom();
    this.bindCanvasInput();
    this.bindDropImport();
    this.selectLayer(
      isPlayerLayerId(this.selectedId) || this.getAllLayers().some((layer) => layer.id === this.selectedId)
        ? this.selectedId
        : 'player-boat',
    );
  }

  update(_time: number, deltaMs: number) {
    if (!this.waterFlowPreview?.visible) return;
    const flow = this.layout.layers.water.waterFlow ?? DEFAULT_WATER_FLOW;
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.waterFlowTime += dt;
    this.waterFlowPreview.tilePositionX += dt * (
      flow.speedX + Math.sin(this.waterFlowTime * 0.48) * flow.speedVariation
    );
    this.waterFlowPreview.tilePositionY = Math.sin(this.waterFlowTime * flow.verticalSpeed) * flow.verticalAmount;
  }

  private registerWaterFrame() {
    const texture = this.textures.get('scene-water');
    const source = texture.getSourceImage() as HTMLImageElement;
    const y = Math.round(source.height * EDITOR_MAP.waterBand.startRatio);
    const height = Math.round(source.height * EDITOR_MAP.waterBand.heightRatio);
    if (!texture.has('usable-band')) texture.add('usable-band', 0, 0, y, source.width, height);
  }

  private registerSeamlessWaterTexture() {
    if (this.textures.exists('scene-water-editor-seamless')) return;
    const source = this.textures.get('scene-water').getSourceImage() as HTMLImageElement;
    const bandY = Math.round(source.height * EDITOR_MAP.waterBand.startRatio);
    const bandHeight = Math.round(source.height * EDITOR_MAP.waterBand.heightRatio);
    const texture = this.textures.createCanvas(
      'scene-water-editor-seamless',
      source.width * 2,
      bandHeight * 2,
    );
    const context = texture.context;
    context.clearRect(0, 0, source.width * 2, bandHeight * 2);

    // 四象限镜像，避免纵向流动越过纹理边缘时出现横向裁切线。
    context.drawImage(source, 0, bandY, source.width, bandHeight, 0, 0, source.width, bandHeight);
    context.save();
    context.translate(source.width * 2, 0);
    context.scale(-1, 1);
    context.drawImage(source, 0, bandY, source.width, bandHeight, 0, 0, source.width, bandHeight);
    context.restore();

    context.save();
    context.translate(0, bandHeight * 2);
    context.scale(1, -1);
    context.drawImage(texture.canvas, 0, 0, source.width * 2, bandHeight, 0, 0, source.width * 2, bandHeight);
    context.restore();
    texture.refresh();
  }

  private createLayerSprite(layer: FishingLayerLayout) {
    const frame = layer.sourceId === 'water' ? 'usable-band' : undefined;
    const sprite = this.add.image(layer.x, layer.y, layer.textureKey, frame)
      .setData('layerId', layer.id)
      .setScrollFactor(this.getEditorScrollFactor(layer), 1)
      .setInteractive({ pixelPerfect: true, alphaTolerance: 2, useHandCursor: true });
    if (layer.sourceId === 'water' || layer.sourceId === 'underwater') sprite.setOrigin(0.5, 0);
    this.input.setDraggable(sprite);
    sprite.on('pointerdown', () => this.selectLayer(layer.id));
    this.sprites.set(layer.id, sprite);
    if (layer.id === 'water') {
      this.waterFlowPreview?.destroy();
      this.waterFlowPreview = this.add.tileSprite(layer.x, layer.y, 1, 1, 'scene-water-editor-seamless')
        .setOrigin(0.5, 0)
        .setScrollFactor(0, 1);
    }
    this.applyLayer(layer);
  }

  private applyLayer(layer: FishingLayerLayout) {
    const sprite = this.sprites.get(layer.id);
    if (!sprite) return;
    sprite
      .setPosition(layer.x, layer.y)
      .setScrollFactor(this.getEditorScrollFactor(layer), 1)
      .setAlpha(layer.alpha)
      .setDepth(layer.depth)
      .setVisible(layer.visible);

    const naturalHeight = layer.height ?? layer.width * (sprite.frame.realHeight / sprite.frame.realWidth);
    sprite.setDisplaySize(layer.width * layer.stretchX, naturalHeight * layer.stretchY);
    if (layer.id === 'water' && this.waterFlowPreview) {
      const displayWidth = layer.width * layer.stretchX;
      const displayHeight = naturalHeight * layer.stretchY;
      const source = this.textures.get(layer.textureKey).getSourceImage() as HTMLImageElement;
      const bandHeight = Math.round(source.height * EDITOR_MAP.waterBand.heightRatio);
      this.waterFlowPreview
        .setPosition(layer.x, layer.y)
        .setSize(displayWidth, displayHeight)
        .setDisplaySize(displayWidth, displayHeight)
        .setTileScale(displayWidth / source.width, displayHeight / bandHeight)
        .setAlpha(layer.alpha)
        .setDepth(layer.depth + 0.01)
        .setVisible(layer.visible);
      // 原 Image 继续承担像素级点击与拖拽，视觉交给可流动的 TileSprite。
      sprite.setAlpha(layer.visible ? 0.001 : 0);
    }
  }

  private getPlayerSurfaceY() {
    return this.layout.waterlineY + BOAT_VERTICAL_SHIFT;
  }

  private getEditorScrollFactor(layer: FishingLayerLayout) {
    const isBaseBackdrop = layer.id === layer.sourceId && !isIslandLayer(layer);
    return isBaseBackdrop ? 0 : layer.parallax;
  }

  private getBoatPosition() {
    const player = this.layout.player;
    return {
      x: player.previewX,
      y: this.getPlayerSurfaceY() + player.boat.waterlineOffset,
    };
  }

  private isLayerLocked(id = this.selectedId) {
    if (id === 'player-boat') return this.layout.player.boat.locked ?? false;
    if (id === 'player-fisher') return this.layout.player.fisher.locked ?? false;
    if (id === 'player-rod') return this.layout.player.rod.locked ?? false;
    return this.getLayer(id)?.locked ?? false;
  }

  private setLayerLocked(id: string, locked: boolean) {
    if (id === 'player-boat') this.layout.player.boat.locked = locked;
    else if (id === 'player-fisher') this.layout.player.fisher.locked = locked;
    else if (id === 'player-rod') this.layout.player.rod.locked = locked;
    else {
      const layer = this.getLayer(id);
      if (layer) layer.locked = locked;
    }
    this.renderLayerList();
    this.refreshEditorLockState();
    this.drawGuides();
  }

  private refreshEditorLockState() {
    const locked = this.isLayerLocked();
    const ids = [
      'x', 'y', 'width', 'height', 'depth', 'parallax', 'scale',
      'stretch-x', 'stretch-y', 'repeat-horizontal', 'alpha', 'rod-angle',
      'foam-visible', 'foam-waterline-y', 'foam-y-offset', 'foam-half-width',
      'water-flow-speed-x', 'water-flow-variation',
      'water-flow-vertical-amount', 'water-flow-vertical-speed',
      'glow-offset-x', 'glow-offset-y', 'glow-scale-x', 'glow-scale-y',
      'glow-radius', 'glow-strength', 'glow-alpha',
    ];
    for (const id of ids) {
      const element = document.getElementById(id) as HTMLInputElement | null;
      if (element) element.disabled = locked;
    }
    for (const id of ['scale-down', 'scale-reset', 'scale-up', 'stretch-reset', 'glow-reset']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = locked;
    }
  }

  private getFisherPosition() {
    const boat = this.getBoatPosition();
    const fisher = this.layout.player.fisher;
    return {
      x: boat.x + fisher.offsetX,
      y: boat.y + fisher.offsetY,
    };
  }

  private getRodGripPosition() {
    const fisher = this.getFisherPosition();
    const rod = this.layout.player.rod;
    return {
      x: fisher.x + rod.gripOffsetX,
      y: fisher.y + rod.gripOffsetY,
    };
  }

  /** 移动渔船时保持旅人、鱼竿在屏幕上的绝对位置不变。 */
  private setBoatPositionPreservingOthers(previewX: number, waterlineOffset: number) {
    const player = this.layout.player;
    const fisherAbs = this.getFisherPosition();
    const gripAbs = this.getRodGripPosition();
    player.previewX = Math.round(previewX);
    player.boat.waterlineOffset = Math.round(waterlineOffset);
    const boat = this.getBoatPosition();
    player.fisher.offsetX = Math.round(fisherAbs.x - boat.x);
    player.fisher.offsetY = Math.round(fisherAbs.y - boat.y);
    const fisher = this.getFisherPosition();
    player.rod.gripOffsetX = Math.round(gripAbs.x - fisher.x);
    player.rod.gripOffsetY = Math.round(gripAbs.y - fisher.y);
  }

  /** 移动旅人时保持鱼竿握点在屏幕上的绝对位置不变。 */
  private setFisherOffsetPreservingRod(offsetX: number, offsetY: number) {
    const player = this.layout.player;
    const gripAbs = this.getRodGripPosition();
    player.fisher.offsetX = Math.round(offsetX);
    player.fisher.offsetY = Math.round(offsetY);
    const fisher = this.getFisherPosition();
    player.rod.gripOffsetX = Math.round(gripAbs.x - fisher.x);
    player.rod.gripOffsetY = Math.round(gripAbs.y - fisher.y);
  }

  private createPlayerPreviews() {
    this.createCharacterGlowPreviewTexture();
    this.characterGlowPreview = this.add.image(0, 0, 'editor-character-glow-mask')
      .setTint(0x57e6dc)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScrollFactor(0, 1);
    this.boatPreview = this.add.image(0, 0, 'player-boat')
      .setData('layerId', 'player-boat')
      .setScrollFactor(0, 1)
      .setInteractive({ useHandCursor: true });
    this.fisherPreview = this.add.image(0, 0, 'player-fisher')
      .setData('layerId', 'player-fisher')
      .setScrollFactor(0, 1)
      .setInteractive({ useHandCursor: true });
    this.rodPreview = this.add.graphics().setScrollFactor(0, 1);
    this.rodHitZone = this.add.zone(0, 0, 96, 96)
      .setData('layerId', 'player-rod')
      .setScrollFactor(0, 1)
      .setInteractive({ useHandCursor: true });

    for (const target of [this.boatPreview, this.fisherPreview, this.rodHitZone]) {
      this.input.setDraggable(target);
      target.on('pointerdown', () => this.selectLayer(target.getData('layerId') as string));
    }

    this.applyPlayerLayers();
  }

  private createCharacterGlowPreviewTexture() {
    const key = 'editor-character-glow-mask';
    if (this.textures.exists(key)) return;
    const source = this.textures.get('player-boat').getSourceImage() as HTMLImageElement;
    const texture = this.textures.createCanvas(key, source.width, source.height);
    if (!texture) return;
    const ctx = texture.context;
    const sx = source.width / 1024;
    const sy = source.height / 576;
    ctx.beginPath();
    ctx.moveTo(474 * sx, 5 * sy);
    ctx.bezierCurveTo(438 * sx, 5 * sy, 418 * sx, 27 * sy, 423 * sx, 58 * sy);
    ctx.bezierCurveTo(421 * sx, 84 * sy, 436 * sx, 102 * sy, 454 * sx, 109 * sy);
    ctx.lineTo(438 * sx, 120 * sy);
    ctx.bezierCurveTo(401 * sx, 126 * sy, 366 * sx, 151 * sy, 338 * sx, 184 * sy);
    ctx.lineTo(291 * sx, 221 * sy);
    ctx.lineTo(581 * sx, 239 * sy);
    ctx.bezierCurveTo(592 * sx, 211 * sy, 589 * sx, 177 * sy, 565 * sx, 149 * sy);
    ctx.bezierCurveTo(552 * sx, 134 * sy, 532 * sx, 124 * sy, 511 * sx, 118 * sy);
    ctx.lineTo(501 * sx, 107 * sy);
    ctx.bezierCurveTo(527 * sx, 95 * sy, 537 * sx, 74 * sy, 531 * sx, 48 * sy);
    ctx.bezierCurveTo(528 * sx, 20 * sy, 505 * sx, 5 * sy, 474 * sx, 5 * sy);
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5 * Math.max(sx, sy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    texture.refresh();
  }

  private applyPlayerLayers() {
    const player = this.layout.player;
    const boatPos = this.getBoatPosition();
    const boatSource = this.textures.get('player-boat').getSourceImage() as HTMLImageElement;
    const boatRatio = boatSource.height / boatSource.width;
    this.boatPreview
      .setPosition(boatPos.x, boatPos.y)
      .setOrigin(0.5, 0.497)
      .setDisplaySize(player.boat.width, player.boat.width * boatRatio)
      .setDepth(player.boat.depth)
      .setVisible(player.boat.visible);

    const glow = player.glow;
    this.characterGlowPreview
      .setPosition(boatPos.x + glow.offsetX, boatPos.y + glow.offsetY)
      .setOrigin(0.5, 0.497)
      .setDisplaySize(
        player.boat.width * glow.scaleX,
        player.boat.width * boatRatio * glow.scaleY,
      )
      .setDepth(player.boat.depth - 0.1)
      .setAlpha(glow.alpha)
      .setVisible(EDITOR_MAP_ID === 'fishing-map-02' && player.boat.visible);
    this.characterGlowPreview.preFX?.clear();
    this.characterGlowPreview.preFX?.addGlow(0x57e6dc, glow.strength, 0.18, true, 0.13, glow.radius);

    const fisherSource = this.textures.get('player-fisher').getSourceImage() as HTMLImageElement;
    const fisherRatio = fisherSource.width / fisherSource.height;
    const fisherPos = this.getFisherPosition();
    this.fisherPreview
      .setPosition(fisherPos.x, fisherPos.y)
      .setOrigin(player.fisher.originX, player.fisher.originY)
      .setDisplaySize(player.fisher.height * fisherRatio, player.fisher.height)
      .setDepth(player.fisher.depth)
      .setVisible(player.fisher.visible);

    this.drawRodPreview();
  }

  private drawRodPreview() {
    const rod = this.layout.player.rod;
    const grip = this.getRodGripPosition();
    this.rodPreview.clear().setDepth(rod.depth).setVisible(rod.visible);
    this.rodHitZone.setPosition(grip.x, grip.y).setVisible(rod.visible);
    if (!rod.visible) return;

    const tipX = grip.x + Math.cos(rod.restAngle) * rod.length;
    const tipY = grip.y + Math.sin(rod.restAngle) * rod.length;
    const segmentCount = 8;
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < segmentCount; i += 1) {
      const t0 = i / segmentCount;
      const t1 = (i + 1) / segmentCount;
      const x0 = Phaser.Math.Linear(grip.x, tipX, t0);
      const y0 = Phaser.Math.Linear(grip.y, tipY, t0);
      const x1 = Phaser.Math.Linear(grip.x, tipX, t1);
      const y1 = Phaser.Math.Linear(grip.y, tipY, t1);
      points.push(new Phaser.Math.Vector2(x0, y0));
      this.rodPreview.lineStyle(
        EDITOR_MAP_ID === 'fishing-map-02' ? Phaser.Math.Linear(4.8, 1.2, t0) : 3,
        EDITOR_MAP_ID === 'fishing-map-02' ? 0x526f7f : 0x5a4030,
        1,
      );
      this.rodPreview.lineBetween(x0, y0, x1, y1);
    }
    if (EDITOR_MAP_ID === 'fishing-map-02' && points.length > 1) {
      this.rodPreview.lineStyle(7, 0x263846, 1);
      this.rodPreview.lineBetween(points[0].x, points[0].y, points[1].x, points[1].y);
    } else {
      this.rodPreview.fillStyle(0xc8a066, 1);
      this.rodPreview.fillCircle(grip.x, grip.y, 4);
    }
  }

  private handlePlayerDrag(id: PlayerLayerId, dragX: number, dragY: number) {
    if (this.isLayerLocked(id)) return;
    const player = this.layout.player;
    const surfaceY = this.getPlayerSurfaceY();
    if (id === 'player-boat') {
      this.setBoatPositionPreservingOthers(dragX, dragY - surfaceY);
    } else if (id === 'player-fisher') {
      const boat = this.getBoatPosition();
      this.setFisherOffsetPreservingRod(dragX - boat.x, dragY - boat.y);
    } else {
      const fisher = this.getFisherPosition();
      player.rod.gripOffsetX = Math.round(dragX - fisher.x);
      player.rod.gripOffsetY = Math.round(dragY - fisher.y);
    }
    this.selectedId = id;
    this.applyPlayerLayers();
    this.renderLayerList();
    this.refreshForm();
    this.refreshEditorLockState();
    this.drawGuides();
  }

  private nudgePlayerLayer(dx: number, dy: number) {
    if (this.isLayerLocked()) return;
    const player = this.layout.player;
    const surfaceY = this.getPlayerSurfaceY();
    if (this.selectedId === 'player-boat') {
      this.setBoatPositionPreservingOthers(
        player.previewX + dx,
        player.boat.waterlineOffset + dy,
      );
    } else if (this.selectedId === 'player-fisher') {
      this.setFisherOffsetPreservingRod(
        player.fisher.offsetX + dx,
        player.fisher.offsetY + dy,
      );
    } else if (this.selectedId === 'player-rod') {
      player.rod.gripOffsetX += dx;
      player.rod.gripOffsetY += dy;
    }
    this.applyPlayerLayers();
    this.refreshForm();
    this.drawGuides();
  }

  private setPlayerVisible(id: PlayerLayerId, visible: boolean) {
    if (id === 'player-boat') this.layout.player.boat.visible = visible;
    else if (id === 'player-fisher') this.layout.player.fisher.visible = visible;
    else this.layout.player.rod.visible = visible;
    this.applyPlayerLayers();
    this.drawGuides();
  }

  private updatePlayerNumericField(field: 'x' | 'y' | 'width' | 'height' | 'depth' | 'rodAngle', value: number) {
    const player = this.layout.player;
    const surfaceY = this.getPlayerSurfaceY();
    if (this.selectedId === 'player-boat') {
      if (field === 'x') {
        this.setBoatPositionPreservingOthers(value, player.boat.waterlineOffset);
      } else if (field === 'y') {
        this.setBoatPositionPreservingOthers(player.previewX, value - surfaceY);
      } else if (field === 'width') player.boat.width = Math.max(40, value);
      else if (field === 'depth') player.boat.depth = value;
    } else if (this.selectedId === 'player-fisher') {
      const boat = this.getBoatPosition();
      const fisherPos = this.getFisherPosition();
      if (field === 'x') this.setFisherOffsetPreservingRod(value - boat.x, fisherPos.y - boat.y);
      else if (field === 'y') this.setFisherOffsetPreservingRod(fisherPos.x - boat.x, value - boat.y);
      else if (field === 'height') player.fisher.height = Math.max(20, value);
      else if (field === 'depth') player.fisher.depth = value;
    } else if (this.selectedId === 'player-rod') {
      const fisher = this.getFisherPosition();
      if (field === 'x') {
        player.rod.gripOffsetX = Math.round(value - fisher.x);
      } else if (field === 'y') {
        player.rod.gripOffsetY = Math.round(value - fisher.y);
      } else if (field === 'width') player.rod.length = Math.max(20, value);
      else if (field === 'depth') player.rod.depth = value;
      else if (field === 'rodAngle') player.rod.restAngle = value;
    }
    this.applyPlayerLayers();
    this.renderLayerList();
    this.drawGuides();
  }

  private getPlayerUniformScale() {
    const defaults = cloneDefaultFishingLayout(EDITOR_MAP_ID).player;
    const player = this.layout.player;
    if (this.selectedId === 'player-boat') return player.boat.width / defaults.boat.width;
    if (this.selectedId === 'player-fisher') return player.fisher.height / defaults.fisher.height;
    if (this.selectedId === 'player-rod') return player.rod.length / defaults.rod.length;
    return 1;
  }

  private setPlayerUniformScale(rawScale: number) {
    const scale = Phaser.Math.Clamp(rawScale, 0.2, 3);
    const defaults = cloneDefaultFishingLayout(EDITOR_MAP_ID).player;
    const player = this.layout.player;
    if (this.selectedId === 'player-boat') player.boat.width = Math.round(defaults.boat.width * scale);
    else if (this.selectedId === 'player-fisher') player.fisher.height = Math.round(defaults.fisher.height * scale);
    else if (this.selectedId === 'player-rod') player.rod.length = Math.round(defaults.rod.length * scale);
    this.applyPlayerLayers();
    this.refreshForm();
    this.drawGuides();
  }

  private resetPlayerScale() {
    const defaults = cloneDefaultFishingLayout(EDITOR_MAP_ID).player;
    const player = this.layout.player;
    if (this.selectedId === 'player-boat') player.boat.width = defaults.boat.width;
    else if (this.selectedId === 'player-fisher') player.fisher.height = defaults.fisher.height;
    else if (this.selectedId === 'player-rod') player.rod.length = defaults.rod.length;
    this.applyPlayerLayers();
    this.refreshForm();
    this.drawGuides();
  }

  private getPlayerSelectionBounds(): Phaser.Geom.Rectangle | undefined {
    if (this.selectedId === 'player-boat' && this.boatPreview.visible) return this.boatPreview.getBounds();
    if (this.selectedId === 'player-fisher' && this.fisherPreview.visible) return this.fisherPreview.getBounds();
    if (this.selectedId === 'player-rod' && this.layout.player.rod.visible) {
      const grip = this.getRodGripPosition();
      const rod = this.layout.player.rod;
      const tipX = grip.x + Math.cos(rod.restAngle) * rod.length;
      const tipY = grip.y + Math.sin(rod.restAngle) * rod.length;
      const minX = Math.min(grip.x, tipX) - 8;
      const maxX = Math.max(grip.x, tipX) + 8;
      const minY = Math.min(grip.y, tipY) - 8;
      const maxY = Math.max(grip.y, tipY) + 8;
      return new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY);
    }
    return undefined;
  }

  private setSceneryFieldVisible(visible: boolean) {
    const sceneryIds = [
      'field-parallax', 'field-stretch-x', 'field-stretch-y',
      'field-repeat', 'field-alpha', 'field-waterline', 'foam-section',
    ];
    for (const id of sceneryIds) {
      const element = document.getElementById(id);
      if (element) element.style.display = visible ? '' : 'none';
    }
    const stretchReset = document.getElementById('stretch-reset');
    if (stretchReset) stretchReset.style.display = visible ? '' : 'none';
    const rodAngleField = document.getElementById('field-rod-angle');
    if (rodAngleField) {
      rodAngleField.style.display = !visible && this.selectedId === 'player-rod' ? '' : 'none';
    }
    this.updateFoamSectionVisibility();
    const boatFoamSection = document.getElementById('boat-foam-section');
    if (boatFoamSection) boatFoamSection.style.display = this.selectedId === 'player-boat' ? '' : 'none';
    const waterFlowSection = document.getElementById('water-flow-section');
    if (waterFlowSection) {
      const showWaterFlow = !isPlayerLayerId(this.selectedId) && this.getSelectedLayer().sourceId === 'water';
      waterFlowSection.style.display = showWaterFlow ? '' : 'none';
    }
  }

  private updateFoamSectionVisibility() {
    const foamSection = document.getElementById('foam-section');
    if (!foamSection) return;
    const showFoam = !isPlayerLayerId(this.selectedId) && isIslandLayer(this.getSelectedLayer());
    foamSection.style.display = showFoam ? '' : 'none';
  }

  private refreshFoamForm(layer: FishingLayerLayout) {
    const sprite = this.sprites.get(layer.id);
    if (!sprite || !isIslandLayer(layer)) return;
    const foam = ensureIslandFoam(layer);
    byId<HTMLInputElement>('foam-visible').checked = foam.visible;
    byId<HTMLInputElement>('foam-waterline-y').value = String(Math.round(getIslandFoamWorldY(sprite, foam)));
    byId<HTMLInputElement>('foam-half-width').value = String(foam.halfWidthRatio);
    byId<HTMLOutputElement>('foam-half-width-value').value = `${Math.round(foam.halfWidthRatio * 100)}%`;
    byId<HTMLInputElement>('foam-y-offset').value = String(Math.round(foam.yOffset));
  }

  private syncFoamHandle(layer: FishingLayerLayout) {
    const sprite = this.sprites.get(layer.id);
    if (!sprite || !isIslandLayer(layer)) {
      this.foamHandle.setVisible(false);
      return;
    }
    const foam = getIslandFoam(layer);
    const waterY = getIslandFoamWorldY(sprite, foam);
    const halfWidth = getIslandFoamHalfWidth(sprite, foam);
    this.foamHandle
      .setScrollFactor(this.getEditorScrollFactor(layer), 1)
      .setPosition(layer.x, waterY)
      .setSize(Math.max(40, halfWidth * 2), 16)
      .setVisible(true);
  }

  private drawIslandFoamPreview(layer: FishingLayerLayout, sprite: Phaser.GameObjects.Image) {
    this.foamPreview.setScrollFactor(this.getEditorScrollFactor(layer), 1);
    const foam = getIslandFoam(layer);
    if (!foam.visible) return;
    const centerX = layer.x;
    const waterY = getIslandFoamWorldY(sprite, foam);
    const halfWidth = getIslandFoamHalfWidth(sprite, foam);
    const time = this.time.now * 0.001;
    const phaseSeed = layer.x * 0.013;
    drawContinuousFoamRing(
      this.foamPreview,
      centerX,
      halfWidth,
      waterY,
      1.8,
      0xd8f2ef,
      0.44,
      4.2,
      time * 1.05 + phaseSeed,
    );
    drawContinuousFoamRing(
      this.foamPreview,
      centerX,
      halfWidth,
      waterY,
      0,
      0xffffff,
      0.86,
      2.2,
      time * 1.45 + phaseSeed + 0.8,
    );
    this.foamPreview.lineStyle(2, 0xffb347, 0.95);
    this.foamPreview.lineBetween(centerX - halfWidth, waterY, centerX + halfWidth, waterY);
  }

  private refreshBoatFoamForm() {
    const boat = this.layout.player.boat;
    byId<HTMLInputElement>('boat-foam-y-offset').value = String(Math.round(boat.foamYOffset ?? 0));
    byId<HTMLInputElement>('boat-foam-half-width').value = String(Math.round(boat.foamHalfWidth ?? 105));
    byId<HTMLOutputElement>('boat-foam-half-width-value').value = `${Math.round(boat.foamHalfWidth ?? 105)}px`;
  }

  private refreshCharacterGlowForm() {
    const glow = this.layout.player.glow;
    byId<HTMLInputElement>('glow-offset-x').value = String(Math.round(glow.offsetX));
    byId<HTMLInputElement>('glow-offset-y').value = String(Math.round(glow.offsetY));
    byId<HTMLInputElement>('glow-scale-x').value = String(glow.scaleX);
    byId<HTMLInputElement>('glow-scale-y').value = String(glow.scaleY);
    byId<HTMLOutputElement>('glow-scale-x-value').value = `${Math.round(glow.scaleX * 100)}%`;
    byId<HTMLOutputElement>('glow-scale-y-value').value = `${Math.round(glow.scaleY * 100)}%`;
    byId<HTMLInputElement>('glow-radius').value = String(glow.radius);
    byId<HTMLInputElement>('glow-strength').value = String(glow.strength);
    byId<HTMLInputElement>('glow-alpha').value = String(glow.alpha);
    byId<HTMLOutputElement>('glow-alpha-value').value = `${Math.round(glow.alpha * 100)}%`;
  }

  private refreshWaterFlowForm() {
    const flow = this.layout.layers.water.waterFlow ?? structuredClone(DEFAULT_WATER_FLOW);
    this.layout.layers.water.waterFlow = flow;
    byId<HTMLInputElement>('water-flow-speed-x').value = String(flow.speedX);
    byId<HTMLInputElement>('water-flow-variation').value = String(flow.speedVariation);
    byId<HTMLInputElement>('water-flow-vertical-amount').value = String(flow.verticalAmount);
    byId<HTMLInputElement>('water-flow-vertical-speed').value = String(flow.verticalSpeed);
  }

  private drawBoatFoamPreview() {
    this.foamPreview.setScrollFactor(0, 1);
    const boat = this.layout.player.boat;
    const boatPosition = this.getBoatPosition();
    const centerX = boatPosition.x;
    const waterY = boatPosition.y + (boat.foamYOffset ?? 0);
    const halfWidth = boat.foamHalfWidth ?? 105;
    const time = this.time.now * 0.001;
    drawContinuousFoamRing(this.foamPreview, centerX, halfWidth, waterY, 1.8, 0xd8f2ef, 0.7, 4.2, time);
    drawContinuousFoamRing(this.foamPreview, centerX, halfWidth, waterY, 0, 0xffffff, 0.9, 2.4, time + 0.8);
    this.foamPreview.lineStyle(2, 0xffb347, 0.95);
    this.foamPreview.lineBetween(centerX - halfWidth, waterY, centerX + halfWidth, waterY);
    this.foamHandle
      .setScrollFactor(0, 1)
      .setPosition(centerX, waterY)
      .setSize(Math.max(40, halfWidth * 2), 18)
      .setVisible(true);
  }

  private bindCanvasInput() {
    this.input.on(
      'drag',
      (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
        if (object === this.foamHandle) {
          if (this.selectedId === 'player-boat') {
            this.layout.player.boat.foamYOffset = Math.round(dragY - this.getBoatPosition().y);
            this.refreshBoatFoamForm();
            this.drawGuides();
            return;
          }
          if (this.isLayerLocked()) return;
          const layer = this.getSelectedLayer();
          const sprite = this.sprites.get(layer.id);
          if (!sprite || !isIslandLayer(layer)) return;
          const foam = ensureIslandFoam(layer);
          setIslandFoamFromWorldY(sprite, foam, Math.round(dragY));
          this.syncFoamHandle(layer);
          this.refreshFoamForm(layer);
          this.drawGuides();
          return;
        }
        const id = object.getData('layerId') as string;
        if (isPlayerLayerId(id)) {
          this.handlePlayerDrag(id, dragX, dragY);
          return;
        }
        const layer = this.getLayer(id);
        if (!layer || layer.locked) return;
        this.selectedId = id;
        const scrollFactor = this.getEditorScrollFactor(layer);
        layer.x = Math.round(dragX - this.routeScrollX * (1 - scrollFactor));
        layer.y = Math.round(dragY);
        if (layer.id === 'water') this.layout.waterlineY = layer.y;
        this.applyLayer(layer);
        this.renderLayerList();
        this.refreshForm();
        this.drawGuides();
      },
    );

    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, deltaY: number) => {
      if (this.isLayerLocked()) return;
      const current = isPlayerLayerId(this.selectedId)
        ? this.getPlayerUniformScale()
        : this.getUniformScale(this.getSelectedLayer());
      const next = deltaY > 0 ? current * 0.9 : current * 1.1;
      if (isPlayerLayerId(this.selectedId)) this.setPlayerUniformScale(next);
      else this.setUniformScale(next);
    });

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      const direction: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const offset = direction[event.key];
      if (!offset) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (isPlayerLayerId(this.selectedId)) {
        this.nudgePlayerLayer(offset[0] * step, offset[1] * step);
        this.renderLayerList();
        return;
      }
      const layer = this.getSelectedLayer();
      if (layer.locked) return;
      layer.x += offset[0] * step;
      layer.y += offset[1] * step;
      this.applyLayer(layer);
      this.refreshForm();
      this.drawGuides();
    });
  }

  private bindDropImport() {
    const canvas = this.game.canvas;
    const host = byId<HTMLDivElement>('scene-canvas');
    const prevent = (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
    };
    canvas.addEventListener('dragenter', (event) => {
      prevent(event);
      host.classList.add('drag-over');
    });
    canvas.addEventListener('dragover', prevent);
    canvas.addEventListener('dragleave', () => host.classList.remove('drag-over'));
    canvas.addEventListener('drop', (event) => {
      prevent(event);
      host.classList.remove('drag-over');
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * (VIEW_W / bounds.width);
      const y = (event.clientY - bounds.top) * (VIEW_H / bounds.height);
      const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
      void this.importDroppedImages(files, x, y);
    });
  }

  private async importDroppedImages(files: File[], dropX: number, dropY: number) {
    if (files.length === 0) {
      this.setStatus('拖入失败：请选择 PNG、JPG 或 WebP 图片。');
      return;
    }
    for (const [index, file] of files.entries()) {
      try {
        const asset = await saveSceneAsset(file);
        const url = URL.createObjectURL(asset.blob);
        customAssetUrls.set(asset.id, url);
        const image = new Image();
        image.src = url;
        await image.decode();
        const textureKey = `scene-custom-${asset.id}`;
        this.textures.addImage(textureKey, image);
        const maxWidth = 640;
        const displayWidth = Math.min(maxWidth, image.naturalWidth);
        const isFarMountain = /远山|far[-_\s]?mountain|distant[-_\s]?mountain/i.test(file.name);
        const sourceId: FishingLayerId = isFarMountain ? 'far' : 'islandSmall';
        const parallax = isFarMountain ? 0 : 0.5;
        const layer: FishingLayerLayout = {
          ...cloneDefaultFishingLayout(EDITOR_MAP_ID).layers[sourceId],
          id: `custom-${asset.id}`,
          sourceId,
          name: isFarMountain ? '连续远山带' : file.name.replace(/\.[^.]+$/, ''),
          textureKey,
          assetId: asset.id,
          x: Math.round(dropX + this.routeScrollX * parallax + index * 24),
          y: Math.round(dropY + index * 24),
          width: displayWidth,
          height: undefined,
          depth: isFarMountain ? 0 : 12,
          parallax,
          repeatMode: isFarMountain ? 'horizontal' : 'single',
          foam: isFarMountain ? undefined : cloneDefaultFishingLayout(EDITOR_MAP_ID).layers.islandSmall.foam,
        };
        this.layout.copies.push(layer);
        this.createLayerSprite(layer);
        this.selectLayer(layer.id);
        this.setStatus(`已导入“${file.name}”。调整完成后点击“保存并应用”。`);
      } catch {
        this.setStatus(`导入失败：无法读取“${file.name}”。`);
      }
    }
  }

  private setRouteScroll(value: number) {
    this.routeScrollX = Phaser.Math.Clamp(Math.round(value), 0, 3000);
    this.cameras.main.scrollX = this.routeScrollX;
    const slider = byId<HTMLInputElement>('route-scroll');
    slider.value = String(this.routeScrollX);
    byId<HTMLOutputElement>('route-scroll-value').value = this.routeScrollX === 0
      ? '首屏 · 0m'
      : `航程 · ${this.routeScrollX}m`;
    this.drawGuides();
  }

  private bindDom() {
    byId<HTMLInputElement>('route-scroll').addEventListener('input', (event) => {
      this.setRouteScroll(Number((event.target as HTMLInputElement).value));
    });
    byId<HTMLButtonElement>('route-start').addEventListener('click', () => this.setRouteScroll(0));
    byId<HTMLButtonElement>('route-back').addEventListener('click', () => {
      this.setRouteScroll(this.routeScrollX - 500);
    });
    byId<HTMLButtonElement>('route-forward').addEventListener('click', () => {
      this.setRouteScroll(this.routeScrollX + 500);
    });
    const bindGlowInput = (
      id: string,
      field: keyof FishingSceneLayout['player']['glow'],
    ) => {
      byId<HTMLInputElement>(id).addEventListener('input', (event) => {
        const value = Number((event.target as HTMLInputElement).value);
        if (!Number.isFinite(value)) return;
        this.layout.player.glow[field] = value;
        this.applyPlayerLayers();
        this.refreshCharacterGlowForm();
      });
    };
    bindGlowInput('glow-offset-x', 'offsetX');
    bindGlowInput('glow-offset-y', 'offsetY');
    bindGlowInput('glow-scale-x', 'scaleX');
    bindGlowInput('glow-scale-y', 'scaleY');
    bindGlowInput('glow-radius', 'radius');
    bindGlowInput('glow-strength', 'strength');
    bindGlowInput('glow-alpha', 'alpha');
    byId<HTMLButtonElement>('glow-reset').addEventListener('click', () => {
      this.layout.player.glow = structuredClone(
        cloneDefaultFishingLayout(EDITOR_MAP_ID).player.glow,
      );
      this.applyPlayerLayers();
      this.refreshCharacterGlowForm();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' && !(document.activeElement instanceof HTMLInputElement)) {
        event.preventDefault();
        this.deleteSelectedLayer();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      event.preventDefault();
      event.stopPropagation();
      if (key === 'c') this.copySelectedLayer();
      else this.pasteCopiedLayer();
    }, { capture: true });

    const bindNumber = (
      id: string,
      update: (layer: FishingLayerLayout, value: number) => void,
      updatePlayer?: (value: number) => void,
    ) => {
      byId<HTMLInputElement>(id).addEventListener('input', (event) => {
        const value = Number((event.target as HTMLInputElement).value);
        if (!Number.isFinite(value)) return;
        if (isPlayerLayerId(this.selectedId) && updatePlayer) {
          updatePlayer(value);
          this.refreshForm();
          return;
        }
        const layer = this.getSelectedLayer();
        update(layer, value);
        this.applyLayer(layer);
        this.renderLayerList();
        this.drawGuides();
      });
    };

    bindNumber('x', (layer, value) => { layer.x = value; }, (value) => this.updatePlayerNumericField('x', value));
    bindNumber('y', (layer, value) => {
      layer.y = value;
      if (layer.id === 'water') {
        this.layout.waterlineY = value;
        byId<HTMLInputElement>('waterline').value = String(value);
        this.applyPlayerLayers();
      }
    }, (value) => this.updatePlayerNumericField('y', value));
    bindNumber('width', (layer, value) => { layer.width = Math.max(40, value); }, (value) => {
      this.updatePlayerNumericField('width', value);
    });
    bindNumber('height', (layer, value) => { layer.height = value > 0 ? value : undefined; }, (value) => {
      this.updatePlayerNumericField('height', value);
    });
    bindNumber('depth', (layer, value) => { layer.depth = value; }, (value) => {
      this.updatePlayerNumericField('depth', value);
    });
    bindNumber('rod-angle', (_layer, value) => {}, (value) => {
      this.updatePlayerNumericField('rodAngle', value);
    });
    bindNumber('parallax', (layer, value) => { layer.parallax = Phaser.Math.Clamp(value, 0, 1.5); });
    bindNumber('alpha', (layer, value) => { layer.alpha = Phaser.Math.Clamp(value, 0, 1); });
    bindNumber('stretch-x', (layer, value) => {
      layer.stretchX = Phaser.Math.Clamp(value, 0.2, 3);
      byId<HTMLOutputElement>('stretch-x-value').value = `${Math.round(layer.stretchX * 100)}%`;
    });
    bindNumber('stretch-y', (layer, value) => {
      layer.stretchY = Phaser.Math.Clamp(value, 0.2, 3);
      byId<HTMLOutputElement>('stretch-y-value').value = `${Math.round(layer.stretchY * 100)}%`;
    });

    byId<HTMLInputElement>('scale').addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      if (isPlayerLayerId(this.selectedId)) this.setPlayerUniformScale(value);
      else this.setUniformScale(value);
    });
    byId<HTMLButtonElement>('scale-down').addEventListener('click', () => {
      if (isPlayerLayerId(this.selectedId)) {
        this.setPlayerUniformScale(this.getPlayerUniformScale() * 0.9);
        return;
      }
      this.setUniformScale(this.getUniformScale(this.getSelectedLayer()) * 0.9);
    });
    byId<HTMLButtonElement>('scale-up').addEventListener('click', () => {
      if (isPlayerLayerId(this.selectedId)) {
        this.setPlayerUniformScale(this.getPlayerUniformScale() * 1.1);
        return;
      }
      this.setUniformScale(this.getUniformScale(this.getSelectedLayer()) * 1.1);
    });
    byId<HTMLButtonElement>('scale-reset').addEventListener('click', () => {
      if (isPlayerLayerId(this.selectedId)) {
        this.resetPlayerScale();
        return;
      }
      const layer = this.getSelectedLayer();
      const base = cloneDefaultFishingLayout(EDITOR_MAP_ID).layers[layer.sourceId];
      layer.width = base.width;
      layer.height = base.height;
      this.applyLayer(layer);
      this.refreshForm();
      this.drawGuides();
    });
    byId<HTMLButtonElement>('stretch-reset').addEventListener('click', () => {
      const layer = this.getSelectedLayer();
      layer.stretchX = 1;
      layer.stretchY = 1;
      this.applyLayer(layer);
      this.refreshForm();
      this.drawGuides();
    });

    byId<HTMLInputElement>('waterline').addEventListener('input', (event) => {
      this.layout.waterlineY = Number((event.target as HTMLInputElement).value);
      const water = this.layout.layers.water;
      water.y = this.layout.waterlineY;
      this.applyLayer(water);
      this.applyPlayerLayers();
      this.refreshForm();
      this.drawGuides();
    });
    byId<HTMLInputElement>('foam-visible').addEventListener('change', (event) => {
      const layer = this.getSelectedLayer();
      if (!isIslandLayer(layer)) return;
      ensureIslandFoam(layer).visible = (event.target as HTMLInputElement).checked;
      this.drawGuides();
    });
    byId<HTMLInputElement>('foam-waterline-y').addEventListener('input', (event) => {
      const layer = this.getSelectedLayer();
      const sprite = this.sprites.get(layer.id);
      if (!sprite || !isIslandLayer(layer)) return;
      const value = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      setIslandFoamFromWorldY(sprite, ensureIslandFoam(layer), value);
      this.syncFoamHandle(layer);
      this.drawGuides();
    });
    byId<HTMLInputElement>('foam-half-width').addEventListener('input', (event) => {
      const layer = this.getSelectedLayer();
      if (!isIslandLayer(layer)) return;
      const value = Phaser.Math.Clamp(Number((event.target as HTMLInputElement).value), 0.15, 0.65);
      ensureIslandFoam(layer).halfWidthRatio = value;
      byId<HTMLOutputElement>('foam-half-width-value').value = `${Math.round(value * 100)}%`;
      this.syncFoamHandle(layer);
      this.drawGuides();
    });
    byId<HTMLInputElement>('foam-y-offset').addEventListener('input', (event) => {
      const layer = this.getSelectedLayer();
      const sprite = this.sprites.get(layer.id);
      if (!sprite || !isIslandLayer(layer)) return;
      const value = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      ensureIslandFoam(layer).yOffset = value;
      this.syncFoamHandle(layer);
      this.refreshFoamForm(layer);
      this.drawGuides();
    });
    byId<HTMLInputElement>('boat-foam-y-offset').addEventListener('input', (event) => {
      if (this.selectedId !== 'player-boat') return;
      this.layout.player.boat.foamYOffset = Number((event.target as HTMLInputElement).value);
      this.drawGuides();
    });
    byId<HTMLInputElement>('boat-foam-half-width').addEventListener('input', (event) => {
      if (this.selectedId !== 'player-boat') return;
      const value = Number((event.target as HTMLInputElement).value);
      this.layout.player.boat.foamHalfWidth = value;
      byId<HTMLOutputElement>('boat-foam-half-width-value').value = `${Math.round(value)}px`;
      this.drawGuides();
    });
    const bindWaterFlowInput = (
      id: string,
      field: 'speedX' | 'speedVariation' | 'verticalAmount' | 'verticalSpeed',
    ) => {
      byId<HTMLInputElement>(id).addEventListener('input', (event) => {
        if (this.selectedId !== 'water' || this.isLayerLocked()) return;
        const flow = this.layout.layers.water.waterFlow ?? structuredClone(DEFAULT_WATER_FLOW);
        flow[field] = Number((event.target as HTMLInputElement).value);
        this.layout.layers.water.waterFlow = flow;
      });
    };
    bindWaterFlowInput('water-flow-speed-x', 'speedX');
    bindWaterFlowInput('water-flow-variation', 'speedVariation');
    bindWaterFlowInput('water-flow-vertical-amount', 'verticalAmount');
    bindWaterFlowInput('water-flow-vertical-speed', 'verticalSpeed');
    byId<HTMLInputElement>('repeat-horizontal').addEventListener('change', (event) => {
      const layer = this.getSelectedLayer();
      layer.repeatMode = (event.target as HTMLInputElement).checked ? 'horizontal' : 'single';
      this.setStatus(layer.repeatMode === 'horizontal'
        ? `“${layer.name}”已设置为横向PCG循环。`
        : `“${layer.name}”已设置为单个图层。`);
    });
    byId<HTMLButtonElement>('copy-layer').addEventListener('click', () => this.copySelectedLayer());
    byId<HTMLButtonElement>('paste-layer').addEventListener('click', () => this.pasteCopiedLayer());
    byId<HTMLButtonElement>('delete-layer').addEventListener('click', () => this.deleteSelectedLayer());
    byId<HTMLButtonElement>('save').addEventListener('click', () => {
      saveFishingSceneLayout(this.layout, EDITOR_MAP_ID);
      this.setStatus(`已保存到“${EDITOR_MAP.name}”。刷新钓鱼Demo即可应用当前构图。`);
    });
    byId<HTMLButtonElement>('open-game').addEventListener('click', () => {
      saveFishingSceneLayout(this.layout, EDITOR_MAP_ID);
      window.location.href = `/fishing-demo.html?map=${EDITOR_MAP_ID}`;
    });
    byId<HTMLButtonElement>('export').addEventListener('click', () => this.exportJson());
    byId<HTMLButtonElement>('reset').addEventListener('click', () => this.resetLayout());
    byId<HTMLInputElement>('import-file').addEventListener('change', (event) => this.importJson(event));
  }

  private renderLayerList() {
    const list = byId<HTMLDivElement>('layer-list');
    list.replaceChildren();
    const rows: Array<{ id: string; name: string; depth: number; visible: boolean; locked: boolean; player?: PlayerLayerId }> = [
      ...this.getAllLayers().map((layer) => ({
        id: layer.id,
        name: layer.name,
        depth: layer.depth,
        visible: layer.visible,
        locked: layer.locked ?? false,
      })),
      ...PLAYER_LAYER_IDS.map((id) => ({
        id,
        name: PLAYER_LAYER_NAMES[id],
        depth: id === 'player-boat'
          ? this.layout.player.boat.depth
          : id === 'player-fisher'
            ? this.layout.player.fisher.depth
            : this.layout.player.rod.depth,
        visible: id === 'player-boat'
          ? this.layout.player.boat.visible
          : id === 'player-fisher'
            ? this.layout.player.fisher.visible
            : this.layout.player.rod.visible,
        locked: id === 'player-boat'
          ? (this.layout.player.boat.locked ?? false)
          : id === 'player-fisher'
            ? (this.layout.player.fisher.locked ?? false)
            : (this.layout.player.rod.locked ?? false),
        player: id,
      })),
    ].sort((a, b) => b.depth - a.depth);

    for (const rowData of rows) {
      const id = rowData.id;
      const row = document.createElement('div');
      row.className = `layer-row${id === this.selectedId ? ' selected' : ''}${rowData.locked ? ' locked' : ''}`;
      row.addEventListener('click', () => this.selectLayer(id));

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = rowData.visible;
      visible.addEventListener('click', (event) => event.stopPropagation());
      visible.addEventListener('change', () => {
        if (rowData.player) {
          this.setPlayerVisible(rowData.player, visible.checked);
          return;
        }
        const layer = this.getLayer(id);
        if (!layer) return;
        layer.visible = visible.checked;
        this.applyLayer(layer);
        this.drawGuides();
      });

      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = `layer-lock${rowData.locked ? ' active' : ''}`;
      lock.textContent = rowData.locked ? '🔒' : '🔓';
      lock.title = rowData.locked ? '点击解锁图层' : '点击锁定图层';
      lock.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setLayerLocked(id, !rowData.locked);
      });

      const name = document.createElement('span');
      name.textContent = rowData.name;
      const depth = document.createElement('span');
      depth.className = 'depth-tag';
      depth.textContent = `D${rowData.depth}`;
      row.append(visible, lock, name, depth);
      list.append(row);
    }
  }

  private selectLayer(id: string) {
    this.selectedId = id;
    this.renderLayerList();
    this.refreshForm();
    this.drawGuides();
    const isPlayer = isPlayerLayerId(id);
    byId<HTMLButtonElement>('delete-layer').disabled = isPlayer || this.getAllLayers().length <= 1;
    byId<HTMLButtonElement>('copy-layer').disabled = isPlayer;
  }

  private refreshForm() {
    const isPlayer = isPlayerLayerId(this.selectedId);
    this.setSceneryFieldVisible(!isPlayer);
    byId<HTMLElement>('character-glow-section').style.display = (
      EDITOR_MAP_ID === 'fishing-map-02' && this.selectedId === 'player-boat'
    ) ? '' : 'none';

    const labelX = byId<HTMLLabelElement>('label-x');
    const labelY = byId<HTMLLabelElement>('label-y');
    const labelWidth = byId<HTMLLabelElement>('label-width');
    const labelHeight = byId<HTMLLabelElement>('label-height');

    if (isPlayer && this.selectedId === 'player-boat') {
      const player = this.layout.player;
      const surfaceY = this.getPlayerSurfaceY();
      byId('selected-title').textContent = '图层参数 · 人物与船（含倒影）';
      labelX.childNodes[0].textContent = '屏幕 X';
      labelY.childNodes[0].textContent = '素材水线 Y（拖动对齐）';
      labelWidth.childNodes[0].textContent = '显示宽度';
      labelHeight.style.display = 'none';
      byId<HTMLInputElement>('x').value = String(Math.round(player.previewX));
      byId<HTMLInputElement>('y').value = String(Math.round(surfaceY + player.boat.waterlineOffset));
      byId<HTMLInputElement>('width').value = String(Math.round(player.boat.width));
      byId<HTMLInputElement>('depth').value = String(player.boat.depth);
      byId<HTMLInputElement>('scale').value = String(this.getPlayerUniformScale());
      this.refreshBoatFoamForm();
      this.refreshCharacterGlowForm();
      return;
    }

    if (isPlayer && this.selectedId === 'player-fisher') {
      const fisherPos = this.getFisherPosition();
      byId('selected-title').textContent = '图层参数 · 旅人';
      labelX.childNodes[0].textContent = '屏幕 X';
      labelY.childNodes[0].textContent = '屏幕 Y';
      labelWidth.style.display = 'none';
      labelHeight.style.display = '';
      labelHeight.childNodes[0].textContent = '显示高度';
      byId<HTMLInputElement>('x').value = String(Math.round(fisherPos.x));
      byId<HTMLInputElement>('y').value = String(Math.round(fisherPos.y));
      byId<HTMLInputElement>('height').value = String(Math.round(this.layout.player.fisher.height));
      byId<HTMLInputElement>('depth').value = String(this.layout.player.fisher.depth);
      byId<HTMLInputElement>('scale').value = String(this.getPlayerUniformScale());
      return;
    }

    if (isPlayer && this.selectedId === 'player-rod') {
      const grip = this.getRodGripPosition();
      const rod = this.layout.player.rod;
      byId('selected-title').textContent = '图层参数 · 鱼竿';
      labelX.childNodes[0].textContent = '握竿点 X';
      labelY.childNodes[0].textContent = '握竿点 Y';
      labelWidth.style.display = '';
      labelWidth.childNodes[0].textContent = '竿长';
      labelHeight.style.display = 'none';
      byId<HTMLInputElement>('x').value = String(Math.round(grip.x));
      byId<HTMLInputElement>('y').value = String(Math.round(grip.y));
      byId<HTMLInputElement>('width').value = String(Math.round(rod.length));
      byId<HTMLInputElement>('depth').value = String(rod.depth);
      byId<HTMLInputElement>('rod-angle').value = String(Number(rod.restAngle.toFixed(3)));
      byId<HTMLInputElement>('scale').value = String(this.getPlayerUniformScale());
      return;
    }

    labelX.childNodes[0].textContent = 'X坐标';
    labelY.childNodes[0].textContent = 'Y坐标';
    labelWidth.style.display = '';
    labelWidth.childNodes[0].textContent = '显示宽度';
    labelHeight.style.display = '';
    labelHeight.childNodes[0].textContent = '显示高度（0=等比）';

    const layer = this.getSelectedLayer();
    byId('selected-title').textContent = `图层参数 · ${layer.name}`;
    byId<HTMLInputElement>('x').value = String(Math.round(layer.x));
    byId<HTMLInputElement>('y').value = String(Math.round(layer.y));
    byId<HTMLInputElement>('width').value = String(Math.round(layer.width));
    byId<HTMLInputElement>('height').value = String(Math.round(layer.height ?? 0));
    byId<HTMLInputElement>('depth').value = String(layer.depth);
    byId<HTMLInputElement>('parallax').value = String(layer.parallax);
    byId<HTMLInputElement>('scale').value = String(this.getUniformScale(layer));
    byId<HTMLInputElement>('stretch-x').value = String(layer.stretchX);
    byId<HTMLInputElement>('stretch-y').value = String(layer.stretchY);
    byId<HTMLOutputElement>('stretch-x-value').value = `${Math.round(layer.stretchX * 100)}%`;
    byId<HTMLOutputElement>('stretch-y-value').value = `${Math.round(layer.stretchY * 100)}%`;
    byId<HTMLInputElement>('alpha').value = String(layer.alpha);
    byId<HTMLInputElement>('repeat-horizontal').checked = layer.repeatMode === 'horizontal';
    byId<HTMLInputElement>('waterline').value = String(this.layout.waterlineY);
    this.updateFoamSectionVisibility();
    if (isIslandLayer(layer)) this.refreshFoamForm(layer);
    if (layer.sourceId === 'water') this.refreshWaterFlowForm();
  }

  private drawGuides() {
    this.waterlineGuide.clear();
    this.foamPreview.clear();
    this.foamHandle.setVisible(false);
    this.waterlineGuide.lineStyle(2, 0x73d8e4, 0.9);
    this.waterlineGuide.lineBetween(0, this.layout.waterlineY, VIEW_W, this.layout.waterlineY);
    this.waterlineGuide.lineStyle(1, 0xf0c978, 0.55);
    const playerSurfaceY = this.getPlayerSurfaceY();
    this.waterlineGuide.lineBetween(0, playerSurfaceY, VIEW_W, playerSurfaceY);

    this.selection.clear();
    if (isPlayerLayerId(this.selectedId)) {
      this.selection.setScrollFactor(0, 1);
      const bounds = this.getPlayerSelectionBounds();
      if (!bounds) return;
      this.selection.lineStyle(2, 0xf3c56c, 1);
      this.selection.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      if (this.selectedId === 'player-boat') this.drawBoatFoamPreview();
      return;
    }
    const sprite = this.sprites.get(this.selectedId);
    if (!sprite?.visible) return;
    const layer = this.getSelectedLayer();
    this.selection.setScrollFactor(this.getEditorScrollFactor(layer), 1);
    const bounds = sprite.getBounds();
    this.selection.lineStyle(2, 0xf3c56c, 1);
    this.selection.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (isIslandLayer(layer)) {
      this.drawIslandFoamPreview(layer, sprite);
      this.syncFoamHandle(layer);
    }
  }

  private getUniformScale(layer: FishingLayerLayout) {
    const baseWidth = cloneDefaultFishingLayout(EDITOR_MAP_ID).layers[layer.sourceId].width;
    return layer.width / baseWidth;
  }

  private setUniformScale(rawScale: number) {
    const scale = Phaser.Math.Clamp(rawScale, 0.2, 3);
    const layer = this.getSelectedLayer();
    const base = cloneDefaultFishingLayout(EDITOR_MAP_ID).layers[layer.sourceId];
    const previousScale = this.getUniformScale(layer);
    const ratio = scale / previousScale;
    layer.width = Math.round(base.width * scale);
    if (layer.height !== undefined) layer.height = Math.round(layer.height * ratio);
    else if (base.height !== undefined) layer.height = Math.round(base.height * scale);
    this.applyLayer(layer);
    this.refreshForm();
    this.drawGuides();
  }

  private getAllLayers() {
    return [
      ...LAYER_ORDER
        .filter((id) => !this.layout.deletedLayerIds.includes(id))
        .map((id) => this.layout.layers[id]),
      ...this.layout.copies,
    ];
  }

  private getLayer(id: string) {
    if (id in this.layout.layers) return this.layout.layers[id as FishingLayerId];
    return this.layout.copies.find((layer) => layer.id === id);
  }

  private getSelectedLayer() {
    const layer = this.getLayer(this.selectedId);
    if (!layer) throw new Error(`Unknown layer: ${this.selectedId}`);
    return layer;
  }

  private copySelectedLayer() {
    if (isPlayerLayerId(this.selectedId)) {
      this.setStatus('渔船 / 旅人 / 鱼竿 为固定图层，不能复制。');
      return;
    }
    this.copiedLayer = structuredClone(this.getSelectedLayer());
    this.pasteCount = 0;
    byId<HTMLButtonElement>('paste-layer').disabled = false;
    this.setStatus(`已复制“${this.copiedLayer.name}”，按 Ctrl+V 创建副本。`);
  }

  private pasteCopiedLayer() {
    if (!this.copiedLayer) {
      this.setStatus('请先选择图层并按 Ctrl+C 复制。');
      return;
    }
    this.pasteCount += 1;
    const layer = structuredClone(this.copiedLayer);
    layer.id = `${layer.sourceId}-copy-${Date.now()}-${this.pasteCount}`;
    layer.name = `${this.copiedLayer.name} 副本 ${this.pasteCount}`;
    layer.x = this.routeScrollX > 0
      ? Math.round(this.routeScrollX * layer.parallax + VIEW_W * 0.65 + 24 * this.pasteCount)
      : layer.x + 24 * this.pasteCount;
    layer.y += 24 * this.pasteCount;
    this.layout.copies.push(layer);
    this.createLayerSprite(layer);
    this.selectLayer(layer.id);
    this.setStatus(`已粘贴“${layer.name}”，保存后会同步到钓鱼Demo。`);
  }

  private deleteSelectedLayer() {
    if (isPlayerLayerId(this.selectedId)) {
      this.setStatus('渔船 / 旅人 / 鱼竿 为固定图层，不能删除。');
      return;
    }
    if (this.getAllLayers().length <= 1) {
      this.setStatus('场景至少需要保留一个图层。');
      return;
    }
    const index = this.layout.copies.findIndex((layer) => layer.id === this.selectedId);
    const deleted = index >= 0
      ? this.layout.copies.splice(index, 1)[0]
      : this.layout.layers[this.selectedId as FishingLayerId];
    if (!deleted) return;
    if (index < 0) this.layout.deletedLayerIds.push(deleted.sourceId);
    if (deleted.id === 'water') {
      this.waterFlowPreview?.destroy();
      this.waterFlowPreview = undefined;
    }
    this.sprites.get(deleted.id)?.destroy();
    this.sprites.delete(deleted.id);
    const nextLayer = this.getAllLayers()[0];
    this.selectLayer(nextLayer.id);
    this.setStatus(`已删除“${deleted.name}”。点击“保存并应用”后同步到钓鱼Demo。`);
  }

  private rebuildSprites() {
    this.waterFlowPreview?.destroy();
    this.waterFlowPreview = undefined;
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    for (const layer of this.getAllLayers()) this.createLayerSprite(layer);
    this.applyPlayerLayers();
  }

  private resetLayout() {
    if (!window.confirm('确定恢复默认构图吗？')) return;
    this.layout = cloneDefaultFishingLayout(EDITOR_MAP_ID);
    this.rebuildSprites();
    this.selectLayer('player-boat');
    this.setStatus('已恢复默认值，点击“保存并应用”后生效。');
  }

  private exportJson() {
    const blob = new Blob([JSON.stringify(this.layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${EDITOR_MAP_ID}-layout.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setStatus('布局JSON已导出。');
  }

  private importJson(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as FishingSceneLayout;
        const merged = cloneDefaultFishingLayout(EDITOR_MAP_ID);
        for (const id of LAYER_ORDER) {
          const base = merged.layers[id];
          const savedLayer = imported.layers?.[id] ?? {};
          merged.layers[id] = {
            ...base,
            ...savedLayer,
            id,
            sourceId: id,
            foam: base.foam
              ? { ...base.foam, ...(savedLayer.foam ?? {}) }
              : savedLayer.foam,
          };
        }
        merged.copies = (imported.copies ?? []).map((copy, index) => {
          const sourceId = copy.sourceId && merged.layers[copy.sourceId] ? copy.sourceId : 'islandSmall';
          const base = merged.layers[sourceId];
          return {
            ...base,
            ...copy,
            id: copy.id || `${sourceId}-copy-${index + 1}`,
            sourceId,
            foam: base.foam
              ? { ...base.foam, ...(copy.foam ?? {}) }
              : copy.foam,
          };
        });
        merged.deletedLayerIds = (imported.deletedLayerIds ?? []).filter(
          (id): id is FishingLayerId => id in merged.layers,
        );
        merged.waterlineY = imported.waterlineY ?? merged.waterlineY;
        merged.player = {
          ...merged.player,
          ...(imported.player ?? {}),
          boat: { ...merged.player.boat, ...(imported.player?.boat ?? {}) },
          fisher: { ...merged.player.fisher, ...(imported.player?.fisher ?? {}) },
          rod: { ...merged.player.rod, ...(imported.player?.rod ?? {}) },
          glow: { ...merged.player.glow, ...(imported.player?.glow ?? {}) },
        };
        this.layout = merged;
        this.rebuildSprites();
        const nextSelection = this.getAllLayers().find((layer) => layer.id === this.selectedId)
          ?? this.getAllLayers()[0];
        this.selectLayer(nextSelection.id);
        this.setStatus('布局JSON已导入，点击“保存并应用”后生效。');
      } catch {
        this.setStatus('导入失败：JSON格式不正确。');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private setStatus(message: string) {
    byId('status').textContent = message;
  }
}

async function startEditor() {
  document.title = `LURE · ${EDITOR_MAP.name}场景编辑器`;
  const title = document.querySelector('aside h1');
  if (title) title.textContent = `${EDITOR_MAP.name} · 场景分层编辑器`;
  if (EDITOR_MAP_ID !== 'fishing-map-02') {
    byId<HTMLElement>('route-editor').style.display = 'none';
  }
  const layout = loadFishingSceneLayout(EDITOR_MAP_ID);
  customAssetUrls = await loadSceneAssetUrls(
    layout.copies.flatMap((layer) => layer.assetId ? [layer.assetId] : []),
  );
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'scene-canvas',
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: EDITOR_MAP_ID === 'fishing-map-02' ? '#030819' : '#86c8d4',
    scene: [FishingSceneEditor],
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
}

void startEditor();
