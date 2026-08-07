import Phaser from 'phaser';
import { W, H } from '../constants';
import { ROLES, RoleDef, RoleType } from '../GameState';

const CARD_W = 180;
const CARD_H = 240;
const CARD_GAP = 22;
const TOTAL_W = ROLES.length * CARD_W + (ROLES.length - 1) * CARD_GAP;
const START_X = (W - TOTAL_W) / 2;
const CARD_Y  = H / 2 - CARD_H / 2 - 20;

export class StartScene extends Phaser.Scene {
  private selected: RoleType = 'helmsman';
  private cards:  { bg: Phaser.GameObjects.Graphics; glow: Phaser.GameObjects.Graphics; role: RoleDef }[] = [];
  private startBtn!: Phaser.GameObjects.Graphics;
  private startTxt!: Phaser.GameObjects.Text;

  constructor() { super('StartScene'); }

  create() {
    // ── Dark ocean background ──────────────────────────────────
    const bg = this.add.graphics();
    bg.fillStyle(0x030a14).fillRect(0, 0, W, H);
    // Subtle wave lines
    bg.lineStyle(1, 0x0a2030, 0.6);
    for (let y = 0; y < H; y += 32) bg.lineBetween(0, y, W, y);

    // ── Title ─────────────────────────────────────────────────
    this.add.text(W / 2, 68, '选择你的角色', {
      fontSize: '28px', color: '#d0c090', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(W / 2, 108, '你将以此专精驾驭这艘船，踏入深海禁地', {
      fontSize: '14px', color: '#608090',
    }).setOrigin(0.5);

    // ── Role cards ────────────────────────────────────────────
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      const cx = START_X + i * (CARD_W + CARD_GAP);
      this.buildCard(role, cx, CARD_Y);
    }
    this.refreshCards();

    // ── Start button ──────────────────────────────────────────
    this.startBtn = this.add.graphics();
    this.startTxt = this.add.text(W / 2, H - 68, '⚓  出  航', {
      fontSize: '22px', color: '#fce84a', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(2);

    this.drawStartBtn(false);

    this.startBtn.setInteractive(
      new Phaser.Geom.Rectangle(W / 2 - 110, H - 92, 220, 50),
      Phaser.Geom.Rectangle.Contains,
    );
    this.startBtn.on('pointerover', () => this.drawStartBtn(true));
    this.startBtn.on('pointerout',  () => this.drawStartBtn(false));
    this.startBtn.on('pointerdown', () => this.startGame());
    this.startTxt.setInteractive().on('pointerdown', () => this.startGame());

    // Keyboard shortcut
    this.input.keyboard!.on('keydown-ENTER', () => this.startGame());
    this.input.keyboard!.on('keydown-SPACE', () => this.startGame());
  }

  private buildCard(role: RoleDef, cx: number, cy: number) {
    const glow = this.add.graphics().setDepth(0);
    const bg   = this.add.graphics().setDepth(1);

    // Hit area
    bg.setInteractive(
      new Phaser.Geom.Rectangle(cx, cy, CARD_W, CARD_H),
      Phaser.Geom.Rectangle.Contains,
    );
    bg.on('pointerdown', () => {
      this.selected = role.key;
      this.refreshCards();
    });
    bg.on('pointerover', () => {
      if (this.selected !== role.key) {
        bg.setAlpha(0.85);
      }
    });
    bg.on('pointerout', () => bg.setAlpha(1));

    // Icon text
    this.add.text(cx + CARD_W / 2, cy + 52, role.icon, {
      fontSize: '52px',
    }).setOrigin(0.5).setDepth(2);

    // Name
    this.add.text(cx + CARD_W / 2, cy + 108, role.name, {
      fontSize: '20px', color: '#f0e0c0', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(2);

    // Divider
    const divGfx = this.add.graphics().setDepth(2);
    divGfx.lineStyle(1, role.color, 0.5).lineBetween(cx + 18, cy + 124, cx + CARD_W - 18, cy + 124);

    // Desc
    this.add.text(cx + CARD_W / 2, cy + 142, role.desc, {
      fontSize: '11px', color: '#a09070',
      wordWrap: { width: CARD_W - 24 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(2);

    // Bonus (small)
    this.add.text(cx + CARD_W / 2, cy + CARD_H - 20, role.bonus, {
      fontSize: '10px', color: '#80c0a0',
      wordWrap: { width: CARD_W - 16 }, align: 'center',
    }).setOrigin(0.5, 1).setDepth(2);

    this.cards.push({ bg, glow, role });
  }

  private refreshCards() {
    for (let i = 0; i < this.cards.length; i++) {
      const { bg, glow, role } = this.cards[i];
      const cx = START_X + i * (CARD_W + CARD_GAP);
      const cy = CARD_Y;
      const sel = this.selected === role.key;

      bg.clear();
      glow.clear();

      if (sel) {
        // Glow aura
        glow.fillStyle(role.color, 0.12).fillRoundedRect(cx - 8, cy - 8, CARD_W + 16, CARD_H + 16, 14);
        glow.lineStyle(2, role.color, 0.6).strokeRoundedRect(cx - 8, cy - 8, CARD_W + 16, CARD_H + 16, 14);
        // Card background (bright)
        bg.fillStyle(0x0d1e2e, 0.98).fillRoundedRect(cx, cy, CARD_W, CARD_H, 10);
        bg.lineStyle(2, role.color, 0.95).strokeRoundedRect(cx, cy, CARD_W, CARD_H, 10);
        bg.lineStyle(1, role.color, 0.4).strokeRoundedRect(cx + 4, cy + 4, CARD_W - 8, CARD_H - 8, 8);
        // "已选" badge
        bg.fillStyle(role.color, 0.9).fillRoundedRect(cx + CARD_W - 52, cy + 8, 44, 20, 6);
        this.add.text(cx + CARD_W - 30, cy + 18, '已选', {
          fontSize: '11px', color: '#000', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(3);
      } else {
        bg.fillStyle(0x070e18, 0.88).fillRoundedRect(cx, cy, CARD_W, CARD_H, 10);
        bg.lineStyle(1, 0x304050, 0.7).strokeRoundedRect(cx, cy, CARD_W, CARD_H, 10);
      }
    }

    // Update start button color to match selected role (guard: button may not exist yet during first call from create)
    if (this.startBtn) this.drawStartBtn(false);
  }

  private drawStartBtn(hover: boolean) {
    const sel = ROLES.find(r => r.key === this.selected)!;
    const col = hover ? 0x201808 : 0x100c04;
    this.startBtn.clear();
    this.startBtn.fillStyle(col, 0.95).fillRoundedRect(W / 2 - 110, H - 92, 220, 50, 10);
    this.startBtn.lineStyle(2, sel.color, hover ? 0.95 : 0.75)
      .strokeRoundedRect(W / 2 - 110, H - 92, 220, 50, 10);
    if (hover) {
      this.startBtn.lineStyle(1, sel.color, 0.4)
        .strokeRoundedRect(W / 2 - 106, H - 88, 212, 42, 8);
    }
  }

  private startGame() {
    // Store selection and pass to GameScene via registry
    this.registry.set('selectedRole', this.selected);

    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.time.delayedCall(400, () => {
      this.scene.start('GameScene');
    });
  }
}
