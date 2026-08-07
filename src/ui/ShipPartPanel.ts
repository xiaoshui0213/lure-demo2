/**
 * ShipPartPanel — top-right HUD overlay showing the ship's structural components.
 *
 * Ship orientation (top-down view, bow faces RIGHT toward open sea):
 *
 *            PORT (left side when facing right)
 *              ▲
 *   STERN ◄───[hull]───► BOW
 *              ▼
 *          STARBOARD (right side)
 *
 * In the panel we draw this rotated 90° so the bow points UP for readability.
 */

import Phaser from 'phaser';
import { GameState } from '../GameState';
import { W } from '../constants';

// ─── Types ───────────────────────────────────────────────────
export type ShipPart = 'bow' | 'port' | 'starboard' | 'stern';

export type AttackKind =
  | 'ram'            // head-on collision → bow
  | 'grip_port'      // creature grips port side
  | 'grip_starboard' // creature grips starboard side
  | 'drag'           // creature drags from behind → stern
  | 'rock_port'      // rock hit from port side
  | 'rock_starboard' // rock hit from starboard side
  | 'generic';       // fallback, picks from attacker angle

// ─── Layout constants ─────────────────────────────────────────
const HUD_H = 58;
const PW    = 132;
const PH    = 172;
const PX    = W - PW - 8;
const PY    = HUD_H + 8;

// Part geometry inside the panel (relative to panel top-left origin)
// We draw a top-down ship oriented with bow at the TOP of the panel.
const CX = PX + PW / 2;           // panel center x
const CY = PY + PH / 2 + 6;       // panel center y (slightly lower for title)

//  Part rectangles [cx, cy, w, h]
const PARTS: Record<ShipPart, [number, number, number, number]> = {
  bow:       [CX,       CY - 40, 44, 28],
  port:      [CX - 36,  CY,      28, 38],
  starboard: [CX + 36,  CY,      28, 38],
  stern:     [CX,       CY + 44, 44, 28],
};

const PART_LABELS: Record<ShipPart, string> = {
  bow:       '船头',
  port:      '左舷',
  starboard: '右舷',
  stern:     '船尾',
};

// ─── ShipPartPanel class ─────────────────────────────────────
export class ShipPartPanel {
  private gfx:       Phaser.GameObjects.Graphics;
  private labelTxts: Record<ShipPart, Phaser.GameObjects.Text>;
  private alertBadge: Phaser.GameObjects.Text;

  // Parts that are currently damaged — stays until repair()
  private damagedParts: Set<ShipPart> = new Set();
  // Continuous wall-clock timer for blink animation
  private blinkT = 0;

  constructor(private scene: Phaser.Scene, private gs: GameState) {
    const D = 21;

    this.gfx = scene.add.graphics().setDepth(D).setScrollFactor(0);

    // Part labels
    this.labelTxts = {
      bow:       this.makeLabel(PARTS.bow[0],       PARTS.bow[1],       '船头', D),
      port:      this.makeLabel(PARTS.port[0],      PARTS.port[1],      '左舷', D),
      starboard: this.makeLabel(PARTS.starboard[0], PARTS.starboard[1], '右舷', D),
      stern:     this.makeLabel(PARTS.stern[0],     PARTS.stern[1],     '船尾', D),
    };

    // Title
    scene.add.text(CX, PY + 11, '🚢 船体状态', {
      fontSize: '10px', color: '#7090a8',
      stroke: '#000', strokeThickness: 1,
    }).setDepth(D).setScrollFactor(0).setOrigin(0.5);

    // Damage alert badge (hidden until hit)
    this.alertBadge = scene.add.text(CX, PY + PH - 14, '', {
      fontSize: '10px', color: '#ff5030', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setDepth(D + 1).setScrollFactor(0).setOrigin(0.5);

    this.draw();
  }

  private makeLabel(cx: number, cy: number, txt: string, depth: number) {
    return this.scene.add.text(cx, cy, txt, {
      fontSize: '9px', color: '#80a8c0',
      stroke: '#000', strokeThickness: 1,
    }).setDepth(depth + 1).setScrollFactor(0).setOrigin(0.5);
  }

  // ─── Public: register a hit ─────────────────────────────────
  hit(part: ShipPart) {
    this.damagedParts.add(part);

    // Flash alert badge (short duration — the part itself keeps blinking)
    this.scene.tweens.killTweensOf(this.alertBadge);
    this.alertBadge.setText(`⚠ ${PART_LABELS[part]}受损！`).setAlpha(1);
    this.scene.tweens.add({
      targets: this.alertBadge,
      alpha: 0,
      delay: 2000,
      duration: 600,
      ease: 'Power1',
    });
  }

  // ─── Update loop ─────────────────────────────────────────────
  update(delta: number) {
    this.blinkT += delta;
    this.draw();
  }

  // ─── Drawing ─────────────────────────────────────────────────
  private draw() {
    const g   = this.gfx;
    const gs  = this.gs;
    g.clear();

    const hpRatio = gs.hp / Math.max(gs.maxHp, 1);

    // ── Panel background ────────────────────────────────────
    g.fillStyle(0x040c16, 0.90).fillRoundedRect(PX, PY, PW, PH, 7);
    g.lineStyle(1, 0x1a3858, 0.8).strokeRoundedRect(PX, PY, PW, PH, 7);

    // ── Central hull body ───────────────────────────────────
    // Structural color shifts with HP
    const hullCol = hpRatio > 0.6 ? 0x1a4060
                  : hpRatio > 0.3 ? 0x4a3010
                  : 0x5a1010;
    g.fillStyle(hullCol, 0.9).fillRoundedRect(CX - 20, CY - 28, 40, 56, 6);
    g.lineStyle(1.5, 0x3a7090, 0.55).strokeRoundedRect(CX - 20, CY - 28, 40, 56, 6);

    // Ship mast / deck detail lines
    g.lineStyle(1, 0x2a5070, 0.4);
    g.lineBetween(CX, CY - 20, CX, CY + 20);
    g.lineBetween(CX - 14, CY, CX + 14, CY);

    // ── Draw each part ──────────────────────────────────────
    for (const part of ['bow', 'port', 'starboard', 'stern'] as ShipPart[]) {
      this.drawPart(g, part, hpRatio);
    }

    // ── HP bar at bottom of panel ───────────────────────────
    const bx = PX + 10, by = PY + PH - 20, bw = PW - 20, bh = 6;
    g.fillStyle(0x0a1824).fillRoundedRect(bx, by, bw, bh, 3);
    const barCol = hpRatio > 0.6 ? 0x40c080
                 : hpRatio > 0.3 ? 0xd09030
                 : 0xe03030;
    g.fillStyle(barCol).fillRoundedRect(bx, by, Math.max(2, bw * hpRatio), bh, 3);
    g.lineStyle(1, 0x204050, 0.6).strokeRoundedRect(bx, by, bw, bh, 3);
  }

  private drawPart(g: Phaser.GameObjects.Graphics, part: ShipPart, hpRatio: number) {
    const [cx, cy, pw, ph] = PARTS[part];
    const damaged   = this.damagedParts.has(part);
    const structDmg = 1 - hpRatio;

    let fillCol:   number;
    let borderCol: number;
    let fillAlpha: number;

    if (damaged) {
      // Permanently damaged — slow pulse between bright red and dark red
      const pulse = 0.5 + 0.5 * Math.sin(this.blinkT * 0.005);  // 0..1, ~1Hz
      fillCol   = pulse > 0.5 ? 0xff2020 : 0x991010;
      borderCol = pulse > 0.5 ? 0xff7050 : 0xcc3020;
      fillAlpha = 0.85 + pulse * 0.12;
    } else if (structDmg > 0.65) {
      fillCol   = 0x6a2010; borderCol = 0xb04030; fillAlpha = 0.75;
    } else if (structDmg > 0.35) {
      fillCol   = 0x4a3010; borderCol = 0x806030; fillAlpha = 0.75;
    } else {
      fillCol   = 0x163850; borderCol = 0x3a7890; fillAlpha = 0.80;
    }

    g.fillStyle(fillCol, fillAlpha).fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 5);
    g.lineStyle(damaged ? 2 : 1, borderCol, damaged ? 0.92 : 0.6)
      .strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 5);

    // Crack marks on damaged parts
    if (damaged) {
      const ca = 0.4 + 0.35 * Math.sin(this.blinkT * 0.005);
      g.lineStyle(1, 0xff6030, ca);
      g.lineBetween(cx - 5, cy - 5, cx + 3, cy + 5);
      g.lineBetween(cx + 4, cy - 4, cx - 2, cy + 6);
    }

    // Update label colour
    const lbl = this.labelTxts[part];
    if (damaged) {
      const pulse = 0.5 + 0.5 * Math.sin(this.blinkT * 0.005);
      lbl.setColor(pulse > 0.5 ? '#ff6040' : '#cc3020');
    } else if (structDmg > 0.5) {
      lbl.setColor('#a05030');
    } else {
      lbl.setColor('#80a8c0');
    }
  }

  // Restore all parts (called on repair)
  repair() {
    this.damagedParts.clear();
    this.alertBadge.setAlpha(0);
  }
}
