export type RestaurantCharacterPoseId =
  | 'playerIdle'
  | 'playerWalk'
  | 'youngWomanWalk'
  | 'youngWomanSeated';

export type RestaurantCharacterPoseLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type RestaurantCharacterLayout = Record<
  RestaurantCharacterPoseId,
  RestaurantCharacterPoseLayout
>;

const STORAGE_KEY = 'lure:restaurant-character-layout:v1';
const WOMAN_WALK_MANUAL_SIZE_MIGRATION_KEY =
  'lure:restaurant-character-layout:woman-walk-manual-size:v1';

export const DEFAULT_RESTAURANT_CHARACTER_LAYOUT: RestaurantCharacterLayout = {
  playerIdle: { offsetX: 0, offsetY: 45, width: 72, height: 190 },
  playerWalk: { offsetX: 0, offsetY: 45, width: 101, height: 190 },
  youngWomanWalk: { offsetX: 0, offsetY: 29, width: 82, height: 140 },
  youngWomanSeated: { offsetX: 0, offsetY: 29, width: 48, height: 135 },
};

export function cloneDefaultRestaurantCharacterLayout(): RestaurantCharacterLayout {
  return structuredClone(DEFAULT_RESTAURANT_CHARACTER_LAYOUT);
}

export function adaptWalkingPosesFromReferences(layout: RestaurantCharacterLayout) {
  const playerWidthRatio = DEFAULT_RESTAURANT_CHARACTER_LAYOUT.playerWalk.width
    / DEFAULT_RESTAURANT_CHARACTER_LAYOUT.playerIdle.width;
  layout.playerWalk = {
    offsetX: layout.playerIdle.offsetX,
    offsetY: layout.playerIdle.offsetY,
    width: Math.round(layout.playerIdle.width * playerWidthRatio),
    height: layout.playerIdle.height,
  };

  const womanWidthRatio = DEFAULT_RESTAURANT_CHARACTER_LAYOUT.youngWomanWalk.width
    / DEFAULT_RESTAURANT_CHARACTER_LAYOUT.youngWomanSeated.width;
  const womanHeightRatio = DEFAULT_RESTAURANT_CHARACTER_LAYOUT.youngWomanWalk.height
    / DEFAULT_RESTAURANT_CHARACTER_LAYOUT.youngWomanSeated.height;
  // 坐姿原图中的人物占画布比例比走路帧更大；额外补偿后，两种状态的头部与躯干视觉尺度一致。
  const womanWalkVisualCompensation = 1.1;
  layout.youngWomanWalk = {
    offsetX: layout.youngWomanSeated.offsetX,
    offsetY: layout.youngWomanSeated.offsetY,
    width: Math.round(
      layout.youngWomanSeated.width * womanWidthRatio * womanWalkVisualCompensation,
    ),
    height: Math.round(
      layout.youngWomanSeated.height * womanHeightRatio * womanWalkVisualCompensation,
    ),
  };
  return layout;
}

export function loadRestaurantCharacterLayout(): RestaurantCharacterLayout {
  const defaults = cloneDefaultRestaurantCharacterLayout();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<RestaurantCharacterLayout>;
      for (const key of Object.keys(defaults) as RestaurantCharacterPoseId[]) {
        const pose = saved[key];
        if (!pose) continue;
        defaults[key] = {
          offsetX: Number.isFinite(pose.offsetX) ? pose.offsetX! : defaults[key].offsetX,
          offsetY: Number.isFinite(pose.offsetY) ? pose.offsetY! : defaults[key].offsetY,
          width: Number.isFinite(pose.width) ? pose.width! : defaults[key].width,
          height: Number.isFinite(pose.height) ? pose.height! : defaults[key].height,
        };
      }
    }
    if (!localStorage.getItem(WOMAN_WALK_MANUAL_SIZE_MIGRATION_KEY)) {
      defaults.youngWomanWalk.width = 194;
      defaults.youngWomanWalk.height = 331;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      localStorage.setItem(WOMAN_WALK_MANUAL_SIZE_MIGRATION_KEY, '1');
    }
  } catch {
    return defaults;
  }
  return defaults;
}

export function saveRestaurantCharacterLayout(layout: RestaurantCharacterLayout) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}
