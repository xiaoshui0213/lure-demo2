import Phaser from 'phaser';
import { GameState, ItemType } from '../GameState';
import {
  W, H,
  FISH_SELL, DEEP_FISH_SELL, GLOW_SELL, LOOT_SELL,
  SUPPLY_PRICE, REPAIR_PRICE, ARMOR_PRICE, HOOK_PRICE,
} from '../constants';

export type PortStationKind = 'merchant' | 'repair' | 'tackle' | 'shipyard';

const PW = 500;
const PH = 360;
const PX = (W - PW) / 2;
const PY = (H - PH) / 2 + 8;
const MAX_ITEMS = 4;
const BTN_H     = 42;
const BTN_GAP   = 6;

interface MenuItem {
  label:   () => string;
  color:   () => string;
  enabled: () => boolean;
  action:  () => string; // returns notification text
}

interface StationDef {
  title:      string;
  titleColor: string;
  npcLine:    () => string;
  items:      MenuItem[];
}

export class PortPanel {
  private container!:  Phaser.GameObjects.Container;
  private titleTxt!:   Phaser.GameObjects.Text;
  private npcTxt!:     Phaser.GameObjects.Text;
  private btnBgs:      Phaser.GameObjects.Rectangle[] = [];
  private btnLabels:   Phaser.GameObjects.Text[]      = [];
  private stations!:   Record<PortStationKind, StationDef>;
  private currentKind: PortStationKind | null = null;

  constructor(
    private scene:   Phaser.Scene,
    private gs:      GameState,
    private notify:  (msg: string, col: string) => void,
    private acquire: (type: ItemType) => void, // called after a successful port purchase
  ) {
    this.buildStations();
    this.build();
  }

  // ─── Station definitions ───────────────────────────────────

  private buildStations() {
    const s = this.gs;

    const sellFish: MenuItem = {
      label:   () => `[1]  出售普通鱼  ×${s.cargoCount('fish')}    → +${s.cargoCount('fish') * FISH_SELL} 金`,
      color:   () => s.cargoCount('fish') > 0 ? '#f0e060' : '#504030',
      enabled: () => s.cargoCount('fish') > 0,
      action:  () => {
        const n = s.removeAllOf('fish');
        s.gold += n * FISH_SELL;
        return n > 0 ? `出售 ${n} 条普通鱼  +${n * FISH_SELL} 金` : '没有普通鱼';
      },
    };

    const sellDeep: MenuItem = {
      label:   () => `[2]  出售深海鱼  ×${s.cargoCount('deep_fish')}    → +${s.cargoCount('deep_fish') * DEEP_FISH_SELL} 金`,
      color:   () => s.cargoCount('deep_fish') > 0 ? '#80c8f0' : '#284050',
      enabled: () => s.cargoCount('deep_fish') > 0,
      action:  () => {
        const n = s.removeAllOf('deep_fish');
        s.gold += n * DEEP_FISH_SELL;
        return n > 0 ? `出售 ${n} 条深海鱼  +${n * DEEP_FISH_SELL} 金` : '没有深海鱼';
      },
    };

    const sellGlow: MenuItem = {
      label:   () => `[3]  出售幽光鱼  ×${s.cargoCount('glow_fish')}    → +${s.cargoCount('glow_fish') * GLOW_SELL} 金`,
      color:   () => s.cargoCount('glow_fish') > 0 ? '#70e8b0' : '#304030',
      enabled: () => s.cargoCount('glow_fish') > 0,
      action:  () => {
        const g = s.cargoCount('glow_fish');
        if (g === 0) return '没有幽光鱼';
        s.removeAllOf('glow_fish');
        s.gold += g * GLOW_SELL;
        return `出售 ${g} 条幽光鱼  +${g * GLOW_SELL} 金`;
      },
    };

    const sellLoot: MenuItem = {
      label:   () => `[4]  出售战利品  ×${s.cargoCount('loot')}    → +${s.cargoCount('loot') * LOOT_SELL} 金`,
      color:   () => s.cargoCount('loot') > 0 ? '#e0a040' : '#403020',
      enabled: () => s.cargoCount('loot') > 0,
      action:  () => {
        const n = s.removeAllOf('loot');
        s.gold += n * LOOT_SELL;
        return n > 0 ? `出售 ${n} 件战利品  +${n * LOOT_SELL} 金` : '没有战利品';
      },
    };

    const repairHp: MenuItem = {
      label: () => {
        const miss = s.maxHp - s.hp;
        return `[1]  修理船体   ${REPAIR_PRICE} 金/格    损坏 ${miss} 格，需 ${miss * REPAIR_PRICE} 金`;
      },
      color:   () => s.hp < s.maxHp && s.gold >= REPAIR_PRICE ? '#e07070' : '#402020',
      enabled: () => s.hp < s.maxHp && s.gold >= REPAIR_PRICE,
      action:  () => {
        if (s.hp >= s.maxHp) return '船体完好无损';
        const canFix = Math.min(s.maxHp - s.hp, Math.floor(s.gold / REPAIR_PRICE));
        if (canFix === 0) return '金币不足，无法修理';
        s.gold -= canFix * REPAIR_PRICE;
        s.hp   += canFix;
        return `修理了 ${canFix} 格  −${canFix * REPAIR_PRICE} 金`;
      },
    };

    const buyArmor: MenuItem = {
      label:   () => s.armorInstalled
        ? '[2]  装甲板          ✓ 已在船坞装配'
        : s.hasArmorAvailable
          ? '[2]  装甲板          已预订 — 前往船坞安装'
          : `[2]  购买装甲板   ${ARMOR_PRICE} 金    (前往船坞安装，不占货舱)`,
      color:   () => (s.armorInstalled || s.hasArmorAvailable) ? '#405040'
                   : (s.gold >= ARMOR_PRICE ? '#80c0e0' : '#203040'),
      enabled: () => !s.armorInstalled && !s.hasArmorAvailable && s.gold >= ARMOR_PRICE,
      action:  () => {
        if (s.armorInstalled)    return '装甲板已在船坞装配完毕';
        if (s.hasArmorAvailable) return '装甲板已预订，请前往船坞安装';
        if (s.gold < ARMOR_PRICE) return '金币不足';
        s.gold -= ARMOR_PRICE;
        s.armorPurchased = true;   // reservation — no cargo slot needed
        return '✓ 装甲板已预订 — 前往「船坞」安装';
      },
    };

    const buySupply: MenuItem = {
      label: () => {
        if (s.suppliedThisVoyage) return '[3]  补给  ✓ 本次出海已购买（限购1个）';
        return `[3]  购买补给   ${SUPPLY_PRICE} 金/个    当前: ${s.supply}`;
      },
      color:   () => (!s.suppliedThisVoyage && s.gold >= SUPPLY_PRICE && s.canFitItem('supply')) ? '#70e0a0' : '#304030',
      enabled: () => !s.suppliedThisVoyage && s.gold >= SUPPLY_PRICE && s.canFitItem('supply'),
      action:  () => {
        if (s.suppliedThisVoyage) return '本次出海已购买过补给（每次出海限购1个）';
        if (s.gold < SUPPLY_PRICE)   return '金币不足';
        if (!s.canFitItem('supply')) return '货舱空间不足 (需 1×1)';
        s.gold -= SUPPLY_PRICE;
        s.suppliedThisVoyage = true;
        this.acquire('supply');
        return `购买补给 −${SUPPLY_PRICE} 金，本次出海限购已用`;
      },
    };

    const buyHook: MenuItem = {
      label:   () => s.hasHook
        ? '[1]  专业鱼钩        ✓ 已装配于货舱'
        : `[1]  购买专业鱼钩  ${HOOK_PRICE} 金    (钓鱼成功区 +20%，占 1×2 格)`,
      color:   () => s.hasHook ? '#405040' : (s.gold >= HOOK_PRICE && s.canFitItem('hook') ? '#80c0e0' : '#203040'),
      enabled: () => !s.hasHook && s.gold >= HOOK_PRICE && s.canFitItem('hook'),
      action:  () => {
        if (s.hasHook)            return '专业鱼钩已在货舱';
        if (s.gold < HOOK_PRICE)  return '金币不足';
        if (!s.canFitItem('hook')) return '货舱空间不足 (需 1×2)';
        s.gold -= HOOK_PRICE;
        this.acquire('hook');
        return '✓ 专业鱼钩已交付,请拖入货舱';
      },
    };

    this.stations = {
      merchant: {
        title:      '🐟  鱼贩',
        titleColor: '#f0d060',
        npcLine:    () => '「带来啥货我都收，新鲜的更好。」',
        items: [sellFish, sellDeep, sellGlow, sellLoot],
      },
      repair: {
        title:      '🔧  修船人',
        titleColor: '#80c0e0',
        npcLine:    () => '「船坏了找我。装甲板和补给也在我这儿。」',
        items: [repairHp, buyArmor, buySupply],
      },
      tackle: {
        title:      '🎣  渔具店',
        titleColor: '#a0e080',
        npcLine:    () => '「想钓大鱼？专业钓钩,效果立竿见影。」',
        items: [buyHook],
      },
      // Shipyard is handled separately by ShipModulePanel; this entry is a no-op placeholder
      shipyard: {
        title:      '⚙  船坞',
        titleColor: '#a060c0',
        npcLine:    () => '「改装船只请前往船坞界面。」',
        items:      [],
      },
    };
  }

  // ─── Build Phaser GameObjects ──────────────────────────────

  private build() {
    const D = 30;

    const overlay = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6);

    const panelGfx = this.scene.add.graphics();
    panelGfx.fillStyle(0x060c18, 0.97);
    panelGfx.fillRoundedRect(PX, PY, PW, PH, 10);
    panelGfx.lineStyle(2, 0x2a5070, 0.9);
    panelGfx.strokeRoundedRect(PX, PY, PW, PH, 10);

    this.titleTxt = this.scene.add.text(PX + PW / 2, PY + 24, '', {
      fontSize: '20px', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.npcTxt = this.scene.add.text(PX + 22, PY + 56, '', {
      fontSize: '11px', color: '#a0c8d8',
      wordWrap: { width: PW - 44 },
    });

    const sepGfx = this.scene.add.graphics();
    sepGfx.lineStyle(1, 0x2a5070, 0.45);
    sepGfx.lineBetween(PX + 18, PY + 96, PX + PW - 18, PY + 96);

    // Pre-create MAX_ITEMS button slots; hide unused ones per station
    const startY = PY + 104;
    for (let i = 0; i < MAX_ITEMS; i++) {
      const by = startY + i * (BTN_H + BTN_GAP);
      const bBg = this.scene.add.rectangle(PX + PW / 2, by + BTN_H / 2, PW - 36, BTN_H, 0x0c1a28)
        .setInteractive({ useHandCursor: true });
      const bLbl = this.scene.add.text(PX + 28, by + BTN_H / 2, '', {
        fontSize: '12px', color: '#90a8b8',
      }).setOrigin(0, 0.5);

      const idx = i;
      bBg.on('pointerover',  () => {
        const def = this.currentDef();
        if (def && idx < def.items.length && def.items[idx].enabled()) bBg.setFillStyle(0x1a3048);
      });
      bBg.on('pointerout',  () => bBg.setFillStyle(0x0c1a28));
      bBg.on('pointerdown', () => this.doAction(idx));

      this.btnBgs.push(bBg);
      this.btnLabels.push(bLbl);
    }

    const closeHint = this.scene.add.text(PX + PW / 2, PY + PH - 18, '[ E ]  关闭', {
      fontSize: '11px', color: '#405060',
    }).setOrigin(0.5);

    this.container = this.scene.add.container(0, 0, [
      overlay, panelGfx, this.titleTxt, this.npcTxt, sepGfx,
      ...this.btnBgs, ...this.btnLabels,
      closeHint,
    ]);
    this.container.setDepth(D).setScrollFactor(0).setVisible(false);
  }

  private currentDef(): StationDef | null {
    return this.currentKind ? this.stations[this.currentKind] : null;
  }

  // ─── Public API ───────────────────────────────────────────

  open(kind: PortStationKind) {
    this.currentKind = kind;
    this.container.setVisible(true);
    this.refresh();
  }

  close() { this.container.setVisible(false); this.currentKind = null; }

  isOpen() { return this.container.visible; }

  doAction(index: number) {
    const def = this.currentDef();
    if (!def) return;
    if (index < 0 || index >= def.items.length) return;
    if (!def.items[index].enabled()) {
      this.notify('该选项当前不可用', '#a05050');
      return;
    }
    const msg = def.items[index].action();
    this.refresh();
    this.notify(msg, '#b0e8a0');
  }

  private refresh() {
    const def = this.currentDef();
    if (!def) return;

    this.titleTxt.setText(def.title).setColor(def.titleColor);
    this.npcTxt.setText(def.npcLine());

    for (let i = 0; i < MAX_ITEMS; i++) {
      if (i < def.items.length) {
        const item = def.items[i];
        this.btnLabels[i].setText(item.label()).setColor(item.color()).setVisible(true);
        this.btnBgs[i].setFillStyle(item.enabled() ? 0x0c1a28 : 0x08111e).setVisible(true);
      } else {
        this.btnLabels[i].setVisible(false);
        this.btnBgs[i].setVisible(false);
      }
    }
  }
}
