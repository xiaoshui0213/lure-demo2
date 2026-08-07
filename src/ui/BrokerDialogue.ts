import Phaser from 'phaser';
import { GameState } from '../GameState';
import { W, H } from '../constants';
import {
  DailyMission, ActiveMission, FACTION_META, canTurnIn,
  dailyNpcIntro, dailyNpcActive, dailyNpcDone, deadlineText,
} from '../missions';

const DEPTH = 32;

export type BrokerMode = 'offer' | 'turnin' | 'remind' | 'island_delivery';

export class BrokerDialogue {
  private container!:  Phaser.GameObjects.Container;
  private dimOverlay!: Phaser.GameObjects.Rectangle;
  private portraitGfx!: Phaser.GameObjects.Graphics;
  private nameTxt!:    Phaser.GameObjects.Text;
  private bodyTxt!:    Phaser.GameObjects.Text;
  private highlightTxt!: Phaser.GameObjects.Text;
  private actionTxt!:  Phaser.GameObjects.Text;
  private _open  = false;
  private mode: BrokerMode = 'offer';

  constructor(
    private scene: Phaser.Scene,
    private gs:    GameState,
    private onAccept:        () => void,
    private onClaim:         () => void,
    private notify:          (msg: string, col: string) => void,
    private onShowMap:       () => void = () => {},
    private onIslandDeliver: () => void = () => {},
  ) {
    this.build();
  }

  private build() {
    this.dimOverlay = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x020408, 0.72)
      .setDepth(DEPTH).setScrollFactor(0);

    this.portraitGfx = this.scene.add.graphics().setDepth(DEPTH + 1).setScrollFactor(0);

    // Dialogue panel (bottom, DREDGE-style) — 160px tall for comfortable text room
    const PANEL_H = 160;
    const panelGfx = this.scene.add.graphics().setDepth(DEPTH + 1).setScrollFactor(0);
    panelGfx.fillStyle(0x0a1018, 0.96);
    panelGfx.fillRect(0, H - PANEL_H, W, PANEL_H);
    panelGfx.lineStyle(1, 0x304050, 0.6);
    panelGfx.lineBetween(0, H - PANEL_H, W, H - PANEL_H);

    this.nameTxt = this.scene.add.text(W / 2, H - PANEL_H + 14, '', {
      fontSize: '13px', color: '#c0d0e0', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setDepth(DEPTH + 2).setScrollFactor(0).setOrigin(0.5);

    // Body text: 2 lines max, ~28px each with spacing
    this.bodyTxt = this.scene.add.text(48, H - PANEL_H + 34, '', {
      fontSize: '13px', color: '#d0dce8', wordWrap: { width: W - 100 }, lineSpacing: 5,
    }).setDepth(DEPTH + 2).setScrollFactor(0);

    // Highlight / mission summary line
    this.highlightTxt = this.scene.add.text(48, H - 62, '', {
      fontSize: '12px', color: '#60d0c0', fontStyle: 'bold', wordWrap: { width: W - 100 },
    }).setDepth(DEPTH + 2).setScrollFactor(0);

    this.actionTxt = this.scene.add.text(W / 2, H - 22, '', {
      fontSize: '11px', color: '#708090',
    }).setDepth(DEPTH + 2).setScrollFactor(0).setOrigin(0.5);

    this.container = this.scene.add.container(0, 0, [
      this.dimOverlay, panelGfx, this.portraitGfx,
      this.nameTxt, this.bodyTxt, this.highlightTxt, this.actionTxt,
    ]);
    this.container.setDepth(DEPTH).setScrollFactor(0).setVisible(false);
  }

  isOpen() { return this._open; }

  open(mode: BrokerMode) {
    this.mode  = mode;
    this._open = true;
    this.container.setVisible(true);
    this.drawPortrait();
    this.refresh();
  }

  close() {
    this._open = false;
    this.container.setVisible(false);
    this.portraitGfx.clear();
  }

  handleKey(key: string) {
    if (!this._open) return;
    if (key === 'ESC' || key === 'E') { this.close(); return; }
    if (key === 'ONE') this.doPrimary();
  }

  private doPrimary() {
    const s = this.gs;
    if (this.mode === 'offer') {
      if (s.missionDoneToday || s.activeMission) {
        this.notify('今日委托接不了', '#8090a8');
        return;
      }
      this.onAccept();
      this.close();
      if (s.activeMission?.faction === 'hoarder') this.onShowMap();
      return;
    }
    if (this.mode === 'turnin') {
      const m = s.activeMission;
      if (!m || !canTurnIn(m, t => s.cargoCount(t))) {
        this.notify('还差一点儿', '#e09040');
        return;
      }
      const reward = m.reward;
      this.onClaim();
      this.notify(`✓ 委托完成！+${reward} 金`, '#f0d060');
      this.close();
      return;
    }
    if (this.mode === 'island_delivery') {
      this.onIslandDeliver();
      this.close();
    }
  }

  openIslandDelivery() {
    this.mode  = 'island_delivery';
    this._open = true;
    this.container.setVisible(true);
    this.drawPortrait();
    this.refresh();
  }

  private refresh() {
    const s = this.gs;
    const offer  = s.dailyMission;
    const active = s.activeMission;

    if (this.mode === 'island_delivery' && active) {
      this.nameTxt.setText(active.deliveryName ?? '交货点');
      this.bodyTxt.setText('货到了。让我数数……行，数目对上了。这是你的钱，辛苦了。');
      this.highlightTxt.setText(`运费 ${active.reward} 金  ·  浮木商会`);
      this.actionTxt.setText('[ 1 ]  收下    ·    [ E ]  等一下');
      return;
    }

    if (this.mode === 'turnin' && active) {
      const meta = FACTION_META[active.faction];
      const dl = deadlineText(active, s.dayIndex);
      this.nameTxt.setText('码头委托人');
      this.bodyTxt.setText(dailyNpcActive(active));
      this.highlightTxt.setText(`报酬 ${active.reward} 金  ·  ${meta.name}委托  ·  ${dl}`);
      this.actionTxt.setText('[ 1 ]  领取报酬    ·    [ E ]  稍后再说');
      return;
    }

    if (this.mode === 'remind' && active) {
      const dl = deadlineText(active, s.dayIndex);
      this.nameTxt.setText('码头委托人');
      this.bodyTxt.setText(dailyNpcActive(active));
      this.highlightTxt.setText(`${active.objective}  ·  ${dl}`);
      this.actionTxt.setText('[ E ]  知道了');
      return;
    }

    // offer
    this.nameTxt.setText('码头委托人');
    this.bodyTxt.setText(this.offerBody(offer));
    this.highlightTxt.setText(this.offerHighlight(offer));
    this.actionTxt.setText('[ 1 ]  接下这单    ·    [ E ]  先不出海');
  }

  private offerBody(m: DailyMission): string {
    return dailyNpcIntro(m);
  }

  private offerHighlight(m: DailyMission): string {
    const daysLeft = m.deadline - this.gs.dayIndex + 1;
    const dl = `限 ${daysLeft} 天`;
    switch (m.faction) {
      case 'hoarder':
        return `▸ ${m.objective}  ·  报酬 ${m.reward} 金  ·  ${dl}`;
      case 'souls':
        return `▸ ${m.objective}  ·  赏金 ${m.reward} 金  ·  ${dl}`;
      case 'merchant':
        return `▸ ${m.objective}  ·  运费 ${m.reward} 金  ·  ${dl}`;
    }
  }

  /** Portrait — dockworker (offer/turnin/remind) or island merchant (island_delivery) */
  private drawPortrait() {
    if (this.mode === 'island_delivery') {
      this.drawMerchantPortrait();
    } else {
      this.drawDockworkerPortrait();
    }
  }

  /** Dock-worker bust: beanie, overalls, cigarette */
  private drawDockworkerPortrait() {
    const g = this.portraitGfx;
    g.clear();
    const cx = W / 2, cy = H / 2 - 40;

    g.fillStyle(0x2a3848, 0.95).fillRoundedRect(cx - 72, cy + 20, 144, 90, 8);
    g.fillStyle(0x3a4858).fillRect(cx - 50, cy + 20, 100, 70);
    g.lineStyle(3, 0x506070);
    g.lineBetween(cx - 30, cy + 20, cx - 30, cy + 75);
    g.lineBetween(cx + 30, cy + 20, cx + 30, cy + 75);
    g.fillStyle(0xc89878).fillRect(cx - 14, cy + 8, 28, 18);
    g.fillStyle(0xd8a888).fillCircle(cx, cy - 10, 38);
    g.lineStyle(2, 0x000000, 0.15).strokeCircle(cx, cy - 10, 38);
    g.fillStyle(0x8a4030).fillEllipse(cx, cy - 38, 44, 22);
    g.fillStyle(0xa05040).fillRect(cx - 44, cy - 32, 88, 12);
    g.fillStyle(0x1a1018);
    g.fillCircle(cx - 12, cy - 12, 4);
    g.fillCircle(cx + 12, cy - 12, 4);
    g.lineStyle(2, 0x606060);
    g.lineBetween(cx + 18, cy - 2, cx + 34, cy + 2);
    g.fillStyle(0xff8040, 0.8).fillCircle(cx + 35, cy + 2, 2);
  }

  /** Island merchant bust: wide-brimmed hat, waistcoat, ledger under arm */
  private drawMerchantPortrait() {
    const g = this.portraitGfx;
    g.clear();
    const cx = W / 2, cy = H / 2 - 40;

    // Waistcoat / jacket
    g.fillStyle(0x3a2810, 0.95).fillRoundedRect(cx - 70, cy + 20, 140, 90, 8);
    g.fillStyle(0x5a3c1a).fillRect(cx - 48, cy + 20, 96, 70);
    // Lapels
    g.fillStyle(0x4a3010);
    g.fillTriangle(cx - 16, cy + 20, cx, cy + 44, cx - 36, cy + 20);
    g.fillTriangle(cx + 16, cy + 20, cx, cy + 44, cx + 36, cy + 20);
    // Shirt / cravat
    g.fillStyle(0xd8cca8).fillRect(cx - 8, cy + 20, 16, 22);

    // Neck
    g.fillStyle(0xc89870).fillRect(cx - 12, cy + 10, 24, 16);

    // Face — slightly weathered
    g.fillStyle(0xd0a070).fillCircle(cx, cy - 10, 36);
    g.lineStyle(1, 0x000000, 0.12).strokeCircle(cx, cy - 10, 36);

    // Wide-brimmed hat
    g.fillStyle(0x2a1a08).fillEllipse(cx, cy - 40, 90, 18);      // brim
    g.fillStyle(0x3a2410).fillRect(cx - 22, cy - 60, 44, 24);    // crown
    g.fillStyle(0x6a4820).fillRect(cx - 22, cy - 40, 44, 6);     // band

    // Eyes
    g.fillStyle(0x2a1810);
    g.fillCircle(cx - 11, cy - 12, 3.5);
    g.fillCircle(cx + 11, cy - 12, 3.5);
    // Slight smile wrinkles
    g.lineStyle(1, 0xa07048, 0.45);
    g.lineBetween(cx - 20, cy - 4, cx - 14, cy + 2);
    g.lineBetween(cx + 14, cy + 2, cx + 20, cy - 4);

    // Ledger / clipboard under left arm
    g.fillStyle(0x7a5030, 0.85).fillRect(cx - 60, cy + 40, 18, 26);
    g.fillStyle(0xd8c8a0, 0.70).fillRect(cx - 58, cy + 43, 14, 20);
    g.lineStyle(1, 0x503010, 0.50);
    g.lineBetween(cx - 56, cy + 47, cx - 46, cy + 47);
    g.lineBetween(cx - 56, cy + 51, cx - 46, cy + 51);
    g.lineBetween(cx - 56, cy + 55, cx - 50, cy + 55);
  }
}
