import type { FishingMapId } from './maps';

export const FISHING_SCENE_LAYOUT_KEY = 'lure:fishing-scene-layout:v3';
const MAP02_CONTINUOUS_FAR_MOUNTAIN_FILE_ID = '035326b1-b76e-49ac-8673-9cdc3ce0a3c9';

export type FishingLayerId =
  | 'sky'
  | 'far'
  | 'middle'
  | 'forest'
  | 'islandForest'
  | 'islandSmall'
  | 'islandRocky'
  | 'water'
  | 'underwater';

export type FishingLayerLayout = {
  id: string;
  sourceId: FishingLayerId;
  name: string;
  textureKey: string;
  assetId?: string;
  repeatMode?: 'single' | 'horizontal';
  x: number;
  y: number;
  width: number;
  height?: number;
  stretchX: number;
  stretchY: number;
  alpha: number;
  depth: number;
  parallax: number;
  visible: boolean;
  /** 编辑器专用：锁定后禁止拖动、缩放和参数修改。 */
  locked?: boolean;
  /** 岛屿图层专用：吃水线白色泡沫参数。 */
  foam?: IslandFoamConfig;
  waterFlow?: WaterFlowConfig;
};

export type WaterFlowConfig = {
  speedX: number;
  speedVariation: number;
  verticalAmount: number;
  verticalSpeed: number;
};

export const DEFAULT_WATER_FLOW: WaterFlowConfig = {
  speedX: 9,
  speedVariation: 2.2,
  verticalAmount: 1.2,
  verticalSpeed: 0.38,
};

export type IslandFoamConfig = {
  waterlineRatio: number;
  halfWidthRatio: number;
  yOffset: number;
  visible: boolean;
};

export const DEFAULT_ISLAND_FOAM: IslandFoamConfig = {
  waterlineRatio: 0.5,
  halfWidthRatio: 0.42,
  yOffset: 0,
  visible: true,
};

export type FishingPlayerLayerConfig = {
  previewX: number;
  boat: {
    width: number;
    waterlineOffset: number;
    originX: number;
    originY: number;
    depth: number;
    visible: boolean;
    locked?: boolean;
    foamYOffset: number;
    foamHalfWidth: number;
  };
  fisher: {
    offsetX: number;
    offsetY: number;
    height: number;
    originX: number;
    originY: number;
    depth: number;
    visible: boolean;
    locked?: boolean;
  };
  rod: {
    gripOffsetX: number;
    gripOffsetY: number;
    length: number;
    restAngle: number;
    depth: number;
    visible: boolean;
    locked?: boolean;
  };
  glow: CharacterGlowConfig;
};

export type CharacterGlowConfig = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  strength: number;
  radius: number;
};

export type FishingSceneLayout = {
  version: 1;
  waterlineY: number;
  layers: Record<FishingLayerId, FishingLayerLayout>;
  copies: FishingLayerLayout[];
  /** 第二张地图的长航程手动物体是否已经初始化，避免用户删除后被迁移逻辑重新添加。 */
  routeObjectsInitialized?: boolean;
  deletedLayerIds: FishingLayerId[];
  player: FishingPlayerLayerConfig;
};

export const DEFAULT_FISHING_PLAYER_LAYOUT: FishingPlayerLayerConfig = {
  // 屏幕上船锚点的 X，与游戏相机跟随偏移一致。
  previewX: 360,
  boat: {
    width: 900,
    waterlineOffset: 0,
    originX: 0.5,
    originY: 1,
    depth: 30,
    visible: true,
    locked: false,
    foamYOffset: 0,
    foamHalfWidth: 105,
  },
  fisher: {
    offsetX: 0,
    offsetY: 0,
    height: 88,
    originX: 0.5,
    originY: 1,
    depth: 31,
    visible: false,
    locked: false,
  },
  rod: {
    gripOffsetX: 30,
    gripOffsetY: -77,
    length: 128,
    restAngle: -0.78,
    depth: 33,
    visible: true,
    locked: false,
  },
  glow: {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 0.31,
    strength: 1.6,
    radius: 7,
  },
};

export const DEFAULT_FISHING_SCENE_LAYOUT: FishingSceneLayout = {
  version: 1,
  waterlineY: 470,
  copies: [],
  deletedLayerIds: [],
  player: structuredClone(DEFAULT_FISHING_PLAYER_LAYOUT),
  layers: {
    sky: {
      id: 'sky',
      sourceId: 'sky',
      name: '天空',
      textureKey: 'scene-sky',
      x: 640,
      y: 360,
      width: 1280,
      height: 720,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: -10,
      parallax: 0,
      visible: true,
    },
    far: {
      id: 'far',
      sourceId: 'far',
      name: '新版远山',
      textureKey: 'scene-far',
      x: 640,
      y: 488,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 0,
      parallax: 0.05,
      visible: true,
    },
    middle: {
      id: 'middle',
      sourceId: 'middle',
      name: '新版中景山脉',
      textureKey: 'scene-middle',
      x: 640,
      y: 431,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 2,
      parallax: 0.13,
      visible: true,
    },
    forest: {
      id: 'forest',
      sourceId: 'forest',
      name: '新版中景森林',
      textureKey: 'scene-forest',
      x: 640,
      y: 348,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 3,
      parallax: 0.23,
      visible: true,
    },
    islandForest: {
      id: 'islandForest',
      sourceId: 'islandForest',
      name: '左侧大岛',
      textureKey: 'scene-island-forest',
      x: 120,
      y: 394,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 5,
      parallax: 0.86,
      visible: true,
      foam: { ...structuredClone(DEFAULT_ISLAND_FOAM), visible: false },
    },
    islandSmall: {
      id: 'islandSmall',
      sourceId: 'islandSmall',
      name: '中央树岛',
      textureKey: 'scene-island-small',
      x: 380,
      y: 394,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 5,
      parallax: 0.62,
      visible: true,
      foam: { ...structuredClone(DEFAULT_ISLAND_FOAM), visible: false },
    },
    islandRocky: {
      id: 'islandRocky',
      sourceId: 'islandRocky',
      name: '右侧岩石岛',
      textureKey: 'scene-island-rocky',
      x: 1440,
      y: 415,
      width: 1280,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 5,
      parallax: 0.78,
      visible: true,
      foam: { ...structuredClone(DEFAULT_ISLAND_FOAM), visible: false },
    },
    water: {
      id: 'water',
      sourceId: 'water',
      name: '水面',
      textureKey: 'scene-water',
      x: 640,
      y: 470,
      width: 1280,
      height: 300,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: 8,
      parallax: 0.62,
      visible: true,
      waterFlow: structuredClone(DEFAULT_WATER_FLOW),
    },
    underwater: {
      id: 'underwater',
      sourceId: 'underwater',
      name: '水下背景',
      textureKey: 'scene-underwater',
      x: 640,
      y: 752,
      width: 1280,
      height: 1030,
      stretchX: 1,
      stretchY: 1,
      alpha: 1,
      depth: -5,
      parallax: 1,
      visible: true,
    },
  },
};

function applyMapDefaults(layout: FishingSceneLayout, mapId: FishingMapId) {
  if (mapId !== 'fishing-map-02') return layout;

  layout.layers.sky.name = '沉蓝夜空';
  layout.layers.sky.y = 360;

  layout.layers.far.name = '左侧中景小山';
  layout.layers.far.x = 210;
  layout.layers.far.y = 440;
  layout.layers.far.width = 680;
  layout.layers.far.depth = 0.5;
  layout.layers.far.parallax = 0.08;
  layout.layers.far.repeatMode = 'single';
  layout.layers.far.visible = true;

  layout.layers.middle.name = '中央矿山遗迹';
  layout.layers.middle.x = 610;
  layout.layers.middle.y = 430;
  layout.layers.middle.width = 1050;
  layout.layers.middle.depth = 1;
  layout.layers.middle.parallax = 0.05;

  layout.layers.forest.name = '右侧废弃城堡';
  layout.layers.forest.x = 1040;
  layout.layers.forest.y = 470;
  layout.layers.forest.width = 680;
  layout.layers.forest.depth = 2;
  layout.layers.forest.parallax = 0.12;

  layout.layers.islandForest.name = '左侧枯树陆地';
  layout.layers.islandForest.x = 80;
  layout.layers.islandForest.y = 280;
  layout.layers.islandForest.width = 700;
  layout.layers.islandForest.depth = 5;
  layout.layers.islandForest.parallax = 0.78;

  layout.layers.islandSmall.name = '右侧废弃桥';
  layout.layers.islandSmall.x = 1140;
  layout.layers.islandSmall.y = 390;
  layout.layers.islandSmall.width = 650;
  layout.layers.islandSmall.depth = 5;
  layout.layers.islandSmall.parallax = 0.56;

  layout.layers.islandRocky.name = '水面枯木';
  layout.layers.islandRocky.x = 920;
  layout.layers.islandRocky.y = 432;
  layout.layers.islandRocky.width = 510;
  layout.layers.islandRocky.depth = 7;
  layout.layers.islandRocky.parallax = 0.7;

  layout.layers.water.name = '沉蓝水面';
  layout.layers.water.y = 470;
  // 保留完整水面主体；素材顶部就是实际水线。
  layout.layers.water.height = 300;
  layout.layers.water.depth = 8;
  layout.layers.water.parallax = 0.62;
  layout.layers.water.waterFlow = {
    speedX: 5.5,
    speedVariation: 1.4,
    verticalAmount: 0.75,
    verticalSpeed: 0.28,
  };

  layout.layers.underwater.name = '沉蓝水下';
  // 用水下原图覆盖水面素材底部的近纯色区域；水面纹理本身保持不变。
  layout.layers.underwater.y = 720;
  layout.layers.underwater.height = 1062;
  layout.layers.underwater.depth = 8.5;

  // 新船素材本身已经包含人物和倒影，透明画布占比也比第一张船小。
  layout.player.boat.width = 500;
  layout.player.boat.foamHalfWidth = 135;
  layout.player.rod.gripOffsetX = 28;
  layout.player.rod.gripOffsetY = -58;
  layout.player.rod.length = 175;
  layout.player.glow = {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 0.72,
    strength: 1.9,
    radius: 7,
  };

  layout.copies = [
    {
      ...structuredClone(layout.layers.islandForest),
      id: 'map02-route-tree-1',
      name: '航程后段 · 枯树 01',
      x: 2656,
      y: layout.layers.islandForest.y,
      width: Math.round(layout.layers.islandForest.width * 0.78),
      repeatMode: 'single',
    },
    {
      ...structuredClone(layout.layers.islandSmall),
      id: 'map02-route-waterwheel-1',
      name: '航程后段 · 水车桥 01',
      x: 2862,
      y: layout.layers.islandSmall.y,
      width: Math.round(layout.layers.islandSmall.width * 0.82),
      repeatMode: 'single',
    },
  ];
  layout.routeObjectsInitialized = true;

  return layout;
}

export function cloneDefaultFishingLayout(
  mapId: FishingMapId = 'fishing-map-01',
): FishingSceneLayout {
  const layout = JSON.parse(JSON.stringify(DEFAULT_FISHING_SCENE_LAYOUT)) as FishingSceneLayout;
  return applyMapDefaults(layout, mapId);
}

function getFishingSceneLayoutKey(mapId: FishingMapId) {
  return mapId === 'fishing-map-01'
    ? FISHING_SCENE_LAYOUT_KEY
    : `${FISHING_SCENE_LAYOUT_KEY}:${mapId}`;
}

export function loadFishingSceneLayout(
  mapId: FishingMapId = 'fishing-map-01',
): FishingSceneLayout {
  const defaults = cloneDefaultFishingLayout(mapId);
  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(getFishingSceneLayoutKey(mapId));
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<FishingSceneLayout>;
    if (!saved.layers) return defaults;

    for (const id of Object.keys(defaults.layers) as FishingLayerId[]) {
      const base = defaults.layers[id];
      const savedLayer = saved.layers[id] ?? {};
      defaults.layers[id] = {
        ...base,
        ...savedLayer,
        id,
        sourceId: id,
        foam: base.foam
          ? { ...base.foam, ...(savedLayer.foam ?? {}) }
          : savedLayer.foam,
        waterFlow: base.waterFlow
          ? { ...base.waterFlow, ...(savedLayer.waterFlow ?? {}) }
          : savedLayer.waterFlow,
      };
    }
    // 第二张地图原本没有 far 素材；新增中景小山后，只迁移旧的占位层，
    // 已经由用户手动编辑过的新层不会被重置。
    if (
      mapId === 'fishing-map-02'
      && saved.layers.far?.name === '远景（待补）'
    ) {
      defaults.layers.far = cloneDefaultFishingLayout(mapId).layers.far;
    }
    // v3 旧构图曾把三座岛统一保存为 0.42、水面保存为 1.0。
    // 仅迁移这组旧默认值，用户之后在编辑器中自定义的视差不会被覆盖。
    const islandIds: FishingLayerId[] = ['islandForest', 'islandSmall', 'islandRocky'];
    const hasOldUniformIslandParallax = islandIds.every(
      (id) => Math.abs(defaults.layers[id].parallax - 0.42) < 0.001,
    );
    if (hasOldUniformIslandParallax) {
      defaults.layers.islandForest.parallax = 0.86;
      defaults.layers.islandSmall.parallax = 0.62;
      defaults.layers.islandRocky.parallax = 0.78;
    }
    if (Math.abs(defaults.layers.water.parallax - 1) < 0.001) {
      defaults.layers.water.parallax = 0.62;
    }
    // 纠正曾经把第二关水面误缩成 48/236px 的布局，恢复完整水面主体。
    if (
      mapId === 'fishing-map-02'
      && (
        Math.abs((defaults.layers.water.height ?? 300) - 48) < 0.001
        || Math.abs((defaults.layers.water.height ?? 300) - 236) < 0.001
      )
    ) {
      defaults.layers.water.height = 300;
    }
    // 水下背景与水面下沿保留 18px 柔和覆盖。
    const underwaterY = defaults.layers.underwater.y;
    if (
      Math.abs(underwaterY - 720) < 0.001
      || Math.abs(underwaterY - 770) < 0.001
      || Math.abs(underwaterY - 752) < 0.001
      || Math.abs(underwaterY - 688) < 0.001
      || Math.abs(underwaterY - 470) < 0.001
      || Math.abs(underwaterY - 674) < 0.001
    ) {
      defaults.layers.underwater.y = mapId === 'fishing-map-02' ? 720 : 752;
    }
    if (mapId === 'fishing-map-02') {
      if (
        Math.abs((defaults.layers.underwater.height ?? 1030) - 1030) < 0.001
        || Math.abs((defaults.layers.underwater.height ?? 1108) - 1108) < 0.001
      ) {
        defaults.layers.underwater.height = 1062;
      }
      if (Math.abs(defaults.layers.underwater.depth - (-5)) < 0.001) {
        defaults.layers.underwater.depth = 8.5;
      }
    }
    const defaultRouteCopies = defaults.copies.map((copy) => structuredClone(copy));
    defaults.copies = (saved.copies ?? []).map((copy, index) => {
      const sourceId = copy.sourceId && defaults.layers[copy.sourceId] ? copy.sourceId : 'islandSmall';
      const base = defaults.layers[sourceId];
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
    if (mapId === 'fishing-map-02' && saved.routeObjectsInitialized !== true) {
      const existingIds = new Set(defaults.copies.map((copy) => copy.id));
      defaults.copies.push(...defaultRouteCopies.filter((copy) => !existingIds.has(copy.id)));
    }
    // 用户新拖入的横向远山：从旧的通用“岛屿副本”迁移为固定连续远山带。
    // 编辑器显示的是原文件名，而 IndexedDB 会另生成 assetId，因此两者都需要识别。
    if (mapId === 'fishing-map-02') {
      for (const copy of defaults.copies) {
        const normalizedName = copy.name.replace(/\.[^.]+$/, '').toLowerCase();
        const isContinuousFarMountain = normalizedName === MAP02_CONTINUOUS_FAR_MOUNTAIN_FILE_ID
          || copy.assetId === MAP02_CONTINUOUS_FAR_MOUNTAIN_FILE_ID;
        if (!isContinuousFarMountain) continue;
        copy.sourceId = 'far';
        copy.name = '连续远山带';
        copy.repeatMode = 'horizontal';
        // 固定在屏幕远景层；中央矿山遗迹仍保留 0.05 视差，因此一定比它移动得慢。
        copy.parallax = 0;
        copy.foam = undefined;
      }
      for (const copy of defaults.copies) {
        if (copy.sourceId === 'far' && copy.repeatMode === 'horizontal') {
          copy.parallax = 0;
        }
      }
    }
    defaults.routeObjectsInitialized = mapId === 'fishing-map-02'
      ? true
      : saved.routeObjectsInitialized;
    defaults.deletedLayerIds = (saved.deletedLayerIds ?? []).filter(
      (id): id is FishingLayerId => id in defaults.layers,
    );
    defaults.waterlineY = saved.waterlineY ?? defaults.waterlineY;
    defaults.player = {
      ...defaults.player,
      ...(saved.player ?? {}),
      boat: { ...defaults.player.boat, ...(saved.player?.boat ?? {}) },
      fisher: { ...defaults.player.fisher, ...(saved.player?.fisher ?? {}) },
      rod: { ...defaults.player.rod, ...(saved.player?.rod ?? {}) },
      glow: { ...defaults.player.glow, ...(saved.player?.glow ?? {}) },
    };
    // 旧版默认吃水线半宽为 130px，视觉上明显长于船身。
    // 只迁移这个旧默认值，保留用户在编辑器中设置的其他宽度。
    if (Math.abs(defaults.player.boat.foamHalfWidth - 130) < 0.001) {
      defaults.player.boat.foamHalfWidth = 105;
    }
    // 新地图原先沿用旧地图的短竿默认值；仅迁移未手动修改过的 128px。
    if (mapId === 'fishing-map-02' && Math.abs(defaults.player.rod.length - 128) < 0.001) {
      defaults.player.rod.length = 175;
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveFishingSceneLayout(
  layout: FishingSceneLayout,
  mapId: FishingMapId = 'fishing-map-01',
) {
  window.localStorage.setItem(getFishingSceneLayoutKey(mapId), JSON.stringify(layout));
}
