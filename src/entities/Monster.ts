import Phaser from 'phaser';
import {
  AGILE_HP, AGILE_SPD, AGILE_DMG, AGILE_HIT_CD, AGILE_RADIUS,
  TANK_HP,  TANK_SPD,  TANK_DMG,  TANK_HIT_CD,  TANK_RADIUS,
} from '../constants';

export type MonsterKind = 'agile' | 'tank';

export class Monster {
  x: number;
  y: number;
  kind:       MonsterKind;
  hp:         number;
  maxHp:      number;
  dmg:        number;   // HP damage dealt per touch
  hitRadius:  number;   // collision + visual radius
  alive  = true;
  isPhantom = false;

  damageCooldown = 0;   // ms — prevents ship from taking rapid repeated hits

  private hitCooldownTime: number;  // base cooldown between hits
  private baseSpd:         number;
  private pulseT    = 0;
  private zigzagT   = 0;          // drives agile sideways oscillation
  private zigzagDir = 1;          // +1 or -1

  private gfx:   Phaser.GameObjects.Graphics;
  private hpGfx: Phaser.GameObjects.Graphics;
  private _dead  = false;

  constructor(private scene: Phaser.Scene, x: number, y: number, kind: MonsterKind = 'tank') {
    this.x    = x;
    this.y    = y;
    this.kind = kind;

    if (kind === 'agile') {
      this.hp            = AGILE_HP;
      this.maxHp         = AGILE_HP;
      this.dmg           = AGILE_DMG;
      this.hitRadius     = AGILE_RADIUS;
      this.hitCooldownTime = AGILE_HIT_CD;
      this.baseSpd       = AGILE_SPD;
      this.zigzagDir     = Math.random() < 0.5 ? 1 : -1;
    } else {
      this.hp            = TANK_HP;
      this.maxHp         = TANK_HP;
      this.dmg           = TANK_DMG;
      this.hitRadius     = TANK_RADIUS;
      this.hitCooldownTime = TANK_HIT_CD;
      this.baseSpd       = TANK_SPD;
    }

    this.gfx   = scene.add.graphics().setDepth(6);
    this.hpGfx = scene.add.graphics().setDepth(7);
    this.draw();
  }

  // ─── Update: chase ship, return true if touching ship ──────

  update(delta: number, shipX: number, shipY: number, shipInDeep: boolean): boolean {
    if (!this.alive) return false;

    this.pulseT        += delta;
    this.zigzagT       += delta / 1000;
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);

    const dx   = shipX - this.x;
    const dy   = shipY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (shipInDeep && dist > 2) {
      let spd = this.baseSpd * (delta / 1000);

      if (this.kind === 'agile') {
        // Zigzag perpendicular to the chase direction
        const perp = this.zigzagDir * Math.sin(this.zigzagT * 3.2) * 0.55;
        const nx = dx / dist;
        const ny = dy / dist;
        this.x += (nx + (-ny) * perp) * spd;
        this.y += (ny + nx    * perp) * spd;

        // Occasionally flip zigzag direction
        if (Math.random() < delta * 0.0004) this.zigzagDir *= -1;
      } else {
        // Tank: straight pursuit
        this.x += (dx / dist) * spd;
        this.y += (dy / dist) * spd;
      }
    }

    this.gfx.setPosition(this.x, this.y);
    this.hpGfx.setPosition(this.x, this.y);
    this.draw();
    this.drawHpBar();

    // Agile: small body but hits from a bit farther (fast & elusive).
    // Tank: large body but must actually close in to deal damage.
    const touchOffset = this.kind === 'agile' ? 26 : 8;
    return dist < this.hitRadius + touchOffset && this.damageCooldown <= 0;
  }

  // ─── Take damage, return true if killed ────────────────────

  takeDamage(dmg: number = 1): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp    = 0;
      this.alive = false;
      this.destroy();
      return true;
    }
    this.scene.time.delayedCall(0, () => {
      if (this.alive) this.draw(true);
      this.scene.time.delayedCall(100, () => { if (this.alive) this.draw(); });
    });
    this.drawHpBar();
    return false;
  }

  destroy() {
    if (this._dead) return;
    this._dead = true;
    this.gfx.destroy();
    this.hpGfx.destroy();
  }

  // ─── Drawing ───────────────────────────────────────────────

  private draw(hit = false) {
    this.kind === 'agile' ? this.drawAgile(hit) : this.drawTank(hit);
  }

  private drawAgile(hit = false) {
    const g = this.gfx;
    g.clear();

    const pulse = 0.85 + Math.sin(this.pulseT * 0.006) * 0.15;
    const r     = this.hitRadius * pulse;
    const alpha = this.isPhantom ? 0.45 : 1;

    // Glow
    g.fillStyle(0xe030a0, 0.18 * alpha);
    g.fillCircle(0, 0, r + 7);

    // Body — hot pink, angular, dart-like
    g.fillStyle(hit ? 0xff80ff : (this.isPhantom ? 0xff40a0 : 0x1a0020), 0.92 * alpha);
    g.fillCircle(0, 0, r);
    g.lineStyle(1.5, hit ? 0xffffff : 0xff40c0, 0.9 * alpha);
    g.strokeCircle(0, 0, r);

    // Bright eyes
    g.fillStyle(0xffffff, 0.95 * alpha);
    g.fillCircle(-4, -3, 2.5); g.fillCircle(4, -3, 2.5);
    g.fillStyle(0xff00a0, 0.95 * alpha);
    g.fillCircle(-4, -3, 1.2); g.fillCircle(4, -3, 1.2);

    // Speed fins (thin lines streaming behind)
    const finA = this.pulseT * 0.004;
    g.lineStyle(1, 0xff60c0, 0.5 * alpha);
    for (let i = 0; i < 3; i++) {
      const a = finA + i * 2.1;
      g.lineBetween(
        Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5,
        Math.cos(a) * (r + 8),  Math.sin(a) * (r + 8),
      );
    }
  }

  private drawTank(hit = false) {
    const g = this.gfx;
    g.clear();

    const pulse = 0.88 + Math.sin(this.pulseT * 0.0028) * 0.12;
    const r     = this.hitRadius * pulse;
    const alpha = this.isPhantom ? 0.45 : 1;

    // Body glow
    g.fillStyle(0x5010a0, 0.25 * alpha);
    g.fillCircle(0, 0, r + 10);

    // Body — dark purple, massive
    g.fillStyle(hit ? 0xd060f0 : (this.isPhantom ? 0x8040a0 : 0x180030), 0.95 * alpha);
    g.fillCircle(0, 0, r);
    g.lineStyle(2, hit ? 0xffffff : 0xa030e0, 0.9 * alpha);
    g.strokeCircle(0, 0, r);

    // Eyes
    const es = r * 0.26;
    g.fillStyle(0xf040f8, 0.95 * alpha);
    g.fillCircle(-es, -es * 0.7, es * 0.7);
    g.fillCircle(es,  -es * 0.7, es * 0.7);
    g.fillStyle(0x000000);
    g.fillCircle(-es, -es * 0.7, es * 0.35);
    g.fillCircle(es,  -es * 0.7, es * 0.35);

    // Tentacles (more than agile)
    g.lineStyle(2, 0x7020c0, 0.65 * alpha);
    for (let i = 0; i < 8; i++) {
      const a  = (i / 8) * Math.PI * 2 + this.pulseT * 0.001;
      const ox = Math.cos(a) * r * 0.7;
      const oy = Math.sin(a) * r * 0.7;
      const tx = Math.cos(a) * (r + 14);
      const ty = Math.sin(a) * (r + 14);
      g.lineBetween(ox, oy, tx, ty);
    }
  }

  private drawHpBar() {
    const g = this.gfx;  // draw on main gfx to save a draw call; hpGfx kept for compat
    const hg = this.hpGfx;
    hg.clear();

    if (this.isPhantom) return;

    const bw = this.hitRadius * 2.8;
    const bh = 4;
    const by = -(this.hitRadius + 10);
    hg.fillStyle(0x3a0000);   hg.fillRect(-bw / 2, by, bw, bh);
    const pct = this.hp / this.maxHp;
    hg.fillStyle(pct > 0.5 ? 0xe03030 : 0xff7020);
    hg.fillRect(-bw / 2, by, bw * pct, bh);
    hg.lineStyle(1, 0x800000); hg.strokeRect(-bw / 2, by, bw, bh);

    // Kind label
    const col  = this.kind === 'agile' ? 0xff60c0 : 0xa050e0;
    const text = this.kind === 'agile' ? '⚡' : '🔴';
    // (drawn via gfx is limited; we'll rely on color coding instead of text)
    void col; void text;
  }
}
