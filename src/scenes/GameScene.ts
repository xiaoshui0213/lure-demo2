import Phaser from 'phaser';
import { GameState, Zone, RoleType, ROLES } from '../GameState';
import { FishingWheel } from '../ui/FishingWheel';
import { PortPanel, PortStationKind } from '../ui/PortPanel';
import { CargoPanel }   from '../ui/CargoPanel';
import { ShipPartPanel, ShipPart }   from '../ui/ShipPartPanel';
import { ShipModulePanel }            from '../ui/ShipModulePanel';
import { LootDropPopup }              from '../ui/LootDropPopup';
import { BrokerDialogue } from '../ui/BrokerDialogue';
import { TreasureMapOverlay } from '../ui/TreasureMapOverlay';
import { ShipLogOverlay } from '../ui/ShipLogOverlay';
import { missionProgressText, deadlineText, canTurnIn, dailyNpcDone, DELIVERY_ISLANDS } from '../missions';
import { Monster, MonsterKind } from '../entities/Monster';
import { Boss }         from '../entities/Boss';
import {
  W, H,
  WORLD_W, WORLD_H,
  ZONE_PORT_W, ZONE_SHALLOW_W,
  SHIP_SPD, DAY_MS, NIGHT_MS,
  MAX_SAN,
  CANNON_COOLDOWN,
  HARPOON_COOLDOWN, HARPOON_SPEED,
  FISH_SPOT_RANGE, FISH_SPOT_STOCK,
  SHALLOW_SPOT_CNT, DEEP_SPOT_CNT, SPOT_RESPAWN_MS,
  BOSS_DMG, BOSS_REWARD_GOLD,
  MONSTER_ZONE_R, MONSTER_EMERGE_MS, MONSTER_LAIR_CD,
} from '../constants';
import { ItemType } from '../GameState';

const DEEP_X = ZONE_PORT_W + ZONE_SHALLOW_W;
const DEEP_W = WORLD_W - DEEP_X;

// Ship spawn point (world coords) — in water just east of the boardwalk
const SHIP_START_X = 170;
const SHIP_START_Y = WORLD_H / 2;

// Dock NPC — appears on the pier during daytime missions
const DOCK_NPC_X = 98;
const DOCK_NPC_Y = SHIP_START_Y + 78;
const DOCK_NPC_RANGE = 120;

// Boss lair (far south-east corner of the deep zone)
const LAIR_CX        = WORLD_W - 240;
const LAIR_CY        = WORLD_H - 220;
const LAIR_R         = 170;   // visible danger zone radius
const LAIR_TRIGGER_R = 130;   // distance at which boss spawns
const HUD_H  = 58;
const HUD_D  = 20;
const BULLET_SPEED    = 420; // px/s

// ─── Monster lurking zones (deep sea hot-spots) ───────────────
// Placed so they form distinct danger spots player must navigate past.
// Kept clear of the boss lair (south-east corner).
const MONSTER_ZONE_POS: readonly { cx: number; cy: number }[] = [
  { cx: 1080, cy: 320 },
  { cx: 1360, cy: 580 },
  { cx: 1120, cy: 880 },
];

// ─── Cannonball / Harpoon ──────────────────────────────────────
interface Ball {
  gfx:       Phaser.GameObjects.Graphics;
  x:         number;
  y:         number;
  vx:        number;
  vy:        number;
  isBlast:   boolean;  // true = tier-1 blast cannon projectile
  isHarpoon: boolean;  // true = player harpoon (1 dmg, fast)
}

// Cannon mode = manual cannon + auto harpoon
// Harpoon mode = manual harpoon + auto cannon
type CombatMode = 'cannon' | 'harpoon';

// ─── Fishing spot ──────────────────────────────────────────────
interface Bubble {
  ox:    number;  // offset from spot center
  oy:    number;
  vy:    number;
  vx:    number;
  r:     number;
  life:  number;  // 0..1
  decay: number;
}

interface FishSil {
  angle:  number;
  speed:  number;  // rad/s (direction of swim)
  radius: number;  // distance from spot center
  size:   number;
  phase:  number;  // for alpha shimmer
}

interface Ripple {
  r:    number;
  life: number;  // 0..1
}

interface FishSpot {
  gfx:    Phaser.GameObjects.Graphics;
  x:      number;
  y:      number;
  type:   ItemType;             // 'fish' (shallow) | 'glow_fish' (deep)
  stock:  number;
  t:      number;               // total elapsed time (s)
  bubbles:    Bubble[];
  fishSils:   FishSil[];
  ripples:    Ripple[];
  bubbleTimer: number;          // ms until next bubble
  rippleTimer: number;          // ms until next ripple
}

// ─── Monster lurking zone ──────────────────────────────────────
interface MonsterZone {
  cx:       number;
  cy:       number;
  gfx:      Phaser.GameObjects.Graphics;
  cooldown: number;   // ms; >0 = dormant after a recent kill
  emerging: boolean;  // currently spawning a monster
  emergeT:  number;   // 0..MONSTER_EMERGE_MS
  pulseT:   number;   // continuous animation timer (s)
}

// ─── Sea rock obstacle ─────────────────────────────────────────
interface Rock {
  x: number;
  y: number;
  r: number;  // collision radius (also used as visual size base)
}

const ROCK_COUNT  = 22;
const ROCK_HIT_CD = 1500; // ms between rock damage ticks
const SHIP_R      = 18;   // ship collision radius

// ─── Port stations ─────────────────────────────────────────────
interface PortStation {
  kind:  PortStationKind;
  name:  string;
  icon:  string;
  color: number;       // roof / accent color (hex)
  x:     number;
  y:     number;
}

const STATION_RANGE = 130; // px — interaction proximity
const PORT_STATIONS: PortStation[] = [
  { kind: 'merchant', name: '鱼贩',   icon: '🐟', color: 0xf0d060, x: 60, y: 380 },
  { kind: 'repair',   name: '修船人', icon: '🔧', color: 0x80c0e0, x: 60, y: 600 },
  { kind: 'tackle',   name: '渔具店', icon: '🎣', color: 0xa0e080, x: 60, y: 820 },
  { kind: 'shipyard', name: '船坞',   icon: '⚙',  color: 0xa060c0, x: 60, y: 1020 },
];

const TREASURE_RANGE = 70;

export class GameScene extends Phaser.Scene {
  gs!: GameState;

  // World
  private shipGfx!:      Phaser.GameObjects.Graphics;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private sanVignette!:  Phaser.GameObjects.Graphics;

  // HUD
  private hpGfx!:      Phaser.GameObjects.Graphics;
  private sanGfx!:     Phaser.GameObjects.Graphics;
  private cargoGfx!:   Phaser.GameObjects.Graphics;
  private mapGfx!:     Phaser.GameObjects.Graphics;
  private goldTxt!:    Phaser.GameObjects.Text;
  private supplyTxt!:  Phaser.GameObjects.Text;
  private timerTxt!:    Phaser.GameObjects.Text;
  private cargoInfoTxt!: Phaser.GameObjects.Text;
  private zoneTxt!:    Phaser.GameObjects.Text;
  private phaseMsg!:   Phaser.GameObjects.Text;
  private warningTxt!: Phaser.GameObjects.Text;

  // UI panels
  private fishingWheel!:    FishingWheel;
  private portPanel!:       PortPanel;
  private cargoPanel!:      CargoPanel;
  private shipPartPanel!:   ShipPartPanel;
  private shipModulePanel!: ShipModulePanel;
  private lootPopup!:       LootDropPopup;
  private brokerDialogue!:  BrokerDialogue;
  private treasureMapOverlay!: TreasureMapOverlay;
  private shipLogOverlay!:     ShipLogOverlay;

  // Dock NPC (world-space character on the pier)
  private dockNpcGfx!:      Phaser.GameObjects.Graphics;
  private dockNpcLabel!:    Phaser.GameObjects.Text;

  // Treasure marker (hoarder daily mission)
  private treasureGfx!:     Phaser.GameObjects.Graphics;
  private treasurePulseT    = 0;

  // Merchant mission — drifting bottle + wreck + delivery island
  private bottleGfx!:        Phaser.GameObjects.Graphics;
  private bottlePulseT       = 0;
  private wreckGfx!:         Phaser.GameObjects.Graphics;
  private staticIslandGfx!:  Phaser.GameObjects.Graphics; // permanent islands
  private deliveryGfx!:      Phaser.GameObjects.Graphics; // mission-specific overlays
  private deliveryLabel!:    Phaser.GameObjects.Text;
  private merchantPulseT     = 0;

  // Port rest button (world-space, near the port sign)
  private restBtnGfx!:  Phaser.GameObjects.Graphics;
  private restBtnTxt!:  Phaser.GameObjects.Text;

  // Combat
  private monsters:        Monster[] = [];
  private monsterOriginMap: Map<Monster, MonsterZone> = new Map();
  private monsterZones:    MonsterZone[] = [];
  private balls:           Ball[] = [];
  private cannonCooldown   = 0;
  private harpoonCooldown  = 0;
  private autoFireTimer    = 0;   // ms until next auto-attack fires
  private combatMode: CombatMode = 'cannon';
  private combatModeTxt!: Phaser.GameObjects.Text;

  // SAN Hallucination system
  private phantoms:       { m: Monster; maxHp: number }[] = [];
  private phantomTimer    = 0;     // ms until next phantom check
  private hallucGfxR!:    Phaser.GameObjects.Graphics;  // red channel aberration
  private hallucGfxB!:    Phaser.GameObjects.Graphics;  // blue channel aberration
  private hallucMsgTimer  = 0;    // ms until next halluc warning text

  // Role-derived speed multiplier (applied after role selection)
  private shipSpdMult = 1.0;
  private cannonCDMult = 1.0;

  // Rocks (sea obstacles)
  private rocks:      Rock[] = [];
  private rockHitCD:  number = 0;

  // Port station prompt
  private nearestStation: PortStation | null = null;
  private stationPromptTxt!: Phaser.GameObjects.Text;


  // Boss
  private boss: Boss | null = null;
  private lairWarned = false;        // pop hint only once per night near lair
  private lairGfx!: Phaser.GameObjects.Graphics; // animated lair visuals
  private lairT = 0;

  // Fishing spots
  private spots: FishSpot[] = [];
  private spotRespawnTimer  = 0;   // ms; spawns 1 spot at 0 when below cap

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyE!:     Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyF!:     Phaser.Input.Keyboard.Key;
  private keyTab!:   Phaser.Input.Keyboard.Key;
  private keyR!:     Phaser.Input.Keyboard.Key;
  private keyZ!:     Phaser.Input.Keyboard.Key;
  private keyQ!:     Phaser.Input.Keyboard.Key;  // toggle combat mode
  private keyU!:     Phaser.Input.Keyboard.Key;  // use supply
  private keyM!:     Phaser.Input.Keyboard.Key;  // view treasure map
  private numKeys!:  Phaser.Input.Keyboard.Key[];

  constructor() { super('GameScene'); }

  // ═══════════════════════════════════════════════════════════
  create() {
    this.gs = new GameState();
    this.registry.set('gs', this.gs);

    // Apply role selection from StartScene
    const role = (this.registry.get('selectedRole') ?? 'helmsman') as RoleType;
    this.gs.role = role;
    this.applyRoleBonus(role);

    this.buildWorld();
    this.buildShip();
    this.buildDockNpc();
    this.buildRocks();
    this.buildMonsterZones();
    this.buildNightOverlay();
    this.buildSanVignette();
    this.buildHallucinationFx();
    this.buildHUD();
    this.buildPhaseMsg();
    this.setupInput();

    this.fishingWheel    = new FishingWheel(this, this.gs);
    this.cargoPanel      = new CargoPanel(this, this.gs);
    this.shipPartPanel   = new ShipPartPanel(this, this.gs);
    this.shipModulePanel = new ShipModulePanel(this, this.gs, (msg, col) => this.popHint(msg, col));
    this.lootPopup       = new LootDropPopup(this);
    this.treasureMapOverlay = new TreasureMapOverlay(this);
    this.shipLogOverlay     = new ShipLogOverlay(this);
    this.brokerDialogue  = new BrokerDialogue(
      this, this.gs,
      () => this.acceptDailyMission(),
      () => this.claimDailyMission(),
      (msg, col) => this.popHint(msg, col),
      () => this.openTreasureMap(),
      () => this.doIslandDeliver(),
    );
    this.portPanel     = new PortPanel(
      this, this.gs,
      (msg, col) => this.popHint(msg, col),
      (type) => this.onAcquire(type),
    );

    // Pointer events — cargo panel takes priority when open
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (this.cargoPanel.isOpen()) this.cargoPanel.handlePointerMove(ptr.x, ptr.y);
    });

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.cargoPanel.isOpen()) {
        this.cargoPanel.handlePointerDown(ptr.x, ptr.y, ptr.button);
        return;
      }
      if (this.portPanel.isOpen() || this.fishingWheel.isOpen()) return;
      if (ptr.button !== 0) return;
      // Route to whichever weapon the player is manually controlling
      if (this.combatMode === 'cannon') {
        this.shoot(ptr.worldX, ptr.worldY);
      } else {
        this.shootHarpoon(ptr.worldX, ptr.worldY);
      }
    });

    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (this.cargoPanel.isOpen()) {
        this.cargoPanel.handlePointerUp(ptr.x, ptr.y);
      }
    });

    // Disable browser context menu so right-click can rotate held items
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Seed initial fishing spots for the starting phase
    this.spotRespawnTimer = 0;
    for (const cfg of this.spotConfigs()) {
      for (let i = 0; i < cfg.cap; i++) this.spawnSpot(cfg.type, cfg.zone);
    }

    // First dock — daytime broker greets the player on the pier
    this.time.delayedCall(700, () => this.tryBrokerGreeting());
  }

  // ═══════════════════════════════════════════════════════════
  //  WORLD
  // ═══════════════════════════════════════════════════════════

  private buildWorld() {
    // Zone backgrounds (full world)
    const g = this.add.graphics();
    g.fillStyle(0x0d2a1c); g.fillRect(0, 0, ZONE_PORT_W, WORLD_H);
    g.fillStyle(0x091c30); g.fillRect(ZONE_PORT_W, 0, ZONE_SHALLOW_W, WORLD_H);
    g.fillStyle(0x050d1c); g.fillRect(DEEP_X, 0, DEEP_W, WORLD_H);

    // Subtle wave grid
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x1a3a54, 0.18);
    for (let y = 0; y < WORLD_H; y += 48)
      grid.lineBetween(ZONE_PORT_W, y, WORLD_W, y);
    for (let x = ZONE_PORT_W; x < WORLD_W; x += 62)
      grid.lineBetween(x, 0, x, WORLD_H);

    // Zone divider lines
    const div = this.add.graphics();
    div.lineStyle(2, 0x2a5878, 0.42);
    div.lineBetween(ZONE_PORT_W, 0, ZONE_PORT_W, WORLD_H);
    div.lineBetween(DEEP_X,     0, DEEP_X,     WORLD_H);

    // Big watermark characters scattered (more than one per zone since world is large)
    const gs = { fontSize: '120px', color: '#ffffff', fontStyle: 'bold' as const };
    for (let y = WORLD_H * 0.25; y < WORLD_H; y += WORLD_H * 0.5) {
      this.add.text(ZONE_PORT_W / 2,                  y, '港', gs).setOrigin(0.5).setAlpha(0.04);
      this.add.text(ZONE_PORT_W + ZONE_SHALLOW_W / 2, y, '浅', gs).setOrigin(0.5).setAlpha(0.03);
      this.add.text(DEEP_X + DEEP_W / 2,              y, '深', gs).setOrigin(0.5).setAlpha(0.025);
    }

    // World border (so player sees the edge of the sea)
    const border = this.add.graphics();
    border.lineStyle(3, 0x2a3850, 0.55);
    border.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Port boardwalk — a wooden plank running down the WEST edge of the port
    const dock = this.add.graphics();
    const dx = 12, dy = 280, dw = 100, dh = 640;
    dock.fillStyle(0x402818).fillRect(dx, dy, dw, dh);
    dock.lineStyle(2, 0x6a4a28, 0.85).strokeRect(dx, dy, dw, dh);
    // Plank divisions
    dock.lineStyle(1, 0x301810, 0.6);
    for (let py = dy + 24; py < dy + dh; py += 28) {
      dock.lineBetween(dx + 4, py, dx + dw - 4, py);
    }
    // Title at the very top of the boardwalk
    this.add.text(dx + dw / 2, dy - 18, '⚓  港  口', {
      fontSize: '20px', color: '#4ac878', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);

    // ── Rest button below the port sign ──────────────────────────
    const btnW = 80, btnH = 26;
    const btnX = dx + dw / 2 - btnW / 2;
    const btnY = dy + 8;
    this.restBtnGfx = this.add.graphics().setDepth(2);
    this.restBtnTxt = this.add.text(dx + dw / 2, btnY + btnH / 2, '🛏 休息', {
      fontSize: '13px', color: '#e0d0ff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(3);
    this.drawRestBtn();          // initial draw (daytime = dimmed)

    // Clickable zone
    const restZone = this.add.zone(btnX, btnY, btnW, btnH)
      .setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(4);
    restZone.on('pointerup', () => this.doRest());
    restZone.on('pointerover', () => {
      this.restBtnGfx.setAlpha(1.2);   // slight brighten on hover
    });
    restZone.on('pointerout', () => {
      this.restBtnGfx.setAlpha(1);
    });

    // Draw each station as a small wooden shed with colored roof + icon + name
    for (const st of PORT_STATIONS) this.drawStationStall(st);

    // Decorative water ripples scattered in the shallow + deep zones
    const ripples = this.add.graphics();
    ripples.fillStyle(0x1a4060, 0.45);
    for (let i = 0; i < 28; i++) {
      const rx = ZONE_PORT_W + 30 + Math.random() * (WORLD_W - ZONE_PORT_W - 60);
      const ry = 30 + Math.random() * (WORLD_H - 60);
      ripples.fillCircle(rx, ry, 6 + Math.random() * 6);
      ripples.fillCircle(rx + 5, ry - 4, 3 + Math.random() * 2);
    }

    // ─── Boss lair (sea-floor wreckage + static markers) ──────
    const lair = this.add.graphics().setDepth(2);
    // Dark stained pool
    lair.fillStyle(0x200810, 0.55).fillCircle(LAIR_CX, LAIR_CY, LAIR_R);
    lair.fillStyle(0x300814, 0.45).fillCircle(LAIR_CX, LAIR_CY, LAIR_R * 0.65);
    lair.fillStyle(0x400a18, 0.4).fillCircle(LAIR_CX, LAIR_CY, LAIR_R * 0.35);
    // Wreckage — broken ship beams + bones
    lair.lineStyle(3, 0x402818, 0.85);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const r1  = LAIR_R * 0.55 + Math.random() * 30;
      const r2  = r1 + 22 + Math.random() * 14;
      const x1  = LAIR_CX + Math.cos(ang) * r1;
      const y1  = LAIR_CY + Math.sin(ang) * r1;
      const x2  = LAIR_CX + Math.cos(ang + 0.4) * r2;
      const y2  = LAIR_CY + Math.sin(ang + 0.4) * r2;
      lair.lineBetween(x1, y1, x2, y2);
    }
    // Skull-like clusters (small dots)
    lair.fillStyle(0xa09080, 0.7);
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = Math.random() * LAIR_R * 0.85;
      lair.fillCircle(LAIR_CX + Math.cos(ang) * r, LAIR_CY + Math.sin(ang) * r, 1.5 + Math.random());
    }

    // Animated red mist + whirlpool layer (created here, drawn each frame)
    this.lairGfx = this.add.graphics().setDepth(3);
    this.treasureGfx     = this.add.graphics().setDepth(4);
    this.bottleGfx       = this.add.graphics().setDepth(4);
    this.wreckGfx        = this.add.graphics().setDepth(4);
    this.staticIslandGfx = this.add.graphics().setDepth(3);
    this.deliveryGfx     = this.add.graphics().setDepth(5);
    this.drawStaticIslands();
    this.deliveryLabel = this.add.text(0, 0, '', {
      fontSize: '11px', color: '#80d0ff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(5);
  }

  private buildShip() {
    this.shipGfx = this.add.graphics();
    this.shipGfx.setPosition(SHIP_START_X, SHIP_START_Y).setDepth(5);
    this.drawShip();

    // Main camera follows the ship across the open sea
    this.cameras.main
      .setBounds(0, 0, WORLD_W, WORLD_H)
      .startFollow(this.shipGfx, true, 0.1, 0.1)
      .setRoundPixels(true);
  }

  private drawShip(hit = false) {
    const g = this.shipGfx;
    g.clear();
    if (hit) {
      g.fillStyle(0xff4040, 0.9); g.fillCircle(0, 0, 28);
    }
    g.fillStyle(0xb87c30); g.fillTriangle(-22, 18, 22, 18, 0, -24);
    g.fillStyle(0x8a5e22); g.fillRect(-14, 8, 28, 10);
    g.fillStyle(0xeeeee0, 0.92); g.fillTriangle(-10, 8, 10, 8, 0, -18);
    g.fillStyle(0x6a4818); g.fillRect(-2, -20, 4, 30);
    g.fillStyle(0xe05050); g.fillTriangle(-2, -20, 8, -16, -2, -12);
  }

  private buildNightOverlay() {
    this.nightOverlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000820, 0)
      .setDepth(8).setScrollFactor(0);
  }

  private buildSanVignette() {
    this.sanVignette = this.add.graphics().setDepth(9).setScrollFactor(0);
  }

  private buildHallucinationFx() {
    // Two offset color-channel rectangles simulate chromatic aberration at low SAN
    this.hallucGfxR = this.add.graphics().setDepth(8.7).setScrollFactor(0).setAlpha(0);
    this.hallucGfxB = this.add.graphics().setDepth(8.7).setScrollFactor(0).setAlpha(0);

    this.hallucGfxR.fillStyle(0xff2020, 0.06).fillRect(-3, 0, W + 6, H);
    this.hallucGfxB.fillStyle(0x2040ff, 0.06).fillRect(3, 0, W + 6, H);
  }

  // ─── Role bonus application ────────────────────────────────
  private applyRoleBonus(role: RoleType) {
    switch (role) {
      case 'helmsman':
        this.shipSpdMult   = 1.30;
        break;
      case 'angler':
        // Hook bonus applied in FishingWheel per-role check
        break;
      case 'engineer':
        this.gs.roleBonusHp = 1;   // extra max HP via getter
        this.gs.hp = this.gs.maxHp; // fill to new max
        break;
      case 'gunner':
        this.cannonCDMult = 0.60;
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  HUD
  // ═══════════════════════════════════════════════════════════

  private buildHUD() {
    const D = HUD_D;
    // Top bar bg
    this.add.graphics().setDepth(D).setScrollFactor(0).fillStyle(0x000000, 0.7).fillRect(0, 0, W, HUD_H);
    // Bottom bar bg
    this.add.graphics().setDepth(D).setScrollFactor(0).fillStyle(0x000000, 0.5).fillRect(0, H - 28, W, 28);

    // Left: HP + SAN labels + blocks
    this.add.text(12, 9,  '船体', { fontSize: '10px', color: '#e07070' }).setDepth(D).setScrollFactor(0);
    this.add.text(12, 33, '精神', { fontSize: '10px', color: '#70a0e0' }).setDepth(D).setScrollFactor(0);
    this.hpGfx  = this.add.graphics().setDepth(D).setScrollFactor(0);
    this.sanGfx = this.add.graphics().setDepth(D).setScrollFactor(0);

    // Center: gold + supply + day/night timer
    this.goldTxt   = this.add.text(290, HUD_H / 2, '', { fontSize: '13px', color: '#f0d060', stroke: '#000', strokeThickness: 2 }).setDepth(D).setScrollFactor(0).setOrigin(0.5);
    this.supplyTxt = this.add.text(420, HUD_H / 2, '', { fontSize: '13px', color: '#70e0a0', stroke: '#000', strokeThickness: 2 }).setDepth(D).setScrollFactor(0).setOrigin(0.5);
    this.timerTxt  = this.add.text(550, HUD_H / 2, '', { fontSize: '13px', color: '#e0e0e0', stroke: '#000', strokeThickness: 2 }).setDepth(D).setScrollFactor(0).setOrigin(0.5);

    // Right: cargo summary bar (graphical) + cargo text
    this.cargoGfx = this.add.graphics().setDepth(D).setScrollFactor(0);
    this.cargoInfoTxt = this.add.text(W - 100, HUD_H / 2, '', { fontSize: '11px', color: '#a07850', stroke: '#000', strokeThickness: 1 }).setDepth(D + 1).setScrollFactor(0).setOrigin(0.5);

    // Bottom zone label
    this.zoneTxt = this.add.text(W / 2, H - 14, '', { fontSize: '11px', color: '#8aacd0', stroke: '#000', strokeThickness: 1 }).setDepth(D).setScrollFactor(0).setOrigin(0.5);

    // Role indicator (top-left, below HP/SAN)
    const roleDef = ROLES.find(r => r.key === (this.registry.get('selectedRole') ?? 'helmsman'))!;
    if (roleDef) {
      this.add.text(12, HUD_H + 6, `${roleDef.icon} ${roleDef.name}`, {
        fontSize: '11px', color: '#' + roleDef.color.toString(16).padStart(6, '0'),
        stroke: '#000', strokeThickness: 2,
      }).setDepth(D).setScrollFactor(0);
    }

    // Minimap (bottom-right corner, above bottom bar)
    this.mapGfx = this.add.graphics().setDepth(D).setScrollFactor(0);

    // Combat warning (just below HUD)
    this.warningTxt = this.add.text(W / 2, HUD_H + 26, '', {
      fontSize: '13px', color: '#e05050', fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
    }).setDepth(12).setScrollFactor(0).setOrigin(0.5).setAlpha(0);

    // Station proximity prompt (just above bottom bar)
    this.stationPromptTxt = this.add.text(W / 2, H - 50, '', {
      fontSize: '14px', color: '#fce84a', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setDepth(12).setScrollFactor(0).setOrigin(0.5).setAlpha(0);

    // Combat mode indicator (top-center, below timer)
    this.combatModeTxt = this.add.text(W / 2, HUD_H + 6, '', {
      fontSize: '11px', color: '#60e0ff', stroke: '#000', strokeThickness: 2,
    }).setDepth(D).setScrollFactor(0).setOrigin(0.5).setAlpha(0);
  }

  private buildPhaseMsg() {
    this.phaseMsg = this.add.text(W / 2, H / 2, '', {
      fontSize: '42px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(15).setScrollFactor(0).setAlpha(0);
  }

  private _lastHp = -1;

  private refreshHUD() {
    const s = this.gs;
    const BW = 18, BH = 13, BG = 4, LX = 70;

    // When HP is fully restored (repair), clear part damage indicators
    if (s.hp >= s.maxHp && this._lastHp < s.maxHp && this._lastHp >= 0) {
      this.shipPartPanel.repair();
    }
    this._lastHp = s.hp;

    // Update rest button appearance each frame (day/night state changes)
    this.drawRestBtn();

    // HP blocks
    this.hpGfx.clear();
    for (let i = 0; i < s.maxHp; i++) {
      this.hpGfx.fillStyle(i < s.hp ? 0xe04040 : 0x321818);
      this.hpGfx.fillRoundedRect(LX + i * (BW + BG), 9, BW, BH, 3);
    }

    // SAN blocks
    this.sanGfx.clear();

    // Violent shake when SAN <= 1 (not daytime, not at port)
    const sanCritical = s.san <= 1 && !s.isDay && s.currentZone !== 'port';
    if (sanCritical) {
      // High-frequency random shake: up to ±4px, resampled every frame
      const shakeAmp = s.san === 0 ? 5 : 3;
      const ox = (Math.random() - 0.5) * 2 * shakeAmp;
      const oy = (Math.random() - 0.5) * 2 * shakeAmp;
      this.sanGfx.setPosition(ox, oy);
    } else {
      this.sanGfx.setPosition(0, 0);
    }

    const sanCol = [0xe06060, 0xe09030, 0xe0c030, 0x80c040, 0x40d080];
    for (let i = 0; i < MAX_SAN; i++) {
      const filled = i < s.san;
      // Critical: last filled bar pulses between red and orange
      let col = filled ? sanCol[i] : 0x1a2030;
      if (filled && sanCritical && i === s.san - 1) {
        col = Math.sin(Date.now() * 0.01) > 0 ? 0xff2020 : 0xff8020;
      }
      this.sanGfx.fillStyle(col);
      this.sanGfx.fillRoundedRect(LX + i * (BW + BG), 33, BW, BH, 3);
    }

    // Center texts
    this.goldTxt.setText(`🪙 ${s.gold}`);
    // Supply shown only when player has some (pure consumable, not required)
    this.supplyTxt.setText(s.supply > 0 ? `🛢 ×${s.supply}` : '').setAlpha(s.supply > 0 ? 1 : 0);
    const sec = Math.ceil(Math.max(0, s.timeLeft) / 1000);
    const phaseIcon = s.isDay ? '☀' : '🌙';
    const phaseCol  = s.isDay ? '#f0d060' : '#a0a0f0';
    this.timerTxt.setColor(phaseCol).setText(`${phaseIcon} ${sec}s`);

    // Right: cargo bar
    const fish  = s.cargoCount('fish');
    const dfish = s.cargoCount('deep_fish');
    const glow  = s.cargoCount('glow_fish');
    const loot  = s.cargoCount('loot');
    const total = s.cargoItems.length;
    const MAX_ITEMS = 7;

    this.cargoGfx.clear();
    const bx = W - 192, by = 8, bw = 180, bh = 42;
    this.cargoGfx.fillStyle(0x0a1018, 0.65).fillRoundedRect(bx, by, bw, bh, 5);
    this.cargoGfx.lineStyle(1, 0x402818, 0.6).strokeRoundedRect(bx, by, bw, bh, 5);
    if (total > 0) {
      this.cargoGfx.fillStyle(0x604020, 0.5)
        .fillRoundedRect(bx + 2, by + 2, Math.min((bw - 4) * total / MAX_ITEMS, bw - 4), bh - 4, 4);
    }
    this.cargoInfoTxt.setText(`🐟${fish} 🐠${dfish} ✨${glow} ⚔${loot}`).setPosition(bx + bw / 2, by + bh / 2);

    const cargoFull = s.isCargoFull() ? '  ⚠货舱已满' : '';
    const nearSpot  = this.findNearestSpotInRange();
    const fishHint  = nearSpot ? `[ F ] 钓鱼  (余 ${nearSpot.stock})` : '寻找海面冒泡处';

    // Boss progression hint (deep zone night-time)
    let bossHint = '';
    if (s.currentZone === 'deep' && !s.isDay && !s.bossDefeated) {
      const dist = this.distToLair();
      if (dist < LAIR_R + 80) {
        if (!s.hasArmor || !s.hasHook) {
          const missing: string[] = [];
          if (!s.hasArmor) missing.push('船甲');
          if (!s.hasHook)  missing.push('高级钓钩');
          bossHint = `   ☠ 巢穴 — 需${missing.join('+')} 才能挑战`;
        } else {
          bossHint = '   ☠ 巢穴临近 — 准备战斗';
        }
      }
    }

    // Hint about lurking zones when in deep at night and no monsters yet
    let zoneHint = '';
    if (s.currentZone === 'deep' && !s.isDay && this.monsters.length === 0 && !this.boss) {
      const nearest = this.nearestMonsterZoneDist();
      if (nearest < MONSTER_ZONE_R + 60) {
        zoneHint = '   🌫 暗流涌动 — 警惕紫色水域';
      }
    }

    // Combat mode badge (only at night / deep)
    if (!s.isDay && s.currentZone === 'deep') {
      const modeIcon  = this.combatMode === 'cannon' ? '🚢' : '🗡';
      const modeName  = this.combatMode === 'cannon' ? '炮台模式 (Q切换)' : '水手模式 (Q切换)';
      const autoName  = this.combatMode === 'cannon' ? '鱼叉自动' : '炮台自动';
      this.combatModeTxt
        .setText(`${modeIcon} ${modeName}  |  ${autoName}`)
        .setAlpha(0.85)
        .setColor(this.combatMode === 'cannon' ? '#f0c060' : '#60e0ff');
    } else {
      this.combatModeTxt.setAlpha(0);
    }

    const fireHint = this.combatMode === 'cannon' ? '[ 点击 ] 开炮' : '[ 点击 ] 射鱼叉';

    let missionHint = '';
    const am = s.activeMission;
    if (am) {
      const dlText = deadlineText(am, s.dayIndex);
      missionHint = `   📜 ${missionProgressText(am)}  (${dlText})`;
      if (am.faction === 'hoarder' && am.progress < am.target) {
        if (this.nearTreasure()) {
          missionHint += '  [ E ] 发掘宝箱';
        } else {
          missionHint += '  [ M ] 查看藏宝图';
        }
      }
      if (am.faction === 'merchant' && am.progress < am.target) {
        if (!am.bottleFound) {
          missionHint += '  · 在浅海寻找漂流瓶';
        } else {
          missionHint += '  [ M ] 查看航运日志';
        }
      }
    }

    const zoneLabels: Record<string, string> = {
      port:    `⚓ 港口  ${am ? missionHint : '白天靠岸后委托人会来找你'}  [ Tab ] 货仓${cargoFull}`,
      shallow: s.isDay ? `🎣 浅海  ${fishHint}${missionHint}${cargoFull}` : `🌊 浅海${cargoFull}`,
      deep:    s.isDay
                 ? `🌊 深海  ${fishHint}${missionHint}${cargoFull}`
                 : `⚠ 深海  ${fireHint}   ${fishHint}${missionHint}${cargoFull}${bossHint}${zoneHint}`,
    };
    this.zoneTxt.setText(zoneLabels[s.currentZone] ?? '');

    // Minimap (bottom-right)
    this.drawMinimap();

    // SAN vignette
    this.sanVignette.clear();
    if (s.san <= 2) {
      const a = s.san === 0 ? 0.34 : s.san === 1 ? 0.2 : 0.1;
      this.sanVignette.fillStyle(0x600000, a);
      this.sanVignette.fillRect(0, 0, W, H);
    }

    // (cooldowns are ticked in the main update loop)
  }

  // Mini map (bottom-right corner)
  private drawMinimap() {
    const g = this.mapGfx;
    g.clear();
    const MMW = 140;
    const MMH = Math.round(MMW * (WORLD_H / WORLD_W));
    const MX  = W - MMW - 10;
    const MY  = H - 28 - MMH - 8;

    // Outer frame
    g.fillStyle(0x000000, 0.7).fillRoundedRect(MX - 2, MY - 2, MMW + 4, MMH + 4, 4);

    // Zone bands (scaled to minimap)
    const sx     = MMW / WORLD_W;
    const portW  = Math.round(ZONE_PORT_W * sx);
    const shalW  = Math.round(ZONE_SHALLOW_W * sx);
    g.fillStyle(0x163a26, 0.95).fillRect(MX,                MY, portW,           MMH);
    g.fillStyle(0x132440, 0.95).fillRect(MX + portW,        MY, shalW,           MMH);
    g.fillStyle(0x0a1428, 0.95).fillRect(MX + portW + shalW, MY, MMW - portW - shalW, MMH);

    // Border
    g.lineStyle(1, 0x6a5230, 0.85).strokeRoundedRect(MX - 2, MY - 2, MMW + 4, MMH + 4, 4);

    // Rocks — small dark gray dots (sized to actual rock radius)
    for (const rk of this.rocks) {
      const px = MX + rk.x * sx;
      const py = MY + rk.y * (MMH / WORLD_H);
      const rr = Math.max(1.2, rk.r * sx * 0.85);
      g.fillStyle(0x5a4a3c, 0.95).fillCircle(px, py, rr);
    }

    // Port stations — small colored squares
    for (const st of PORT_STATIONS) {
      const sx0 = MX + st.x * sx;
      const sy0 = MY + st.y * (MMH / WORLD_H);
      g.fillStyle(st.color, 0.95).fillRect(sx0 - 2, sy0 - 2, 4, 4);
      g.lineStyle(1, 0x000000, 0.6).strokeRect(sx0 - 2, sy0 - 2, 4, 4);
    }

    // Fishing spots — tiny dots
    for (const sp of this.spots) {
      const px = MX + sp.x * sx;
      const py = MY + sp.y * (MMH / WORLD_H);
      g.fillStyle(0xffffff, 0.65).fillCircle(px, py, 1.5);
    }

    // Monster lurking zones — purple markers (intensified during emergence)
    for (const z of this.monsterZones) {
      const px = MX + z.cx * sx;
      const py = MY + z.cy * (MMH / WORLD_H);
      const onCd = z.cooldown > 0;
      const baseA = this.gs.isDay ? 0.35 : onCd ? 0.35 : 0.75;
      g.fillStyle(0x8030c0, baseA).fillCircle(px, py, 1.8);
      if (z.emerging) {
        const p = z.emergeT / MONSTER_EMERGE_MS;
        g.lineStyle(1, 0xe060ff, 0.6 + 0.4 * Math.sin(z.pulseT * 12));
        g.strokeCircle(px, py, 3 + p * 3);
      } else if (!this.gs.isDay && !onCd) {
        g.lineStyle(1, 0x6020a0, 0.45);
        g.strokeCircle(px, py, 3);
      }
    }

    // Lair marker on minimap
    const lx = MX + LAIR_CX * sx;
    const ly = MY + LAIR_CY * (MMH / WORLD_H);
    if (this.gs.bossDefeated) {
      // Defeated: small golden checkmark
      g.lineStyle(2, 0xffd040, 0.95);
      g.lineBetween(lx - 3, ly,     lx - 1, ly + 2);
      g.lineBetween(lx - 1, ly + 2, lx + 3, ly - 2);
    } else {
      // Active: pulsing red X
      const ap = 0.55 + 0.45 * Math.sin(this.lairT * 1.4);
      g.lineStyle(2, 0xe04040, ap);
      g.lineBetween(lx - 3, ly - 3, lx + 3, ly + 3);
      g.lineBetween(lx + 3, ly - 3, lx - 3, ly + 3);
    }

    // Treasure marker (hoarder mission) — only shown once the ship is within 150px
    const tm = this.gs.activeMission;
    if (tm?.faction === 'hoarder' && tm.progress < tm.target &&
        tm.markerX !== undefined && tm.markerY !== undefined) {
      const distToTreasure = Phaser.Math.Distance.Between(
        this.shipGfx.x, this.shipGfx.y, tm.markerX, tm.markerY,
      );
      if (distToTreasure < 150) {
        const tx = MX + tm.markerX * sx;
        const ty = MY + tm.markerY * (MMH / WORLD_H);
        const pulse = 0.6 + 0.4 * Math.sin(this.treasurePulseT * 0.006);
        g.lineStyle(2, 0xffd040, pulse);
        g.lineBetween(tx - 4, ty - 4, tx + 4, ty + 4);
        g.lineBetween(tx + 4, ty - 4, tx - 4, ty + 4);
        g.fillStyle(0xffd040, 0.25).fillCircle(tx, ty, 6);
      }
    }

    // Merchant mission markers on minimap
    const mm = this.gs.activeMission;
    if (mm?.faction === 'merchant') {
      if (mm.progress < mm.target) {
        if (!mm.bottleFound && mm.bottleX !== undefined) {
          // Before bottle found: green dot for bottle in shallow zone
          const bx = MX + mm.bottleX * sx;
          const by = MY + mm.bottleY! * (MMH / WORLD_H);
          g.fillStyle(0x88cc88, 0.9).fillCircle(bx, by, 3);
          g.lineStyle(1, 0x224422, 0.7).strokeCircle(bx, by, 5);
        } else if (mm.bottleFound && mm.wreckY !== undefined) {
          // After bottle: show only a vague N/S band in the deep-sea portion — no precise dot
          const deepMX  = MX + (ZONE_PORT_W + ZONE_SHALLOW_W) * sx;
          const deepMW  = MMW - (ZONE_PORT_W + ZONE_SHALLOW_W) * sx;
          const relY    = mm.wreckY / WORLD_H;
          const bandY   = relY < 0.5 ? MY : MY + Math.round(MMH / 2);
          g.fillStyle(0x3a70b0, 0.20).fillRect(deepMX, bandY, deepMW, Math.round(MMH / 2));
          g.lineStyle(1, 0x5090c0, 0.35).strokeRect(deepMX, bandY, deepMW, Math.round(MMH / 2));
        }
      }
      if (mm.deliveryX !== undefined) {
        const dix = MX + mm.deliveryX * sx;
        const diy = MY + mm.deliveryY! * (MMH / WORLD_H);
        g.fillStyle(0x40e080, 0.9).fillCircle(dix, diy, 3);
        g.lineStyle(1, 0x80ffb0, 0.7).strokeCircle(dix, diy, 5);
      }
    }

    // Boss alive marker (large red dot)
    if (this.boss?.alive) {
      const bx = MX + this.boss.x * sx;
      const by = MY + this.boss.y * (MMH / WORLD_H);
      g.fillStyle(0xff4040, 1).fillCircle(bx, by, 3.5);
      g.lineStyle(1, 0xff8080, 0.7).strokeCircle(bx, by, 6);
    }

    // Monsters — agile = pink, tank = red
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const mmx = MX + m.x * sx;
      const mmy = MY + m.y * (MMH / WORLD_H);
      const col = m.kind === 'agile' ? 0xff60c0 : 0xe04040;
      g.fillStyle(col, 0.95).fillCircle(mmx, mmy, m.kind === 'agile' ? 2 : 3);
    }

    // Ship dot (yellow) + halo
    const px = MX + this.shipGfx.x * sx;
    const py = MY + this.shipGfx.y * (MMH / WORLD_H);
    g.lineStyle(1, 0xfff080, 0.45).strokeCircle(px, py, 5);
    g.fillStyle(0xfff080, 1).fillCircle(px, py, 2.8);

    // Viewport rect (shows what's currently visible)
    const cam = this.cameras.main;
    const vx  = MX + cam.scrollX * sx;
    const vy  = MY + cam.scrollY * (MMH / WORLD_H);
    const vw  = (cam.width  / WORLD_W) * MMW;
    const vh  = (cam.height / WORLD_H) * MMH;
    g.lineStyle(1, 0xffffff, 0.32).strokeRect(vx, vy, vw, vh);
  }

  // ═══════════════════════════════════════════════════════════
  //  INPUT
  // ═══════════════════════════════════════════════════════════

  private setupInput() {
    const kb = this.input.keyboard!;
    this.cursors  = kb.createCursorKeys();
    this.keyW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyE     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyF     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyTab   = kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, false, false);
    this.keyR     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyZ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.keyQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyU     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.U);
    this.keyM     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    // Prevent Tab from moving browser focus
    this.input.keyboard!.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.numKeys  = [
      Phaser.Input.Keyboard.KeyCodes.ONE,   Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE, Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,  Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN, Phaser.Input.Keyboard.KeyCodes.EIGHT,
    ].map(k => kb.addKey(k));
  }

  // ═══════════════════════════════════════════════════════════
  //  UPDATE
  // ═══════════════════════════════════════════════════════════

  update(_time: number, delta: number) {
    // Loot drop popup: highest priority — E to collect, blocks everything else
    if (this.lootPopup.isOpen()) {
      this.lootPopup.update(delta);
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.lootPopup.collect();
      this.refreshHUD();
      return;
    }

    // While cargo panel is open: handle Tab close + R rotate + Z discard + U use-supply
    if (this.cargoPanel.isOpen()) {
      if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.cargoPanel.handleRotate();
      if (Phaser.Input.Keyboard.JustDown(this.keyZ)) {
        const discarded = this.cargoPanel.handleDiscard();
        if (discarded) this.popHint('已丢弃', '#a08060');
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyU)) {
        const used = this.cargoPanel.handleUseSupply();
        if (used) {
          this.popHint('🛢 使用补给！精神恢复 +2', '#70e0a0');
        } else if (this.gs.san > 1) {
          this.popHint('精神值充足，无需使用补给', '#a0a040');
        } else {
          this.popHint('货舱中没有补给桶', '#a06040');
        }
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyTab)) {
        if (this.cargoPanel.close()) { /* closed ok */ }
        else this.popHint('必须先放置或按 [ Z ] 丢弃', '#e09040');
      }
      this.refreshHUD();
      return;
    }

    // Tab → open cargo panel (only when no other UI is up)
    if (Phaser.Input.Keyboard.JustDown(this.keyTab) &&
        !this.portPanel.isOpen() && !this.fishingWheel.isOpen()) {
      this.cargoPanel.open();
      this.refreshHUD();
      return;
    }

    if (this.treasureMapOverlay.isOpen()) {
      if (Phaser.Input.Keyboard.JustDown(this.keyE) ||
          Phaser.Input.Keyboard.JustDown(this.keyM)) {
        this.treasureMapOverlay.handleKey('E');
      }
      this.refreshHUD();
      return;
    }

    if (this.shipLogOverlay.isOpen()) {
      if (Phaser.Input.Keyboard.JustDown(this.keyE) ||
          Phaser.Input.Keyboard.JustDown(this.keyM)) {
        this.shipLogOverlay.handleKey('E');
      }
      this.refreshHUD();
      return;
    }

    if (this.brokerDialogue.isOpen()) {
      const esc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      if (Phaser.Input.Keyboard.JustDown(esc)) this.brokerDialogue.handleKey('ESC');
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.brokerDialogue.handleKey('E');
      if (Phaser.Input.Keyboard.JustDown(this.numKeys[0])) this.brokerDialogue.handleKey('ONE');
      this.refreshHUD();
      return;
    }

    if (this.shipModulePanel.isOpen()) {
      const esc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      if (Phaser.Input.Keyboard.JustDown(esc)) this.shipModulePanel.handleKey('ESC');
      if (Phaser.Input.Keyboard.JustDown(this.numKeys[0])) this.shipModulePanel.handleKey('ONE');
      if (Phaser.Input.Keyboard.JustDown(this.numKeys[1])) this.shipModulePanel.handleKey('TWO');
      this.refreshHUD();
      return;
    }

    if (this.portPanel.isOpen()) {
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.portPanel.close();
      this.numKeys.forEach((k, i) => { if (Phaser.Input.Keyboard.JustDown(k)) this.portPanel.doAction(i); });
      this.updateStationPrompt();
      this.refreshHUD();
      return;
    }

    if (this.fishingWheel.isOpen()) {
      this.fishingWheel.update(delta);
      if (Phaser.Input.Keyboard.JustDown(this.keyF) ||
          Phaser.Input.Keyboard.JustDown(this.keySpace)) this.fishingWheel.tryFish();
      this.refreshHUD();
      return;
    }

    // Normal game update
    this.cannonCooldown  = Math.max(0, this.cannonCooldown  - delta);
    this.harpoonCooldown = Math.max(0, this.harpoonCooldown - delta);
    this.moveShip(delta);
    this.resolveRockCollisions(delta);
    this.detectZone();
    this.tickDayNight(delta);
    this.updateSpots(delta);
    this.updateCombat(delta);
    this.updateStationPrompt();
    this.shipPartPanel.update(delta);
    this.updateTreasureMarker(delta);
    this.updateBottleMarker(delta);
    this.updateMerchantMarkers(delta);
    this.updateDockNpc();
    this.refreshHUD();

    if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (this.tryDigTreasure()) return;
      if (this.tryCollectBottle()) return;
      if (this.trySalvageWreck()) return;
      if (this.tryDeliverCargo()) return;
      if (this.gs.currentZone !== 'port') {
        this.popHint('需要在港口靠近站点才能交互', '#e09040');
      } else if (this.nearestStation) {
        if (this.nearestStation.kind === 'shipyard') {
          this.shipModulePanel.openPanel();
        } else {
          this.portPanel.open(this.nearestStation.kind);
        }
      } else if (this.tryTalkBroker()) {
        // handled
      } else {
        this.popHint('靠近码头委托人或站点才能交互', '#e09040');
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyF) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace)) this.tryStartFishing();

    // [ Q ] — toggle combat mode between cannon and harpoon
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.combatMode = this.combatMode === 'cannon' ? 'harpoon' : 'cannon';
      this.autoFireTimer = 0;  // reset auto-fire so it doesn't fire immediately
      const label = this.combatMode === 'cannon'
        ? '🚢 切换为炮台模式 — 手动开炮，鱼叉自动攻击'
        : '🗡 切换为水手模式 — 手动鱼叉，炮台自动攻击';
      this.popHint(label, '#60e0ff');
    }

    // [M] — re-open treasure map (hoarder) or ship log (merchant, only after bottle found)
    if (Phaser.Input.Keyboard.JustDown(this.keyM)) {
      const m = this.gs.activeMission;
      if (m?.faction === 'hoarder' && m.progress < m.target) {
        this.openTreasureMap();
      } else if (m?.faction === 'merchant' && m.progress < m.target) {
        if (m.bottleFound) {
          this.openShipLog();
        } else {
          this.popHint('先在浅海找到漂流瓶，才能读取日志', '#88cc88');
        }
      }
    }
  }

  // ─── Ship movement ──────────────────────────────────────────

  private moveShip(delta: number) {
    const spd = SHIP_SPD * this.shipSpdMult * (delta / 1000);
    const dx  = (this.cursors.left.isDown  || this.keyA.isDown ? -1 : 0)
              + (this.cursors.right.isDown || this.keyD.isDown ?  1 : 0);
    const dy  = (this.cursors.up.isDown    || this.keyW.isDown ? -1 : 0)
              + (this.cursors.down.isDown  || this.keyS.isDown ?  1 : 0);

    let newX = Phaser.Math.Clamp(this.shipGfx.x + dx * spd, 22, WORLD_W - 22);
    // Soft barrier: don't let the ship sail "onto" the boardwalk
    if (newX < 130) newX = 130;
    // Block leaving port only if SAN = 0 (complete breakdown)
    if (newX >= ZONE_PORT_W && this.gs.currentZone === 'port') {
      if (this.gs.san <= 0) { this.popHint('⚠ 精神崩溃！必须先休息', '#e04040'); return; }
    }

    this.shipGfx.x = newX;
    this.shipGfx.y = Phaser.Math.Clamp(this.shipGfx.y + dy * spd, 22, WORLD_H - 22);
  }

  // ─── Zone ───────────────────────────────────────────────────

  private detectZone() {
    const x    = this.shipGfx.x;
    const prev = this.gs.currentZone;
    const next: Zone =
      x < ZONE_PORT_W                   ? 'port' :
      x < ZONE_PORT_W + ZONE_SHALLOW_W  ? 'shallow' : 'deep';

    if (prev !== next) { this.gs.currentZone = next; this.onZoneEnter(next, prev); }
  }

  private onZoneEnter(to: Zone, from: Zone) {
    const s = this.gs;
    if (from === 'port') {
      if (!s.isDay && !s.leftPortTonight) {
        s.leftPortTonight = true;
        s.san = Math.max(0, s.san - 1);
        this.popHint('夜间出海 — 精神 -1', '#e09040');
      } else if (s.isDay) {
        this.popHint('⛵ 出海', '#70d890');
      }
    }
    if (to === 'port') {
      this.popHint('⚓ 返回港口', '#4ac878');
      s.suppliedThisVoyage = false;
      this.time.delayedCall(350, () => this.tryBrokerGreeting());
    }
  }

  // ─── Combat ─────────────────────────────────────────────────

  private updateCombat(delta: number) {
    const s = this.gs;

    // Lair + monster zones animate every frame (day or night)
    this.updateLairVisual(delta);
    this.updateMonsterZones(delta);

    if (s.isDay) {
      // Day: no monster / boss combat
      this.warningTxt.setAlpha(0);
      this.updateBalls(delta);
      return;
    }

    // ─── Boss handling ─────────────────────────────────────
    this.tryTriggerBoss();
    if (this.boss) {
      const inDeep = s.currentZone === 'deep';
      const touched = this.boss.update(delta, this.shipGfx.x, this.shipGfx.y, inDeep);
      if (touched) {
        this.boss.damageCooldown = 2400;
        this.onShipHit(BOSS_DMG, 'boss', this.boss.x, this.boss.y);
      }
      const d = Phaser.Math.Distance.Between(this.boss.x, this.boss.y, this.shipGfx.x, this.shipGfx.y);
      if (d < 220) {
        const blink = Math.sin(Date.now() * 0.008) > 0;
        this.warningTxt.setText(blink ? '⚠⚠  远海之主！全力开炮！' : '').setColor('#ff5050').setAlpha(1);
      } else this.warningTxt.setAlpha(0);
    } else if (this.monsters.length > 0) {
      // ─── Regular monsters (spawned from zones) ───────────
      const inDeep = s.currentZone === 'deep';
      let closestDist = Infinity;
      let closestKind = '';
      for (let i = this.monsters.length - 1; i >= 0; i--) {
        const m = this.monsters[i];
        if (!m.alive) { this.monsters.splice(i, 1); continue; }
        const touched = m.update(delta, this.shipGfx.x, this.shipGfx.y, inDeep);
        if (touched) {
          m.damageCooldown = m.hitRadius > 20 ? 1800 : 3600;
          this.onShipHit(m.dmg, 'monster', m.x, m.y);
        }
        const d = Phaser.Math.Distance.Between(m.x, m.y, this.shipGfx.x, this.shipGfx.y);
        if (d < closestDist) { closestDist = d; closestKind = m.kind; }
      }
      if (closestDist < 200) {
        const blink = Math.sin(Date.now() * 0.008) > 0;
        const typeLabel = closestKind === 'agile' ? '⚡ 敏捷生物' : '🔴 巨型生物';
        this.warningTxt.setText(blink ? `⚠ ${typeLabel}接近！` : '').setColor('#e05050').setAlpha(1);
      } else this.warningTxt.setAlpha(0);
    } else {
      this.warningTxt.setAlpha(0);
    }

    // ─── Auto-attack (the weapon NOT in manual control) ────
    this.updateAutoFire(delta);

    // Cannonballs + harpoons
    this.updateBalls(delta);

    // SAN hallucination effects (night only)
    this.updateHallucinations(delta);
  }

  // ─── Auto-fire (the weapon not under manual control) ──────────

  /** Returns the nearest live enemy position, or null. */
  private nearestEnemy(): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;

    if (this.boss?.alive) {
      best  = { x: this.boss.x, y: this.boss.y };
      bestD = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, this.boss.x, this.boss.y);
    }
    for (const m of this.monsters) {
      if (!m.alive || m.isPhantom) continue;
      const d = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, m.x, m.y);
      if (d < bestD) { bestD = d; best = { x: m.x, y: m.y }; }
    }
    return best;
  }

  private updateAutoFire(delta: number) {
    const s = this.gs;
    if (s.isDay || s.currentZone !== 'deep') { this.autoFireTimer = 0; return; }

    this.autoFireTimer -= delta;
    if (this.autoFireTimer > 0) return;

    const target = this.nearestEnemy();
    if (!target) return;

    if (this.combatMode === 'cannon') {
      // Auto harpoon fires toward nearest enemy
      if (this.harpoonCooldown <= 0) {
        this.shootHarpoon(target.x, target.y, true);
        this.autoFireTimer = HARPOON_COOLDOWN;
      }
    } else {
      // Auto cannon fires toward nearest enemy (slower, single shot)
      if (this.cannonCooldown <= 0) {
        this.shoot(target.x, target.y, true);
        this.autoFireTimer = CANNON_COOLDOWN * this.cannonCDMult * 1.4; // auto fires a bit slower
      }
    }
  }

  // ─── SAN Hallucination system ─────────────────────────────────

  private updateHallucinations(delta: number) {
    const s   = this.gs;
    const san = s.san;

    // ── Chromatic aberration overlay ────────────────────────
    // SAN ≤ 1: show colour-channel split, intensity grows with depletion
    const aberAlpha = san <= 1 ? (1 - san / 2) * 0.55 : 0;
    this.hallucGfxR.setAlpha(aberAlpha);
    this.hallucGfxB.setAlpha(aberAlpha);

    if (!s.isDay && san <= 1 && s.currentZone === 'deep' && !this.boss) {
      // ── Phantom spawn ────────────────────────────────────
      this.phantomTimer -= delta;
      if (this.phantomTimer <= 0) {
        // Spawn interval: 25s at SAN=1, 15s at SAN=0
        this.phantomTimer = 15000 + san * 10000;
        this.spawnPhantom();
      }

      // ── Hallucination warning flicker ────────────────────
      this.hallucMsgTimer -= delta;
      if (this.hallucMsgTimer <= 0 && san <= 0) {
        this.hallucMsgTimer = 6000 + Math.random() * 4000;
        const msgs = ['它们来了……', '眼前的是真实的吗？', '这不是真的……', '逃开！逃开！'];
        this.popHint(msgs[Math.floor(Math.random() * msgs.length)], '#c040c0');
      }
    }

    // ── Update phantoms ──────────────────────────────────────
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const ph = this.phantoms[i];
      if (!ph.m.alive) {
        this.phantoms.splice(i, 1);
        continue;
      }
      const inDeep = s.currentZone === 'deep';
      const touched = ph.m.update(delta, this.shipGfx.x, this.shipGfx.y, inDeep);
      if (touched && ph.m.damageCooldown <= 0) {
        ph.m.damageCooldown = 2000;
        this.onShipHit(1, 'monster', ph.m.x, ph.m.y);
      }
    }

    // Clean up phantoms when day breaks or SAN recovers
    if (s.isDay || san >= MAX_SAN) {
      this.clearPhantoms();
    }
  }

  private spawnPhantom() {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 320 + Math.random() * 120;
    const px    = this.shipGfx.x + Math.cos(angle) * dist;
    const py    = this.shipGfx.y + Math.sin(angle) * dist;
    const m     = new Monster(this, px, py);
    // Make it look ghostly — low HP, faded
    m.hp = 1;
    (m as any).gfx?.setAlpha(0.45);   // semi-transparent
    this.phantoms.push({ m, maxHp: 1 });

    // Delayed phantom reveal hint
    this.time.delayedCall(400, () => {
      if (this.gs.san <= 2) this.popHint('幻觉浮现……', '#8030a0');
    });
  }

  private clearPhantoms() {
    for (const ph of this.phantoms) ph.m.destroy();
    this.phantoms = [];
    this.phantomTimer = 0;
  }

  // Handle phantom taking a cannonball hit (called from updateBalls)
  private hitPhantom(ph: { m: Monster; maxHp: number }) {
    ph.m.alive = false;
    ph.m.destroy();
    this.phantoms = this.phantoms.filter(p => p !== ph);
    this.popHint('幻觉消散……', '#a060c0');
    // No loot, slight SAN recovery
    this.gs.san = Math.min(this.gs.san + 0.3, MAX_SAN);
  }

  // ─── Port rest button ────────────────────────────────────────

  private drawRestBtn() {
    const dx = 12, dy = 280, dw = 100;
    const btnW = 80, btnH = 26;
    const btnX = dx + dw / 2 - btnW / 2;
    const btnY = dy + 8;
    const active = this.gs.currentZone === 'port';  // active whenever in port
    const bg   = active ? 0x4a3068 : 0x2a2030;
    const bdr  = active ? 0xb090e0 : 0x504060;
    this.restBtnGfx.clear()
      .fillStyle(bg,  1).fillRoundedRect(btnX, btnY, btnW, btnH, 6)
      .lineStyle(1.5, bdr, 1).strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
    this.restBtnTxt.setColor(active ? '#e0d0ff' : '#806090');
  }

  // ─── Port stations ────────────────────────────────────────────

  private drawStationStall(st: PortStation) {
    const g = this.add.graphics().setDepth(4);
    const x = st.x;
    const y = st.y;

    // Soft shadow under the stall
    g.fillStyle(0x000000, 0.30).fillEllipse(x, y + 26, 64, 14);

    // Wooden body
    g.fillStyle(0x6a4a28).fillRect(x - 26, y - 4, 52, 30);
    g.lineStyle(2, 0x402818).strokeRect(x - 26, y - 4, 52, 30);
    // Door / shutter
    g.fillStyle(0x402818).fillRect(x - 8, y + 6, 16, 20);

    // Roof (colored — accent for the station)
    g.fillStyle(st.color);
    g.fillTriangle(x - 32, y - 4, x + 32, y - 4, x, y - 26);
    g.lineStyle(1.5, 0x000000, 0.5);
    g.lineBetween(x - 32, y - 4, x, y - 26);
    g.lineBetween(x +  0, y - 26, x + 32, y - 4);

    // Roof flag / chimney (small)
    g.fillStyle(0x8a6840).fillRect(x - 1, y - 32, 2, 8);

    // Hanging icon (drawn as a text emoji)
    this.add.text(x, y + 16, st.icon, {
      fontSize: '14px',
    }).setOrigin(0.5).setDepth(5);

    // Name plaque under the stall
    this.add.text(x, y + 42, st.name, {
      fontSize: '12px', color: '#f0e0c0', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5);
  }

  // ─── Sea rocks (obstacles) ────────────────────────────────────

  private buildRocks() {
    let attempts = 0;
    while (this.rocks.length < ROCK_COUNT && attempts < 600) {
      attempts++;
      // Random position in shallow + deep zones (skip port area)
      const x = ZONE_PORT_W + 60 + Math.random() * (WORLD_W - ZONE_PORT_W - 120);
      const y = 40 + Math.random() * (WORLD_H - 80);
      const r = 16 + Math.random() * 16; // 16..32

      if (!this.rockOk(x, y, r)) continue;
      this.addRock(x, y, r);
    }
  }

  // Reject placements too close to important locations
  private rockOk(x: number, y: number, r: number): boolean {
    // Ship spawn (give a clear lane out of port)
    if (Phaser.Math.Distance.Between(x, y, SHIP_START_X, SHIP_START_Y) < 220) return false;
    // Keep a horizontal corridor at SHIP_START_Y so the player has an obvious exit lane
    if (Math.abs(y - SHIP_START_Y) < 50 && x < ZONE_PORT_W + 320) return false;
    // Boss lair (need open arena for the fight)
    if (Phaser.Math.Distance.Between(x, y, LAIR_CX, LAIR_CY) < LAIR_R + 40) return false;
    // Monster zones (need fight room)
    for (const z of MONSTER_ZONE_POS) {
      if (Phaser.Math.Distance.Between(x, y, z.cx, z.cy) < MONSTER_ZONE_R - 20) return false;
    }
    // Other rocks — keep edge-to-edge gap > ship diameter (36) so the player can navigate
    for (const rk of this.rocks) {
      if (Phaser.Math.Distance.Between(x, y, rk.x, rk.y) < rk.r + r + 48) return false;
    }
    return true;
  }

  private addRock(x: number, y: number, r: number) {
    const g    = this.add.graphics().setDepth(4);
    const seed = Math.random() * 6.28;

    // Soft foam ring at the waterline
    g.lineStyle(2, 0xaaccdd, 0.30).strokeCircle(x, y, r + 5);
    g.lineStyle(1, 0xc8e4f0, 0.20).strokeCircle(x, y, r + 9);

    // Drop shadow under the rock
    g.fillStyle(0x000000, 0.30).fillCircle(x, y + 2, r + 1);

    // Dark base mass (irregular silhouette via overlapping lobes)
    g.fillStyle(0x352c28);
    g.fillCircle(x, y, r);
    const lobes = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < lobes; i++) {
      const ang  = seed + (i / lobes) * Math.PI * 2;
      const dist = r * (0.35 + Math.random() * 0.18);
      const lr   = r * (0.55 + Math.random() * 0.22);
      g.fillCircle(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, lr);
    }

    // Lighter top face (sun-lit slope)
    g.fillStyle(0x554a40);
    g.fillCircle(x - r * 0.15, y - r * 0.32, r * 0.55);
    g.fillStyle(0x6b5b4c, 0.85);
    g.fillCircle(x - r * 0.28, y - r * 0.42, r * 0.30);

    // Optional moss/highlight
    if (Math.random() < 0.6) {
      g.fillStyle(0x3a4824, 0.70);
      g.fillCircle(x + r * 0.20, y - r * 0.08, r * 0.18);
    }
    // White rim flecks
    g.fillStyle(0xb0bcc0, 0.55);
    g.fillCircle(x - r * 0.45, y - r * 0.10, 1.6);
    g.fillCircle(x + r * 0.40, y + r * 0.18, 1.3);

    this.rocks.push({ x, y, r });
  }

  // Push the ship out of rocks and deal damage on contact (with cooldown)
  private resolveRockCollisions(delta: number) {
    this.rockHitCD = Math.max(0, this.rockHitCD - delta);
    let hitThisFrame = false;
    let hitRockX = 0, hitRockY = 0;

    for (const rk of this.rocks) {
      const dx = this.shipGfx.x - rk.x;
      const dy = this.shipGfx.y - rk.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      const minDist = rk.r + SHIP_R;
      if (d >= minDist) continue;

      // Push ship outward
      if (d < 0.001) {
        this.shipGfx.x += SHIP_R + 2;
      } else {
        const push = minDist - d + 2;
        this.shipGfx.x = Phaser.Math.Clamp(this.shipGfx.x + (dx / d) * push, 22, WORLD_W - 22);
        this.shipGfx.y = Phaser.Math.Clamp(this.shipGfx.y + (dy / d) * push, 22, WORLD_H - 22);
      }
      hitThisFrame = true;
      hitRockX = rk.x; hitRockY = rk.y;
    }

    if (hitThisFrame && this.rockHitCD === 0 && this.gs.hp > 0) {
      this.rockHitCD = ROCK_HIT_CD;
      this.onShipHit(1, 'rock', hitRockX, hitRockY);
    }
  }

  // ─── Monster lurking zones ────────────────────────────────────

  private buildMonsterZones() {
    for (let i = 0; i < MONSTER_ZONE_POS.length; i++) {
      const z = MONSTER_ZONE_POS[i];
      this.monsterZones.push({
        cx:       z.cx,
        cy:       z.cy,
        gfx:      this.add.graphics().setDepth(3),
        // Stagger initial dormancy so zones don't all trigger the moment you enter deep sea
        cooldown: i * 8000,
        emerging: false,
        emergeT:  0,
        pulseT:   Math.random() * Math.PI * 2,
      });
    }
    // Initial paint
    for (const z of this.monsterZones) this.drawMonsterZone(z);
  }

  private updateMonsterZones(delta: number) {
    const s = this.gs;
    const ds = delta / 1000;

    for (const z of this.monsterZones) {
      z.pulseT  += ds;
      z.cooldown = Math.max(0, z.cooldown - delta);

      // Day or boss fight → all zones forced calm
      if (s.isDay || this.boss) {
        if (z.emerging) { z.emerging = false; z.emergeT = 0; }
        this.drawMonsterZone(z);
        continue;
      }

      const playerInside = Phaser.Math.Distance.Between(
        this.shipGfx.x, this.shipGfx.y, z.cx, z.cy,
      ) < MONSTER_ZONE_R;

      if (z.emerging) {
        if (!playerInside) {
          z.emerging = false;
          z.emergeT  = 0;
          this.popHint('🌫 你逃出了险境...', '#80a0c0');
        } else {
          z.emergeT += delta;
          if (z.emergeT >= MONSTER_EMERGE_MS && this.monsters.length < 2) {
            z.emerging = false;
            z.emergeT  = 0;
            this.spawnMonsterFromZone(z);
          }
        }
      } else if (
        z.cooldown === 0 &&
        this.monsters.length < 2 &&
        playerInside &&
        s.currentZone === 'deep'
      ) {
        z.emerging = true;
        z.emergeT  = 0;
        this.popHint('🌫 水面有动静...', '#c050e0');
      }

      this.drawMonsterZone(z);
    }
  }

  private drawMonsterZone(z: MonsterZone) {
    const g = z.gfx;
    g.clear();

    const isDay      = this.gs.isDay;
    const onCooldown = z.cooldown > 0;
    // Idle visibility — fainter during day, faint when dormant
    const baseAlpha = isDay
      ? 0.10
      : onCooldown ? 0.14 : 0.28;

    // Soft dark patch (always present so player can learn locations)
    const pulse = 28 + 4 * Math.sin(z.pulseT * 1.1);
    g.fillStyle(0x100420, baseAlpha * 0.7).fillCircle(z.cx, z.cy, 54);
    g.fillStyle(0x200840, baseAlpha)      .fillCircle(z.cx, z.cy, pulse);

    // Idle: a few sparse darker bubbles (only at night when active)
    if (!isDay && !onCooldown && !z.emerging) {
      const bc = 4;
      for (let i = 0; i < bc; i++) {
        const phase = (z.pulseT * 0.6 + i / bc) % 1;
        const bx    = z.cx + Math.cos((z.pulseT * 0.4 + i * 1.7)) * 14;
        const by    = z.cy + 18 - phase * 32;
        const a     = (1 - phase) * 0.45;
        g.fillStyle(0x6020a0, a).fillCircle(bx, by, 1.3 + (1 - phase) * 0.6);
      }
    }

    // Emergence: intensifying whirlpool + glow + eyes
    if (z.emerging) {
      const p = z.emergeT / MONSTER_EMERGE_MS; // 0..1

      // Outer dark glow grows
      g.fillStyle(0x300040, 0.35 + 0.35 * p)
        .fillCircle(z.cx, z.cy, 28 + 18 * p);

      // Whirlpool rings (spiral inward)
      const rings = 4;
      for (let i = 0; i < rings; i++) {
        const phase = (z.pulseT * 0.9 + i / rings) % 1;
        const r     = 14 + phase * (60 + 20 * p);
        const a     = (1 - phase) * (0.4 + 0.4 * p);
        g.lineStyle(2, 0xa050e0, a);
        g.strokeCircle(z.cx, z.cy, r);
      }

      // Rising dark bubbles (more numerous as emergence progresses)
      const bc = 4 + Math.floor(p * 6);
      for (let i = 0; i < bc; i++) {
        const phase = (z.pulseT * 1.4 + i / bc) % 1;
        const bx    = z.cx + Math.cos((z.pulseT * 0.7 + i * 1.3)) * (8 + p * 14);
        const by    = z.cy + 22 - phase * (36 + p * 14);
        const a     = (1 - phase) * (0.55 + 0.35 * p);
        g.fillStyle(0x8030c0, a).fillCircle(bx, by, 1.5 + (1 - phase) * 1.2);
      }

      // Eyes flicker in during the final 45% of emergence
      if (p > 0.55) {
        const ep = (p - 0.55) / 0.45;
        const ea = ep * (0.6 + 0.4 * Math.sin(z.pulseT * 14));
        g.fillStyle(0xff5060, Math.min(1, ea));
        g.fillCircle(z.cx - 6, z.cy - 3, 2.2);
        g.fillCircle(z.cx + 6, z.cy - 3, 2.2);
      }
    }

    // Cooldown indicator: faint dormant shimmer (small inner dot)
    if (onCooldown && !z.emerging) {
      g.fillStyle(0x402060, 0.22).fillCircle(z.cx, z.cy, 8);
    }
  }

  private spawnMonsterFromZone(z: MonsterZone) {
    // Randomly pick agile or tank — guarantee each night has both types if possible
    const hasAgile = this.monsters.some(m => m.kind === 'agile');
    const hasTank  = this.monsters.some(m => m.kind === 'tank');
    let kind: MonsterKind;
    if (!hasAgile && hasTank)       kind = 'agile';
    else if (hasAgile && !hasTank)  kind = 'tank';
    else                            kind = Math.random() < 0.5 ? 'agile' : 'tank';

    const m = new Monster(this, z.cx, z.cy, kind);
    this.monsters.push(m);
    this.monsterOriginMap.set(m, z);

    const label = kind === 'agile'
      ? '⚡ 敏捷生物涌出！— 行动迅速，难以瞄准'
      : '🔴 巨型生物涌出！— 动作缓慢但伤害极高';
    this.popHint(label, '#c050e0');
    this.cameras.main.shake(160, 0.005);
  }

  private nearestMonsterZoneDist(): number {
    let best = Infinity;
    for (const z of this.monsterZones) {
      const d = Phaser.Math.Distance.Between(
        this.shipGfx.x, this.shipGfx.y, z.cx, z.cy,
      );
      if (d < best) best = d;
    }
    return best;
  }

  // Find the closest in-range port station and update the on-screen prompt
  private updateStationPrompt() {
    // Sea interactions are checked first regardless of zone
    if (!this.brokerDialogue.isOpen()) {
      if (this.nearBottle()) {
        this.nearestStation = null;
        this.stationPromptTxt.setText('[ E ]  捡起漂流瓶').setAlpha(1);
        return;
      }
      if (this.nearWreck()) {
        this.nearestStation = null;
        this.stationPromptTxt.setText('[ E ]  打捞沉船').setAlpha(1);
        return;
      }
      if (this.nearDelivery()) {
        this.nearestStation = null;
        const dm = this.gs.activeMission;
        const hasBox = this.gs.cargoCount('cargo_crate') > 0;
        const label  = hasBox ? `[ E ]  交付货物 → ${dm?.deliveryName}` : `[ E ]  ${dm?.deliveryName}`;
        this.stationPromptTxt.setText(label).setAlpha(1);
        return;
      }
    }

    // Port-only interactions
    if (this.gs.currentZone !== 'port') {
      this.nearestStation = null;
      this.stationPromptTxt.setAlpha(0);
      return;
    }

    let best: PortStation | null = null;
    let bestD = STATION_RANGE;
    for (const st of PORT_STATIONS) {
      const d = Phaser.Math.Distance.Between(
        this.shipGfx.x, this.shipGfx.y, st.x, st.y,
      );
      if (d < bestD) { best = st; bestD = d; }
    }

    this.nearestStation = best;
    if (best && !this.portPanel.isOpen() && !this.brokerDialogue.isOpen()) {
      this.stationPromptTxt.setText(`[ E ]  ${best.name}`).setAlpha(1);
    } else if (
      this.dockNpcVisible() && this.nearDockNpc() &&
      !this.portPanel.isOpen() && !this.brokerDialogue.isOpen()
    ) {
      this.stationPromptTxt.setText('[ E ]  码头委托人').setAlpha(1);
    } else {
      this.stationPromptTxt.setAlpha(0);
    }
  }

  // ─── Boss / lair ──────────────────────────────────────────────

  // Animate the red mist + whirlpool over the lair
  private updateLairVisual(delta: number) {
    this.lairT += delta / 1000;
    const g = this.lairGfx;
    g.clear();

    if (this.gs.bossDefeated) return; // calm waters after victory

    // Red mist clouds drifting
    for (let i = 0; i < 4; i++) {
      const ang = this.lairT * 0.3 + (i * Math.PI / 2);
      const r   = LAIR_R * 0.55 + 25 * Math.sin(this.lairT * 0.6 + i);
      const cx  = LAIR_CX + Math.cos(ang) * r * 0.45;
      const cy  = LAIR_CY + Math.sin(ang) * r * 0.45;
      g.fillStyle(0x801030, 0.10).fillCircle(cx, cy, 36);
    }

    // Whirlpool rings
    for (let i = 0; i < 3; i++) {
      const phase = (this.lairT * 0.4 + i / 3) % 1;
      const r     = phase * LAIR_R;
      const a     = (1 - phase) * 0.35;
      g.lineStyle(1.5, 0xa03050, a);
      g.strokeCircle(LAIR_CX, LAIR_CY, r);
    }

    // Pulsing "X" marker at the dead center (only when boss not yet defeated)
    const pulse = 0.55 + 0.45 * Math.sin(this.lairT * 1.4);
    g.lineStyle(2, 0xe04040, pulse * 0.65);
    g.lineBetween(LAIR_CX - 10, LAIR_CY - 10, LAIR_CX + 10, LAIR_CY + 10);
    g.lineBetween(LAIR_CX + 10, LAIR_CY - 10, LAIR_CX - 10, LAIR_CY + 10);
  }

  // Distance from ship to lair center
  private distToLair(): number {
    return Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, LAIR_CX, LAIR_CY);
  }

  // Spawn boss when player enters the lair at night with prerequisites met
  private tryTriggerBoss() {
    const s = this.gs;
    if (this.boss || s.bossDefeated) return;
    if (s.isDay) return;
    if (s.currentZone !== 'deep') return;

    const d = this.distToLair();

    // Approach warning (once per night)
    if (d < LAIR_R + 60 && !this.lairWarned) {
      this.lairWarned = true;
      if (!s.hasArmor || !s.hasHook) {
        this.popHint('深处涌动着不祥的能量 — 你尚未做好准备', '#a06040');
      } else {
        this.popHint('远海之主就在前方 — 准备战斗！', '#e04040');
      }
    }

    // Inside the trigger radius
    if (d < LAIR_TRIGGER_R) {
      if (!s.hasArmor || !s.hasHook) {
        // Push the ship back, soft repel
        const dx = this.shipGfx.x - LAIR_CX;
        const dy = this.shipGfx.y - LAIR_CY;
        const m  = Math.sqrt(dx * dx + dy * dy) || 1;
        this.shipGfx.x += (dx / m) * 3;
        this.shipGfx.y += (dy / m) * 3;
        return;
      }
      this.spawnBoss();
    }
  }

  private spawnBoss() {
    this.boss = new Boss(this, LAIR_CX, LAIR_CY);
    // Dramatic intro
    this.cameras.main.shake(700, 0.012);
    const fl = this.add.rectangle(W / 2, H / 2, W, H, 0x600020, 0.45).setDepth(15).setScrollFactor(0);
    this.tweens.add({ targets: fl, alpha: 0, duration: 1100, onComplete: () => fl.destroy() });
    this.phaseMsg.setText('🦞  远海之主').setColor('#ff5050').setAlpha(1);
    this.tweens.add({ targets: this.phaseMsg, alpha: 0, delay: 2200, duration: 800 });
    this.popHint('击败远海之主即可通关 demo！', '#ffc080');

    // Clear regular monsters while boss is active
    for (const m of this.monsters) m.destroy();
    this.monsters = []; this.monsterOriginMap.clear();
    for (const z of this.monsterZones) { z.emerging = false; z.emergeT = 0; }
  }

  private onBossDefeated() {
    const s = this.gs;
    s.bossDefeated = true;
    s.gold += BOSS_REWARD_GOLD;

    // Massive death burst
    const bx = this.boss!.x, by = this.boss!.y;
    for (let i = 0; i < 10; i++) {
      const ring = this.add.graphics().setDepth(7);
      ring.lineStyle(3, 0xe04040, 0.85).strokeCircle(bx, by, 10 + i * 6);
      this.tweens.add({ targets: ring, scaleX: 2.6, scaleY: 2.6, alpha: 0, delay: i * 70, duration: 600, onComplete: () => ring.destroy() });
    }
    this.cameras.main.shake(1100, 0.015);
    this.cameras.main.flash(900, 200, 40, 40);

    this.boss?.destroy(); this.boss = null;

    // Victory message
    this.phaseMsg
      .setText('🏆  远海之主已被击败\n\nDemo 通关')
      .setColor('#ffe080').setAlpha(1).setFontSize(36);
    this.tweens.add({ targets: this.phaseMsg, alpha: 0, delay: 6000, duration: 1500,
      onComplete: () => this.phaseMsg.setFontSize(42) });
    this.popHint(`🏆 击败远海之主！+${BOSS_REWARD_GOLD} 金 — 战利品掉落`, '#ffe080');

    // Drop boss loot — reveal + manual placement
    this.onAcquire('loot');
  }

  private shoot(tx: number, ty: number, isAuto = false) {
    if (this.cannonCooldown > 0) return;
    if (this.gs.isDay) return;

    const sx  = this.shipGfx.x, sy = this.shipGfx.y;
    const dx  = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 10) return;

    // Auto-cannon always fires single shot; manual blast cannon fires spread
    const isBlast = !isAuto && this.gs.cannonTier === 1;

    const angles: number[] = isBlast ? [-0.22, 0, 0.22] : [0];
    const baseAngle = Math.atan2(dy, dx);

    for (const offset of angles) {
      const a  = baseAngle + offset;
      const vx = Math.cos(a) * BULLET_SPEED;
      const vy = Math.sin(a) * BULLET_SPEED;

      const gfx = this.add.graphics().setDepth(6);
      if (isBlast) {
        gfx.fillStyle(0xff6010, 0.92); gfx.fillCircle(0, 0, 6);
        gfx.fillStyle(0xffb040, 0.50); gfx.fillCircle(0, 0, 10);
        gfx.lineStyle(1.5, 0xff8020, 0.8); gfx.strokeCircle(0, 0, 6);
      } else {
        // Auto-cannon gets a slightly dimmer look to distinguish
        const col = isAuto ? 0x404040 : 0x202020;
        gfx.fillStyle(col, 0.90); gfx.fillCircle(0, 0, 5);
        gfx.lineStyle(1.5, 0x808080, 0.5); gfx.strokeCircle(0, 0, 5);
      }
      gfx.setPosition(sx, sy);
      this.balls.push({ gfx, x: sx, y: sy, vx, vy, isBlast, isHarpoon: false });
    }

    this.cannonCooldown = CANNON_COOLDOWN * this.cannonCDMult;

    if (!isAuto) {
      const flash = this.add.graphics().setDepth(6);
      if (isBlast) {
        flash.fillStyle(0xff8820, 0.90); flash.fillCircle(sx, sy, 16);
        flash.fillStyle(0xffcc60, 0.60); flash.fillCircle(sx, sy, 9);
      } else {
        flash.fillStyle(0xfff080, 0.85); flash.fillCircle(sx, sy, 10);
      }
      const dur = isBlast ? 220 : 150;
      this.tweens.add({ targets: flash, alpha: 0, scaleX: isBlast ? 3 : 2, scaleY: isBlast ? 3 : 2, duration: dur, onComplete: () => flash.destroy() });
      if (isBlast) this.popHint('💥 爆裂炮台：三联散射！', '#ff8020');
    }
  }

  // ─── Harpoon (player weapon) ──────────────────────────────────

  private shootHarpoon(tx: number, ty: number, isAuto = false) {
    if (this.harpoonCooldown > 0) return;
    if (this.gs.isDay) return;

    const sx  = this.shipGfx.x, sy = this.shipGfx.y;
    const dx  = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 10) return;

    const a  = Math.atan2(dy, dx);
    const vx = Math.cos(a) * HARPOON_SPEED;
    const vy = Math.sin(a) * HARPOON_SPEED;

    const gfx = this.add.graphics().setDepth(6);
    // Cyan needle: small and fast
    gfx.fillStyle(0x20d0e0, 0.92); gfx.fillCircle(0, 0, 3);
    gfx.lineStyle(1.5, 0x80ffff, 0.8); gfx.strokeCircle(0, 0, 3);
    // Tail line
    gfx.lineStyle(1, 0x40a0b0, 0.6);
    gfx.lineBetween(0, 0, -Math.cos(a) * 10, -Math.sin(a) * 10);
    gfx.setPosition(sx, sy);
    this.balls.push({ gfx, x: sx, y: sy, vx, vy, isBlast: false, isHarpoon: true });

    this.harpoonCooldown = HARPOON_COOLDOWN;

    if (!isAuto) {
      // Small cyan muzzle flash
      const flash = this.add.graphics().setDepth(6);
      flash.fillStyle(0x40e0ff, 0.75); flash.fillCircle(sx, sy, 6);
      this.tweens.add({ targets: flash, alpha: 0, scaleX: 2, scaleY: 2, duration: 120, onComplete: () => flash.destroy() });
    }
  }

  private updateBalls(delta: number) {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.x += b.vx * (delta / 1000);
      b.y += b.vy * (delta / 1000);
      b.gfx.setPosition(b.x, b.y);

      // Out of world bounds
      if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
        b.gfx.destroy(); this.balls.splice(i, 1); continue;
      }

      let hit = false;

      // Hit boss
      if (this.boss?.alive) {
        const dx = b.x - this.boss.x, dy = b.y - this.boss.y;
        if (Math.sqrt(dx * dx + dy * dy) < 34) {
          b.gfx.destroy(); this.balls.splice(i, 1);
          const dmg = b.isHarpoon ? 1 : 1;  // both weapons deal 1 dmg to boss per shot
          this.onBallHitBoss(b.x, b.y, b.isBlast, dmg);
          hit = true;
        }
      }
      if (hit) continue;

      // Hit any regular monster
      for (let mi = this.monsters.length - 1; mi >= 0; mi--) {
        const m = this.monsters[mi];
        if (!m.alive) continue;
        const dx = b.x - m.x, dy = b.y - m.y;
        if (Math.sqrt(dx * dx + dy * dy) < m.hitRadius + 4) {
          b.gfx.destroy(); this.balls.splice(i, 1);
          // Cannon: 2 dmg to tank, 1 dmg to agile. Harpoon: 1 dmg to both.
          const dmg = b.isHarpoon ? 1 : (m.kind === 'tank' ? 2 : 1);
          this.onBallHitMonster(m, b.x, b.y, b.isBlast, dmg);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      // Hit phantoms
      for (const ph of this.phantoms) {
        if (!ph.m.alive) continue;
        const dx = b.x - ph.m.x, dy = b.y - ph.m.y;
        if (Math.sqrt(dx * dx + dy * dy) < 20) {
          b.gfx.destroy(); this.balls.splice(i, 1);
          const ring = this.add.graphics().setDepth(7);
          ring.lineStyle(2, 0xc060d0, 0.9); ring.strokeCircle(b.x, b.y, 8);
          this.tweens.add({ targets: ring, scaleX: 4, scaleY: 4, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
          this.hitPhantom(ph);
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }
  }

  private onBallHitBoss(hx: number, hy: number, isBlast: boolean, dmg = 1) {
    if (!this.boss) return;
    const killed = this.boss.takeDamage(dmg);
    this.spawnHitFx(hx, hy, isBlast, 'boss');
    if (killed) this.onBossDefeated();
  }

  private onBallHitMonster(m: Monster, hx: number, hy: number, isBlast: boolean, dmg = 1) {
    const killed = m.takeDamage(dmg);
    this.spawnHitFx(hx, hy, isBlast, 'monster');
    if (killed) this.onMonsterKilled(m);
  }

  /** Shared hit visual effect — blast cannon gets a larger orange explosion */
  private spawnHitFx(hx: number, hy: number, isBlast: boolean, target: 'monster' | 'boss') {
    const ring = this.add.graphics().setDepth(7);
    if (isBlast) {
      // Fiery orange explosion rings
      ring.lineStyle(3, 0xff6010, 1); ring.strokeCircle(hx, hy, 10);
      ring.fillStyle(0xff8820, 0.55); ring.fillCircle(hx, hy, 8);
      this.tweens.add({ targets: ring, scaleX: 4.5, scaleY: 4.5, alpha: 0, duration: 450, ease: 'Power2', onComplete: () => ring.destroy() });
      // Secondary ember particles
      for (let e = 0; e < 5; e++) {
        const em = this.add.graphics().setDepth(7);
        const ex = hx + (Math.random() - 0.5) * 20;
        const ey = hy + (Math.random() - 0.5) * 20;
        em.fillStyle(0xff9030, 0.8); em.fillCircle(ex, ey, 3 + Math.random() * 3);
        this.tweens.add({ targets: em, alpha: 0, y: ey - 20, duration: 350 + Math.random() * 200, onComplete: () => em.destroy() });
      }
    } else {
      // Standard hit ring
      const col = target === 'boss' ? 0xff5050 : 0xe050e0;
      ring.lineStyle(2, col, 0.9); ring.strokeCircle(hx, hy, 6);
      this.tweens.add({ targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
    }
  }

  private onMonsterKilled(m: Monster) {
    const mx = m.x, my = m.y;
    m.destroy();
    const idx = this.monsters.indexOf(m);
    if (idx >= 0) this.monsters.splice(idx, 1);

    // Put the originating zone on cooldown
    const origin = this.monsterOriginMap.get(m);
    if (origin) {
      origin.cooldown = MONSTER_LAIR_CD;
      this.monsterOriginMap.delete(m);
    }

    // Death burst
    for (let i = 0; i < 6; i++) {
      const ring = this.add.graphics().setDepth(7);
      ring.lineStyle(2, 0xc040e0, 0.8); ring.strokeCircle(mx, my, 8 + i * 5);
      this.tweens.add({ targets: ring, scaleX: 1.8, scaleY: 1.8, alpha: 0, delay: i * 50, duration: 400, onComplete: () => ring.destroy() });
    }

    // Drop loot — reveal card + manual placement
    this.popHint('⚔ 击败怪物！战利品掉落', '#c060e0');
    this.onAcquire('loot');
    this.trackMissionKill();
  }

  private onShipHit(
    dmg: number = 1,
    source: 'monster' | 'boss' | 'rock' = 'monster',
    attackerX?: number,
    attackerY?: number,
  ) {
    const s = this.gs;
    s.hp = Math.max(0, s.hp - dmg);

    // SAN: only creature hits drain sanity (steering errors don't)
    if (source !== 'rock' && s.sanHitThisNight < 2) {
      s.san = Math.max(0, s.san - 1);
      s.sanHitThisNight++;
    }

    // ── Determine hit part & attack description ────────────
    const part = this.resolveHitPart(source, attackerX, attackerY);
    this.shipPartPanel.hit(part);

    const attackDesc = this.attackDescription(source, part);
    const msg = `💥 ${attackDesc}  HP -${dmg}  剩余 ${s.hp}/${s.maxHp}`;
    this.popHint(msg, '#e04040');

    this.drawShip(true);
    this.cameras.main.shake(dmg > 1 ? 380 : 220, dmg > 1 ? 0.014 : 0.008);
    this.time.delayedCall(130, () => this.drawShip());

    if (s.hp <= 0) {
      this.time.delayedCall(200, () => this.onShipSunk());
    }
  }

  /** Determine which ship part was hit based on attacker position / source. */
  private resolveHitPart(
    source: 'monster' | 'boss' | 'rock',
    ax?: number,
    ay?: number,
  ): ShipPart {
    const sx = this.shipGfx.x;
    const sy = this.shipGfx.y;

    if (source === 'boss') return 'bow';          // boss always charges head-on

    if (ax !== undefined && ay !== undefined) {
      const dx = ax - sx;  // positive = attacker to the right (bow side)
      const dy = ay - sy;  // positive = attacker below (starboard side)

      if (source === 'rock') {
        // Rock: side the ship sailed into
        return dy > 0 ? 'starboard' : 'port';
      }

      // Monster: use angle to determine attack type
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      if (absDx > absDy) {
        // More horizontal → bow (right) or stern (left)
        return dx > 0 ? 'bow' : 'stern';
      } else {
        // More vertical → port (above) or starboard (below)
        return dy < 0 ? 'port' : 'starboard';
      }
    }

    // Fallback: random side
    const sides: ShipPart[] = ['port', 'starboard'];
    return sides[Math.floor(Math.random() * sides.length)];
  }

  /** Human-readable attack description for the hint message. */
  private attackDescription(source: 'monster' | 'boss' | 'rock', part: ShipPart): string {
    const partName = { bow: '船头', port: '左舷', starboard: '右舷', stern: '船尾' }[part];
    if (source === 'rock') return `撞礁！${partName}受损`;
    if (source === 'boss') return `远海之主冲撞${partName}！`;
    // Monster — vary description based on part
    if (part === 'bow')       return `怪物从正面撞击${partName}！`;
    if (part === 'stern')     return `怪物拖拽${partName}！`;
    return `怪物夹持${partName}！`;
  }

  private onShipSunk() {
    const s = this.gs;
    s.clearCargo();
    s.hp = 1;

    // Clear monsters, boss, balls, and zone state
    for (const m of this.monsters) m.destroy();
    this.monsters = []; this.monsterOriginMap.clear();
    this.boss?.destroy(); this.boss = null;
    this.balls.forEach(b => b.gfx.destroy()); this.balls = [];
    for (const z of this.monsterZones) {
      z.emerging = false; z.emergeT = 0; z.cooldown = MONSTER_LAIR_CD;
    }
    this.lairWarned = false;
    this.clearPhantoms();

    // Teleport to port
    this.shipGfx.x = SHIP_START_X; this.shipGfx.y = SHIP_START_Y;
    s.currentZone = 'port';

    // Dramatic flash
    const fl = this.add.rectangle(W / 2, H / 2, W, H, 0xff2020, 0.7).setDepth(16).setScrollFactor(0);
    this.tweens.add({ targets: fl, alpha: 0, duration: 1200, ease: 'Power2', onComplete: () => fl.destroy() });

    this.phaseMsg.setText('💀  船沉了！').setColor('#ff4040').setAlpha(1).setDepth(16);
    this.tweens.add({ targets: this.phaseMsg, alpha: 0, delay: 2800, duration: 700 });

    this.popHint('船只沉没 — 货物全损，返回港口', '#e04040');
  }

  // ─── Inn / Rest ──────────────────────────────────────────────

  private doRest() {
    const s = this.gs;

    // Full SAN restore
    const sanGain = MAX_SAN - s.san;
    s.san = MAX_SAN;
    this.sanDrainAccum = 0;

    if (s.isDay) {
      // Daytime rest: skip directly to the next day
      this.popHint('🛏 休息至明日…', '#c0b0e0');
    }

    // Skip to daytime (next day)
    s.isDay    = true;
    s.timeLeft = DAY_MS;
    const restExpired = s.startNewDay();
    if (restExpired) this.popHint('⌛ 委托已过期——今天可接新委托', '#e06040');
    this.nightOverlay.setFillStyle(0x000820, 0);

    // Despawn any remaining threats
    for (const m of this.monsters) m.destroy();
    this.monsters = []; this.monsterOriginMap.clear();
    this.boss?.destroy(); this.boss = null;
    this.balls.forEach(b => b.gfx.destroy()); this.balls = [];
    for (const z of this.monsterZones) { z.emerging = false; z.emergeT = 0; }
    this.warningTxt.setAlpha(0);
    this.clearPhantoms();

    // Reset fishing spots for the new day
    this.clearSpots();
    this.spotRespawnTimer = 600;

    // Dawn flash
    const fl = this.add.rectangle(W / 2, H / 2, W, H, 0xfff8c0, 0.7)
      .setDepth(16).setScrollFactor(0);
    this.tweens.add({ targets: fl, alpha: 0, duration: 1400, ease: 'Power2', onComplete: () => fl.destroy() });

    this.phaseMsg.setText('☀  晨曦来临').setColor('#fce84a').setAlpha(1).setDepth(16);
    this.tweens.add({ targets: this.phaseMsg, alpha: 0, delay: 2400, duration: 700 });

    const sanMsg = sanGain > 0 ? `  精神恢复 +${sanGain}` : '';
    this.popHint(`🛏 安心休息了一夜，神清气爽${sanMsg}`, '#c0a0e0');
  }

  // ─── Fishing ────────────────────────────────────────────────

  private tryStartFishing() {
    const s = this.gs;
    if (s.isCargoFull()) { this.popHint('货仓已满！回港出售后再钓', '#e09040'); return; }
    if (s.currentZone === 'port') { this.popHint('港口不能钓鱼', '#e09040'); return; }

    const spot = this.findNearestSpotInRange();
    if (!spot) {
      this.popHint('附近没有鱼群 — 找找海面冒泡的地方', '#e09040');
      return;
    }

    this.fishingWheel.open(spot.type, (caught, itemType) => {
      if (!caught) return;

      spot.stock--;
      if (spot.stock <= 0) {
        this.removeSpot(spot);
        this.popHint('鱼群散了 — 别处会有新的钓点', '#80b8d8');
      } else {
        this.drawSpot(spot);
      }

      this.onAcquire(itemType);
    });
  }

  // ─── Fishing spots ──────────────────────────────────────────

  // Per-phase spot configuration: which fish types, how many, and which zone
  private spotConfigs(): { type: ItemType; cap: number; zone: 'shallow' | 'deep' }[] {
    const soulsActive = this.gs.activeMission?.faction === 'souls' &&
                        (this.gs.activeMission?.progress ?? 0) < (this.gs.activeMission?.target ?? 0);
    if (this.gs.isDay) return [
      { type: 'fish',      cap: SHALLOW_SPOT_CNT, zone: 'shallow' },
      { type: 'deep_fish', cap: DEEP_SPOT_CNT,    zone: 'deep'    },
      // Glow fish appear in deep sea during day when souls mission is active
      ...(soulsActive ? [{ type: 'glow_fish' as ItemType, cap: 1, zone: 'deep' as const }] : []),
    ];
    return [
      { type: 'glow_fish', cap: DEEP_SPOT_CNT, zone: 'deep' },
    ];
  }

  private spawnSpot(type: ItemType, zone: 'shallow' | 'deep') {
    let x = 0, y = 0;
    let tries = 0;

    do {
      if (zone === 'shallow') {
        x = ZONE_PORT_W + 30 + Math.random() * (ZONE_SHALLOW_W - 60);
      } else {
        x = DEEP_X + 30 + Math.random() * (DEEP_W - 60);
      }
      y = 60 + Math.random() * (WORLD_H - 120);
      tries++;
      if (tries > 12) break;
    } while (this.spotTooClose(x, y));

    // 2-3 underwater fish silhouettes drifting in different orbits
    const fishCount = 2 + Math.floor(Math.random() * 2);
    const fishSils: FishSil[] = [];
    for (let i = 0; i < fishCount; i++) {
      fishSils.push({
        angle:  Math.random() * Math.PI * 2,
        speed:  (0.35 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1),
        radius: 6 + Math.random() * 14,
        size:   7 + Math.random() * 3,
        phase:  Math.random() * Math.PI * 2,
      });
    }

    const spot: FishSpot = {
      gfx:    this.add.graphics().setDepth(9), // above night overlay
      x, y, type,
      stock:  FISH_SPOT_STOCK + Math.floor(Math.random() * 2),
      t:      0,
      bubbles: [],
      fishSils,
      ripples: [],
      bubbleTimer: 0,
      rippleTimer: 800 + Math.random() * 600,
    };
    this.spots.push(spot);
    this.drawSpot(spot);
  }

  private spotTooClose(x: number, y: number): boolean {
    // Keep spots away from each other (and from current ship pos)
    for (const s of this.spots) {
      if (Phaser.Math.Distance.Between(x, y, s.x, s.y) < 90) return true;
    }
    if (this.shipGfx &&
        Phaser.Math.Distance.Between(x, y, this.shipGfx.x, this.shipGfx.y) < 100) return true;
    // Don't drop spots inside rocks (player couldn't reach them)
    for (const rk of this.rocks) {
      if (Phaser.Math.Distance.Between(x, y, rk.x, rk.y) < rk.r + 35) return true;
    }
    return false;
  }

  private removeSpot(spot: FishSpot) {
    spot.gfx.destroy();
    this.spots = this.spots.filter(s => s !== spot);
  }

  private clearSpots() {
    for (const s of this.spots) s.gfx.destroy();
    this.spots = [];
  }

  private findNearestSpotInRange(): FishSpot | null {
    let best: FishSpot | null = null;
    let bestD = FISH_SPOT_RANGE;
    for (const s of this.spots) {
      const d = Phaser.Math.Distance.Between(s.x, s.y, this.shipGfx.x, this.shipGfx.y);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  private updateSpots(delta: number) {
    const configs = this.spotConfigs();
    const allowed = new Set(configs.map(c => c.type));

    // Drop spots whose type is no longer valid for this phase
    for (const s of [...this.spots]) {
      if (!allowed.has(s.type)) this.removeSpot(s);
    }

    // Find first under-stocked type
    const need = configs.find(cfg => this.spots.filter(s => s.type === cfg.type).length < cfg.cap);

    if (need) {
      this.spotRespawnTimer -= delta;
      if (this.spotRespawnTimer <= 0) {
        this.spawnSpot(need.type, need.zone);
        this.spotRespawnTimer = SPOT_RESPAWN_MS;
      }
    } else {
      this.spotRespawnTimer = SPOT_RESPAWN_MS;
    }

    // Animate every spot
    const ds = delta / 1000;
    for (const s of this.spots) {
      s.t += ds;

      // Spawn bubbles periodically
      s.bubbleTimer -= delta;
      if (s.bubbleTimer <= 0) {
        this.spawnBubble(s);
        s.bubbleTimer = 180 + Math.random() * 280;
      }

      // Spawn ripples occasionally
      s.rippleTimer -= delta;
      if (s.rippleTimer <= 0) {
        s.ripples.push({ r: 4, life: 1.0 });
        s.rippleTimer = 1800 + Math.random() * 1400;
      }

      // Tick bubbles
      for (const b of s.bubbles) {
        b.ox  += b.vx * ds;
        b.oy  += b.vy * ds;
        b.life -= b.decay * ds;
      }
      s.bubbles = s.bubbles.filter(b => b.life > 0);

      // Tick fish silhouettes
      for (const f of s.fishSils) {
        f.angle += f.speed * ds;
      }

      // Tick ripples
      for (const r of s.ripples) {
        r.r    += 18 * ds;
        r.life -= 0.55 * ds;
      }
      s.ripples = s.ripples.filter(r => r.life > 0);

      this.drawSpot(s);
    }
  }

  private spawnBubble(s: FishSpot) {
    const ang  = Math.random() * Math.PI * 2;
    const dist = Math.random() * 18;
    s.bubbles.push({
      ox:    Math.cos(ang) * dist,
      oy:    Math.sin(ang) * dist + 4,        // start slightly below center
      vy:    -6 - Math.random() * 8,           // drift up
      vx:    (Math.random() - 0.5) * 3,        // slight horizontal drift
      r:     1.2 + Math.random() * 1.8,
      life:  1.0,
      decay: 0.55 + Math.random() * 0.35,
    });
  }

  private drawSpot(s: FishSpot) {
    const g = s.gfx;
    g.clear();

    // Color palette by fish type
    let fishCol = 0xc8d4dc, bubCol = 0xffffff;
    if (s.type === 'deep_fish') { fishCol = 0x70b8e0; bubCol = 0xc0e0f0; }
    if (s.type === 'glow_fish') { fishCol = 0xa0c8e8; bubCol = 0xcfe0ff; }

    // ── Ripples (subtle expanding rings on the surface) ──────
    for (const r of s.ripples) {
      g.lineStyle(1, bubCol, r.life * 0.28);
      g.strokeCircle(s.x, s.y, r.r);
    }

    // ── Underwater fish silhouettes (drawn first, behind bubbles) ──
    for (const f of s.fishSils) {
      const fx = s.x + Math.cos(f.angle) * f.radius;
      const fy = s.y + Math.sin(f.angle) * f.radius;
      // Tangent (direction of swim)
      const tx = -Math.sin(f.angle) * (f.speed >= 0 ? 1 : -1);
      const ty =  Math.cos(f.angle) * (f.speed >= 0 ? 1 : -1);

      // Shimmer alpha (slow pulse so fish "fade" in and out)
      const shimmer = 0.16 + 0.10 * (0.5 + 0.5 * Math.sin(s.t * 1.4 + f.phase));
      g.fillStyle(fishCol, shimmer);

      // Body
      const sz = f.size;
      const bx = fx + tx * sz * 0.15;
      const by = fy + ty * sz * 0.15;
      g.fillEllipse(bx, by, sz, sz * 0.5);

      // Tail
      const t1x = bx - tx * sz * 0.55;
      const t1y = by - ty * sz * 0.55;
      const t2x = t1x - tx * sz * 0.35 - ty * sz * 0.28;
      const t2y = t1y - ty * sz * 0.35 + tx * sz * 0.28;
      const t3x = t1x - tx * sz * 0.35 + ty * sz * 0.28;
      const t3y = t1y - ty * sz * 0.35 - tx * sz * 0.28;
      g.fillTriangle(t1x, t1y, t2x, t2y, t3x, t3y);
    }

    // ── Bubbles (white dots, rising and fading) ──────────────
    for (const b of s.bubbles) {
      g.fillStyle(bubCol, b.life * 0.55);
      g.fillCircle(s.x + b.ox, s.y + b.oy, b.r);
      g.fillStyle(0xffffff, b.life * 0.85);
      g.fillCircle(s.x + b.ox - 0.4, s.y + b.oy - 0.5, b.r * 0.35);
    }
  }

  // ─── Day / Night ────────────────────────────────────────────

  private sanDrainAccum = 0; // accumulated ms for passive SAN drain

  private tickDayNight(delta: number) {
    const s = this.gs;
    s.timeLeft -= delta;
    if (s.timeLeft <= 0) this.flipPhase();
    this.nightOverlay.setFillStyle(0x000820, s.isDay ? 0 : 0.48);

    // ── Passive SAN drain at night when out at sea ─────────
    if (!s.isDay && s.currentZone !== 'port') {
      // Deep sea drains faster than shallow
      const drainInterval = s.currentZone === 'deep' ? 12000 : 20000; // ms per -1 SAN
      this.sanDrainAccum += delta;
      if (this.sanDrainAccum >= drainInterval) {
        this.sanDrainAccum -= drainInterval;
        if (s.san > 0) {
          s.san = Math.max(0, s.san - 1);
          const msgs = s.currentZone === 'deep'
            ? ['深海的黑暗侵蚀着你的神志…', '水下有什么在盯着你……', '耳边传来低沉的呜咽声…']
            : ['夜幕压得人喘不过气……', '黑暗中似乎有什么在移动……'];
          this.popHint(msgs[Math.floor(Math.random() * msgs.length)], '#7050b0');
        }
      }
    } else {
      this.sanDrainAccum = 0; // reset when day or in port
    }
  }

  private flipPhase() {
    const s = this.gs;
    const wasDay = s.isDay;
    s.isDay    = !s.isDay;
    s.timeLeft = s.isDay ? DAY_MS : NIGHT_MS;

    if (wasDay) {
      // → Night: arm danger zones; emergence happens on player approach
      s.leftPortTonight = false; s.sanHitThisNight = 0;
      this.lairWarned = false; // lair re-arms each night
      for (const z of this.monsterZones) {
        z.emerging = false; z.emergeT = 0; z.cooldown = 0;
      }
    } else {
      // → Day: despawn all monsters + boss, stop combat, refresh daily missions
      const missionExpired = s.startNewDay();
      if (missionExpired) {
        this.popHint('⌛ 委托已过期——任务失败，今天可接新委托', '#e06040');
        this.time.delayedCall(400, () => this.tryBrokerGreeting());
      } else if (s.activeMission) {
        const dlText = deadlineText(s.activeMission, s.dayIndex);
        this.popHint(`📜 委托进行中（${dlText}）`, '#c0a040');
      } else {
        this.time.delayedCall(400, () => this.tryBrokerGreeting());
      }
      for (const m of this.monsters) m.destroy();
      this.monsters = []; this.monsterOriginMap.clear();
      this.boss?.destroy(); this.boss = null;
      this.balls.forEach(b => b.gfx.destroy()); this.balls = [];
      for (const z of this.monsterZones) { z.emerging = false; z.emergeT = 0; }
      this.warningTxt.setAlpha(0);

      // SAN recovery if at port
      if (s.currentZone === 'port') {
        const rec = Math.min(MAX_SAN - s.san, 2);
        if (rec > 0) { s.san = Math.min(MAX_SAN, s.san + 2); this.popHint(`☀ 港口休息，精神恢复 +${rec}`, '#80d0f0'); }
      }
    }

    // Reset fishing spots for the new phase
    this.clearSpots();
    this.spotRespawnTimer = 600; // first spot appears ~0.6s into the new phase

    const fl = this.add.rectangle(W / 2, H / 2, W, H, wasDay ? 0x101830 : 0xfff8c0, 0.65).setDepth(10).setScrollFactor(0);
    this.tweens.add({ targets: fl, alpha: 0, duration: 900, ease: 'Power2', onComplete: () => fl.destroy() });

    const [msg, col] = s.isDay ? ['☀  白天来临', '#fce84a'] : ['🌙  夜幕降临', '#8090f8'];
    this.phaseMsg.setText(msg).setColor(col).setAlpha(1).setDepth(15);
    this.tweens.add({ targets: this.phaseMsg, alpha: 0, delay: 2400, duration: 700 });
  }

  // ─── Item acquisition (unified flow) ────────────────────────

  // Called after a successful catch, loot drop, or port purchase.
  // First-time items reveal a card; then the cargo panel opens for placement.
  private onAcquire(
    type: import('../GameState').ItemType,
    afterCollect?: () => void,
  ) {
    if (this.portPanel.isOpen()) this.portPanel.close();
    this.trackMissionCatch(type);

    // Show loot reveal popup first; cargo placement happens after player collects
    this.lootPopup.show(type, () => {
      const willFit = this.cargoPanel.beginPlacement(type);
      if (!willFit) {
        this.popHint('⚠ 货舱已满！按 [ Z ] 丢弃已有物品腾出空间', '#e09040');
      }
      if (afterCollect) afterCollect();
    });
  }

  // ─── Daily missions ───────────────────────────────────────────

  private acceptDailyMission() {
    if (!this.gs.acceptMission()) {
      this.popHint('今日委托接不了——可能已经接过了', '#e09040');
      return;
    }
    const m = this.gs.activeMission!;
    this.popHint(`📜 接下了：${m.title}`, '#e0c060');
    this.popHint(m.hint, '#8090a8');
  }

  private claimDailyMission() {
    this.gs.claimMission();
  }

  private openTreasureMap() {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'hoarder') return;
    this.treasureMapOverlay.open(m);
  }

  // ─── Dock NPC (pier broker) ───────────────────────────────────

  private buildDockNpc() {
    this.dockNpcGfx = this.add.graphics().setDepth(6);
    this.dockNpcLabel = this.add.text(DOCK_NPC_X, DOCK_NPC_Y - 54, '码头委托人', {
      fontSize: '11px', color: '#c0d0e0', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(7);
    this.drawDockNpcFigure();
    this.dockNpcGfx.setVisible(false);
    this.dockNpcLabel.setVisible(false);
  }

  private dockNpcVisible(): boolean {
    const s = this.gs;
    return s.currentZone === 'port' && s.isDay && !s.missionDoneToday;
  }

  private drawDockNpcFigure() {
    const g = this.dockNpcGfx;
    g.clear();
    const cx = DOCK_NPC_X;
    const cy = DOCK_NPC_Y;

    g.fillStyle(0x2a3848, 0.95);
    g.fillRoundedRect(cx - 22, cy + 6, 44, 28, 4);
    g.fillStyle(0x3a4858);
    g.fillRect(cx - 16, cy + 6, 32, 22);
    g.lineStyle(2, 0x506070);
    g.lineBetween(cx - 10, cy + 6, cx - 10, cy + 24);
    g.lineBetween(cx + 10, cy + 6, cx + 10, cy + 24);

    g.fillStyle(0xc89878).fillRect(cx - 6, cy - 2, 12, 8);
    g.fillStyle(0xd8a888).fillCircle(cx, cy - 12, 14);
    g.lineStyle(1, 0x000000, 0.15).strokeCircle(cx, cy - 12, 14);

    g.fillStyle(0x8a4030).fillEllipse(cx, cy - 22, 16, 8);
    g.fillStyle(0xa05040).fillRect(cx - 16, cy - 20, 32, 5);

    g.fillStyle(0x1a1018);
    g.fillCircle(cx - 5, cy - 13, 2);
    g.fillCircle(cx + 5, cy - 13, 2);

    g.lineStyle(1, 0x606060);
    g.lineBetween(cx + 8, cy - 8, cx + 16, cy - 6);
    g.fillStyle(0xff8040, 0.8).fillCircle(cx + 17, cy - 6, 1);
  }

  private updateDockNpc() {
    const visible = this.dockNpcVisible();
    this.dockNpcGfx.setVisible(visible);
    this.dockNpcLabel.setVisible(visible);
    if (visible) this.drawDockNpcFigure();
  }

  private nearDockNpc(): boolean {
    if (this.gs.currentZone !== 'port') return false;
    return Phaser.Math.Distance.Between(
      this.shipGfx.x, this.shipGfx.y, DOCK_NPC_X, DOCK_NPC_Y,
    ) < DOCK_NPC_RANGE;
  }

  /** Auto-greet when docking during daytime — DREDGE-style pier encounter. */
  private tryBrokerGreeting() {
    const s = this.gs;
    if (s.currentZone !== 'port' || !s.isDay || this.brokerDialogue.isOpen()) return;
    if (s.missionDoneToday) return;

    const active = s.activeMission;
    if (active) {
      if (canTurnIn(active, t => s.cargoCount(t))) {
        this.brokerDialogue.open('turnin');
      }
      return;
    }

    this.brokerDialogue.open('offer');
  }

  private tryTalkBroker(): boolean {
    if (!this.nearDockNpc() || !this.gs.isDay) return false;

    const s = this.gs;
    if (s.missionDoneToday) {
      this.popHint(dailyNpcDone(), '#8090a8');
      return true;
    }

    const active = s.activeMission;
    if (active) {
      if (canTurnIn(active, t => s.cargoCount(t))) {
        this.brokerDialogue.open('turnin');
      } else {
        this.brokerDialogue.open('remind');
      }
      return true;
    }

    this.brokerDialogue.open('offer');
    return true;
  }

  private nearTreasure(): boolean {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'hoarder' || m.progress >= m.target) return false;
    if (m.markerX === undefined || m.markerY === undefined) return false;
    return Phaser.Math.Distance.Between(
      this.shipGfx.x, this.shipGfx.y, m.markerX, m.markerY,
    ) < TREASURE_RANGE;
  }

  private tryDigTreasure(): boolean {
    const s = this.gs;
    const m = s.activeMission;
    if (!m || m.faction !== 'hoarder' || m.progress >= m.target) return false;
    if (!s.isDay || s.currentZone !== 'deep') return false;
    if (!this.nearTreasure()) return false;

    // Digging animation
    this.cameras.main.flash(500, 255, 210, 60);
    for (let i = 0; i < 6; i++) {
      const ring = this.add.graphics().setDepth(7);
      ring.lineStyle(2, 0xffd040, 0.85).strokeCircle(m.markerX!, m.markerY!, 8 + i * 5);
      this.tweens.add({
        targets: ring, scaleX: 2, scaleY: 2, alpha: 0,
        delay: i * 40, duration: 450,
        onComplete: () => ring.destroy(),
      });
    }

    // Treasure item goes into cargo — mission progress set after collecting
    this.onAcquire('treasure', () => {
      const act = this.gs.activeMission;
      if (act?.faction === 'hoarder') {
        act.progress = act.target;
        this.popHint('📦 宝箱放入货舱 — 回港交给委托人领赏', '#f0c060');
      }
    });
    return true;
  }

  private updateTreasureMarker(delta: number) {
    this.treasurePulseT += delta;
    const g = this.treasureGfx;
    g.clear();
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'hoarder' || m.progress >= m.target) return;
    if (m.markerX === undefined || m.markerY === undefined) return;

    const x = m.markerX, y = m.markerY;
    const dist = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, x, y);

    if (dist < 200) {
      // Close enough — show full golden X marker
      const pulse = 0.55 + 0.45 * Math.sin(this.treasurePulseT * 0.004);
      g.fillStyle(0xffd040, 0.10 + pulse * 0.08).fillCircle(x, y, 34 + pulse * 10);
      g.lineStyle(2, 0xffd040, 0.45 + pulse * 0.45);
      g.lineBetween(x - 14, y - 14, x + 14, y + 14);
      g.lineBetween(x + 14, y - 14, x - 14, y + 14);
      g.lineStyle(1, 0xffe080, 0.35).strokeCircle(x, y, 24);
    } else if (dist < 350) {
      // Getting warm — faint glow only (no X yet)
      const warmPulse = 0.3 + 0.2 * Math.sin(this.treasurePulseT * 0.003);
      g.fillStyle(0xffa020, warmPulse * 0.18).fillCircle(x, y, 28);
    }
  }

  private trackMissionKill() {
    // Souls mission is now daytime glow_fish — no kill tracking needed
  }

  // ─── Merchant: drifting bottle → torn log → wreck → delivery ─

  private readonly BOTTLE_RANGE   = 70;
  private readonly WRECK_RANGE    = 80;
  private readonly DELIVERY_RANGE = 90;

  private nearBottle(): boolean {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant' || m.bottleFound) return false;
    if (m.bottleX === undefined || m.progress >= m.target) return false;
    return Phaser.Math.Distance.Between(
      this.shipGfx.x, this.shipGfx.y, m.bottleX, m.bottleY!,
    ) < this.BOTTLE_RANGE;
  }

  private tryCollectBottle(): boolean {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant' || m.bottleFound) return false;
    if (!this.nearBottle()) return false;

    // Mark bottle as found
    m.bottleFound = true;

    // Splash + flash
    this.cameras.main.flash(300, 80, 180, 80);
    const ring = this.add.graphics().setDepth(7);
    ring.lineStyle(2, 0x88cc88, 0.8).strokeCircle(m.bottleX!, m.bottleY!, 16);
    this.tweens.add({
      targets: ring, scaleX: 2, scaleY: 2, alpha: 0, duration: 500,
      onComplete: () => ring.destroy(),
    });

    this.popHint('🍾 拾到漂流瓶 — 日志已解读，可前往打捞沉船', '#88cc88');
    this.openShipLog();
    return true;
  }

  private openShipLog() {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant') return;
    this.shipLogOverlay.open(m);
  }

  private updateBottleMarker(delta: number) {
    this.bottlePulseT += delta;
    const g = this.bottleGfx;
    g.clear();

    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant' || m.bottleFound) return;
    if (m.bottleX === undefined || m.progress >= m.target) return;

    const bx = m.bottleX;
    // Gentle bob: ±3px vertical sine
    const by = m.bottleY! + Math.sin(this.bottlePulseT * 0.002) * 3;
    const dist = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, bx, by);
    const pulse = 0.5 + 0.5 * Math.sin(this.bottlePulseT * 0.003);

    if (dist < 350) {
      // Ripple ring
      g.lineStyle(1, 0x88cc88, 0.20 + pulse * 0.15).strokeCircle(bx, by, 22 + pulse * 6);
      // Bottle body
      g.fillStyle(0x44aa44, 0.85).fillRoundedRect(bx - 5, by - 10, 10, 16, 3);
      // Cork / neck
      g.fillStyle(0xcc8833, 0.90).fillRect(bx - 3, by - 14, 6, 5);
      // Inner glow (paper inside)
      g.fillStyle(0xeedd99, 0.60).fillRoundedRect(bx - 3, by - 8, 6, 10, 2);
      // Highlight streak
      g.lineStyle(1, 0x88ff88, 0.45).lineBetween(bx - 2, by - 9, bx - 2, by + 3);
      if (dist < this.BOTTLE_RANGE) {
        // [E] proximity ring
        g.lineStyle(1, 0xaaffaa, 0.70).strokeCircle(bx, by, this.BOTTLE_RANGE);
      }
    } else if (dist < 600) {
      // Far: subtle green dot
      g.fillStyle(0x44aa44, 0.35 + pulse * 0.20).fillCircle(bx, by, 5 + pulse * 2);
    }
  }

  private nearWreck(): boolean {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant' || m.wreckX === undefined) return false;
    return Phaser.Math.Distance.Between(
      this.shipGfx.x, this.shipGfx.y, m.wreckX, m.wreckY!,
    ) < this.WRECK_RANGE;
  }

  private nearDelivery(): boolean {
    const m = this.gs.activeMission;
    if (!m || m.faction !== 'merchant' || m.deliveryX === undefined) return false;
    return Phaser.Math.Distance.Between(
      this.shipGfx.x, this.shipGfx.y, m.deliveryX, m.deliveryY!,
    ) < this.DELIVERY_RANGE;
  }

  private trySalvageWreck(): boolean {
    const s = this.gs;
    const m = s.activeMission;
    if (!m || m.faction !== 'merchant') return false;
    if (m.progress >= m.target) return false;
    if (!m.bottleFound) return false;
    if (!s.isDay) { this.popHint('夜间无法作业，天亮再来', '#e09040'); return false; }
    if (!this.nearWreck()) return false;

    // Salvage animation
    this.cameras.main.flash(400, 64, 160, 220);
    for (let i = 0; i < 5; i++) {
      const ring = this.add.graphics().setDepth(7);
      ring.lineStyle(2, 0x40a0e0, 0.7).strokeCircle(m.wreckX!, m.wreckY!, 12 + i * 8);
      this.tweens.add({
        targets: ring, scaleX: 1.6, scaleY: 1.6, alpha: 0,
        delay: i * 50, duration: 500,
        onComplete: () => ring.destroy(),
      });
    }

    this.onAcquire('cargo_crate', () => {
      const act = this.gs.activeMission;
      if (act?.faction === 'merchant') {
        act.progress = act.target;
        this.popHint(`🪵 货物打捞完毕 — 前往${act.deliveryName ?? '交货点'}交付`, '#40c0e0');
      }
    });
    return true;
  }

  private tryDeliverCargo(): boolean {
    const s = this.gs;
    const m = s.activeMission;
    if (!m || m.faction !== 'merchant') return false;
    if (!this.nearDelivery()) return false;

    if (m.progress < m.target) {
      this.popHint('货还没打捞，先去找沉船', '#e09040');
      return true;
    }
    if (s.cargoCount('cargo_crate') === 0) {
      this.popHint('货物不在舱中', '#e09040');
      return true;
    }

    // Open island NPC dialogue for a proper conversation
    this.brokerDialogue.openIslandDelivery();
    return true;
  }

  /** Called when the player confirms delivery in the island dialogue */
  private doIslandDeliver() {
    const reward = this.gs.deliverCargo();
    if (reward > 0) {
      this.cameras.main.flash(500, 60, 200, 120);
      this.popHint(`✓ 交付完成！+${reward} 金`, '#f0d060');
    }
  }

  /** Draw all 4 delivery islands as permanent world features (called once). */
  private drawStaticIslands() {
    const g = this.staticIslandGfx;
    for (const { x: ix, y: iy, name } of DELIVERY_ISLANDS) {
      // Rocky base
      g.fillStyle(0x3a3828, 0.90).fillEllipse(ix, iy + 4, 58, 28);
      g.fillStyle(0x4a4a30, 0.88).fillEllipse(ix, iy, 52, 24);
      // Elevated centre
      g.fillStyle(0x5a5a38, 0.85).fillEllipse(ix, iy - 4, 34, 18);
      // Small rock details
      g.fillStyle(0x686848, 0.70).fillCircle(ix + 14, iy - 2, 5);
      g.fillStyle(0x585840, 0.70).fillCircle(ix - 12, iy + 1, 4);
      // Scrubby vegetation
      g.fillStyle(0x3a5a28, 0.80).fillCircle(ix - 4, iy - 8, 6);
      g.fillStyle(0x4a6a30, 0.75).fillCircle(ix + 6, iy - 9, 5);
      g.fillStyle(0x3a5020, 0.65).fillCircle(ix - 10, iy - 6, 4);
      // Island name label handled by deliveryLabel (dynamic)
    }
  }

  private updateMerchantMarkers(delta: number) {
    this.merchantPulseT += delta;
    const wg = this.wreckGfx;
    const dg = this.deliveryGfx;
    wg.clear();
    dg.clear();
    this.deliveryLabel.setVisible(false);

    const m = this.gs.activeMission;

    // ── Wreck marker (only visible after bottle found) ─────────
    if (m?.faction === 'merchant' && m.progress < m.target && m.bottleFound && m.wreckX !== undefined) {
      const wx = m.wreckX, wy = m.wreckY!;
      const dist = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, wx, wy);
      const t    = this.merchantPulseT;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.004);

      // ── Layer 1: floating wood debris (visible up to 650px out) ──
      // Each piece has a fixed offset from the wreck centre plus a slow
      // independent sine drift, giving the illusion of debris bobbing on water.
      if (dist < 650) {
        // Fade in as the ship approaches: 0 at 650, full at 380
        const debrisFade = dist > 380 ? 1 - (dist - 380) / 270 : 1;

        // Deterministic debris layout: [dx, dy, w, h, angle-seed]
        // Mix of close (30-60px), medium (70-110px) and far-drifting (120-180px) pieces
        const DEBRIS: [number, number, number, number, number][] = [
          [  32, -18,  13,  5, 0.0],   // close
          [ -38,  22,   9,  4, 1.1],   // close
          [  18,  42,   7,  3, 2.3],   // close
          [ -24, -40,  11,  4, 0.7],   // close
          [  78,  26,   7,  3, 1.8],   // medium
          [ -88, -14,  10,  4, 2.9],   // medium
          [  52, -80,   8,  3, 0.4],   // medium
          [ -60,  74,  12,  5, 3.5],   // medium
          [ 118, -38,   6,  3, 1.5],   // far
          [ -98,  92,   9,  4, 0.9],   // far
          [ 142,  52,   5,  2, 2.1],   // very far
          [ -130, -62,  7,  3, 3.2],   // very far
          [  24, -148,  6,  2, 1.3],   // very far
          [ -46, 130,   8,  3, 2.7],   // very far
        ];

        for (const [dx, dy, w, h, seed] of DEBRIS) {
          // Each piece bobs independently
          const bobX = dx + Math.sin(t * 0.0008 + seed * 2.1) * 3;
          const bobY = dy + Math.cos(t * 0.0009 + seed * 1.7) * 2.5;
          const px = wx + bobX, py = wy + bobY;

          // Rotate the rect by drawing as a thin line segment
          const angle = seed * 0.9 + t * 0.0002;   // very slow rotation
          const hw = w / 2, hh = h / 2;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const corners = [
            [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
          ].map(([rx, ry]) => [px + rx * cos - ry * sin, py + rx * sin + ry * cos]);

          // Dark weathered wood colour, slight saturation variation per piece
          const woodCol = seed < 1.0 ? 0x6b4423 : seed < 2.0 ? 0x7a5030 : 0x5a3818;
          wg.fillStyle(woodCol, 0.72 * debrisFade);
          wg.fillTriangle(
            corners[0][0], corners[0][1],
            corners[1][0], corners[1][1],
            corners[2][0], corners[2][1],
          );
          wg.fillTriangle(
            corners[0][0], corners[0][1],
            corners[2][0], corners[2][1],
            corners[3][0], corners[3][1],
          );

          // Highlight streak on the wood
          wg.lineStyle(1, 0xc09060, 0.28 * debrisFade);
          wg.lineBetween(
            corners[0][0], corners[0][1],
            corners[1][0], corners[1][1],
          );
        }

        // Faint oil-slick shimmer centred on wreck
        const oilA = 0.06 + 0.04 * Math.sin(t * 0.002) * debrisFade;
        wg.fillStyle(0x204060, oilA).fillEllipse(wx, wy, 90, 60);
      }

      // ── Layer 2: sunken hull outline (visible < 200px) ──────────
      if (dist < 200) {
        const hullA = dist > 140 ? (1 - (dist - 140) / 60) : 1;
        wg.lineStyle(2, 0x60a8d0, (0.4 + pulse * 0.35) * hullA);
        wg.lineBetween(wx - 20, wy - 7, wx + 20, wy - 7);  // keel top
        wg.lineBetween(wx - 16, wy + 7, wx + 16, wy + 7);  // keel bottom
        wg.lineBetween(wx - 20, wy - 7, wx - 16, wy + 7);  // port side
        wg.lineBetween(wx + 20, wy - 7, wx + 16, wy + 7);  // starboard side
        // Broken mast stub
        wg.lineBetween(wx - 4, wy - 7, wx - 6, wy - 26);
        wg.lineBetween(wx - 6, wy - 26, wx + 8, wy - 18);  // broken yard
        // Underwater glow
        wg.fillStyle(0x40a0e0, (0.12 + pulse * 0.10) * hullA).fillCircle(wx, wy, 36);
      }

      // ── Layer 3: interaction ring when in salvage range ──────────
      if (dist < this.WRECK_RANGE) {
        wg.lineStyle(1.5, 0x80d0ff, 0.65 + pulse * 0.25);
        wg.strokeCircle(wx, wy, this.WRECK_RANGE);
      }
    }

    // ── Delivery island mission overlay (flag + NPC + pulse) ────
    // Always show label on the active delivery island so player can navigate
    if (m?.faction === 'merchant' && m.deliveryX !== undefined) {
      const ix = m.deliveryX, iy = m.deliveryY!;
      const pulse = 0.5 + 0.5 * Math.sin(this.merchantPulseT * 0.003 + 1.0);

      // Flag pole
      dg.fillStyle(0x30a060, 0.90).fillRect(ix - 1, iy - 28, 2, 20);
      dg.fillStyle(0x40e080, 0.90).fillTriangle(ix + 1, iy - 28, ix + 1, iy - 18, ix + 14, iy - 23);
      // NPC merchant figure waiting on island
      dg.fillStyle(0xd0a060).fillCircle(ix + 8, iy - 14, 4);    // head
      dg.fillStyle(0x5a3c1a).fillRect(ix + 5, iy - 10, 6, 9);   // body
      // Pulse ring when ready to deliver
      if (m.progress >= m.target && this.gs.cargoCount('cargo_crate') > 0) {
        dg.lineStyle(2, 0x40e080, 0.4 + pulse * 0.5);
        dg.strokeCircle(ix, iy, this.DELIVERY_RANGE);
      }
      this.deliveryLabel.setPosition(ix, iy - 36).setText(m.deliveryName ?? '交货点').setVisible(true);
    }

    // Show labels for all 4 islands when near them (even without active mission)
    for (const { x: ix, y: iy, name } of DELIVERY_ISLANDS) {
      if (m?.deliveryX === ix) continue; // already handled above
      const dist = Phaser.Math.Distance.Between(this.shipGfx.x, this.shipGfx.y, ix, iy);
      if (dist < 180) {
        // Borrow the deliveryLabel only if it's currently hidden
        if (!this.deliveryLabel.visible) {
          this.deliveryLabel.setPosition(ix, iy - 36).setText(name).setVisible(true);
        }
      }
    }
  }

  private trackMissionCatch(type: ItemType) {
    const s = this.gs;
    const m = s.activeMission;
    if (!m || m.progress >= m.target) return;

    // merchant missions no longer track fish — cargo_crate is acquired via wreck salvage
    if (m.faction === 'souls' && type === 'glow_fish') {
      if (!s.isDay || s.currentZone !== 'deep') return;
      m.progress++;
      if (m.progress >= m.target) {
        this.popHint('✨ 幽光鱼集齐 — 回港找码头委托人交付', '#c080ff');
      } else {
        this.popHint(`幽光鱼 ${m.progress}/${m.target} 放入货舱`, '#a070d0');
      }
    }
  }

  // ─── Notifications ──────────────────────────────────────────

  popHint(msg: string, color = '#80b8d8') {
    const t = this.add.text(W / 2, H - 52, msg, {
      fontSize: '13px', color, stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(25).setScrollFactor(0);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 26, delay: 1500, duration: 500, onComplete: () => t.destroy() });
  }
}
