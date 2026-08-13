export type FishingMapId = 'fishing-map-01' | 'fishing-map-02';

export type FishingMapConfig = {
  id: FishingMapId;
  name: string;
  subtitle: string;
  atmosphereEnabled: boolean;
  characterGlowEnabled: boolean;
  waterBand: {
    startRatio: number;
    heightRatio: number;
  };
  assets: {
    sky: string;
    far: string;
    middle: string;
    forest: string;
    islandSmall: string;
    islandForest: string;
    islandRocky: string;
    water: string;
    underwater: string;
    boat: string;
  };
};

export const FISHING_MAPS: Record<FishingMapId, FishingMapConfig> = {
  'fishing-map-01': {
    id: 'fishing-map-01',
    name: '平落湖',
    subtitle: '暮色山林 · 宁静水域',
    atmosphereEnabled: true,
    characterGlowEnabled: true,
    waterBand: {
      startRatio: 0.533,
      heightRatio: 0.31,
    },
    assets: {
      sky: '/fishing/replacement-v2/sky-base.png',
      far: '/fishing/replacement-v2/far-mountains.png',
      middle: '/fishing/replacement-v2/middle-mountains.png',
      forest: '/fishing/replacement-v2/middle-forest.png',
      islandSmall: '/fishing/replacement-v2/island-small.png',
      islandForest: '/fishing/replacement-v2/island-large.png',
      islandRocky: '/fishing/replacement-v2/island-rocky.png',
      water: '/fishing/replacement-v2/water-surface-02.png',
      underwater: '/fishing/replacement-v2/underwater-background-day.jpeg',
      boat: '/fishing/replacement-v2/boat-fisher-reflection.png',
    },
  },
  'fishing-map-02': {
    id: 'fishing-map-02',
    name: '沉蓝遗迹',
    subtitle: '废弃水域 · 深夜遗迹',
    atmosphereEnabled: false,
    characterGlowEnabled: true,
    // 新素材的有效水面从约 48.6% 处开始，并一直延伸到图片底部。
    waterBand: {
      startRatio: 0.486,
      heightRatio: 0.514,
    },
    assets: {
      sky: '/fishing/maps/fishing-map-02/sky.jpg',
      far: '/fishing/maps/fishing-map-02/middle-small-hill.png',
      middle: '/fishing/maps/fishing-map-02/middle-castle.png',
      forest: '/fishing/maps/fishing-map-02/right-castle.png',
      islandSmall: '/fishing/maps/fishing-map-02/right-bridge.png',
      islandForest: '/fishing/maps/fishing-map-02/left-tree-island.png',
      islandRocky: '/fishing/maps/fishing-map-02/water-deadwood.png',
      water: '/fishing/maps/fishing-map-02/water-surface.png',
      underwater: '/fishing/maps/fishing-map-02/underwater-background.png',
      boat: '/fishing/maps/fishing-map-02/boat-fisher-reflection.png',
    },
  },
};

export function getFishingMapId(value: string | null): FishingMapId | null {
  return value === 'fishing-map-01' || value === 'fishing-map-02' ? value : null;
}

export function getFishingMapIdFromLocation() {
  if (typeof window === 'undefined') return null;
  return getFishingMapId(new URLSearchParams(window.location.search).get('map'));
}
