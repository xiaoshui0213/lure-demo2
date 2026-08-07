/**
 * LootDropPopup — a centered item-reveal card shown whenever the player
 * acquires a new item (monster loot, boss reward, fishing catch, port purchase).
 *
 * Flow:
 *   show(type, onCollect)
 *     → animated card appears
 *     → player presses E / clicks "收入货舱"
 *     → card fades out → onCollect() is called
 *     → CargoPanel opens with item in tray
 */

import Phaser from 'phaser';
import { ItemType } from '../GameState';
import { W, H }     from '../constants';

// ─── Item display info ────────────────────────────────────────
interface ItemInfo {
  icon:      string;
  name:      string;
  flavour:   string;
  rarity:    string;
  frameCol:  number;
  glowCol:   number;
}

const ITEM_INFO: Record<ItemType, ItemInfo> = {
  loot: {
    icon: '⚔', name: '掠夺之物', flavour: '怪物的残骸碎片，可用于船只改造',
    rarity: '▲ 战斗掉落', frameCol: 0x8040c0, glowCol: 0xc060ff,
  },
  fish: {
    icon: '🐟', name: '普通鱼', flavour: '浅海常见鱼类，鱼贩能收',
    rarity: '◆ 普通', frameCol: 0x208060, glowCol: 0x40c090,
  },
  deep_fish: {
    icon: '🐠', name: '深海鱼', flavour: '深海独有的神秘生物，价格更高',
    rarity: '◆ 稀有', frameCol: 0x204090, glowCol: 0x4080f0,
  },
  glow_fish: {
    icon: '✨', name: '幽光鱼', flavour: '鱼贩挂念的发光生物……',
    rarity: '★ 任务物品', frameCol: 0x608010, glowCol: 0xc0f020,
  },
  armor: {
    icon: '🛡', name: '船体装甲', flavour: '能显著提升船只最大耐久',
    rarity: '◆ 装备', frameCol: 0x206080, glowCol: 0x40a0c0,
  },
  hook: {
    icon: '🎣', name: '专业鱼钩', flavour: '钓鱼时绿区更宽，更容易命中',
    rarity: '◆ 装备', frameCol: 0x408020, glowCol: 0x80c040,
  },
  supply: {
    icon: '⛽', name: '船用补给', flavour: '夜间出海必备的燃料与食物',
    rarity: '◆ 消耗品', frameCol: 0xa06010, glowCol: 0xe09030,
  },
  treasure: {
    icon: '📦', name: '埋藏的宝箱', flavour: '沙土下挖出的宝物，残骸猎人愿意高价收购',
    rarity: '★ 委托物品', frameCol: 0xa07020, glowCol: 0xffd040,
  },
  relic: {
    icon: '💀', name: '怪物遗骸', flavour: '深海猎物的残骸，深渊教团收购的标本',
    rarity: '★ 委托物品', frameCol: 0x601080, glowCol: 0xc060ff,
  },
  cargo_crate: {
    icon: '🪵', name: '打捞货物', flavour: '浮木商会沉船上的防水货箱，完好无损',
    rarity: '★ 委托物品', frameCol: 0x205080, glowCol: 0x40a0e0,
  },
};

// ─── Panel size ───────────────────────────────────────────────
const PW = 280;
const PH = 330;
const PX = (W - PW) / 2;
const PY = (H - PH) / 2 - 20;

// ─── Class ────────────────────────────────────────────────────
export class LootDropPopup {
  private container!: Phaser.GameObjects.Container;
  private open = false;
  private onCollect: (() => void) | null = null;
  private pulseT    = 0;
  private frameGfx!: Phaser.GameObjects.Graphics;
  private glowGfx!:  Phaser.GameObjects.Graphics;
  private currentInfo: ItemInfo | null = null;

  constructor(private scene: Phaser.Scene) {
    this.build();
  }

  // ─── Build static structure ───────────────────────────────
  private build() {
    const D = 35;
    this.container = this.scene.add
      .container(W / 2, H / 2)
      .setDepth(D)
      .setScrollFactor(0)
      .setVisible(false);

    // Dim overlay (full screen, click to collect)
    const dim = this.scene.add.graphics();
    dim.fillStyle(0x000000, 0.55).fillRect(-W / 2, -H / 2, W, H);
    dim.setInteractive(new Phaser.Geom.Rectangle(-W / 2, -H / 2, W, H), Phaser.Geom.Rectangle.Contains);
    dim.on('pointerdown', () => this.collect());
    this.container.add(dim);

    // Animated glow behind card
    this.glowGfx = this.scene.add.graphics();
    this.container.add(this.glowGfx);

    // Card background
    const cardBg = this.scene.add.graphics();
    cardBg.fillStyle(0x05101e, 0.97).fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 12);
    this.container.add(cardBg);

    // Card frame (redrawn when item changes)
    this.frameGfx = this.scene.add.graphics();
    this.container.add(this.frameGfx);
  }

  // ─── Show popup ──────────────────────────────────────────
  show(type: ItemType, onCollect: () => void) {
    this.onCollect  = onCollect;
    this.open       = true;
    this.pulseT     = 0;
    this.currentInfo = ITEM_INFO[type];

    // Clear and rebuild dynamic content
    this.rebuildContent(type);

    this.container.setVisible(true).setScale(0.55).setAlpha(0);
    this.scene.tweens.add({
      targets:  this.container,
      scaleX:   1, scaleY: 1, alpha: 1,
      duration: 220,
      ease:     'Back.Out',
    });
  }

  private rebuildContent(type: ItemType) {
    const info = ITEM_INFO[type];

    // Remove old dynamic children (keep dim + glowGfx + cardBg + frameGfx = indices 0-3)
    while (this.container.length > 4) {
      this.container.getAt(this.container.length - 1)?.destroy();
      this.container.removeAt(this.container.length - 1);
    }

    this.drawFrame(info);

    // ── "获得" header ───────────────────────────────────────
    const headerTxt = this.scene.add.text(0, -PH / 2 + 20, '✦  获 得 物 品  ✦', {
      fontSize: '13px', color: '#' + info.glowCol.toString(16).padStart(6, '0'),
      fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    this.container.add(headerTxt);

    // ── Item icon frame ──────────────────────────────────────
    const iconFrameGfx = this.scene.add.graphics();
    const ifx = -55, ify = -PH / 2 + 55, ifw = 110, ifh = 110;
    iconFrameGfx.fillStyle(info.frameCol, 0.18).fillRoundedRect(ifx, ify, ifw, ifh, 10);
    iconFrameGfx.lineStyle(2, info.frameCol, 0.85).strokeRoundedRect(ifx, ify, ifw, ifh, 10);
    iconFrameGfx.lineStyle(1, info.glowCol, 0.4).strokeRoundedRect(ifx + 4, ify + 4, ifw - 8, ifh - 8, 7);
    this.container.add(iconFrameGfx);

    // ── Icon ────────────────────────────────────────────────
    const iconTxt = this.scene.add.text(0, -PH / 2 + 110, info.icon, {
      fontSize: '52px',
    }).setOrigin(0.5);
    this.container.add(iconTxt);

    // ── Rarity badge ─────────────────────────────────────────
    const rarBadgeGfx = this.scene.add.graphics();
    rarBadgeGfx.fillStyle(info.frameCol, 0.55).fillRoundedRect(-64, -PH / 2 + 180, 128, 22, 5);
    this.container.add(rarBadgeGfx);

    const rarTxt = this.scene.add.text(0, -PH / 2 + 191, info.rarity, {
      fontSize: '10px', color: '#' + info.glowCol.toString(16).padStart(6, '0'),
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.container.add(rarTxt);

    // ── Item name ─────────────────────────────────────────────
    const nameTxt = this.scene.add.text(0, -PH / 2 + 213, info.name, {
      fontSize: '18px', color: '#f0e8d0', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(nameTxt);

    // ── Flavour text ──────────────────────────────────────────
    const flavTxt = this.scene.add.text(0, -PH / 2 + 240, info.flavour, {
      fontSize: '10px', color: '#7090a8',
      wordWrap: { width: PW - 40 }, align: 'center',
    }).setOrigin(0.5, 0);
    this.container.add(flavTxt);

    // ── Divider ───────────────────────────────────────────────
    const divGfx = this.scene.add.graphics();
    divGfx.lineStyle(1, info.frameCol, 0.4)
      .lineBetween(-PW / 2 + 20, PH / 2 - 60, PW / 2 - 20, PH / 2 - 60);
    this.container.add(divGfx);

    // ── Collect button ────────────────────────────────────────
    const btnGfx = this.scene.add.graphics();
    const bx = -100, by = PH / 2 - 52, bw = 200, bh = 36;
    btnGfx.fillStyle(info.frameCol, 0.22).fillRoundedRect(bx, by, bw, bh, 8);
    btnGfx.lineStyle(1.5, info.glowCol, 0.7).strokeRoundedRect(bx, by, bw, bh, 8);
    btnGfx.setInteractive(new Phaser.Geom.Rectangle(bx, by, bw, bh), Phaser.Geom.Rectangle.Contains);
    btnGfx.on('pointerover', () => {
      btnGfx.clear();
      btnGfx.fillStyle(info.frameCol, 0.55).fillRoundedRect(bx, by, bw, bh, 8);
      btnGfx.lineStyle(2, info.glowCol, 0.95).strokeRoundedRect(bx, by, bw, bh, 8);
    });
    btnGfx.on('pointerout', () => {
      btnGfx.clear();
      btnGfx.fillStyle(info.frameCol, 0.22).fillRoundedRect(bx, by, bw, bh, 8);
      btnGfx.lineStyle(1.5, info.glowCol, 0.7).strokeRoundedRect(bx, by, bw, bh, 8);
    });
    btnGfx.on('pointerdown', () => this.collect());
    this.container.add(btnGfx);

    const btnTxt = this.scene.add.text(0, by + bh / 2, '[ E ]  收入货舱', {
      fontSize: '13px', color: '#d0e8ff', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    this.container.add(btnTxt);
  }

  private drawFrame(info: ItemInfo) {
    const g = this.frameGfx;
    g.clear();
    g.lineStyle(2, info.frameCol, 0.85).strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 12);
    g.lineStyle(1, info.glowCol, 0.35).strokeRoundedRect(-PW / 2 + 3, -PH / 2 + 3, PW - 6, PH - 6, 10);
  }

  // ─── Update (called every frame while open) ───────────────
  update(delta: number) {
    if (!this.open || !this.currentInfo) return;
    this.pulseT += delta;

    // Glow pulse behind the card
    const info   = this.currentInfo;
    const gAlpha = 0.04 + Math.sin(this.pulseT * 0.003) * 0.03;
    this.glowGfx.clear();
    this.glowGfx.fillStyle(info.glowCol, gAlpha);
    this.glowGfx.fillRoundedRect(-PW / 2 - 10, -PH / 2 - 10, PW + 20, PH + 20, 18);

    // Redraw frame with subtle pulse
    const fAlpha = 0.7 + Math.sin(this.pulseT * 0.004) * 0.25;
    this.frameGfx.clear();
    this.frameGfx.lineStyle(2, info.frameCol, fAlpha).strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 12);
    this.frameGfx.lineStyle(1, info.glowCol, fAlpha * 0.4)
      .strokeRoundedRect(-PW / 2 + 3, -PH / 2 + 3, PW - 6, PH - 6, 10);
  }

  // ─── Collect (E key or button click) ─────────────────────
  collect() {
    if (!this.open) return;
    this.open = false;

    this.scene.tweens.add({
      targets: this.container,
      scaleX: 0.75, scaleY: 0.75, alpha: 0,
      duration: 160,
      ease: 'Power2',
      onComplete: () => {
        this.container.setVisible(false);
        const cb = this.onCollect;
        this.onCollect = null;
        if (cb) cb();
      },
    });
  }

  // ─── State ────────────────────────────────────────────────
  isOpen() { return this.open; }
}
