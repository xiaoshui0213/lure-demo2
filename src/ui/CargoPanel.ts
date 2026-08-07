import Phaser from 'phaser';
import { GameState, ItemType, CargoItem, GRID_COLS, GRID_ROWS, ITEM_SIZE, HOLD_SHAPE } from '../GameState';
import { W, H } from '../constants';

// ─── Grid layout constants ─────────────────────────────────────
const CELL  = 50;
const GAP   = 3;
const UNIT  = CELL + GAP;

const GRID_W = GRID_COLS * UNIT - GAP;
const GRID_H = GRID_ROWS * UNIT - GAP;

// Tray (pending items waiting to be dragged in) — sits left of the grid
const TRAY_W    = 80;
const TRAY_PAD  = 10;
const SLOT_SZ   = 60;   // tray slot size

// Panel dimensions — grid + tray on left
const PW = GRID_W + TRAY_W + 24 + 48;   // tray | gap | grid | right-pad
const PH = GRID_H + 160;
const PX = (W - PW) / 2;
const PY = (H - PH) / 2;

// Grid origin (right portion of panel)
const GX = PX + TRAY_W + 24 + 24;
const GY = PY + 95;

// Tray slot column origin
const TX = PX + 16;
const TY = GY;

export const ITEM_PALETTE: Record<ItemType, { bg: number; border: number; icon: string; name: string; desc: string }> = {
  fish:      { bg: 0x3a1a0a, border: 0xa05030, icon: '🐟', name: '普通鱼',   desc: '浅海常见鱼类，可在港口卖给鱼贩。' },
  deep_fish: { bg: 0x0a1838, border: 0x4080c0, icon: '🐠', name: '深海鱼',   desc: '白天深海才有的稀有品种，售价颇丰。' },
  glow_fish: { bg: 0x0a2a1a, border: 0x30c870, icon: '✨', name: '幽光鱼',   desc: '夜晚深海才会发光的珍稀鱼种，委托目标。' },
  loot:      { bg: 0x1a0a2a, border: 0x9030c0, icon: '⚔', name: '战利品',   desc: '击败海中生物掉落的贵重物件。' },
  armor:     { bg: 0x121a26, border: 0x80c0e0, icon: '🛡', name: '装甲板',   desc: '装备后最大船体HP +1，占据货舱空间。' },
  hook:      { bg: 0x1a1a08, border: 0xa0e080, icon: '🪝', name: '专业鱼钩', desc: '钓鱼转盘绿区扩大 20%，更容易命中。' },
  supply:    { bg: 0x1a2418, border: 0x70e0a0, icon: '🛢', name: '补给',     desc: '每次出海消耗一个。精神仅剩1格时，开货仓按 [ U ] 使用，精神 +2。' },
  treasure:    { bg: 0x2a1a06, border: 0xd4a030, icon: '📦', name: '宝箱',     desc: '沙土下挖出的宝物。回港交给委托人换取报酬。' },
  relic:       { bg: 0x1a0a28, border: 0x8040c0, icon: '💀', name: '怪物遗骸', desc: '深海猎物的残骸标本，回港交给委托人。' },
  cargo_crate: { bg: 0x142030, border: 0x4090c0, icon: '🪵', name: '打捞货物', desc: '从沉船中打捞的防水货箱，运到指定交货点换取运费。' },
};

const DEPTH = 40;

// ─── Held item during drag ─────────────────────────────────────
interface Held {
  type:   ItemType;
  w:      number;
  h:      number;
  fromGrid?: { id: number; col: number; row: number; w: number; h: number };
  fromTray?: number;  // tray index before drag started
}

// ─── Tray slot (pending items) ─────────────────────────────────
interface TraySlot {
  type:  ItemType;
  label: Phaser.GameObjects.Text;
}

export class CargoPanel {
  private container!:  Phaser.GameObjects.Container;
  private staticGfx!:  Phaser.GameObjects.Graphics;
  private gridGfx!:    Phaser.GameObjects.Graphics;
  private trayGfx!:    Phaser.GameObjects.Graphics;
  private cursorGfx!:  Phaser.GameObjects.Graphics;  // follows mouse during drag
  private hpGfx!:      Phaser.GameObjects.Graphics;
  private statusTxt!:  Phaser.GameObjects.Text;
  private hintTxt!:    Phaser.GameObjects.Text;
  private itemLabels:  Phaser.GameObjects.Text[] = [];
  private cursorLabel!: Phaser.GameObjects.Text;     // icon following mouse

  private held:      Held | null = null;
  private tray:      TraySlot[]  = [];
  private mouseX     = W / 2;
  private mouseY     = H / 2;
  private mouseCol   = -1;
  private mouseRow   = -1;

  constructor(private scene: Phaser.Scene, private gs: GameState) {
    this.build();
  }

  // ─── Build ─────────────────────────────────────────────────

  private build() {
    const overlay = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65);

    this.staticGfx = this.scene.add.graphics();
    this.staticGfx.fillStyle(0x050b14, 0.98).fillRoundedRect(PX, PY, PW, PH, 10);
    this.staticGfx.lineStyle(2, 0x40280a, 0.9).strokeRoundedRect(PX, PY, PW, PH, 10);
    this.staticGfx.lineStyle(1, 0x281808, 0.6).strokeRoundedRect(PX + 6, PY + 6, PW - 12, PH - 12, 8);

    // Vertical divider between tray and grid
    this.staticGfx.lineStyle(1, 0x40280a, 0.5)
      .lineBetween(PX + TRAY_W + 24, PY + 14, PX + TRAY_W + 24, PY + PH - 14);

    this.scene.add.text(PX + PW / 2, PY + 18, '货  仓', {
      fontSize: '16px', color: '#a08060', fontStyle: 'bold', letterSpacing: 6,
    }).setOrigin(0.5);

    // Tray header
    this.scene.add.text(TX + TRAY_W / 2 - 8, PY + 18, '待放', {
      fontSize: '12px', color: '#706050', letterSpacing: 2,
    }).setOrigin(0.5);

    // HP area
    this.scene.add.text(GX, PY + 52, '受损', {
      fontSize: '12px', color: '#a06060',
    }).setOrigin(0, 0.5);

    this.hpGfx   = this.scene.add.graphics();
    this.trayGfx = this.scene.add.graphics();
    this.gridGfx = this.scene.add.graphics();

    // Cursor gfx + label: float on top, NOT in container (so they're always on top)
    this.cursorGfx   = this.scene.add.graphics().setDepth(DEPTH + 5).setScrollFactor(0);
    this.cursorLabel = this.scene.add.text(0, 0, '', { fontSize: '32px' })
      .setOrigin(0.5).setDepth(DEPTH + 6).setScrollFactor(0).setAlpha(0);

    this.statusTxt = this.scene.add.text(PX + PW / 2, PY + PH - 44, '', {
      fontSize: '12px', color: '#90c8a0', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.hintTxt = this.scene.add.text(PX + PW / 2, PY + PH - 22, '', {
      fontSize: '11px', color: '#504030',
    }).setOrigin(0.5);

    this.container = this.scene.add.container(0, 0, [
      overlay, this.staticGfx,
      this.hpGfx, this.trayGfx, this.gridGfx,
      this.statusTxt, this.hintTxt,
    ]);
    this.container.setDepth(DEPTH).setScrollFactor(0).setVisible(false);
  }

  // ─── Public API ────────────────────────────────────────────

  open() {
    this.container.setVisible(true);
    const p = this.scene.input.activePointer;
    if (p) { this.mouseX = p.x; this.mouseY = p.y; }
    this.refresh();
  }

  // Returns false if blocked by mandatory pending item
  close(): boolean {
    const mandatory = this.tray.length > 0 || (this.held !== null && this.held.fromTray !== undefined);
    if (mandatory) return false;

    // Restore any rearrange in progress
    if (this.held?.fromGrid) {
      const o = this.held.fromGrid;
      this.gs.placeAt(this.held.type, o.col, o.row, o.w, o.h);
    }
    this.held = null;
    this.tray.forEach(s => s.label.destroy());
    this.tray = [];
    this.cursorGfx.clear();
    this.cursorLabel.setAlpha(0);
    this.container.setVisible(false);
    return true;
  }

  isOpen(): boolean { return this.container.visible; }

  // Add an item to the tray (called after fishing / loot / purchase)
  beginPlacement(type: ItemType): boolean {
    // Always accept — even when cargo is full.
    // The player can discard existing items (Z key) to make room for the new one.
    const pal = ITEM_PALETTE[type];
    const slotY = TY + this.tray.length * (SLOT_SZ + 8);
    const lbl = this.scene.add.text(TX + TRAY_W / 2 - 8, slotY + SLOT_SZ / 2, pal.icon, {
      fontSize: '30px',
    }).setOrigin(0.5).setDepth(DEPTH + 1).setScrollFactor(0);
    this.tray.push({ type, label: lbl });
    this.open();
    // Return whether the item will actually fit without discarding anything
    return this.gs.canFitItem(type);
  }

  hasHeld(): boolean { return this.held !== null || this.tray.length > 0; }

  /**
   * Use a supply barrel in cargo to restore SAN.
   * Only works when SAN <= 1. Returns true if successful.
   */
  handleUseSupply(): boolean {
    return this.gs.useSupply();
  }

  // Discard the item currently being dragged (Z key)
  handleDiscard(): ItemType | null {
    if (!this.held) return null;
    const t = this.held.type;
    this.held = null;
    this.cursorGfx.clear();
    this.cursorLabel.setAlpha(0);
    this.refresh();
    return t;
  }

  // ─── Pointer input ─────────────────────────────────────────

  handlePointerMove(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseCol = Math.floor((x - GX) / UNIT);
    this.mouseRow = Math.floor((y - GY) / UNIT);
    this.drawGridGhost();
    this.drawCursor();
  }

  // pointerdown: start drag from tray OR pick up from grid
  handlePointerDown(x: number, y: number, button: number) {
    if (button === 2) {
      if (this.held) this.rotateHeld();
      return;
    }
    if (this.held) return; // already holding something

    // --- Tray item? ---
    const ti = this.trayIndexAt(x, y);
    if (ti >= 0) {
      const slot = this.tray[ti];
      const [w, h] = ITEM_SIZE[slot.type];
      this.held = { type: slot.type, w, h, fromTray: ti };
      // Remove from tray array but don't destroy label yet (we keep it until placed)
      slot.label.setAlpha(0.3); // dim while held
      this.mouseCol = Math.floor((x - GX) / UNIT);
      this.mouseRow = Math.floor((y - GY) / UNIT);
      this.drawGridGhost();
      this.drawCursor();
      this.drawStatus();
      return;
    }

    // --- Grid item (rearrange)? ---
    const col = Math.floor((x - GX) / UNIT);
    const row = Math.floor((y - GY) / UNIT);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    const item = this.gs.itemAt(col, row);
    if (!item) return;
    this.gs.removeItem(item.id);
    this.held = {
      type: item.type, w: item.w, h: item.h,
      fromGrid: { id: item.id, col: item.col, row: item.row, w: item.w, h: item.h },
    };
    this.mouseCol = col;
    this.mouseRow = row;
    this.drawGridGhost();
    this.drawCursor();
    this.drawStatus();
    this.drawItems();
  }

  // pointerup: release — place on grid, or return to origin
  handlePointerUp(x: number, y: number) {
    if (!this.held) return;

    const col = Math.floor((x - GX) / UNIT);
    const row = Math.floor((y - GY) / UNIT);
    const placed = this.gs.canPlaceAt(col, row, this.held.w, this.held.h)
      ? this.gs.placeAt(this.held.type, col, row, this.held.w, this.held.h) !== null
      : false;

    if (placed) {
      // Remove tray slot if it came from tray
      if (this.held.fromTray !== undefined) {
        const slot = this.tray[this.held.fromTray];
        slot.label.destroy();
        this.tray.splice(this.held.fromTray, 1);
        this.rebuildTrayLabels();
      }
      this.held = null;
    } else {
      // Invalid drop — return to origin
      if (this.held.fromGrid) {
        const o = this.held.fromGrid;
        this.gs.placeAt(this.held.type, o.col, o.row, o.w, o.h);
        this.held = null;
      } else if (this.held.fromTray !== undefined) {
        // Put back in tray visually
        const slot = this.tray[this.held.fromTray];
        slot.label.setAlpha(1);
        this.held = null;
      }
    }

    this.cursorGfx.clear();
    this.cursorLabel.setAlpha(0);
    this.refresh();
  }

  rotateHeld() {
    if (!this.held) return;
    [this.held.w, this.held.h] = [this.held.h, this.held.w];
    this.drawGridGhost();
    this.drawCursor();
  }

  handleRotate() { this.rotateHeld(); }

  // ─── Tray helpers ──────────────────────────────────────────

  private trayIndexAt(x: number, y: number): number {
    for (let i = 0; i < this.tray.length; i++) {
      const sy = TY + i * (SLOT_SZ + 8);
      if (x >= TX && x <= TX + SLOT_SZ && y >= sy && y <= sy + SLOT_SZ) return i;
    }
    return -1;
  }

  private rebuildTrayLabels() {
    for (let i = 0; i < this.tray.length; i++) {
      const sy = TY + i * (SLOT_SZ + 8);
      this.tray[i].label.setPosition(TX + TRAY_W / 2 - 8, sy + SLOT_SZ / 2);
    }
  }

  // ─── Draw ──────────────────────────────────────────────────

  refresh() {
    this.drawHp();
    this.drawTray();
    this.drawGrid();
    this.drawItems();
    this.drawGridGhost();
    this.drawCursor();
    this.drawStatus();
  }

  private drawHp() {
    const g = this.hpGfx;
    g.clear();
    const bx = GX + 48;
    const by = PY + 46;
    const bw = 22, bh = 14, bgap = 6;
    for (let i = 0; i < this.gs.maxHp; i++) {
      const filled = i < this.gs.hp;
      g.lineStyle(2, 0x806050, 0.8).strokeRect(bx + i * (bw + bgap), by, bw, bh);
      g.fillStyle(filled ? 0xe04040 : 0x1a0a0a, filled ? 0.9 : 0.6)
       .fillRect(bx + i * (bw + bgap) + 2, by + 2, bw - 4, bh - 4);
    }
  }

  private drawTray() {
    const g = this.trayGfx;
    g.clear();
    for (let i = 0; i < this.tray.length; i++) {
      const sy    = TY + i * (SLOT_SZ + 8);
      const pal   = ITEM_PALETTE[this.tray[i].type];
      const held  = this.held?.fromTray === i;
      g.fillStyle(pal.bg, held ? 0.35 : 0.85).fillRoundedRect(TX, sy, SLOT_SZ, SLOT_SZ, 6);
      g.lineStyle(2, pal.border, held ? 0.4 : 0.9).strokeRoundedRect(TX, sy, SLOT_SZ, SLOT_SZ, 6);
      // Animated breathing glow on unheeld items
      if (!held) {
        const pulse = 0.3 + 0.2 * Math.sin(Date.now() / 600 + i);
        g.lineStyle(3, pal.border, pulse).strokeRoundedRect(TX - 2, sy - 2, SLOT_SZ + 4, SLOT_SZ + 4, 8);
      }
      // "Drag me" label
      if (!held) {
        g.fillStyle(0xffffff, 0.08).fillRoundedRect(TX + 2, sy + SLOT_SZ - 18, SLOT_SZ - 4, 16, 4);
      }
    }

    // "待放" empty state hint
    if (this.tray.length === 0 && !this.held) {
      g.fillStyle(0x1a1208, 0.55).fillRoundedRect(TX, TY, SLOT_SZ, SLOT_SZ, 6);
      g.lineStyle(1, 0x403020, 0.4).strokeRoundedRect(TX, TY, SLOT_SZ, SLOT_SZ, 6);
    }

    // Small drag-hint arrows below each active tray slot
    if (this.tray.length > 0) {
      g.fillStyle(0xffc060, 0.55);
      for (let i = 0; i < this.tray.length; i++) {
        if (this.held?.fromTray === i) continue;
        const sy = TY + i * (SLOT_SZ + 8);
        const ax = TX + SLOT_SZ / 2;
        const ay = sy + SLOT_SZ + 2;
        g.fillTriangle(ax, ay + 6, ax - 5, ay, ax + 5, ay);
      }
    }
  }

  private drawGrid() {
    const g = this.gridGfx;
    g.clear();

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!HOLD_SHAPE[row][col]) continue;
        const cx = GX + col * UNIT;
        const cy = GY + row * UNIT;
        g.fillStyle(0x0a1018, 0.92).fillRect(cx, cy, CELL, CELL);
        g.lineStyle(1, 0x281808, 0.55).strokeRect(cx, cy, CELL, CELL);
      }
    }

    g.lineStyle(2, 0x6a4828, 0.9);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!HOLD_SHAPE[row][col]) continue;
        const cx = GX + col * UNIT;
        const cy = GY + row * UNIT;
        if (row === 0           || !HOLD_SHAPE[row - 1][col]) g.lineBetween(cx,        cy,        cx + CELL, cy);
        if (row === GRID_ROWS-1 || !HOLD_SHAPE[row + 1][col]) g.lineBetween(cx,        cy + CELL, cx + CELL, cy + CELL);
        if (col === 0           || !HOLD_SHAPE[row][col - 1]) g.lineBetween(cx,        cy,        cx,        cy + CELL);
        if (col === GRID_COLS-1 || !HOLD_SHAPE[row][col + 1]) g.lineBetween(cx + CELL, cy,        cx + CELL, cy + CELL);
      }
    }
  }

  private drawItems() {
    this.itemLabels.forEach(t => t.destroy());
    this.itemLabels = [];
    const g = this.gridGfx;

    for (const item of this.gs.cargoItems) {
      this.drawItemBox(g, item);
      const pal = ITEM_PALETTE[item.type];
      const ix  = GX + item.col * UNIT;
      const iy  = GY + item.row * UNIT;
      const iw  = item.w * CELL + (item.w - 1) * GAP;
      const ih  = item.h * CELL + (item.h - 1) * GAP;
      const lbl = this.scene.add.text(ix + iw / 2, iy + ih / 2, pal.icon, { fontSize: '26px' })
        .setOrigin(0.5).setDepth(DEPTH + 1).setScrollFactor(0);
      this.itemLabels.push(lbl);
      this.container.add(lbl);
    }
  }

  private drawItemBox(g: Phaser.GameObjects.Graphics, item: CargoItem | { type: ItemType; col: number; row: number; w: number; h: number }) {
    const pal = ITEM_PALETTE[item.type];
    const ix  = GX + item.col * UNIT;
    const iy  = GY + item.row * UNIT;
    const iw  = item.w * CELL + (item.w - 1) * GAP;
    const ih  = item.h * CELL + (item.h - 1) * GAP;
    g.fillStyle(pal.bg, 0.95).fillRect(ix, iy, iw, ih);
    g.lineStyle(2, pal.border, 0.85).strokeRect(ix, iy, iw, ih);
    g.lineStyle(1, pal.border, 0.35).strokeRect(ix + 3, iy + 3, iw - 6, ih - 6);
    g.lineStyle(1, pal.border, 0.12);
    for (let d = -ih; d < iw; d += 14) {
      const x1 = ix + Math.max(0, d);
      const y1 = iy + Math.max(0, -d);
      const x2 = Math.min(ix + iw, ix + d + ih);
      const y2 = Math.min(iy + ih, iy + ih + d);
      g.lineBetween(x1, y1, x2, y2);
    }
  }

  // Ghost overlay on the grid while dragging
  private drawGridGhost() {
    // Clear ghost by redrawing grid & items
    this.drawGrid();
    this.drawItems();
    if (!this.held) return;

    const c = this.mouseCol, r = this.mouseRow;
    if (c < 0 || c + this.held.w > GRID_COLS || r < 0 || r + this.held.h > GRID_ROWS) return;

    const valid = this.gs.canPlaceAt(c, r, this.held.w, this.held.h);
    const pal   = ITEM_PALETTE[this.held.type];
    const g     = this.gridGfx;
    const ix    = GX + c * UNIT;
    const iy    = GY + r * UNIT;
    const iw    = this.held.w * CELL + (this.held.w - 1) * GAP;
    const ih    = this.held.h * CELL + (this.held.h - 1) * GAP;

    if (valid) {
      g.fillStyle(pal.bg, 0.55).fillRect(ix, iy, iw, ih);
      g.lineStyle(3, 0x40e080, 0.95).strokeRect(ix, iy, iw, ih);
    } else {
      g.fillStyle(0x600000, 0.4).fillRect(ix, iy, iw, ih);
      g.lineStyle(3, 0xe04040, 0.85).strokeRect(ix, iy, iw, ih);
      g.lineStyle(2, 0xe04040, 0.9);
      g.lineBetween(ix + 8, iy + 8, ix + iw - 8, iy + ih - 8);
      g.lineBetween(ix + iw - 8, iy + 8, ix + 8, iy + ih - 8);
    }
  }

  // Floating icon that strictly follows the mouse pointer while dragging
  private drawCursor() {
    this.cursorGfx.clear();
    if (!this.held) { this.cursorLabel.setAlpha(0); return; }

    const pal = ITEM_PALETTE[this.held.type];
    const cx  = this.mouseX;
    const cy  = this.mouseY;

    // Semi-transparent item silhouette under the cursor
    const iw = this.held.w * CELL + (this.held.w - 1) * GAP;
    const ih = this.held.h * CELL + (this.held.h - 1) * GAP;
    this.cursorGfx.fillStyle(pal.bg, 0.7)
      .fillRoundedRect(cx - iw / 2, cy - ih / 2, iw, ih, 4);
    this.cursorGfx.lineStyle(2, pal.border, 0.9)
      .strokeRoundedRect(cx - iw / 2, cy - ih / 2, iw, ih, 4);

    this.cursorLabel.setText(pal.icon).setPosition(cx, cy).setAlpha(1);
  }

  private drawStatus() {
    const hasPending = this.tray.length > 0 || (this.held?.fromTray !== undefined);

    // Supply-use prompt (highest priority hint when applicable)
    const canUseSupply = this.gs.san <= 1 && this.gs.cargoCount('supply') > 0 && !this.gs.isDay;

    if (this.held) {
      const pal    = ITEM_PALETTE[this.held.type];
      const orient = this.held.w >= this.held.h ? '横' : '竖';
      this.statusTxt.setText(`${pal.icon} ${pal.name}  (${this.held.w}×${this.held.h} · ${orient})`).setColor('#90e8a0');
      this.hintTxt.setText('拖到格子上放开鼠标放置   [ R / 右键 ] 旋转   [ Z ] 丢弃');
    } else if (hasPending) {
      const isFull = !this.gs.canFitItem(this.tray[0]?.type ?? 'fish');
      const statusMsg = isFull
        ? '⚠ 货舱已满！先 [ Z ] 丢弃旧物品，再拖入新物品'
        : '← 点住左侧物品拖入货仓';
      const statusCol = isFull ? '#e07030' : '#ffd080';
      this.statusTxt.setText(statusMsg).setColor(statusCol);
      this.hintTxt.setText('点住物品 [ Z ] 丢弃   [ Tab ] 关闭');
    } else if (canUseSupply) {
      this.statusTxt.setText('⚠ 精神危机！货舱有补给桶可用').setColor('#e07030');
      this.hintTxt.setText('[ U ] 使用补给 → 精神恢复 +2   [ Tab ] 关闭');
    } else {
      this.statusTxt.setText(`货物 ${this.gs.cargoItems.length} 件  ·  点住物品可重新摆放`).setColor('#a08060');
      this.hintTxt.setText('[ Tab ] 关闭货仓');
    }
  }
}
