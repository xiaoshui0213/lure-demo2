import Phaser from 'phaser';
import { W, H, ZONE_PORT_W, ZONE_SHALLOW_W, WORLD_W, WORLD_H } from '../constants';
import { ActiveMission } from '../missions';

const DEPTH = 40;

const OW = 580;
const OH = 400;
const OX = (W - OW) / 2;
const OY = (H - OH) / 2;

// Sketch-map area inside the panel
const MAP_X = OX + 24;
const MAP_Y = OY + 60;
const MAP_W = 250;
const MAP_H = 210;

// Deep-zone world bounds (wreck lives here)
const DEEP_X = ZONE_PORT_W + ZONE_SHALLOW_W;   // 960
const DEEP_W  = WORLD_W - DEEP_X;              // 840

// Scale: deep-zone world coords → sketch-map canvas
const SCALE_X = MAP_W / DEEP_W;
const SCALE_Y = MAP_H / WORLD_H;

function toMapX(wx: number) { return MAP_X + (wx - DEEP_X) * SCALE_X; }
function toMapY(wy: number) { return MAP_Y + wy * SCALE_Y; }

export class ShipLogOverlay {
  private container!: Phaser.GameObjects.Container;
  private _open = false;

  constructor(private scene: Phaser.Scene) { this.build(); }

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

  handleKey(_key: string) { this.close(); }

  private build() {
    this.container = this.scene.add.container(0, 0)
      .setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    this.container.add(
      this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.68).setScrollFactor(0),
    );
  }

  private redraw(mission: ActiveMission) {
    this.container.list.slice(1).forEach(c =>
      (c as Phaser.GameObjects.GameObject).destroy(),
    );

    const g = this.scene.add.graphics().setScrollFactor(0);
    this.container.add(g);

    // ── Worn paper ──────────────────────────────────────────────
    g.fillStyle(0x000000, 0.40).fillRoundedRect(OX + 6, OY + 6, OW, OH, 8);
    g.fillStyle(0x2a2a20).fillRoundedRect(OX, OY, OW, OH, 8);
    g.fillStyle(0xd6cba0, 0.88).fillRoundedRect(OX + 3, OY + 3, OW - 6, OH - 6, 6);
    g.fillStyle(0xbcb28a, 0.40).fillRoundedRect(OX + 10, OY + 10, OW - 20, OH - 20, 5);
    // Water-stain blobs
    g.fillStyle(0x8a9090, 0.20);
    g.fillCircle(OX + 40, OY + OH - 60, 38);
    g.fillCircle(OX + OW - 50, OY + 80, 30);
    g.fillStyle(0x606858, 0.14).fillCircle(OX + OW / 2 + 40, OY + OH - 40, 22);
    // Torn corners
    g.fillStyle(0x2a2a20, 0.80);
    g.fillTriangle(OX, OY, OX + 36, OY, OX, OY + 36);
    g.fillTriangle(OX + OW, OY + OH, OX + OW - 30, OY + OH, OX + OW, OY + OH - 30);
    // Divider
    g.lineStyle(1, 0x706040, 0.55).lineBetween(OX + 16, OY + 44, OX + OW - 16, OY + 44);

    // ── Header ────────────────────────────────────────────────────
    this.container.add(
      this.scene.add.text(OX + OW / 2, OY + 18, '货  船  航  运  日  志（残页）', {
        fontSize: '15px', color: '#2a1e08', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.88),
    );

    // ── Deep-sea sketch map (left half) ──────────────────────────
    // Sea background — deep black-blue
    g.fillStyle(0x0d1a2c, 0.80).fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    // Faint navigation grid
    g.lineStyle(1, 0x1a3050, 0.22);
    for (let i = 1; i < 5; i++)
      g.lineBetween(MAP_X + MAP_W / 5 * i, MAP_Y, MAP_X + MAP_W / 5 * i, MAP_Y + MAP_H);
    for (let j = 1; j < 4; j++)
      g.lineBetween(MAP_X, MAP_Y + MAP_H / 4 * j, MAP_X + MAP_W, MAP_Y + MAP_H / 4 * j);

    // Map border
    g.lineStyle(2, 0x5a4828, 0.65).strokeRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    // Shallow-sea strip on LEFT edge (entry boundary)
    g.fillStyle(0x1a3a50, 0.30).fillRect(MAP_X, MAP_Y, 18, MAP_H);
    this.container.add(
      this.scene.add.text(MAP_X - 18, MAP_Y + MAP_H / 2, '浅\n海', {
        fontSize: '8px', color: '#3a6080',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.60),
    );

    // "深  海" watermark
    this.container.add(
      this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2, '深  海', {
        fontSize: '22px', color: '#0a1828', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.18),
    );

    // Compass rose
    const crx = MAP_X + MAP_W - 16, cry = MAP_Y + 16;
    g.lineStyle(1, 0x4a3820, 0.70);
    g.lineBetween(crx, cry - 9, crx, cry + 9);
    g.lineBetween(crx - 9, cry, crx + 9, cry);
    g.fillStyle(0x8a1a10, 0.80).fillTriangle(crx, cry - 9, crx - 3, cry, crx + 3, cry);
    this.container.add(
      this.scene.add.text(crx, cry - 13, 'N', { fontSize: '7px', color: '#4a1810' })
        .setOrigin(0.5).setScrollFactor(0),
    );

    // Decorative wave marks
    g.lineStyle(1, 0x1a3a58, 0.32);
    for (const [wx, wy] of [[0.18,0.22],[0.55,0.15],[0.80,0.55],[0.30,0.68],[0.65,0.82],[0.10,0.48]]) {
      const px = MAP_X + wx * MAP_W, py = MAP_Y + wy * MAP_H;
      g.lineBetween(px - 4, py, px - 1, py - 2);
      g.lineBetween(px - 1, py - 2, px + 2, py);
      g.lineBetween(px + 2, py, px + 5, py - 2);
    }

    // ── Highlighted search quadrant (after bottle found) ─────────
    if (mission.bottleFound && mission.wreckX !== undefined && mission.wreckY !== undefined) {
      const wx = mission.wreckX, wy = mission.wreckY;

      // Determine quadrant: 2×2 division of deep zone
      const relX = (wx - DEEP_X) / DEEP_W;   // 0..1
      const relY = wy / WORLD_H;               // 0..1

      // Quadrant bounds with generous overlap (~35% each side)
      const qxMin = Math.max(0, relX - 0.35);
      const qxMax = Math.min(1, relX + 0.35);
      const qyMin = Math.max(0, relY - 0.35);
      const qyMax = Math.min(1, relY + 0.35);

      const hx = MAP_X + qxMin * MAP_W;
      const hy = MAP_Y + qyMin * MAP_H;
      const hw = (qxMax - qxMin) * MAP_W;
      const hh = (qyMax - qyMin) * MAP_H;

      // Soft highlight fill
      g.fillStyle(0xcc6622, 0.12).fillRect(hx, hy, hw, hh);
      // Dashed border (draw as short segments)
      g.lineStyle(1, 0xcc6622, 0.55);
      const dash = 8, gap = 6;
      // Top & bottom edges
      for (let x = hx; x < hx + hw; x += dash + gap) {
        g.lineBetween(x, hy, Math.min(x + dash, hx + hw), hy);
        g.lineBetween(x, hy + hh, Math.min(x + dash, hx + hw), hy + hh);
      }
      // Left & right edges
      for (let y = hy; y < hy + hh; y += dash + gap) {
        g.lineBetween(hx, y, hx, Math.min(y + dash, hy + hh));
        g.lineBetween(hx + hw, y, hx + hw, Math.min(y + dash, hy + hh));
      }

      // Cardinal direction labels (N/S/E/W) relative to the quadrant centre
      const labels: [string, number, number][] = [
        [relY < 0.35 ? '北部' : relY < 0.65 ? '中部' : '南部',
          MAP_X + MAP_W / 2, MAP_Y + (hy - MAP_Y + hy + hh - MAP_Y) / 2 ],
      ];
      // Simple label: EW position
      const ewLabel = relX < 0.35 ? '西侧' : relX < 0.65 ? '中段' : '东侧';
      const nsLabel = relY < 0.35 ? '北部' : relY < 0.65 ? '中部' : '南部';

      this.container.add(
        this.scene.add.text(hx + hw / 2, hy + hh / 2, `?`, {
          fontSize: '20px', color: '#cc6622', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.55),
      );

      // Small annotation below map
      this.container.add(
        this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y + MAP_H + 10,
          `大致方位：${ewLabel}${nsLabel}`, {
            fontSize: '9px', color: '#5a3a18',
          }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.70),
      );
    } else {
      // Before bottle: map is fogged
      g.fillStyle(0x000000, 0.40).fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);
      this.container.add(
        this.scene.add.text(MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2, '?', {
          fontSize: '48px', color: '#8a7a60', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.22),
      );
    }

    // ── Log clue text (right half) ───────────────────────────────
    const textX = OX + MAP_W + 44;
    const textY = OY + 56;
    const textW = OW - MAP_W - 54;

    this.container.add(
      this.scene.add.text(textX, textY, '— 最后记录 —', {
        fontSize: '11px', color: '#4a3010', fontStyle: 'italic',
      }).setScrollFactor(0).setAlpha(0.78),
    );
    g.lineStyle(1, 0x6a5028, 0.38).lineBetween(textX, textY + 18, textX + textW, textY + 18);

    const clues = mission.logClues ?? ['航运日志内容不明。'];
    let lineY = textY + 28;
    for (const line of clues) {
      const lt = this.scene.add.text(textX, lineY, line, {
        fontSize: '12px', color: '#2a1e08',
        wordWrap: { width: textW }, lineSpacing: 3,
      }).setScrollFactor(0).setAlpha(0.90);
      this.container.add(lt);
      lineY += lt.height + 9;
    }

    // Status hint below clues
    lineY += 4;
    const hint = mission.bottleFound
      ? '已解读日志。前往深海，在标记区域搜寻。'
      : '先在浅海找到漂流瓶，才能解读沉船位置。';
    this.container.add(
      this.scene.add.text(textX, lineY, hint, {
        fontSize: '11px',
        color: mission.bottleFound ? '#224422' : '#5a2808',
        fontStyle: 'italic',
        wordWrap: { width: textW },
      }).setScrollFactor(0).setAlpha(0.75),
    );

    // ── Merchant seal ──────────────────────────────────────────────
    const sealX = OX + OW - 44, sealY = OY + OH - 48;
    g.fillStyle(0x224468, 0.10).fillCircle(sealX, sealY, 30);
    g.lineStyle(1, 0x224468, 0.22).strokeCircle(sealX, sealY, 30);
    this.container.add(
      this.scene.add.text(sealX, sealY, '浮木\n商会', {
        fontSize: '9px', color: '#224468', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.30),
    );

    // ── Dismiss ────────────────────────────────────────────────────
    this.container.add(
      this.scene.add.text(OX + OW / 2, OY + OH - 14, '[ E ]  收起日志', {
        fontSize: '11px', color: '#4a3010',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0.60),
    );
  }
}
