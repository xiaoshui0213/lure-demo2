import Phaser from 'phaser';
import { BOSS_HP, BOSS_SPD } from '../constants';

// "远海之主" — a slow but devastating leviathan that lives in the lair
export class Boss {
  x: number;
  y: number;
  hp    = BOSS_HP;
  maxHp = BOSS_HP;
  alive = true;

  damageCooldown = 0;
  private pulseT  = 0;
  private gfx:    Phaser.GameObjects.Graphics;
  private auraGfx: Phaser.GameObjects.Graphics;
  private hpGfx:  Phaser.GameObjects.Graphics;
  private nameTxt: Phaser.GameObjects.Text;
  private _dead   = false;

  constructor(private scene: Phaser.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.auraGfx = scene.add.graphics().setDepth(5);
    this.gfx     = scene.add.graphics().setDepth(6);
    this.hpGfx   = scene.add.graphics().setDepth(7);
    this.nameTxt = scene.add.text(x, y - 60, '远海之主', {
      fontSize: '13px', color: '#e08080', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);
    this.draw();
  }

  update(delta: number, shipX: number, shipY: number, shipInDeep: boolean): boolean {
    if (!this.alive) return false;
    this.pulseT        += delta;
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);

    const dx   = shipX - this.x;
    const dy   = shipY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Chase only when ship in deep (boss won't chase into shallow)
    if (shipInDeep && dist > 6) {
      const spd = BOSS_SPD * (delta / 1000);
      this.x += (dx / dist) * spd;
      this.y += (dy / dist) * spd;
    }

    this.draw();
    return dist < 38 && this.damageCooldown === 0;
  }

  takeDamage(dmg = 1): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.draw(true);
    this.scene.time.delayedCall(110, () => this.alive && this.draw());
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  destroy() {
    if (this._dead) return;
    this._dead = true;
    this.auraGfx.destroy();
    this.gfx.destroy();
    this.hpGfx.destroy();
    this.nameTxt.destroy();
  }

  private draw(hit = false) {
    const g  = this.gfx;
    const ag = this.auraGfx;
    g.clear();
    ag.clear();

    const t     = this.pulseT / 1000;
    const pulse = 1 + 0.08 * Math.sin(t * 2.5);
    const R     = 30 * pulse;

    // ── Outer aura (dark red glow) ──
    ag.fillStyle(0x600020, 0.18); ag.fillCircle(this.x, this.y, R + 32);
    ag.fillStyle(0x800028, 0.22); ag.fillCircle(this.x, this.y, R + 20);

    // ── Long writhing tentacles ──
    const tCol = hit ? 0xff8060 : 0x6a1830;
    g.fillStyle(tCol, 0.92);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + t * 0.35;
      const len = 26 + 8 * Math.sin(t * 2 + i * 0.7);
      const tipX = this.x + Math.cos(ang) * (R + len);
      const tipY = this.y + Math.sin(ang) * (R + len);
      const midX = this.x + Math.cos(ang) * (R + len * 0.5) + Math.cos(ang + Math.PI / 2) * 4;
      const midY = this.y + Math.sin(ang) * (R + len * 0.5) + Math.sin(ang + Math.PI / 2) * 4;
      g.lineStyle(6, tCol, 0.92).lineBetween(this.x, this.y, midX, midY);
      g.lineStyle(4, tCol, 0.92).lineBetween(midX, midY, tipX, tipY);
      g.fillCircle(tipX, tipY, 3);
    }

    // ── Body ──
    g.fillStyle(hit ? 0xffcccc : 0x4a1028, 0.96);
    g.fillCircle(this.x, this.y, R);
    g.lineStyle(2, 0x200810, 0.9).strokeCircle(this.x, this.y, R);

    // Body texture rings
    g.lineStyle(1, 0x1a0410, 0.7).strokeCircle(this.x, this.y, R * 0.7);
    g.lineStyle(1, 0x1a0410, 0.5).strokeCircle(this.x, this.y, R * 0.45);

    // ── Three glowing eyes ──
    const eyePulse = 0.7 + 0.3 * Math.sin(t * 3);
    const eyePositions = [
      [-R * 0.4, -R * 0.2],
      [ R * 0.4, -R * 0.2],
      [ 0,        R * 0.25],
    ];
    for (const [ex, ey] of eyePositions) {
      const x = this.x + ex, y = this.y + ey;
      g.fillStyle(0xff4020, 0.4 * eyePulse).fillCircle(x, y, 7);
      g.fillStyle(0xff6040, eyePulse).fillCircle(x, y, 4);
      g.fillStyle(0xffffff, 1).fillCircle(x - 0.5, y - 0.5, 1.4);
    }

    // ── HP bar (above the boss) ──
    const bar = this.hpGfx;
    bar.clear();
    const BW = 70, BH = 7;
    const bx = this.x - BW / 2;
    const by = this.y - R - 18;
    bar.fillStyle(0x000000, 0.85).fillRect(bx - 2, by - 2, BW + 4, BH + 4);
    bar.fillStyle(0x2a0810, 1).fillRect(bx, by, BW, BH);
    bar.fillStyle(0xe04040, 1).fillRect(bx, by, BW * (this.hp / this.maxHp), BH);
    bar.lineStyle(1, 0xa05858, 0.9).strokeRect(bx, by, BW, BH);
    // Pip markers
    for (let i = 1; i < this.maxHp; i++) {
      const px = bx + (BW / this.maxHp) * i;
      bar.lineStyle(1, 0x000000, 0.8).lineBetween(px, by, px, by + BH);
    }

    this.nameTxt.setPosition(this.x, this.y - R - 32);
  }
}
