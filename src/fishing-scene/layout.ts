export const FISHING_SCENE_LAYOUT_KEY = 'lure:fishing-scene-layout:v3';

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
};

export type FishingSceneLayout = {
  version: 1;
  waterlineY: number;
  layers: Record<FishingLayerId, FishingLayerLayout>;
  copies: FishingLayerLayout[];
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
    foamHalfWidth: 130,
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
      y: 720,
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

export function cloneDefaultFishingLayout(): FishingSceneLayout {
  return JSON.parse(JSON.stringify(DEFAULT_FISHING_SCENE_LAYOUT)) as FishingSceneLayout;
}

export function loadFishingSceneLayout(): FishingSceneLayout {
  const defaults = cloneDefaultFishingLayout();
  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(FISHING_SCENE_LAYOUT_KEY);
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
    };
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveFishingSceneLayout(layout: FishingSceneLayout) {
  window.localStorage.setItem(FISHING_SCENE_LAYOUT_KEY, JSON.stringify(layout));
}
