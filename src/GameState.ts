import { MAX_HP, MAX_SAN, INIT_GOLD, INIT_SUPPLY, DAY_MS } from './constants';
import { ActiveMission, DailyMission, generateDailyMission } from './missions';

export type ItemType = 'fish' | 'deep_fish' | 'glow_fish' | 'loot' | 'armor' | 'hook' | 'supply' | 'treasure' | 'relic' | 'cargo_crate';
export type Zone     = 'port' | 'shallow' | 'deep';

// ─── Player role ──────────────────────────────────────────────
export type RoleType = 'helmsman' | 'angler' | 'engineer' | 'gunner';

export interface RoleDef {
  key:    RoleType;
  name:   string;
  icon:   string;
  desc:   string;
  color:  number;
  bonus:  string;
}

export const ROLES: RoleDef[] = [
  {
    key: 'helmsman', name: '舵手', icon: '⚓', color: 0x60a0f0,
    desc: '熟悉洋流，机动能力出众',
    bonus: '船速 +30%，礁石撞击伤害减半',
  },
  {
    key: 'angler', name: '钓手', icon: '🎣', color: 0x60e0a0,
    desc: '钓术精湛，渔获丰盛',
    bonus: '钓鱼绿区 +30%，每日钓点额外 +1',
  },
  {
    key: 'engineer', name: '工程师', icon: '🔧', color: 0xe0c060,
    desc: '精通船体结构，抗损能力强',
    bonus: '初始最大 HP +1，修船费用 -50%',
  },
  {
    key: 'gunner', name: '炮手', icon: '💣', color: 0xe07060,
    desc: '炮击精准，攻击节奏快',
    bonus: '炮弹冷却 -40%，命中爆炸范围 +50%',
  },
];

// ─── Grid dimensions ──────────────────────────────────────────
export const GRID_COLS = 6;
export const GRID_ROWS = 6;

// Irregular DREDGE-style ship-hull cargo hold. true = valid cell.
// . . X X . .
// . X X X X .
// X X X X X X
// X X X X X X
// . X X X X .
// . . X X . .
export const HOLD_SHAPE: boolean[][] = [
  [false, false, true,  true,  false, false],
  [false, true,  true,  true,  true,  false],
  [true,  true,  true,  true,  true,  true ],
  [true,  true,  true,  true,  true,  true ],
  [false, true,  true,  true,  true,  false],
  [false, false, true,  true,  false, false],
];

export function isHoldCell(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return false;
  return HOLD_SHAPE[row][col];
}

// Item footprint in grid cells (w × h)
export const ITEM_SIZE: Record<ItemType, [number, number]> = {
  fish:      [2, 1],  // small horizontal fish
  deep_fish: [2, 2],  // chunky deep-sea fish
  glow_fish: [2, 2],  // big square glow fish
  loot:      [1, 2],  // tall narrow trinket
  armor:     [2, 2],  // bulky armor plate
  hook:      [1, 2],  // long thin fishhook
  supply:    [1, 1],  // small barrel
  treasure:    [2, 2],  // buried chest (hoarder mission item)
  relic:       [1, 2],  // monster relic (souls mission item)
  cargo_crate: [2, 2],  // salvaged ship cargo (merchant mission item)
};

export interface CargoItem {
  id:   number;
  type: ItemType;
  col:  number;
  row:  number;
  w:    number;
  h:    number;
}

export class GameState {
  // Economy
  gold = INIT_GOLD;

  // Ship — hp is stored, maxHp is derived from armor in cargo
  private _hp = MAX_HP;

  // Role bonus HP (e.g. engineer adds +1 max)
  roleBonusHp = 0;

  // Grid cargo hold
  cargoItems: CargoItem[] = [];
  private _nextId = 0;

  // SAN
  san             = MAX_SAN;
  sanHitThisNight = 0;

  // Day / Night
  isDay    = true;
  timeLeft = DAY_MS;

  // Daily sailing missions (broker NPC)
  dayIndex           = 0;
  dailyMission:      DailyMission = generateDailyMission(0);
  activeMission:     ActiveMission | null = null;
  missionDoneToday   = false;
  /** Merchant delivery: fish caught while contract is active (daytime deep sea) */
  missionFishCaught  = 0;

  // Legacy NPC quest flag (kept for save compat; superseded by broker missions)
  questGlowNeeded = 0;

  // Navigation
  currentZone: Zone = 'port';

  // Night tracking
  leftPortTonight = false;

  // Supply tracking — reset each time player returns to port
  suppliedThisVoyage = false;

  // Boss progression
  bossDefeated = false;

  // First-time reveal tracking
  discovered: Set<ItemType> = new Set(['supply']);

  // Role
  role: RoleType = 'helmsman';

  // Ship cannon module tier  0=basic  1=blast
  cannonTier: 0 | 1 = 0;

  // Whether armor has been installed at the shipyard (gives +1 maxHp when true)
  armorInstalled = false;

  // Whether the player has purchased armor from the repair shop but not yet installed it.
  // Armor plate does NOT take up cargo space — it's a "reservation" for the shipyard.
  armorPurchased = false;

  constructor() {
    // Initial supplies pre-placed in the top of the hold
    // Row 0 valid cells: (2,0), (3,0). Row 1 valid: (1,1)..(4,1)
    for (let i = 0; i < INIT_SUPPLY; i++) {
      const positions: [number, number][] = [[2, 0], [3, 0], [1, 1]];
      const [c, r] = positions[i];
      this.placeAt('supply', c, r, 1, 1);
    }
  }

  // ─── Derived state ────────────────────────────────────────

  /** True when armor plate is in cargo grid (legacy path) */
  get hasArmorInCargo(): boolean { return this.cargoCount('armor') > 0; }
  /** True when armor is available to install — either purchased (reservation) or in cargo */
  get hasArmorAvailable(): boolean { return this.armorPurchased || this.hasArmorInCargo; }
  /** Kept for compatibility — true if armor is available OR already installed */
  get hasArmor():  boolean { return this.hasArmorAvailable || this.armorInstalled; }
  get hasHook():   boolean { return this.cargoCount('hook')  > 0; }
  get supply():    number  { return this.cargoCount('supply'); }
  /** maxHp reflects installed armor */
  get maxHp():     number  { return MAX_HP + (this.armorInstalled ? 1 : 0) + this.roleBonusHp; }

  /** Install armor at the shipyard. Consumes purchase reservation or cargo item. */
  installArmor(): boolean {
    if (!this.hasArmorAvailable) return false;
    if (this.armorPurchased) this.armorPurchased = false;
    if (this.hasArmorInCargo) this.consumeOne('armor'); // also consume if in grid
    this.armorInstalled = true;
    return true;
  }

  get hp():       number  { return Math.min(this._hp, this.maxHp); }
  set hp(v: number)       { this._hp = Math.max(0, Math.min(v, this.maxHp)); }

  // ─── Grid helpers ─────────────────────────────────────────

  private buildOccupied(excludeId?: number): boolean[][] {
    const g: boolean[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(false));
    for (const item of this.cargoItems) {
      if (excludeId !== undefined && item.id === excludeId) continue;
      for (let r = item.row; r < item.row + item.h; r++)
        for (let c = item.col; c < item.col + item.w; c++)
          if (r < GRID_ROWS && c < GRID_COLS) g[r][c] = true;
    }
    return g;
  }

  canPlaceAt(col: number, row: number, w: number, h: number, excludeId?: number): boolean {
    if (col < 0 || row < 0 || col + w > GRID_COLS || row + h > GRID_ROWS) return false;
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++)
        if (!HOLD_SHAPE[r][c]) return false;
    const occ = this.buildOccupied(excludeId);
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++)
        if (occ[r][c]) return false;
    return true;
  }

  canFitAnywhere(w: number, h: number): boolean {
    for (let row = 0; row <= GRID_ROWS - h; row++)
      for (let col = 0; col <= GRID_COLS - w; col++)
        if (this.canPlaceAt(col, row, w, h)) return true;
    return false;
  }

  canFitItem(type: ItemType): boolean {
    const [w, h] = ITEM_SIZE[type];
    return this.canFitAnywhere(w, h) || (w !== h && this.canFitAnywhere(h, w));
  }

  itemAt(col: number, row: number): CargoItem | null {
    for (const it of this.cargoItems) {
      if (col >= it.col && col < it.col + it.w &&
          row >= it.row && row < it.row + it.h) return it;
    }
    return null;
  }

  placeAt(type: ItemType, col: number, row: number, w: number, h: number): CargoItem | null {
    if (!this.canPlaceAt(col, row, w, h)) return null;
    const item: CargoItem = { id: this._nextId++, type, col, row, w, h };
    this.cargoItems.push(item);
    return item;
  }

  movePlaced(id: number, col: number, row: number, w: number, h: number): boolean {
    const it = this.cargoItems.find(x => x.id === id);
    if (!it) return false;
    if (!this.canPlaceAt(col, row, w, h, id)) return false;
    it.col = col; it.row = row; it.w = w; it.h = h;
    return true;
  }

  removeItem(id: number): CargoItem | null {
    const idx = this.cargoItems.findIndex(x => x.id === id);
    if (idx < 0) return null;
    const [removed] = this.cargoItems.splice(idx, 1);
    return removed;
  }

  removeAllOf(type: ItemType): number {
    const removed = this.cargoItems.filter(i => i.type === type).length;
    this.cargoItems = this.cargoItems.filter(i => i.type !== type);
    return removed;
  }

  // Remove one item of the given type (used e.g. to consume a supply on trip out)
  consumeOne(type: ItemType): boolean {
    const idx = this.cargoItems.findIndex(i => i.type === type);
    if (idx < 0) return false;
    this.cargoItems.splice(idx, 1);
    return true;
  }

  clearCargo() { this.cargoItems = []; this._nextId = 0; }

  /**
   * Use one supply barrel from cargo to restore SAN.
   * Conditions: supply exists in cargo AND san <= 1 (at most 1 bar left).
   * Returns true if successful.
   */
  useSupply(): boolean {
    if (this.cargoCount('supply') <= 0) return false;
    if (this.san > 1) return false;
    this.consumeOne('supply');
    this.san = Math.min(MAX_SAN, this.san + 2);
    return true;
  }

  cargoCount(type?: ItemType): number {
    if (!type) return this.cargoItems.length;
    return this.cargoItems.filter(i => i.type === type).length;
  }

  isCargoFull(): boolean {
    return !this.canFitItem('fish');
  }

  /** Called at dawn — refresh daily mission board. Returns true if active mission expired. */
  startNewDay(): boolean {
    this.dayIndex++;
    let expired = false;
    if (this.activeMission && this.activeMission.deadline < this.dayIndex) {
      this.activeMission   = null;
      this.missionDoneToday = false;
      expired = true;
    }
    // Only reset the daily offer; keep active mission if still within deadline
    this.dailyMission     = generateDailyMission(this.dayIndex);
    if (!this.activeMission) {
      this.missionDoneToday  = false;
      this.missionFishCaught = 0;
    }
    return expired;
  }

  acceptMission(): boolean {
    if (this.missionDoneToday || this.activeMission) return false;
    this.activeMission = { ...this.dailyMission, progress: 0 };
    this.missionFishCaught = 0;
    return true;
  }

  claimMission(): number {
    const m = this.activeMission;
    if (!m || m.progress < m.target) return 0;

    // Consume the physical cargo items that prove mission completion
    if (m.faction === 'merchant') {
      let left = m.target;
      for (let i = this.cargoItems.length - 1; i >= 0 && left > 0; i--) {
        if (this.cargoItems[i].type === 'deep_fish') { this.cargoItems.splice(i, 1); left--; }
      }
      if (left > 0) return 0;
    } else if (m.faction === 'hoarder') {
      if (!this.consumeOne('treasure')) return 0;
    } else if (m.faction === 'souls') {
      let left = m.target;
      for (let i = this.cargoItems.length - 1; i >= 0 && left > 0; i--) {
        if (this.cargoItems[i].type === 'glow_fish') { this.cargoItems.splice(i, 1); left--; }
      }
      if (left > 0) return 0;
    } else if (m.faction === 'merchant') {
      // Merchant missions are completed at the delivery island, not the port broker
      return 0;
    }

    const reward = m.reward;
    this.gold += reward;
    this.activeMission = null;
    this.missionDoneToday = true;
    return reward;
  }

  /** Called when player delivers cargo_crate to the merchant island NPC. */
  deliverCargo(): number {
    const m = this.activeMission;
    if (!m || m.faction !== 'merchant' || m.progress < m.target) return 0;
    if (!this.consumeOne('cargo_crate')) return 0;
    const reward = m.reward;
    this.gold += reward;
    this.activeMission = null;
    this.missionDoneToday = true;
    return reward;
  }
}
