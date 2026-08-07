import Phaser from 'phaser';
import { ItemType } from '../GameState';
import { W, H } from '../constants';
import { ITEM_PALETTE } from './CargoPanel';

// Big centered card shown on first acquisition of an item type.
// Player clicks / presses F / Space to accept, then the cargo panel opens
// with the item held for placement.

const CW = 460;
const CH = 240;
const CX = (W - CW) / 2;
const CY = (H - CH) / 2 - 20;
const DEPTH = 50;

export class ItemRevealCard {
  private container!:   Phaser.GameObjects.Container;
  private overlay!:     Phaser.GameObjects.Rectangle;
  private iconTxt!:     Phaser.GameObjects.Text;
  private nameTxt!:     Phaser.GameObjects.Text;
  private descTxt!:     Phaser.GameObjects.Text;
  private newBadgeTxt!: Phaser.GameObjects.Text;
  private hintTxt!:     Phaser.GameObjects.Text;

  private currentType: ItemType | null = null;
  private onAccept:    (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private onBeforeDismiss?: () => void,
  ) {
    this.build();
  }

  private build() {
    // Dim background — interactive only while card is visible
    this.overlay = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);
    this.overlay.on('pointerdown', () => this.accept());

    // Card body
    const card = this.scene.add.graphics();
    card.fillStyle(0x0a1220, 0.98).fillRoundedRect(CX, CY, CW, CH, 12);
    card.lineStyle(2, 0xd8b060, 0.9).strokeRoundedRect(CX, CY, CW, CH, 12);
    card.lineStyle(1, 0x50361c, 0.7).strokeRoundedRect(CX + 6, CY + 6, CW - 12, CH - 12, 8);

    // Golden decorative corner accents
    card.lineStyle(2, 0xd8b060, 0.6);
    for (const [px, py] of [[CX + 14, CY + 14], [CX + CW - 14, CY + 14], [CX + 14, CY + CH - 14], [CX + CW - 14, CY + CH - 14]]) {
      card.lineBetween(px - 8, py, px + 8, py);
      card.lineBetween(px, py - 8, px, py + 8);
    }

    // "NEW / 新发现" badge (top-left)
    this.newBadgeTxt = this.scene.add.text(CX + 22, CY + 24, '★ 新发现', {
      fontSize: '13px', color: '#ffe080', fontStyle: 'bold',
      stroke: '#402008', strokeThickness: 2,
    });

    // Big icon
    this.iconTxt = this.scene.add.text(CX + 90, CY + CH / 2 + 10, '', {
      fontSize: '92px',
    }).setOrigin(0.5);

    // Name
    this.nameTxt = this.scene.add.text(CX + 170, CY + 74, '', {
      fontSize: '26px', color: '#f0e0c0', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    });

    // Golden divider under name
    const div = this.scene.add.graphics();
    div.lineStyle(1, 0xd8b060, 0.55).lineBetween(CX + 170, CY + 108, CX + CW - 26, CY + 108);

    // Description (word wrapped)
    this.descTxt = this.scene.add.text(CX + 170, CY + 120, '', {
      fontSize: '13px', color: '#c8b8a0',
      wordWrap: { width: CW - 190 },
      lineSpacing: 4,
    });

    // Accept hint at bottom
    this.hintTxt = this.scene.add.text(W / 2, CY + CH - 22, '[ F / 空格 / 点击 ]  拾  取', {
      fontSize: '13px', color: '#ffe080', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.container = this.scene.add.container(0, 0, [
      this.overlay, card,
      this.newBadgeTxt, this.iconTxt, this.nameTxt, div, this.descTxt,
      this.hintTxt,
    ]);
    this.container.setDepth(DEPTH).setScrollFactor(0).setVisible(false);
  }

  show(type: ItemType, onAccept: () => void) {
    this.currentType = type;
    this.onAccept    = onAccept;

    const pal = ITEM_PALETTE[type];
    this.iconTxt.setText(pal.icon);
    this.nameTxt.setText(pal.name);
    this.descTxt.setText(pal.desc);

    this.container.setVisible(true);
    this.overlay.setInteractive({ useHandCursor: true });

    // Subtle scale-in animation
    this.container.setScale(0.92).setAlpha(0);
    this.scene.tweens.add({
      targets: this.container, scale: 1, alpha: 1, duration: 220, ease: 'Back.Out',
    });

    // Pulse the hint text so player notices it
    this.hintTxt.setAlpha(0.6);
    this.scene.tweens.add({
      targets: this.hintTxt, alpha: 1, duration: 700, yoyo: true, repeat: -1,
    });
  }

  isOpen(): boolean { return this.container.visible; }

  accept() {
    if (!this.container.visible) return;
    const cb = this.onAccept;
    // Signal to the scene that a dismiss just happened — used to swallow the
    // dismissing click/keypress from propagating into the next panel
    if (this.onBeforeDismiss) this.onBeforeDismiss();
    // Disable input on the overlay BEFORE hiding so no stale clicks are swallowed
    this.overlay.disableInteractive();
    this.container.setVisible(false);
    this.scene.tweens.killTweensOf(this.hintTxt);
    this.scene.tweens.killTweensOf(this.container);
    this.currentType = null;
    this.onAccept    = null;
    // Delay the callback so the same click/keypress that dismissed this card
    // doesn't immediately propagate into the cargo panel and auto-place the item
    if (cb) this.scene.time.delayedCall(80, cb);
  }
}
