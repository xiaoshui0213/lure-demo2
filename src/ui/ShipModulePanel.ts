/**
 * ShipModulePanel — ship module upgrade screen (inspired by Warhammer 40K: Rogue Trader).
 *
 * Layout:
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  ⚙ 船只模块改造                                  [ ESC 关闭 ] │
 *  ├──────────────────────────────────────────────────────────────┤
 *  │   Ship silhouette with component slots (top-down view)       │
 *  │                                                              │
 *  │   [推进器]  [船体装甲]  [主炮台]  [感知系统]  [货舱扩建]       │
 *  ├──────────────────────────────────────────────────────────────┤
 *  │   Detail view: selected slot's upgrade options               │
 *  └──────────────────────────────────────────────────────────────┘
 */

import Phaser from 'phaser';
import { GameState } from '../GameState';
import { W, H } from '../constants';

// ─── Panel dimensions ─────────────────────────────────────────
const PW = 640;
const PH = 420;
const PX = (W - PW) / 2;
const PY = (H - PH) / 2;

// ─── Module slot definitions ──────────────────────────────────
interface ModuleSlot {
  key:     string;
  label:   string;
  icon:    string;
  x:       number;  // relative to panel centre
  y:       number;
  active:  boolean; // can be interacted with in demo
  locked?: boolean;
}

const SLOTS: ModuleSlot[] = [
  { key: 'engine',  label: '推进器',  icon: '🚀', x: -200, y:   0, active: false, locked: false },
  { key: 'armor',   label: '船体装甲', icon: '🛡', x: -80,  y:   0, active: true  },
  { key: 'cannon',  label: '主炮台',  icon: '💣', x:   40, y:   0, active: true  },
  { key: 'sensor',  label: '感知系统', icon: '👁', x:  160, y:   0, active: false, locked: true  },
  { key: 'hold',    label: '货舱扩建', icon: '📦', x:  280, y:   0, active: false, locked: true  },
];

// ─── Cannon tier definitions ──────────────────────────────────
interface CannonTierDef {
  tier:    0 | 1;
  name:    string;
  subname: string;
  icon:    string;
  color:   number;
  desc:    string[];
  cost:    { gold: number; loot: number };
}

const CANNON_TIERS: CannonTierDef[] = [
  {
    tier: 0, name: '基础炮台', subname: 'Mk.I Standard', icon: '🔫', color: 0x6080a0,
    desc: ['· 单发弹丸', '· 冷却 1.2 秒', '· 标准破甲'],
    cost: { gold: 0, loot: 0 },
  },
  {
    tier: 1, name: '爆裂炮台', subname: 'Mk.II Blast', icon: '💥', color: 0xe06020,
    desc: ['· 三联散射弹', '· 橙焰爆炸特效', '· 每发伤害 ×1，覆盖更广'],
    cost: { gold: 20, loot: 1 },
  },
];

// ─── Class ────────────────────────────────────────────────────
export class ShipModulePanel {
  private container!: Phaser.GameObjects.Container;
  private gfx!:       Phaser.GameObjects.Graphics;
  private open = false;

  private selectedSlot = 'cannon';
  private slotBtns:    Phaser.GameObjects.Graphics[] = [];
  private slotLabels:  Phaser.GameObjects.Text[]     = [];
  private detailGfx!:  Phaser.GameObjects.Graphics;
  // All objects created inside the detail area — cleared on every refreshDetail()
  private detailObjs: Phaser.GameObjects.GameObject[] = [];
  /** @deprecated use detailObjs */
  private tierCards:   { bg: Phaser.GameObjects.Graphics; btn: Phaser.GameObjects.Graphics }[] = [];
  private statusTxt!:  Phaser.GameObjects.Text;

  // Global pointer listener (bypasses Container input issues)
  private pointerListener: ((ptr: Phaser.Input.Pointer) => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private gs:    GameState,
    private popHint: (msg: string, col?: string) => void,
  ) {
    this.build();
  }

  // ─── Build ─────────────────────────────────────────────────
  private build() {
    const D = 30;
    this.container = this.scene.add.container(0, 0).setDepth(D).setScrollFactor(0).setVisible(false);

    // ── Dim overlay ────────────────────────────────────────
    const dim = this.scene.add.graphics();
    dim.fillStyle(0x000000, 0.65).fillRect(0, 0, W, H);
    this.container.add(dim);

    // ── Panel background ───────────────────────────────────
    this.gfx = this.scene.add.graphics();
    this.gfx.fillStyle(0x060e1a, 0.97).fillRoundedRect(PX, PY, PW, PH, 10);
    this.gfx.lineStyle(2, 0x3060a0, 0.8).strokeRoundedRect(PX, PY, PW, PH, 10);
    this.gfx.lineStyle(1, 0x1a3858, 0.5)
      .strokeRoundedRect(PX + 4, PY + 4, PW - 8, PH - 8, 8);
    this.container.add(this.gfx);

    // ── Title ─────────────────────────────────────────────
    const title = this.scene.add.text(PX + 20, PY + 16, '⚙  船只模块改造', {
      fontSize: '17px', color: '#d0e8ff', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    });
    this.container.add(title);

    const closeHint = this.scene.add.text(PX + PW - 16, PY + 16, '[ ESC ] 关闭', {
      fontSize: '11px', color: '#607090',
    }).setOrigin(1, 0);
    this.container.add(closeHint);

    // ── Divider ────────────────────────────────────────────
    const divGfx = this.scene.add.graphics();
    divGfx.lineStyle(1, 0x1a3858, 0.7).lineBetween(PX + 12, PY + 46, PX + PW - 12, PY + 46);
    this.container.add(divGfx);

    // ── Ship silhouette + slot row ─────────────────────────
    this.buildSlotRow();

    // ── Detail area ────────────────────────────────────────
    this.detailGfx = this.scene.add.graphics();
    this.container.add(this.detailGfx);

    // Status text
    this.statusTxt = this.scene.add.text(PX + PW / 2, PY + PH - 20, '', {
      fontSize: '11px', color: '#a0c0a0', stroke: '#000', strokeThickness: 1,
    }).setOrigin(0.5, 1);
    this.container.add(this.statusTxt);

    this.buildDetailArea();
  }

  // ─── Module slot row ───────────────────────────────────────
  private buildSlotRow() {
    const rowY = PY + 80;
    const cx   = PX + PW / 2 - 60; // shift left to leave room for ship diagram

    for (let i = 0; i < SLOTS.length; i++) {
      const sl = SLOTS[i];
      const sx = cx + sl.x;
      const sy = rowY;

      const bg = this.scene.add.graphics();
      this.container.add(bg);
      this.slotBtns.push(bg);

      // Icon
      const iconTxt = this.scene.add.text(sx, sy + 16, sl.icon, { fontSize: '24px' })
        .setOrigin(0.5);
      this.container.add(iconTxt);

      // Label
      const lbl = this.scene.add.text(sx, sy + 44, sl.label, {
        fontSize: '9px', color: sl.locked ? '#384858' : '#6080a0',
      }).setOrigin(0.5);
      this.container.add(lbl);
      this.slotLabels.push(lbl);

      // Lock badge
      if (sl.locked) {
        const lock = this.scene.add.text(sx + 14, sy - 6, '🔒', { fontSize: '10px' }).setOrigin(0.5);
        this.container.add(lock);
      }

      // Interactivity is handled via the global pointer listener registered in openPanel()
    }

    // Ship silhouette (right side of slots, as decorative reference)
    this.drawShipSilhouette();
    this.refreshSlots();
  }

  private drawShipSilhouette() {
    const sg = this.scene.add.graphics();
    const sx = PX + PW - 95;
    const sy = PY + 58;
    const sw = 78, sh = 110;

    // Hull outline (side view)
    sg.lineStyle(1.5, 0x2a4a6a, 0.6);
    sg.fillStyle(0x0a1830, 0.8);
    // Body
    sg.fillRoundedRect(sx + 8, sy + 10, sw - 16, sh - 20, 6);
    sg.strokeRoundedRect(sx + 8, sy + 10, sw - 16, sh - 20, 6);
    // Bow (pointed right)
    sg.fillTriangle(sx + sw - 8, sy + 10, sx + sw + 10, sy + sh / 2, sx + sw - 8, sy + sh - 10);
    sg.strokeTriangle(sx + sw - 8, sy + 10, sx + sw + 10, sy + sh / 2, sx + sw - 8, sy + sh - 10);
    // Stern flat left
    sg.fillRect(sx + 8, sy + 16, 10, sh - 32);
    // Mast
    sg.lineStyle(1, 0x304060, 0.5).lineBetween(sx + sw / 2, sy + 12, sx + sw / 2, sy + sh - 12);
    // Cannon indicator
    sg.fillStyle(0xe06020, 0.8).fillRect(sx + sw - 20, sy + sh / 2 - 4, 16, 8);

    // Labels pointing to parts
    const lbl = (txt: string, x: number, y: number, col = '#304860') =>
      this.scene.add.text(x, y, txt, { fontSize: '8px', color: col }).setOrigin(0.5);

    this.container.add([sg,
      lbl('船头', sx + sw + 4, sy + sh / 2 - 14),
      lbl('主炮', sx + sw - 10, sy + sh / 2 + 14, '#e08040'),
    ]);
  }

  private refreshSlots() {
    for (let i = 0; i < SLOTS.length; i++) {
      const sl  = SLOTS[i];
      const bg  = this.slotBtns[i];
      const lbl = this.slotLabels[i];
      const cx  = PX + PW / 2 - 60 + sl.x;
      const cy  = PY + 80;
      bg.clear();

      const isSel = this.selectedSlot === sl.key;
      if (sl.active) {
        const col = isSel ? 0x3a6090 : 0x1a2838;
        bg.fillStyle(col, isSel ? 0.9 : 0.5).fillRoundedRect(cx - 30, cy - 8, 60, 62, 6);
        bg.lineStyle(1.5, isSel ? 0x60a0e0 : 0x203048, 0.9)
          .strokeRoundedRect(cx - 30, cy - 8, 60, 62, 6);
        lbl.setColor(isSel ? '#c0e0ff' : '#6080a0');
      } else {
        bg.fillStyle(0x0d1824, 0.5).fillRoundedRect(cx - 30, cy - 8, 60, 62, 6);
        bg.lineStyle(1, sl.locked ? 0x1a2030 : 0x203040, 0.5)
          .strokeRoundedRect(cx - 30, cy - 8, 60, 62, 6);
      }
    }
  }

  // ─── Detail area ───────────────────────────────────────────
  private buildDetailArea() {
    const divGfx = this.scene.add.graphics();
    const dy = PY + 152;
    divGfx.lineStyle(1, 0x1a3858, 0.6).lineBetween(PX + 12, dy, PX + PW - 12, dy);
    this.container.add(divGfx);

    this.refreshDetail();
  }

  private refreshDetail() {
    // Destroy every object created in the previous detail view
    for (const obj of this.detailObjs) {
      if (obj && obj.active) obj.destroy();
    }
    this.detailObjs = [];
    this.tierCards  = []; // kept for legacy references but no longer drives cleanup
    this.detailGfx.clear();
    this.statusTxt.setText('');

    if (this.selectedSlot === 'armor') {
      this.buildArmorDetail();
      return;
    }

    if (this.selectedSlot !== 'cannon') {
      this.track(this.scene.add.text(PX + PW / 2, PY + 280,
        this.selectedSlot === 'engine'
          ? '推进系统当前版本已是最新配置，无需升级。'
          : '该模块在 Demo 阶段尚未开放升级。',
        { fontSize: '12px', color: '#405070', align: 'center', wordWrap: { width: PW - 60 } }
      ).setOrigin(0.5));
      return;
    }

    // Cannon: show tier cards
    this.buildCannonTierCards();
  }

  /** Add obj to container and register it for cleanup on next refreshDetail() */
  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.container.add(obj as any);
    this.detailObjs.push(obj);
    return obj;
  }

  private buildArmorDetail() {
    const gs  = this.gs;
    const dy  = PY + 162;
    const CX  = PX + PW / 2;

    // Section title
    const secTitle = this.scene.add.text(PX + 20, dy, '船体装甲  ›  防护模块', {
      fontSize: '12px', color: '#8090a8',
    });
    this.track(secTitle);

    // Single card
    const CARD_W = 280, CARD_H = 200;
    const cx = CX - CARD_W / 2;
    const cy = dy + 22;

    const installed = gs.armorInstalled;
    const inCargo   = gs.hasArmorAvailable;

    const borderCol = installed ? 0x40c080 : inCargo ? 0x60a0e0 : 0x304050;
    const cardGfx   = this.scene.add.graphics();
    cardGfx.fillStyle(installed ? 0x0a2018 : 0x0a1424, 0.95)
      .fillRoundedRect(cx, cy, CARD_W, CARD_H, 8);
    cardGfx.lineStyle(installed ? 2 : 1.5, borderCol, 0.8)
      .strokeRoundedRect(cx, cy, CARD_W, CARD_H, 8);
    this.track(cardGfx);

    this.track(this.scene.add.text(cx + 20, cy + 18, '🛡', { fontSize: '28px' }).setOrigin(0, 0.5));
    this.track(this.scene.add.text(cx + 60, cy + 12, '标准装甲板', {
      fontSize: '13px', color: installed ? '#80ffc0' : '#c0d8f0', fontStyle: 'bold',
    }));
    this.track(this.scene.add.text(cx + 60, cy + 28, 'Mk.I Hull Plating', {
      fontSize: '9px', color: '#506070',
    }));

    const dv = this.scene.add.graphics();
    dv.lineStyle(1, 0x203040, 0.6).lineBetween(cx + 12, cy + 50, cx + CARD_W - 12, cy + 50);
    this.track(dv);

    const desc = ['· 最大 HP +1', '· 受撞击时船头部件损伤减少', '· 购买后无需占货舱，直接安装'];
    for (let j = 0; j < desc.length; j++) {
      this.track(this.scene.add.text(cx + 16, cy + 58 + j * 18, desc[j], {
        fontSize: '10px', color: installed ? '#70c090' : '#7090b0',
      }));
    }

    // Action button
    const btnGfx = this.scene.add.graphics();
    const btnY   = cy + CARD_H - 40;
    const btnX   = cx + 14;
    const btnW   = CARD_W - 28;
    const btnH   = 28;

    if (installed) {
      btnGfx.fillStyle(0x1a4030, 0.9).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
      btnGfx.lineStyle(1, 0x40c080, 0.6).strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
      this.track(btnGfx);
      this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, '✓  已装配', {
        fontSize: '11px', color: '#40c080', fontStyle: 'bold',
      }).setOrigin(0.5));
    } else if (inCargo) {
      btnGfx.fillStyle(0x0a1824, 0.9).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
      btnGfx.lineStyle(1.5, 0x60a0e0, 0.85).strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
      this.track(btnGfx);
      this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, '[ 2 ] 安装装甲板', {
        fontSize: '11px', color: '#80c0ff', fontStyle: 'bold',
      }).setOrigin(0.5));
    } else {
      btnGfx.fillStyle(0x0a1020, 0.7).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
      this.track(btnGfx);
      this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2,
        '⚠  先从「修船人」购买装甲板', {
        fontSize: '10px', color: '#506070',
      }).setOrigin(0.5));
    }

    this.statusTxt.setText(
      installed ? '装甲板已装配 — 最大 HP +1 生效中'
      : inCargo  ? '装甲板已预订 — 点击安装，无需占用货舱'
      :            '前往港口「修船人」处购买装甲板'
    );
  }

  private installArmor() {
    if (!this.gs.installArmor()) return;
    this.popHint('🛡 装甲板安装完毕！最大 HP +1', '#60e0a0');
    this.refreshSlots();
    this.refreshDetail();
  }

  private buildCannonTierCards() {
    const gs  = this.gs;
    const dy  = PY + 162;
    const CARD_W = 250;
    const CARD_H = 190;
    const gap  = 24;
    const totalW = CARD_W * 2 + gap;
    const startX = PX + (PW - totalW) / 2;

    this.track(this.scene.add.text(PX + 20, dy, '主炮台  ›  选择型号', {
      fontSize: '12px', color: '#8090a8',
    }));

    for (let i = 0; i < CANNON_TIERS.length; i++) {
      const td   = CANNON_TIERS[i];
      const cx   = startX + i * (CARD_W + gap);
      const cy   = dy + 22;
      const isEquipped = gs.cannonTier === td.tier;
      const canAfford  = gs.gold >= td.cost.gold && gs.cargoCount('loot') >= td.cost.loot;
      const isFuture   = td.tier > gs.cannonTier + 1;

      const borderCol = isEquipped ? 0x40c080 : canAfford ? td.color : 0x304050;
      const cardGfx = this.scene.add.graphics();
      cardGfx.fillStyle(isEquipped ? 0x0a2018 : 0x0a1424, 0.95)
        .fillRoundedRect(cx, cy, CARD_W, CARD_H, 8);
      cardGfx.lineStyle(isEquipped ? 2 : 1.5, borderCol, isEquipped ? 0.9 : 0.7)
        .strokeRoundedRect(cx, cy, CARD_W, CARD_H, 8);
      if (isEquipped) {
        cardGfx.lineStyle(1, 0x40c080, 0.3).strokeRoundedRect(cx + 4, cy + 4, CARD_W - 8, CARD_H - 8, 6);
      }
      this.track(cardGfx);

      this.track(this.scene.add.text(cx + 20, cy + 18, td.icon, { fontSize: '28px' }).setOrigin(0, 0.5));
      this.track(this.scene.add.text(cx + 58, cy + 12, td.name, {
        fontSize: '13px', color: isEquipped ? '#80ffc0' : '#c0d8f0', fontStyle: 'bold',
      }));
      this.track(this.scene.add.text(cx + 58, cy + 28, td.subname, {
        fontSize: '9px', color: '#506070',
      }));

      const dv = this.scene.add.graphics();
      dv.lineStyle(1, 0x203040, 0.6).lineBetween(cx + 12, cy + 50, cx + CARD_W - 12, cy + 50);
      this.track(dv);

      for (let j = 0; j < td.desc.length; j++) {
        this.track(this.scene.add.text(cx + 16, cy + 58 + j * 18, td.desc[j], {
          fontSize: '10px', color: isEquipped ? '#70c090' : '#7090b0',
        }));
      }

      const btnGfx = this.scene.add.graphics();
      const btnY   = cy + CARD_H - 40;
      const btnX   = cx + 14;
      const btnW   = CARD_W - 28;
      const btnH   = 28;

      if (isEquipped) {
        btnGfx.fillStyle(0x1a4030, 0.9).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
        btnGfx.lineStyle(1, 0x40c080, 0.6).strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
        this.track(btnGfx);
        this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, '✓  已装配', {
          fontSize: '11px', color: '#40c080', fontStyle: 'bold',
        }).setOrigin(0.5));
      } else if (isFuture) {
        btnGfx.fillStyle(0x0a1020, 0.7).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
        this.track(btnGfx);
        this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2, '🔒  先升级前置型号', {
          fontSize: '10px', color: '#304050',
        }).setOrigin(0.5));
      } else {
        const costStr = td.cost.loot > 0
          ? `${td.cost.loot}x 掉落物 + ${td.cost.gold} 金`
          : `${td.cost.gold} 金`;
        const btnCol = canAfford ? td.color : 0x303040;
        btnGfx.fillStyle(canAfford ? 0x1a1208 : 0x0a1020, 0.9).fillRoundedRect(btnX, btnY, btnW, btnH, 6);
        btnGfx.lineStyle(1.5, btnCol, canAfford ? 0.85 : 0.4).strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
        this.track(btnGfx);
        this.track(this.scene.add.text(btnX + btnW / 2, btnY + btnH / 2,
          canAfford ? `[ 1 ] 安装  ${costStr}` : `费用不足  ${costStr}`, {
          fontSize: '10px', color: canAfford ? '#f0c060' : '#504050', fontStyle: canAfford ? 'bold' : 'normal',
        }).setOrigin(0.5));
      }
    }

    const lootCount = gs.cargoCount('loot');
    this.statusTxt.setText(`当前库存：🪙 ${gs.gold} 金 / ⚔ ${lootCount} 掉落物（击杀深海怪物获取）`);
  }

  private purchaseTier(td: CannonTierDef) {
    const gs = this.gs;
    if (gs.gold < td.cost.gold) return;
    if (gs.cargoCount('loot') < td.cost.loot) return;

    gs.gold -= td.cost.gold;
    for (let i = 0; i < td.cost.loot; i++) gs.consumeOne('loot');

    gs.cannonTier = td.tier;

    this.popHint(`⚙ ${td.name} 安装完毕！`, '#60e0a0');
    this.refreshSlots();
    this.refreshDetail();
  }

  // ─── Open / Close ──────────────────────────────────────────
  isOpen()  { return this.open; }

  openPanel() {
    this.open = true;
    this.container.setVisible(true);
    this.refreshSlots();
    this.refreshDetail();
    this.registerPointerListener();
  }

  closePanel() {
    this.open = false;
    this.container.setVisible(false);
    this.removePointerListener();
  }

  // ─── Global pointer listener (reliable hit-test outside Container) ──
  private registerPointerListener() {
    this.removePointerListener(); // safety

    const rowY  = PY + 80;
    const cx    = PX + PW / 2 - 60;
    const SLOT_H = 62, SLOT_W = 60;

    this.pointerListener = (ptr: Phaser.Input.Pointer) => {
      if (!this.open) return;
      const x = ptr.x, y = ptr.y;

      // ── Slot tab row ─────────────────────────────────────
      for (const sl of SLOTS) {
        if (!sl.active) continue;
        const sx = cx + sl.x;
        const hitX = sx - SLOT_W / 2, hitY = rowY - 8;
        if (x >= hitX && x <= hitX + SLOT_W && y >= hitY && y <= hitY + SLOT_H) {
          this.selectedSlot = sl.key;
          this.refreshSlots();
          this.refreshDetail();
          return;
        }
      }

      // ── Action buttons inside detail area ────────────────
      this.handleDetailClick(x, y);
    };

    this.scene.input.on('pointerdown', this.pointerListener);
  }

  private removePointerListener() {
    if (this.pointerListener) {
      this.scene.input.off('pointerdown', this.pointerListener);
      this.pointerListener = null;
    }
  }

  // Route clicks on action buttons within the detail panel
  private handleDetailClick(x: number, y: number) {
    if (this.selectedSlot === 'armor') {
      // Armor install button: centered roughly below the card
      const btnX = PX + (PW - 256) / 2 + 14;
      const btnY = PY + 162 + 22 + 200 - 40;
      const btnW = 256 - 28, btnH = 28;
      if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
        this.installArmor();
      }
      return;
    }

    if (this.selectedSlot === 'cannon') {
      // Cannon purchase buttons
      const dy     = PY + 162;
      const CARD_W = 250, CARD_H = 190, gap = 24;
      const totalW = CARD_W * 2 + gap;
      const startX = PX + (PW - totalW) / 2;

      for (let i = 0; i < CANNON_TIERS.length; i++) {
        const td   = CANNON_TIERS[i];
        const cardX = startX + i * (CARD_W + gap);
        const cy   = dy + 22;
        const btnX = cardX + 14, btnY = cy + CARD_H - 40;
        const btnW = CARD_W - 28, btnH = 28;
        if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
          if (td.tier > this.gs.cannonTier) {
            this.purchaseTier(td);
          }
          return;
        }
      }
    }
  }

  handleKey(keyCode: string) {
    if (!this.open) return;
    if (keyCode === 'ESC') { this.closePanel(); return; }

    // '1' = install first available cannon upgrade
    if (keyCode === 'ONE' && this.selectedSlot === 'cannon') {
      const next = CANNON_TIERS.find(t => t.tier > this.gs.cannonTier);
      if (next) this.purchaseTier(next);
    }

    // '2' = install armor when armor slot is selected
    if (keyCode === 'TWO' && this.selectedSlot === 'armor') {
      this.installArmor();
    }
  }
}
