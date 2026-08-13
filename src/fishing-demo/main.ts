import Phaser from 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin.js';
import { loadSceneAssetUrls } from '../fishing-scene/customAssets';

// 让 TS 能识别每个 Scene 上挂载的 rexUI 属性（RexUIPlugin 会通过 mapping 自动注入）
declare module 'phaser' {
  interface Scene {
    rexUI: RexUIPlugin;
  }
}

declare global {
  interface Window {
    openFishingMapSelect?: () => void;
    selectFishingMap?: (mapId: string) => void;
  }
}
import {
  loadFishingSceneLayout,
  type FishingLayerLayout,
  type FishingSceneLayout,
} from '../fishing-scene/layout';
import {
  drawContinuousFoamRing,
  drawFoamStrip,
  getIslandFoam,
  getIslandFoamHalfWidth,
  getIslandFoamWorldY,
} from '../fishing-scene/islandFoam';
import { AtmosphereFx } from '../fishing-scene/atmosphereFx';
import {
  RestaurantService,
  type RestaurantServiceResult,
} from '../fishing-scene/restaurantService';
import { createRestaurantLightEditor } from '../fishing-scene/restaurantLightEditor';
import {
  FISHING_MAPS,
  getFishingMapIdFromLocation,
} from '../fishing-scene/maps';

const VIEW_W = 1280;
const VIEW_H = 720;
const SELECTED_MAP_ID = getFishingMapIdFromLocation();
const ACTIVE_MAP_ID = SELECTED_MAP_ID ?? 'fishing-map-01';
const ACTIVE_MAP = FISHING_MAPS[ACTIVE_MAP_ID];
const SAVED_SCENE_LAYOUT = loadFishingSceneLayout(ACTIVE_MAP_ID);
const MAP_TRANSFER_STATE_KEY = 'lure:fishing-map-transfer-state:v1';
let customAssetUrls = new Map<string, string>();
// 航行初始构图参考 Cast n Chill：水线位于画面下方约三分之一处。
// 进入钓鱼后再通过相机向下移动展示水下空间。
// 玩家、鱼点和垂钓逻辑统一使用编辑器中的水面基准线。
// 水面美术图层可以独立移动，不能拿它的 y 作为玩家坐标，否则编辑器预览会与游戏错位。
const SURFACE_Y = SAVED_SCENE_LAYOUT.waterlineY;
const WORLD_BOTTOM = 1500;
const WORLD_WIDTH = 100_000;
const SAIL_START_X = 420;
const MAX_SAIL_DISTANCE_M = 3000;
const MANUAL_SAIL_SPEED = 150;
const SAIL_END_X = SAIL_START_X + MAX_SAIL_DISTANCE_M;
const END_BARRIER_ISLAND_X = SAIL_END_X + 820;
// 新水面素材从有效水线开始裁切，船体不再需要旧素材的 75px 垂直补偿。
const BOAT_VERTICAL_SHIFT = 0;
const FISHING_SURFACE_Y = SURFACE_Y + BOAT_VERTICAL_SHIFT;
const PLAYER_LAYOUT = SAVED_SCENE_LAYOUT.player;
const PLAYER_SCREEN_X = PLAYER_LAYOUT.previewX;
// 船 PNG 可见底边相对锚点的偏移（与 drawBoatWake 一致）。
const HUD_UPDATE_INTERVAL_MS = 100;
const SCENERY_UPDATE_INTERVAL_MS = 80;

type DemoMode =
  | 'sailing'
  | 'casting'
  | 'fishing'
  | 'hooked'
  | 'result'
  | 'port'
  | 'service'
  | 'shipyard'
  | 'dialogue';
type PortTab = 'overview' | 'prep' | 'open' | 'shipyard' | 'night';

const UI_FONT = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif';
const UI_FONT_DISPLAY = UI_FONT;
const UI_COLOR_TITLE = '#ead8cc';
const UI_COLOR_BODY = '#d2bdb2';
const UI_COLOR_MUTED = '#9f8882';
const UI_COLOR_ACCENT = '#c7a391';
const UI_COLOR_GOLD = '#c2a08f';
const UI_DEPTH_PORT = 201;
const UI_DEPTH_SHIPYARD = 231;
const UI_DEPTH_NIGHT = 261;
const UI_DEPTH_SERVICE = 291;

type FishAgent = {
  sprite: Phaser.GameObjects.Sprite;
  homeX: number;
  baseY: number;
  speed: number;
  value: number;
  name: string;
  phase: number;
  swimDirection: -1 | 1;
  interest: number;
  awarenessDelay: number;
  behavior: 'unaware' | 'curious' | 'retreating' | 'returning' | 'circling';
  stateTimer: number;
  orbitAngle: number;
  biteDelay: number;
  approachSide: -1 | 1;
};

type SceneryStrip = {
  items: Phaser.GameObjects.Image[];
  step: number;
  scrollFactor: number;
};

type IslandAgent = {
  sprite: Phaser.GameObjects.Image;
  layout: FishingLayerLayout;
};

type BoatWakeParticle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  age: number;
  lifetime: number;
  length: number;
  thickness: number;
  phase: number;
  direction: number;
  foam: boolean;
};

type FishingLinePoint = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
};

type InventoryItem = {
  id: string;
  name: string;
  category: 'tool' | 'bait' | 'fish';
  iconKey: string;
  quantity: number;
  unitValue: number;
  description: string;
};

/**
 * 这份 Demo 全部使用 generateTexture / Graphics 占位。
 * 后续替换美术时，保持以下 texture key 不变即可逐件替换：
 * boat / fisher / lure / fish-common / fish-rare / hotspot
 */
class FishingDemoScene extends Phaser.Scene {
  private readonly sceneLayout: FishingSceneLayout = SAVED_SCENE_LAYOUT;
  private mode: DemoMode = 'sailing';
  private boat!: Phaser.GameObjects.Sprite;
  private characterGlow!: Phaser.GameObjects.Sprite;
  private fisher!: Phaser.GameObjects.Sprite;
  private boatReflection!: Phaser.GameObjects.Sprite;
  private fisherReflection!: Phaser.GameObjects.Sprite;
  private lure!: Phaser.GameObjects.Sprite;
  private rod!: Phaser.GameObjects.Graphics;
  private line!: Phaser.GameObjects.Graphics;
  private boatWake!: Phaser.GameObjects.Graphics;
  private islandFoam!: Phaser.GameObjects.Graphics;
  private waterSurface!: Phaser.GameObjects.TileSprite;
  private waterFlowTime = 0;
  private surfaceBlend?: Phaser.GameObjects.TileSprite;
  private waterlineFoam?: Phaser.GameObjects.Graphics;
  private waterlineWorldY = 0;
  private boatWakeParticles: BoatWakeParticle[] = [];
  private boatWakeEmitTimer = 0;
  private linePoints: FishingLinePoint[] = [];
  private rodAngle = -0.78;
  private previousRodAngle = -0.78;
  private rodTipX = SAIL_START_X + 130;
  private rodTipY = FISHING_SURFACE_Y - 120;
  private castTimer = 0;
  private castReleased = false;
  private castVelocityX = 0;
  private castVelocityY = 0;
  private lureCastX = SAIL_START_X + 330;
  private surfaceFx!: Phaser.GameObjects.Graphics;
  private atmosphereFx!: AtmosphereFx;
  private restaurantService!: RestaurantService;
  private sceneryStrips: SceneryStrip[] = [];
  private islands: IslandAgent[] = [];
  private islandGenerationIndex = 0;
  private fish: FishAgent[] = [];
  private hookedFish?: FishAgent;

  private worldX = SAIL_START_X;
  private sailSpeed = 0;
  private nextHotspotX = 1350;
  private hotspot!: Phaser.GameObjects.Sprite;
  private hotspotLabel!: Phaser.GameObjects.Text;

  private lureDepth = 0;
  private lureDropBoostTimer = 0;
  private tension = 30;
  private fishStamina = 100;
  private lineDistance = 420;
  private pullTimer = 0;
  private fishPulling = false;
  private fishSecured = false;
  private surfaceRollsRemaining = 0;
  private surfaceRollTimer = 0;
  private surfaceRollElapsed = 0;
  private surfaceRollCenterX = 0;
  private resultTimer = 0;
  private hudUpdateElapsedMs = 0;
  private sceneryUpdateElapsedMs = 0;

  private cargoCount = 0;
  private cargoValue = 0;
  private inventory: InventoryItem[] = [
    {
      id: 'tool:rod',
      name: '旧海竿',
      category: 'tool',
      iconKey: 'inventory-rod',
      quantity: 1,
      unitValue: 0,
      description: '陪你出海多年的鱼竿。升级重型鱼竿后，搏鱼时更不容易断线。',
    },
    {
      id: 'bait:basic',
      name: '港湾鱼饵',
      category: 'bait',
      iconKey: 'inventory-bait',
      quantity: 12,
      unitValue: 2,
      description: '常见的小鱼和虾制成的鱼饵。每次抛竿消耗 1 个。',
    },
  ];
  private coins = 0;
  private preparedServings = 0;
  private preparedRevenue = 0;
  private reputation = 0;
  private lastServiceMessage = '尚未备菜。先把今日渔获送进厨房。';
  private lastShipyardMessage = '船坞可以修理船体，并改造夜航装备。';
  private isNight = false;
  private secretQuest: 'available' | 'accepted' | 'completed' = 'available';
  private secretFishCaught = false;
  private secretVisitorTimer?: Phaser.Time.TimerEvent;
  private boatHp = 100;
  private readonly boatMaxHp = 100;
  private nightThreat = 0;
  private hullLevel = 0;
  private rodLevel = 0;
  private dangerMessage = '夜海很安静，但有什么东西跟着船。';
  private lastCatch = '';

  private keys!: Record<'left' | 'right' | 'up' | 'down' | 'space' | 'port', Phaser.Input.Keyboard.Key>;
  private titleText!: Phaser.GameObjects.Text;
  private hintPanel!: Phaser.GameObjects.Graphics;
  private hintText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private depthText!: Phaser.GameObjects.Text;
  private cargoText!: Phaser.GameObjects.Text;
  private portButton!: Phaser.GameObjects.Text;
  private sailingHudObjects: Phaser.GameObjects.GameObject[] = [];
  private portTab: PortTab = 'overview';
  private portNavItems: Phaser.GameObjects.Container[] = [];
  private primaryActionButton!: Phaser.GameObjects.Container;
  private primaryActionLabel!: Phaser.GameObjects.Text;
  private portDepartureLabel!: Phaser.GameObjects.Text;
  private portActionTitle!: Phaser.GameObjects.Text;
  private portActionDesc!: Phaser.GameObjects.Text;
  private nightActionLabel!: Phaser.GameObjects.Text;
  private repairLabel!: Phaser.GameObjects.Text;
  private hullUpgradeLabel!: Phaser.GameObjects.Text;
  private rodUpgradeLabel!: Phaser.GameObjects.Text;
  private dangerHud!: Phaser.GameObjects.Container;
  private boatHpFill!: Phaser.GameObjects.Rectangle;
  private threatFill!: Phaser.GameObjects.Rectangle;
  private dangerText!: Phaser.GameObjects.Text;
  private tensionLabel!: Phaser.GameObjects.Text;
  private staminaLabel!: Phaser.GameObjects.Text;
  private meterBg!: Phaser.GameObjects.Rectangle;
  private meterFill!: Phaser.GameObjects.Rectangle;
  private staminaBg!: Phaser.GameObjects.Rectangle;
  private staminaFill!: Phaser.GameObjects.Rectangle;
  private portPanel!: Phaser.GameObjects.Container;
  private shipyardPanel!: Phaser.GameObjects.Container;
  private nightDialogue!: Phaser.GameObjects.Container;
  private bountyHunterGroup!: Phaser.GameObjects.Container;
  private bountyHunterSceneDim!: Phaser.GameObjects.Rectangle;
  private bountyHunterEntranceTween?: Phaser.Tweens.Tween;
  private readonly bountyHunterHomeX = 920;
  private readonly bountyHunterHomeY = 675;
  private readonly bountyHunterDisplayHeight = 575;
  private portInteractives: Phaser.GameObjects.GameObject[] = [];
  private shipyardInteractives: Phaser.GameObjects.GameObject[] = [];
  private nightInteractives: Phaser.GameObjects.GameObject[] = [];
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private resultCard!: Phaser.GameObjects.Container;
  private inventoryOpen = false;
  private inventoryPanel!: Phaser.GameObjects.Container;
  private inventorySlotObjects: Phaser.GameObjects.Container[] = [];
  private inventorySlotHitAreas: Phaser.GameObjects.Rectangle[] = [];
  private inventorySlotBackgrounds: Phaser.GameObjects.Graphics[] = [];
  private inventorySlotIcons: Phaser.GameObjects.Image[] = [];
  private inventorySlotQuantities: Phaser.GameObjects.Text[] = [];
  private inventoryDetail!: Phaser.GameObjects.Text;
  private inventoryButton!: Phaser.GameObjects.Text;
  private inventoryButtonFrame!: Phaser.GameObjects.Graphics;
  private inventoryCloseButton!: Phaser.GameObjects.Text;
  private inventoryTrashButton!: Phaser.GameObjects.Container;
  private inventoryTrashHitArea!: Phaser.GameObjects.Rectangle;
  private inventoryDragIcon!: Phaser.GameObjects.Image;
  private inventoryDragQuantity!: Phaser.GameObjects.Text;
  private selectedInventoryIndex = -1;
  private inventoryDraggingIndex = -1;
  private inventoryDragStartX = 0;
  private inventoryDragStartY = 0;
  private inventoryDragMoved = false;
  private inventoryTrashHovered = false;
  private suppressInventoryClick = false;

  constructor() {
    super('FishingDemo');
  }

  preload() {
    this.load.image('scene-sky', ACTIVE_MAP.assets.sky);
    this.load.image('scene-far', ACTIVE_MAP.assets.far);
    this.load.image('scene-middle', ACTIVE_MAP.assets.middle);
    this.load.image('scene-forest', ACTIVE_MAP.assets.forest);
    this.load.image('scene-island-small', ACTIVE_MAP.assets.islandSmall);
    this.load.image('scene-island-forest', ACTIVE_MAP.assets.islandForest);
    this.load.image('scene-island-rocky', ACTIVE_MAP.assets.islandRocky);
    this.load.image('scene-water', ACTIVE_MAP.assets.water);
    this.load.image('scene-underwater', ACTIVE_MAP.assets.underwater);
    this.load.image('restaurant-background', '/fishing/restaurant-background-new.png');
    this.load.image('shipyard-background', '/fishing/shipyard-background.png');
    this.load.image('faceless-bounty-hunter', '/fishing/faceless-bounty-hunter.png');
    this.load.image('boat', ACTIVE_MAP.assets.boat);
    this.load.image('fisher', '/fishing/fisher.png');
    this.load.image(
      'restaurant-player-idle-front',
      '/fishing/restaurant/characters/player/player-idle-front.png',
    );
    this.load.spritesheet(
      'restaurant-player-walk-right',
      '/fishing/restaurant/characters/player/player-walk-right.png',
      { frameWidth: 320, frameHeight: 600 },
    );
    this.load.image(
      'restaurant-customer-young-woman-seated',
      '/fishing/restaurant/characters/customers/young-woman/young-woman-seated-back.png',
    );
    this.load.spritesheet(
      'restaurant-customer-young-woman-walk',
      '/fishing/restaurant/characters/customers/young-woman/young-woman-walk-right.png',
      { frameWidth: 420, frameHeight: 720 },
    );
    for (const layer of this.sceneLayout.copies) {
      if (!layer.assetId) continue;
      const url = customAssetUrls.get(layer.assetId);
      if (url) this.load.image(layer.textureKey, url);
    }
  }

  create() {
    this.restoreMapTransferState();
    this.installMapSelectionBridge();
    this.createPlaceholderTextures();
    this.createRestaurantCharacterAnimations();
    this.createSeamlessUnderwaterTexture();
    this.createSeamlessWaterTexture();
    this.createWorld();
    this.createScenery();
    this.registry.set('fishingSurfaceY', FISHING_SURFACE_Y);
    const atmosphereSunX = VIEW_W * 0.66;
    const atmosphereSunY = VIEW_H * 0.08;
    this.registry.set('atmosphereSunX', atmosphereSunX);
    this.atmosphereFx = new AtmosphereFx(this);
    this.atmosphereFx.create({
      viewW: VIEW_W,
      viewH: VIEW_H,
      surfaceY: FISHING_SURFACE_Y,
      sunX: atmosphereSunX,
      sunY: atmosphereSunY,
      rayAngle: -0.68,
    });
    this.createPlayer();
    this.createHud();
    this.createInventoryUI();
    this.createPortPanel();
    this.createRestaurantService();
    this.createShipyardPanel();
    this.createNightDialogue();
    this.createResultCard();
    this.createInput();

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_BOTTOM);
    this.cameras.main.setBackgroundColor(
      ACTIVE_MAP_ID === 'fishing-map-02' ? '#030819' : '#86c8d4',
    );
    this.cameras.main.scrollX = SAIL_START_X - PLAYER_SCREEN_X;
    this.cameras.main.scrollY = 0;
    this.updateHud();
  }

  private createRestaurantCharacterAnimations() {
    if (!this.anims.exists('restaurant-player-walk')) {
      this.anims.create({
        key: 'restaurant-player-walk',
        frames: this.anims.generateFrameNumbers('restaurant-player-walk-right', {
          start: 0,
          end: 3,
        }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists('restaurant-customer-young-woman-walk')) {
      this.anims.create({
        key: 'restaurant-customer-young-woman-walk',
        frames: this.anims.generateFrameNumbers('restaurant-customer-young-woman-walk', {
          start: 0,
          end: 3,
        }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private installMapSelectionBridge() {
    window.selectFishingMap = (mapId: string) => {
      if (mapId !== 'fishing-map-01' && mapId !== 'fishing-map-02') return;
      const transferState = {
        cargoCount: this.cargoCount,
        cargoValue: this.cargoValue,
        inventory: this.inventory,
        coins: this.coins,
        preparedServings: this.preparedServings,
        preparedRevenue: this.preparedRevenue,
        reputation: this.reputation,
        lastServiceMessage: this.lastServiceMessage,
        lastShipyardMessage: this.lastShipyardMessage,
        secretQuest: this.secretQuest,
        secretFishCaught: this.secretFishCaught,
        boatHp: this.boatHp,
        nightThreat: this.nightThreat,
        hullLevel: this.hullLevel,
        rodLevel: this.rodLevel,
        lastCatch: this.lastCatch,
      };
      window.sessionStorage.setItem(MAP_TRANSFER_STATE_KEY, JSON.stringify(transferState));
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('map', mapId);
      window.location.href = nextUrl.toString();
    };
  }

  private restoreMapTransferState() {
    const raw = window.sessionStorage.getItem(MAP_TRANSFER_STATE_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(MAP_TRANSFER_STATE_KEY);
    try {
      const saved = JSON.parse(raw) as Partial<{
        cargoCount: number;
        cargoValue: number;
        inventory: InventoryItem[];
        coins: number;
        preparedServings: number;
        preparedRevenue: number;
        reputation: number;
        lastServiceMessage: string;
        lastShipyardMessage: string;
        secretQuest: 'available' | 'accepted' | 'completed';
        secretFishCaught: boolean;
        boatHp: number;
        nightThreat: number;
        hullLevel: number;
        rodLevel: number;
        lastCatch: string;
      }>;
      if (typeof saved.cargoCount === 'number') this.cargoCount = saved.cargoCount;
      if (typeof saved.cargoValue === 'number') this.cargoValue = saved.cargoValue;
      if (Array.isArray(saved.inventory)) this.inventory = saved.inventory;
      if (typeof saved.coins === 'number') this.coins = saved.coins;
      if (typeof saved.preparedServings === 'number') this.preparedServings = saved.preparedServings;
      if (typeof saved.preparedRevenue === 'number') this.preparedRevenue = saved.preparedRevenue;
      if (typeof saved.reputation === 'number') this.reputation = saved.reputation;
      if (typeof saved.lastServiceMessage === 'string') this.lastServiceMessage = saved.lastServiceMessage;
      if (typeof saved.lastShipyardMessage === 'string') this.lastShipyardMessage = saved.lastShipyardMessage;
      if (
        saved.secretQuest === 'available'
        || saved.secretQuest === 'accepted'
        || saved.secretQuest === 'completed'
      ) {
        this.secretQuest = saved.secretQuest;
      }
      if (typeof saved.secretFishCaught === 'boolean') this.secretFishCaught = saved.secretFishCaught;
      if (typeof saved.boatHp === 'number') this.boatHp = saved.boatHp;
      if (typeof saved.nightThreat === 'number') this.nightThreat = saved.nightThreat;
      if (typeof saved.hullLevel === 'number') this.hullLevel = saved.hullLevel;
      if (typeof saved.rodLevel === 'number') this.rodLevel = saved.rodLevel;
      if (typeof saved.lastCatch === 'string') this.lastCatch = saved.lastCatch;
    } catch {
      // 损坏的临时状态直接忽略，不影响进入钓鱼地图。
    }
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.04);

    if (!this.inventoryOpen && (
      this.mode === 'sailing' || this.mode === 'casting' || this.mode === 'fishing' || this.mode === 'hooked'
    )) {
      this.updateBoatBobbing();
    }
    if (!this.inventoryOpen && this.mode === 'sailing') this.updateSailing(dt);
    if (!this.inventoryOpen && this.mode === 'casting') this.updateCasting(dt);
    if (!this.inventoryOpen && this.mode === 'fishing') this.updateFishing(dt);
    if (!this.inventoryOpen && this.mode === 'hooked') this.updateHooked(dt);
    if (!this.inventoryOpen && this.mode === 'result') this.updateResult(dt);
    if (this.mode === 'service') this.restaurantService.update(dt);
    if (!this.inventoryOpen && this.isNight && (
      this.mode === 'sailing' || this.mode === 'fishing' || this.mode === 'hooked'
    )) {
      this.updateNightDanger(dt);
    }

    this.sceneryUpdateElapsedMs += deltaMs;
    if (this.sceneryUpdateElapsedMs >= SCENERY_UPDATE_INTERVAL_MS) {
      this.sceneryUpdateElapsedMs %= SCENERY_UPDATE_INTERVAL_MS;
      for (const strip of this.sceneryStrips) {
        this.recycleStrip(strip);
        this.ensureStripCoverage(strip);
      }
    }
    this.drawBoatWake(dt);
    this.drawIslandFoam();
    this.updateWaterFlow(dt);
    this.updateWaterBoundary(dt);
    this.atmosphereFx.update(this.time.now, this.cameras.main);
    this.syncAtmosphereFx();
    this.drawFishingRod(dt);
    this.drawFishingLine(dt);
    this.hudUpdateElapsedMs += deltaMs;
    if (this.hudUpdateElapsedMs >= HUD_UPDATE_INTERVAL_MS) {
      this.hudUpdateElapsedMs %= HUD_UPDATE_INTERVAL_MS;
      this.updateHud();
    }
  }

  private createPlaceholderTextures() {
    const g = this.add.graphics();

    g.fillStyle(0xffd36a).fillCircle(8, 8, 7);
    g.lineStyle(2, 0xfff1ad).strokeCircle(8, 8, 7);
    g.generateTexture('lure', 16, 16);
    g.clear();

    // 参考图中的鱼采用低饱和紫蓝色、浅色腹部和利落的尖吻轮廓。
    // 稀有鱼只略微偏粉紫，避免脱离整片水下场景的统一配色。
    this.drawFishTexture(g, 'fish-common', 0x7773a8, 0x494b78, 0xd9d7e8);
    this.drawFishTexture(g, 'fish-rare', 0x8b72aa, 0x55466f, 0xe8dce9);

    // 背包物品图标：独立纹理便于后续直接替换成正式美术。
    g.lineStyle(6, 0x5a3828, 1).lineBetween(12, 54, 43, 20);
    g.lineStyle(3, 0xd2b374, 1).lineBetween(17, 49, 51, 12);
    g.lineStyle(2, 0xd9edf0, 0.9).lineBetween(51, 12, 55, 43);
    g.lineStyle(3, 0x314c5b, 1).strokeCircle(20, 45, 8);
    g.fillStyle(0xc9a25f).fillCircle(20, 45, 4);
    g.lineStyle(2, 0xd9edf0, 0.9);
    g.beginPath();
    g.arc(51, 45, 5, 0, Math.PI * 1.2);
    g.strokePath();
    g.generateTexture('inventory-rod', 64, 64);
    g.clear();

    g.fillStyle(0x526d72).fillRoundedRect(7, 20, 50, 38, 8);
    g.fillStyle(0x88a6a4).fillRoundedRect(5, 15, 54, 12, 5);
    g.lineStyle(3, 0xd8c28a, 1);
    g.beginPath();
    g.arc(22, 34, 10, 0.2, Math.PI * 1.55);
    g.strokePath();
    g.beginPath();
    g.arc(40, 39, 9, Math.PI * 0.9, Math.PI * 2.15);
    g.strokePath();
    g.fillStyle(0xe3c66f).fillCircle(17, 31, 3);
    g.fillCircle(45, 42, 3);
    g.generateTexture('inventory-bait', 64, 64);
    g.clear();

    // 背包丢弃区使用参考图中的纤细象牙白线稿垃圾桶。
    g.lineStyle(3, 0xf1e9df, 0.96);
    g.strokeRoundedRect(16, 18, 32, 38, 5);
    g.lineBetween(11, 16, 53, 16);
    g.lineBetween(24, 10, 40, 10);
    g.lineBetween(27, 6, 37, 6);
    g.lineStyle(2, 0xd8ced5, 0.82);
    g.lineBetween(26, 25, 26, 48);
    g.lineBetween(38, 25, 38, 48);
    g.generateTexture('inventory-trash', 64, 64);
    g.clear();

    g.fillStyle(0xffe49a, 0.28).fillCircle(22, 22, 21);
    g.lineStyle(3, 0xffdc72, 0.9).strokeCircle(22, 22, 17);
    g.generateTexture('hotspot', 44, 44);
    g.clear();

    for (let i = 0; i < 22; i++) {
      const x = (i * 73 + 19) % 256;
      const y = (i * 47 + 31) % 256;
      g.fillStyle(0xc9eef0, 0.18).fillCircle(x, y, 1 + (i % 3));
    }
    g.generateTexture('underwater-specks', 256, 256);
    g.destroy();

  }

  private drawFishTexture(
    g: Phaser.GameObjects.Graphics,
    key: string,
    body: number,
    detail: number,
    belly: number,
  ) {
    // 分叉尾：上下两片略不对称，保持参考图中轻盈的手绘轮廓。
    g.fillStyle(detail, 0.96);
    g.fillTriangle(25, 26, 5, 9, 10, 25);
    g.fillTriangle(25, 26, 7, 43, 10, 27);

    // 主体前端收尖，轮廓比原先的椭圆占位鱼更接近参考图。
    g.fillStyle(body);
    g.fillPoints([
      new Phaser.Geom.Point(20, 25),
      new Phaser.Geom.Point(31, 13),
      new Phaser.Geom.Point(55, 10),
      new Phaser.Geom.Point(74, 15),
      new Phaser.Geom.Point(89, 25),
      new Phaser.Geom.Point(76, 34),
      new Phaser.Geom.Point(53, 39),
      new Phaser.Geom.Point(31, 35),
    ], true);

    // 浅色腹部从身体中段延伸到尖吻下缘。
    g.fillStyle(belly, 0.94);
    g.fillPoints([
      new Phaser.Geom.Point(28, 29),
      new Phaser.Geom.Point(49, 31),
      new Phaser.Geom.Point(69, 28),
      new Phaser.Geom.Point(87, 25),
      new Phaser.Geom.Point(76, 34),
      new Phaser.Geom.Point(53, 39),
      new Phaser.Geom.Point(35, 35),
    ], true);

    // 背鳍、腹鳍和参考图中向后展开的半透明胸鳍。
    g.fillStyle(detail, 0.92);
    g.fillTriangle(42, 12, 53, 2, 61, 12);
    g.fillTriangle(49, 37, 61, 47, 66, 35);
    g.fillStyle(belly, 0.72);
    g.fillTriangle(57, 25, 45, 20, 49, 31);

    // 鳃线与眼睛；不绘制参考图鱼背上的花瓣装饰。
    g.lineStyle(1.5, detail, 0.7);
    g.lineBetween(70, 17, 67, 27);
    g.fillStyle(0xf4ecf1).fillCircle(76, 19, 3);
    g.fillStyle(0x35364f).fillCircle(77, 19, 1.45);
    g.fillStyle(0xffffff, 0.85).fillCircle(77.5, 18.4, 0.55);

    g.generateTexture(key, 96, 50);
    g.clear();
  }

  private createSeamlessUnderwaterTexture() {
    const source = this.textures.get('scene-underwater').getSourceImage() as HTMLImageElement;
    const width = source.width * 2;
    const height = source.height;
    const texture = this.textures.createCanvas('scene-underwater-seamless', width, height);
    const context = texture.context;
    // 直接调整原图明度和饱和度，避免 Screen 混合把暗部冲成灰白。
    context.filter = ACTIVE_MAP_ID === 'fishing-map-02'
      ? 'brightness(0.76) saturate(0.92)'
      : 'brightness(1.12) saturate(1.2)';
    context.drawImage(source, 0, 0);
    context.save();
    context.translate(source.width * 2, 0);
    context.scale(-1, 1);
    context.drawImage(source, 0, 0);
    context.restore();
    context.filter = 'none';

    texture.refresh();
  }

  private createSeamlessWaterTexture() {
    if (this.textures.exists('scene-water-seamless')) return;
    const source = this.textures.get('scene-water').getSourceImage() as HTMLImageElement;
    const bandY = Math.round(source.height * ACTIVE_MAP.waterBand.startRatio);
    const bandHeight = Math.round(source.height * ACTIVE_MAP.waterBand.heightRatio);
    const texture = this.textures.createCanvas(
      'scene-water-seamless',
      source.width * 2,
      bandHeight * 2,
    );
    const context = texture.context;
    context.clearRect(0, 0, source.width * 2, bandHeight * 2);

    // 四象限镜像：左右移动和上下浮动时都不会循环到不连续的贴图边缘。
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

  private createWorld() {
    const underwaterLayout = this.sceneLayout.layers.underwater;
    const underwaterTexture = this.textures.get('scene-underwater').getSourceImage() as HTMLImageElement;
    const underwaterHeight = (underwaterLayout.height ?? WORLD_BOTTOM - SURFACE_Y) * underwaterLayout.stretchY;
    const underwaterScaleX = (underwaterLayout.width * underwaterLayout.stretchX) / underwaterTexture.width;
    const underwaterScaleY = underwaterHeight / underwaterTexture.height;
    this.add.tileSprite(
      WORLD_WIDTH / 2,
      underwaterLayout.y,
      WORLD_WIDTH,
      underwaterHeight,
      'scene-underwater-seamless',
    )
      .setOrigin(0.5, 0)
      .setTileScale(underwaterScaleX, underwaterScaleY)
      .setAlpha(underwaterLayout.alpha)
      .setDepth(underwaterLayout.depth)
      .setVisible(this.isLayerVisible(underwaterLayout));

    // 每张地图按自身素材的真实水平线截取，避免把新地图顶部的发光水线裁掉。
    const waterTexture = this.textures.get('scene-water');
    const waterSource = waterTexture.getSourceImage() as HTMLImageElement;
    const bandY = Math.round(waterSource.height * ACTIVE_MAP.waterBand.startRatio);
    const bandHeight = Math.round(waterSource.height * ACTIVE_MAP.waterBand.heightRatio);
    if (!waterTexture.has('usable-band')) {
      waterTexture.add('usable-band', 0, 0, bandY, waterSource.width, bandHeight);
    }
    const waterLayout = this.sceneLayout.layers.water;
    const waterHeight = (waterLayout.height ?? 118) * waterLayout.stretchY;
    this.waterSurface = this.add.tileSprite(WORLD_WIDTH / 2, waterLayout.y, WORLD_WIDTH, waterHeight, 'scene-water-seamless')
      .setOrigin(0.5, 0)
      .setTileScale((waterLayout.width * waterLayout.stretchX) / waterSource.width, waterHeight / bandHeight)
      .setScrollFactor(waterLayout.parallax, 1)
      .setAlpha(waterLayout.alpha)
      .setDepth(waterLayout.depth)
      .setVisible(this.isLayerVisible(waterLayout));

    this.add.tileSprite(
      WORLD_WIDTH / 2,
      underwaterLayout.y,
      WORLD_WIDTH,
      WORLD_BOTTOM - underwaterLayout.y,
      'underwater-specks',
    ).setOrigin(0.5, 0).setDepth(-3);

    this.createWaterBoundaryBlend(waterLayout, underwaterLayout, waterHeight);

    this.surfaceFx = this.add.graphics().setDepth(20);
  }

  /**
   * 水面 / 水下衔接的两个视觉层：
   * 1. `surfaceBlend`：水面下沿的短渐变带，把水下顶部的冷蓝往水面暖紫色拉一小段。
   *    深度介于水面和水下之间，只补色不抢戏。
   * 2. `waterlineFoam`：Graphics 层，每帧沿水下顶端画一条**和船只吃水线同款**的
   *    手绘感白色/淡色分段泡沫。逐帧计算摄像机可视 X 区间，效果和布置船体尾流一致，
   *    避免用 tileSprite 时那种平铺硬边。
   */
  private createWaterBoundaryBlend(
    waterLayout: FishingLayerLayout,
    underwaterLayout: FishingLayerLayout,
    waterHeight: number,
  ) {
    this.waterlineWorldY = waterLayout.y + waterHeight;

    const useMap02Blend = ACTIVE_MAP_ID === 'fishing-map-02';
    const blendKey = useMap02Blend
      ? 'water-underwater-blend-map02'
      : 'water-underwater-blend';
    if (!this.textures.exists(blendKey)) {
      const blendCanvas = this.textures.createCanvas(
        blendKey,
        16,
        useMap02Blend ? 180 : 140,
      );
      if (blendCanvas) {
        const ctx = blendCanvas.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, useMap02Blend ? 180 : 140);
        if (useMap02Blend) {
          // 水面本身不透明，因此用水下顶部颜色由下向上柔和覆盖，
          // 视觉上等同于把水下场景向上延伸，但不修改水面纹理和流动效果。
          gradient.addColorStop(0, 'rgba(3, 74, 103, 0)');
          gradient.addColorStop(0.55, 'rgba(3, 78, 108, 0.28)');
          gradient.addColorStop(0.84, 'rgba(3, 82, 112, 0.68)');
          gradient.addColorStop(1, 'rgba(3, 86, 116, 0.88)');
        } else {
          gradient.addColorStop(0, 'rgba(178, 158, 200, 0.55)');
          gradient.addColorStop(0.5, 'rgba(120, 118, 176, 0.28)');
          gradient.addColorStop(1, 'rgba(60, 78, 140, 0)');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 16, useMap02Blend ? 180 : 140);
        blendCanvas.refresh();
      }
    }

    const blendDepth = Math.max(underwaterLayout.depth + 1, waterLayout.depth - 1);
    this.surfaceBlend = this.add.tileSprite(
      WORLD_WIDTH / 2,
      useMap02Blend ? this.waterlineWorldY - 150 : this.waterlineWorldY - 6,
      WORLD_WIDTH,
      useMap02Blend ? 180 : 140,
      blendKey,
    )
      .setOrigin(0.5, 0)
      .setDepth(useMap02Blend ? waterLayout.depth + 0.5 : blendDepth)
      .setAlpha(useMap02Blend ? 1 : 0.85);

    this.waterlineFoam = this.add.graphics().setDepth(waterLayout.depth + 1);
  }

  private drawWaterlineFoam() {
    if (!this.waterlineFoam) return;
    this.waterlineFoam.clear();
    if (this.inManagementMode) return;

    const cam = this.cameras.main;
    const startX = cam.scrollX - 40;
    const endX = cam.scrollX + VIEW_W + 40;
    const time = this.time.now * 0.001;
    const waterY = this.waterlineWorldY;

    // 与船吃水线同款：一层柔和淡色打底 + 一层白色高亮，两层叠出手绘感。
    drawFoamStrip(this.waterlineFoam, startX, endX, waterY, 1.6, 0xd8f2ef, 0.42, 3.6, time * 0.9);
    drawFoamStrip(this.waterlineFoam, startX, endX, waterY, 0, 0xffffff, 0.85, 1.9, time * 1.35 + 0.6);
  }

  private updateWaterBoundary(dt: number) {
    if (this.surfaceBlend) {
      this.surfaceBlend.tilePositionX += dt * 3;
    }
    this.drawWaterlineFoam();
  }

  private updateWaterFlow(dt: number) {
    if (!this.waterSurface) return;
    this.waterFlowTime += dt;
    const flow = this.sceneLayout.layers.water.waterFlow ?? {
      speedX: 9,
      speedVariation: 2.2,
      verticalAmount: 1.2,
      verticalSpeed: 0.38,
    };
    // 只移动原始水面纹理，不生成额外波纹。速度有轻微变化，避免机械匀速。
    this.waterSurface.tilePositionX += dt * (
      flow.speedX + Math.sin(this.waterFlowTime * 0.48) * flow.speedVariation
    );
    this.waterSurface.tilePositionY = Math.sin(this.waterFlowTime * flow.verticalSpeed) * flow.verticalAmount;
  }

  private createScenery() {
    const skyLayout = this.sceneLayout.layers.sky;
    const sky = this.add.image(skyLayout.x, skyLayout.y, skyLayout.textureKey)
      .setScrollFactor(skyLayout.parallax)
      .setAlpha(skyLayout.alpha)
      .setDepth(skyLayout.depth)
      .setVisible(this.isLayerVisible(skyLayout));
    sky.setDisplaySize(
      skyLayout.width * skyLayout.stretchX,
      (skyLayout.height ?? VIEW_H) * skyLayout.stretchY,
    );

    this.sceneryStrips = [];
    for (const [layer, count] of [
      [this.sceneLayout.layers.far, 8],
      [this.sceneLayout.layers.middle, 9],
      [this.sceneLayout.layers.forest, 10],
    ] as Array<[FishingLayerLayout, number]>) {
      if (layer.repeatMode === 'single') this.createCopiedLayer(layer);
      else this.sceneryStrips.push(this.makeImageStrip(layer, count));
    }
    this.createIslandSequence();
    for (const layer of this.sceneLayout.copies) this.createCopiedLayer(layer);
    this.createEndBarrierIsland();
  }

  private createEndBarrierIsland() {
    const layout = this.sceneLayout.layers.islandSmall;
    const textureKey = layout.textureKey;
    const source = this.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const displayWidth = layout.width * layout.stretchX;
    const naturalHeight = layout.height ?? layout.width * (source.height / source.width);
    const displayHeight = naturalHeight * layout.stretchY;
    const sprite = this.add.image(END_BARRIER_ISLAND_X, layout.y, textureKey)
      .setDisplaySize(displayWidth, displayHeight)
      .setScrollFactor(1, 1)
      .setDepth(layout.depth);
    this.cropIslandReflectionAtUnderwater(sprite, source);
  }

  private createCopiedLayer(layer: FishingLayerLayout) {
    if (layer.sourceId === 'water') {
      const texture = this.textures.get(layer.textureKey);
      const source = texture.getSourceImage() as HTMLImageElement;
      const frame = texture.get('usable-band');
      const height = (layer.height ?? frame.realHeight) * layer.stretchY;
      this.add.tileSprite(WORLD_WIDTH / 2, layer.y, WORLD_WIDTH, height, layer.textureKey, 'usable-band')
        .setOrigin(0.5, 0)
        .setTilePosition(layer.x, 0)
        .setTileScale((layer.width * layer.stretchX) / source.width, height / frame.realHeight)
        .setScrollFactor(layer.parallax, 1)
        .setAlpha(layer.alpha)
        .setDepth(layer.depth)
        .setVisible(this.isLayerVisible(layer));
      return;
    }

    if (layer.repeatMode === 'horizontal') {
      const isMap02FarMountain = ACTIVE_MAP_ID === 'fishing-map-02' && layer.sourceId === 'far';
      // 新地图远山需要轻微重叠以消除透明边缘接缝，不能沿用装饰图层的留白间距。
      this.sceneryStrips.push(this.makeImageStrip(
        layer,
        isMap02FarMountain ? 8 : 6,
        // 素材左右各有约 10% 透明安全区，步距必须压到约 78% 才能让山脚真正相接。
        isMap02FarMountain ? 0.78 : 1.15,
      ));
      return;
    }

    const sprite = this.add.image(layer.x, layer.y, layer.textureKey)
      .setScrollFactor(layer.parallax, 1)
      .setAlpha(layer.alpha)
      .setDepth(layer.depth)
      .setVisible(this.isLayerVisible(layer));
    if (layer.sourceId === 'underwater') sprite.setOrigin(0.5, 0);
    const naturalHeight = layer.height ?? layer.width * (sprite.frame.realHeight / sprite.frame.realWidth);
    sprite.setDisplaySize(layer.width * layer.stretchX, naturalHeight * layer.stretchY);
    if (
      layer.sourceId === 'islandForest'
      || layer.sourceId === 'islandSmall'
      || layer.sourceId === 'islandRocky'
    ) {
      const source = this.textures.get(layer.textureKey).getSourceImage() as HTMLImageElement;
      this.cropIslandReflectionAtUnderwater(sprite, source);
    }
  }

  private makeImageStrip(layout: FishingLayerLayout, count: number, stepFactor = 0.84): SceneryStrip {
    const source = this.textures.get(layout.textureKey).getSourceImage() as HTMLImageElement;
    const displayWidth = layout.width * layout.stretchX;
    const naturalHeight = layout.height ?? layout.width * (source.height / source.width);
    const displayHeight = naturalHeight * layout.stretchY;
    const step = displayWidth * stepFactor;
    const items: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.add.image(layout.x + i * step, layout.y, layout.textureKey)
        .setDisplaySize(displayWidth, displayHeight)
        .setScrollFactor(layout.parallax, 1)
        .setAlpha(layout.alpha)
        .setDepth(layout.depth)
        .setVisible(this.isLayerVisible(layout));
      items.push(item);
    }
    return { items, step, scrollFactor: layout.parallax };
  }

  private createIslandSequence() {
    const treeVariants = [
      this.sceneLayout.layers.islandForest,
      this.sceneLayout.layers.islandSmall,
    ];
    const rockyLayout = this.sceneLayout.layers.islandRocky;
    const allVariants = [...treeVariants, rockyLayout];

    // 首屏完全使用编辑器保存的布局，不做随机化、缩放、翻转或重新定位。
    for (const layout of allVariants) {
      this.islands.push(this.makeIsland(layout, layout.x));
    }

    if (ACTIVE_MAP_ID === 'fishing-map-02') {
      // 遗迹地图的航程后段改由长画布编辑器中的 copies 完全手工布置。
      // 此处只保留首屏三层，不再额外执行任何前景 PCG。
      this.islandGenerationIndex = 0;
      this.islandFoam = this.add.graphics().setDepth(9);
      return;
    }

    // 岛屿以稀疏“岛群”出现：约每 900m 一组，主岛必定是大/小树岛。
    // 组合规则：
    //   - 60% 只有一座树岛
    //   - 40% 树岛 + 前景矮岩：石头岛作为“主岛前方近水线的小礁石”出现，
    //     缩得更小、Y 靠近水线、渲染深度置于树岛之前，
    //     绝对不作为“背后山峰”出现在树岛后方。
    const clusterSpacing = 900;
    const clusterCount = Math.ceil(MAX_SAIL_DISTANCE_M / clusterSpacing);
    let generatedCount = 0;
    for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
      const routeX = SAIL_START_X + 1400 + clusterIndex * clusterSpacing;
      const dominantLayout = treeVariants[
        Math.floor(this.islandNoise(clusterIndex, 3.1) * treeVariants.length)
      ];
      const hasForegroundRock = this.islandNoise(clusterIndex, 4.3) > 0.6;
      type Member = {
        layout: FishingLayerLayout;
        role: 'primary' | 'secondary';
        offset: number;
        depthOverride?: number;
      };
      const members: Member[] = [
        { layout: dominantLayout, role: 'primary', offset: 0 },
      ];
      if (hasForegroundRock) {
        const rockOnRight = this.islandNoise(clusterIndex, 8.9) > 0.5;
        // 石头岛整体缩得非常小，横向紧贴树岛底部，
        // 因此间距很小但绝不会遮住树岛主体。
        const rockOffset = (rockOnRight ? 1 : -1) * (140 + this.islandNoise(clusterIndex, 6.2) * 40);
        members.push({
          layout: rockyLayout,
          role: 'secondary',
          offset: rockOffset,
          // depth 比树岛主图层高，稳稳压在树岛前方。
          depthOverride: dominantLayout.depth + 1,
        });
      }
      // 一组岛共享主岛视差，避免航行中组内两岛彼此漂散或彼此穿插。
      const clusterParallax = dominantLayout.parallax;

      for (const member of members) {
        const generationIndex = generatedCount++;
        const { layout, role, offset, depthOverride } = member;
        const cameraAtArrival = Math.max(0, routeX - PLAYER_SCREEN_X);
        const entryScreenX = VIEW_W + 100 + offset;
        const worldX = cameraAtArrival * clusterParallax + entryScreenX;
        const island = this.makeIsland(layout, worldX);
        island.sprite.setScrollFactor(clusterParallax, 1);
        if (typeof depthOverride === 'number') {
          island.sprite.setDepth(depthOverride);
        }
        this.applyProceduralIslandVariation(island, generationIndex, role);
        this.islands.push(island);
      }
    }
    this.islandGenerationIndex = generatedCount;
    this.islandFoam = this.add.graphics().setDepth(9);
  }

  /** 稳定的伪随机值：同一航程每次刷新保持相同岛屿分布。 */
  private islandNoise(index: number, salt: number) {
    const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private applyProceduralIslandVariation(
    island: IslandAgent,
    generationIndex: number,
    role: 'primary' | 'secondary' = 'primary',
  ) {
    const { sprite, layout } = island;
    const source = this.textures.get(layout.textureKey).getSourceImage() as HTMLImageElement;
    const baseWidth = layout.width * layout.stretchX;
    const baseHeight = layout.width * (source.height / source.width) * layout.stretchY;
    const scale = role === 'primary'
      ? 0.9 + this.islandNoise(generationIndex, 12.4) * 0.12
      // 副岛（永远是石头岛）当作树岛前的“近水矮礁”，尺寸压得更小。
      : 0.34 + this.islandNoise(generationIndex, 12.4) * 0.08;
    sprite.setDisplaySize(baseWidth * scale, baseHeight * scale);
    sprite.y = role === 'primary'
      ? layout.y + (this.islandNoise(generationIndex, 18.8) - 0.5) * 14
      // 副岛压到水线附近，只有顶端露出水面，像贴水的矮礁。
      : layout.y + 118 + this.islandNoise(generationIndex, 18.8) * 8;
    // 只允许主岛偶尔翻转；岩岛保持固定轮廓，不形成镜像石门。
    sprite.setFlipX(role === 'primary' && this.islandNoise(generationIndex, 24.2) > 0.72);
    this.cropIslandReflectionAtUnderwater(sprite, source);
  }

  private makeIsland(layout: FishingLayerLayout, x: number): IslandAgent {
    const source = this.textures.get(layout.textureKey).getSourceImage() as HTMLImageElement;
    const displayWidth = layout.width * layout.stretchX;
    const displayHeight = layout.width * (source.height / source.width) * layout.stretchY;
    const sprite = this.add.image(x, layout.y, layout.textureKey)
      .setDisplaySize(displayWidth, displayHeight)
      .setScrollFactor(layout.parallax, 1)
      .setAlpha(layout.alpha)
      .setDepth(layout.depth)
      .setVisible(this.isLayerVisible(layout));
    this.cropIslandReflectionAtUnderwater(sprite, source);
    return { sprite, layout };
  }

  /**
   * 岛屿 PNG 自带水面倒影；倒影只能存在于水面层，进入水下背景后必须截止。
   */
  private cropIslandReflectionAtUnderwater(
    sprite: Phaser.GameObjects.Image,
    source: HTMLImageElement,
  ) {
    const underwaterY = this.sceneLayout.layers.underwater.y;
    const spriteTop = sprite.y - sprite.displayHeight * sprite.originY;
    const visibleHeight = Phaser.Math.Clamp(underwaterY - spriteTop, 0, sprite.displayHeight);
    const sourceCropHeight = Math.ceil(source.height * (visibleHeight / sprite.displayHeight));
    sprite.setCrop(0, 0, source.width, sourceCropHeight);
  }

  private isLayerVisible(layer: FishingLayerLayout) {
    return layer.visible && !this.sceneLayout.deletedLayerIds.includes(layer.id as typeof this.sceneLayout.deletedLayerIds[number]);
  }

  private recycleStrip(strip: SceneryStrip) {
    const cameraX = this.cameras.main.scrollX;
    let rightMost = Math.max(...strip.items.map((item) => item.x));
    for (const item of strip.items) {
      const screenX = item.x - cameraX * strip.scrollFactor;
      if (screenX + item.displayWidth / 2 < -100) {
        item.x = rightMost + strip.step;
        rightMost = item.x;
      }
    }
  }

  private ensureStripCoverage(strip: SceneryStrip) {
    const cameraX = this.cameras.main.scrollX;
    const hasVisibleItem = strip.items.some((item) => {
      const screenX = item.x - cameraX * strip.scrollFactor;
      return screenX + item.displayWidth / 2 >= -80 && screenX - item.displayWidth / 2 <= VIEW_W + 80;
    });
    if (hasVisibleItem) return;

    const startX = cameraX * strip.scrollFactor - strip.items[0].displayWidth / 2;
    strip.items.forEach((item, index) => {
      item.x = startX + index * strip.step;
    });
  }

  private recycleIslands() {
    const cameraX = this.cameras.main.scrollX;
    // 只考虑镜头附近的岛作为续接基准；不能使用池中最远的绝对 worldX，
    // 否则回收对象会被追加到数千米外，导致当前镜头长期没有岛屿。
    const nearbyScreenXs = this.islands
      .map((island) => island.sprite.x - cameraX * island.sprite.scrollFactorX)
      .filter((screenX) => screenX > -200 && screenX < VIEW_W + 1500);
    let rightMostScreenX = nearbyScreenXs.length > 0
      ? Math.max(...nearbyScreenXs)
      : VIEW_W + 120;

    for (const island of this.islands) {
      const screenX = island.sprite.x - cameraX * island.sprite.scrollFactorX;
      if (screenX + island.sprite.displayWidth / 2 < -180) {
        const generationIndex = this.islandGenerationIndex++;
        // 回收后的岛同样隔着一段完整水面再出现，避免循环池重新挤成一团。
        const screenGap = 1450 + this.islandNoise(generationIndex, 31.6) * 450;
        const targetScreenX = Math.max(VIEW_W + 160, rightMostScreenX + screenGap);
        island.sprite.x = targetScreenX + cameraX * island.sprite.scrollFactorX;
        this.applyProceduralIslandVariation(
          island,
          generationIndex,
          island.layout.sourceId === 'islandRocky' ? 'secondary' : 'primary',
        );
        rightMostScreenX = targetScreenX;
      }
    }
  }

  private configureBoatSprite() {
    const source = this.textures.get('boat').getSourceImage() as HTMLImageElement;
    const ratio = source.height / source.width;
    const boat = PLAYER_LAYOUT.boat;
    this.boat
      // 原图保留了透明画布，约 49.7% 高度处是船体吃水线。
      .setOrigin(0.5, 0.497)
      .setDisplaySize(boat.width, boat.width * ratio);
  }

  private createCharacterGlowTexture() {
    const key = 'boat-character-glow-mask';
    if (this.textures.exists(key)) return;

    const source = this.textures.get('boat').getSourceImage() as HTMLImageElement;
    const texture = this.textures.createCanvas(key, source.width, source.height);
    if (!texture) return;

    const ctx = texture.context;
    const sx = source.width / 1024;
    const sy = source.height / (ACTIVE_MAP_ID === 'fishing-map-02' ? 576 : 768);
    ctx.save();
    // 只截取合并素材中的主角轮廓；底边藏在船体后方，避免船身一起发光。
    ctx.beginPath();
    if (ACTIVE_MAP_ID === 'fishing-map-02') {
      // 沉蓝遗迹船图中的人物轮廓：白发、肩部、披风与右臂。
      // 使用独立实心遮罩，只让人物外缘发光，不把船体或原图的大面积青色光环算进去。
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
      // 不再填充整块粗略轮廓，而是直接沿人物外缘绘制一条窄线；
      // 这样额外辉光会贴住头发、披风和手臂边缘，不会形成三角形光斑。
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * Math.max(sx, sy);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      ctx.moveTo(448 * sx, 186 * sy);
      ctx.bezierCurveTo(418 * sx, 188 * sy, 414 * sx, 215 * sy, 427 * sx, 243 * sy);
      ctx.lineTo(407 * sx, 264 * sy);
      ctx.bezierCurveTo(389 * sx, 277 * sy, 366 * sx, 293 * sy, 347 * sx, 316 * sy);
      ctx.lineTo(338 * sx, 346 * sy);
      ctx.lineTo(538 * sx, 346 * sy);
      ctx.bezierCurveTo(537 * sx, 316 * sy, 521 * sx, 291 * sy, 497 * sx, 273 * sy);
      ctx.lineTo(490 * sx, 246 * sy);
      ctx.bezierCurveTo(503 * sx, 225 * sy, 499 * sx, 202 * sy, 480 * sx, 191 * sy);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(source, 0, 0);
    }
    ctx.restore();
    texture.refresh();
  }

  private configureFisherSprite() {
    const source = this.textures.get('fisher').getSourceImage() as HTMLImageElement;
    const ratio = source.width / source.height;
    const fisher = PLAYER_LAYOUT.fisher;
    this.fisher
      .setOrigin(fisher.originX, fisher.originY)
      .setDisplaySize(fisher.height * ratio, fisher.height);
  }

  private syncPlayerPositions(worldX: number, bob = 0) {
    this.boat.setPosition(worldX, FISHING_SURFACE_Y + PLAYER_LAYOUT.boat.waterlineOffset + bob);
    this.characterGlow?.setPosition(
      this.boat.x + PLAYER_LAYOUT.glow.offsetX,
      this.boat.y + PLAYER_LAYOUT.glow.offsetY,
    );
    this.fisher.setPosition(
      this.boat.x + PLAYER_LAYOUT.fisher.offsetX,
      this.boat.y + PLAYER_LAYOUT.fisher.offsetY,
    );
  }

  /** 与船体吃水线一致的可见水面高度，供鱼群标记等 UI 对齐。 */
  private getPlayerWaterContactY() {
    return FISHING_SURFACE_Y;
  }

  private syncHotspotPosition(x = this.nextHotspotX) {
    const waterY = FISHING_SURFACE_Y;
    this.hotspot.setPosition(x, waterY);
    this.hotspotLabel.setPosition(x, waterY - 42);
  }

  /** 视差图层在 world 坐标下绘制时需要补偿相机滚动。 */
  private getParallaxDrawX(sprite: Phaser.GameObjects.Image) {
    return sprite.x + this.cameras.main.scrollX * (1 - sprite.scrollFactorX);
  }

  private get inManagementMode() {
    return this.mode === 'port'
      || this.mode === 'service'
      || this.mode === 'shipyard'
      || this.mode === 'dialogue';
  }

  private syncAtmosphereFx() {
    const managementMode = this.inManagementMode;
    this.atmosphereFx.setVisible(ACTIVE_MAP.atmosphereEnabled && !managementMode);
    this.atmosphereFx.setNightDimmed(this.isNight);
  }

  private drawIslandFoam() {
    this.islandFoam.clear();
    if (this.inManagementMode) return;

    const time = this.time.now * 0.001;
    const scrollX = this.cameras.main.scrollX;

    for (const island of this.islands) {
      const { sprite, layout } = island;
      if (!sprite.visible) continue;

      const foam = getIslandFoam(layout);
      if (!foam.visible) continue;

      const islandWaterY = getIslandFoamWorldY(sprite, foam);
      const halfWidth = getIslandFoamHalfWidth(sprite, foam);
      const centerX = this.getParallaxDrawX(sprite);
      const screenX = sprite.x - scrollX * sprite.scrollFactorX;
      if (screenX + halfWidth < -140 || screenX - halfWidth > VIEW_W + 140) continue;
      if (islandWaterY < -40 || islandWaterY > VIEW_H + 40) continue;

      const phaseSeed = sprite.x * 0.013;
      drawContinuousFoamRing(
        this.islandFoam,
        centerX,
        halfWidth,
        islandWaterY,
        1.8,
        0xd8f2ef,
        0.44,
        4.2,
        time * 1.05 + phaseSeed,
      );
      drawContinuousFoamRing(
        this.islandFoam,
        centerX,
        halfWidth,
        islandWaterY,
        0,
        0xffffff,
        0.86,
        2.2,
        time * 1.45 + phaseSeed + 0.8,
      );
    }
  }

  private createPlayer() {
    this.boat = this.add.sprite(this.worldX, FISHING_SURFACE_Y, 'boat').setDepth(PLAYER_LAYOUT.boat.depth);
    this.configureBoatSprite();
    this.createCharacterGlowTexture();
    this.characterGlow = this.add.sprite(this.worldX, FISHING_SURFACE_Y, 'boat-character-glow-mask')
      .setOrigin(this.boat.originX, this.boat.originY)
      .setDisplaySize(
        this.boat.displayWidth * PLAYER_LAYOUT.glow.scaleX,
        this.boat.displayHeight * PLAYER_LAYOUT.glow.scaleY,
      )
      // 放在合并船图后面：只让轮廓外侧透出，遮住裁切区域的内部边缘。
      .setDepth(PLAYER_LAYOUT.boat.depth - 0.1)
      .setTint(ACTIVE_MAP_ID === 'fishing-map-02' ? 0x57e6dc : 0xffffff)
      .setAlpha(PLAYER_LAYOUT.glow.alpha)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.characterGlow.preFX?.addGlow(
      ACTIVE_MAP_ID === 'fishing-map-02' ? 0x57e6dc : 0xe8dfff,
      PLAYER_LAYOUT.glow.strength,
      ACTIVE_MAP_ID === 'fishing-map-02' ? 0.18 : 0.15,
      true,
      ACTIVE_MAP_ID === 'fishing-map-02' ? 0.13 : 0.08,
      PLAYER_LAYOUT.glow.radius,
    );
    this.fisher = this.add.sprite(this.worldX, FISHING_SURFACE_Y, 'fisher').setDepth(PLAYER_LAYOUT.fisher.depth);
    this.configureFisherSprite();
    this.fisher.setVisible(false);
    this.syncPlayerPositions(this.worldX);
    this.boatReflection = this.add.sprite(0, 0, 'boat')
      .setOrigin(PLAYER_LAYOUT.boat.originX, PLAYER_LAYOUT.boat.originY)
      .setDisplaySize(this.boat.displayWidth, this.boat.displayHeight)
      .setFlipY(true)
      .setAlpha(0.22)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setDepth(PLAYER_LAYOUT.boat.depth + 0.1)
      .setVisible(false);
    this.fisherReflection = this.add.sprite(0, 0, 'fisher')
      .setOrigin(PLAYER_LAYOUT.fisher.originX, PLAYER_LAYOUT.fisher.originY)
      .setDisplaySize(this.fisher.displayWidth, this.fisher.displayHeight)
      .setFlipY(true)
      .setAlpha(0.14)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setDepth(PLAYER_LAYOUT.boat.depth + 0.2)
      .setVisible(false);
    this.boatReflection.preFX?.addBlur(0, 0.7, 0.7, 1, 0xffffff, 2);
    this.fisherReflection.preFX?.addBlur(0, 0.9, 0.9, 1, 0xffffff, 2);
    this.boatWake = this.add.graphics().setDepth(PLAYER_LAYOUT.boat.depth + 0.5);
    this.lure = this.add.sprite(this.worldX + 300, FISHING_SURFACE_Y + 14, 'lure').setDepth(35).setVisible(false);
    this.rod = this.add.graphics().setDepth(PLAYER_LAYOUT.rod.depth);
    this.line = this.add.graphics().setDepth(34);

    this.hotspot = this.add.sprite(this.nextHotspotX, FISHING_SURFACE_Y, 'hotspot').setDepth(22);
    this.hotspotLabel = this.add.text(this.nextHotspotX, FISHING_SURFACE_Y - 42, '鱼群活动区',
      {
        fontFamily: UI_FONT,
        fontStyle: '300',
        fontSize: '15px',
        color: UI_COLOR_ACCENT,
        backgroundColor: '#0c1218cc',
        padding: { x: 12, y: 6 },
      },
    ).setOrigin(0.5).setDepth(40);
    this.syncHotspotPosition();
  }

  private drawBoatWake(dt: number) {
    this.boatWake.clear();
    // 新船图已经包含人物和水面倒影，不再叠加旧的镜像反射。
    this.boatReflection.setVisible(false);
    this.fisherReflection.setVisible(false);
    const wakeVisible = this.boat.visible
      && this.mode !== 'port'
      && this.mode !== 'shipyard'
      && this.mode !== 'dialogue';
    // 极轻微的呼吸变化让辉光保持“自发光”质感，但不做闪烁。
    this.characterGlow
      .setVisible(ACTIVE_MAP.characterGlowEnabled && wakeVisible)
      .setAlpha(
        PLAYER_LAYOUT.glow.alpha
        + Math.sin(this.time.now * 0.0017) * 0.02,
      );
    if (!wakeVisible) {
      this.boatWakeParticles.length = 0;
      this.boatWakeEmitTimer = 0;
      return;
    }

    const time = this.time.now * 0.001;
    // 合并图保留了大块透明画布，尾流宽度按可见船体而非整张纹理计算。
    const visibleBoatWidth = PLAYER_LAYOUT.boat.width * 0.4;
    const halfWidth = visibleBoatWidth * 0.43;
    const useDarkWake = ACTIVE_MAP_ID === 'fishing-map-02';
    const wakeBaseColor = useDarkWake ? 0x55778a : 0xd8f2ef;
    const wakeHighlightColor = useDarkWake ? 0x829ba8 : 0xffffff;
    // 泡沫偏移以编辑器中的船体锚点为基准，必须包含船体自身的垂直偏移。
    const waterY = this.boat.y + (PLAYER_LAYOUT.boat.foamYOffset ?? 0);
    const speedRatio = Phaser.Math.Clamp(Math.abs(this.sailSpeed) / MANUAL_SAIL_SPEED, 0, 1);
    const direction = this.sailSpeed === 0 ? 1 : Math.sign(this.sailSpeed);

    // 将原图围绕水面线做镜像，再施加轻微横向漂移，避免像机械复制。
    const reflectionDrift = Math.sin(time * 1.15) * 2;
    this.boatReflection
      .setPosition(
        this.boat.x + reflectionDrift,
        2 * waterY - this.boat.y + this.boat.displayHeight,
      )
      .setScale(
        this.boat.displayWidth / this.boatReflection.width * (1 + Math.sin(time * 0.9) * 0.008),
        this.boat.displayHeight / this.boatReflection.height,
      );
    this.fisherReflection
      .setPosition(
        this.fisher.x + reflectionDrift * 1.3,
        2 * waterY - this.fisher.y + this.fisher.displayHeight,
      )
      .setScale(
        this.fisher.displayWidth / this.fisherReflection.width * (1 + Math.sin(time * 1.05 + 1) * 0.012),
        this.fisher.displayHeight / this.fisherReflection.height,
      );

    const drawBrushDash = (
      x: number,
      y: number,
      length: number,
      color: number,
      alpha: number,
      width: number,
      phase: number,
    ) => {
      const segments = 5;
      this.boatWake.lineStyle(width, color, alpha);
      this.boatWake.beginPath();
      for (let index = 0; index <= segments; index += 1) {
        const progress = index / segments;
        const dashX = x + length * progress;
        const dashY = y + Math.sin(progress * Math.PI * 1.4 + phase) * 1.2;
        if (index === 0) this.boatWake.moveTo(dashX, dashY);
        else this.boatWake.lineTo(dashX, dashY);
      }
      this.boatWake.strokePath();
    };

    // 吃水线：参考图是一整圈连续白色泡沫，而不是首尾相接的碎线段。
    const boatHalfWidth = PLAYER_LAYOUT.boat.foamHalfWidth ?? visibleBoatWidth * 0.36;
    drawContinuousFoamRing(
      this.boatWake,
      this.boat.x,
      boatHalfWidth,
      waterY,
      1.8,
      wakeBaseColor,
      useDarkWake ? 0.26 : 0.48,
      useDarkWake ? 3.8 : 4.4,
      time * 1.05,
    );
    drawContinuousFoamRing(
      this.boatWake,
      this.boat.x,
      boatHalfWidth,
      waterY,
      0,
      wakeHighlightColor,
      useDarkWake ? 0.4 : 0.9,
      useDarkWake ? 1.8 : 2.35,
      time * 1.45 + 0.8,
    );

    // 船头推水形成短促的弧形白浪。
    const bowX = this.boat.x + direction * halfWidth * 0.78;
    drawBrushDash(
      bowX - direction * 10,
      waterY + 3,
      direction * (31 + speedRatio * 23),
      wakeHighlightColor,
      useDarkWake ? 0.38 : 0.72,
      1.35,
      time * 2,
    );
    drawBrushDash(
      bowX + direction * 2,
      waterY + 8,
      direction * (18 + speedRatio * 14),
      wakeBaseColor,
      useDarkWake ? 0.24 : 0.38,
      0.8,
      time * 1.55 + 2,
    );

    // 航行时成对释放尾流。粒子留在世界坐标中，不会像装饰线一样粘着船移动。
    const sternX = this.boat.x - direction * halfWidth * 0.78;
    this.boatWakeEmitTimer -= dt;
    if (speedRatio > 0.08 && this.boatWakeEmitTimer <= 0) {
      this.boatWakeEmitTimer = Phaser.Math.Linear(0.095, 0.038, speedRatio);
      for (const side of [-1, 1]) {
        this.boatWakeParticles.push({
          x: sternX - direction * Phaser.Math.FloatBetween(0, 5),
          y: waterY + side * Phaser.Math.FloatBetween(1, 3),
          velocityX: -direction * Phaser.Math.FloatBetween(3, 9),
          velocityY: side * Phaser.Math.FloatBetween(7, 13) * (0.55 + speedRatio * 0.45),
          age: 0,
          lifetime: Phaser.Math.FloatBetween(1.5, 2.35),
          length: Phaser.Math.FloatBetween(15, 27),
          thickness: Phaser.Math.FloatBetween(0.65, 1.1),
          phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
          direction,
          foam: false,
        });
      }
      this.boatWakeParticles.push({
        x: sternX,
        y: waterY + Phaser.Math.FloatBetween(-2, 3),
        velocityX: -direction * Phaser.Math.FloatBetween(1, 5),
        velocityY: Phaser.Math.FloatBetween(-1.5, 1.5),
        age: 0,
        lifetime: Phaser.Math.FloatBetween(0.65, 1.15),
        length: Phaser.Math.FloatBetween(8, 18),
        thickness: Phaser.Math.FloatBetween(0.9, 1.35),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        direction,
        foam: true,
      });
    }

    for (const particle of this.boatWakeParticles) {
      particle.age += dt;
      particle.x += particle.velocityX * dt;
      particle.y += particle.velocityY * dt;
      const progress = Phaser.Math.Clamp(particle.age / particle.lifetime, 0, 1);
      const fade = Math.sin(progress * Math.PI);
      const stretch = 1 + progress * (particle.foam ? 0.45 : 1.25);
      drawBrushDash(
        particle.x,
        particle.y + Math.sin(time * 1.3 + particle.phase) * 0.8,
        -particle.direction * particle.length * stretch,
        particle.foam ? wakeHighlightColor : wakeBaseColor,
        fade * (
          useDarkWake
            ? (particle.foam ? 0.34 : 0.22)
            : (particle.foam ? 0.68 : 0.42)
        ),
        particle.thickness * (1 - progress * 0.35),
        particle.phase + time,
      );
    }
    this.boatWakeParticles = this.boatWakeParticles.filter(
      (particle) => particle.age < particle.lifetime,
    );
  }

  private createInput() {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');
    this.keys = {
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      port: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

    keyboard.on('keydown-SPACE', () => this.handleSpacePressed());
    keyboard.on('keydown-I', () => this.toggleInventory());
    keyboard.on('keydown-R', () => {
      if (this.mode === 'sailing') this.enterPort();
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.inventoryOpen) return;
      if (this.mode === 'sailing' && pointer.y > 150) this.beginFishing();
      if (this.mode === 'port') {
        // 港口 UI 按钮独立挂载在场景根节点，由 Phaser 交互系统处理。
      } else if (this.mode === 'shipyard') {
        // 船坞按钮同上。
      } else if (this.mode === 'dialogue') {
        // 对话按钮同上。
      }
    });
    this.game.canvas.addEventListener('click', (event) => {
      if (!this.inventoryOpen) return;
      if (this.suppressInventoryClick) {
        this.suppressInventoryClick = false;
        return;
      }
      const bounds = this.game.canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * (VIEW_W / bounds.width);
      const y = (event.clientY - bounds.top) * (VIEW_H / bounds.height);
      this.handleInventoryCanvasPointer(x, y);
    });
    this.game.canvas.addEventListener('pointerdown', (event) => {
      if (!this.inventoryOpen) return;
      const point = this.inventoryPointerPosition(event);
      this.beginInventoryDrag(point.x, point.y);
      try {
        this.game.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic test events may not own an active browser pointer.
      }
    });
    this.game.canvas.addEventListener('pointermove', (event) => {
      if (this.inventoryDraggingIndex < 0) return;
      const point = this.inventoryPointerPosition(event);
      this.updateInventoryDrag(point.x, point.y);
    });
    this.game.canvas.addEventListener('pointerup', (event) => {
      if (this.inventoryDraggingIndex < 0) return;
      const point = this.inventoryPointerPosition(event);
      this.finishInventoryDrag(point.x, point.y);
      if (this.game.canvas.hasPointerCapture(event.pointerId)) {
        this.game.canvas.releasePointerCapture(event.pointerId);
      }
    });
    this.game.canvas.addEventListener('pointercancel', () => this.cancelInventoryDrag());
  }

  private handleSpacePressed() {
    if (this.inventoryOpen) return;
    if (this.mode === 'sailing') {
      this.beginFishing();
    } else if (this.mode === 'casting') {
      this.setTextIfChanged(this.statusText, this.castReleased ? '鱼钩正在飞向水面' : '挥竿抛投');
      this.setTextIfChanged(this.hintText, '鱼竿蓄力回摆 → 前甩释放 → 鱼钩按抛物线入水');
    } else if (this.mode === 'fishing') {
      this.cancelFishing();
    }
  }

  private createHud() {
    this.nightOverlay = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x071325, 0.48)
      .setOrigin(0).setScrollFactor(0).setDepth(90).setVisible(false);

    const hudDecor = this.add.graphics().setScrollFactor(0).setDepth(100);
    const ivory = 0xf1e8e2;
    const lavender = 0xd8ccd9;

    // 左上品牌：暖粉白字、菱形锚点，以及从粗到细、从实到虚的装饰线。
    const brandColor = 0xf3d9ce;
    const drawDiamond = (x: number, y: number, radius: number, alpha: number) => {
      hudDecor.fillStyle(brandColor, alpha);
      hudDecor.fillTriangle(x, y - radius, x + radius, y, x, y + radius);
      hudDecor.fillTriangle(x, y - radius, x - radius, y, x, y + radius);
    };
    drawDiamond(50, 49, 4.2, 0.94);
    drawDiamond(260, 49, 4.2, 0.94);
    hudDecor.lineStyle(1.5, brandColor, 0.72).lineBetween(266, 49, 336, 49);
    hudDecor.lineStyle(1.1, brandColor, 0.52).lineBetween(336, 49, 402, 49);
    hudDecor.lineStyle(0.7, brandColor, 0.3).lineBetween(402, 49, 468, 49);
    hudDecor.fillStyle(brandColor, 0.48).fillCircle(336, 49, 1.2);
    hudDecor.fillStyle(brandColor, 0.32).fillCircle(402, 49, 1);

    // 右上：两组轻量资源图标，不使用大面积深色底板。
    hudDecor.lineStyle(1, ivory, 0.28).lineBetween(1010, 28, 1010, 61);
    hudDecor.lineStyle(1, ivory, 0.28).lineBetween(1140, 28, 1140, 61);
    hudDecor.lineStyle(1, ivory, 0.74).strokeCircle(1032, 44, 9);
    hudDecor.lineStyle(1.2, ivory, 0.8);
    hudDecor.strokeEllipse(1032, 44, 11, 6);
    hudDecor.lineBetween(1026, 44, 1022, 40);
    hudDecor.lineBetween(1026, 44, 1022, 48);
    hudDecor.lineStyle(1, ivory, 0.74).strokeCircle(1162, 44, 9);
    hudDecor.lineBetween(1162, 39, 1162, 49);
    hudDecor.lineBetween(1159, 42, 1165, 42);

    // 底部：圆形线框操作提示。图标均使用细线构成，与参考图一致。
    hudDecor.lineStyle(1.1, lavender, 0.78).strokeCircle(86, 646, 27);
    hudDecor.lineStyle(0.8, lavender, 0.28).strokeCircle(86, 646, 34);
    this.drawPetalIcon(hudDecor, 86, 646, 8, ivory, 0.86);
    hudDecor.lineStyle(1, lavender, 0.34).lineBetween(121, 646, 274, 646);

    hudDecor.lineStyle(1.1, lavender, 0.78).strokeCircle(1086, 646, 27);
    hudDecor.lineStyle(0.8, lavender, 0.28).strokeCircle(1086, 646, 34);
    hudDecor.lineStyle(1.2, ivory, 0.86);
    hudDecor.strokeEllipse(1086, 646, 20, 11);
    hudDecor.lineBetween(1076, 646, 1069, 640);
    hudDecor.lineBetween(1076, 646, 1069, 652);

    this.titleText = this.add.text(98, 29, 'LURE', {
      fontFamily: UI_FONT_DISPLAY,
      fontSize: '24px',
      color: '#f3d9ce',
      fontStyle: 'normal',
    }).setLetterSpacing(12).setScrollFactor(0).setDepth(101)
      .setShadow(0, 1, '#493d59', 2, true, true);
    const castLabel = this.add.text(86, 686, '抛竿', {
      fontFamily: UI_FONT,
      fontSize: '14px',
      color: '#e7dce2',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const reelLabel = this.add.text(1086, 686, '收竿', {
      fontFamily: UI_FONT,
      fontSize: '14px',
      color: '#e7dce2',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const castKey = this.add.text(86, 668, 'A', {
      fontFamily: UI_FONT,
      fontSize: '10px',
      color: '#d8ccd9',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const reelKey = this.add.text(1086, 668, 'B', {
      fontFamily: UI_FONT,
      fontSize: '10px',
      color: '#d8ccd9',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    const castHit = this.add.zone(86, 646, 72, 96)
      .setScrollFactor(0).setDepth(119).setInteractive({ useHandCursor: true });
    castHit.on('pointerdown', () => {
      if (this.mode === 'sailing') this.beginFishing();
    });
    const reelHit = this.add.zone(1086, 646, 72, 96)
      .setScrollFactor(0).setDepth(119).setInteractive({ useHandCursor: true });
    reelHit.on('pointerdown', () => {
      if (this.mode === 'fishing') this.cancelFishing();
    });

    const editorButton = this.add.text(482, 35, '✿', {
      fontFamily: UI_FONT,
      fontStyle: 'normal',
      fontSize: '19px',
      color: '#f3d9ce',
      padding: { x: 9, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(120).setInteractive({ useHandCursor: true });
    editorButton.on('pointerdown', () => {
      window.location.href = `/fishing-scene-editor.html?map=${ACTIVE_MAP_ID}`;
    });
    this.statusText = this.add.text(VIEW_W / 2, 660, '', {
      fontFamily: UI_FONT,
      fontStyle: 'normal',
      fontSize: '16px',
      color: '#fff4ef',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101)
      .setShadow(0, 1, '#493d59', 4, true, true);
    this.cargoText = this.add.text(1050, 35, '', {
      fontFamily: UI_FONT,
      fontStyle: 'normal',
      fontSize: '15px',
      color: '#fff4ef',
      align: 'left',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(101)
      .setShadow(0, 1, '#493d59', 4, true, true);

    this.hintPanel = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.hintText = this.add.text(VIEW_W / 2, 704, '', {
      fontFamily: UI_FONT,
      fontStyle: 'normal',
      fontSize: '13px',
      color: '#f1e6eb',
      align: 'center',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(102)
      .setShadow(0, 1, '#493d59', 3, true, true);

    this.sailingHudObjects = [
      hudDecor,
      this.titleText,
      castLabel,
      reelLabel,
      castKey,
      reelKey,
      castHit,
      reelHit,
      editorButton,
      this.statusText,
      this.cargoText,
      this.hintPanel,
      this.hintText,
    ];

    this.depthText = this.add.text(VIEW_W / 2, 628, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '13px',
      color: '#eee2e4',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101).setVisible(false);

    this.portButton = this.add.text(1240, 72, '◇  回港  R', {
      fontFamily: UI_FONT,
      fontStyle: 'normal',
      fontSize: '14px',
      color: '#fff4ef',
      padding: { x: 8, y: 5 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(120).setVisible(false)
      .setShadow(0, 1, '#493d59', 4, true, true)
      .setInteractive({ useHandCursor: true });
    this.portButton.on('pointerdown', () => {
      if (this.mode === 'sailing') this.enterPort();
    });

    const dangerBg = this.add.graphics();
    dangerBg.fillStyle(0x342f50, 0.46).fillRoundedRect(28, 105, 330, 92, 14);
    dangerBg.lineStyle(1, 0xe6d8e2, 0.28).strokeRoundedRect(28, 105, 330, 92, 14);
    const hpLabel = this.add.text(34, 100, '船体', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_BODY,
    });
    const threatLabel = this.add.text(34, 128, '威胁', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_BODY,
    });
    const hpTrack = this.add.rectangle(94, 110, 232, 8, 0x3a3550, 0.5).setOrigin(0, 0.5).setStrokeStyle(1, 0xffffff, 0.12);
    this.boatHpFill = this.add.rectangle(94, 110, 232, 4, 0xdcc7bb).setOrigin(0, 0.5);
    const threatTrack = this.add.rectangle(94, 138, 232, 8, 0x3a3550, 0.5).setOrigin(0, 0.5).setStrokeStyle(1, 0xffffff, 0.12);
    this.threatFill = this.add.rectangle(94, 138, 232, 8, 0xa76a91).setOrigin(0, 0.5);
    this.dangerText = this.add.text(34, 153, this.dangerMessage, {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '12px',
      color: UI_COLOR_MUTED,
    });
    const dangerItems = [
      dangerBg,
      hpLabel,
      threatLabel,
      hpTrack,
      this.boatHpFill,
      threatTrack,
      this.threatFill,
      this.dangerText,
    ];
    this.dangerHud = this.add.container(0, 0, dangerItems)
      .setScrollFactor(0).setDepth(130).setVisible(false);

    this.tensionLabel = this.add.text(VIEW_W / 2 - 190, 102, '张力', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '13px',
      color: '#eee2e4',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(102).setVisible(false);
    this.meterBg = this.add.rectangle(VIEW_W / 2, 102, 340, 12, 0x3a3550, 0.5)
      .setStrokeStyle(1, 0xeee2e4, 0.28)
      .setScrollFactor(0).setDepth(101).setVisible(false);
    this.meterFill = this.add.rectangle(VIEW_W / 2 - 168, 102, 336, 6, 0xd8c7d7)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(102).setVisible(false);
    this.staminaLabel = this.add.text(VIEW_W / 2 - 190, 130, '鱼的体力', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '13px',
      color: '#eee2e4',
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(102).setVisible(false);
    this.staminaBg = this.add.rectangle(VIEW_W / 2, 130, 340, 8, 0x3a3550, 0.5)
      .setStrokeStyle(1, 0xffffff, 0.12)
      .setScrollFactor(0).setDepth(101).setVisible(false);
    this.staminaFill = this.add.rectangle(VIEW_W / 2 - 168, 130, 336, 4, 0xcda9bd)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(102).setVisible(false);
  }

  private drawPetalIcon(
    target: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
  ) {
    target.fillStyle(color, alpha);
    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI * 0.4;
      target.fillEllipse(
        x + Math.cos(angle) * radius * 0.58,
        y + Math.sin(angle) * radius * 0.58,
        radius * 0.72,
        radius * 1.08,
      );
    }
    target.fillStyle(color, Math.min(1, alpha + 0.12)).fillCircle(x, y, radius * 0.22);
  }

  private createInventoryUI() {
    this.inventoryButtonFrame = this.add.graphics().setScrollFactor(0).setDepth(149);
    this.inventoryButtonFrame.lineStyle(1.1, 0xd8ccd9, 0.78).strokeCircle(1195, 646, 27);
    this.inventoryButtonFrame.lineStyle(0.8, 0xd8ccd9, 0.28).strokeCircle(1195, 646, 34);
    // 线稿布袋：束口、袋身与短绳。
    this.inventoryButtonFrame.lineStyle(1.2, 0xf1e8e2, 0.86);
    this.inventoryButtonFrame.lineBetween(1189, 635, 1201, 635);
    this.inventoryButtonFrame.lineBetween(1191, 632, 1199, 632);
    this.inventoryButtonFrame.beginPath();
    this.inventoryButtonFrame.moveTo(1189, 636);
    this.inventoryButtonFrame.lineTo(1185, 653);
    this.inventoryButtonFrame.lineTo(1205, 653);
    this.inventoryButtonFrame.lineTo(1201, 636);
    this.inventoryButtonFrame.closePath();
    this.inventoryButtonFrame.strokePath();
    this.inventoryButtonFrame.setInteractive(
      new Phaser.Geom.Circle(1195, 646, 38),
      Phaser.Geom.Circle.Contains,
      true,
    );
    this.inventoryButtonFrame.on('pointerdown', () => this.toggleInventory());

    this.inventoryButton = this.add.text(1195, 686, '背包', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: '#e7dce2',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(150).setInteractive({ useHandCursor: true });
    this.inventoryButton.on('pointerdown', () => this.toggleInventory());

    // 轻度压暗场景；主窗体只绘制一层紫灰玻璃，避免出现重叠的双层底板。
    const shade = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0b0d1a, 0.52).setOrigin(0);
    const window = this.add.graphics();
    window.fillStyle(0x44394b, 0.66).fillRoundedRect(250, 100, 780, 510, 16);
    window.lineStyle(1.05, 0xe1d5df, 0.55).strokeRoundedRect(250, 100, 780, 510, 16);
    window.fillStyle(0x282432, 0.52).fillRoundedRect(285, 472, 710, 105, 10);
    window.lineStyle(0.9, 0xd1c4d0, 0.3).strokeRoundedRect(285, 472, 710, 105, 10);

    const title = this.add.text(285, 128, '随身背包', {
      fontFamily: UI_FONT_DISPLAY,
      fontStyle: '300',
      fontSize: '29px',
      color: '#f4ebe5',
      shadow: { color: '#100c18', offsetX: 0, offsetY: 2, blur: 5, fill: true },
    }).setLetterSpacing(1);
    const subtitle = this.add.text(285, 169, '鱼竿、鱼饵与今日渔获 · 12 格', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '13px',
      color: '#c9bdc6',
    });
    this.inventoryDetail = this.add.text(310, 495, '点击查看物品说明，按住并拖到右侧丢弃区即可丢弃。', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: '#cec2ca',
      wordWrap: { width: 650 },
      lineSpacing: 7,
    });

    this.inventoryPanel = this.add.container(0, 0, [
      shade,
      window,
      title,
      subtitle,
      this.inventoryDetail,
    ]).setScrollFactor(0).setDepth(300).setVisible(false);

    for (let index = 0; index < 12; index += 1) {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const x = 330 + column * 112;
      const y = 246 + row * 104;
      const slotBg = this.add.graphics();
      slotBg.fillStyle(0x24212e, 0.7).fillRoundedRect(-42, -42, 84, 84, 8);
      slotBg.lineStyle(0.9, 0xd3c6d1, 0.38).strokeRoundedRect(-42, -42, 84, 84, 8);
      const icon = this.add.image(0, -2, 'inventory-rod')
        .setDisplaySize(56, 56)
        .setVisible(false);
      const quantity = this.add.text(34, 32, '', {
        fontFamily: UI_FONT,
        fontStyle: '300',
        fontSize: '14px',
        color: '#eadfd7',
        stroke: '#17131f',
        strokeThickness: 3,
      }).setOrigin(1, 1);
      const slot = this.add.container(x, y, [slotBg, icon, quantity]).setSize(84, 84).setScrollFactor(0).setDepth(301);
      slot.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-42, -42, 84, 84),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      slot.setVisible(false);
      this.inventorySlotObjects.push(slot);
      const slotHitArea = this.add.rectangle(x, y, 84, 84, 0xffffff, 0.001)
        .setScrollFactor(0)
        .setDepth(303)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });
      this.inventorySlotHitAreas.push(slotHitArea);
      this.inventorySlotBackgrounds.push(slotBg);
      this.inventorySlotIcons.push(icon);
      this.inventorySlotQuantities.push(quantity);
    }

    const trashBg = this.add.graphics();
    trashBg.fillStyle(0x302a3c, 0.68).fillRoundedRect(-52, -66, 104, 132, 12);
    trashBg.lineStyle(0.9, 0xd8cad6, 0.48).strokeRoundedRect(-52, -66, 104, 132, 12);
    const trashIcon = this.add.image(0, -15, 'inventory-trash').setDisplaySize(54, 54);
    const trashText = this.add.text(0, 43, '丢弃', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: '#ded2d8',
    }).setOrigin(0.5);
    this.inventoryTrashButton = this.add.container(1100, 278, [trashBg, trashIcon, trashText])
      .setSize(104, 132)
      .setScrollFactor(0)
      .setDepth(302)
      .setVisible(false)
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-52, -66, 104, 132),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    this.inventoryTrashHitArea = this.add.rectangle(1100, 278, 104, 132, 0xffffff, 0.001)
      .setScrollFactor(0)
      .setDepth(303)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.inventoryDragIcon = this.add.image(0, 0, 'inventory-rod')
      .setDisplaySize(62, 62)
      .setScrollFactor(0)
      .setDepth(310)
      .setVisible(false);
    this.inventoryDragQuantity = this.add.text(28, 28, '', {
      fontFamily: UI_FONT,
      fontSize: '15px',
      color: '#fff4cf',
      stroke: '#09121a',
      strokeThickness: 4,
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(311).setVisible(false);
    this.inventoryCloseButton = this.add.text(985, 128, '关闭  ✕', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: '#d7cbd2',
      padding: { x: 8, y: 5 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(302).setInteractive({ useHandCursor: true }).setVisible(false);
    this.inventoryCloseButton.on('pointerdown', () => this.toggleInventory(false));
    this.refreshInventoryUI();
  }

  private toggleInventory(force?: boolean) {
    const gameplayMode = this.mode === 'sailing'
      || this.mode === 'casting'
      || this.mode === 'fishing'
      || this.mode === 'hooked';
    if (!gameplayMode && force !== false) return;
    this.inventoryOpen = force ?? !this.inventoryOpen;
    this.inventoryPanel.setVisible(this.inventoryOpen);
    this.inventoryCloseButton.setVisible(this.inventoryOpen);
    this.inventoryTrashButton.setVisible(this.inventoryOpen);
    this.inventoryTrashHitArea.setVisible(this.inventoryOpen);
    for (const slot of this.inventorySlotObjects) slot.setVisible(this.inventoryOpen);
    for (const hitArea of this.inventorySlotHitAreas) hitArea.setVisible(this.inventoryOpen);
    this.inventoryButton.setVisible(!this.inventoryOpen);
    if (this.inventoryOpen) {
      this.selectedInventoryIndex = -1;
      this.inventoryDetail.setText('点击查看物品说明，按住并拖到右侧丢弃区即可丢弃。');
      this.refreshInventoryUI();
    } else {
      this.cancelInventoryDrag();
    }
  }

  private refreshInventoryUI() {
    for (let index = 0; index < this.inventorySlotIcons.length; index += 1) {
      const item = this.inventory[index];
      const slotBg = this.inventorySlotBackgrounds[index];
      const icon = this.inventorySlotIcons[index];
      const quantity = this.inventorySlotQuantities[index];
      slotBg.clear();
      slotBg.fillStyle(index === this.selectedInventoryIndex ? 0x514258 : 0x24212e, 0.7)
        .fillRoundedRect(-42, -42, 84, 84, 8);
      slotBg.lineStyle(
        index === this.selectedInventoryIndex ? 1.4 : 1,
        index === this.selectedInventoryIndex ? 0xe5d5ca : 0xc8bbc9,
        index === this.selectedInventoryIndex ? 0.82 : 0.32,
      ).strokeRoundedRect(-42, -42, 84, 84, 8);
      if (!item) {
        icon.setVisible(false);
        quantity.setText('');
        continue;
      }
      icon.setTexture(item.iconKey)
        .setVisible(true)
        .setAlpha(index === this.inventoryDraggingIndex && this.inventoryDragMoved ? 0.22 : 1);
      const source = this.textures.get(item.iconKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const maxSize = item.category === 'fish' ? 62 : 56;
      const ratio = Math.min(maxSize / source.width, maxSize / source.height);
      icon.setDisplaySize(source.width * ratio, source.height * ratio);
      quantity.setText(item.quantity > 1 ? String(item.quantity) : '');
    }
  }

  private showInventoryDetail(index: number) {
    const item = this.inventory[index];
    this.selectedInventoryIndex = item ? index : -1;
    this.refreshInventoryUI();
    if (!item) {
      this.inventoryDetail.setText('这个格子是空的。');
      return;
    }
    const valueText = item.category === 'fish' ? `\n食材价值：${item.unitValue} 金币 / 条` : '';
    this.inventoryDetail.setText(`${item.name}　×${item.quantity}${valueText}\n${item.description}`);
  }

  private handleInventoryCanvasPointer(x: number, y: number) {
    if (x >= 920 && x <= 990 && y >= 115 && y <= 160) {
      this.toggleInventory(false);
      return;
    }
    for (let index = 0; index < 12; index += 1) {
      const centerX = 345 + (index % 6) * 120;
      const centerY = 270 + Math.floor(index / 6) * 100;
      if (Math.abs(x - centerX) <= 42 && Math.abs(y - centerY) <= 42) {
        this.showInventoryDetail(index);
        return;
      }
    }
  }

  private inventoryPointerPosition(event: PointerEvent) {
    const bounds = this.game.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (VIEW_W / bounds.width),
      y: (event.clientY - bounds.top) * (VIEW_H / bounds.height),
    };
  }

  private inventorySlotAt(x: number, y: number) {
    for (let index = 0; index < 12; index += 1) {
      const centerX = 345 + (index % 6) * 120;
      const centerY = 270 + Math.floor(index / 6) * 100;
      if (Math.abs(x - centerX) <= 42 && Math.abs(y - centerY) <= 42) return index;
    }
    return -1;
  }

  private beginInventoryDrag(x: number, y: number) {
    const index = this.inventorySlotAt(x, y);
    if (index < 0 || !this.inventory[index]) return;
    this.inventoryDraggingIndex = index;
    this.inventoryDragStartX = x;
    this.inventoryDragStartY = y;
    this.inventoryDragMoved = false;
    this.showInventoryDetail(index);
  }

  private updateInventoryDrag(x: number, y: number) {
    const item = this.inventory[this.inventoryDraggingIndex];
    if (!item) {
      this.cancelInventoryDrag();
      return;
    }
    if (!this.inventoryDragMoved) {
      const distance = Phaser.Math.Distance.Between(
        this.inventoryDragStartX,
        this.inventoryDragStartY,
        x,
        y,
      );
      if (distance < 6) return;
      this.inventoryDragMoved = true;
      this.inventoryDragIcon.setTexture(item.iconKey).setAlpha(0.95).setVisible(true);
      const source = this.textures.get(item.iconKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const ratio = Math.min(66 / source.width, 66 / source.height);
      this.inventoryDragIcon.setDisplaySize(source.width * ratio, source.height * ratio);
      this.inventoryDragQuantity.setText(item.quantity > 1 ? String(item.quantity) : '').setVisible(item.quantity > 1);
      this.refreshInventoryUI();
    }

    this.inventoryDragIcon.setPosition(x, y);
    this.inventoryDragQuantity.setPosition(x + 30, y + 30);
    const overTrash = x >= 1048 && x <= 1152 && y >= 240 && y <= 360;
    if (overTrash !== this.inventoryTrashHovered) {
      this.inventoryTrashHovered = overTrash;
      this.inventoryTrashButton.setScale(overTrash ? 1.1 : 1);
      this.inventoryDetail.setText(
        overTrash ? `松开鼠标，丢弃 ${item.name} ×${item.quantity}` : `${item.name}　×${item.quantity}`,
      );
    }
  }

  private finishInventoryDrag(x: number, y: number) {
    const index = this.inventoryDraggingIndex;
    const item = this.inventory[index];
    const droppedOnTrash = this.inventoryDragMoved
      && x >= 1048 && x <= 1152
      && y >= 240 && y <= 360;
    this.suppressInventoryClick = this.inventoryDragMoved;
    window.setTimeout(() => {
      this.suppressInventoryClick = false;
    }, 0);

    if (!item || !droppedOnTrash) {
      this.cancelInventoryDrag();
      return;
    }

    if (item.category === 'tool') {
      this.inventoryDetail.setText(`${item.name}正在装备中，不能丢弃。`);
      this.tweens.add({
        targets: this.inventoryTrashButton,
        angle: { from: -5, to: 5 },
        duration: 55,
        yoyo: true,
        repeat: 2,
        onComplete: () => this.inventoryTrashButton.setAngle(0).setScale(1),
      });
      this.cancelInventoryDrag();
      return;
    }

    const discardedName = item.name;
    const discardedQuantity = item.quantity;
    this.inventoryDraggingIndex = -1;
    this.selectedInventoryIndex = -1;
    this.inventoryDragMoved = false;
    this.inventoryTrashHovered = false;
    this.inventory.splice(index, 1);
    this.syncCargoFromInventory();
    this.inventoryDetail.setText(`已丢弃 ${discardedName} ×${discardedQuantity}。`);

    this.tweens.add({
      targets: [this.inventoryDragIcon, this.inventoryDragQuantity],
      x: 1100,
      y: 300,
      alpha: 0,
      scaleX: 0.12,
      scaleY: 0.12,
      duration: 190,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.inventoryDragIcon.setVisible(false).setAlpha(1).setScale(1);
        this.inventoryDragQuantity.setVisible(false).setAlpha(1).setScale(1);
      },
    });
    this.tweens.add({
      targets: this.inventoryTrashButton,
      scaleX: { from: 1.1, to: 0.88 },
      scaleY: { from: 1.1, to: 1.18 },
      angle: { from: -4, to: 4 },
      duration: 90,
      yoyo: true,
      repeat: 1,
      onComplete: () => this.inventoryTrashButton.setAngle(0).setScale(1),
    });
  }

  private cancelInventoryDrag() {
    this.inventoryDraggingIndex = -1;
    this.inventoryDragMoved = false;
    this.inventoryTrashHovered = false;
    this.inventoryDragIcon?.setVisible(false).setAlpha(1).setScale(1);
    this.inventoryDragQuantity?.setVisible(false).setAlpha(1).setScale(1);
    this.inventoryTrashButton?.setAngle(0).setScale(1);
    if (this.inventorySlotIcons.length > 0) this.refreshInventoryUI();
  }

  private addInventoryItem(item: InventoryItem) {
    const existing = this.inventory.find((entry) => entry.id === item.id);
    if (existing) {
      existing.quantity += item.quantity;
    } else if (this.inventory.length < 12) {
      this.inventory.push({ ...item });
    } else {
      return false;
    }
    this.refreshInventoryUI();
    return true;
  }

  private consumeInventoryItem(id: string, quantity: number) {
    const item = this.inventory.find((entry) => entry.id === id);
    if (!item || item.quantity < quantity) return false;
    item.quantity -= quantity;
    if (item.quantity <= 0) this.inventory = this.inventory.filter((entry) => entry !== item);
    this.refreshInventoryUI();
    return true;
  }

  private syncCargoFromInventory() {
    const fishItems = this.inventory.filter((item) => item.category === 'fish');
    this.cargoCount = fishItems.reduce((total, item) => total + item.quantity, 0);
    this.cargoValue = fishItems.reduce((total, item) => total + item.quantity * item.unitValue, 0);
    this.refreshInventoryUI();
  }

  private removeInventoryFish(preserveSecretFish: boolean) {
    this.inventory = this.inventory.filter((item) => (
      item.category !== 'fish' || (preserveSecretFish && item.name === '深海毒鲉')
    ));
    this.syncCargoFromInventory();
  }

  private removeOneInventoryFish(name: string) {
    const item = this.inventory.find((entry) => entry.category === 'fish' && entry.name === name);
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) this.inventory = this.inventory.filter((entry) => entry !== item);
    this.syncCargoFromInventory();
  }

  private drawGlassPanel(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    radius = 14,
  ) {
    g.fillStyle(0x181214, 0.72).fillRoundedRect(x, y, w, h, radius);
    g.lineStyle(1, 0xd2ad9b, 0.24).strokeRoundedRect(x, y, w, h, radius);
  }

  private trackUiInteractive<T extends Phaser.GameObjects.GameObject>(
    obj: T,
    layer: 'port' | 'shipyard' | 'night',
  ): T {
    obj.setScrollFactor(0);
    const depth = layer === 'port' ? UI_DEPTH_PORT : layer === 'shipyard' ? UI_DEPTH_SHIPYARD : UI_DEPTH_NIGHT;
    if ('setDepth' in obj) (obj as Phaser.GameObjects.Components.Depth).setDepth(depth);
    const bucket = layer === 'port'
      ? this.portInteractives
      : layer === 'shipyard'
        ? this.shipyardInteractives
        : this.nightInteractives;
    bucket.push(obj);
    return obj;
  }

  private setPortUiVisible(visible: boolean) {
    this.portPanel.setVisible(visible);
    for (const obj of this.portInteractives) obj.setVisible(visible);
    if (this.primaryActionButton) {
      this.primaryActionButton.setVisible(visible && this.portTab !== 'overview');
    }
  }

  private setShipyardUiVisible(visible: boolean) {
    this.shipyardPanel.setVisible(visible);
    for (const obj of this.shipyardInteractives) obj.setVisible(visible);
  }

  private setNightUiVisible(visible: boolean) {
    this.nightDialogue.setVisible(visible);
    for (const obj of this.nightInteractives) obj.setVisible(visible);
  }

  private makePortNavItem(
    x: number,
    y: number,
    title: string,
    subtitle: string,
    tab: PortTab,
    locked = false,
  ) {
    const w = 228;
    const h = 58;
    const bg = this.add.graphics();
    const icon = this.add.graphics();
    icon.lineStyle(1.2, locked ? 0x695d5c : 0xc2a08f, 0.9).strokeCircle(10, h / 2, 5);
    const titleText = this.add.text(34, h / 2 - 10, title, {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '16px',
      color: locked ? '#695d5c' : UI_COLOR_TITLE,
    }).setOrigin(0, 0.5);
    const subText = this.add.text(34, h / 2 + 12, subtitle, {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '12px',
      color: locked ? '#574c4d' : UI_COLOR_MUTED,
    }).setOrigin(0, 0.5);
    const lock = this.add.text(w - 20, h / 2, '锁', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '12px',
      color: '#695d5c',
    }).setOrigin(0.5).setVisible(locked);

    // 不调用 setSize：Container 会用 width/height 推导 displayOrigin，命中区会整体偏移半格。
    const item = this.add.container(x, y, [bg, icon, titleText, subText, lock]);
    item.setData('tab', tab);
    item.setData('locked', locked);
    item.setData('bg', bg);
    item.setData('icon', icon);
    if (!locked) {
      item.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      item.on('pointerdown', () => this.setPortTab(tab));
    }
    return this.trackUiInteractive(item, 'port');
  }

  private makePrimaryButton(x: number, y: number, label: string, onClick: () => void) {
    const w = 280;
    const h = 44;
    const bg = this.add.graphics();
    bg.fillStyle(0x9f8172, 0.58).fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.fillStyle(0xf1d5c3, 0.055).fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.48, 9);
    bg.lineStyle(1.2, 0xddbda8, 0.62).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(1, 0xf4dfd0, 0.12).strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 9);
    const leftDiamond = this.add.graphics();
    leftDiamond.fillStyle(0xe0bda6, 0.62).fillCircle(-w / 2 + 25, 0, 2);
    const rightDiamond = this.add.graphics();
    rightDiamond.fillStyle(0xe0bda6, 0.62).fillCircle(w / 2 - 25, 0, 2);
    const text = this.add.text(0, 0, label, {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '16px',
      color: '#edcfb6',
    }).setOrigin(0.5);
    const button = this.add.container(x, y, [bg, leftDiamond, text, rightDiamond]);
    button.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    button.on('pointerdown', onClick);
    return this.trackUiInteractive(button, 'port');
  }

  private createPortPanel() {
    const restaurantBackground = this.add.image(VIEW_W / 2, VIEW_H / 2, 'restaurant-background')
      .setDisplaySize(VIEW_W, VIEW_H);
    const ui = this.add.graphics();
    this.drawGlassPanel(ui, 900, 36, 340, 210, 14);
    this.drawGlassPanel(ui, 780, 370, 460, 310, 14);

    const titleDecor = this.add.graphics();
    titleDecor.lineStyle(1, 0xffffff, 0.18).lineBetween(40, 118, 176, 118);
    titleDecor.fillStyle(0xffffff, 0.4).fillCircle(40, 118, 2.5);
    titleDecor.fillStyle(0xffffff, 0.4).fillCircle(176, 118, 2.5);

    const restaurantTitle = this.add.text(40, 34, '潮下食堂', {
      fontFamily: UI_FONT_DISPLAY,
      fontStyle: '300',
      fontSize: '38px',
      color: UI_COLOR_TITLE,
    });
    const sign = this.add.text(40, 88, '平落港 · 今日营业', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_MUTED,
    });
    const dialogue = this.add.text(40, 688, '· 渔获不会直接变成金币：先备菜，再开门招待客人。', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '13px',
      color: UI_COLOR_MUTED,
    });

    const statLabelStyle = { fontFamily: UI_FONT, fontStyle: '300', fontSize: '14px', color: UI_COLOR_MUTED };
    const statValueStyle = { fontFamily: UI_FONT, fontStyle: '300', fontSize: '14px', color: UI_COLOR_BODY };
    const statRows = [
      { y: 58, label: '食材价值', name: 'statCargo' },
      { y: 92, label: '已备套餐', name: 'statPrepared' },
      { y: 126, label: '预计营业额', name: 'statRevenue' },
      { y: 160, label: '金币', name: 'statCoins' },
      { y: 194, label: '餐厅口碑', name: 'statReputation' },
    ];
    const statLabels: Phaser.GameObjects.Text[] = [];
    const statValues: Phaser.GameObjects.Text[] = [];
    for (const row of statRows) {
      statLabels.push(this.add.text(920, row.y, row.label, statLabelStyle));
      statValues.push(
        this.add.text(1220, row.y, '', statValueStyle).setOrigin(1, 0).setName(row.name),
      );
    }

    this.portActionTitle = this.add.text(808, 396, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '20px',
      color: UI_COLOR_ACCENT,
    });
    this.portActionDesc = this.add.text(808, 438, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_MUTED,
      lineSpacing: 6,
      wordWrap: { width: 404 },
    });
    const serviceMessage = this.add.text(808, 520, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_BODY,
      lineSpacing: 6,
      wordWrap: { width: 404 },
    });
    serviceMessage.setName('serviceMessage');

    this.portPanel = this.add.container(0, 0, [
      restaurantBackground,
      ui,
      titleDecor,
      restaurantTitle,
      sign,
      dialogue,
      ...statLabels,
      ...statValues,
      this.portActionTitle,
      this.portActionDesc,
      serviceMessage,
    ])
      .setScrollFactor(0).setDepth(200).setVisible(false);

    this.portNavItems = [
      this.makePortNavItem(40, 138, '今晚经营', '查看营业概况', 'overview'),
      this.makePortNavItem(40, 204, '备菜', '将渔获做成套餐', 'prep'),
      this.makePortNavItem(40, 270, '开门营业', '接待港口客人', 'open'),
      this.makePortNavItem(40, 336, '港口船坞', '修理与改造船只', 'shipyard'),
      this.makePortNavItem(40, 402, '深夜营业', '解锁后开放', 'night'),
    ];

    this.primaryActionButton = this.makePrimaryButton(1010, 630, '备菜开始', () => {});
    this.primaryActionLabel = this.primaryActionButton.getAt(2) as Phaser.GameObjects.Text;
    this.nightActionLabel = this.primaryActionLabel;
    const departureButton = this.makePrimaryButton(180, 640, '白天出海', () => this.departFromRestaurant());
    this.portDepartureLabel = departureButton.getAt(2) as Phaser.GameObjects.Text;

    this.refreshPortNav();
    this.refreshPortActionPanel();
    this.setPortUiVisible(false);
  }

  private createRestaurantService() {
    this.restaurantService = new RestaurantService(this, {
      viewW: VIEW_W,
      viewH: VIEW_H,
      depth: UI_DEPTH_SERVICE,
      backgroundKey: 'restaurant-background',
      fontFamily: UI_FONT,
      onFinish: (result) => this.finishServiceShift(result),
      onOpenRequested: () => this.openRestaurant(),
      onManageRequested: () => this.openRestaurantManagement(),
      onLeaveRequested: () => this.departFromRestaurant(),
    });
    this.restaurantService.create();
  }

  private setPortTab(tab: PortTab) {
    this.portTab = tab;
    this.refreshPortNav();
    this.refreshPortActionPanel();
  }

  private refreshPortNav() {
    // 深夜营业必须先由神秘客人亲自提出订单；不能由玩家点击菜单主动召唤。
    const nightLocked = this.secretQuest !== 'accepted';
    const nightItem = this.portNavItems[4];
    this.portDepartureLabel?.setText(this.secretQuest === 'accepted' ? '夜间出海' : '白天出海');
    nightItem.setData('locked', nightLocked);
    (nightItem.getAt(4) as Phaser.GameObjects.Text).setVisible(nightLocked);
    (nightItem.getAt(2) as Phaser.GameObjects.Text).setColor(nightLocked ? '#6f7882' : UI_COLOR_TITLE);
    (nightItem.getAt(3) as Phaser.GameObjects.Text).setText(
      this.secretQuest === 'completed'
        ? '已完成黑市订单'
        : this.secretQuest === 'accepted'
          ? '黑市订单进行中'
          : '等待特别订单',
    );
    if (nightLocked) {
      nightItem.disableInteractive();
    } else {
      nightItem.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, 228, 58),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    }

    for (const item of this.portNavItems) {
      const bg = item.getData('bg') as Phaser.GameObjects.Graphics;
      const icon = item.getData('icon') as Phaser.GameObjects.Graphics;
      const itemTab = item.getData('tab') as PortTab;
      const locked = item.getData('locked') as boolean;
      bg.clear();
      icon.clear();
      if (itemTab === this.portTab) {
        bg.fillStyle(0x3a292c, 0.78).fillRoundedRect(0, 0, 228, 58, 10);
        bg.lineStyle(1, 0xd2ad9b, 0.46).strokeRoundedRect(0, 0, 228, 58, 10);
        bg.fillStyle(0xc2a08f, 0.9).fillRect(0, 8, 2, 42);
        icon.lineStyle(1.2, 0xc2a08f, 1).strokeCircle(10, 29, 5);
        (item.getAt(2) as Phaser.GameObjects.Text).setColor(UI_COLOR_TITLE);
      } else if (!locked) {
        bg.fillStyle(0x181214, 0.26).fillRoundedRect(0, 0, 228, 58, 10);
        icon.lineStyle(1.2, 0x9f8882, 0.9).strokeCircle(10, 29, 5);
        (item.getAt(2) as Phaser.GameObjects.Text).setColor(UI_COLOR_TITLE);
      }
    }
  }

  private refreshPortActionPanel() {
    const serviceMessage = this.portPanel.getByName('serviceMessage') as Phaser.GameObjects.Text;

    if (this.portTab === 'overview') {
      this.portActionTitle.setText('今晚经营');
      this.portActionDesc.setText('查看鱼篓、备菜与营业状态。左侧切换不同经营操作。');
      serviceMessage.setText(this.lastServiceMessage);
      this.primaryActionButton.setVisible(false);
      return;
    }

    this.primaryActionButton.setVisible(true);
    if (this.portTab === 'prep') {
      this.portActionTitle.setText('备菜（已并入开门流程）');
      this.portActionDesc.setText([
        '现在直接点开门营业，会先弹出菜单选择：',
        '从鱼篓里最多挑 3 种鱼做成今晚的招牌，份数 = 该鱼的库存。',
        '本页保留是为了以后加"食谱研究"，暂时无操作。',
      ].join('\n'));
      serviceMessage.setText(this.lastServiceMessage);
      this.primaryActionLabel.setText('去开门营业');
      this.primaryActionButton.removeAllListeners('pointerdown');
      this.primaryActionButton.on('pointerdown', () => {
        this.portTab = 'open';
        this.refreshPortNav();
        this.refreshPortActionPanel();
      });
      return;
    }
    if (this.portTab === 'open') {
      this.portActionTitle.setText('开门营业');
      this.portActionDesc.setText([
        '点开门后先弹出菜单：从鱼篓里最多挑 3 种鱼作为今晚菜单。',
        '进入营业：A/D 沿吧台跑动，靠近料理台按空格拿盘，',
        '走到冒气泡的客人面前按空格上菜。耐心归零客人会走。',
      ].join('\n'));
      serviceMessage.setText(this.lastServiceMessage);
      this.primaryActionLabel.setText('开门营业');
      this.primaryActionButton.removeAllListeners('pointerdown');
      this.primaryActionButton.on('pointerdown', () => this.openRestaurant());
      return;
    }
    if (this.portTab === 'shipyard') {
      this.portActionTitle.setText('港口船坞');
      this.portActionDesc.setText('修理船体、升级防撞结构与重型鱼竿。改造完成后返回食堂继续营业。');
      serviceMessage.setText(this.lastShipyardMessage || '船坞可进行维修与改造。');
      this.primaryActionLabel.setText('前往船坞');
      this.primaryActionButton.removeAllListeners('pointerdown');
      this.primaryActionButton.on('pointerdown', () => this.openShipyard());
      return;
    }

    this.portActionTitle.setText('深夜营业');
    this.portActionDesc.setText('已接下神秘客人的特别订单。准备妥当后可选择夜间出海。');
    serviceMessage.setText(this.lastServiceMessage);
    if (this.secretQuest === 'accepted' && this.secretFishCaught) {
      this.primaryActionLabel.setText('交付黑市订单');
    } else if (this.secretQuest === 'accepted') {
      this.primaryActionLabel.setText('夜间出海');
    } else {
      this.primaryActionLabel.setText('尚未解锁');
    }
    this.primaryActionButton.removeAllListeners('pointerdown');
    this.primaryActionButton.on('pointerdown', () => this.handleNightAction());
  }

  private createShipyardPanel() {
    const shipyardBackground = this.add.image(VIEW_W / 2, VIEW_H / 2, 'shipyard-background')
      .setDisplaySize(VIEW_W, VIEW_H);
    const yard = this.add.graphics();

    // 水彩背景覆盖完整画面，右侧仅叠加维修操作面板。
    yard.fillStyle(0x101820, 0.98).fillRect(780, 0, 500, VIEW_H);
    this.drawGlassPanel(yard, 810, 24, 440, 95, 12);
    this.drawGlassPanel(yard, 810, 136, 440, 470, 12);

    const yardTitle = this.add.text(40, 36, '平落港船坞', {
      fontFamily: UI_FONT_DISPLAY,
      fontStyle: '300',
      fontSize: '34px',
      color: UI_COLOR_TITLE,
    });
    const yardSubtitle = this.add.text(810, 44, '升级改造与维修', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '20px',
      color: UI_COLOR_ACCENT,
    });
    const yardStats = this.add.text(835, 166, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '16px',
      color: UI_COLOR_BODY,
      lineSpacing: 8,
    }).setName('yardStats');
    const yardMessage = this.add.text(835, 558, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_MUTED,
      wordWrap: { width: 405 },
      lineSpacing: 6,
    }).setName('yardMessage');

    this.shipyardPanel = this.add.container(0, 0, [
      shipyardBackground,
      yard,
      yardTitle,
      yardSubtitle,
      yardStats,
      yardMessage,
    ]).setScrollFactor(0).setDepth(230).setVisible(false);

    this.repairLabel = (this.makeButton(1030, 275, '修理船体', () => this.repairBoat(), 0x141a22, 'shipyard')).getAt(1) as Phaser.GameObjects.Text;
    this.hullUpgradeLabel = (this.makeButton(1030, 375, '升级防撞船体', () => this.upgradeHull(), 0x141a22, 'shipyard')).getAt(1) as Phaser.GameObjects.Text;
    this.rodUpgradeLabel = (this.makeButton(1030, 475, '升级重型鱼竿', () => this.upgradeRod(), 0x141a22, 'shipyard')).getAt(1) as Phaser.GameObjects.Text;
    this.makeButton(1030, 665, '返回潮下食堂', () => this.closeShipyard(), 0x141a22, 'shipyard');
    this.setShipyardUiVisible(false);
  }

  private createNightDialogue() {
    const restaurantBackground = this.add.image(VIEW_W / 2, VIEW_H / 2, 'restaurant-background')
      .setDisplaySize(VIEW_W, VIEW_H);
    this.bountyHunterSceneDim = this.add.rectangle(
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_W,
      VIEW_H,
      0x06121a,
      0.58,
    );
    const scene = this.add.graphics();

    const hunterSource = this.textures.get('faceless-bounty-hunter').getSourceImage() as HTMLImageElement;
    const hunterRatio = hunterSource.width / hunterSource.height;
    const hunterWidth = this.bountyHunterDisplayHeight * hunterRatio;

    const bountyHunter = this.add.image(0, 0, 'faceless-bounty-hunter')
      .setOrigin(0.5, 1)
      .setDisplaySize(hunterWidth, this.bountyHunterDisplayHeight);
    bountyHunter.preFX?.addGlow(0xf4f7f8, 1.2, 0, false, 0.08, 5);

    this.bountyHunterGroup = this.add.container(
      this.bountyHunterHomeX,
      this.bountyHunterHomeY,
      [bountyHunter],
    );

    this.drawGlassPanel(scene, 42, 82, 560, 305, 12);
    scene.fillStyle(0x7d3340).fillCircle(100, 147, 34);
    scene.fillStyle(0x9fbbad).fillEllipse(100, 147, 46, 22);
    scene.fillStyle(0x3e756f).fillTriangle(72, 147, 48, 132, 48, 162);

    this.drawGlassPanel(scene, 28, 505, 1224, 185, 12);
    this.drawGlassPanel(scene, 50, 474, 260, 62, 10);

    const orderTitle = this.add.text(155, 105, '深夜黑市订单', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '22px',
      color: UI_COLOR_ACCENT,
    });
    const orderDetail = this.add.text(78, 202, [
      '目标鱼：深海毒鲉',
      '指定料理：毒囊刺身',
      '出没条件：夜间深水',
      '黑市报酬：180 金币',
    ], {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '16px',
      color: UI_COLOR_BODY,
      lineSpacing: 10,
    });
    const customerName = this.add.text(180, 505, '无面赏金猎人', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '20px',
      color: UI_COLOR_TITLE,
    }).setOrigin(0.5);
    const dialogue = this.add.text(65, 550,
      '镇上的灯都熄了。替我弄一份“深海毒鲉的毒囊刺身”。\n别问我要喂给谁——天亮前端上来，我付你十倍价钱。',
      {
        fontFamily: UI_FONT,
        fontStyle: '300',
        fontSize: '16px',
        color: UI_COLOR_BODY,
        lineSpacing: 7,
        wordWrap: { width: 790 },
      },
    );

    this.nightDialogue = this.add.container(0, 0, [
      restaurantBackground,
      this.bountyHunterSceneDim,
      scene,
      this.bountyHunterGroup,
      orderTitle,
      orderDetail,
      customerName,
      dialogue,
    ]).setScrollFactor(0).setDepth(260).setVisible(false);

    this.makeButton(820, 655, '今晚不接', () => this.closeNightDialogue(), 0x141a22, 'night');
    this.makeButton(1060, 655, '接受订单 · 返回厨房', () => this.acceptSecretQuest(), 0x141a22, 'night');
    this.setNightUiVisible(false);
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color = 0x211719,
    layer: 'shipyard' | 'night' = 'shipyard',
  ) {
    const bg = this.add.graphics();
    bg.fillStyle(color, 0.9).fillRoundedRect(-165, -23, 330, 46, 10);
    bg.lineStyle(1, 0xd2ad9b, 0.28).strokeRoundedRect(-165, -23, 330, 46, 10);
    const text = this.add.text(0, 0, label, {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '16px',
      color: UI_COLOR_TITLE,
    }).setOrigin(0.5);
    const button = this.add.container(x, y, [bg, text]);
    button.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-165, -23, 330, 46),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    button.on('pointerdown', onClick);
    return this.trackUiInteractive(button, layer);
  }

  private createResultCard() {
    const bg = this.add.graphics();
    bg.fillStyle(0x181214, 0.94).fillRoundedRect(VIEW_W / 2 - 230, VIEW_H / 2 - 115, 460, 230, 16);
    bg.lineStyle(1, 0xd2ad9b, 0.42).strokeRoundedRect(VIEW_W / 2 - 230, VIEW_H / 2 - 115, 460, 230, 16);
    bg.lineStyle(1, 0xffffff, 0.1).lineBetween(VIEW_W / 2 - 180, VIEW_H / 2 - 42, VIEW_W / 2 + 180, VIEW_H / 2 - 42);
    const title = this.add.text(VIEW_W / 2, VIEW_H / 2 - 70, '成功起鱼', {
      fontFamily: UI_FONT_DISPLAY,
      fontSize: '27px',
      fontStyle: '300',
      color: UI_COLOR_TITLE,
    }).setOrigin(0.5);
    const detail = this.add.text(VIEW_W / 2, VIEW_H / 2, '', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '19px',
      color: UI_COLOR_BODY,
      align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5);
    detail.setName('detail');
    const tip = this.add.text(VIEW_W / 2, VIEW_H / 2 + 75, '即将回到水面', {
      fontFamily: UI_FONT,
      fontStyle: '300',
      fontSize: '14px',
      color: UI_COLOR_MUTED,
    }).setOrigin(0.5);
    this.resultCard = this.add.container(0, 0, [bg, title, detail, tip])
      .setScrollFactor(0).setDepth(180).setVisible(false);
  }

  private updateSailing(dt: number) {
    this.boat.setVisible(true);
    this.fisher.setVisible(false);
    const direction = Number(this.keys.right.isDown) - Number(this.keys.left.isDown);
    this.sailSpeed = direction * MANUAL_SAIL_SPEED;
    const nextX = Phaser.Math.Clamp(
      this.worldX + this.sailSpeed * dt,
      SAIL_START_X,
      SAIL_END_X,
    );
    if (nextX === this.worldX && direction !== 0) this.sailSpeed = 0;
    this.worldX = nextX;
    this.boat.x = this.worldX;
    this.fisher.x = this.boat.x + PLAYER_LAYOUT.fisher.offsetX;
    this.fisher.y = this.boat.y + PLAYER_LAYOUT.fisher.offsetY;

    this.cameras.main.scrollX = Phaser.Math.Linear(
      this.cameras.main.scrollX,
      this.worldX - PLAYER_SCREEN_X,
      dt * 5,
    );
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, 0, dt * 5);

    const distance = Math.abs(this.worldX - this.nextHotspotX);
    this.hotspot.setAlpha(distance < 450 ? 1 : 0.45);
    this.hotspotLabel.setVisible(distance < 480);

    if (this.worldX > this.nextHotspotX + 330) this.placeNextHotspot();
  }

  private updateBoatBobbing() {
    const bob = Math.sin(this.time.now * 0.0025) * 3;
    this.syncPlayerPositions(this.worldX, bob);
  }

  private createSurfaceSplash(x: number, y: number, scale: number) {
    const splash = this.add.graphics({ x, y }).setDepth(34);
    splash.lineStyle(3, 0xe8ffff, 0.92);
    splash.beginPath();
    splash.arc(-19, 3, 22, Math.PI * 1.06, Math.PI * 1.92);
    splash.strokePath();
    splash.beginPath();
    splash.arc(19, 3, 22, Math.PI * 1.08, Math.PI * 1.94);
    splash.strokePath();
    splash.beginPath();
    splash.arc(0, 7, 31, Math.PI * 1.12, Math.PI * 1.88);
    splash.strokePath();
    splash.fillStyle(0xe8ffff, 0.82);
    splash.fillEllipse(0, 3, 46, 9);
    splash.fillCircle(-27, -8, 4);
    splash.fillCircle(-13, -18, 3);
    splash.fillCircle(2, -25, 4.5);
    splash.fillCircle(17, -16, 3.5);
    splash.fillCircle(29, -6, 3);
    splash.setScale(scale * 0.58);
    this.tweens.add({
      targets: splash,
      alpha: 0,
      scaleX: scale * 1.5,
      scaleY: scale * 1.05,
      y: y - 14,
      duration: 620,
      ease: 'Quad.Out',
      onComplete: () => splash.destroy(),
    });
  }

  private updateNightDanger(dt: number) {
    let threatRate = 3;
    if (this.mode === 'fishing') threatRate = 6;
    if (this.mode === 'hooked') threatRate = this.fishPulling ? 12 : 8;
    this.nightThreat += threatRate * dt;

    if (this.nightThreat >= 100) {
      this.nightThreat = 0;
      const damage = Math.max(6, 22 - this.hullLevel * 7);
      this.boatHp = Math.max(0, this.boatHp - damage);
      this.dangerMessage = `怪鱼撞击船腹！船体 -${damage}`;
      this.cameras.main.shake(220, 0.012);
      this.cameras.main.flash(120, 120, 30, 45);
      if (this.boatHp <= 0) this.sinkBoat();
    } else if (this.nightThreat > 75) {
      this.dangerMessage = '水下巨影正在加速靠近，尽快收竿或返港！';
    } else if (this.nightThreat > 45) {
      this.dangerMessage = '船底传来刮擦声，威胁正在靠近。';
    } else {
      this.dangerMessage = '夜海很安静，但有什么东西跟着船。';
    }
  }

  private sinkBoat() {
    const rescueCost = 30;
    this.coins = Math.max(0, this.coins - rescueCost);
    this.removeInventoryFish(false);
    this.secretFishCaught = false;
    this.isNight = false;
    this.nightThreat = 0;
    this.boatHp = 25;
    this.nightOverlay.setVisible(false);
    this.clearFish();
    this.lure.setVisible(false);
    this.lastServiceMessage = `船体被怪鱼撞毁并拖回港口：损失全部渔获，拖船费 ${rescueCost} 金币。请前往船坞修理。`;
    this.lastShipyardMessage = '船体仅完成应急打捞，必须支付维修费才能恢复耐久。';
    this.mode = 'port';
    this.setPortUiVisible(true);
    this.refreshPortSummary();
  }

  private beginFishing() {
    if (!this.consumeInventoryItem('bait:basic', 1)) {
      this.setTextIfChanged(this.hintText, '鱼饵已经用完，回港补充后才能继续抛竿。');
      return;
    }
    this.mode = 'casting';
    this.sailSpeed = 0;
    this.castTimer = 0;
    this.castReleased = false;
    this.castVelocityX = 0;
    this.castVelocityY = 0;
    this.linePoints = [];
    this.lure.setPosition(this.rodTipX, this.rodTipY).setVisible(true);
  }

  private updateCasting(dt: number) {
    this.castTimer += dt;

    if (!this.castReleased) {
      // 先向身后蓄力，再快速向前挥竿。
      if (this.castTimer < 0.24) {
        const t = Phaser.Math.Easing.Sine.InOut(this.castTimer / 0.24);
        this.rodAngle = Phaser.Math.Linear(-0.78, -2.0, t);
      } else {
        const t = Phaser.Math.Clamp((this.castTimer - 0.24) / 0.28, 0, 1);
        this.rodAngle = Phaser.Math.Linear(-2.0, -0.28, Phaser.Math.Easing.Cubic.Out(t));
      }

      this.lure.setPosition(this.rodTipX, this.rodTipY);
      if (this.castTimer >= 0.42) {
        this.castReleased = true;
        this.castVelocityX = Phaser.Math.Between(390, 470);
        this.castVelocityY = -Phaser.Math.Between(175, 230);
      }
      return;
    }

    // 鱼钩离竿后按抛体运动飞行，鱼线节点会受到它的牵引。
    this.castVelocityY += 520 * dt;
    this.castVelocityX *= Math.pow(0.997, dt * 60);
    this.lure.x += this.castVelocityX * dt;
    this.lure.y += this.castVelocityY * dt;
    this.rodAngle = Phaser.Math.Linear(this.rodAngle, -0.72, dt * 5);

    if (this.lure.y >= FISHING_SURFACE_Y && this.castVelocityY > 0) {
      this.lure.y = FISHING_SURFACE_Y + 8;
      this.lureCastX = Phaser.Math.Clamp(this.lure.x, this.worldX + 230, this.worldX + 520);
      this.lureDepth = 8;
      this.lureDropBoostTimer = 1.15;
      this.mode = 'fishing';
      this.createSurfaceSplash(this.lure.x, FISHING_SURFACE_Y, 0.72);
      this.spawnFishSchool();
    }
  }

  private spawnFishSchool() {
    this.clearFish();
    const centerX = this.lureCastX;
    const rows = [
      FISHING_SURFACE_Y + 320,
      FISHING_SURFACE_Y + 460,
      FISHING_SURFACE_Y + 600,
      FISHING_SURFACE_Y + 720,
      FISHING_SURFACE_Y + 810,
    ];
    // 同一片水域同时存在落单鱼和小鱼群，避免每层深度都只有一条鱼。
    const schoolSizes = [1, Phaser.Math.Between(3, 4), 1, Phaser.Math.Between(3, 4), 1];

    rows.forEach((y, i) => {
      const groupSize = schoolSizes[i];
      const groupCenterX = centerX + Phaser.Math.Between(-250, 250);
      const groupDirection: -1 | 1 = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
      const groupSpeed = Phaser.Math.Between(64, 90) + i * 3;
      const groupPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);

      for (let member = 0; member < groupSize; member += 1) {
        const questTarget = this.isNight && this.secretQuest === 'accepted' && i === 0 && member === 0;
        const rare = questTarget || i === 4;
        const formationOffset = (member - (groupSize - 1) / 2) * 54;
        const sprite = this.add.sprite(
          groupCenterX + formationOffset,
          y + (member % 2 === 0 ? -1 : 1) * Phaser.Math.Between(6, 22),
          rare ? 'fish-rare' : 'fish-common',
        // 新纹理包含完整分叉尾和鳍，画布更宽；缩放后保持原有鱼群视觉尺寸。
        ).setDepth(26).setScale(rare ? 0.92 : Phaser.Math.FloatBetween(0.68, 0.8));
        sprite.setFlipX(groupDirection < 0);

        this.fish.push({
          sprite,
          homeX: sprite.x,
          baseY: sprite.y,
          speed: groupSpeed + Phaser.Math.Between(-5, 6),
          value: questTarget ? 90 : rare ? 68 : 16 + i * 5,
          name: questTarget ? '深海毒鲉' : rare ? '微光魟' : ['银鳞鱼', '港湾鲭', '礁石鲷', '长鳍鱼'][i % 4],
          phase: groupPhase + member * 0.22,
          swimDirection: groupDirection,
          interest: 0,
          awarenessDelay: Phaser.Math.FloatBetween(1.4, 3.8),
          behavior: 'unaware',
          stateTimer: 0,
          orbitAngle: Phaser.Math.FloatBetween(0, Math.PI * 2),
          biteDelay: Phaser.Math.FloatBetween(2.4, 4.6),
          approachSide: sprite.x < centerX ? -1 : 1,
        });
      }
    });
  }

  private updateFishing(dt: number) {
    this.lureDropBoostTimer = Math.max(0, this.lureDropBoostTimer - dt);
    const sinkSpeed = this.keys.down.isDown
      ? 270
      : this.keys.up.isDown
        ? -235
        : this.lureDropBoostTimer > 0
          ? 230
          : 16;
    this.lureDepth = Phaser.Math.Clamp(this.lureDepth + sinkSpeed * dt, 18, 900);
    this.lure.y = FISHING_SURFACE_Y + this.lureDepth;
    this.lure.x = this.lureCastX + Math.sin(this.time.now * 0.003) * 7;

    const targetScrollY = Phaser.Math.Clamp(this.lure.y - 390, 0, WORLD_BOTTOM - VIEW_H);
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, targetScrollY, dt * 3.2);

    let nearest: FishAgent | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let engaged: FishAgent | undefined;
    for (const fish of this.fish) {
      const distance = Phaser.Math.Distance.Between(fish.sprite.x, fish.sprite.y, this.lure.x, this.lure.y);
      const depthGap = Math.abs(fish.sprite.y - this.lure.y);
      if (fish.behavior !== 'unaware' && distance < 420) engaged = fish;
      if (distance < 320 && depthGap < 145 && distance < nearestDistance) {
        nearest = fish;
        nearestDistance = distance;
      }
    }

    // 一次只让一条鱼重点调查鱼饵，其余鱼继续自然巡游。
    const investigatingFish = engaged ?? nearest;
    let biteCandidate: FishAgent | undefined;

    for (const fish of this.fish) {
      if (fish !== investigatingFish) {
        fish.interest = Math.max(0, fish.interest - dt * 0.8);
        if (fish.behavior !== 'unaware') {
          fish.behavior = 'unaware';
          fish.stateTimer = 0;
        }
        this.patrolFish(fish, dt);
        continue;
      }

      const lureDistance = Phaser.Math.Distance.Between(
        fish.sprite.x,
        fish.sprite.y,
        this.lure.x,
        this.lure.y,
      );

      if (fish.behavior === 'unaware') {
        // 鱼不会在鱼钩出现瞬间响应，先保持巡游，经过随机时间才察觉。
        this.patrolFish(fish, dt);
        fish.interest += dt;
        if (fish.interest >= fish.awarenessDelay) {
          fish.behavior = 'curious';
          fish.stateTimer = 0;
          fish.approachSide = fish.sprite.x < this.lure.x ? -1 : 1;
        }
        continue;
      }

      if (lureDistance > 440) {
        fish.behavior = 'unaware';
        fish.interest = 0;
        fish.stateTimer = 0;
        this.patrolFish(fish, dt);
        continue;
      }

      fish.stateTimer += dt;
      if (fish.behavior === 'curious') {
        // 先靠近鱼钩侧面观察，而不是直线冲向钩尖。
        const approachT = Phaser.Math.Clamp(fish.stateTimer / 1.8, 0, 1);
        const targetX = this.lure.x + fish.approachSide * Phaser.Math.Linear(100, 58, approachT);
        const targetY = this.lure.y + Math.sin(this.time.now * 0.0025 + fish.phase) * 22;
        this.steerFish(fish, targetX, targetY, fish.speed * 1.2, dt);

        const approachDistance = Phaser.Math.Distance.Between(
          fish.sprite.x,
          fish.sprite.y,
          targetX,
          targetY,
        );
        if ((approachDistance < 28 && fish.stateTimer > 1.4) || fish.stateTimer > 2.8) {
          fish.behavior = 'retreating';
          fish.stateTimer = 0;
        }
        continue;
      }

      if (fish.behavior === 'retreating') {
        // 试探后先主动游远，给玩家一个明显的“失去兴趣”假动作。
        const retreatT = Phaser.Math.Clamp(fish.stateTimer / 1.8, 0, 1);
        const retreatDistance = Phaser.Math.Linear(105, 225, retreatT);
        const targetX = this.lure.x + fish.approachSide * retreatDistance;
        const targetY = this.lure.y + Math.sin(this.time.now * 0.002 + fish.phase) * 42;
        this.steerFish(fish, targetX, targetY, fish.speed * 1.3, dt);

        if (lureDistance > 185 || fish.stateTimer > 2.1) {
          fish.behavior = 'returning';
          fish.stateTimer = 0;
        }
        continue;
      }

      if (fish.behavior === 'returning') {
        // 游远后再从侧面折返，不直接瞄准钩尖。
        const targetX = this.lure.x + fish.approachSide * 48;
        const targetY = this.lure.y + Math.sin(this.time.now * 0.003 + fish.phase) * 18;
        this.steerFish(fish, targetX, targetY, fish.speed * 1.45, dt);

        if (lureDistance < 74 || fish.stateTimer > 2.8) {
          fish.behavior = 'circling';
          fish.stateTimer = 0;
          fish.orbitAngle = fish.approachSide < 0 ? Math.PI : 0;
          fish.biteDelay = Phaser.Math.FloatBetween(1.0, 2.2);
        }
        continue;
      }

      // 在鱼钩左右徘徊一段时间；决定咬钩后才逐渐收窄绕行半径。
      fish.orbitAngle += dt * (0.9 + fish.speed / 130);
      const biteProgress = Phaser.Math.Clamp((fish.stateTimer - fish.biteDelay) / 1.0, 0, 1);
      const orbitRadiusX = Phaser.Math.Linear(72, 5, biteProgress);
      const orbitRadiusY = Phaser.Math.Linear(28, 4, biteProgress);
      const targetX = this.lure.x + Math.cos(fish.orbitAngle) * orbitRadiusX;
      const targetY = this.lure.y + Math.sin(fish.orbitAngle * 1.35) * orbitRadiusY;
      this.steerFish(fish, targetX, targetY, fish.speed * (1.15 + biteProgress), dt);

      if (biteProgress >= 1 && lureDistance < 20) biteCandidate = fish;
    }

    if (biteCandidate) this.hookFish(biteCandidate);
  }

  private steerFish(fish: FishAgent, targetX: number, targetY: number, speed: number, dt: number) {
    const dx = targetX - fish.sprite.x;
    const dy = targetY - fish.sprite.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) return;

    const angle = Math.atan2(dy, dx);
    // 不允许单帧越过目标点，否则下一帧会反向追踪并形成高频振颤。
    const step = Math.min(speed * dt, distance);
    fish.sprite.x += Math.cos(angle) * step;
    fish.sprite.y += Math.sin(angle) * step;
    // 接近目标时保持原朝向，避免围绕鱼饵时每帧左右翻面。
    if (Math.abs(dx) > 8) {
      fish.swimDirection = dx < 0 ? -1 : 1;
      fish.sprite.setFlipX(fish.swimDirection < 0);
    }
  }

  private patrolFish(fish: FishAgent, dt: number) {
    fish.sprite.x += fish.speed * fish.swimDirection * dt;
    if (fish.sprite.x > fish.homeX + 175) fish.swimDirection = -1;
    if (fish.sprite.x < fish.homeX - 175) fish.swimDirection = 1;
    fish.sprite.setFlipX(fish.swimDirection < 0);

    const patrolY = fish.baseY + Math.sin(this.time.now * 0.0022 + fish.phase) * 20;
    fish.sprite.y = Phaser.Math.Linear(fish.sprite.y, patrolY, dt * 1.8);
  }

  private hookFish(fish: FishAgent) {
    this.mode = 'hooked';
    this.hookedFish = fish;
    this.lure.setVisible(false);
    this.tension = 32;
    this.fishStamina = 100;
    this.lineDistance = Phaser.Math.Distance.Between(
      this.rodTipX,
      this.rodTipY,
      fish.sprite.x,
      fish.sprite.y,
    );
    this.pullTimer = 1.1;
    this.fishPulling = false;
    this.fishSecured = false;
    this.surfaceRollsRemaining = 0;
    this.surfaceRollTimer = 0;
    this.surfaceRollElapsed = 0;
    this.surfaceRollCenterX = fish.sprite.x;
  }

  private updateHooked(dt: number) {
    const fish = this.hookedFish;
    if (!fish) return;
    // catchSurfaceY 用于相机滚动/水花特效等旧逻辑（船体坐标线）；
    // visualSurfaceY 才是玩家在画面里看到的水面（泡沫线所在的位置）。
    // 鱼是否“钓到”必须以视觉水面为准，否则会在还没到水面时就触发翻滚。
    const catchSurfaceY = this.getPlayerWaterContactY();
    const visualSurfaceY = this.waterlineWorldY ?? catchSurfaceY;

    // 搏鱼期间仍持续更新水下其他鱼，不能因状态切换而集体定格。
    for (const otherFish of this.fish) {
      if (otherFish === fish || !otherFish.sprite.visible) continue;
      otherFish.behavior = 'unaware';
      otherFish.stateTimer = 0;
      otherFish.interest = Math.max(0, otherFish.interest - dt);
      this.patrolFish(otherFish, dt);
    }

    const rodX = this.rodTipX;
    const rodY = this.rodTipY;

    // 越过水面后捕获结果已经锁定；鱼只贴着水面翻滚，不再飞回空中。
    if (this.fishSecured) {
      this.surfaceRollElapsed += dt;
      this.surfaceRollTimer -= dt;
      fish.sprite.x = this.surfaceRollCenterX + Math.sin(this.surfaceRollElapsed * 9) * 16;
      // 鱼的锚点在中心，直接把中心放在水面会让上半身腾空；
      // 这里把中心下移到自身高度的 ~35%，让上背刚好贴着可见水线翻滚。
      const submergeOffset = fish.sprite.displayHeight * 0.35;
      fish.sprite.y = visualSurfaceY + submergeOffset + Math.sin(this.surfaceRollElapsed * 18) * 3;
      // 水面翻滚表现为鱼身左右拍打，而不是连续做 360° 旋转。
      fish.sprite.angle = Math.sin(this.surfaceRollElapsed * 18) * 28;
      this.lineDistance = Phaser.Math.Distance.Between(rodX, rodY, fish.sprite.x, fish.sprite.y);

      if (this.surfaceRollTimer <= 0) {
        this.surfaceRollsRemaining -= 1;
        this.createSurfaceSplash(fish.sprite.x, visualSurfaceY, 0.85);
        if (this.surfaceRollsRemaining <= 0) {
          this.catchFish(fish);
          return;
        }
        this.surfaceRollTimer = 0.36;
      }

      const securedScrollY = Phaser.Math.Clamp(catchSurfaceY - 390, 0, WORLD_BOTTOM - VIEW_H);
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, securedScrollY, dt * 4.2);
      return;
    }

    this.pullTimer -= dt;
    if (this.pullTimer <= 0) {
      this.fishPulling = !this.fishPulling;
      this.pullTimer = this.fishPulling ? Phaser.Math.FloatBetween(0.7, 1.35) : Phaser.Math.FloatBetween(0.8, 1.7);
    }

    const reeling = this.keys.space.isDown || this.input.activePointer.isDown;
    const lineResistance = 1 + this.rodLevel * 0.28;

    if (this.fishPulling) {
      fish.sprite.x += (fish.sprite.x > this.worldX ? 1 : -1) * 55 * dt;
      fish.sprite.y += Math.sin(this.time.now * 0.015) * 34 * dt;
      this.lineDistance += 24 * dt;
      this.tension += (reeling ? 30 : 12) * dt / lineResistance;
    } else if (reeling) {
      this.lineDistance -= (this.fishStamina <= 0 ? 280 : 185) * dt;
      this.fishStamina -= 52 * dt;
      this.tension -= 4 * dt * lineResistance;
    } else {
      this.tension -= 5 * dt;
    }

    if (!reeling && this.fishPulling) this.tension -= 23 * dt;
    this.tension = Phaser.Math.Clamp(this.tension, 0, 110);
    this.fishStamina = Phaser.Math.Clamp(this.fishStamina, 0, 100);
    this.lineDistance = Phaser.Math.Clamp(this.lineDistance, 2, 900);

    const angle = Phaser.Math.Angle.Between(rodX, rodY, fish.sprite.x, fish.sprite.y);
    // 鱼仍有体力时至少停留在真实水面下方；力竭后才允许被拉出水面。
    const minimumDistance = this.fishStamina <= 0 ? 2 : 100;
    const visualDistance = Math.max(minimumDistance, this.lineDistance);
    fish.sprite.x = Phaser.Math.Linear(fish.sprite.x, rodX + Math.cos(angle) * visualDistance, dt * 2.8);
    fish.sprite.y = Phaser.Math.Linear(fish.sprite.y, rodY + Math.sin(angle) * visualDistance, dt * 2.8);
    fish.sprite.angle = Math.sin(this.time.now * 0.012) * (this.fishPulling ? 9 : 3);

    // 鱼的轮廓顶部一碰到画面里可见的水面就锁定捕获，
    // 随后进入贴水面的翻滚收尾动画，避免鱼腾空后再飞回。
    const submergeOffset = fish.sprite.displayHeight * 0.35;
    const reachedSurface = fish.sprite.y - fish.sprite.displayHeight * 0.5 <= visualSurfaceY;
    if (reachedSurface) {
      this.fishSecured = true;
      this.surfaceRollsRemaining = 3;
      this.surfaceRollTimer = 0.36;
      this.surfaceRollElapsed = 0;
      this.surfaceRollCenterX = fish.sprite.x;
      // 直接把鱼放到贴水面的高度，避免第一帧翻滚从半空开始。
      fish.sprite.y = visualSurfaceY + submergeOffset;
      this.fishPulling = false;
      this.createSurfaceSplash(fish.sprite.x, visualSurfaceY, 1.4);
      return;
    }

    const targetScrollY = Phaser.Math.Clamp(fish.sprite.y - 390, 0, WORLD_BOTTOM - VIEW_H);
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, targetScrollY, dt * 3.8);

    if (this.tension >= 100) {
      this.loseFish('鱼线绷断了');
      return;
    }
  }

  private catchFish(fish: FishAgent) {
    this.mode = 'result';
    this.lastCatch = fish.name;
    if (fish.name === '深海毒鲉' && this.secretQuest === 'accepted') {
      this.secretFishCaught = true;
    }
    this.addInventoryItem({
      id: `fish:${fish.name}`,
      name: fish.name,
      category: 'fish',
      iconKey: fish.name === '微光魟' || fish.name === '深海毒鲉' ? 'fish-rare' : 'fish-common',
      quantity: 1,
      unitValue: fish.value,
      description: `${fish.name}，刚从平落港外海钓起，可用于食堂备菜。`,
    });
    this.syncCargoFromInventory();
    this.resultTimer = 2.4;
    const detail = this.resultCard.getByName('detail') as Phaser.GameObjects.Text;
    detail.setText(`${fish.name}\n价值 ${fish.value} 金币`);
    this.resultCard.setVisible(true);
    fish.sprite.setVisible(false);
    this.line.clear();
  }

  private loseFish(message: string) {
    this.mode = 'result';
    this.lastCatch = '';
    this.resultTimer = 1.8;
    const detail = this.resultCard.getByName('detail') as Phaser.GameObjects.Text;
    detail.setText(`${message}\n下一次根据张力及时松开空格`);
    this.resultCard.setVisible(true);
    this.hookedFish?.sprite.setVisible(false);
    this.line.clear();
  }

  private updateResult(dt: number) {
    this.resultTimer -= dt;
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, 0, dt * 3);
    if (this.resultTimer <= 0) {
      this.resultCard.setVisible(false);
      this.clearFish();
      this.hookedFish = undefined;
      this.lure.setVisible(false);
      this.mode = 'sailing';
      this.placeNextHotspot();
    }
  }

  private cancelFishing() {
    this.clearFish();
    this.lure.setVisible(false);
    this.mode = 'sailing';
    this.placeNextHotspot();
  }

  private placeNextHotspot() {
    this.nextHotspotX = Math.min(SAIL_END_X, Math.max(this.worldX + 850, this.nextHotspotX + 1100));
    this.syncHotspotPosition();
  }

  private clearFish() {
    for (const fish of this.fish) fish.sprite.destroy();
    this.fish = [];
  }

  private enterPort() {
    if (this.inventoryOpen) this.toggleInventory(false);
    if (this.boatHp < this.boatMaxHp) {
      const repairCost = Math.ceil((this.boatMaxHp - this.boatHp) * 0.8);
      this.lastServiceMessage = `船体耐久 ${this.boatHp}/${this.boatMaxHp}，前往船坞可花费 ${repairCost} 金币维修。`;
      this.lastShipyardMessage = '检测到船体损伤。维修不会自动扣费，请手动确认。';
    }
    this.nightThreat = 0;
    this.nightOverlay.setVisible(false);
    this.mode = 'service';
    this.setPortUiVisible(false);
    this.restaurantService.showLobby(this.lastServiceMessage);
    // 已经有过营业经历后，神秘客人会在厨房停留期间随机登门。
    if (this.reputation > 0) this.scheduleSecretVisitor(6000, 14000);
  }

  private openRestaurantManagement() {
    this.restaurantService.hide();
    this.mode = 'port';
    this.portTab = 'overview';
    this.refreshPortSummary();
    this.setPortUiVisible(true);
  }

  private scheduleSecretVisitor(minDelayMs: number, maxDelayMs: number) {
    if (this.secretQuest !== 'available' || this.secretVisitorTimer?.getProgress() < 1) return;
    const delay = Phaser.Math.Between(minDelayMs, maxDelayMs);
    this.secretVisitorTimer = this.time.delayedCall(delay, () => {
      this.secretVisitorTimer = undefined;
      if (this.secretQuest !== 'available') return;
      if (this.mode !== 'service' || !this.restaurantService.isLobby) {
        // 玩家暂时离开厨房时不强行弹窗，等下次回店再尝试。
        return;
      }
      this.showSecretVisitor();
    });
  }

  private showSecretVisitor() {
    this.restaurantService.hide();
    this.mode = 'dialogue';
    this.setPortUiVisible(false);
    this.setNightUiVisible(true);
    this.playBountyHunterEntrance();
  }

  private playBountyHunterEntrance() {
    this.bountyHunterEntranceTween?.stop();
    this.bountyHunterGroup.setPosition(VIEW_W + 220, this.bountyHunterHomeY);
    this.bountyHunterGroup.setAlpha(1);
    this.bountyHunterSceneDim.setAlpha(0);

    this.bountyHunterEntranceTween = this.tweens.add({
      targets: this.bountyHunterGroup,
      x: this.bountyHunterHomeX,
      duration: 1150,
      ease: 'Cubic.easeOut',
    });
    this.tweens.add({
      targets: this.bountyHunterSceneDim,
      alpha: 1,
      duration: 700,
      ease: 'Sine.easeOut',
    });
  }

  private refreshPortSummary() {
    const statCargo = this.portPanel.getByName('statCargo') as Phaser.GameObjects.Text;
    const statPrepared = this.portPanel.getByName('statPrepared') as Phaser.GameObjects.Text;
    const statRevenue = this.portPanel.getByName('statRevenue') as Phaser.GameObjects.Text;
    const statCoins = this.portPanel.getByName('statCoins') as Phaser.GameObjects.Text;
    const statReputation = this.portPanel.getByName('statReputation') as Phaser.GameObjects.Text;
    statCargo.setText(String(this.cargoValue));
    statPrepared.setText(`${this.preparedServings} 份`);
    statRevenue.setText(String(this.preparedRevenue));
    statCoins.setText(String(this.coins));
    statReputation.setText(String(this.reputation));
    this.refreshPortNav();
    this.refreshPortActionPanel();
  }

  private prepareCatch() {
    const reservedQuestFish = this.secretQuest === 'accepted' && this.secretFishCaught ? 1 : 0;
    const usableCount = this.cargoCount - reservedQuestFish;
    const usableValue = this.cargoValue - (reservedQuestFish ? 90 : 0);
    if (usableCount <= 0) {
      this.lastServiceMessage = reservedQuestFish
        ? '深海毒鲉已为黑市订单预留，不能放进普通菜单。'
        : '鱼篓是空的，先出海带回食材。';
      this.refreshPortSummary();
      return;
    }
    this.preparedServings += usableCount;
    this.preparedRevenue += Math.max(usableCount * 12, Math.round(usableValue * 2));
    this.lastServiceMessage = `备菜完成：厨房准备了 ${this.preparedServings} 份套餐。`;
    this.removeInventoryFish(reservedQuestFish > 0);
    this.refreshPortSummary();
  }

  private openRestaurant() {
    const reservedQuestFishId = this.secretQuest === 'accepted' && this.secretFishCaught ? 'fish:deep-toxin' : null;
    const caughtFishSources = this.inventory
      .filter((item) => item.category === 'fish' && item.quantity > 0 && item.id !== reservedQuestFishId)
      .slice(0, 3)
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitValue,
      }));
    // 厨房常备菜不依赖当日渔获；即使空手回店也能维持基础营业。
    const pantrySources = [
      {
        id: 'pantry:kelp-soup',
        name: '干海带与高汤',
        dishName: '海带汤',
        quantity: 2,
        portionsPerUnit: 2,
        unitPrice: 0,
        fixedDishPrice: 18,
        isPantry: true,
      },
      {
        id: 'pantry:pork-cutlet-rice',
        name: '猪排与米饭',
        dishName: '猪排饭',
        quantity: 2,
        portionsPerUnit: 2,
        unitPrice: 0,
        fixedDishPrice: 28,
        isPantry: true,
      },
      {
        id: 'pantry:tea-rice',
        name: '茶汤与米饭',
        dishName: '茶泡饭',
        quantity: 2,
        portionsPerUnit: 2,
        unitPrice: 0,
        fixedDishPrice: 20,
        isPantry: true,
      },
    ];
    const fishSources = [...caughtFishSources, ...pantrySources];
    this.secretVisitorTimer?.remove();
    this.secretVisitorTimer = undefined;
    this.mode = 'service';
    this.setPortUiVisible(false);
    this.restaurantService.start({
      fishSources,
      reputation: this.reputation,
    });
  }

  private finishServiceShift(result: RestaurantServiceResult) {
    const revenue = result.income + result.tips;
    this.coins += revenue;
    this.reputation = Math.max(0, this.reputation + result.reputationDelta);
    for (const [fishId, qty] of Object.entries(result.consumed)) {
      if (qty > 0) this.consumeInventoryItem(fishId, qty);
    }
    // 新版把「备菜」并入营业内菜单选择，这里保留字段但不再计数。
    this.preparedServings = 0;
    this.preparedRevenue = 0;
    if (result.served === 0 && result.lost === 0 && result.income === 0) {
      this.lastServiceMessage = '已退出菜单，未开门营业。';
    } else {
      this.lastServiceMessage = [
        `营业结束：接待 ${result.served} 位客人，流失 ${result.lost} 位。`,
        `收入 ${revenue} 金币（含小费 ${result.tips}），口碑 ${result.reputationDelta >= 0 ? '+' : ''}${result.reputationDelta}。`,
      ].join('\n');
    }
    this.mode = 'service';
    this.setPortUiVisible(false);
    this.restaurantService.showLobby(this.lastServiceMessage);
    if (result.served > 0) this.scheduleSecretVisitor(2500, 6500);
  }

  private openShipyard() {
    this.mode = 'shipyard';
    this.setPortUiVisible(false);
    this.setShipyardUiVisible(true);
    this.refreshShipyard();
  }

  private closeShipyard() {
    this.setShipyardUiVisible(false);
    this.mode = 'port';
    this.setPortUiVisible(true);
    this.refreshPortSummary();
    if (this.reputation > 0) this.scheduleSecretVisitor(5000, 11000);
  }

  private refreshShipyard() {
    const stats = this.shipyardPanel.getByName('yardStats') as Phaser.GameObjects.Text;
    const message = this.shipyardPanel.getByName('yardMessage') as Phaser.GameObjects.Text;
    const repairCost = this.boatRepairCost();

    stats.setText([
      `持有金币：${this.coins}`,
      `船体耐久：${this.boatHp} / ${this.boatMaxHp}`,
    ]);
    message.setText(this.lastShipyardMessage);
    this.repairLabel.setText(repairCost > 0 ? `修理船体 · ${repairCost} 金币` : '船体状态完好');
    this.hullUpgradeLabel.setText(`防撞船体 Lv.${this.hullLevel} → Lv.${this.hullLevel + 1} · ${this.hullUpgradeCost()} 金`);
    this.rodUpgradeLabel.setText(`重型鱼竿 Lv.${this.rodLevel} → Lv.${this.rodLevel + 1} · ${this.rodUpgradeCost()} 金`);
  }

  private repairBoat() {
    const cost = this.boatRepairCost();
    if (cost <= 0) {
      this.lastShipyardMessage = '船体状态完好，目前不需要维修。';
      this.refreshShipyard();
      return;
    }
    if (this.coins < cost) {
      this.lastShipyardMessage = `维修需要 ${cost} 金币，目前金币不足。`;
      this.refreshShipyard();
      return;
    }
    this.coins -= cost;
    this.boatHp = this.boatMaxHp;
    this.lastShipyardMessage = `维修完成：船体耐久已恢复至 ${this.boatMaxHp}。`;
    this.lastServiceMessage = `船坞维修完成，支出 ${cost} 金币。`;
    this.refreshShipyard();
  }

  private boatRepairCost() {
    return Math.ceil((this.boatMaxHp - this.boatHp) * 0.8);
  }

  private upgradeHull() {
    const cost = this.hullUpgradeCost();
    if (this.coins < cost) {
      this.lastShipyardMessage = `防撞船体升级需要 ${cost} 金币。先完成高价订单筹集资金。`;
      this.refreshShipyard();
      return;
    }
    this.coins -= cost;
    this.hullLevel += 1;
    this.lastShipyardMessage = `改造完成：防撞船体升至 Lv.${this.hullLevel}，怪鱼撞击伤害降低。`;
    this.lastServiceMessage = `船坞完成防撞船体 Lv.${this.hullLevel} 改造。`;
    this.refreshShipyard();
  }

  private upgradeRod() {
    const cost = this.rodUpgradeCost();
    if (this.coins < cost) {
      this.lastShipyardMessage = `重型鱼竿升级需要 ${cost} 金币。夜间料理的利润更高。`;
      this.refreshShipyard();
      return;
    }
    this.coins -= cost;
    this.rodLevel += 1;
    this.lastShipyardMessage = `改造完成：重型鱼竿升至 Lv.${this.rodLevel}，搏鱼时张力增长降低。`;
    this.lastServiceMessage = `船坞完成重型鱼竿 Lv.${this.rodLevel} 改造。`;
    this.refreshShipyard();
  }

  private hullUpgradeCost() {
    return 120 + this.hullLevel * 100;
  }

  private rodUpgradeCost() {
    return 120 + this.rodLevel * 100;
  }

  private handleNightAction() {
    if (this.secretQuest === 'available') {
      this.lastServiceMessage = '尚未收到特别订单。神秘客人只会在营业期间自行登门。';
      this.portTab = 'overview';
      this.refreshPortSummary();
      return;
    }
    if (this.secretQuest === 'accepted' && this.secretFishCaught) {
      this.deliverSecretDish();
      return;
    }
    if (this.secretQuest === 'accepted') {
      this.resumeNightSailing();
      return;
    }
    this.leavePort();
  }

  private closeNightDialogue() {
    this.setNightUiVisible(false);
    this.isNight = false;
    this.nightOverlay.setVisible(false);
    this.lastServiceMessage = '神秘客人悄无声息地离开了。也许以后还会再来。';
    this.enterPort();
  }

  private acceptSecretQuest() {
    this.secretQuest = 'accepted';
    this.secretFishCaught = false;
    this.isNight = false;
    this.lastServiceMessage = '黑市订单已接取。回到厨房准备妥当后，从“深夜营业”选择夜间出海。';
    this.setNightUiVisible(false);
    this.nightOverlay.setVisible(false);
    this.enterPort();
  }

  private resumeNightSailing() {
    this.restaurantService.hide();
    this.setPortUiVisible(false);
    this.setShipyardUiVisible(false);
    this.mode = 'sailing';
    this.isNight = true;
    this.nightOverlay.setVisible(true);
    this.resetVoyage();
  }

  private deliverSecretDish() {
    const reward = 180;
    this.removeOneInventoryFish('深海毒鲉');
    this.coins += reward;
    this.reputation += 2;
    this.secretQuest = 'completed';
    this.secretFishCaught = false;
    this.isNight = false;
    this.nightOverlay.setVisible(false);
    this.lastServiceMessage = `黑市订单完成：毒囊刺身已交付，获得 ${reward} 金币。`;
    this.refreshPortSummary();
  }

  private departFromRestaurant() {
    if (window.openFishingMapSelect) {
      window.openFishingMapSelect();
      return;
    }
    this.leavePort();
  }

  private leavePort() {
    this.restaurantService.hide();
    this.setPortUiVisible(false);
    this.setShipyardUiVisible(false);
    this.mode = 'sailing';
    this.nightOverlay.setVisible(this.isNight);
    this.resetVoyage();
  }

  private resetVoyage() {
    this.worldX = SAIL_START_X;
    this.sailSpeed = 0;
    this.nextHotspotX = Math.min(SAIL_END_X, SAIL_START_X + 930);
    this.syncPlayerPositions(this.worldX);
    this.syncHotspotPosition();
    this.cameras.main.scrollX = SAIL_START_X - PLAYER_SCREEN_X;
    this.cameras.main.scrollY = 0;
  }

  private drawFishingRod(dt: number) {
    this.rod.clear();
    const rodVisible = this.mode === 'sailing'
      || this.mode === 'casting'
      || this.mode === 'fishing'
      || this.mode === 'hooked';
    if (!rodVisible) return;

    if (this.mode === 'sailing') {
      this.rodAngle = Phaser.Math.Linear(this.rodAngle, PLAYER_LAYOUT.rod.restAngle, dt * 7);
    } else if (this.mode === 'fishing') {
      this.rodAngle = Phaser.Math.Linear(this.rodAngle, -0.7, dt * 5);
    } else if (this.mode === 'hooked') {
      const hookedAngle = this.fishPulling ? -0.34 : -0.68;
      this.rodAngle = Phaser.Math.Linear(this.rodAngle, hookedAngle, dt * 5);
    }

    // 严格读取编辑器保存的隐藏旅人锚点与鱼竿握点，不再使用硬编码坐标。
    const baseX = this.fisher.x + PLAYER_LAYOUT.rod.gripOffsetX;
    const baseY = this.fisher.y + PLAYER_LAYOUT.rod.gripOffsetY;
    const rodLength = PLAYER_LAYOUT.rod.length;
    const nominalTipX = baseX + Math.cos(this.rodAngle) * rodLength;
    const nominalTipY = baseY + Math.sin(this.rodAngle) * rodLength;
    const angularVelocity = dt > 0 ? (this.rodAngle - this.previousRodAngle) / dt : 0;
    const normalX = -Math.sin(this.rodAngle);
    const normalY = Math.cos(this.rodAngle);

    let pullX = normalX * Phaser.Math.Clamp(-angularVelocity * 4.2, -25, 25);
    let pullY = normalY * Phaser.Math.Clamp(-angularVelocity * 4.2, -25, 25);
    const lineTarget = this.mode === 'hooked' && this.hookedFish
      ? this.hookedFish.sprite
      : this.lure;
    if ((this.mode === 'fishing' || this.mode === 'hooked') && lineTarget.visible) {
      const toTargetX = lineTarget.x - nominalTipX;
      const toTargetY = lineTarget.y - nominalTipY;
      const targetDistance = Math.max(1, Math.hypot(toTargetX, toTargetY));
      const bendStrength = this.mode === 'hooked'
        ? Phaser.Math.Clamp(this.tension * 0.25, 6, 28)
        : 7;
      pullX += (toTargetX / targetDistance) * bendStrength;
      pullY += (toTargetY / targetDistance) * bendStrength;
    }

    const rodPoints: Phaser.Math.Vector2[] = [];
    const segmentCount = 8;
    for (let i = 0; i <= segmentCount; i += 1) {
      const t = i / segmentCount;
      rodPoints.push(new Phaser.Math.Vector2(
        Phaser.Math.Linear(baseX, nominalTipX, t) + pullX * t * t,
        Phaser.Math.Linear(baseY, nominalTipY, t) + pullY * t * t,
      ));
    }

    this.rodTipX = rodPoints[segmentCount].x;
    this.rodTipY = rodPoints[segmentCount].y;
    this.previousRodAngle = this.rodAngle;

    if (ACTIVE_MAP_ID === 'fishing-map-02') {
      // 参考图：细长、逐渐收尖的暖棕木竿，不使用现代感明显的大型卷线轮。
      for (let index = 0; index < segmentCount; index += 1) {
        const start = rodPoints[index];
        const end = rodPoints[index + 1];
        const progress = index / segmentCount;
        this.rod.lineStyle(Phaser.Math.Linear(5.2, 1.6, progress), 0x142738, 0.78);
        this.rod.lineBetween(start.x, start.y, end.x, end.y);
        this.rod.lineStyle(Phaser.Math.Linear(3.1, 0.9, progress), 0x526f7f, 0.98);
        this.rod.lineBetween(start.x, start.y, end.x, end.y);
        // 冷蓝环境光只落在朝上的细边，保留木竿质感但压掉突兀的橙红色。
        this.rod.lineStyle(0.7, 0x8db2bd, 0.52);
        this.rod.lineBetween(start.x, start.y - 0.6, end.x, end.y - 0.6);
      }

      // 短握把和两道绑线，保持参考图中朴素的手工木竿感。
      this.rod.lineStyle(7, 0x263846, 0.98);
      this.rod.lineBetween(rodPoints[0].x, rodPoints[0].y, rodPoints[1].x, rodPoints[1].y);
      this.rod.lineStyle(1.2, 0x7898a3, 0.82);
      [0.28, 0.68].forEach((t) => {
        const bindX = Phaser.Math.Linear(rodPoints[0].x, rodPoints[1].x, t);
        const bindY = Phaser.Math.Linear(rodPoints[0].y, rodPoints[1].y, t);
        this.rod.lineBetween(bindX - normalX * 3, bindY - normalY * 3, bindX + normalX * 3, bindY + normalY * 3);
      });

      // 仅保留三个小型导环，尺寸沿竿尖逐渐缩小。
      [4, 6, 8].forEach((index, guideIndex) => {
        const point = rodPoints[index];
        const previous = rodPoints[index - 1];
        const tangentX = point.x - previous.x;
        const tangentY = point.y - previous.y;
        const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
        const guideNormalX = -tangentY / tangentLength;
        const guideNormalY = tangentX / tangentLength;
        const guideOffset = 3.6 - guideIndex * 0.7;
        const guideX = point.x + guideNormalX * guideOffset;
        const guideY = point.y + guideNormalY * guideOffset;
        this.rod.lineStyle(0.85, 0x203441, 0.92);
        this.rod.lineBetween(point.x, point.y, guideX, guideY);
        this.rod.lineStyle(0.8, 0x7d9ba5, 0.88);
        this.rod.strokeCircle(guideX, guideY, 1.8 - guideIndex * 0.3);
      });
    } else {
      // 旧地图保持原有鱼竿造型。
      this.rod.lineStyle(5, 0x332b29, 0.72);
      this.rod.beginPath();
      this.rod.moveTo(rodPoints[0].x, rodPoints[0].y);
      for (let i = 1; i <= segmentCount; i += 1) this.rod.lineTo(rodPoints[i].x, rodPoints[i].y);
      this.rod.strokePath();
      this.rod.lineStyle(2, 0xb9a27d, 0.96);
      this.rod.beginPath();
      this.rod.moveTo(rodPoints[0].x, rodPoints[0].y);
      for (let i = 1; i <= segmentCount; i += 1) this.rod.lineTo(rodPoints[i].x, rodPoints[i].y);
      this.rod.strokePath();

      this.rod.lineStyle(8, 0x59443a, 1);
      this.rod.lineBetween(rodPoints[0].x, rodPoints[0].y, rodPoints[2].x, rodPoints[2].y);
      this.rod.lineStyle(2, 0xb77b52, 0.9);
      this.rod.lineBetween(rodPoints[0].x, rodPoints[0].y, rodPoints[1].x, rodPoints[1].y);
      const reelX = rodPoints[2].x + normalX * 6;
      const reelY = rodPoints[2].y + normalY * 6;
      this.rod.fillStyle(0x78665a, 1).fillCircle(reelX, reelY, 4);
      this.rod.lineStyle(1, 0xc5aa78, 0.9).strokeCircle(reelX, reelY, 4);
      this.rod.fillStyle(0x302a29, 1).fillCircle(reelX, reelY, 1.5);

      [3, 5, 7, 8].forEach((index, guideIndex) => {
        const point = rodPoints[index];
        const previous = rodPoints[Math.max(0, index - 1)];
        const tangentX = point.x - previous.x;
        const tangentY = point.y - previous.y;
        const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
        const guideNormalX = -tangentY / tangentLength;
        const guideNormalY = tangentX / tangentLength;
        const guideOffset = guideIndex === 3 ? 3 : 4;
        const guideX = point.x + guideNormalX * guideOffset;
        const guideY = point.y + guideNormalY * guideOffset;
        this.rod.lineStyle(1, 0x493e39, 0.92);
        this.rod.lineBetween(point.x, point.y, guideX, guideY);
        this.rod.lineStyle(1, 0xc6b28f, 0.9);
        this.rod.strokeCircle(guideX, guideY, guideIndex === 3 ? 2 : 2.5);
      });
    }
  }

  private drawFishingLine(dt: number) {
    this.line.clear();
    this.surfaceFx.clear();
    if (this.mode !== 'casting' && this.mode !== 'fishing' && this.mode !== 'hooked') {
      this.linePoints = [];
      return;
    }

    const rodX = this.rodTipX;
    const rodY = this.rodTipY;
    const target = this.mode === 'hooked' && this.hookedFish ? this.hookedFish.sprite : this.lure;
    const pointCount = 42;

    if (this.linePoints.length !== pointCount) {
      this.linePoints = Array.from({ length: pointCount }, (_, index) => {
        const t = index / (pointCount - 1);
        const x = Phaser.Math.Linear(rodX, target.x, t);
        const y = Phaser.Math.Linear(rodY, target.y, t) + Math.sin(Math.PI * t) * 22;
        return { x, y, previousX: x, previousY: y };
      });
    }

    const lastIndex = this.linePoints.length - 1;
    const damping = this.mode === 'hooked' ? 0.965 : 0.94;
    const gravity = this.mode === 'hooked' ? 72 : 105;

    // Verlet 积分保留每个节点上一帧的位置，让鱼线具备惯性、下垂与回弹。
    for (let i = 1; i < lastIndex; i += 1) {
      const point = this.linePoints[i];
      const velocityX = (point.x - point.previousX) * damping;
      const velocityY = (point.y - point.previousY) * damping;
      point.previousX = point.x;
      point.previousY = point.y;
      point.x += velocityX + Math.sin(this.time.now * 0.0018 + i * 0.7) * 5 * dt;
      point.y += velocityY + gravity * dt * dt;
    }

    const anchor = this.linePoints[0];
    const end = this.linePoints[lastIndex];
    anchor.x = rodX;
    anchor.y = rodY;
    end.x = target.x;
    end.y = target.y;

    const directDistance = Phaser.Math.Distance.Between(rodX, rodY, target.x, target.y);
    const normalizedTension = this.mode === 'hooked' ? Phaser.Math.Clamp(this.tension / 100, 0, 1) : 0.25;
    const slackFactor = Phaser.Math.Linear(1.065, 1.005, normalizedTension);
    const segmentLength = (directDistance * slackFactor + 10) / lastIndex;

    // 多轮距离约束模拟绳段弹性；不完全刚性收敛，视觉上会有轻微伸缩。
    for (let iteration = 0; iteration < 7; iteration += 1) {
      anchor.x = rodX;
      anchor.y = rodY;
      end.x = target.x;
      end.y = target.y;

      for (let i = 0; i < lastIndex; i += 1) {
        const a = this.linePoints[i];
        const b = this.linePoints[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const correction = ((distance - segmentLength) / distance) * 0.72;
        const correctionX = dx * correction;
        const correctionY = dy * correction;

        if (i === 0) {
          b.x -= correctionX;
          b.y -= correctionY;
        } else if (i + 1 === lastIndex) {
          a.x += correctionX;
          a.y += correctionY;
        } else {
          a.x += correctionX * 0.5;
          a.y += correctionY * 0.5;
          b.x -= correctionX * 0.5;
          b.y -= correctionY * 0.5;
        }
      }
    }

    anchor.x = rodX;
    anchor.y = rodY;
    end.x = target.x;
    end.y = target.y;

    const lineColor = this.mode === 'hooked' && this.tension > 78 ? 0xff8b6b : 0xf2e4b8;
    // 参考视频使用分段可见的鱼线；每隔一段留空，同时保留节点物理形成的弧度。
    this.line.lineStyle(3, 0x17212d, 0.34);
    for (let i = 1; i <= lastIndex; i += 2) {
      const from = this.linePoints[i - 1];
      const to = this.linePoints[i];
      this.line.lineBetween(from.x, from.y, to.x, to.y);
    }
    this.line.lineStyle(2, lineColor, 0.94);
    for (let i = 1; i <= lastIndex; i += 2) {
      const from = this.linePoints[i - 1];
      const to = this.linePoints[i];
      this.line.lineBetween(from.x, from.y, to.x, to.y);
    }

    if (this.mode === 'fishing') {
      this.surfaceFx.lineStyle(2, 0xd9f7f4, 0.65);
      this.surfaceFx.strokeCircle(this.lure.x, FISHING_SURFACE_Y, 16 + Math.sin(this.time.now * 0.006) * 4);
    }
  }

  private updateHud() {
    const isManagementMode = this.inManagementMode;
    for (const obj of this.sailingHudObjects) obj.setVisible(!isManagementMode);
    this.inventoryButton.setVisible(!isManagementMode && !this.inventoryOpen);
    this.inventoryButtonFrame.setVisible(!isManagementMode && !this.inventoryOpen);

    const nearSpot = Math.abs(this.worldX - this.nextHotspotX) < 230;
    this.setTextIfChanged(this.cargoText,
      `渔获 ${this.cargoCount} 条　　　　　金币 ${this.cargoValue}`,
    );
    const atSailBoundary = this.worldX >= SAIL_END_X;
    const showPortButton = !isManagementMode && this.mode === 'sailing';
    this.portButton.setVisible(showPortButton);
    const showDanger = this.isNight && (this.mode === 'sailing' || this.mode === 'fishing' || this.mode === 'hooked');
    this.dangerHud.setVisible(showDanger);
    this.boatHpFill.displayWidth = 232 * (this.boatHp / this.boatMaxHp);
    this.boatHpFill.setFillStyle(this.boatHp < 35 ? 0xd96862 : this.boatHp < 65 ? 0xd6a65f : 0xb6a37c);
    this.threatFill.displayWidth = 232 * Phaser.Math.Clamp(this.nightThreat / 100, 0, 1);
    this.setTextIfChanged(this.dangerText, this.dangerMessage);

    if (this.mode === 'sailing') {
      const sailingDirection = this.sailSpeed > 0 ? '前进' : this.sailSpeed < 0 ? '后退' : '停止';
      this.setTextIfChanged(this.statusText, atSailBoundary
        ? `已抵达航区边界　${MAX_SAIL_DISTANCE_M}m`
        : `${sailingDirection}　·　前方鱼点 ${Math.max(0, Math.round(this.nextHotspotX - this.worldX))}m`);
      this.setTextIfChanged(this.hintText, atSailBoundary
        ? '前方海域暂未开放　｜　按住【A】向后返航　｜　可以在此抛竿　｜　按【R】返回港口'
        : nearSpot
          ? `${this.isNight ? '黑市订单海域：' : ''}发现鱼群，按【空格】或点击水面抛竿`
          : '按住 A 后退 · 按住 D 前进　｜　松开即停止　｜　随时按【空格】或点击水面抛竿　｜　R 回餐厅');
    } else if (this.mode === 'fishing') {
      this.setTextIfChanged(this.statusText, '观察鱼群 · 调整鱼饵深度');
      this.setTextIfChanged(this.hintText, 'W / S 控制鱼饵上浮与下潜　｜　鱼会主动靠近　｜　空格收竿取消');
    } else if (this.mode === 'hooked') {
      this.setTextIfChanged(this.statusText, this.fishSecured
        ? '鱼已出水，成功钓获！'
        : this.fishPulling ? '鱼正在猛烈拉扯！' : '鱼暂时力竭，抓紧收线');
      this.setTextIfChanged(this.hintText, this.fishSecured
        ? '正在收获渔获…'
        : this.fishPulling
          ? '松开【空格 / 鼠标】泄力，别让张力爆表'
          : '按住【空格 / 鼠标】收线并消耗鱼体力');
    } else if (this.mode === 'port') {
      this.setTextIfChanged(this.statusText, '潮下食堂营业');
      this.setTextIfChanged(this.hintText, '渔获备菜 → 开门营业 → 收入与口碑结算 → 再次出海');
    } else if (this.mode === 'shipyard') {
      this.setTextIfChanged(this.statusText, '平落港船坞 · 升级改造与维修');
      this.setTextIfChanged(this.hintText, '修复船体耐久，或使用金币强化防撞船体与重型鱼竿');
    }

    const showFishingHud = this.mode === 'fishing' || (this.mode === 'hooked' && !this.fishSecured);
    this.depthText.setVisible(showFishingHud);
    this.depthText.setPosition(VIEW_W / 2, 628);
    this.setTextIfChanged(this.depthText, `⌄  深度 ${Math.max(0, Math.round(((this.mode === 'hooked' && this.hookedFish)
      ? this.hookedFish.sprite.y - FISHING_SURFACE_Y
      : this.lureDepth) / 18))} m`);

    const showMeters = this.mode === 'hooked' && !this.fishSecured;
    this.tensionLabel.setVisible(showMeters);
    this.meterBg.setVisible(showMeters);
    this.meterFill.setVisible(showMeters);
    this.staminaLabel.setVisible(showMeters);
    this.staminaBg.setVisible(showMeters);
    this.staminaFill.setVisible(showMeters);
    if (showMeters) {
      this.meterFill.displayWidth = 336 * Phaser.Math.Clamp(this.tension / 100, 0, 1);
      this.meterFill.setFillStyle(this.tension > 78 ? 0xef7b68 : 0x7db58b);
      this.staminaFill.displayWidth = 336 * (this.fishStamina / 100);
    }
    this.drawHintPanel();
  }

  private drawHintPanel() {
    this.hintPanel.clear();
    if (!this.hintText.visible || !this.hintText.text) return;
    const halfWidth = Math.min(280, this.hintText.width / 2 + 28);
    const y = this.hintText.y - this.hintText.height - 8;
    this.hintPanel.lineStyle(1, 0xf2e7eb, 0.42);
    this.hintPanel.lineBetween(this.hintText.x - halfWidth, y, this.hintText.x - 42, y);
    this.hintPanel.lineBetween(this.hintText.x + 42, y, this.hintText.x + halfWidth, y);
    this.hintPanel.fillStyle(0xe8dce3, 0.5).fillCircle(this.hintText.x - halfWidth, y, 1.5);
    this.hintPanel.fillStyle(0xe8dce3, 0.5).fillCircle(this.hintText.x + halfWidth, y, 1.5);
  }

  private setTextIfChanged(target: Phaser.GameObjects.Text, value: string) {
    if (target.text !== value) target.setText(value);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#86c8d4',
  scene: [FishingDemoScene],
  render: {
    antialias: true,
    pixelArt: false,
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    min: 30,
    smoothStep: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  plugins: {
    scene: [
      {
        key: 'rexUI',
        plugin: RexUIPlugin,
        mapping: 'rexUI',
      },
    ],
  },
};

async function startGame() {
  await document.fonts.ready;
  createRestaurantLightEditor();
  customAssetUrls = await loadSceneAssetUrls(
    SAVED_SCENE_LAYOUT.copies.flatMap((layer) => layer.assetId ? [layer.assetId] : []),
  );
  new Phaser.Game(config);
}

void startGame();
