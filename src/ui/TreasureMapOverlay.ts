import Phaser from 'phaser';
import { W, H, ZONE_PORT_W, ZONE_SHALLOW_W, WORLD_W, WORLD_H } from '../constants';
import { ActiveMission } from '../missions';

const DEPTH = 40;

// Overlay canvas dimensions
const OW = 560;
const OH = 420;
const OX = (W - OW) / 2;
const OY = (H - OH) / 2;

// Inner map area (draws the deep zone)
const MAP_X = OX + 28;
const MAP_Y = OY + 56;
const MAP_W = 260;
const MAP_H = 200;

// Deep zone world bounds
const DEEP_X = ZONE_PORT_W + ZONE_SHALLOW_W;   // 960
const DEEP_W = WORLD_W - DEEP_X;               // 840

// Scale from deep-zone world coords to map canvas
const SCALE_X = MAP_W / DEEP_W;
const SCALE_Y = MAP_H / WORLD_H;

export class TreasureMapOverlay {
  private container!: Phaser.GameObjects.Container;
  private _open = false;

  constructor(private scene: Phaser.Scene) {
    this.build();
  }

  isOpen() { return this._open; }

  open(mission: ActiveMission) {
    this._open = true;
    this.container.setVisible(true);
    this.redraw(mission);
  }

  close() {
    this._open = false;
    this.container.setVisible(false);
  }

  handleKey(_key: string) {
    this.close();
  }

  private build() {
    this.container = this.scene.add.container(0, 0)
      .setDepth(DEPTH).setScrollFactor(0).setVisible(false);

    // Dim backdrop
    const dim = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.70)
      .setScrollFactor(0);
    this.container.add(dim);
  }

  private redraw(mission: ActiveMission) {
    // Remove all children except the dim backdrop (index 0)
    const children = this.container.list.slice(1);
    children.forEach(c => (c as Phaser.GameObjects.GameObject).destroy());

    const g = this.scene.add.graphics().setScrollFactor(0);
    this.container.add(g);

    // ── Parchment panel ──────────────────────────────────────────
    // Shadow
    g.fillStyle(0x000000, 0.35).fillRoundedRect(OX + 6, OY + 6, OW, OH, 10);
    // Background parchment layers
    g.fillStyle(0x3a2a14).fillRoundedRect(OX, OY, OW, OH, 10);
    g.fillStyle(0xc8a055, 0.92).fillRoundedRect(OX + 3, OY + 3, OW - 6, OH - 6, 8);
    g.fillStyle(0xd4ae6a, 0.55).fillRoundedRect(OX + 10, OY + 10, OW - 20, OH - 20, 6);
    // Worn edge vignette
    g.fillStyle(0x8a5a20, 0.18).fillRoundedRect(OX + 3, OY + 3, OW - 6, OH - 6, 8);

    // Burnt / torn corners
    g.fillStyle(0x3a2208, 0.60);
    g.fillTriangle(OX, OY, OX + 28, OY, OX, OY + 28);
    g.fillTriangle(OX + OW, OY, OX + OW - 28, OY, OX + OW, OY + 28);
    g.fillTriangle(OX, OY + OH, OX + 28, OY + OH, OX, OY + OH - 28);
    g.fillTriangle(OX + OW, OY + OH, OX + OW - 28, OY + OH, OX + OW, OY + OH - 28);

    // Stain blobs
    g.fillStyle(0x9a7230, 0.22);
    g.fillCircle(OX + 70, OY + 50, 28);
    g.fillCircle(OX + OW - 60, OY + OH - 55, 22);
    g.fillCircle(OX + OW - 120, OY + 90, 14);

    // ── Title ────────────────────────────────────────────────────
    const title = this.scene.add.text(OX + OW / 2, OY + 20, '藏  宝  图', {
      fontSize: '18px',
      color: '#3a1a08',
      fontStyle: 'bold',
      stroke: '#c8a055',
      strokeThickness: 0,
    }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.9);
    this.container.add(title);

    // Underline
    g.lineStyle(1, 0x5a3010, 0.6).lineBetween(OX + OW / 2 - 55, OY + 33, OX + OW / 2 + 55, OY + 33);

    // ── Map area (left side — shows the deep zone) ──────────────
    // Deep sea background (darker blue-black)
    g.fillStyle(0x0d1e34, 0.70).fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);
    // Subtle darker gradient overlay at edges
    g.fillStyle(0x050c1a, 0.25).fillRect(MAP_X, MAP_Y, 18, MAP_H);
    g.fillStyle(0x050c1a, 0.25).fillRect(MAP_X + MAP_W - 18, MAP_Y, 18, MAP_H);

    // Grid lines (faint navigation lines)
    g.lineStyle(1, 0x1a3050, 0.30);
    const cols = 6, rows = 5;
    for (let i = 1; i < cols; i++)
      g.lineBetween(MAP_X + (MAP_W / cols) * i, MAP_Y, MAP_X + (MAP_W / cols) * i, MAP_Y + MAP_H);
    for (let j = 1; j < rows; j++)
      g.lineBetween(MAP_X, MAP_Y + (MAP_H / rows) * j, MAP_X + MAP_W, MAP_Y + (MAP_H / rows) * j);

    // Map border
    g.lineStyle(2, 0x5a3010, 0.7).strokeRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    // Zone labels (tiny)
    const tinyStyle = { fontSize: '8px', color: '#3a5878' };
    const shallowLabel = this.scene.add.text(MAP_X - 22, MAP_Y + MAP_H / 2, '浅\n海', tinyStyle)
      .setOrigin(0.5).setScrollFactor(0).setAlpha(0.7);
    this.container.add(shallowLabel);

    // North / South labels
    const northLabel = this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y - 10, '北', tinyStyle)
      .setOrigin(0.5).setScrollFactor(0).setAlpha(0.65);
    const southLabel = this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y + MAP_H + 10, '南', tinyStyle)
      .setOrigin(0.5).setScrollFactor(0).setAlpha(0.65);
    this.container.add([northLabel, southLabel]);

    // "深海" label inside the map
    const deepSeaLabel = this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2, '深  海', {
      fontSize: '20px', color: '#1a304a', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.18);
    this.container.add(deepSeaLabel);

    // Decorative wave symbols scattered in map
    g.lineStyle(1, 0x2a5070, 0.35);
    const wavePositions = [
      [0.12, 0.20], [0.40, 0.10], [0.70, 0.50], [0.25, 0.65], [0.55, 0.80],
      [0.08, 0.55], [0.82, 0.18], [0.60, 0.35], [0.90, 0.70], [0.35, 0.42],
    ];
    for (const [wx, wy] of wavePositions) {
      const px = MAP_X + wx * MAP_W;
      const py = MAP_Y + wy * MAP_H;
      g.lineBetween(px - 5, py, px - 2, py - 2);
      g.lineBetween(px - 2, py - 2, px + 2, py);
      g.lineBetween(px + 2, py, px + 5, py - 2);
    }

    // Tentacle / creature silhouettes (deep sea flavour)
    g.fillStyle(0x1a2a3a, 0.30);
    g.fillCircle(MAP_X + MAP_W * 0.75, MAP_Y + MAP_H * 0.35, 9);
    g.fillCircle(MAP_X + MAP_W * 0.20, MAP_Y + MAP_H * 0.78, 7);

    // ── Treasure X mark ─────────────────────────────────────────
    if (mission.markerX !== undefined && mission.markerY !== undefined) {
      // Map from deep-zone world coords to map canvas
      const drawX = MAP_X + (mission.markerX - DEEP_X) * SCALE_X;
      const drawY = MAP_Y + mission.markerY * SCALE_Y;
      const R = 8;

      // Red circle glow
      g.fillStyle(0xff4020, 0.15).fillCircle(drawX, drawY, R + 5);

      // X cross
      g.lineStyle(2, 0xcc2208, 0.9);
      g.lineBetween(drawX - R, drawY - R, drawX + R, drawY + R);
      g.lineBetween(drawX + R, drawY - R, drawX - R, drawY + R);

      // Small circle at centre
      g.fillStyle(0xcc2208, 0.85).fillCircle(drawX, drawY, 2);
    }

    // ── Compass rose (top-right corner of map) ──────────────────
    const cRx = MAP_X + MAP_W - 18;
    const cRy = MAP_Y + 18;
    g.lineStyle(1, 0x5a3010, 0.70);
    g.lineBetween(cRx, cRy - 10, cRx, cRy + 10);
    g.lineBetween(cRx - 10, cRy, cRx + 10, cRy);
    g.fillStyle(0x8a1010, 0.85).fillTriangle(cRx, cRy - 10, cRx - 3, cRy, cRx + 3, cRy);
    const compassN = this.scene.add.text(cRx, cRy - 14, 'N', { fontSize: '7px', color: '#5a1010' })
      .setOrigin(0.5).setScrollFactor(0);
    this.container.add(compassN);

    // ── Riddle text (right side) ─────────────────────────────────
    const textX = OX + MAP_W + 58;
    const textY = OY + 48;
    const textW = OW - MAP_W - 70;

    const riddleTitle = this.scene.add.text(textX, textY, '— 委托人留言 —', {
      fontSize: '11px',
      color: '#5a2a08',
      fontStyle: 'italic',
    }).setOrigin(0).setScrollFactor(0).setAlpha(0.80);
    this.container.add(riddleTitle);

    g.lineStyle(1, 0x7a4a18, 0.40)
      .lineBetween(textX, textY + 16, textX + textW, textY + 16);

    const lines = mission.riddle ?? ['藏宝位置不明。'];
    let lineY = textY + 24;
    for (const line of lines) {
      const lt = this.scene.add.text(textX, lineY, line, {
        fontSize: '12px',
        color: '#3a1808',
        wordWrap: { width: textW },
        lineSpacing: 4,
      }).setScrollFactor(0).setAlpha(0.92);
      this.container.add(lt);
      lineY += lt.height + 10;
    }

    // Faded "seal" circle bottom-right of text area
    g.fillStyle(0xaa3010, 0.10).fillCircle(OX + OW - 50, OY + OH - 55, 28);
    g.lineStyle(1, 0xaa3010, 0.20).strokeCircle(OX + OW - 50, OY + OH - 55, 28);
    const seal = this.scene.add.text(OX + OW - 50, OY + OH - 55, '淘\n金\n者', {
      fontSize: '9px', color: '#aa3010', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.28);
    this.container.add(seal);

    // ── Dismiss hint ─────────────────────────────────────────────
    const dismiss = this.scene.add.text(OX + OW / 2, OY + OH - 16, '[ E ]  收起地图', {
      fontSize: '11px', color: '#5a3010',
    }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.65);
    this.container.add(dismiss);
  }
}
