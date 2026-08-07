/**
 * 背包数据层 —— Dredge 风的不规则网格 + Tetris 物品。
 *
 * 网格坐标：(col, row)，左上角 = (0, 0)，右向 = +col，下向 = +row。
 * 每个格子状态：
 *   - 'empty' : 空
 *   - 'blocked': 破损/不可用（造型格，玩家没法放）
 *   - itemId  : 占用（值是物品的实例 id）
 *
 * 物品实例：Item —— 有一份对形状 rot0 的引用 + 当前旋转 + 左上锚点 (col, row)。
 *
 * 与 UI 的分工：本类只管数据（放/取/校验/旋转），UI 层负责渲染 + 拖放事件。
 */

import { FISH_LIBRARY, rotateN, shapeCells, type FishDef, type ShapeMatrix } from './fishShapes';

export type CellState = 'empty' | 'blocked' | string;   // 非上述值 = itemId

export interface InventoryItem {
  id: string;         // 实例 id（不同实例的同种鱼各有独立 id）
  fishId: string;     // 对应 FISH_LIBRARY 中的 key
  rot: number;        // 0 / 1 / 2 / 3
  col: number;        // 左上锚点
  row: number;
}

export interface InventoryConfig {
  cols: number;
  rows: number;
  /** 起始时不可用的格子（挖洞用） */
  blocked?: Array<[number, number]>;
}

let _itemIdCounter = 0;
function nextItemId(): string {
  _itemIdCounter += 1;
  return `it_${_itemIdCounter}`;
}

export class Inventory {
  readonly cols: number;
  readonly rows: number;
  /** cells[row][col] = 'empty' | 'blocked' | itemId */
  private cells: CellState[][];
  private items: Map<string, InventoryItem> = new Map();

  constructor(config: InventoryConfig) {
    this.cols = config.cols;
    this.rows = config.rows;
    this.cells = Array.from({ length: this.rows }, () =>
      Array<CellState>(this.cols).fill('empty'),
    );
    if (config.blocked) {
      for (const [c, r] of config.blocked) {
        if (this.inBounds(c, r)) this.cells[r][c] = 'blocked';
      }
    }
  }

  /* ─── 只读查询 ─── */

  getCell(col: number, row: number): CellState {
    if (!this.inBounds(col, row)) return 'blocked';
    return this.cells[row][col];
  }

  getItem(id: string): InventoryItem | undefined {
    return this.items.get(id);
  }

  listItems(): InventoryItem[] {
    return Array.from(this.items.values());
  }

  isFull(): boolean {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c] === 'empty') return false;
    return true;
  }

  countOccupied(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (typeof this.cells[r][c] === 'string' && this.cells[r][c] !== 'empty' && this.cells[r][c] !== 'blocked')
          n++;
    return n;
  }

  /* ─── 形状与位置查询 ─── */

  /** 拿到某物品当前旋转下的形状矩阵 */
  itemShape(item: InventoryItem): ShapeMatrix {
    const def = this.fishDef(item.fishId);
    return rotateN(def.shape, item.rot);
  }

  fishDef(fishId: string): FishDef {
    const def = FISH_LIBRARY[fishId];
    if (!def) throw new Error(`未知鱼类: ${fishId}`);
    return def;
  }

  /** 拿到某物品占据的所有格子（世界坐标） */
  itemCells(item: InventoryItem): Array<[number, number]> {
    const shape = this.itemShape(item);
    return shapeCells(shape).map(([dc, dr]) => [item.col + dc, item.row + dr] as [number, number]);
  }

  /**
   * 检查在指定位置 + 旋转下能否放下一个鱼形状（忽略指定 itemId 的自身占格，
   * 用于拖动已有物品时的合法性判定）。
   */
  canPlace(fishId: string, col: number, row: number, rot: number, ignoreItemId?: string): boolean {
    const def = this.fishDef(fishId);
    const shape = rotateN(def.shape, rot);
    for (const [dc, dr] of shapeCells(shape)) {
      const c = col + dc;
      const r = row + dr;
      if (!this.inBounds(c, r)) return false;
      const s = this.cells[r][c];
      if (s === 'blocked') return false;
      if (s === 'empty') continue;
      if (ignoreItemId && s === ignoreItemId) continue;
      return false;   // 被别人占了
    }
    return true;
  }

  /** 在网格里找一个能放下这个形状的位置；找不到返回 null（用于"钓上后自动放"） */
  findFirstFit(fishId: string): { col: number; row: number; rot: number } | null {
    for (let rot = 0; rot < 4; rot++) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.canPlace(fishId, c, r, rot)) return { col: c, row: r, rot };
        }
      }
    }
    return null;
  }

  /* ─── 写操作 ─── */

  /**
   * 直接放置（假定已经过 canPlace 校验）。返回新物品实例。
   * 如果参数不合法会抛异常。
   */
  place(fishId: string, col: number, row: number, rot: number): InventoryItem {
    if (!this.canPlace(fishId, col, row, rot)) {
      throw new Error(`不能放置 ${fishId} @ (${col},${row}) rot=${rot}`);
    }
    const item: InventoryItem = {
      id: nextItemId(),
      fishId,
      rot,
      col,
      row,
    };
    this.writeItemCells(item, item.id);
    this.items.set(item.id, item);
    return item;
  }

  /** 移动/旋转一个已存在的物品到新位置（会先清掉原格）。失败返回 false 且状态不变。 */
  moveItem(id: string, newCol: number, newRow: number, newRot: number): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    if (!this.canPlace(item.fishId, newCol, newRow, newRot, id)) return false;
    // 先清掉旧格，再写新格
    this.writeItemCells(item, 'empty');
    item.col = newCol;
    item.row = newRow;
    item.rot = newRot;
    this.writeItemCells(item, item.id);
    return true;
  }

  /** 移除物品（返回被移除的实例） */
  remove(id: string): InventoryItem | null {
    const item = this.items.get(id);
    if (!item) return null;
    this.writeItemCells(item, 'empty');
    this.items.delete(id);
    return item;
  }

  clear() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c] !== 'blocked') this.cells[r][c] = 'empty';
      }
    }
    this.items.clear();
  }

  /** 拿到当前所有格子的完整快照（只读） */
  snapshot(): CellState[][] {
    return this.cells.map(row => row.slice());
  }

  /* ─── 内部 ─── */

  private inBounds(c: number, r: number): boolean {
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows;
  }

  private writeItemCells(item: InventoryItem, value: CellState) {
    for (const [c, r] of this.itemCells(item)) {
      if (this.inBounds(c, r)) this.cells[r][c] = value;
    }
  }
}
