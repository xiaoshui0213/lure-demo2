import Phaser from 'phaser';
import { GameState, ItemType } from '../GameState';
import { W, H, WHEEL_SPEED, GREEN_SECTOR_BASE, GREEN_SECTOR_HOOK } from '../constants';

// ─── Layout (DREDGE-style left-side panel) ───────────────────
const PW = 540;
const PH = 220;
const PX = 24;
const PY = (H - PH) / 2 + 10;

const RING_CX = PX + 130;
const RING_CY = PY + PH / 2;

// Outer donut radii
const OUTER_R     = 82;
const OUTER_R_IN  = 64;
const OUTER_MID   = (OUTER_R + OUTER_R_IN) / 2;

// Inner donut radii
const INNER_R     = 54;
const INNER_R_IN  = 40;
const INNER_MID   = (INNER_R + INNER_R_IN) / 2;

// Inner black disc
const FISH_DISC_R = 36;
const FISH_R      = 26;
const BALL_R      = 7;

// Roller bar dimensions (used when mechanic === 'roller')
const ROLLER_W    = OUTER_R * 2;   // same span as ring
const ROLLER_H    = 28;
const ROLLER_X    = RING_CX - ROLLER_W / 2;

// Fishing-line indicator
const LINE_X   = PX + 28;
const LINE_TOP = PY + 36;
const LINE_BOT = PY + PH - 36;

const INFO_X   = PX + 250;
const INFO_W   = PW - 270;

const DEPTH    = 32;

// ─── Pattern types ───────────────────────────────────────────
type Mechanic = 'wheel' | 'roller';

interface FishPattern {
  name:        string;
  difficulty:  '简单' | '中等' | '困难';
  mechanic:    Mechanic;
  hitsRequired: number;

  // ── Wheel fields ──
  outerGreens?:    number[];   // green sector center angles (rad)
  outerGreenSize?: number;     // arc width (rad)
  outerSpeed?:     number;     // ball angular speed (rad/s)
  outerDir?:       1 | -1;    // ball direction
  outerRingSpeed?: number;     // ring self-rotation speed (rad/s)
  outerRingDir?:   1 | -1;    // ring direction

  innerGreens?:    number[];
  innerGreenSize?: number;
  innerSpeed?:     number;
  innerDir?:       1 | -1;
  innerRingSpeed?: number;
  innerRingDir?:   1 | -1;

  // ── Roller fields ──
  rollerBars?:     RollerBar[]; // one or two bars
}

interface RollerBar {
  speed:      number;   // cursor speed (full-bar traversal per second, 0..1)
  greenW:     number;   // green zone width (0..1 fraction of bar)
  zoneSpeed:  number;   // green zone slide speed (0..1 per second, 0=static)
  color:      number;   // cursor colour (hex)
  greenColor: number;   // green zone colour
}

// ─── Pattern generator ───────────────────────────────────────
function generatePattern(type: ItemType, hasHook: boolean): FishPattern {
  const gb = hasHook ? GREEN_SECTOR_HOOK : GREEN_SECTOR_BASE;

  if (type === 'glow_fish') {
    // 困难：双轮盘 + 两圈反向自转，指针也互为反向
    return {
      name: '幽光鱼', difficulty: '困难', mechanic: 'wheel', hitsRequired: 5,
      outerGreens:    [-Math.PI / 2, Math.PI / 2],
      outerGreenSize: gb * 0.95,          // 加宽外圈绿区
      outerSpeed:     WHEEL_SPEED * 1.1,
      outerDir:       1,
      outerRingSpeed: WHEEL_SPEED * 0.55,
      outerRingDir:   1,
      innerGreens:    [-Math.PI / 2, Math.PI / 2],   // 内圈由1段改为2段
      innerGreenSize: gb * 0.80,          // 加宽内圈绿区
      innerSpeed:     WHEEL_SPEED * 1.3,
      innerDir:       -1,
      innerRingSpeed: WHEEL_SPEED * 0.70,
      innerRingDir:   -1,
    };
  }

  if (type === 'deep_fish') {
    // 中等：双滚轮，两个滑条指针方向相反，绿区也在移动
    return {
      name: '巨眼鱼', difficulty: '中等', mechanic: 'roller', hitsRequired: 4,
      rollerBars: [
        { speed: 0.70, greenW: 0.32, zoneSpeed: 0.12, color: 0x60e090, greenColor: 0x2a8848 },
        { speed: 0.58, greenW: 0.28, zoneSpeed: 0.14, color: 0x90b0ff, greenColor: 0x2a4888 },
      ],
    };
  }

  // 浅海鱼 — wheel with rotating ring
  if (Math.random() < 0.55) {
    // 青鳞鱼：简单 — 2 段绿区，环缓慢顺时针自转，球逆时针
    return {
      name: '青鳞鱼', difficulty: '简单', mechanic: 'wheel', hitsRequired: 3,
      outerGreens:    [-Math.PI / 2, Math.PI / 2],
      outerGreenSize: gb * 1.0,
      outerSpeed:     WHEEL_SPEED * 0.88,
      outerDir:       -1,
      outerRingSpeed: WHEEL_SPEED * 0.35,
      outerRingDir:   1,
    };
  }
  // 岩鱼：中等 — 3 段窄绿区，环与球同向但速度不一
  return {
    name: '岩鱼', difficulty: '中等', mechanic: 'wheel', hitsRequired: 4,
    outerGreens:    [-Math.PI / 2, Math.PI * 5 / 6, Math.PI / 6],
    outerGreenSize: gb * 0.68,
    outerSpeed:     WHEEL_SPEED * 1.02,
    outerDir:       1,
    outerRingSpeed: WHEEL_SPEED * 0.60,
    outerRingDir:   -1,
  };
}

// ─── Helpers ─────────────────────────────────────────────────
function angleDist(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  const d = ((a - b) % TWO_PI + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

function inGreen(angle: number, centers: number[], size: number): boolean {
  return centers.some(c => angleDist(angle, c) < size / 2);
}

// ─── Runtime state for a single roller bar ───────────────────
interface RollerState {
  cursorPos: number;    // 0..1
  cursorDir: 1 | -1;
  zonePos:   number;    // left edge of green zone, 0..(1-greenW)
  zoneDir:   1 | -1;
}

// ─── FishingWheel class ───────────────────────────────────────
export class FishingWheel {
  private container!:  Phaser.GameObjects.Container;
  private ringGfx!:    Phaser.GameObjects.Graphics;
  private ballGfx!:    Phaser.GameObjects.Graphics;
  private lineGfx!:    Phaser.GameObjects.Graphics;
  private decorGfx!:   Phaser.GameObjects.Graphics;
  private fishSilGfx!: Phaser.GameObjects.Graphics;
  private rollerGfx!:  Phaser.GameObjects.Graphics;

  private hintBubble!: Phaser.GameObjects.Graphics;
  private hintTxt!:    Phaser.GameObjects.Text;
  private titleTxt!:   Phaser.GameObjects.Text;
  private stockTxt!:   Phaser.GameObjects.Text;
  private diffTxt!:    Phaser.GameObjects.Text;
  private progressTxt!: Phaser.GameObjects.Text;
  private zoneTagBg!:  Phaser.GameObjects.Graphics;
  private zoneTagTxt!: Phaser.GameObjects.Text;
  private zoneTag!:    Phaser.GameObjects.Container;
  private pullBtnGfx!: Phaser.GameObjects.Graphics;
  private pullBtnTxt!: Phaser.GameObjects.Text;
  private statusTxt!:  Phaser.GameObjects.Text;

  // Wheel state
  private outerAngle     = 0;   // ball angle
  private innerAngle     = 0;
  private outerRingAngle = 0;   // ring self-rotation angle
  private innerRingAngle = 0;

  // Roller state (up to 2 bars)
  private rollerStates: RollerState[] = [];

  private hits     = 0;
  private lockMs   = 0;
  private flashMs  = 0;
  private flashKind: 'hit' | 'miss' | null = null;

  private active   = false;
  private finished = false;
  private fishType: ItemType = 'fish';
  private pattern!: FishPattern;
  private onDone!:  (caught: boolean, item: ItemType) => void;

  constructor(private scene: Phaser.Scene, private gs: GameState) {
    this.build();
  }

  // ─── Build ─────────────────────────────────────────────────
  private build() {
    const overlay = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);

    this.hintBubble = this.scene.add.graphics();
    this.hintTxt    = this.scene.add.text(W / 2, 82, '', {
      fontSize: '14px', color: '#e0e0e0', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 420 },
    }).setOrigin(0.5);

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x0a0a0a, 0.96).fillRoundedRect(PX, PY, PW, PH, 8);
    panel.lineStyle(2, 0x6a5230, 0.85).strokeRoundedRect(PX, PY, PW, PH, 8);
    panel.lineStyle(1, 0x3a2a18, 0.7).strokeRoundedRect(PX + 5, PY + 5, PW - 10, PH - 10, 6);

    this.ringGfx    = this.scene.add.graphics();
    this.rollerGfx  = this.scene.add.graphics();
    this.fishSilGfx = this.scene.add.graphics();
    this.ballGfx    = this.scene.add.graphics();
    this.decorGfx   = this.scene.add.graphics();
    this.lineGfx    = this.scene.add.graphics();

    // Right info panel
    this.titleTxt = this.scene.add.text(INFO_X, PY + 28, '', {
      fontSize: '20px', color: '#e0d0a0', fontStyle: 'bold',
    });
    const titleUL = this.scene.add.graphics();
    titleUL.lineStyle(1, 0x6a5230, 0.8)
           .lineBetween(INFO_X, PY + 56, INFO_X + INFO_W - 30, PY + 56);

    this.stockTxt = this.scene.add.text(INFO_X, PY + 68, '', {
      fontSize: '13px', color: '#a09080',
    });
    this.diffTxt = this.scene.add.text(INFO_X, PY + 88, '', {
      fontSize: '13px', color: '#a0c0a0',
    });

    this.zoneTagBg  = this.scene.add.graphics();
    this.zoneTagTxt = this.scene.add.text(0, 0, '近海', {
      fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.zoneTag = this.scene.add.container(INFO_X + 28, PY + 118, [this.zoneTagBg, this.zoneTagTxt]);

    this.progressTxt = this.scene.add.text(INFO_X, PY + 144, '', {
      fontSize: '15px', color: '#a08060', fontStyle: 'bold', letterSpacing: 4,
    });

    this.pullBtnGfx = this.scene.add.graphics();
    this.pullBtnTxt = this.scene.add.text(INFO_X + 60, PY + PH - 38, '拉   [ F ]', {
      fontSize: '16px', color: '#f0e0c0', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.statusTxt = this.scene.add.text(INFO_X + 60, PY + PH - 14, '', {
      fontSize: '12px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);

    this.container = this.scene.add.container(0, 0, [
      overlay, this.hintBubble, this.hintTxt,
      panel, this.lineGfx,
      this.ringGfx, this.rollerGfx, this.fishSilGfx, this.ballGfx, this.decorGfx,
      this.titleTxt, titleUL, this.stockTxt, this.diffTxt, this.zoneTag,
      this.progressTxt, this.pullBtnGfx, this.pullBtnTxt, this.statusTxt,
    ]);
    this.container.setDepth(DEPTH).setScrollFactor(0).setVisible(false);
  }

  // ─── Lifecycle ────────────────────────────────────────────
  open(type: ItemType, onDone: (caught: boolean, item: ItemType) => void) {
    this.fishType  = type;
    this.onDone    = onDone;
    this.pattern   = generatePattern(type, this.gs.hasHook);

    // Wheel state init
    this.outerAngle     = Math.random() * Math.PI * 2;
    this.innerAngle     = Math.random() * Math.PI * 2;
    this.outerRingAngle = Math.random() * Math.PI * 2;
    this.innerRingAngle = Math.random() * Math.PI * 2;

    // Roller state init
    this.rollerStates = (this.pattern.rollerBars ?? []).map(() => ({
      cursorPos: Math.random() * 0.4 + 0.3,
      cursorDir: (Math.random() < 0.5 ? 1 : -1) as 1 | -1,
      zonePos:   Math.random() * 0.5,
      zoneDir:   (Math.random() < 0.5 ? 1 : -1) as 1 | -1,
    }));

    this.hits      = 0;
    this.lockMs    = 0;
    this.flashMs   = 0;
    this.flashKind = null;
    this.active    = true;
    this.finished  = false;
    this.statusTxt.setText('');

    const flavor: Partial<Record<ItemType, { title: string; stock: string; zone: '近海' | '远海' | '深海' }>> = {
      fish:      { title: '热闹的水域', stock: '余量：高',           zone: '近海' },
      deep_fish: { title: '远洋水域',   stock: '余量：中  ·  日行',  zone: '远海' },
      glow_fish: { title: '幽暗水域',   stock: '余量：中  ·  夜行',  zone: '深海' },
    };
    const f = flavor[type] ?? { title: '', stock: '', zone: '近海' as const };
    this.titleTxt.setText(f.title);
    this.stockTxt.setText(f.stock);
    this.diffTxt.setText(`难度：${this.pattern.difficulty}   目标：${this.pattern.name}`)
                .setColor(this.pattern.difficulty === '困难' ? '#e09060' :
                          this.pattern.difficulty === '中等' ? '#e0c080' : '#a0c0a0');
    this.updateZoneTag(f.zone);
    this.drawHintBubble();
    this.drawPullButton(false);
    this.drawDecor();

    this.container.setVisible(true);
    this.draw();
  }

  close() { this.active = false; this.container.setVisible(false); }
  isOpen() { return this.active; }

  // ─── Action ────────────────────────────────────────────────
  tryFish() {
    if (!this.active || this.finished || this.lockMs > 0) return;
    const p = this.pattern;

    let hitsThisPress = 0;

    if (p.mechanic === 'roller') {
      // Each green bar hit = +1; partial hits count (harder bars add more risk)
      const bars = p.rollerBars!;
      let greenCount = 0;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const st  = this.rollerStates[i];
        const inZ = st.cursorPos >= st.zonePos && st.cursorPos <= st.zonePos + bar.greenW;
        if (inZ) greenCount++;
      }
      hitsThisPress = greenCount;  // 0 = miss, 1 = partial, 2 = both (bonus)
    } else {
      // Wheel: effective green positions = original + ring rotation
      const effectiveOuter = (p.outerGreens ?? []).map(c => c + this.outerRingAngle);
      const outerHit = inGreen(this.outerAngle, effectiveOuter, p.outerGreenSize ?? 0);

      const effectiveInner = (p.innerGreens ?? []).map(c => c + this.innerRingAngle);
      const innerHit = p.innerGreens
        ? inGreen(this.innerAngle, effectiveInner, p.innerGreenSize ?? 0)
        : false;

      hitsThisPress = (outerHit ? 1 : 0) + (innerHit ? 1 : 0);
    }

    if (hitsThisPress > 0) {
      this.hits = Math.min(p.hitsRequired, this.hits + hitsThisPress);
      this.flashKind = 'hit';
      this.flashMs   = 320;
      this.lockMs    = 220;
      this.statusTxt
        .setText(this.hits >= p.hitsRequired ? '🎣  上钩了！' : `+${hitsThisPress}  收线中…`)
        .setColor('#40e080');

      if (this.hits >= p.hitsRequired) {
        this.finished = true;
        this.drawPullButton(true);
        this.scene.time.delayedCall(700, () => {
          this.close();
          this.onDone(true, this.fishType);
        });
      }
    } else {
      this.flashKind = 'miss';
      this.flashMs   = 320;
      this.lockMs    = 500;
      this.statusTxt.setText('❌  脱线').setColor('#e06060');
    }
  }

  // ─── Update ────────────────────────────────────────────────
  update(delta: number) {
    if (!this.active || this.finished) return;
    const p = this.pattern;
    const dt = delta / 1000;

    if (p.mechanic === 'roller') {
      const bars = p.rollerBars!;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const st  = this.rollerStates[i];

        // Move cursor (bounces between 0 and 1)
        st.cursorPos += bar.speed * st.cursorDir * dt;
        if (st.cursorPos >= 1) { st.cursorPos = 1; st.cursorDir = -1; }
        if (st.cursorPos <= 0) { st.cursorPos = 0; st.cursorDir =  1; }

        // Slide green zone
        const maxZone = 1 - bar.greenW;
        st.zonePos += bar.zoneSpeed * st.zoneDir * dt;
        if (st.zonePos >= maxZone) { st.zonePos = maxZone; st.zoneDir = -1; }
        if (st.zonePos <= 0)       { st.zonePos = 0;       st.zoneDir =  1; }
      }
    } else {
      // Wheel
      this.outerAngle     += (p.outerSpeed     ?? WHEEL_SPEED) * (p.outerDir     ?? 1) * dt;
      this.outerRingAngle += (p.outerRingSpeed ?? 0)           * (p.outerRingDir ?? 1) * dt;
      if (p.innerGreens) {
        this.innerAngle     += (p.innerSpeed     ?? WHEEL_SPEED) * (p.innerDir     ?? -1) * dt;
        this.innerRingAngle += (p.innerRingSpeed ?? 0)           * (p.innerRingDir ?? -1) * dt;
      }
    }

    this.lockMs  = Math.max(0, this.lockMs  - delta);
    this.flashMs = Math.max(0, this.flashMs - delta);
    if (this.flashMs === 0) this.flashKind = null;

    this.draw();
  }

  // ─── Draw dispatcher ───────────────────────────────────────
  private draw() {
    if (this.pattern.mechanic === 'roller') {
      this.ringGfx.clear();
      this.fishSilGfx.clear();
      this.ballGfx.clear();
      this.drawRoller();
    } else {
      this.rollerGfx.clear();
      this.drawRing();
      this.drawFishSilhouette();
      this.drawBall();
    }
    this.drawLineIndicator();
    this.drawProgressText();
  }

  // ─── Wheel drawing ─────────────────────────────────────────
  private drawDonut(g: Phaser.GameObjects.Graphics, rOuter: number, rInner: number, fill: number, alpha: number) {
    g.fillStyle(fill, alpha);
    g.beginPath();
    g.arc(RING_CX, RING_CY, rOuter, 0, Math.PI * 2, false);
    g.arc(RING_CX, RING_CY, rInner, 0, Math.PI * 2, true);
    g.closePath();
    g.fillPath();
  }

  private drawDonutSector(g: Phaser.GameObjects.Graphics, rOuter: number, rInner: number, center: number, size: number, fill: number, alpha: number) {
    const a0 = center - size / 2;
    const a1 = center + size / 2;
    g.fillStyle(fill, alpha);
    g.beginPath();
    g.arc(RING_CX, RING_CY, rOuter, a0, a1, false);
    g.arc(RING_CX, RING_CY, rInner, a1, a0, true);
    g.closePath();
    g.fillPath();
  }

  private drawRing() {
    const g = this.ringGfx;
    g.clear();
    const p = this.pattern;

    // Outer donut — dark red base
    this.drawDonut(g, OUTER_R, OUTER_R_IN, 0x5a1818, 0.95);
    // Outer green sectors (offset by ring's own rotation angle)
    for (const c of (p.outerGreens ?? [])) {
      this.drawDonutSector(g, OUTER_R, OUTER_R_IN,
        c + this.outerRingAngle, p.outerGreenSize ?? 0, 0x2a8848, 0.95);
    }

    // Inner donut
    if (p.innerGreens) {
      this.drawDonut(g, INNER_R, INNER_R_IN, 0x4a1a4a, 0.92);
      for (const c of p.innerGreens) {
        this.drawDonutSector(g, INNER_R, INNER_R_IN,
          c + this.innerRingAngle, p.innerGreenSize ?? 0, 0x2a8848, 0.95);
      }
    }

    // Ring outlines
    g.lineStyle(2, 0x6a5230, 0.85).strokeCircle(RING_CX, RING_CY, OUTER_R);
    g.lineStyle(2, 0x6a5230, 0.85).strokeCircle(RING_CX, RING_CY, OUTER_R_IN);
    if (p.innerGreens) {
      g.lineStyle(1.5, 0x6a5230, 0.8).strokeCircle(RING_CX, RING_CY, INNER_R);
      g.lineStyle(1.5, 0x6a5230, 0.8).strokeCircle(RING_CX, RING_CY, INNER_R_IN);
    }

    // Small tick marks every 30° on outer ring to show ring rotation clearly
    const tickCount = 12;
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2 + this.outerRingAngle;
      const x0 = RING_CX + Math.cos(a) * OUTER_R_IN;
      const y0 = RING_CY + Math.sin(a) * OUTER_R_IN;
      const x1 = RING_CX + Math.cos(a) * (OUTER_R_IN + 5);
      const y1 = RING_CY + Math.sin(a) * (OUTER_R_IN + 5);
      g.lineStyle(1, 0x9a7248, 0.5).lineBetween(x0, y0, x1, y1);
    }

    // 12-o'clock fixed notch (pointer, doesn't rotate — marks where ball should be)
    g.fillStyle(0xd0c080, 0.9);
    g.fillTriangle(
      RING_CX, RING_CY - OUTER_R - 2,
      RING_CX - 6, RING_CY - OUTER_R - 14,
      RING_CX + 6, RING_CY - OUTER_R - 14,
    );

    // Flash ring
    if (this.flashKind) {
      const col = this.flashKind === 'hit' ? 0x40e080 : 0xe04040;
      const a   = (this.flashMs / 320) * 0.7;
      g.lineStyle(4, col, a);
      g.strokeCircle(RING_CX, RING_CY, OUTER_R + 4);
    }
  }

  private drawFishSilhouette() {
    const g = this.fishSilGfx;
    g.clear();
    g.fillStyle(0x050505, 1).fillCircle(RING_CX, RING_CY, FISH_DISC_R);
    g.fillStyle(0xeeeeee, 0.92);
    const cx = RING_CX - 3, cy = RING_CY;
    g.fillEllipse(cx, cy, FISH_R * 1.0, FISH_R * 0.6);
    g.fillTriangle(
      cx + FISH_R * 0.45, cy,
      cx + FISH_R * 0.85, cy - FISH_R * 0.4,
      cx + FISH_R * 0.85, cy + FISH_R * 0.4,
    );
    g.fillStyle(0x000000, 1).fillCircle(cx - FISH_R * 0.35, cy - FISH_R * 0.05, 1.6);
  }

  private drawBall() {
    const g = this.ballGfx;
    g.clear();
    const p = this.pattern;
    const effectiveOuter = (p.outerGreens ?? []).map(c => c + this.outerRingAngle);

    // Outer ball
    const obx = RING_CX + Math.cos(this.outerAngle) * OUTER_MID;
    const oby = RING_CY + Math.sin(this.outerAngle) * OUTER_MID;
    const onGreenO = inGreen(this.outerAngle, effectiveOuter, p.outerGreenSize ?? 0);
    g.fillStyle(onGreenO ? 0x80ffb0 : 0x60e090, 0.25).fillCircle(obx, oby, BALL_R + 5);
    g.fillStyle(onGreenO ? 0x80ffb0 : 0xd0ffd8, 1).fillCircle(obx, oby, BALL_R);
    g.fillStyle(0xffffff, 0.6).fillCircle(obx - 2, oby - 2, 2.5);

    // Inner ball
    if (p.innerGreens) {
      const effectiveInner = p.innerGreens.map(c => c + this.innerRingAngle);
      const ibx = RING_CX + Math.cos(this.innerAngle) * INNER_MID;
      const iby = RING_CY + Math.sin(this.innerAngle) * INNER_MID;
      const onGreenI = inGreen(this.innerAngle, effectiveInner, p.innerGreenSize ?? 0);
      g.fillStyle(onGreenI ? 0xc090ff : 0x9070d0, 0.3).fillCircle(ibx, iby, BALL_R + 4);
      g.fillStyle(onGreenI ? 0xc090ff : 0xe0c0ff, 1).fillCircle(ibx, iby, BALL_R - 1);
      g.fillStyle(0xffffff, 0.6).fillCircle(ibx - 2, iby - 2, 2);
    }
  }

  // ─── Roller drawing ────────────────────────────────────────
  private drawRoller() {
    const g = this.rollerGfx;
    g.clear();
    const p = this.pattern;
    const bars = p.rollerBars ?? [];
    const totalBars = bars.length;
    // Stack bars vertically around RING_CY
    const barSpacing = ROLLER_H + 20;
    const startY = RING_CY - ((totalBars - 1) * barSpacing) / 2;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const st  = this.rollerStates[i];
      const by  = startY + i * barSpacing - ROLLER_H / 2;

      // Track background
      g.fillStyle(0x1a1010, 0.95).fillRoundedRect(ROLLER_X, by, ROLLER_W, ROLLER_H, 5);
      g.lineStyle(1.5, 0x6a4028, 0.85).strokeRoundedRect(ROLLER_X, by, ROLLER_W, ROLLER_H, 5);

      // Red danger zone (full bar)
      g.fillStyle(0x5a1818, 0.8).fillRoundedRect(ROLLER_X + 3, by + 3, ROLLER_W - 6, ROLLER_H - 6, 3);

      // Green zone (slides)
      const gx = ROLLER_X + st.zonePos * (ROLLER_W - 6) + 3;
      const gw = bar.greenW * (ROLLER_W - 6);
      g.fillStyle(bar.greenColor, 0.9).fillRect(gx, by + 3, gw, ROLLER_H - 6);
      g.lineStyle(1, 0x60ff90, 0.5).strokeRect(gx, by + 3, gw, ROLLER_H - 6);

      // Cursor needle
      const cx = ROLLER_X + st.cursorPos * ROLLER_W;
      const inZ = st.cursorPos >= st.zonePos && st.cursorPos <= st.zonePos + bar.greenW;
      g.fillStyle(inZ ? 0xffffff : bar.color, 0.95);
      g.fillTriangle(cx, by - 4, cx - 6, by - 14, cx + 6, by - 14); // top arrow
      g.fillTriangle(cx, by + ROLLER_H + 4, cx - 6, by + ROLLER_H + 14, cx + 6, by + ROLLER_H + 14); // bottom arrow
      // Needle line
      g.lineStyle(2.5, inZ ? 0xffffff : bar.color, 0.9)
       .lineBetween(cx, by, cx, by + ROLLER_H);

      // Glow when in green
      if (inZ) {
        g.lineStyle(3, 0x80ffb0, 0.35).strokeRoundedRect(ROLLER_X - 2, by - 2, ROLLER_W + 4, ROLLER_H + 4, 7);
      }

      // Flash effect on whole bar
      if (this.flashKind === 'hit') {
        g.lineStyle(3, 0x40e080, (this.flashMs / 320) * 0.8)
         .strokeRoundedRect(ROLLER_X - 3, by - 3, ROLLER_W + 6, ROLLER_H + 6, 7);
      } else if (this.flashKind === 'miss') {
        g.lineStyle(3, 0xe04040, (this.flashMs / 320) * 0.8)
         .strokeRoundedRect(ROLLER_X - 3, by - 3, ROLLER_W + 6, ROLLER_H + 6, 7);
      }

      // Bar label
      const label = totalBars > 1
        ? (i === 0 ? '主滚轮' : '副滚轮')
        : '滚轮';
      // small label above bar (rendered as part of decor, use fixed text inside graphics via label trick)
      g.fillStyle(0x8a7060, 0.7)
       .fillRect(ROLLER_X, by - 18, 48, 15);
      // Note: actual text is rendered via drawDecor labels
    }

    // Bar labels drawn separately via scene text stored in decorGfx area
    // Roller fish silhouette hint — draw a simple fish icon in top-left of ring area
    g.fillStyle(0x111111, 0.9).fillCircle(RING_CX, RING_CY - OUTER_R - 5, 18);
    g.fillStyle(0x60e090, 0.85);
    g.fillEllipse(RING_CX - 2, RING_CY - OUTER_R - 5, 22, 12);
    g.fillTriangle(
      RING_CX + 8, RING_CY - OUTER_R - 5,
      RING_CX + 16, RING_CY - OUTER_R - 11,
      RING_CX + 16, RING_CY - OUTER_R + 1,
    );
  }

  // ─── Line indicator ────────────────────────────────────────
  private drawLineIndicator() {
    const g = this.lineGfx;
    g.clear();
    g.lineStyle(2, 0x4a3a20, 0.85).lineBetween(LINE_X, LINE_TOP, LINE_X, LINE_BOT);
    g.fillStyle(0x6a5230, 1).fillCircle(LINE_X, LINE_TOP, 7);
    g.lineStyle(1.5, 0x2a1808, 1).strokeCircle(LINE_X, LINE_TOP, 7);
    g.fillStyle(0x6a5230, 1);
    g.fillTriangle(LINE_X - 5, LINE_BOT, LINE_X + 5, LINE_BOT, LINE_X, LINE_BOT + 8);

    const t    = this.hits / this.pattern.hitsRequired;
    const hookY = LINE_BOT - t * (LINE_BOT - LINE_TOP - 14);
    g.lineStyle(2, 0x8aa0c8, 0.9).lineBetween(LINE_X, LINE_TOP + 6, LINE_X, hookY);
    g.fillStyle(0x8aa0c8, 1).fillCircle(LINE_X, hookY, 4);
    g.lineStyle(1.5, 0xc0d8ff, 0.8).strokeCircle(LINE_X, hookY, 4);
  }

  private drawProgressText() {
    const need = this.pattern.hitsRequired;
    let dots = '';
    for (let i = 0; i < need; i++) dots += i < this.hits ? '●' : '○';
    this.progressTxt.setText(`进度: ${dots}   ${this.hits}/${need}`);
  }

  private drawDecor() {
    const g = this.decorGfx;
    g.clear();
    if (this.pattern.mechanic === 'roller') return; // no arrows for roller

    g.fillStyle(0xa08868, 0.85);
    const ay = RING_CY + OUTER_R + 18;
    const arrow = (x: number) => {
      g.beginPath();
      g.moveTo(x - 9, ay - 5); g.lineTo(x, ay + 6); g.lineTo(x + 9, ay - 5);
      g.lineTo(x + 4, ay - 5); g.lineTo(x, ay + 1);  g.lineTo(x - 4, ay - 5);
      g.closePath(); g.fillPath();
    };
    arrow(RING_CX - 18);
    arrow(RING_CX + 18);
  }

  private drawHintBubble() {
    const g = this.hintBubble;
    g.clear();
    const w = 460, h = 70;
    const x = (W - w) / 2, y = 48;
    g.fillStyle(0x0a0a0a, 0.95).fillRoundedRect(x, y, w, h, 6);
    g.lineStyle(2, 0x6a5230, 0.85).strokeRoundedRect(x, y, w, h, 6);
    g.lineStyle(1, 0x3a2a18, 0.7).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 5);

    const p = this.pattern;
    let hint: string;
    if (p.mechanic === 'roller') {
      hint = p.rollerBars!.length > 1
        ? '指针进入绿色区域时按 F  ·  两条同时命中 +2  ·  绿区也在滑动！'
        : '指针进入绿色区域时按 F  ·  绿色区域也在移动';
    } else if (p.innerGreens) {
      hint = '绿色扇区与指针同时旋转  ·  外圈绿球 + 内圈紫球均命中按 F  ·  同时命中 +2';
    } else {
      hint = '绿色扇区与指针同时旋转  ·  球进入绿区时按 F  ·  把握节奏！';
    }
    this.hintTxt.setText(hint);
  }

  private drawPullButton(pressed: boolean) {
    const g = this.pullBtnGfx;
    g.clear();
    const bw = 140, bh = 38;
    const bx = INFO_X + 60 - bw / 2;
    const by = PY + PH - 38 - bh / 2;
    g.fillStyle(pressed ? 0x8a3838 : 0x5a2020, 1).fillRoundedRect(bx, by, bw, bh, 5);
    g.lineStyle(2, 0x8a6840, 0.95).strokeRoundedRect(bx, by, bw, bh, 5);
    g.lineStyle(1, 0x3a2010, 0.85).strokeRoundedRect(bx + 3, by + 3, bw - 6, bh - 6, 4);
  }

  private updateZoneTag(label: '近海' | '远海' | '深海') {
    const g = this.zoneTagBg;
    g.clear();
    const colByZone: Record<string, number> = { 近海: 0x3a6a8a, 远海: 0x2a5878, 深海: 0x4a3a8a };
    const col = colByZone[label] ?? 0x3a6a8a;
    const tw = 56, th = 22;
    g.fillStyle(col, 1).fillRoundedRect(-tw / 2, -th / 2, tw, th, 4);
    g.lineStyle(1, 0xffffff, 0.25).strokeRoundedRect(-tw / 2, -th / 2, tw, th, 4);
    this.zoneTagTxt.setText(label);
  }
}
