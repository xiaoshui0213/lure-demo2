import Phaser from 'phaser';
import type GridSizer from 'phaser3-rex-plugins/templates/ui/gridsizer/GridSizer';
import type Label from 'phaser3-rex-plugins/templates/ui/label/Label';
import { WarmLightPipeline, type WarmLight } from './warmLightPipeline';
import {
  RESTAURANT_LIGHT_SETTINGS_EVENT,
  loadRestaurantLightSettings,
  type RestaurantLightSettings,
} from './restaurantLightSettings';

/**
 * 完全重构：仿《潜水员戴夫》前三个晚上的餐厅玩法（Bancho Sushi 教学阶段）。
 * 单文件封装三段体验：营业前选菜单 → 侧视场景内跑动上菜 → 打烊结算。
 * 玩家立绘、客人立绘均为几何占位；鱼先配置为菜单份数，客人下单后后厨再制作。
 */

// ---------- 对外类型 ----------

export type RestaurantFishSource = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  dishName?: string;
  portionsPerUnit?: number;
  fixedDishPrice?: number;
  isPantry?: boolean;
};

export type RestaurantStartParams = {
  fishSources: RestaurantFishSource[];
  reputation: number;
};

export type RestaurantServiceResult = {
  served: number;
  lost: number;
  income: number;
  tips: number;
  reputationDelta: number;
  consumed: Record<string, number>;
};

export type RestaurantServiceOptions = {
  viewW: number;
  viewH: number;
  depth: number;
  backgroundKey: string;
  fontFamily: string;
  onFinish: (result: RestaurantServiceResult) => void;
  onOpenRequested: () => void;
  onManageRequested: () => void;
  onLeaveRequested: () => void;
};

type AdjustableBloom = {
  strength: number;
  blurStrength: number;
  color?: number;
};

function parseLightColor(value: string, fallback: number) {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------- UI 色 ----------

// 参考图 UI：压暗场景后，以暖粉米白和更清晰的细金线拉开前后层级。
const COLOR_TITLE = '#fff0e7';
const COLOR_BODY = '#ead8d2';
const COLOR_MUTED = '#c9b6b3';
const COLOR_ACCENT = '#e4b9a8';
const COLOR_WARN = '#eeaa9c';
const COLOR_GREEN = '#aab69a';
const UI_PANEL = 0x181214;
const UI_PANEL_ALT = 0x24191c;
const UI_BORDER = 0xd2ad9b;
const UI_PRIMARY = 0x9f8172;
const UI_PRIMARY_TEXT = '#edcfb6';
const SHIFT_TIMER_BAR_WIDTH = 108;
const SHIFT_CARD_COLORS = [0xe7bfa7, 0xb5c7d5, 0xd49aae];
const SHIFT_CARD_TEXT = '#604c55';
const SHIFT_CARD_MUTED = '#806b73';
const SETTLEMENT_GLASS = 0xb8c0b5;
const SETTLEMENT_GLASS_ALT = 0xd5d6cd;
const SETTLEMENT_BORDER = 0xeee7db;

// ---------- 场景配色（严格按 Forgotten Anne 参考图取色） ----------
// 参考图色板：暖赤陶 / 焦糖木 / 暖沙墙 / 暖蜜橙高光 / 桃金灯光。
// 低饱和度、褪色感、暖色统一，不要蓝灰或近黑。

// 夜空/顶部（暖沉不再冷蓝）
const BG_NIGHT_TOP = 0x1c1208;
const BG_NIGHT_MID = 0x2a1810;
const BG_NIGHT_BOTTOM = 0x2a1a10;
// 后墙暖沙色（比原来的冷暗棕大幅提亮）
const WALL_TONE = 0x8a5a3a;
// 货架 / 主体木材：暖赤陶
const SHELF_WOOD = 0xa04628;
// 吧台面：焦糖木橘
const BAR_TOP = 0xb85832;
// 吧台正面：暖砖橘（比台面深一档）
const BAR_FRONT = 0x8a4020;
// 吧台前沿高光：暖蜜橙
const BAR_HIGHLIGHT = 0xe8a06a;
// 吊灯光晕：柔桃金
const LANTERN_GLOW = 0xf4b878;
// 吊灯核心：暖奶白（不要纯白，避免 HDR 爆点）
const LANTERN_CORE = 0xe8c890;
// 地板：深暖棕（绝不要近黑）
const FLOOR_TONE = 0x3a2418;
// 主结构木（横梁 / 立柱 / 后厨台面）
const STRUCTURE_WOOD = 0x5a3018;
const STRUCTURE_WOOD_HI = 0x7a4020;
const STRUCTURE_WOOD_LO = 0x3a2010;

const CHEF_SKIN = 0xe4c39c;
const CHEF_UNIFORM = 0xf5efe4;
const CHEF_HAT = 0xffffff;
const CHEF_APRON = 0xb98a52;
const CHEF_EYE = 0x1a1a1a;

const DISH_PALETTE = [0xd98b4a, 0x6f9bb5, 0xd0748e, 0x7fb08a, 0xb885d0, 0xd6a65f, 0x8ec4b6, 0xd0664a];

const CUSTOMER_TEMPLATES: {
  body: number;
  hair: number;
  skin: number;
  name: string;
}[] = [
  { body: 0x9a3f36, hair: 0x2e1a13, skin: 0xdcb28a, name: '码头搬运工' },
  { body: 0x3d5f82, hair: 0x1e2735, skin: 0xd8a982, name: '夜航水手' },
  { body: 0x6d8a5a, hair: 0x3a3624, skin: 0xd8b58a, name: '灯塔守' },
  { body: 0x9a7a4a, hair: 0x442e1c, skin: 0xd6a17a, name: '邮差' },
  { body: 0x7d5589, hair: 0x2a1e2c, skin: 0xd6ab86, name: '旅行画家' },
  { body: 0x5a7c86, hair: 0x1c2a2f, skin: 0xd8b98e, name: '制网匠' },
];

// ---------- 布局与节奏 ----------

// 新背景按 1280×720 铺满后，吧台高光线位于约 y=438。
const BAR_TOP_Y = 438;
const BAR_FRONT_Y = 500;
const CHEF_Y = 398;
// 对齐新背景的椅面：角色身体底部约为 rootY + 29，椅面顶部约 y=529。
const CUSTOMER_Y = 500;
const BUBBLE_Y_OFFSET = -74;
const STATION_XS = [400, 640, 880];
// 新背景共有 6 张椅子，坐标由 1024×576 原图等比换算到 1280×720。
const SEAT_XS = [240, 400, 590, 785, 950, 1140];
const DOOR_X = 1240;
const CHEF_X_MIN = 120;
const CHEF_X_MAX = 1160;
const INTERACT_RANGE = 72;

const SHIFT_MIN_S = 45;
const SHIFT_PER_PORTION_S = 8;
const SHIFT_MAX_S = 150;
const CUSTOMER_SPAWN_MIN_S = 5;
const CUSTOMER_SPAWN_MAX_S = 10;
const CUSTOMER_PATIENCE_S = 26;
const CUSTOMER_EATING_S = 4.0;
const PATIENCE_WORRIED = 0.55;
const PATIENCE_ANGRY = 0.28;
const TEA_POUR_RATE = 0.48;
const TEA_PRICE = 4;
const CUSTOMER_WALK_SPEED = 200;
const CHEF_SPEED = 260;
const STATION_MATERIALIZE_S = 1.4;
// 一条鱼可以切成 N 份寿司 / 刺身，份数最终会向上取整回鱼数。
const YIELD_PER_FISH = 3;
const SERVE_REACTIONS = ['流口水了……!', '好吃!', '美味!!', '顶级手艺!', '真香!', '还想再来一份!', '这刀工绝了!'];

// ---------- 内部类型 ----------

type Phase = 'idle' | 'lobby' | 'menu' | 'shift' | 'settlement';

type DishConfig = {
  fishId: string;
  fishName: string;
  dishName: string;
  color: number;
  price: number;
  selectedFishCount: number;
  totalPortions: number;
  remainingPortions: number;
  isPantry: boolean;
};

type StationPlate = {
  slotIndex: number;
  x: number;
  root: Phaser.GameObjects.Container;
  plateBase: Phaser.GameObjects.Arc;
  riceBase: Phaser.GameObjects.Rectangle;
  dishDot: Phaser.GameObjects.Arc;
  emptyMark: Phaser.GameObjects.Text;
  labelText: Phaser.GameObjects.Text;
  countText: Phaser.GameObjects.Text;
  prepRing: Phaser.GameObjects.Graphics;
  prepLabel: Phaser.GameObjects.Text;
  ready: boolean;
  pendingOrders: number;
  materializeTimer: number;
  materializeDuration: number;
};

type MenuBadge = {
  root: Phaser.GameObjects.Container;
  labelText: Phaser.GameObjects.Text;
  countText: Phaser.GameObjects.Text;
  dishDot: Phaser.GameObjects.Arc;
};

type CustomerState = 'entering' | 'seated' | 'eating' | 'leaving';
type CustomerRequest = 'tea' | 'dish';

type Customer = {
  root: Phaser.GameObjects.Container;
  templateIndex: number;
  displayName: string;
  seatIndex: number;
  seatX: number;
  state: CustomerState;
  facing: 1 | -1;
  wantSlotIndex: number;
  request: CustomerRequest;
  teaRequested: boolean;
  teaServed: boolean;
  patience: number;
  eatingTimer: number;
  eatingDuration: number;
  bubble: Phaser.GameObjects.Container;
  bubbleFrame: Phaser.GameObjects.Rectangle;
  bubbleFill: Phaser.GameObjects.Rectangle;
  bubbleIcon: Phaser.GameObjects.Arc;
  bubbleGlyph: Phaser.GameObjects.Text;
  bubbleTail: Phaser.GameObjects.Triangle;
  emote: Phaser.GameObjects.Text;
  bodyRoot: Phaser.GameObjects.Container;
  eatingPlate: Phaser.GameObjects.Container;
  eatingRice: Phaser.GameObjects.Rectangle;
  eatingTopper: Phaser.GameObjects.Arc;
  paidAmount: number;
  servedDishColor: number;
  paidBurstFired: boolean;
  shakePhase: number;
};

type DirtyPlate = {
  seatIndex: number;
  x: number;
  root: Phaser.GameObjects.Container;
  progressGraphics: Phaser.GameObjects.Graphics;
  progressLabel: Phaser.GameObjects.Text;
  cleanProgress: number;
  expectedButton: 'left' | 'right';
  lastInputAt: number;
  dishColor: number;
};

type ChefState = {
  root: Phaser.GameObjects.Container;
  x: number;
  facing: 1 | -1;
  heldSlotIndex: number;
  heldRoot: Phaser.GameObjects.Container;
  heldDot: Phaser.GameObjects.Arc;
};

type MenuSourceRow = {
  index: number;
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Rectangle;
  countText: Phaser.GameObjects.Text;
};

type MenuSlotView = {
  index: number;
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Rectangle;
  dot: Phaser.GameObjects.Arc;
  plusText: Phaser.GameObjects.Text;
  titleText: Phaser.GameObjects.Text;
  detailText: Phaser.GameObjects.Text;
  removeHint: Phaser.GameObjects.Text;
};

// ---------- 主类 ----------

export class RestaurantService {
  constructor(private scene: Phaser.Scene, private options: RestaurantServiceOptions) {}

  private phase: Phase = 'idle';
  private layer!: Phaser.GameObjects.Container;

  // 三段的独立容器
  private shiftLayer!: Phaser.GameObjects.Container;
  private shiftHudLayer!: Phaser.GameObjects.Container;
  private lobbyLayer!: Phaser.GameObjects.Container;
  private menuLayer!: Phaser.GameObjects.Container;
  private settlementLayer!: Phaser.GameObjects.Container;
  private lobbyMessageText!: Phaser.GameObjects.Text;

  // 键位
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keysReady = false;

  // 菜单阶段状态
  private sourceList: RestaurantFishSource[] = [];
  private draftDishes: (DishConfig | null)[] = [null, null, null];
  private startingReputation = 0;
  private menuSourceRows: MenuSourceRow[] = [];
  private menuSlotViews: MenuSlotView[] = [];
  private menuHintText!: Phaser.GameObjects.Text;
  private menuConfirmButton!: Phaser.GameObjects.Container;
  private menuConfirmLabel!: Phaser.GameObjects.Text;

  // 营业阶段状态
  private dishes: DishConfig[] = [];
  private stationPlates: StationPlate[] = [];
  private menuBadges: MenuBadge[] = [];
  private customers: Customer[] = [];
  private chef!: ChefState;
  private shiftDuration = SHIFT_MIN_S;
  private shiftRemaining = SHIFT_MIN_S;
  private spawnTimer = 3;
  private guestsRemaining = 0;
  private finished = false;
  private closing = false;
  private closingReason = '';
  private closingHintShown = false;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer = 0;
  private timerFill!: Phaser.GameObjects.Rectangle;
  private timerLabel!: Phaser.GameObjects.Text;
  private timerTrack!: Phaser.GameObjects.Rectangle;
  private statsText!: Phaser.GameObjects.Text;
  private coinsText!: Phaser.GameObjects.Text;
  private interactPrompt!: Phaser.GameObjects.Container;
  private interactPromptText!: Phaser.GameObjects.Text;
  private closeEarlyButton!: Phaser.GameObjects.Container;
  private consumedByFish: Record<string, number> = {};
  private served = 0;
  private lost = 0;
  private income = 0;
  private teaRevenue = 0;
  private tips = 0;
  private reputationDelta = 0;
  private satisfactionSum = 0;
  private satisfactionCount = 0;

  // 脏盘 & 销售统计
  private dirtyPlates: DirtyPlate[] = [];
  private soldByDish: number[] = [];

  // 鼠标：营业时左键 = 常规交互；脏盘使用左右键交替 QTE。
  private mouseJustClicked = false;
  private mouseLeftHeld = false;

  // 绿茶长按 S：液面进入目标区时松开。
  private teaQteLayer!: Phaser.GameObjects.Container;
  private teaCupFill!: Phaser.GameObjects.Rectangle;
  private teaTargetBand!: Phaser.GameObjects.Rectangle;
  private teaQteLabel!: Phaser.GameObjects.Text;
  private activeTeaCustomer: Customer | null = null;
  private teaFill = 0;
  private teaTargetMin = 0.68;
  private teaTargetMax = 0.84;

  // 结算 UI 引用
  private settlementStarText!: Phaser.GameObjects.Text;
  private settlementRatingValue!: Phaser.GameObjects.Text;
  private settlementAfterglowIcon!: Phaser.GameObjects.Text;
  private settlementAfterglowDesc!: Phaser.GameObjects.Text;
  private settlementBestName!: Phaser.GameObjects.Text;
  private settlementBestDot!: Phaser.GameObjects.Arc;
  private settlementBestStats!: Phaser.GameObjects.Text;
  private settlementBestRevenue!: Phaser.GameObjects.Text;
  private settlementDayLabel!: Phaser.GameObjects.Text;
  private settlementBar!: Phaser.GameObjects.Rectangle;
  private settlementBarBaselineY = 0;
  private settlementBarMaxHeight = 0;
  private settlementRowValues: Record<string, Phaser.GameObjects.Text> = {};
  private settlementProfitText!: Phaser.GameObjects.Text;
  private settlementReasonText!: Phaser.GameObjects.Text;
  private settlementTweens: Phaser.Tweens.Tween[] = [];
  private lastResult: RestaurantServiceResult | null = null;
  private pipelineViewW = 0;
  private pipelineViewH = 0;
  private pipelineAttached = false;
  private warmLightPipeline?: WarmLightPipeline;
  private lightSettings = loadRestaurantLightSettings();
  private pendantBloom?: AdjustableBloom;
  private doorBloom?: AdjustableBloom;
  private neonBloom?: AdjustableBloom;
  private readonly handleLightSettingsChange = (event: Event) => {
    const detail = (event as CustomEvent<RestaurantLightSettings>).detail;
    if (!detail) return;
    this.lightSettings = { ...detail };
    this.applyLightSettings();
  };

  get isActive() {
    return this.phase !== 'idle';
  }

  get isLobby() {
    return this.phase === 'lobby';
  }

  create() {
    const { viewW, viewH, depth } = this.options;
    this.layer = this.scene.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(depth)
      .setVisible(false);

    this.shiftLayer = this.scene.add.container(0, 0).setVisible(false);
    this.lobbyLayer = this.scene.add.container(0, 0).setVisible(false);
    this.menuLayer = this.scene.add.container(0, 0).setVisible(false);
    this.settlementLayer = this.scene.add.container(0, 0).setVisible(false);
    this.layer.add([this.shiftLayer, this.lobbyLayer, this.menuLayer, this.settlementLayer]);

    this.buildShiftBackground(viewW, viewH);
    this.buildChef();
    this.buildStations();
    this.shiftHudLayer = this.scene.add.container(0, 0);
    this.shiftLayer.add(this.shiftHudLayer);
    this.buildShiftHud(viewW);
    this.buildTeaQte(viewW, viewH);
    this.buildLobbyScreen(viewW, viewH);

    this.buildMenuScreen(viewW, viewH);
    this.buildSettlementScreen(viewW, viewH);

    // ★ GLSL 光照管线：只在真正进入营业阶段时才挂到 shiftLayer 上。
    // 之前在 create() 里立刻挂，会导致钓鱼场景（此时 shiftLayer 不可见但已经在场景里）
    // 的整块画面被 Post pipeline 涂白，鱼竿等元素完全看不见。
    // 缓存视口尺寸，等 startShift() 再真正挂管线。
    this.pipelineViewW = viewW;
    this.pipelineViewH = viewH;
    window.addEventListener(RESTAURANT_LIGHT_SETTINGS_EVENT, this.handleLightSettingsChange);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener(RESTAURANT_LIGHT_SETTINGS_EVENT, this.handleLightSettingsChange);
    });

    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      this.keyA = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyD = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keyS = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keySpace = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.keysReady = true;
    }

    this.scene.input.mouse?.disableContextMenu();
    // 普通状态左键 = 空格；靠近脏盘时改为左右键交替清理 QTE；倒茶阶段左键与空格同效为"按住"。
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
      if (this.phase !== 'shift') return;
      if (gameObjects.length > 0) return;
      if (pointer.y < 190 || pointer.y > 640) return;
      if (pointer.leftButtonDown()) this.mouseLeftHeld = true;
      const dirty = this.chef?.heldSlotIndex < 0 ? this.findNearestDirtyInRange() : null;
      if (dirty && !this.activeTeaCustomer) {
        if (pointer.leftButtonDown()) this.registerCleaningTap(dirty, 'left');
        else if (pointer.rightButtonDown()) this.registerCleaningTap(dirty, 'right');
        return;
      }
      if (pointer.leftButtonDown()) this.mouseJustClicked = true;
    });
    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) this.mouseLeftHeld = false;
    });
  }

  private buildLobbyScreen(viewW: number, viewH: number) {
    const shade = this.scene.add.rectangle(viewW / 2, 52, viewW, 104, UI_PANEL, 0.72);
    const title = this.text(34, 20, '潮下食堂', 26, COLOR_TITLE).setLetterSpacing(2);
    const subtitle = this.text(36, 56, 'CHAOXIA DINER  ·  营业准备', 12, COLOR_MUTED).setLetterSpacing(1.5);
    this.lobbyMessageText = this.text(viewW / 2, viewH - 108, '', 16, COLOR_ACCENT)
      .setOrigin(0.5)
      .setWordWrapWidth(760);

    const startButton = this.createTextButton(
      viewW - 170,
      48,
      260,
      52,
      '开始营业  ›',
      () => this.options.onOpenRequested(),
      true,
    );
    const manageButton = this.createTextButton(
      viewW / 2 - 150,
      viewH - 50,
      230,
      44,
      '经营管理',
      () => this.options.onManageRequested(),
    );
    const leaveButton = this.createTextButton(
      viewW / 2 + 150,
      viewH - 50,
      230,
      44,
      '返回湖面',
      () => this.options.onLeaveRequested(),
    );
    this.lobbyLayer.add([
      shade,
      title,
      subtitle,
      this.lobbyMessageText,
      startButton,
      manageButton,
      leaveButton,
    ]);
  }

  /** 展示静态餐厅待机场景；此阶段绝不生成菜单、料理或客人。 */
  showLobby(message = '') {
    this.phase = 'lobby';
    this.layer.setVisible(true);
    this.shiftLayer.setVisible(true);
    this.shiftHudLayer.setVisible(false);
    this.lobbyLayer.setVisible(true);
    this.menuLayer.setVisible(false);
    this.settlementLayer.setVisible(false);
    this.teaQteLayer.setVisible(false);
    this.interactPrompt.setVisible(false);
    this.customers.forEach((customer) => customer.root.destroy());
    this.customers = [];
    this.dirtyPlates.forEach((plate) => plate.root.destroy());
    this.dirtyPlates = [];
    this.stationPlates.forEach((station) => station.root.setVisible(false));
    this.chef.root.setVisible(true).setPosition(640, CHEF_Y);
    this.chef.heldRoot.setVisible(false);
    this.lobbyMessageText.setText(message);
    this.attachWarmLightPipeline();
  }

  start(params: RestaurantStartParams) {
    this.phase = 'menu';
    this.startingReputation = params.reputation;
    // 只保留有库存的鱼；配色按 sourceList 里的索引取色。
    this.sourceList = params.fishSources.filter((entry) => entry.quantity > 0).slice(0, 6);
    this.draftDishes = [null, null, null];
    this.consumedByFish = {};
    this.served = 0;
    this.lost = 0;
    this.income = 0;
    this.teaRevenue = 0;
    this.tips = 0;
    this.reputationDelta = 0;
    this.satisfactionSum = 0;
    this.satisfactionCount = 0;
    this.finished = false;
    this.closing = false;
    this.closingReason = '';
    this.closingHintShown = false;
    this.customers = [];
    this.activeTeaCustomer = null;
    this.teaQteLayer.setVisible(false);
    this.lastResult = null;

    this.detachWarmLightPipeline();
    this.layer.setVisible(true);
    this.shiftLayer.setVisible(true);
    this.shiftHudLayer.setVisible(false);
    this.lobbyLayer.setVisible(false);
    this.settlementLayer.setVisible(false);
    this.showMenu();
  }

  update(dt: number) {
    if (this.phase === 'shift') this.updateShift(dt);
  }

  hide() {
    this.phase = 'idle';
    this.layer.setVisible(false);
    this.lobbyLayer.setVisible(false);
    this.menuLayer.setVisible(false);
    this.shiftLayer.setVisible(false);
    this.settlementLayer.setVisible(false);
    this.detachWarmLightPipeline();
  }

  // ==============================================================
  // 菜单阶段
  // ==============================================================

  private showMenu() {
    this.menuLayer.setVisible(true);
    this.shiftLayer.setVisible(true);
    this.shiftHudLayer.setVisible(false);
    this.settlementLayer.setVisible(false);
    this.refreshMenuUI();
  }

  private buildMenuScreen(viewW: number, viewH: number) {
    // 只压暗当前餐厅背景，不替换背景画面。
    const bg = this.scene.add.rectangle(viewW / 2, viewH / 2, viewW, viewH, 0x100d14, 0.7);
    this.menuLayer.add(bg);

    const modalX = 80;
    const modalW = viewW - 160;
    const title = this.text(viewW / 2, 56, '❧  今晚的菜单  ❧', 29, '#eee4d7').setOrigin(0.5).setLetterSpacing(2);
    const subtitle = this.text(
      viewW / 2,
      92,
      `从鱼篓里挑最多 3 道招牌菜 —— 每条鱼可制作 ${YIELD_PER_FISH} 份料理`,
      13,
      '#c8bcaf',
    ).setOrigin(0.5);
    this.menuLayer.add([title, subtitle]);

    // 左：食材鱼篓
    const leftX = modalX + 30;
    const leftY = 140;
    const leftW = 520;
    const leftHeader = this.text(leftX + 10, leftY, '食材鱼篓', 19, '#ddd0c2').setLetterSpacing(1);
    this.menuLayer.add(leftHeader);
    const leftDivider = this.scene.add.graphics();
    leftDivider.lineStyle(1, 0xe1d4c5, 0.28).lineBetween(leftX + 112, leftY + 13, leftX + leftW, leftY + 13);
    this.menuLayer.add(leftDivider);

    for (let i = 0; i < 6; i += 1) this.menuSourceRows.push(this.createSourceRowShell(leftX, leftY + 38 + i * 68, leftW, i));

    // 右：今晚菜单 3 槽
    const rightX = viewW - modalX - 30 - 520;
    const rightY = 140;
    const rightW = 520;
    const rightHeader = this.text(rightX + 10, rightY, '今晚菜单', 19, '#ddd0c2').setLetterSpacing(1);
    this.menuLayer.add(rightHeader);
    const rightDivider = this.scene.add.graphics();
    rightDivider.lineStyle(1, 0xe1d4c5, 0.28).lineBetween(rightX + 112, rightY + 13, rightX + rightW, rightY + 13);
    this.menuLayer.add(rightDivider);

    for (let i = 0; i < 3; i += 1) this.menuSlotViews.push(this.createSlotShell(rightX, rightY + 38 + i * 96, rightW, i));

    this.menuHintText = this.text(viewW / 2, viewH - 118, '', 16, '#d3c5b7').setOrigin(0.5);
    this.menuLayer.add(this.menuHintText);

    const cancelBtn = this.createMenuButton(viewW / 2 - 190, viewH - 72, 240, 48, '←    返回港口', () => this.cancelMenu());
    this.menuLayer.add(cancelBtn);

    this.menuConfirmButton = this.createMenuButton(viewW / 2 + 190, viewH - 72, 300, 48, '确认开门营业    →', () => this.confirmMenu(), true);
    this.menuConfirmLabel = this.menuConfirmButton.getAt(1) as Phaser.GameObjects.Text;
    this.menuLayer.add(this.menuConfirmButton);
  }

  private createSourceRowShell(x: number, y: number, w: number, index: number): MenuSourceRow {
    const bg = this.scene.add.graphics();
    const hit = this.scene.add.rectangle(0, 0, w, 64, 0x000000, 0).setOrigin(0);
    hit.setInteractive({ useHandCursor: true });
    const countText = this.text(w - 22, 32, '', 15, COLOR_MUTED).setOrigin(1, 0.5);
    const root = this.scene.add.container(x, y, [bg, hit, countText]);
    hit.on('pointerdown', () => this.addDishFromSource(index));
    root.setVisible(false);
    this.menuLayer.add(root);
    return { index, root, bg, hit, countText };
  }

  private createSlotShell(x: number, y: number, w: number, index: number): MenuSlotView {
    const bg = this.scene.add.graphics();
    const hit = this.scene.add.rectangle(0, 0, w, 86, 0x000000, 0).setOrigin(0);
    hit.setInteractive({ useHandCursor: true });
    const dot = this.scene.add.arc(56, 43, 26, 0, 360, false, 0x2a2f36).setAlpha(0);
    const plusText = this.text(56, 42, '+', 24, '#f4e4da').setOrigin(0.5).setAlpha(0.78);
    const titleText = this.text(100, 20, '空槽位', 22, '#ddcbc7');
    const detailText = this.text(100, 52, '点击左侧食材加入今晚菜单', 16, '#c5b2b1');
    const removeHint = this.text(w - 22, 43, '', 15, COLOR_WARN).setOrigin(1, 0.5);
    const root = this.scene.add.container(x, y, [bg, hit, dot, plusText, titleText, detailText, removeHint]);
    hit.on('pointerdown', () => this.removeDishSlot(index));
    this.menuLayer.add(root);
    return { index, root, bg, hit, dot, plusText, titleText, detailText, removeHint };
  }

  private refreshMenuUI() {
    // 食材列
    for (const row of this.menuSourceRows) {
      const source = this.sourceList[row.index];
      row.bg.clear();
      if (!source) {
        row.root.setVisible(false);
        row.hit.disableInteractive();
        continue;
      }
      row.root.setVisible(true);
      row.hit.setInteractive({ useHandCursor: true });
      const alreadyUsed = this.draftDishes.some((d) => d?.fishId === source.id);
      const w = 520;
      row.bg
        .fillStyle(0x75636a, alreadyUsed ? 0.25 : 0.46)
        .fillRoundedRect(0, 0, w, 64, 10)
        .lineStyle(1.2, 0xf2dfd4, alreadyUsed ? 0.28 : 0.58)
        .strokeRoundedRect(0, 0, w, 64, 10);
      const dishColor = DISH_PALETTE[row.index % DISH_PALETTE.length];
      row.bg
        .fillStyle(dishColor, alreadyUsed ? 0.4 : 0.95)
        .fillCircle(36, 32, 20)
        .lineStyle(1.5, 0xffffff, 0.6)
        .strokeCircle(36, 32, 20);
      const price = this.dishPriceForSource(source);
      const nameText = row.root.getData('nameText') as Phaser.GameObjects.Text | undefined
        ?? this.text(70, 12, '', 19, COLOR_TITLE);
      const detailText = row.root.getData('detailText') as Phaser.GameObjects.Text | undefined
        ?? this.text(70, 38, '', 15, COLOR_MUTED);
      if (!row.root.getData('nameText')) {
        row.root.add([nameText, detailText]);
        row.root.setData('nameText', nameText);
        row.root.setData('detailText', detailText);
      }
      const selected = this.draftDishes.find((d) => d?.fishId === source.id);
      const portionsPerUnit = source.portionsPerUnit ?? YIELD_PER_FISH;
      nameText.setText(source.dishName ?? source.name).setColor(COLOR_TITLE);
      detailText.setText(source.isPantry
        ? `厨房常备 · ${source.quantity * portionsPerUnit} 份可售 · 每份 ${price} 金`
        : `鱼篓 ${source.quantity} 条 · 每条切 ${portionsPerUnit} 份 · 每份 ${price} 金`);
      row.countText
        .setText(selected
          ? selected.selectedFishCount < source.quantity
            ? source.isPantry
              ? `已备 ${selected.totalPortions} 份 · 再加一批 →`
              : `已放 ${selected.selectedFishCount} 条 · 再加 1 条 →`
            : source.isPantry
              ? `已备满 ${selected.totalPortions} 份`
              : `已放满 ${selected.selectedFishCount} 条`
          : source.isPantry ? '点击备一批 →' : '点击加入 1 条 →')
        .setColor(selected ? COLOR_ACCENT : COLOR_MUTED);
    }

    // 菜单槽
    for (const view of this.menuSlotViews) {
      const draft = this.draftDishes[view.index];
      const w = 520;
      view.bg.clear();
      view.bg
        .fillStyle(0x75636a, draft ? 0.46 : 0.3)
        .fillRoundedRect(0, 0, w, 86, 10)
        .lineStyle(1.2, 0xf2dfd4, draft ? 0.62 : 0.42)
        .strokeRoundedRect(0, 0, w, 86, 10);
      if (draft) {
        view.dot.setAlpha(1).setFillStyle(draft.color);
        view.plusText.setVisible(false);
        view.titleText.setText(draft.dishName).setColor(COLOR_TITLE).setFontSize('24px');
        view.detailText
          .setText(draft.isPantry
            ? `厨房常备 ${draft.totalPortions} 份 · 每份 ${draft.price} 金`
            : `${draft.selectedFishCount} 条鱼 → ${draft.totalPortions} 份 · 每份 ${draft.price} 金`)
          .setColor(COLOR_BODY);
        view.detailText.setFontSize('16px');
        view.removeHint.setText('× 移出');
        view.hit.setInteractive({ useHandCursor: true });
      } else {
        view.dot.setAlpha(0.38).setFillStyle(0x8d857e).setStrokeStyle(1, 0xe3d6c7, 0.45);
        view.plusText.setVisible(true);
        view.titleText.setText(`空槽位 ${view.index + 1}`).setColor('#ddcbc7').setFontSize('22px');
        view.detailText.setText('点击左侧食材加入今晚菜单').setColor('#c5b2b1');
        view.detailText.setFontSize('16px');
        view.removeHint.setText('');
        view.hit.disableInteractive();
      }
    }

    const filled = this.draftDishes.filter((d) => d !== null).length;
    if (filled === 0) {
      this.menuHintText.setText('至少选 1 道菜才能开门。').setColor(COLOR_WARN);
    } else {
      this.menuHintText.setText(`已选 ${filled} 道菜。营业时长与客流会随份数动态调整。`).setColor(COLOR_MUTED);
    }
    const enabled = filled > 0;
    this.menuConfirmButton.setAlpha(enabled ? 1 : 0.72);
    this.menuConfirmLabel.setText(enabled ? '确认开门营业    →' : '还没选菜');
  }

  private dishPriceForSource(source: RestaurantFishSource) {
    if (source.fixedDishPrice !== undefined) return source.fixedDishPrice;
    // 一条鱼分成 YIELD_PER_FISH 份寿司，单份价格约为原鱼价的 0.85 倍（下限 15 金）。
    return Math.max(15, Math.round(source.unitPrice * 0.85));
  }

  private addDishFromSource(sourceIndex: number) {
    if (this.phase !== 'menu') return;
    const source = this.sourceList[sourceIndex];
    if (!source) return;
    const existing = this.draftDishes.find((d) => d?.fishId === source.id);
    if (existing) {
      if (existing.selectedFishCount >= source.quantity) {
        this.menuHintText.setText(`${source.name}已经全部放进今晚菜单。`).setColor(COLOR_WARN);
        return;
      }
      existing.selectedFishCount += 1;
      existing.totalPortions = existing.selectedFishCount * (source.portionsPerUnit ?? YIELD_PER_FISH);
      existing.remainingPortions = existing.totalPortions;
      this.refreshMenuUI();
      return;
    }
    const slot = this.draftDishes.findIndex((d) => d === null);
    if (slot < 0) {
      this.menuHintText.setText('三个菜单槽已满，先移出一道再换。').setColor(COLOR_WARN);
      return;
    }
    const color = DISH_PALETTE[sourceIndex % DISH_PALETTE.length];
    const portions = source.portionsPerUnit ?? YIELD_PER_FISH;
    this.draftDishes[slot] = {
      fishId: source.id,
      fishName: source.name,
      dishName: source.dishName ?? `${source.name}寿司`,
      color,
      price: this.dishPriceForSource(source),
      selectedFishCount: 1,
      totalPortions: portions,
      remainingPortions: portions,
      isPantry: source.isPantry ?? false,
    };
    this.refreshMenuUI();
  }

  private removeDishSlot(slotIndex: number) {
    if (this.phase !== 'menu') return;
    if (!this.draftDishes[slotIndex]) return;
    this.draftDishes[slotIndex] = null;
    this.refreshMenuUI();
  }

  private confirmMenu() {
    if (this.phase !== 'menu') return;
    const filled = this.draftDishes.filter((d): d is DishConfig => d !== null);
    if (filled.length === 0) return;
    this.dishes = filled;
    this.startShift();
  }

  private cancelMenu() {
    if (this.phase !== 'menu') return;
    this.showLobby('已取消本次开门，餐厅继续保持准备状态。');
  }

  // ==============================================================
  // 营业阶段：布景
  // ==============================================================

  private buildShiftBackground(viewW: number, viewH: number) {
    const background = this.scene.add
      .image(viewW / 2, viewH / 2, this.options.backgroundKey)
      .setDisplaySize(viewW, viewH);
    this.shiftLayer.add(background);
  }

  private buildBarAndKitchen(viewW: number) {
    const g = this.scene.add.graphics();

    // ==== 顶部木架结构 ====
    // 主横梁
    g.fillStyle(STRUCTURE_WOOD, 1).fillRect(0, 52, viewW, 30);
    g.fillStyle(STRUCTURE_WOOD_HI, 1).fillRect(0, 52, viewW, 5);
    g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(0, 78, viewW, 4);
    // 立柱
    const postXs = [40, 340, 640, 940, 1240];
    for (const px of postXs) {
      g.fillStyle(STRUCTURE_WOOD, 1).fillRect(px - 11, 60, 22, 260);
      g.fillStyle(STRUCTURE_WOOD_HI, 1).fillRect(px - 11, 60, 5, 260);
      g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(px + 6, 60, 5, 260);
    }
    // 立柱底部与吧台接合处的加固块
    for (const px of postXs) {
      g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(px - 14, 316, 28, 8);
    }

    // ==== 吊灯挂线（非发光部分，画到 g）====
    g.lineStyle(1, STRUCTURE_WOOD_LO, 0.9).lineBetween(0, 92, viewW, 92);
    for (let i = 0; i < 8; i += 1) {
      const cx = 90 + i * 155;
      g.lineStyle(1, STRUCTURE_WOOD_LO, 0.9).lineBetween(cx, 92, cx, 110);
      g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(cx - 5, 108, 10, 5);
    }
    // 吊灯的发光部分放到独立 emissive 图层，见后面的 buildPendantLamps。

    // ==== 从横梁垂下的粉色布幔（装饰） ====
    const drawBanner = (bx: number, bw: number, bh: number, tone: number, highlight: number) => {
      g.fillStyle(tone, 0.92);
      g.beginPath();
      g.moveTo(bx, 82);
      g.lineTo(bx + bw, 82);
      g.lineTo(bx + bw + 4, 82 + bh);
      g.lineTo(bx + bw * 0.62, 82 + bh - 6);
      g.lineTo(bx + bw * 0.38, 82 + bh - 6);
      g.lineTo(bx - 4, 82 + bh);
      g.closePath();
      g.fillPath();
      g.fillStyle(highlight, 0.55).fillRect(bx + 3, 85, bw - 6, 3);
    };
    drawBanner(110, 78, 62, 0xd54c8b, 0xf07dab);
    drawBanner(430, 70, 66, 0xb63878, 0xd85fa1);
    drawBanner(760, 82, 58, 0xd54c8b, 0xf07dab);
    drawBanner(1060, 72, 64, 0xb63878, 0xd85fa1);

    // ==== 后墙酒柜（两层） ====
    const shelfXStart = 120;
    const shelfXEnd = viewW - 120;
    const shelfY1 = 168;
    const shelfY2 = 216;
    // 挡板背景（暖沉色，凸显瓶子）
    g.fillStyle(0x5a3018, 0.85).fillRect(shelfXStart - 6, 148, shelfXEnd - shelfXStart + 12, 84);
    // 木板
    g.fillStyle(SHELF_WOOD, 1).fillRect(shelfXStart, shelfY1, shelfXEnd - shelfXStart, 6);
    g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(shelfXStart, shelfY1 + 6, shelfXEnd - shelfXStart, 3);
    g.fillStyle(SHELF_WOOD, 1).fillRect(shelfXStart, shelfY2, shelfXEnd - shelfXStart, 6);
    g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(shelfXStart, shelfY2 + 6, shelfXEnd - shelfXStart, 3);

    // 瓶子（不同颜色/高矮混合）
    const bottleColors = [0x8b7a5e, 0x5c4a30, 0x6a3b3b, 0x3d5c4a, 0x8a6a3a, 0x4a5c6a, 0x7a3a5c];
    for (let i = 0; i < 26; i += 1) {
      const bx = shelfXStart + 12 + i * 40;
      if (bx > shelfXEnd - 12) break;
      const c1 = bottleColors[i % bottleColors.length];
      const h1 = 20 + (i % 4) * 5;
      g.fillStyle(c1, 0.92).fillRect(bx, shelfY1 - h1, 8, h1);
      g.fillStyle(0x2a1a10, 1).fillRect(bx + 2, shelfY1 - h1 - 4, 4, 4);
      g.fillStyle(0xffffff, 0.15).fillRect(bx + 1, shelfY1 - h1 + 2, 1, h1 - 6);
    }
    for (let i = 0; i < 24; i += 1) {
      const bx = shelfXStart + 28 + i * 42;
      if (bx > shelfXEnd - 12) break;
      const c1 = bottleColors[(i + 3) % bottleColors.length];
      const h1 = 18 + ((i + 1) % 4) * 6;
      g.fillStyle(c1, 0.92).fillRect(bx, shelfY2 - h1, 8, h1);
      g.fillStyle(0x2a1a10, 1).fillRect(bx + 2, shelfY2 - h1 - 4, 4, 4);
      g.fillStyle(0xffffff, 0.12).fillRect(bx + 1, shelfY2 - h1 + 2, 1, h1 - 6);
    }

    // ==== 后厨台面（chef 站在这条台面前） ====
    g.fillStyle(STRUCTURE_WOOD, 1).fillRect(0, 320, viewW, 60);
    g.fillStyle(SHELF_WOOD, 1).fillRect(0, 320, viewW, 8);
    // 后厨台面上的木纹缝
    for (let x = 40; x < viewW; x += 90) {
      g.lineStyle(1, STRUCTURE_WOOD_LO, 0.7).lineBetween(x, 330, x, 378);
    }
    // 后厨台面靠墙的一小段挡水档
    g.fillStyle(STRUCTURE_WOOD_LO, 1).fillRect(0, 316, viewW, 6);

    // ==== 主吧台 ====
    g.fillStyle(BAR_TOP, 1).fillRect(0, BAR_TOP_Y, viewW, 20);
    g.fillStyle(BAR_HIGHLIGHT, 0.75).fillRect(0, BAR_TOP_Y, viewW, 4);
    g.fillStyle(STRUCTURE_WOOD_LO, 0.55).fillRect(0, BAR_TOP_Y + 16, viewW, 4);
    g.fillStyle(BAR_FRONT, 1).fillRect(0, BAR_TOP_Y + 20, viewW, BAR_FRONT_Y - BAR_TOP_Y - 20);
    g.lineStyle(1, STRUCTURE_WOOD_LO, 0.85).lineBetween(0, BAR_FRONT_Y, viewW, BAR_FRONT_Y);
    // 吧台正面竖木纹
    for (let x = 40; x < viewW; x += 72) {
      g.lineStyle(1, STRUCTURE_WOOD_LO, 0.6).lineBetween(x, BAR_TOP_Y + 24, x, BAR_FRONT_Y - 4);
    }
    // 吧台顶部前沿的一条深色装饰凹槽
    g.fillStyle(STRUCTURE_WOOD_LO, 0.75).fillRect(0, BAR_FRONT_Y - 6, viewW, 3);

    // ==== 每个座位前的台面小物（酱油瓶/胡椒罐/筷筒） ====
    for (const seatX of SEAT_XS) {
      // 酱油瓶
      g.fillStyle(0x1a1210, 1).fillRect(seatX - 14, BAR_TOP_Y + 2, 5, 12);
      g.fillStyle(0x3a2010, 1).fillRect(seatX - 14, BAR_TOP_Y - 1, 5, 3);
      // 胡椒罐
      g.fillStyle(0xe6ddc4, 1).fillRect(seatX - 4, BAR_TOP_Y + 3, 6, 11);
      g.fillStyle(0x8a6a3a, 1).fillRect(seatX - 4, BAR_TOP_Y + 1, 6, 2);
      // 筷筒
      g.fillStyle(0x2a1810, 1).fillRect(seatX + 6, BAR_TOP_Y + 2, 8, 12);
      g.fillStyle(0xd8c9a0, 1).fillRect(seatX + 8, BAR_TOP_Y - 3, 1, 5);
      g.fillStyle(0xd8c9a0, 1).fillRect(seatX + 10, BAR_TOP_Y - 4, 1, 6);
      g.fillStyle(0xd8c9a0, 1).fillRect(seatX + 12, BAR_TOP_Y - 2, 1, 4);
    }

    // ==== 详细吧凳（正面视角：粗支柱 + 踏脚横杆 + 坐面 + 落地座） ====
    for (const seatX of SEAT_XS) {
      const stoolTopY = BAR_FRONT_Y + 48;
      const stoolBaseY = BAR_FRONT_Y + 110;
      // 粗支柱（金属色）
      g.fillStyle(0x2a1a12, 1).fillRect(seatX - 5, stoolTopY, 10, stoolBaseY - stoolTopY);
      g.fillStyle(0x3a281a, 1).fillRect(seatX - 5, stoolTopY, 3, stoolBaseY - stoolTopY);
      g.fillStyle(0x140a05, 1).fillRect(seatX + 2, stoolTopY, 3, stoolBaseY - stoolTopY);
      // 踏脚横杆（U 形环，标志性吧凳特征）
      const footY = BAR_FRONT_Y + 82;
      g.lineStyle(2.5, 0x2a1a12, 1)
        .lineBetween(seatX - 18, footY, seatX - 5, footY);
      g.lineStyle(2.5, 0x2a1a12, 1)
        .lineBetween(seatX + 5, footY, seatX + 18, footY);
      // 短竖杆连回主柱
      g.fillStyle(0x2a1a12, 1).fillRect(seatX - 20, footY - 1, 3, 3);
      g.fillStyle(0x2a1a12, 1).fillRect(seatX + 17, footY - 1, 3, 3);
      // 坐面（厚圆盘：上层坐垫 + 侧边厚度 + 顶部高光）
      g.fillStyle(0x1a0f08, 1).fillEllipse(seatX, stoolTopY + 4, 40, 8);
      g.fillStyle(0x3a2416, 1).fillEllipse(seatX, stoolTopY, 40, 12);
      g.fillStyle(0x5a3a26, 1).fillEllipse(seatX, stoolTopY - 1, 34, 7);
      g.fillStyle(0x7a4e2f, 0.85).fillEllipse(seatX, stoolTopY - 2.5, 26, 3);
      // 落地圆座
      g.fillStyle(0x0f0806, 1).fillEllipse(seatX, stoolBaseY + 2, 36, 8);
      g.fillStyle(0x2a1a12, 1).fillEllipse(seatX, stoolBaseY, 32, 6);
      g.fillStyle(0x4a3020, 0.7).fillEllipse(seatX, stoolBaseY - 1, 22, 2);
    }

    this.shiftLayer.add(g);

    // ==== 樱花枝（右上角装饰，从横梁下垂） ====
    this.buildCherryBranch(viewW - 140, 82);
    this.buildCherryBranch(120, 96, 0.72, true);

    // ==== 鱼缸（不发光，先画在分级下面）====
    this.buildFishTank(viewW - 128, 296);

    // ★ 暖色分级：只覆盖背景/家具，emissive 层在上面。
    // 原先由四块矩形拼出的暗角会在 x=420/860 留下可见接缝，
    // 视觉上就像中央多出一条矩形亮带，因此不再使用该实现。
    this.applyColorGrading(viewW, this.options.viewH);

    // ==== 后墙霓虹（emissive，挂 bloom）====
    this.buildNeonSign(560, 294);

    // ==== 吊灯（emissive，挂 bloom）+ 光锥（ADD blend）====
    this.buildPendantLamps();

    // ==== 门口 + 门缝溢光 ====
    this.buildDoor();
  }

  /**
   * 温暖色调分级：MULTIPLY 混色的 alpha 会同时压暗画面，
   * 所以用一张接近纯白但略偏暖的 tint（0xfff0d8），alpha=1 全屏 MULTIPLY，
   * 这样绿蓝通道被轻微削掉 6%/15%，红通道保留 100%，
   * 净效果就是"整张画偏 2700K 白炽灯暖色"，几乎不损失明度。
   * 顶部再叠一层 ADD 暖光，把画面偏亮一点，抵消可能的暗感。
   */
  private applyColorGrading(viewW: number, viewH: number) {
    const warmTint = this.scene.add
      .rectangle(viewW / 2, viewH / 2, viewW, viewH, 0xfff0d8, 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.shiftLayer.add(warmTint);

    const ambientLift = this.scene.add
      .rectangle(viewW / 2, viewH / 2, viewW, viewH, 0xc98040, 0.12)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shiftLayer.add(ambientLift);
  }

  /**
   * 8 盏吊灯：只画灯泡本体（灯罩 + 玻璃 + 亮心），
   * 柔和的辉光/光锥交给 WarmLightPipeline 用 GLSL 渲染。
   */
  private buildPendantLamps() {
    const lampY = 128;
    const pendantG = this.scene.add.graphics();
    for (let i = 0; i < 8; i += 1) {
      const cx = 90 + i * 155;
      // 灯罩（暖色木壳）
      pendantG.fillStyle(0x8a4020, 1).fillEllipse(cx, lampY - 6, 20, 6);
      pendantG.fillStyle(0xb85832, 0.9).fillEllipse(cx, lampY - 6, 14, 3);
      // 玻璃灯泡本体
      pendantG.fillStyle(LANTERN_CORE, 1).fillCircle(cx, lampY, 8);
      // 亮心
      pendantG.fillStyle(0xfff2d8, 0.9).fillCircle(cx - 2, lampY - 2, 3);
    }
    this.shiftLayer.add(pendantG);
    // 只保留很轻的灯芯 bloom，外围柔光交给 shader。
    this.pendantBloom = pendantG.postFX?.addBloom(
      LANTERN_GLOW,
      1,
      1,
      this.lightSettings.pendantBloomBlur,
      this.lightSettings.pendantBloomStrength,
      4,
    );
  }

  /**
   * 门 + 门口挂灯：只画门框和小灯泡本体。
   * 大范围溢光 / 体积光雾交给 WarmLightPipeline 用 GLSL 渲染。
   */
  private buildDoor() {
    // 门框
    const doorFrame = this.scene.add.graphics();
    doorFrame
      .fillStyle(STRUCTURE_WOOD_LO, 1)
      .fillRect(DOOR_X - 22, 320, 44, BAR_FRONT_Y - 320)
      .fillStyle(STRUCTURE_WOOD, 1)
      .fillRect(DOOR_X - 22, 320, 44, 4);
    this.shiftLayer.add(doorFrame);

    // 门口挂灯本体
    const doorGlow = this.scene.add.graphics();
    const glowCx = DOOR_X;
    const glowCy = BAR_FRONT_Y - 24;
    doorGlow.fillStyle(LANTERN_CORE, 1).fillCircle(glowCx, glowCy, 8);
    doorGlow.fillStyle(0xfff2d8, 0.9).fillCircle(glowCx - 2, glowCy - 2, 3);
    this.shiftLayer.add(doorGlow);
    this.doorBloom = doorGlow.postFX?.addBloom(
      LANTERN_GLOW,
      1,
      1,
      this.lightSettings.pendantBloomBlur,
      this.lightSettings.pendantBloomStrength * 0.8,
      4,
    );

    const doorLabel = this.text(DOOR_X, 306, '出口', 14, COLOR_MUTED).setOrigin(0.5);
    this.shiftLayer.add(doorLabel);
  }

  /**
   * 挂载 WarmLightPipeline 到 shiftLayer 上，并配置所有光源位置。
   * 只在真正进入营业阶段时调用；管线在钓鱼阶段挂着会把整块画面涂白，
   * 所以离开餐厅时会调用 detachWarmLightPipeline() 还原。
   */
  private attachWarmLightPipeline() {
    if (this.pipelineAttached) return;
    const viewW = this.pipelineViewW || this.options.viewW;
    const viewH = this.pipelineViewH || this.options.viewH;
    const renderer = this.scene.game.renderer;
    // 仅 WebGL 支持自定义 pipeline；Canvas 后端跳过
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    const pipelineName = 'WarmLightPipeline';
    // Phaser 的 PipelineManager 只暴露 has() / add() / addPostPipeline()，
    // 早期版本没有 hasPostPipeline；直接用通用的 has() 避免运行时抛 "not a function"，
    // 导致整个 Scene create() 中断，进而钓鱼场景鱼竿等后续初始化全部丢失。
    if (!renderer.pipelines.has(pipelineName)) {
      renderer.pipelines.addPostPipeline(pipelineName, WarmLightPipeline);
    }
    this.shiftLayer.setPostPipeline(WarmLightPipeline);
    const pipeline = this.shiftLayer.getPostPipeline(WarmLightPipeline) as WarmLightPipeline;
    if (!pipeline) return;
    this.pipelineAttached = true;
    this.warmLightPipeline = pipeline;
    pipeline.setResolution(viewW, viewH);
    this.applyLightSettings();
  }

  /** 将编辑器参数实时同步给 shader 和各灯芯 Bloom。 */
  private applyLightSettings() {
    const settings = this.lightSettings;
    const pendantColor = parseLightColor(settings.pendantColor, LANTERN_GLOW);
    const doorColor = parseLightColor(settings.doorColor, LANTERN_GLOW);
    const neonColor = parseLightColor(settings.neonColor, 0xff7a9c);
    const tankColor = parseLightColor(settings.tankColor, 0x6aa8c0);
    if (this.pendantBloom) {
      this.pendantBloom.strength = settings.pendantBloomStrength;
      this.pendantBloom.blurStrength = settings.pendantBloomBlur;
      this.pendantBloom.color = pendantColor;
    }
    if (this.doorBloom) {
      this.doorBloom.strength = settings.pendantBloomStrength * 0.8;
      this.doorBloom.blurStrength = settings.pendantBloomBlur;
      this.doorBloom.color = doorColor;
    }
    if (this.neonBloom) {
      this.neonBloom.strength = settings.neonBloomStrength;
      this.neonBloom.blurStrength = settings.neonBloomBlur;
      this.neonBloom.color = neonColor;
    }
    if (!this.warmLightPipeline) return;

    const lights: WarmLight[] = [];
    // 新背景中的三盏吊灯（按原图 1024×576 坐标等比换算到 1280×720）。
    for (const x of [320, 646, 940]) {
      lights.push({
        x,
        y: 132,
        sigma: settings.pendantRadius,
        intensity: settings.pendantIntensity,
        color: pendantColor,
      });
    }
    // 月亮柔光（沿用第二组编辑参数）。
    lights.push({
      x: 860,
      y: 312,
      sigma: settings.doorRadius,
      intensity: settings.doorIntensity,
      color: doorColor,
    });
    // 窗外晚霞（沿用第三组编辑参数）。
    lights.push({
      x: 640,
      y: 220,
      sigma: settings.neonRadius,
      intensity: settings.neonIntensity,
      color: neonColor,
    });
    // 鱼缸（青蓝色小光晕）
    lights.push({
      x: 1100,
      y: 350,
      sigma: settings.tankRadius,
      intensity: settings.tankIntensity,
      color: tankColor,
    });
    this.warmLightPipeline.setLights(lights);
  }

  /** 离开餐厅前把 PostFX 管线摘掉，避免它在钓鱼场景把画面涂白。 */
  private detachWarmLightPipeline() {
    if (!this.pipelineAttached) return;
    this.shiftLayer.resetPostPipeline();
    this.pipelineAttached = false;
    this.warmLightPipeline = undefined;
  }

  private buildCherryBranch(x: number, y: number, scale = 1, mirror = false) {
    const g = this.scene.add.graphics();
    const s = scale;
    const dir = mirror ? -1 : 1;
    // 主枝
    g.lineStyle(3.5 * s, STRUCTURE_WOOD_LO, 0.95);
    g.beginPath();
    g.moveTo(x - 42 * dir, y - 8);
    g.lineTo(x - 20 * dir, y + 32 * s);
    g.lineTo(x + 10 * dir, y + 62 * s);
    g.lineTo(x + 42 * dir, y + 92 * s);
    g.lineTo(x + 70 * dir, y + 118 * s);
    g.strokePath();
    // 分枝
    g.lineStyle(2 * s, STRUCTURE_WOOD_LO, 0.9);
    g.beginPath();
    g.moveTo(x + 10 * dir, y + 62 * s);
    g.lineTo(x + 4 * dir, y + 92 * s);
    g.moveTo(x + 42 * dir, y + 92 * s);
    g.lineTo(x + 60 * dir, y + 108 * s);
    g.strokePath();
    // 花簇
    const bloomAt = (bx: number, by: number, size = 8) => {
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        g.fillStyle(0xf6a6c8, 0.95).fillCircle(
          bx + Math.cos(a) * size * 0.55,
          by + Math.sin(a) * size * 0.55,
          size * 0.5,
        );
      }
      g.fillStyle(0xfcd4e0, 0.95).fillCircle(bx, by, size * 0.4);
      g.fillStyle(0xffe8b0, 0.9).fillCircle(bx, by, size * 0.18);
    };
    bloomAt(x - 30 * dir, y + 20 * s, 7 * s);
    bloomAt(x - 10 * dir, y + 46 * s, 8 * s);
    bloomAt(x + 12 * dir, y + 58 * s, 6 * s);
    bloomAt(x + 28 * dir, y + 74 * s, 8 * s);
    bloomAt(x + 4 * dir, y + 92 * s, 7 * s);
    bloomAt(x + 50 * dir, y + 96 * s, 9 * s);
    bloomAt(x + 70 * dir, y + 116 * s, 7 * s);
    this.shiftLayer.add(g);
  }

  private buildNeonSign(cx: number, cy: number) {
    const g = this.scene.add.graphics();
    // 木质挂板底
    g.fillStyle(STRUCTURE_WOOD_LO, 0.95).fillRect(cx - 90, cy - 22, 180, 44);
    g.fillStyle(STRUCTURE_WOOD, 1).fillRect(cx - 90, cy - 22, 180, 4);
    g.fillStyle(STRUCTURE_WOOD, 1).fillRect(cx - 90, cy + 18, 180, 4);
    // 挂绳
    g.lineStyle(1.5, STRUCTURE_WOOD, 0.9);
    g.beginPath();
    g.moveTo(cx - 60, cy - 22);
    g.lineTo(cx - 60, cy - 60);
    g.moveTo(cx + 60, cy - 22);
    g.lineTo(cx + 60, cy - 60);
    g.strokePath();

    // 抽象霓虹图案：一条鱼 + 三个圆点（原创图形，非现有 IP 元素）
    const neon = 0xff7a9c;
    const neonSoft = 0xffb2c8;
    // 外发光
    g.lineStyle(6, neon, 0.18);
    g.strokeCircle(cx - 40, cy, 12);
    g.beginPath();
    g.moveTo(cx - 20, cy);
    g.lineTo(cx + 30, cy - 8);
    g.lineTo(cx + 42, cy);
    g.lineTo(cx + 30, cy + 8);
    g.closePath();
    g.strokePath();
    // 主体线（较细的亮线）
    g.lineStyle(2.5, neonSoft, 0.95);
    g.strokeCircle(cx - 40, cy, 12);
    g.beginPath();
    g.moveTo(cx - 20, cy);
    g.lineTo(cx + 30, cy - 8);
    g.lineTo(cx + 42, cy);
    g.lineTo(cx + 30, cy + 8);
    g.closePath();
    g.strokePath();
    // 鱼眼
    g.fillStyle(0xffffff, 1).fillCircle(cx + 24, cy - 3, 1.6);
    // 三点小气泡
    for (let i = 0; i < 3; i += 1) {
      const dx = cx + 52 + i * 8;
      const dy = cy - 6 - i * 4;
      g.fillStyle(neon, 0.35).fillCircle(dx, dy, 4);
      g.fillStyle(neonSoft, 0.95).fillCircle(dx, dy, 1.8);
    }
    this.shiftLayer.add(g);
    // 霓虹外围 bloom 由编辑器实时控制。
    this.neonBloom = g.postFX?.addBloom(
      neon,
      1,
      1,
      this.lightSettings.neonBloomBlur,
      this.lightSettings.neonBloomStrength,
      6,
    );
  }

  private buildFishTank(x: number, y: number) {
    const g = this.scene.add.graphics();
    const w = 108;
    const h = 84;
    // 外框
    g.fillStyle(0x0f0808, 1).fillRect(x - w / 2 - 3, y - 3, w + 6, h + 6);
    g.fillStyle(0x1a1210, 1).fillRect(x - w / 2, y, w, h);
    // 水体
    g.fillGradientStyle(0x2f6e88, 0x2f6e88, 0x1e4a68, 0x1e4a68, 1, 1, 1, 1)
      .fillRect(x - w / 2 + 3, y + 3, w - 6, h - 6);
    // 水面波光
    g.fillStyle(0x8ecad6, 0.6).fillRect(x - w / 2 + 3, y + 3, w - 6, 3);
    g.fillStyle(0xa8dae6, 0.35).fillRect(x - w / 2 + 6, y + 6, w - 12, 1);
    // 海草
    g.fillStyle(0x2a5a3a, 1);
    for (let i = 0; i < 3; i += 1) {
      const gx = x - w / 2 + 12 + i * 34;
      g.fillTriangle(gx, y + h - 4, gx - 4, y + h - 20, gx + 4, y + h - 20);
      g.fillTriangle(gx + 3, y + h - 4, gx + 0, y + h - 15, gx + 7, y + h - 15);
    }
    // 小鱼
    g.fillStyle(0xf6a86a, 1);
    g.fillEllipse(x - 24, y + 30, 14, 6);
    g.fillTriangle(x - 30, y + 30, x - 36, y + 27, x - 36, y + 33);
    g.fillStyle(0x1a1210, 1).fillCircle(x - 20, y + 29, 1);
    g.fillStyle(0xe38b5e, 1);
    g.fillEllipse(x + 18, y + 52, 12, 5);
    g.fillTriangle(x + 22, y + 52, x + 27, y + 49, x + 27, y + 55);
    g.fillStyle(0x1a1210, 1).fillCircle(x + 22, y + 51, 1);
    g.fillStyle(0xa3d0e0, 1);
    g.fillEllipse(x - 6, y + 60, 10, 4);
    g.fillTriangle(x - 3, y + 60, x + 2, y + 57, x + 2, y + 63);
    // 底沙
    g.fillStyle(0x8a6a3a, 1).fillRect(x - w / 2 + 3, y + h - 8, w - 6, 5);
    g.fillStyle(0xa8834a, 0.6).fillRect(x - w / 2 + 3, y + h - 8, w - 6, 2);
    // 气泡
    for (let i = 0; i < 4; i += 1) {
      const bx = x - 10 + Math.random() * 20;
      const by = y + 20 + Math.random() * 40;
      g.fillStyle(0xffffff, 0.3).fillCircle(bx, by, 1.2);
    }
    this.shiftLayer.add(g);
  }

  private buildChef() {
    const root = this.scene.add.container(640, CHEF_Y);
    const body = this.scene.add.rectangle(0, 12, 36, 44, CHEF_UNIFORM).setStrokeStyle(1, 0x9a8f7c);
    const apron = this.scene.add.rectangle(0, 22, 26, 24, CHEF_APRON);
    const head = this.scene.add.arc(0, -22, 15, 0, 360, false, CHEF_SKIN);
    const hatBase = this.scene.add.rectangle(0, -35, 26, 6, CHEF_HAT).setStrokeStyle(1, 0xb0b0b0);
    const hatTop = this.scene.add.arc(0, -44, 12, 0, 360, false, CHEF_HAT).setStrokeStyle(1, 0xb0b0b0);
    const leftEye = this.scene.add.arc(-5, -22, 1.8, 0, 360, false, CHEF_EYE);
    const rightEye = this.scene.add.arc(5, -22, 1.8, 0, 360, false, CHEF_EYE);
    const scarf = this.scene.add.rectangle(0, -8, 22, 6, 0xb3543a);
    root.add([body, apron, scarf, head, hatBase, hatTop, leftEye, rightEye]);
    this.shiftLayer.add(root);

    const heldRoot = this.scene.add.container(0, -70).setVisible(false);
    const heldPlate = this.scene.add.arc(0, 0, 15, 0, 360, false, 0xf1ece1).setStrokeStyle(2, 0xffffff, 0.7);
    const heldRice = this.scene.add.rectangle(0, 2, 18, 8, 0xfaf4e6).setStrokeStyle(1, 0xd8cfb4, 0.9);
    const heldDot = this.scene.add.arc(0, -3, 10, 0, 360, false, 0xd98b4a).setStrokeStyle(1, 0xffffff, 0.6);
    heldRoot.add([heldPlate, heldRice, heldDot]);
    root.add(heldRoot);

    this.chef = {
      root,
      x: 640,
      facing: 1,
      heldSlotIndex: -1,
      heldRoot,
      heldDot,
    };
  }

  private buildStations() {
    for (let i = 0; i < STATION_XS.length; i += 1) {
      const x = STATION_XS[i];
      const plateBase = this.scene.add.arc(0, 0, 20, 0, 360, false, 0xf1ece1).setStrokeStyle(2, 0xffffff, 0.75);
      // 米饭底：一个扁平白色圆角矩形，铺在盘子中央，鱼肉盖在饭上。
      const riceBase = this.scene.add.rectangle(0, 2, 22, 10, 0xfaf4e6).setStrokeStyle(1, 0xd8cfb4, 0.9);
      const dishDot = this.scene.add.arc(0, -4, 12, 0, 360, false, 0xd98b4a).setStrokeStyle(1, 0xffffff, 0.6);
      const emptyMark = this.text(0, 0, '空', 14, COLOR_MUTED).setOrigin(0.5);
      const labelText = this.text(0, -38, '', 15, COLOR_ACCENT).setOrigin(0.5);
      labelText.setShadow(0, 1, '#000000', 3, false, true);
      const countText = this.text(0, 30, '0 / 0', 14, COLOR_BODY).setOrigin(0.5);
      countText.setShadow(0, 1, '#000000', 3, false, true);
      const prepRing = this.scene.add.graphics();
      const prepLabel = this.text(0, 0, '料理中', 12, COLOR_ACCENT).setOrigin(0.5).setVisible(false);
      prepLabel.setShadow(0, 1, '#000000', 3, false, true);
      const root = this.scene.add.container(x, BAR_TOP_Y - 6, [
        plateBase,
        riceBase,
        dishDot,
        emptyMark,
        prepRing,
        prepLabel,
        labelText,
        countText,
      ]);
      this.shiftLayer.add(root);
      this.stationPlates.push({
        slotIndex: i,
        x,
        root,
        plateBase,
        riceBase,
        dishDot,
        emptyMark,
        labelText,
        countText,
        prepRing,
        prepLabel,
        ready: false,
        pendingOrders: 0,
        materializeTimer: 0,
        materializeDuration: STATION_MATERIALIZE_S,
      });
    }
  }

  private ensureShiftHudRingTextures() {
    const size = 264;
    const center = size / 2;
    const specs = [
      { key: 'restaurant-shift-ring', filled: false },
      { key: 'restaurant-shift-ring-filled', filled: true },
    ];

    for (const spec of specs) {
      if (this.scene.textures.exists(spec.key)) continue;
      const texture = this.scene.textures.createCanvas(spec.key, size, size);
      if (!texture) continue;
      const context = texture.context;
      context.clearRect(0, 0, size, size);
      context.lineCap = 'round';
      context.lineJoin = 'round';

      // 以最终显示尺寸的 4 倍绘制，再由线性采样缩小到 66px。
      context.strokeStyle = 'rgba(245, 229, 216, 0.76)';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(center, center, 108, 0, Math.PI * 2);
      context.stroke();

      context.strokeStyle = 'rgba(245, 229, 216, 0.28)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(center, center, 128, 0, Math.PI * 2);
      context.stroke();

      if (spec.filled) {
        context.fillStyle = 'rgba(247, 233, 220, 0.84)';
        context.beginPath();
        context.arc(center, center, 64, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(141, 107, 99, 0.42)';
        context.lineWidth = 4;
        context.beginPath();
        context.arc(center, center, 56, 0, Math.PI * 2);
        context.stroke();
      }

      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
  }

  private ensureSmoothPillTexture(
    key: string,
    width: number,
    height: number,
    fill: string | null,
    border: string,
    withDots = false,
  ) {
    if (this.scene.textures.exists(key)) return;
    const scale = 4;
    const canvasWidth = width * scale;
    const canvasHeight = height * scale;
    const texture = this.scene.textures.createCanvas(key, canvasWidth, canvasHeight);
    if (!texture) return;
    const context = texture.context;
    const inset = 4;
    const radius = canvasHeight / 2 - inset;

    const roundedRectPath = () => {
      context.beginPath();
      context.moveTo(inset + radius, inset);
      context.lineTo(canvasWidth - inset - radius, inset);
      context.quadraticCurveTo(canvasWidth - inset, inset, canvasWidth - inset, inset + radius);
      context.lineTo(canvasWidth - inset, canvasHeight - inset - radius);
      context.quadraticCurveTo(
        canvasWidth - inset,
        canvasHeight - inset,
        canvasWidth - inset - radius,
        canvasHeight - inset,
      );
      context.lineTo(inset + radius, canvasHeight - inset);
      context.quadraticCurveTo(inset, canvasHeight - inset, inset, canvasHeight - inset - radius);
      context.lineTo(inset, inset + radius);
      context.quadraticCurveTo(inset, inset, inset + radius, inset);
      context.closePath();
    };

    context.clearRect(0, 0, canvasWidth, canvasHeight);
    if (fill) {
      roundedRectPath();
      context.fillStyle = fill;
      context.fill();
    }
    roundedRectPath();
    context.strokeStyle = border;
    context.lineWidth = 3.2;
    context.stroke();

    if (withDots) {
      context.fillStyle = 'rgba(240, 216, 207, 0.56)';
      context.beginPath();
      context.arc(22 * scale, canvasHeight / 2, 1.3 * scale, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc((width - 22) * scale, canvasHeight / 2, 1.3 * scale, 0, Math.PI * 2);
      context.fill();
    }

    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  private buildShiftHud(viewW: number) {
    this.ensureShiftHudRingTextures();

    // 左上经营指标：圆环使用 4 倍分辨率 Canvas 贴图缩小显示，
    // 避免细线 Graphics 在画布缩放后落入半像素而产生锯齿和摩尔纹。
    const revenueRing = this.scene.add.image(54, 54, 'restaurant-shift-ring-filled').setDisplaySize(66, 66);
    const timerRing = this.scene.add.image(175, 54, 'restaurant-shift-ring').setDisplaySize(66, 66);
    const hud = this.scene.add.graphics();
    // 第二枚徽章使用枝叶线稿。
    hud.lineStyle(1.4, 0xf5e5d8, 0.88).lineBetween(168, 67, 183, 38);
    for (let index = 0; index < 4; index += 1) {
      const y = 61 - index * 7;
      hud.lineStyle(1, 0xf5e5d8, 0.78);
      hud.lineBetween(171 + index * 3, y, 164 + index * 3, y - 5);
      hud.lineBetween(174 + index * 3, y - 5, 182 + index * 3, y - 10);
    }
    this.shiftHudLayer.add([revenueRing, timerRing, hud]);

    this.coinsText = this.text(92, 42, '流水\n0', 16, '#f4e6dc').setOrigin(0, 0.5).setLineSpacing(4);
    this.timerLabel = this.text(212, 42, '营业剩余\n—', 16, '#f4e6dc').setOrigin(0, 0.5).setLineSpacing(4);
    this.timerTrack = this.scene.add.rectangle(212, 76, SHIFT_TIMER_BAR_WIDTH, 3, 0x4c3841, 0.5).setOrigin(0, 0.5);
    this.timerFill = this.scene.add.rectangle(212, 76, SHIFT_TIMER_BAR_WIDTH, 3, 0xf0c9b2, 0.95).setOrigin(0, 0.5);
    this.shiftHudLayer.add([this.coinsText, this.timerTrack, this.timerFill, this.timerLabel]);

    // 中央菜单卡：单层半透明磨砂色块，不使用投影和局部高光。
    for (let i = 0; i < 3; i += 1) {
      const badgeX = viewW / 2 - 220 + i * 220;
      const bg = this.scene.add.graphics();
      bg
        .fillStyle(SHIFT_CARD_COLORS[i], 0.72)
        .fillRoundedRect(-100, -46, 200, 94, 16)
        .lineStyle(1, 0xf4e5dc, 0.5)
        .strokeRoundedRect(-100, -46, 200, 94, 16);
      const dot = this.scene.add.arc(-72, -14, 9, 0, 360, false, 0x8f6874).setAlpha(0.72);
      const label = this.text(-54, -26, '——', 17, SHIFT_CARD_TEXT);
      const count = this.text(-54, 2, '0 / 0', 14, SHIFT_CARD_MUTED);
      const served = this.text(-54, 26, '已上菜 0', 12, SHIFT_CARD_MUTED);
      const root = this.scene.add.container(badgeX, 66, [bg, dot, label, count, served]).setVisible(false);
      root.setData('servedText', served);
      this.shiftHudLayer.add(root);
      this.menuBadges.push({ root, labelText: label, countText: count, dishDot: dot });
    }

    // 状态提示位于菜单卡下方，用暖白色阴影保证复杂背景上的清晰度。
    this.statsText = this.text(28, 100, '', 14, '#dbcac6');
    this.messageText = this.text(this.options.viewW / 2, 132, '', 18, '#f2d6c7').setOrigin(0.5);
    this.messageText.setWordWrapWidth(820);
    this.messageText.setShadow(0, 2, '#000000', 4, false, true);
    this.shiftHudLayer.add([this.statsText, this.messageText]);

    // 交互提示（浮在主角头顶）：整体放大
    const promptBg = this.scene.add.graphics();
    promptBg
      .fillStyle(UI_PANEL, 0.92)
      .fillRoundedRect(-140, -20, 280, 40, 10)
      .lineStyle(1, UI_BORDER, 0.5)
      .strokeRoundedRect(-140, -20, 280, 40, 10);
    this.interactPromptText = this.text(0, 0, '空格 · 拿盘', 16, COLOR_TITLE).setOrigin(0.5);
    this.interactPrompt = this.scene.add.container(640, CHEF_Y - 96, [promptBg, this.interactPromptText]).setVisible(false);
    this.shiftHudLayer.add(this.interactPrompt);

    // 底部：参考图中的窄胶囊操作提示 + 描边打烊按钮。
    const hintPillKey = 'restaurant-shift-hint-outline';
    this.ensureSmoothPillTexture(hintPillKey, 370, 32, null, 'rgba(243, 227, 220, 0.48)');
    const bottomHintBg = this.scene.add.image(
      this.options.viewW / 2,
      this.options.viewH - 46,
      hintPillKey,
    ).setDisplaySize(370, 32);
    const bottomHint = this.text(
      this.options.viewW / 2,
      this.options.viewH - 46,
      'A/D 走动 · 空格 拿盘上菜 / 按住倒茶 · 左右键交替收盘',
      13,
      '#e5d3ce',
    ).setOrigin(0.5);
    bottomHint.setShadow(0, 1, '#000000', 3, false, true);
    this.shiftHudLayer.add([bottomHintBg, bottomHint]);

    this.closeEarlyButton = this.createTextButton(
      this.options.viewW - 130,
      this.options.viewH - 44,
      220,
      42,
      '提前打烊',
      () => {
        if (this.phase === 'shift' && !this.finished) this.finishShift('提前打烊');
      },
      false,
      true,
    );
    this.shiftHudLayer.add(this.closeEarlyButton);
  }

  // ==============================================================
  // 营业阶段：启动与主循环
  // ==============================================================

  private startShift() {
    this.phase = 'shift';
    this.finished = false;
    this.menuLayer.setVisible(false);
    this.settlementLayer.setVisible(false);
    this.lobbyLayer.setVisible(false);
    this.shiftLayer.setVisible(true);
    this.shiftHudLayer.setVisible(true);
    this.stationPlates.forEach((station) => station.root.setVisible(true));
    this.attachWarmLightPipeline();
    this.messageTimer = 0;
    this.messageText.setText('');

    // 客流总量 = 总份数（每份对应一个可能的客人）；但至少 3 位、最多 12 位
    const totalPortions = this.dishes.reduce((s, d) => s + d.totalPortions, 0);
    this.guestsRemaining = Phaser.Math.Clamp(totalPortions, 3, 12);
    this.shiftDuration = Phaser.Math.Clamp(
      28 + this.guestsRemaining * SHIFT_PER_PORTION_S,
      SHIFT_MIN_S,
      SHIFT_MAX_S,
    );
    this.shiftRemaining = this.shiftDuration;
    this.spawnTimer = 2.4;

    // 原版循环：后厨只在收到订单后制作，不会提前把每道菜永久摆在台面。
    for (let i = 0; i < this.stationPlates.length; i += 1) {
      const station = this.stationPlates[i];
      const dish = this.dishes[i];
      if (dish) {
        station.labelText.setText(dish.dishName);
        station.dishDot.setFillStyle(dish.color);
        station.pendingOrders = 0;
        station.materializeTimer = 0;
        this.setStationReady(station, false);
      } else {
        station.root.setVisible(false);
      }
      this.refreshStationCount(i);
    }

    // 初始化菜单徽章
    for (let i = 0; i < this.menuBadges.length; i += 1) {
      const badge = this.menuBadges[i];
      const dish = this.dishes[i];
      if (!dish) {
        badge.root.setVisible(false);
        continue;
      }
      badge.root.setVisible(true);
      badge.dishDot.setFillStyle(dish.color);
      badge.labelText.setText(dish.dishName);
      badge.countText.setText(`${dish.remainingPortions} / ${dish.totalPortions}`);
    }

    // 重置厨师
    this.chef.x = 640;
    this.chef.facing = 1;
    this.chef.root.setPosition(this.chef.x, CHEF_Y);
    this.chef.heldSlotIndex = -1;
    this.chef.heldRoot.setVisible(false);
    this.activeTeaCustomer = null;
    this.teaQteLayer.setVisible(false);
    this.teaFill = 0;
    this.mouseLeftHeld = false;

    // 清客人 & 脏盘 & 销售统计
    for (const c of this.customers) c.root.destroy();
    this.customers = [];
    for (const p of this.dirtyPlates) p.root.destroy();
    this.dirtyPlates = [];
    this.soldByDish = new Array(this.dishes.length).fill(0);

    this.refreshShiftHud();
    this.setMessage('开门营业。客人陆续到店，走过去按空格拿盘上菜。', 4);
  }

  private updateShift(dt: number) {
    if (this.finished) return;
    this.shiftRemaining = Math.max(0, this.shiftRemaining - dt);
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageText.setText('');
    }

    this.updateChef(dt);
    this.updateStations(dt);
    this.updateCustomers(dt);
    this.trySpawnCustomer(dt);
    this.updateCleaningInput(dt);
    this.updateTeaQte(dt);
    this.updateInteractionPrompt();

    const spaceEdge = this.keysReady && Phaser.Input.Keyboard.JustDown(this.keySpace);
    if (spaceEdge || this.mouseJustClicked) {
      this.handleSpaceAction();
      this.mouseJustClicked = false;
    }
    if (this.keysReady && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.finishShift('提前打烊');
      return;
    }

    // 打烊触发条件
    if (!this.closing) {
      if (this.shiftRemaining <= 0) {
        this.finishShift('打烊时间到');
        return;
      }
      if (this.guestsRemaining <= 0 && this.customers.length === 0) {
        this.finishShift('今晚客人都招呼完了');
        return;
      }
      if (!this.hasAnyPortions() && this.customers.length === 0) {
        this.finishShift('食材用完，客人也都走了');
        return;
      }
    } else {
      // 清理阶段：等所有脏盘和用餐客人都处理完再真正结算
      this.tryConcludeClosing();
    }

    this.refreshShiftHud();
  }

  private updateChef(dt: number) {
    if (!this.keysReady) return;
    // 倒茶时锁住走位，防止走开中断茶壶动作
    if (this.activeTeaCustomer) {
      this.chef.root.setPosition(this.chef.x, CHEF_Y);
      this.chef.root.setScale(this.chef.facing * 1, 1);
      return;
    }
    const left = this.keyA.isDown ? -1 : 0;
    const right = this.keyD.isDown ? 1 : 0;
    const dir = left + right;
    if (dir !== 0) {
      this.chef.x = Phaser.Math.Clamp(this.chef.x + dir * CHEF_SPEED * dt, CHEF_X_MIN, CHEF_X_MAX);
      this.chef.facing = dir > 0 ? 1 : -1;
    }
    this.chef.root.setPosition(this.chef.x, CHEF_Y);
    this.chef.root.setScale(this.chef.facing * 1, 1);
  }

  private updateStations(dt: number) {
    for (let i = 0; i < this.stationPlates.length; i += 1) {
      const station = this.stationPlates[i];
      const dish = this.dishes[i];
      if (!dish) continue;
      if (!station.ready && station.pendingOrders > 0 && station.materializeTimer <= 0) {
        station.materializeDuration = STATION_MATERIALIZE_S;
        station.materializeTimer = STATION_MATERIALIZE_S;
      }
      if (!station.ready && station.pendingOrders > 0 && station.materializeTimer > 0) {
        station.materializeTimer -= dt;
        this.drawStationPrepRing(station);
        if (station.materializeTimer <= 0) {
          station.pendingOrders -= 1;
          this.setStationReady(station, true);
        }
      } else if (!station.ready && station.prepLabel.visible) {
        station.prepRing.clear();
        station.prepLabel.setVisible(false);
        station.emptyMark.setAlpha(0.7);
      }
    }
  }

  private drawStationPrepRing(station: StationPlate) {
    if (station.materializeDuration <= 0) return;
    const progress = Phaser.Math.Clamp(
      1 - station.materializeTimer / station.materializeDuration,
      0,
      1,
    );
    station.prepRing.clear();
    station.prepRing
      .lineStyle(3, 0x1a1a1a, 0.35)
      .strokeCircle(0, 0, 24)
      .lineStyle(4, 0xf6d17a, 1)
      .beginPath();
    station.prepRing.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
    station.prepRing.strokePath();
    station.prepLabel.setVisible(true).setText('料理中');
    station.emptyMark.setAlpha(0);
  }

  private updateCustomers(dt: number) {
    for (const customer of [...this.customers]) {
      if (customer.state === 'entering') {
        const speed = CUSTOMER_WALK_SPEED;
        const step = -speed * dt;
        const newX = customer.root.x + step;
        if (newX <= customer.seatX) {
          customer.root.setPosition(customer.seatX, CUSTOMER_Y);
          customer.state = 'seated';
          customer.facing = 1;
          customer.root.setScale(1, 1);
          customer.bubble.setVisible(true);
        } else {
          customer.root.setPosition(newX, CUSTOMER_Y);
        }
      } else if (customer.state === 'seated') {
        if (customer !== this.activeTeaCustomer) customer.patience -= dt / CUSTOMER_PATIENCE_S;
        const p = Math.max(0, Math.min(1, customer.patience));
        customer.bubbleFill.displayWidth = 56 * p;
        const fillColor = p > PATIENCE_WORRIED ? 0x7db58b : p > PATIENCE_ANGRY ? 0xd6a65f : 0xd96862;
        customer.bubbleFill.setFillStyle(fillColor, 0.95);
        // 气泡描边颜色随情绪走：中性 → 黄色 → 红色
        const borderColor = p > PATIENCE_WORRIED ? 0x2a2a2a : p > PATIENCE_ANGRY ? 0xd6a65f : 0xd96862;
        customer.bubbleFrame.setStrokeStyle(2, borderColor);
        customer.bubbleTail.setStrokeStyle(2, borderColor);
        // Emote 与身体抖动
        if (p > PATIENCE_WORRIED) {
          customer.emote.setVisible(false);
          customer.bodyRoot.setPosition(0, 0);
        } else if (p > PATIENCE_ANGRY) {
          customer.emote.setVisible(true).setText('?').setColor('#f2c14c');
          customer.bodyRoot.setPosition(0, 0);
        } else {
          customer.emote.setVisible(true).setText('!!').setColor('#f26a5c');
          customer.shakePhase += dt * 26;
          customer.bodyRoot.setPosition(Math.sin(customer.shakePhase) * 1.4, 0);
        }
        if (customer.patience <= 0) this.customerLeavesUnserved(customer);
      } else if (customer.state === 'eating') {
        customer.eatingTimer -= dt;
        // 吃的过程：小寿司图标随时间缩小并淡出
        const eatingProgress = Math.max(0, Math.min(1, 1 - customer.eatingTimer / customer.eatingDuration));
        const remaining = 1 - eatingProgress;
        customer.eatingPlate.setAlpha(0.05 + remaining * 0.85);
        customer.eatingPlate.setScale(0.55 + remaining * 0.55);
        if (customer.eatingTimer <= 0) {
          customer.state = 'leaving';
          customer.facing = -1;
          customer.root.setScale(-1, 1);
          customer.eatingPlate.setVisible(false);
          // 付钱瞬间：金币特效 + 桌上留下脏盘
          if (!customer.paidBurstFired && customer.paidAmount > 0) {
            this.spawnCoinBurst(customer.seatX, CUSTOMER_Y - 40, customer.paidAmount);
            customer.paidBurstFired = true;
          }
          if (!this.dirtyPlates.some((p) => p.seatIndex === customer.seatIndex)) {
            this.spawnDirtyPlate(customer.seatIndex, customer.servedDishColor);
          }
        }
      } else if (customer.state === 'leaving') {
        const speed = CUSTOMER_WALK_SPEED * 1.1;
        const newX = customer.root.x + speed * dt;
        customer.root.setPosition(newX, CUSTOMER_Y);
        if (newX >= DOOR_X + 40) this.removeCustomer(customer);
      }
    }
  }

  private trySpawnCustomer(dt: number) {
    if (this.guestsRemaining <= 0) return;
    if (this.customers.filter((c) => c.state !== 'leaving').length >= SEAT_XS.length) return;
    if (!this.hasAnyPortions()) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnCustomer();
    this.spawnTimer = Phaser.Math.FloatBetween(CUSTOMER_SPAWN_MIN_S, CUSTOMER_SPAWN_MAX_S);
  }

  private spawnCustomer() {
    const usedSeats = new Set<number>([
      ...this.customers.filter((c) => c.state !== 'leaving').map((c) => c.seatIndex),
      ...this.dirtyPlates.map((p) => p.seatIndex),
    ]);
    const freeSeats = SEAT_XS.map((_, i) => i).filter((i) => !usedSeats.has(i));
    if (freeSeats.length === 0) return;
    const seatIndex = Phaser.Utils.Array.GetRandom(freeSeats);
    const seatX = SEAT_XS[seatIndex];

    // 点单时立即预留一份并进入后厨制作队列。这样菜单归零后绝不会再接到同一道菜。
    const availableDishes = this.dishes
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.remainingPortions > 0);
    if (availableDishes.length === 0) return;
    const target = Phaser.Utils.Array.GetRandom(availableDishes);
    const wantSlotIndex = target.i;
    const wantDish = target.d;
    // 防御：再次核验 filter 拿到的这条菜确实还能点，避免任何理论上的竞态导致点单一份已售罄的菜。
    if (wantDish.remainingPortions <= 0) return;
    wantDish.remainingPortions -= 1;
    const station = this.stationPlates[wantSlotIndex];
    station.pendingOrders += 1;
    this.refreshStationCount(wantSlotIndex);
    this.refreshMenuBadge(wantSlotIndex);

    const templateIndex = Phaser.Math.Between(0, CUSTOMER_TEMPLATES.length - 1);
    const template = CUSTOMER_TEMPLATES[templateIndex];

    const root = this.scene.add.container(DOOR_X + 20, CUSTOMER_Y);
    root.setScale(-1, 1);
    // 把身体各部件挂到一个 bodyRoot 上，方便"生气抖动"独立于气泡做位移。
    const bodyRoot = this.scene.add.container(0, 0);
    const shoulders = this.scene.add.rectangle(0, -6, 40, 10, template.body).setStrokeStyle(1, 0x1a1a1a, 0.6);
    const body = this.scene.add.rectangle(0, 12, 36, 34, template.body).setStrokeStyle(1, 0x1a1a1a, 0.6);
    const head = this.scene.add.arc(0, -22, 14, 0, 360, false, template.skin);
    const hair = this.scene.add.arc(0, -25, 14, 180, 360, false, template.hair).setClosePath(false);
    hair.setStrokeStyle(0);
    const hairCap = this.scene.add.arc(0, -22, 14, 180, 360, true, template.hair);
    bodyRoot.add([shoulders, body, head, hair, hairCap]);
    root.add(bodyRoot);

    // 头顶气泡
    const bubbleRoot = this.scene.add.container(0, BUBBLE_Y_OFFSET);
    const bubbleBg = this.scene.add.rectangle(0, 0, 76, 52, 0xf5f0e8).setStrokeStyle(2, 0x2a2a2a);
    const bubbleFill = this.scene.add.rectangle(-28, 18, 56, 6, 0x7db58b, 0.95).setOrigin(0, 0.5);
    const bubbleIcon = this.scene.add.arc(0, -4, 16, 0, 360, false, wantDish.color).setStrokeStyle(1.5, 0xffffff, 0.75);
    const bubbleGlyph = this.text(0, -4, '茶', 17, '#20303a').setOrigin(0.5).setVisible(false);
    const tail = this.scene.add.triangle(0, 28, -8, 0, 8, 0, 0, 10, 0xf5f0e8).setStrokeStyle(2, 0x2a2a2a);
    bubbleRoot.add([tail, bubbleBg, bubbleFill, bubbleIcon, bubbleGlyph]);
    bubbleRoot.setVisible(false);
    root.add(bubbleRoot);

    // 情绪 emote：气泡上方浮一个 "?" / "!!"，随耐心切换
    const emoteText = this.text(0, BUBBLE_Y_OFFSET - 34, '', 22, '#f2c14c').setOrigin(0.5).setVisible(false);
    emoteText.setStroke('#2a1a10', 4);
    root.add(emoteText);

    // 吃饭时前面出现的小寿司图标：吃完前从 α=0.9 缩小并淡到 α=0
    const eatingPlate = this.scene.add.container(0, 6).setVisible(false);
    const eatingDisc = this.scene.add.arc(0, 0, 12, 0, 360, false, 0xf1ece1).setStrokeStyle(1.5, 0xffffff, 0.7);
    const eatingRice = this.scene.add.rectangle(0, 1, 14, 6, 0xfaf4e6).setStrokeStyle(1, 0xd8cfb4, 0.9);
    const eatingTopper = this.scene.add.arc(0, -2, 8, 0, 360, false, wantDish.color).setStrokeStyle(1, 0xffffff, 0.6);
    eatingPlate.add([eatingDisc, eatingRice, eatingTopper]);
    root.add(eatingPlate);

    this.shiftLayer.add(root);

    const teaRequested = Phaser.Math.FloatBetween(0, 1) < 0.34;
    bubbleIcon.setVisible(!teaRequested);
    bubbleGlyph.setVisible(teaRequested);
    const customer: Customer = {
      root,
      templateIndex,
      displayName: template.name,
      seatIndex,
      seatX,
      state: 'entering',
      facing: -1,
      wantSlotIndex,
      request: teaRequested ? 'tea' : 'dish',
      teaRequested,
      teaServed: false,
      patience: 1,
      eatingTimer: 0,
      eatingDuration: CUSTOMER_EATING_S,
      bubble: bubbleRoot,
      bubbleFrame: bubbleBg,
      bubbleFill,
      bubbleIcon,
      bubbleGlyph,
      bubbleTail: tail,
      emote: emoteText,
      bodyRoot,
      eatingPlate,
      eatingRice,
      eatingTopper,
      paidAmount: 0,
      servedDishColor: 0xffffff,
      paidBurstFired: false,
      shakePhase: Phaser.Math.FloatBetween(0, Math.PI * 2),
    };
    this.customers.push(customer);
    this.guestsRemaining -= 1;
  }

  private customerLeavesUnserved(customer: Customer) {
    this.lost += 1;
    this.reputationDelta -= 1;
    this.satisfactionSum += 1;
    this.satisfactionCount += 1;
    customer.state = 'leaving';
    customer.facing = -1;
    customer.root.setScale(-1, 1);
    customer.bubble.setVisible(false);
    customer.emote.setVisible(false);
    customer.bodyRoot.setPosition(0, 0);
    this.setMessage(`${customer.displayName}等太久，摔下筷子走了。`, 2.6);
  }

  private removeCustomer(customer: Customer) {
    customer.root.destroy();
    this.customers = this.customers.filter((c) => c !== customer);
  }

  // ==============================================================
  // 交互：拿盘 / 上菜
  // ==============================================================

  private updateInteractionPrompt() {
    // 倒茶阶段单独接管提示（附着在顾客头顶的小刻度杯上）
    if (this.activeTeaCustomer) {
      this.interactPrompt.setVisible(false);
      return;
    }
    if (this.chef.heldSlotIndex >= 0) {
      const target = this.findNearestServableCustomer();
      if (target) {
        this.showPrompt(`空格 · 上菜给${target.displayName}`, this.chef.x, CHEF_Y - 96);
        return;
      }
      this.showPrompt('空格 · 放回盘子', this.chef.x, CHEF_Y - 96);
      return;
    }
    const teaCustomer = this.findNearestTeaCustomer();
    const stationIndex = this.findNearestReadyStation();
    const dirty = this.findNearestDirtyInRange();

    // 倒茶优先级最高（顾客点了茶就等着）
    if (teaCustomer) {
      const suffix = dirty ? '　·　左/右键交替 收盘' : '';
      this.showPrompt(`按住空格 · 给${teaCustomer.displayName}倒绿茶${suffix}`, this.chef.x, CHEF_Y - 96);
      return;
    }
    // 拿盘和收盘互不冲突：两者同时在范围内时，两个提示合并显示。
    if (stationIndex >= 0) {
      const dish = this.dishes[stationIndex];
      const suffix = dirty ? '　·　左/右键交替 收盘' : '';
      this.showPrompt(`空格 · 拿一份${dish.dishName}${suffix}`, this.chef.x, CHEF_Y - 96);
      return;
    }
    if (dirty) {
      this.showPrompt('左/右键交替 · 收盘', this.chef.x, CHEF_Y - 96);
      return;
    }
    this.interactPrompt.setVisible(false);
  }

  private handleSpaceAction() {
    if (this.activeTeaCustomer) return; // 倒茶按住空格自身处理
    if (this.chef.heldSlotIndex >= 0) {
      const target = this.findNearestServableCustomer();
      if (target) {
        this.serveCustomer(target);
        return;
      }
      const nearest = this.findNearestStation();
      if (nearest >= 0 && nearest === this.chef.heldSlotIndex) {
        const station = this.stationPlates[nearest];
        this.setStationReady(station, true);
        station.materializeTimer = 0;
        this.chef.heldSlotIndex = -1;
        this.chef.heldRoot.setVisible(false);
        this.setMessage('把盘子放回出菜台。', 1.6);
      }
      return;
    }
    // 空手：先看能不能倒茶；点了茶的顾客最紧急。
    const teaCustomer = this.findNearestTeaCustomer();
    if (teaCustomer) {
      this.startTeaPour(teaCustomer);
      return;
    }
    // 拿盘（不再被脏盘挡住 —— 脏盘用鼠标左右键清理，与空格互不干涉）
    const stationIndex = this.findNearestReadyStation();
    if (stationIndex < 0) return;
    const station = this.stationPlates[stationIndex];
    const dish = this.dishes[stationIndex];
    if (!station.ready) return;
    this.setStationReady(station, false);
    station.materializeTimer = 0;
    this.chef.heldSlotIndex = stationIndex;
    this.chef.heldDot.setFillStyle(dish.color);
    this.chef.heldRoot.setVisible(true);
    this.refreshStationCount(stationIndex);
    this.refreshMenuBadge(stationIndex);
  }

  private serveCustomer(customer: Customer) {
    const slot = this.chef.heldSlotIndex;
    if (slot < 0) return;
    const dish = this.dishes[slot];
    this.chef.heldSlotIndex = -1;
    this.chef.heldRoot.setVisible(false);

    if (customer.wantSlotIndex !== slot) {
      // 上错菜会浪费时间，后厨把这份订单重新制作，避免订单永久卡死。
      customer.patience = Math.max(0.05, customer.patience - 0.35);
      this.stationPlates[slot].pendingOrders += 1;
      this.setMessage(`${customer.displayName}要的是${this.dishes[customer.wantSlotIndex].dishName}，不是这道。`, 2.6);
      return;
    }

    const patience = Math.max(0, Math.min(1, customer.patience));
    // 原版菜价固定，服务质量只影响小费和评分，不应偷偷改变菜单标价。
    const payment = dish.price;
    const tip = patience > 0.72 ? Math.max(1, Math.round(dish.price * 0.2)) : 0;
    this.income += payment;
    this.tips += tip;
    this.served += 1;
    this.reputationDelta += patience > 0.6 ? 2 : 1;
    this.satisfactionSum += 1 + patience * 4;
    this.satisfactionCount += 1;
    this.soldByDish[slot] = (this.soldByDish[slot] ?? 0) + 1;

    customer.state = 'eating';
    customer.eatingTimer = CUSTOMER_EATING_S;
    customer.eatingDuration = CUSTOMER_EATING_S;
    customer.paidAmount = payment + tip;
    customer.servedDishColor = dish.color;
    customer.bubble.setVisible(false);
    customer.emote.setVisible(false);
    customer.bodyRoot.setPosition(0, 0);
    // 面前放上寿司图标
    customer.eatingTopper.setFillStyle(dish.color);
    customer.eatingPlate.setVisible(true).setAlpha(0.9).setScale(1.1);
    this.spawnServeReaction(customer);
    this.setMessage(
      tip > 0
        ? `${dish.dishName}上桌，收 ${payment} 金 + 小费 ${tip}。`
        : `${dish.dishName}上桌，收 ${payment} 金。`,
      2.4,
    );
  }

  private findNearestStation(): number {
    let best = -1;
    let bestDist = INTERACT_RANGE;
    for (const s of this.stationPlates) {
      const dish = this.dishes[s.slotIndex];
      if (!dish) continue;
      const d = Math.abs(this.chef.x - s.x);
      if (d < bestDist) {
        best = s.slotIndex;
        bestDist = d;
      }
    }
    return best;
  }

  private findNearestReadyStation(): number {
    let best = -1;
    let bestDist = INTERACT_RANGE;
    for (const s of this.stationPlates) {
      const dish = this.dishes[s.slotIndex];
      if (!dish || !s.ready) continue;
      const d = Math.abs(this.chef.x - s.x);
      if (d < bestDist) {
        best = s.slotIndex;
        bestDist = d;
      }
    }
    return best;
  }

  private findNearestServableCustomer(): Customer | null {
    let best: Customer | null = null;
    let bestDist = INTERACT_RANGE + 20; // 座位比站台稍宽松
    for (const c of this.customers) {
      if (c.state !== 'seated' || c.request !== 'dish') continue;
      const d = Math.abs(this.chef.x - c.seatX);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  private findNearestTeaCustomer(): Customer | null {
    let best: Customer | null = null;
    let bestDist = INTERACT_RANGE + 20;
    for (const customer of this.customers) {
      if (customer.state !== 'seated' || customer.request !== 'tea') continue;
      const distance = Math.abs(this.chef.x - customer.seatX);
      if (distance < bestDist) {
        best = customer;
        bestDist = distance;
      }
    }
    return best;
  }

  private buildTeaQte(_viewW: number, _viewH: number) {
    // 简化为挂在顾客头顶的小杯子（茶壶倒茶 QTE 常见做法）：
    // 杯身 + 茶水动态填充 + 绿色目标带 + 顶部提示文本
    const cupW = 44;
    const cupH = 88;
    const cupBg = this.scene.add.rectangle(0, 0, cupW + 6, cupH + 6, 0x1a120a, 1)
      .setStrokeStyle(2, 0x0a0605, 1);
    const cupInner = this.scene.add.rectangle(0, 0, cupW, cupH, 0xf6f0df, 1);
    this.teaCupFill = this.scene.add
      .rectangle(0, cupH / 2, cupW, 1, 0x88b04b, 1)
      .setOrigin(0.5, 1);
    this.teaTargetBand = this.scene.add.rectangle(0, 0, cupW + 4, 14, 0x7db58b, 0.35)
      .setStrokeStyle(1.5, 0x4b9560, 1);
    this.teaQteLabel = this.text(0, -cupH / 2 - 18, '按住空格倒茶', 14, '#f6f0df').setOrigin(0.5);
    this.teaQteLabel.setStroke('#1a0f08', 3);
    this.teaQteLayer = this.scene.add.container(0, 0, [
      cupBg,
      cupInner,
      this.teaCupFill,
      this.teaTargetBand,
      this.teaQteLabel,
    ]).setVisible(false);
    this.shiftLayer.add(this.teaQteLayer);
  }

  private startTeaPour(customer: Customer) {
    if (this.activeTeaCustomer) return;
    this.activeTeaCustomer = customer;
    this.teaFill = 0;
    this.teaTargetMin = Phaser.Math.FloatBetween(0.66, 0.72);
    this.teaTargetMax = this.teaTargetMin + 0.16;
    this.positionTeaGaugeToCustomer(customer);
    this.teaQteLayer.setVisible(true);
    // 暂时隐藏需求气泡和情绪 emote，避免和茶杯 UI 打架
    customer.bubble.setVisible(false);
    customer.emote.setVisible(false);
    // 让厨师转向顾客
    this.chef.facing = customer.seatX >= this.chef.x ? 1 : -1;
    this.updateTeaQteVisual();
  }

  private positionTeaGaugeToCustomer(customer: Customer) {
    // 头顶正上方一点，避开原本的需求气泡
    this.teaQteLayer.setPosition(customer.seatX, CUSTOMER_Y - 120);
  }

  private updateTeaQte(dt: number) {
    if (!this.activeTeaCustomer) return;
    const customer = this.activeTeaCustomer;
    // 顾客中途走人（耐心耗尽），中止倒茶
    if (customer.state !== 'seated') {
      this.cancelTeaPour();
      return;
    }
    this.positionTeaGaugeToCustomer(customer);
    const spaceHeld =
      (this.keysReady && this.keySpace.isDown) || this.mouseLeftHeld;
    if (spaceHeld) {
      this.teaFill = Math.min(1.1, this.teaFill + dt * TEA_POUR_RATE);
      this.updateTeaQteVisual();
      if (this.teaFill >= 1.08) {
        // 溢出：直接判为失败并结束
        this.resolveTeaQte();
      }
    } else if (this.teaFill > 0) {
      // 松开 → 立即判定
      this.resolveTeaQte();
    }
  }

  private updateTeaQteVisual() {
    const cupH = 88;
    const fillHeight = Math.max(1, cupH * Math.min(1, this.teaFill));
    this.teaCupFill.setDisplaySize(this.teaCupFill.width, fillHeight);
    this.teaCupFill.setPosition(0, cupH / 2);
    const inZone = this.teaFill >= this.teaTargetMin && this.teaFill <= this.teaTargetMax;
    this.teaCupFill.setFillStyle(inZone ? 0xa8d472 : this.teaFill > this.teaTargetMax ? 0xd67a4a : 0x88b04b);
    const targetCenter = (this.teaTargetMin + this.teaTargetMax) * 0.5;
    const targetHeight = (this.teaTargetMax - this.teaTargetMin) * cupH;
    const targetY = cupH / 2 - targetCenter * cupH;
    this.teaTargetBand.setPosition(0, targetY).setDisplaySize(this.teaTargetBand.width, targetHeight);
    this.teaQteLabel.setText(
      this.teaFill < this.teaTargetMin
        ? '继续按住空格'
        : inZone
          ? '现在松开！'
          : '太满，赶快松开',
    ).setColor(inZone ? '#a8f0b0' : this.teaFill > this.teaTargetMax ? '#f6c078' : '#f6f0df');
  }

  private cancelTeaPour() {
    const c = this.activeTeaCustomer;
    if (c && c.state === 'seated') c.bubble.setVisible(true);
    this.activeTeaCustomer = null;
    this.teaFill = 0;
    this.teaQteLayer.setVisible(false);
  }

  private resolveTeaQte() {
    const customer = this.activeTeaCustomer;
    if (!customer) return;
    const excellent = this.teaFill >= this.teaTargetMin && this.teaFill <= this.teaTargetMax;
    const overflow = this.teaFill > this.teaTargetMax + 0.02;
    const underfill = this.teaFill < this.teaTargetMin;
    if (overflow) {
      // 溢出：茶洒了，不算营业额，还扣耐心
      customer.patience = Math.max(0.08, customer.patience - 0.28);
      this.setMessage(`${customer.displayName}的茶溢出来了，白倒。`, 2.4);
      this.cancelTeaPour();
      return;
    }
    // 正常送达（欠水量也算送达，但小费/口碑差）
    this.teaRevenue += TEA_PRICE;
    this.income += TEA_PRICE;
    if (excellent) {
      this.tips += 2;
      this.reputationDelta += 1;
      customer.patience = Math.min(1, customer.patience + 0.18);
      this.setMessage('绿茶液面完美！非料理收入 +4，小费 +2。', 2.2);
    } else if (underfill) {
      customer.patience = Math.max(0.15, customer.patience - 0.05);
      this.setMessage(`${customer.displayName}的茶只倒了半杯。非料理收入 +4。`, 2.2);
    } else {
      customer.patience = Math.min(1, customer.patience + 0.05);
      this.setMessage('绿茶顺利上桌。非料理收入 +4。', 2);
    }
    customer.teaServed = true;
    customer.request = 'dish';
    customer.bubbleGlyph.setVisible(false);
    customer.bubbleIcon.setVisible(true);
    // 恢复需求气泡：现在改成显示菜品图标
    if (customer.state === 'seated') customer.bubble.setVisible(true);
    this.spawnServeReaction(customer);
    this.activeTeaCustomer = null;
    this.teaFill = 0;
    this.teaQteLayer.setVisible(false);
  }

  // ==============================================================
  // 反馈特效：上菜反应 / 付款金币 / 脏盘 & 收拾
  // ==============================================================

  private spawnServeReaction(customer: Customer) {
    const reaction = Phaser.Utils.Array.GetRandom(SERVE_REACTIONS) as string;
    const bg = this.scene.add.graphics();
    bg
      .fillStyle(0xf5f0e8, 1)
      .fillRoundedRect(-98, -22, 196, 44, 12)
      .lineStyle(2, 0x2a2a2a, 1)
      .strokeRoundedRect(-98, -22, 196, 44, 12);
    const tail = this.scene.add.triangle(0, 22, -8, 0, 8, 0, 0, 12, 0xf5f0e8).setStrokeStyle(2, 0x2a2a2a);
    const heart = this.text(-72, 0, '♥', 24, '#d96862').setOrigin(0.5);
    const label = this.text(6, 0, reaction, 17, '#2a2a2a').setOrigin(0.5);
    const container = this.scene.add.container(customer.root.x, customer.root.y - 82, [tail, bg, heart, label]);
    this.shiftLayer.add(container);
    this.scene.tweens.add({
      targets: container,
      y: container.y - 34,
      duration: 1600,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: container,
      alpha: { from: 1, to: 0 },
      delay: 900,
      duration: 700,
      onComplete: () => container.destroy(),
    });
  }

  private spawnCoinBurst(x: number, y: number, amount: number) {
    for (let i = 0; i < 5; i += 1) {
      const coin = this.scene.add.arc(x, y, 7, 0, 360, false, 0xf4c76a).setStrokeStyle(1, 0xa07a2a);
      const ring = this.scene.add.arc(x, y, 4, 0, 360, false, 0xd39a3a);
      this.shiftLayer.add([coin, ring]);
      const angle = -Math.PI / 2 + Phaser.Math.FloatBetween(-Math.PI / 2.6, Math.PI / 2.6);
      const distance = Phaser.Math.Between(36, 60);
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;
      this.scene.tweens.add({
        targets: [coin, ring],
        x: targetX,
        y: targetY,
        alpha: { from: 1, to: 0 },
        duration: 780 + i * 70,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          coin.destroy();
          ring.destroy();
        },
      });
    }
    const label = this.text(x, y - 12, `+${amount}`, 22, '#f4c76a').setOrigin(0.5);
    label.setStroke('#4a3210', 4);
    this.shiftLayer.add(label);
    this.scene.tweens.add({
      targets: label,
      y: y - 56,
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private spawnDirtyPlate(seatIndex: number, dishColor: number) {
    const seatX = SEAT_XS[seatIndex];
    const plateBase = this.scene.add.arc(0, 0, 16, 0, 360, false, 0xf1ece1).setStrokeStyle(2, 0xffffff, 0.65);
    const residueA = this.scene.add.arc(-4, -2, 4, 0, 360, false, dishColor).setAlpha(0.6);
    const residueB = this.scene.add.arc(5, 3, 3, 0, 360, false, dishColor).setAlpha(0.55);
    const smudge = this.scene.add.arc(0, 0, 12, 0, 360, false, 0x5a3320).setAlpha(0.28);
    const alertBg = this.scene.add.arc(0, -30, 12, 0, 360, false, 0x1a1a1a).setStrokeStyle(1.5, 0xf6d17a, 0.9);
    const alertMark = this.text(0, -30, '!', 15, '#f6d17a').setOrigin(0.5);
    const progressGraphics = this.scene.add.graphics();
    const progressLabel = this.text(0, -50, '', 14, '#f5f0e8').setOrigin(0.5).setVisible(false);
    const root = this.scene.add.container(seatX, BAR_TOP_Y - 4, [
      smudge,
      plateBase,
      residueA,
      residueB,
      alertBg,
      alertMark,
      progressGraphics,
      progressLabel,
    ]);
    this.shiftLayer.add(root);
    this.dirtyPlates.push({
      seatIndex,
      x: seatX,
      root,
      progressGraphics,
      progressLabel,
      cleanProgress: 0,
      expectedButton: 'left',
      lastInputAt: 0,
      dishColor,
    });
  }

  private updateCleaningInput(dt: number) {
    const now = this.scene.time.now;
    for (const plate of this.dirtyPlates) {
      if (plate.cleanProgress > 0 && now - plate.lastInputAt > 900) {
        plate.cleanProgress = Math.max(0, plate.cleanProgress - dt * 0.35);
        this.updateDirtyPlateVisual(plate);
      }
    }
  }

  private registerCleaningTap(plate: DirtyPlate, button: 'left' | 'right') {
    if (this.phase !== 'shift' || this.chef.heldSlotIndex >= 0) return;
    plate.lastInputAt = this.scene.time.now;
    if (button === plate.expectedButton) {
      plate.cleanProgress = Math.min(1, plate.cleanProgress + 0.17);
      plate.expectedButton = button === 'left' ? 'right' : 'left';
    } else {
      plate.cleanProgress = Math.max(0, plate.cleanProgress - 0.08);
    }
    if (plate.cleanProgress >= 1) this.completeCleaning(plate);
    else this.updateDirtyPlateVisual(plate);
  }

  private updateDirtyPlateVisual(plate: DirtyPlate) {
    plate.progressGraphics.clear();
    if (plate.cleanProgress > 0) {
      const radius = 22;
      plate.progressGraphics
        .lineStyle(4, 0x7db58b, 1)
        .beginPath();
      plate.progressGraphics.arc(
        0,
        0,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.min(1, plate.cleanProgress),
        false,
      );
      plate.progressGraphics.strokePath();
      plate.progressLabel
        .setVisible(true)
        .setText(`${plate.expectedButton === 'left' ? '左键' : '右键'} · ${Math.round(plate.cleanProgress * 100)}%`);
    } else {
      plate.progressLabel.setVisible(false);
    }
  }

  private completeCleaning(plate: DirtyPlate) {
    plate.root.destroy();
    this.dirtyPlates = this.dirtyPlates.filter((p) => p !== plate);
    this.reputationDelta += 1;
    this.setMessage('收拾了桌上的碗筷，桌面干净了。口碑 +1。', 1.8);
  }

  private findNearestDirtyInRange(): DirtyPlate | null {
    let best: DirtyPlate | null = null;
    let bestDist = INTERACT_RANGE + 10;
    for (const p of this.dirtyPlates) {
      const d = Math.abs(this.chef.x - p.x);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  // ==============================================================
  // HUD 与结算
  // ==============================================================

  private refreshShiftHud() {
    if (this.closing) {
      // 打烊清理阶段：进度条清空，时钟改成清理提示
      this.timerFill.displayWidth = 0;
      const stillEating = this.customers.filter((c) => c.state === 'eating').length;
      const stillLeaving = this.customers.filter((c) => c.state === 'leaving').length;
      const pending = this.dirtyPlates.length + stillEating + stillLeaving;
      this.timerLabel
        .setText(`打烊清理\n待处理 ${pending}`)
        .setColor(pending > 0 ? '#d96862' : '#7db58b');
    } else {
      this.timerFill.displayWidth = SHIFT_TIMER_BAR_WIDTH * Math.max(0, Math.min(1, this.shiftRemaining / this.shiftDuration));
      this.timerFill.setFillStyle(this.shiftRemaining < 12 ? 0xd96862 : 0xf0c9b2, 0.95);
      const seconds = Math.max(0, Math.ceil(this.shiftRemaining));
      const clock = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
      this.timerLabel.setText(`营业剩余\n${clock}`).setColor('#f4e6dc');
    }
    this.coinsText.setText(`流水\n${this.income + this.tips}`);
    this.statsText.setText(`上菜 ${this.served} · 流失 ${this.lost} · 客人剩余 ${this.guestsRemaining + this.customers.length}`);
    // 每帧同步菜单徽章：即使 remainingPortions 没变，"待处理"人数也可能因为上菜/离席而变化
    this.refreshAllMenuBadges();
  }

  private refreshStationCount(slotIndex: number) {
    const station = this.stationPlates[slotIndex];
    const dish = this.dishes[slotIndex];
    if (!station || !dish) return;
    // 完全售罄（不能再点、没人在等、也没在做、没在等厨师拿）
    const inFlight = this.customers.filter(
      (c) => c.wantSlotIndex === slotIndex && (c.state === 'entering' || c.state === 'seated' || c.state === 'eating'),
    ).length;
    const fullyDone = dish.remainingPortions <= 0 && !station.ready && station.pendingOrders <= 0 && inFlight === 0;
    station.countText.setText(
      station.ready
        ? '出菜完成'
        : station.pendingOrders > 0
          ? `后厨排队 ${station.pendingOrders}`
          : fullyDone
            ? '本晚售罄'
            : '等待订单',
    );
  }

  private refreshMenuBadge(slotIndex: number) {
    const badge = this.menuBadges[slotIndex];
    const dish = this.dishes[slotIndex];
    if (!badge || !dish) return;
    // 已经点单但还没吃完/走人的客人数，包含正在走向座位、坐着等菜、吃着饭的
    const inFlight = this.customers.filter(
      (c) =>
        c.wantSlotIndex === slotIndex &&
        (c.state === 'entering' || c.state === 'seated' || c.state === 'eating'),
    ).length;
    let text: string;
    let color: string;
    if (dish.remainingPortions > 0) {
      // 还能被新客人点单
      text = inFlight > 0
        ? `${dish.remainingPortions} / ${dish.totalPortions}　·　待处理 ${inFlight}`
        : `${dish.remainingPortions} / ${dish.totalPortions}`;
      color = SHIFT_CARD_MUTED;
    } else if (inFlight > 0) {
      // 名额已订满，但已下单的客人还在等
      text = `已订满　·　待处理 ${inFlight}`;
      color = '#805c48';
    } else {
      // 完全没人再等这道菜了
      text = '售罄 ×';
      color = '#8d4f58';
    }
    badge.countText.setText(text).setColor(color);
    const servedText = badge.root.getData('servedText') as Phaser.GameObjects.Text | undefined;
    servedText?.setText(`已上菜 ${this.soldByDish[slotIndex] ?? 0}`);
  }

  private refreshAllMenuBadges() {
    for (let i = 0; i < this.menuBadges.length; i += 1) this.refreshMenuBadge(i);
  }

  private setStationReady(station: StationPlate, ready: boolean) {
    station.ready = ready;
    station.plateBase.setAlpha(ready ? 1 : 0.25);
    station.riceBase.setAlpha(ready ? 1 : 0);
    station.dishDot.setAlpha(ready ? 1 : 0);
    station.emptyMark.setAlpha(ready || station.pendingOrders > 0 ? 0 : 0.7);
    if (ready) {
      // 立即完成态就不用留残余进度圈
      station.prepRing.clear();
      station.prepLabel.setVisible(false);
    }
    this.refreshStationCount(station.slotIndex);
  }

  private hasAnyPortions() {
    return this.dishes.some((d) => d.remainingPortions > 0);
  }

  private setMessage(text: string, seconds: number) {
    this.messageText.setText(text);
    this.messageTimer = seconds;
  }

  private showPrompt(text: string, x: number, y: number) {
    this.interactPrompt.setPosition(x, y).setVisible(true);
    this.interactPromptText.setText(text);
  }

  private finishShift(reason: string) {
    if (this.finished) return;
    // 打烊触发的第一次：进入"清理阶段"，不立即结算。
    if (!this.closing) {
      this.closing = true;
      this.closingReason = reason;
      this.closingHintShown = false;
      // 阻止新客人进店
      this.guestsRemaining = 0;
      // 还没上桌 / 还在门口等座位的客人，视作流失
      for (const c of this.customers) {
        if (c.state === 'seated' || c.state === 'entering') {
          this.lost += 1;
          this.satisfactionSum += 1;
          this.satisfactionCount += 1;
          this.stopEmoteTracking(c);
          c.state = 'leaving';
          c.facing = -1;
          c.root.setScale(-1, 1);
          c.bubble.setVisible(false);
          c.emote.setVisible(false);
          c.bodyRoot.setPosition(0, 0);
        }
      }
      // 中断进行中的倒茶
      if (this.activeTeaCustomer) this.cancelTeaPour();
    }
    this.tryConcludeClosing();
  }

  private tryConcludeClosing() {
    if (this.finished || !this.closing) return;
    const stillEating = this.customers.some((c) => c.state === 'eating' || c.state === 'leaving');
    const stillDirty = this.dirtyPlates.length > 0;
    if (stillEating || stillDirty) {
      if (!this.closingHintShown) {
        this.closingHintShown = true;
        this.setMessage('打烊了。收拾好所有脏盘、送走桌上的客人后自动结算。', 4);
      }
      return;
    }
    this.finished = true;
    this.phase = 'settlement';
    // 营业前放进菜单的鱼已经被处理成寿司；打烊后剩余料理按原版规则废弃。
    this.consumedByFish = {};
    for (const dish of this.dishes) {
      if (dish.isPantry) continue;
      this.consumedByFish[dish.fishId] =
        (this.consumedByFish[dish.fishId] ?? 0) + dish.selectedFishCount;
    }
    for (const c of this.customers) c.root.destroy();
    this.customers = [];
    this.activeTeaCustomer = null;
    this.teaQteLayer.setVisible(false);
    this.interactPrompt.setVisible(false);
    this.showSettlement(this.closingReason);
  }

  private stopEmoteTracking(_customer: Customer) {
    // 占位方法：如果以后要在客人离开时清理定时器可以扩展；当前无需处理。
  }

  // ==============================================================
  // 结算阶段
  // ==============================================================

  private buildSettlementScreen(viewW: number, viewH: number) {
    const dim = this.scene.add.rectangle(viewW / 2, viewH / 2, viewW, viewH, 0x0f0b0d, 0.9);
    this.settlementLayer.add(dim);

    // ============= 顶部条：今日餐厅评分 + 潮汐余韵 =============
    const topX = 60;
    const topY = 40;
    const topW = viewW - 120;
    const topH = 96;
    const topBg = this.scene.add.graphics();
    topBg
      .fillStyle(SETTLEMENT_GLASS, 0.24)
      .fillRoundedRect(topX, topY, topW, topH, 12)
      .lineStyle(1, SETTLEMENT_BORDER, 0.48)
      .strokeRoundedRect(topX, topY, topW, topH, 12);
    this.settlementLayer.add(topBg);

    const topLabel = this.text(topX + 30, topY + 20, '今日餐厅评分', 16, COLOR_MUTED);
    this.settlementStarText = this.text(topX + 30, topY + 50, '★★★★★', 32, COLOR_ACCENT);
    this.settlementRatingValue = this.text(topX + 260, topY + 54, '5.0', 28, COLOR_ACCENT);
    const midDivider = this.scene.add.rectangle(topX + 380, topY + 48, 1, 60, SETTLEMENT_BORDER, 0.32);
    this.settlementLayer.add([topLabel, this.settlementStarText, this.settlementRatingValue, midDivider]);

    const afterglowLabel = this.text(topX + 410, topY + 20, '潮汐余韵', 16, COLOR_MUTED);
    this.settlementAfterglowIcon = this.text(topX + 410, topY + 50, '✦ x0', 24, '#e8c6b4');
    this.settlementAfterglowDesc = this.text(topX + 520, topY + 58, '今夜尚未留下余韵', 15, COLOR_MUTED)
      .setOrigin(0, 0.5);
    this.settlementLayer.add([afterglowLabel, this.settlementAfterglowIcon, this.settlementAfterglowDesc]);

    this.settlementReasonText = this.text(topX + topW - 30, topY + topH - 16, '', 14, COLOR_MUTED).setOrigin(1, 1);
    this.settlementLayer.add(this.settlementReasonText);

    // ============= 左面板：最高营业额 =============
    const leftX = 60;
    const leftY = 160;
    const leftW = 440;
    const leftH = 460;
    const leftBg = this.scene.add.graphics();
    leftBg
      .fillStyle(SETTLEMENT_GLASS, 0.22)
      .fillRoundedRect(leftX, leftY, leftW, leftH, 14)
      .lineStyle(1, SETTLEMENT_BORDER, 0.42)
      .strokeRoundedRect(leftX, leftY, leftW, leftH, 14);
    this.settlementLayer.add(leftBg);

    // 标题直接置于主面板内部；参考图没有额外的胶囊标题框。
    const leftHeader = this.text(leftX + leftW / 2, leftY + 20, '最高营业额', 18, COLOR_TITLE).setOrigin(0.5);
    this.settlementLayer.add(leftHeader);

    this.settlementBestName = this.text(leftX + leftW / 2, leftY + 56, '——', 22, COLOR_TITLE).setOrigin(0.5);
    const bestFrame = this.scene.add.graphics();
    bestFrame
      .fillStyle(SETTLEMENT_GLASS_ALT, 0.1)
      .fillRoundedRect(leftX + 40, leftY + 96, 160, 140, 10)
      .lineStyle(0.8, SETTLEMENT_BORDER, 0.32)
      .strokeRoundedRect(leftX + 40, leftY + 96, 160, 140, 10);
    this.settlementBestDot = this.scene.add.arc(leftX + 120, leftY + 166, 46, 0, 360, false, 0x2a2f36).setStrokeStyle(3, 0xffffff, 0.35);
    this.settlementLayer.add([bestFrame, this.settlementBestDot]);

    const bestLv = this.text(leftX + 240, leftY + 110, 'Lv.1', 22, COLOR_TITLE);
    this.settlementBestStats = this.text(leftX + 240, leftY + 150, '', 16, COLOR_BODY);
    this.settlementBestStats.setLineSpacing(4);
    this.settlementLayer.add([bestLv, this.settlementBestStats]);

    const revenueRowBg = this.scene.add.graphics();
    revenueRowBg
      .fillStyle(SETTLEMENT_GLASS_ALT, 0.18)
      .fillRoundedRect(leftX + 20, leftY + 258, leftW - 40, 44, 10)
      .lineStyle(0.8, SETTLEMENT_BORDER, 0.28)
      .strokeRoundedRect(leftX + 20, leftY + 258, leftW - 40, 44, 10);
    const revenueRowLabel = this.text(leftX + 50, leftY + 280, '收益', 15, COLOR_MUTED).setOrigin(0, 0.5);
    this.settlementBestRevenue = this.text(leftX + leftW - 50, leftY + 280, '0 x 0', 17, '#f4c76a').setOrigin(1, 0.5);
    this.settlementLayer.add([revenueRowBg, revenueRowLabel, this.settlementBestRevenue]);

    const sevenLabelBg = this.scene.add.graphics();
    sevenLabelBg
      .fillStyle(SETTLEMENT_GLASS_ALT, 0.1)
      .fillRoundedRect(leftX + 90, leftY + 320, leftW - 180, 28, 8)
      .lineStyle(0.8, SETTLEMENT_BORDER, 0.24)
      .strokeRoundedRect(leftX + 90, leftY + 320, leftW - 180, 28, 8);
    const sevenLabel = this.text(leftX + leftW / 2, leftY + 334, '最高营业额（最近7天）', 14, COLOR_MUTED).setOrigin(0.5);
    this.settlementLayer.add([sevenLabelBg, sevenLabel]);
    for (let i = 0; i < 3; i += 1) {
      const slotX = leftX + 90 + i * 110;
      const slotY = leftY + 400;
      const slot = this.scene.add.arc(slotX, slotY, 32, 0, 360, false, SETTLEMENT_GLASS_ALT, 0.12)
        .setStrokeStyle(0.8, SETTLEMENT_BORDER, 0.34);
      const glyph = this.text(slotX, slotY - 4, '饭', 16, COLOR_MUTED).setOrigin(0.5).setAlpha(0.3);
      const empty = this.text(slotX, slotY + 38, '无料理', 13, COLOR_MUTED).setOrigin(0.5);
      this.settlementLayer.add([slot, glyph, empty]);
    }

    // ============= 右面板：结算 =============
    const rightX = 520;
    const rightY = 160;
    const rightW = viewW - 60 - rightX;
    const rightH = 460;
    const rightBg = this.scene.add.graphics();
    rightBg
      .fillStyle(SETTLEMENT_GLASS, 0.22)
      .fillRoundedRect(rightX, rightY, rightW, rightH, 14)
      .lineStyle(1, SETTLEMENT_BORDER, 0.42)
      .strokeRoundedRect(rightX, rightY, rightW, rightH, 14);
    this.settlementLayer.add(rightBg);

    const rightHeader = this.text(rightX + 24, rightY + 20, '结算', 18, COLOR_TITLE).setOrigin(0, 0.5);
    const legendA = this.text(rightX + 126, rightY + 20, '● 营业额', 15, COLOR_GREEN).setOrigin(0, 0.5);
    const legendB = this.text(rightX + 226, rightY + 20, '● 运营费', 15, COLOR_WARN).setOrigin(0, 0.5);
    this.settlementDayLabel = this.text(rightX + rightW - 24, rightY + 20, '', 15, COLOR_MUTED).setOrigin(1, 0.5);
    this.settlementLayer.add([rightHeader, legendA, legendB, this.settlementDayLabel]);

    // 柱状图区
    const chartX = rightX + 24;
    const chartY = rightY + 44;
    const chartW = rightW - 48;
    const chartH = 170;
    const chartBg = this.scene.add.graphics();
    chartBg
      .fillStyle(SETTLEMENT_GLASS_ALT, 0.08)
      .fillRoundedRect(chartX, chartY, chartW, chartH, 6)
      .lineStyle(0.8, SETTLEMENT_BORDER, 0.26)
      .strokeRoundedRect(chartX, chartY, chartW, chartH, 6);
    const baseline = this.scene.add.rectangle(chartX, chartY + chartH - 6, chartW, 2, 0xffffff, 0.28).setOrigin(0, 0);
    this.settlementLayer.add([chartBg, baseline]);

    // 7 天占位轴
    for (let i = 0; i < 7; i += 1) {
      const bx = chartX + 30 + i * ((chartW - 60) / 6);
      const tickLabel = this.text(bx, chartY + chartH + 12, `${i + 1}`, 12, COLOR_MUTED).setOrigin(0.5).setAlpha(0.5);
      this.settlementLayer.add(tickLabel);
    }

    const bestTag = this.scene.add.graphics();
    bestTag
      .fillStyle(0xd96862, 1)
      .fillRoundedRect(chartX + 30 - 20, chartY + 12, 40, 18, 4);
    const bestTagText = this.text(chartX + 30, chartY + 21, 'BEST', 12, '#f5f0e8').setOrigin(0.5);
    this.settlementLayer.add([bestTag, bestTagText]);

    this.settlementBarBaselineY = chartY + chartH - 6;
    this.settlementBarMaxHeight = chartH - 30;
    this.settlementBar = this.scene.add
      .rectangle(chartX + 30, this.settlementBarBaselineY, 40, 20, 0x4ea88f, 1)
      .setOrigin(0.5, 1);
    const barLabel = this.text(chartX + 30, chartY + chartH + 28, '今日', 14, COLOR_BODY).setOrigin(0.5);
    this.settlementLayer.add([this.settlementBar, barLabel]);

    // 明细表：RexUI GridSizer 接管布局（4 行 × 4 列：标签 / 值 / 标签 / 值）
    const tableY = chartY + chartH + 54;
    const rowH = 26;
    const tableH = 4 * rowH;
    const rows: { key: string; label: string; sign: '+' | '-' | '='; positive: boolean }[] = [
      { key: 'dishes', label: '料理', sign: '+', positive: true },
      { key: 'mgmt', label: '管理费', sign: '-', positive: false },
      { key: 'sundries', label: '非料理项', sign: '+', positive: true },
      { key: 'wages', label: '工资', sign: '-', positive: false },
      { key: 'tips', label: '小费', sign: '+', positive: true },
      { key: 'maint', label: '维护费', sign: '-', positive: false },
      { key: 'revenue', label: '营业额', sign: '=', positive: true },
      { key: 'operating', label: '运营费', sign: '-', positive: false },
    ];
    const detailGrid: GridSizer = this.scene.rexUI.add.gridSizer({
      x: chartX + chartW / 2,
      y: tableY + tableH / 2 - 8,
      width: chartW,
      height: tableH,
      column: 4,
      row: 4,
      columnProportions: [0.34, 0.16, 0.34, 0.16],
      rowProportions: [1, 1, 1, 1],
      space: { left: 20, right: 20, top: 0, bottom: 0, column: 8, row: 0 },
    });
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const rowIndex = Math.floor(r / 2);
      const colGroup = (r % 2) * 2;
      const labelText = this.text(0, 0, row.label, 16, COLOR_TITLE);
      const valueText = this.text(0, 0, `${row.sign}   0`, 16, row.positive ? COLOR_GREEN : COLOR_WARN);
      detailGrid.add(labelText, { column: colGroup, row: rowIndex, align: 'left' });
      detailGrid.add(valueText, { column: colGroup + 1, row: rowIndex, align: 'right' });
      this.settlementRowValues[row.key] = valueText;
    }
    detailGrid.layout();
    this.settlementLayer.add(detailGrid);

    // 营业额分隔线（在 revenue 那一行上方）
    const separatorY = tableY + 3 * rowH - 4;
    const separator = this.scene.add
      .rectangle(chartX + 20, separatorY, chartW / 2 - 40, 1, 0xffffff, 0.14)
      .setOrigin(0, 0);
    this.settlementLayer.add(separator);

    // 纯利润条
    const profitY = tableY + 4 * rowH + 10;
    const profitRowBg = this.scene.add.graphics();
    profitRowBg
      .fillStyle(SETTLEMENT_GLASS_ALT, 0.2)
      .fillRoundedRect(chartX, profitY - 6, chartW, 44, 10)
      .lineStyle(0.8, SETTLEMENT_BORDER, 0.38)
      .strokeRoundedRect(chartX, profitY - 6, chartW, 44, 10);
    const profitLabel = this.text(chartX + 20, profitY + 14, '纯利润', 18, COLOR_TITLE).setOrigin(0, 0.5);
    const profitCoin = this.scene.add.arc(chartX + chartW / 2 + 20, profitY + 14, 12, 0, 360, false, 0xf4c76a).setStrokeStyle(1, 0xa07a2a);
    this.settlementProfitText = this.text(chartX + chartW / 2 + 40, profitY + 14, '0', 22, '#f4c76a').setOrigin(0, 0.5);
    const trend = this.scene.add.triangle(chartX + chartW - 24, profitY + 14, 0, -8, -8, 8, 8, 8, 0x7db58b);
    this.settlementLayer.add([profitRowBg, profitLabel, profitCoin, this.settlementProfitText, trend]);

    // 回港按钮：RexUI Label 直接充当按钮，命中区、层级、hover 一起搞定
    const backLabel: Label = this.scene.rexUI.add.label({
      x: viewW / 2,
      y: viewH - 44,
      width: 320,
      height: 54,
      background: this.scene.rexUI.add.roundRectangle({
        radius: 12,
        color: 0x59615a,
        alpha: 0.56,
        strokeColor: SETTLEMENT_BORDER,
        strokeWidth: 1,
      }),
      text: this.text(0, 0, '回到经营界面', 19, COLOR_TITLE),
      align: 'center',
      space: { left: 12, right: 12, top: 8, bottom: 8 },
    });
    backLabel.layout();
    backLabel
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => backLabel.getElement('background').setStrokeStyle(1, 0xfff4e9))
      .on('pointerout', () => backLabel.getElement('background').setStrokeStyle(1, SETTLEMENT_BORDER))
      .on('pointerdown', () => this.reportResult());
    this.settlementLayer.add(backLabel);
  }

  private stopSettlementTweens() {
    for (const t of this.settlementTweens) {
      if (t && t.isPlaying()) t.stop();
    }
    this.settlementTweens = [];
  }

  private animateNumber(
    target: number,
    duration: number,
    onUpdate: (value: number) => void,
    delay = 0,
    ease: string = 'Cubic.easeOut',
  ) {
    onUpdate(0);
    if (target === 0) return;
    const tween = this.scene.tweens.addCounter({
      from: 0,
      to: target,
      duration,
      delay,
      ease,
      onUpdate: (t) => onUpdate(Math.round(t.getValue())),
      onComplete: () => onUpdate(target),
    });
    this.settlementTweens.push(tween);
  }

  private showSettlement(reason: string) {
    this.shiftLayer.setVisible(true);
    this.settlementLayer.setVisible(true);
    this.layer.bringToTop(this.settlementLayer);
    this.stopSettlementTweens();

    const revenue = this.income + this.tips;
    const totalCustomers = this.served + this.lost;
    const successRate = totalCustomers > 0 ? this.served / totalCustomers : 0;
    const rawRating = this.satisfactionCount > 0
      ? this.satisfactionSum / this.satisfactionCount
      : 1;
    const starRating = Math.max(1, Math.min(5, Math.round(rawRating * 2) / 2));
    const filled = Math.floor(starRating);
    const halfChar = starRating - filled >= 0.5;
    const empty = 5 - filled - (halfChar ? 1 : 0);
    this.settlementStarText.setText('★'.repeat(filled) + (halfChar ? '☆' : '') + '☆'.repeat(empty));
    this.settlementRatingValue.setText(starRating.toFixed(1));

    // 潮汐余韵达成条件（同时满足）：
    //   - 平均满意度评分 ≥ 4.5 星
    //   - 留客率 ≥ 90%（流失 / 全场 ≤ 10%）
    //   - 接待客人数 ≥ 3
    const ratingOk = starRating >= 4.5;
    const rateOk = successRate >= 0.9;
    const servedOk = this.served >= 3;
    const isPerfect = ratingOk && rateOk && servedOk;
    const afterglowCount = isPerfect ? 1 : 0;
    this.settlementAfterglowIcon.setText(`✦ x${afterglowCount}`);
    if (isPerfect) {
      this.settlementAfterglowDesc.setText('潮汐余韵已凝聚。');
    } else {
      // 明确告诉玩家是哪一条没达标
      const reasons: string[] = [];
      if (!servedOk) reasons.push(`接待客人数 ${this.served}<3`);
      if (!rateOk) reasons.push(`流失 ${this.lost} / 全场 ${totalCustomers}（留客率<90%）`);
      if (!ratingOk) reasons.push(`满意度 ${starRating.toFixed(1)}<4.5`);
      this.settlementAfterglowDesc.setText(
        `余韵未成：${reasons.join('  ·  ')}`,
      );
    }

    // 结算原因（提前打烊 / 时间到 / 食材用完 / 已退出菜单）
    this.settlementReasonText.setText(reason);

    // 最高营业额料理
    let bestIndex = -1;
    let bestSold = 0;
    for (let i = 0; i < this.dishes.length; i += 1) {
      const sold = this.soldByDish[i] ?? 0;
      if (sold > bestSold) {
        bestSold = sold;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      const dish = this.dishes[bestIndex];
      const sold = this.soldByDish[bestIndex];
      const bestTotal = dish.price * sold;
      this.settlementBestName.setText(dish.dishName);
      this.settlementBestDot.setFillStyle(dish.color);
      this.settlementBestStats.setText([
        `售出　${sold} 份`,
        `单价　${dish.price} 金`,
        `废弃　${Math.max(0, dish.totalPortions - sold)} 份`,
      ].join('\n'));
      // 招牌菜营业额同步 count-up
      this.animateNumber(bestTotal, 1100, (v) => {
        const progress = bestTotal > 0 ? v / bestTotal : 0;
        const soldNow = Math.round(sold * progress);
        this.settlementBestRevenue.setText(`${dish.price} × ${soldNow} = ${v} 金`);
      }, 200);
    } else {
      this.settlementBestName.setText('今晚未售出料理');
      this.settlementBestDot.setFillStyle(0x2a2f36);
      this.settlementBestStats.setText('没有菜品被点单。');
      this.settlementBestRevenue.setText('0 金');
    }

    this.settlementDayLabel.setText(`本晚 · 客流 ${totalCustomers}`);

    // 明细表数值（先算好目标值）
    const dishRevenue = Math.max(0, this.income - this.teaRevenue);
    const sundries = this.teaRevenue;
    const tips = this.tips;
    const mgmt = 0;
    const wages = 0;
    const maint = 0;
    const operating = 0;
    const netProfit = revenue - mgmt - wages - maint - operating;

    // 柱状图从 0 长上去（对应营业额行的动画节奏）
    const targetBarHeight = Math.max(6, Math.min(this.settlementBarMaxHeight, revenue * 3));
    this.settlementBar.setPosition(this.settlementBar.x, this.settlementBarBaselineY);
    this.settlementBar.setDisplaySize(44, 0);
    if (revenue > 0) {
      const barTween = this.scene.tweens.add({
        targets: this.settlementBar,
        displayHeight: targetBarHeight,
        duration: 1200,
        delay: 250,
        ease: 'Cubic.easeOut',
      });
      this.settlementTweens.push(barTween);
    } else {
      this.settlementBar.setDisplaySize(44, targetBarHeight);
    }

    // 明细行 count-up（先出正项，再出减项，营业额和纯利润稍晚以强调）
    const setRow = (key: string, sign: '+' | '-' | '=', value: number, duration: number, delay: number) => {
      const el = this.settlementRowValues[key];
      if (!el) return;
      this.animateNumber(value, duration, (v) => el.setText(`${sign}   ${v}`), delay);
    };
    setRow('dishes', '+', dishRevenue, 900, 200);
    setRow('sundries', '+', sundries, 900, 400);
    setRow('tips', '+', tips, 900, 600);
    setRow('revenue', '=', revenue, 1200, 800);
    setRow('mgmt', '-', mgmt, 600, 200);
    setRow('wages', '-', wages, 600, 400);
    setRow('maint', '-', maint, 600, 600);
    setRow('operating', '-', operating, 600, 800);
    this.animateNumber(netProfit, 1400, (v) => this.settlementProfitText.setText(`${v}`), 1000);

    this.lastResult = {
      served: this.served,
      lost: this.lost,
      income: this.income,
      tips: this.tips,
      reputationDelta: this.reputationDelta,
      consumed: { ...this.consumedByFish },
    };
  }

  private reportResult() {
    const result = this.lastResult ?? {
      served: this.served,
      lost: this.lost,
      income: this.income,
      tips: this.tips,
      reputationDelta: this.reputationDelta,
      consumed: { ...this.consumedByFish },
    };
    this.hide();
    this.options.onFinish(result);
  }

  // ==============================================================
  // 通用工具
  // ==============================================================

  private drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, radius = 14) {
    g.fillStyle(UI_PANEL, 0.78).fillRoundedRect(x, y, w, h, radius);
    g.lineStyle(1, UI_BORDER, 0.24).strokeRoundedRect(x, y, w, h, radius);
  }

  private text(x: number, y: number, value: string, size: number, color: string) {
    return this.scene.add.text(x, y, value, {
      fontFamily: this.options.fontFamily,
      // Noto Serif SC 已加载 300/400；结算参考图使用更纤细的宋体笔画。
      fontStyle: '300',
      fontSize: `${size}px`,
      color,
    }).setLetterSpacing(size >= 18 ? 0.8 : 0.25);
  }

  private createMenuButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    emphasized = false,
  ) {
    const bg = this.scene.add.graphics();
    bg
      .fillStyle(emphasized ? 0x9b7582 : 0x756068, emphasized ? 0.46 : 0.36)
      .fillRoundedRect(-w / 2, -h / 2, w, h, h / 2)
      .lineStyle(0.8, 0xffeee4, emphasized ? 0.66 : 0.52)
      .strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const labelText = this.text(0, 0, label, 17, emphasized ? '#fff0e8' : '#eadbd6').setOrigin(0.5);
    const button = this.scene.add.container(x, y, [bg, labelText]);
    button.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    button.on('pointerdown', onClick);
    button.on('pointerover', () => button.setScale(1.018));
    button.on('pointerout', () => button.setScale(1));
    return button;
  }

  private createTextButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    primary = false,
    subtle = false,
  ) {
    let bg: Phaser.GameObjects.GameObject;
    if (subtle) {
      // 营业页右下按钮同样预渲染为高分辨率贴图，细圆角边框不再实时缩放。
      const key = `restaurant-shift-subtle-pill-${w}-${h}`;
      this.ensureSmoothPillTexture(
        key,
        w,
        h,
        'rgba(182, 140, 156, 0.16)',
        'rgba(243, 223, 216, 0.62)',
        true,
      );
      bg = this.scene.add.image(0, 0, key).setDisplaySize(w, h);
    } else {
      const graphics = this.scene.add.graphics();
      graphics
        .fillStyle(primary ? UI_PRIMARY : 0x46333d, primary ? 0.58 : 0.68)
        .fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      if (primary) {
        // 两层低透明填充模拟磨砂玻璃：底色仍可透出背景，边缘保留柔和乳白反光。
        graphics.fillStyle(0xf1d5c3, 0.055).fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.48, 9);
        graphics.lineStyle(1.2, 0xddbda8, 0.62).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        graphics.lineStyle(1, 0xf4dfd0, 0.12).strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 9);
      } else {
        graphics.lineStyle(1.2, 0xf0d8cf, 0.58).strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
      const dotAlpha = primary ? 0.62 : 0.9;
      graphics.fillStyle(primary ? 0xe0bda6 : 0xf0d8cf, dotAlpha).fillCircle(-w / 2 + 22, 0, 2);
      graphics.fillStyle(primary ? 0xe0bda6 : 0xf0d8cf, dotAlpha).fillCircle(w / 2 - 22, 0, 2);
      bg = graphics;
    }
    const text = this.text(
      0,
      0,
      label,
      primary ? 19 : 17,
      primary ? UI_PRIMARY_TEXT : subtle ? '#f2dfda' : COLOR_TITLE,
    ).setOrigin(0.5);
    const button = this.scene.add.container(x, y, [bg, text]);
    // 不调用 setSize：Container 的 displayOrigin 由 width/height 推导会把命中区偏移半格。
    button.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    button.on('pointerdown', onClick);
    return button;
  }
}
