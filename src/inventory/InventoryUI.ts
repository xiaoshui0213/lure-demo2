/**
 * 背包 UI —— 纯 DOM 实现的 Dredge 风网格 + 拖放交互。
 *
 * 布局：
 *   .inv-panel        —— 顶层面板（fixed 定居中央），含标题 + 网格 + 侧边"待放入"槽 + 关闭键
 *     .inv-grid       —— 由 cols × rows 个 .inv-cell 组成的绝对定位网格
 *     .inv-items      —— 覆盖在网格上的物品层（每个 .inv-item 也是绝对定位）
 *     .inv-tray       —— 右侧待放入槽：钓上还没放好的鱼在这里"等着被拖入网格"
 *
 * 交互：
 *   - 从网格拖 / 从 tray 拖：mousedown 抬起，mousemove 跟随，mouseup 放置或返回
 *   - R 键：旋转当前正在拖的物品
 *   - 悬停：显示绿色可放 / 红色不可放的占格预览
 */

import { Inventory, type InventoryItem } from './Inventory';
import { FISH_LIBRARY, rotateN, shapeCells, shadeHex, type FishDef, type ShapeMatrix } from './fishShapes';

/* ────────────────────────────────────────────────────────────
   鱼绘制 —— 用 SVG 在鱼形轮廓上叠加身体渐变 / 眼睛 / 尾鳍 / 背鳍 / 斑纹。
   参考渔帆暗涌：格子只是"落点占位"，视觉主体是鱼本身。
   ──────────────────────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

interface CellInfo {
  r: number;
  c: number;
  up: boolean;    // 是否有同鱼相邻的上邻居
  down: boolean;
  left: boolean;
  right: boolean;
}

/** 提取形状每个占格的邻居信息（用于圆角、外圈方向、鳍位判定） */
function analyzeCells(shape: ShapeMatrix): CellInfo[] {
  const rows = shape.length, cols = shape[0].length;
  const cells: CellInfo[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!shape[r][c]) continue;
      cells.push({
        r, c,
        up:    !!(r > 0        && shape[r - 1]?.[c]),
        down:  !!(r < rows - 1 && shape[r + 1]?.[c]),
        left:  !!(c > 0        && shape[r]?.[c - 1]),
        right: !!(c < cols - 1 && shape[r]?.[c + 1]),
      });
    }
  }
  return cells;
}

/**
 * 挑一个鱼头/鱼尾的"外向朝向"：优先朝没邻居的方向。
 * 顺序：横向（左/右）比纵向（上/下）更"鱼样"，因此优先。
 */
function pickOutwardDir(cell: CellInfo, prefer: 'head' | 'tail'): 'up' | 'down' | 'left' | 'right' {
  const open: Array<'up' | 'down' | 'left' | 'right'> = [];
  if (!cell.up)    open.push('up');
  if (!cell.down)  open.push('down');
  if (!cell.left)  open.push('left');
  if (!cell.right) open.push('right');
  // 头偏爱朝"左/上"（读顺序前面），尾偏爱朝"右/下"
  const priority = prefer === 'head'
    ? (['left', 'up', 'right', 'down'] as const)
    : (['right', 'down', 'left', 'up'] as const);
  for (const p of priority) if (open.includes(p)) return p;
  return open[0] ?? 'right';
}

/** 创建一个 SVG 元素（简化） */
function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** 把 hex 转成带 alpha 的 rgba 字符串 */
function hexA(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 确定性伪随机（斑纹位置用；同一条鱼永远长在一样的位置） */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface InventoryUIOptions {
  /** 单格像素尺寸 */
  cellSize?: number;
  /** 打开时的回调（用于冻结控船） */
  onOpen?: () => void;
  /** 关闭时的回调 */
  onClose?: () => void;
  /** 面板挂载到哪个容器（默认 document.body）—— 传入 #stage 可让背包被限制在 16:9 游戏画幅内 */
  container?: HTMLElement;
}

interface PendingCatch {
  fishId: string;
}

interface DragState {
  /** 拖动中的形状 */
  fishId: string;
  rot: number;
  /** 若源自网格：来源物品 id；来自待放入槽为 null */
  fromItemId: string | null;
  /** 拖动中的漂浮元素 */
  ghost: HTMLElement;
  /** 光标相对形状 (0,0) 格的偏移（用来对齐落点） */
  offsetCol: number;
  offsetRow: number;
}

export class InventoryUI {
  readonly inv: Inventory;

  private root: HTMLElement;
  private gridEl: HTMLElement;
  private itemsEl: HTMLElement;
  private trayEl: HTMLElement;
  private hintEl: HTMLElement;
  private previewEl: HTMLElement;

  private cellSize: number;
  private open = false;
  private drag: DragState | null = null;
  private pending: PendingCatch[] = [];
  private opts: InventoryUIOptions;

  constructor(inv: Inventory, opts: InventoryUIOptions = {}) {
    this.inv = inv;
    this.opts = opts;
    this.cellSize = opts.cellSize ?? 46;

    // 找/建根节点
    let root = document.getElementById('inv-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'inv-root';
      (opts.container ?? document.body).appendChild(root);
    }
    this.root = root;
    this.root.classList.add('inv-panel');
    this.root.classList.remove('open');

    this.root.innerHTML = `
      <div class="inv-outer">
        <div class="inv-frame">
          <div class="inv-titlebar">
            <span class="inv-title-text">货 舱</span>
          </div>
          <div class="inv-topbar">
            <div class="inv-stats">
              <div class="inv-stat"><span class="inv-stat-k">船速</span><span class="inv-stat-v">6 kn</span></div>
              <div class="inv-stat"><span class="inv-stat-k">捕捞速度</span><span class="inv-stat-v">80%</span></div>
              <div class="inv-stat"><span class="inv-stat-k">灯</span><span class="inv-stat-v">0 lm</span></div>
            </div>
            <div class="inv-damage">
              <span class="inv-damage-k">受损：</span>
              <span class="inv-damage-boxes"></span>
            </div>
          </div>
          <div class="inv-body">
            <div class="inv-grid-wrap">
              <div class="inv-grid"></div>
              <div class="inv-preview"></div>
              <div class="inv-items"></div>
            </div>
            <div class="inv-tray">
              <div class="inv-tray-title">待放入</div>
              <div class="inv-tray-slots"></div>
            </div>
          </div>
          <div class="inv-hint">拖拽鱼到网格 · 拖动中按 <b>R</b> 旋转 · <b>右键</b>丢弃 · <b>I / Esc</b> 关闭</div>
        </div>
      </div>
    `;

    this.gridEl    = this.root.querySelector('.inv-grid')    as HTMLElement;
    this.itemsEl   = this.root.querySelector('.inv-items')   as HTMLElement;
    this.previewEl = this.root.querySelector('.inv-preview') as HTMLElement;
    this.trayEl    = this.root.querySelector('.inv-tray-slots') as HTMLElement;
    this.hintEl    = this.root.querySelector('.inv-hint')    as HTMLElement;

    // 受损格计数（把 blocked 格数写到顶部小方块）
    const dmgEl = this.root.querySelector('.inv-damage-boxes') as HTMLElement;
    let dmgN = 0;
    for (let r = 0; r < this.inv.rows; r++)
      for (let c = 0; c < this.inv.cols; c++)
        if (this.inv.getCell(c, r) === 'blocked') dmgN++;
    let dmgHtml = '';
    for (let i = 0; i < dmgN; i++) dmgHtml += '<span class="inv-damage-box"></span>';
    dmgEl.innerHTML = dmgHtml;

    this.buildGridCells();
    this.attachInput();
  }

  /* ────────────────────────────────────────────────────────────
     公开 API
     ──────────────────────────────────────────────────────────── */

  /** 打开背包（会触发 onOpen 回调） */
  show() {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('open');
    this.rerenderAll();
    this.opts.onOpen?.();
  }

  /** 关闭背包 */
  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    this.cancelDrag();
    this.opts.onClose?.();
  }

  toggle() {
    if (this.open) this.hide(); else this.show();
  }

  isOpen() { return this.open; }

  /**
   * 钓上一条鱼：**始终**塞进"待放入"槽，然后自动打开背包 UI 让玩家自己拖入网格。
   * 参考渔帆暗涌：捕获瞬间自动进货舱，玩家决定放哪儿——不是系统替你安排。
   */
  onCatch(fishId: string): { autoPlaced: boolean; item?: InventoryItem } {
    this.pending.push({ fishId });
    this.rerenderTray();
    // 自动打开背包（未打开时才 show，避免打断玩家已在的拖动）
    if (!this.open) this.show();
    return { autoPlaced: false };
  }

  /* ────────────────────────────────────────────────────────────
     渲染
     ──────────────────────────────────────────────────────────── */

  private buildGridCells() {
    const w = this.inv.cols * this.cellSize;
    const h = this.inv.rows * this.cellSize;
    this.gridEl.style.width  = `${w}px`;
    this.gridEl.style.height = `${h}px`;
    this.itemsEl.style.width  = `${w}px`;
    this.itemsEl.style.height = `${h}px`;
    this.previewEl.style.width  = `${w}px`;
    this.previewEl.style.height = `${h}px`;
    this.gridEl.style.setProperty('--cell', `${this.cellSize}px`);

    let html = '';
    for (let r = 0; r < this.inv.rows; r++) {
      for (let c = 0; c < this.inv.cols; c++) {
        const blocked = this.inv.getCell(c, r) === 'blocked';
        html += `<div class="inv-cell${blocked ? ' blocked' : ''}"
          style="left:${c * this.cellSize}px;top:${r * this.cellSize}px;
                 width:${this.cellSize}px;height:${this.cellSize}px;"
          data-col="${c}" data-row="${r}"></div>`;
      }
    }
    this.gridEl.innerHTML = html;
  }

  private rerenderAll() {
    this.rerenderItems();
    this.rerenderTray();
  }

  private rerenderItems() {
    this.itemsEl.innerHTML = '';
    for (const item of this.inv.listItems()) {
      const el = this.makeItemEl(item);
      this.itemsEl.appendChild(el);
    }
  }

  private rerenderTray() {
    this.trayEl.innerHTML = '';
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      const def = FISH_LIBRARY[p.fishId];
      if (!def) continue;
      const el = this.makeTrayItemEl(def, i);
      this.trayEl.appendChild(el);
    }
    // 待放入槽为空 —— 隐藏侧边栏区域（视觉更干净）
    const trayCol = this.root.querySelector('.inv-tray') as HTMLElement;
    trayCol.style.opacity = this.pending.length ? '1' : '0.45';
  }

  private makeItemEl(item: InventoryItem): HTMLElement {
    const def = this.inv.fishDef(item.fishId);
    const shape = this.inv.itemShape(item);
    const rows = shape.length, cols = shape[0].length;
    const el = document.createElement('div');
    el.className = 'inv-item';
    el.style.left = `${item.col * this.cellSize}px`;
    el.style.top  = `${item.row * this.cellSize}px`;
    el.style.width  = `${cols * this.cellSize}px`;
    el.style.height = `${rows * this.cellSize}px`;
    el.dataset.itemId = item.id;
    el.title = `${def.name} · ${shapeCells(shape).length} 格 · 基础价 ${def.basePrice}`;
    this.renderFishBody(el, def, shape, this.cellSize, /*highlight*/ false);
    return el;
  }

  /**
   * 用 SVG 把一条鱼画到 parent 里：
   *   - 鱼身：占格拼成的连续轮廓（外圈圆角）+ 上浅下深的渐变（造体积）
   *   - 头部：白眼球 + 黑瞳孔 + 小嘴
   *   - 尾部：三角尾鳍向外延伸（allowOverflow=true 时会溢出到格外）
   *   - 中段：一片背鳍 + 2-3 个深色斑点
   *   - highlight=true：外圈边缘画绿色描边（选中态）
   *
   * 参考渔帆暗涌：鱼是主体，格子只是"占位"。
   */
  private renderFishBody(
    parent: HTMLElement,
    def: FishDef,
    shape: ShapeMatrix,
    cellSize: number,
    highlight: boolean,
    allowOverflow = true,
  ) {
    parent.innerHTML = '';
    const rows = shape.length, cols = shape[0].length;
    const cells = analyzeCells(shape);
    if (cells.length === 0) return;

    const headCell = cells[0];                          // 读顺序第一格 = 鱼头
    const tailCell = cells[cells.length - 1];           // 最后一格 = 鱼尾
    const headDir  = pickOutwardDir(headCell, 'head');  // 头向外的方向
    const tailDir  = pickOutwardDir(tailCell, 'tail');  // 尾向外的方向

    /* ── 1) 鱼身：占格圆角块 + 跨格连续渐变（给"体积感"） ──
     *
     * 每格用同一个 linear-gradient，但用 background-size / position 把渐变
     * 拉伸到"整条鱼的高度"，然后按 cell.r 平移 —— 这样多行鱼身上下
     * 也是一条连续渐变，不会出现每行重复的"色带"。
     */
    const R = Math.floor(cellSize * 0.42);   // 外圈圆角
    const colorLight = shadeHex(def.color,  32);
    const colorDark  = shadeHex(def.color, -28);
    const colorBelly = shadeHex(def.color, -55);
    const bgImage = `linear-gradient(180deg, ${colorLight} 0%, ${def.color} 55%, ${colorBelly} 100%)`;
    const totalH = rows * cellSize;
    for (const cell of cells) {
      const { r, c, up, down, left, right } = cell;
      const el = document.createElement('div');
      el.className = 'inv-item-cell';
      el.style.left   = `${c * cellSize}px`;
      el.style.top    = `${r * cellSize}px`;
      el.style.width  = `${cellSize}px`;
      el.style.height = `${cellSize}px`;
      const tl = (!up && !left)   ? R : 0;
      const tr = (!up && !right)  ? R : 0;
      const bl = (!down && !left) ? R : 0;
      const br = (!down && !right)? R : 0;
      el.style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
      el.style.backgroundImage    = bgImage;
      el.style.backgroundSize     = `100% ${totalH}px`;
      el.style.backgroundPosition = `0 -${r * cellSize}px`;
      el.style.backgroundRepeat   = 'no-repeat';
      if (highlight) {
        const shadow: string[] = [];
        if (!up)    shadow.push('0  2px 0 0 #4ade80 inset');
        if (!down)  shadow.push('0 -2px 0 0 #4ade80 inset');
        if (!left)  shadow.push(' 2px 0 0 0 #4ade80 inset');
        if (!right) shadow.push('-2px 0 0 0 #4ade80 inset');
        shadow.push('0 0 0 1px rgba(255, 255, 255, 0.16) inset');
        el.style.boxShadow = shadow.join(', ');
      }
      parent.appendChild(el);
    }

    /* ── 2) SVG 特征层：眼、尾、背鳍、斑纹 ── */
    const W = cols * cellSize;
    const H = rows * cellSize;
    const svg = svgEl('svg', {
      width: W, height: H,
      viewBox: `0 0 ${W} ${H}`,
    });
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top  = '0';
    svg.style.pointerEvents = 'none';
    if (allowOverflow) svg.style.overflow = 'visible';   // 尾鳍可以溢出到格外

    // 2a) 背鳍：选一个"上方没邻居"的中段格子（不是头也不是尾）
    const dorsalCell = cells.find(cc =>
      !cc.up && cc !== headCell && cc !== tailCell,
    );
    if (dorsalCell) {
      const fx = dorsalCell.c * cellSize;
      const fy = dorsalCell.r * cellSize;
      const midX = fx + cellSize * 0.5;
      const finH = cellSize * 0.36;
      // 三角背鳍：底边贴在格子顶，尖顶向上
      svg.appendChild(svgEl('polygon', {
        points: `${fx + cellSize * 0.20},${fy} ${midX + cellSize * 0.05},${fy - finH} ${fx + cellSize * 0.80},${fy}`,
        fill: colorDark,
        stroke: hexA('#000', 0.25),
        'stroke-width': 1,
        'stroke-linejoin': 'round',
      }));
    }

    // 2b) 斑纹：每个非头非尾的格子里随机 1-2 个深色小圆
    //     用格坐标作确定性种子，避免每次重画位置乱蹦
    for (const cell of cells) {
      if (cell === headCell || cell === tailCell) continue;
      const seed = cell.r * 31 + cell.c * 7 + def.id.length;
      const rng = mulberry32(seed);
      const dots = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < dots; i++) {
        const fx = cell.c * cellSize + cellSize * (0.25 + rng() * 0.50);
        const fy = cell.r * cellSize + cellSize * (0.25 + rng() * 0.45);
        svg.appendChild(svgEl('circle', {
          cx: fx, cy: fy,
          r: cellSize * 0.06,
          fill: hexA(colorBelly, 0.55),
        }));
      }
    }

    // 2c) 尾鳍：向 tailDir 方向长出的双叉三角
    {
      const fx = tailCell.c * cellSize;
      const fy = tailCell.r * cellSize;
      const cx = fx + cellSize * 0.5;
      const cy = fy + cellSize * 0.5;
      const halfIn  = cellSize * 0.30;     // 尾根宽度
      const outLen  = cellSize * 0.55;     // 尾向外伸多少
      const outHalf = cellSize * 0.40;     // 尾扇的开叉半宽
      let pts = '';
      if (tailDir === 'right') {
        const bx = fx + cellSize;
        pts = `${bx},${cy - halfIn} ${bx + outLen},${cy - outHalf} ${bx + outLen * 0.55},${cy} ${bx + outLen},${cy + outHalf} ${bx},${cy + halfIn}`;
      } else if (tailDir === 'left') {
        const bx = fx;
        pts = `${bx},${cy - halfIn} ${bx - outLen},${cy - outHalf} ${bx - outLen * 0.55},${cy} ${bx - outLen},${cy + outHalf} ${bx},${cy + halfIn}`;
      } else if (tailDir === 'down') {
        const by = fy + cellSize;
        pts = `${cx - halfIn},${by} ${cx - outHalf},${by + outLen} ${cx},${by + outLen * 0.55} ${cx + outHalf},${by + outLen} ${cx + halfIn},${by}`;
      } else /* up */ {
        const by = fy;
        pts = `${cx - halfIn},${by} ${cx - outHalf},${by - outLen} ${cx},${by - outLen * 0.55} ${cx + outHalf},${by - outLen} ${cx + halfIn},${by}`;
      }
      svg.appendChild(svgEl('polygon', {
        points: pts,
        fill: colorDark,
        stroke: hexA('#000', 0.30),
        'stroke-width': 1,
        'stroke-linejoin': 'round',
      }));
    }

    // 2d) 眼睛：在头格里，靠"向外"那侧 25% 处
    {
      const fx = headCell.c * cellSize;
      const fy = headCell.r * cellSize;
      const cx = fx + cellSize * 0.5;
      const cy = fy + cellSize * 0.42;   // 略偏上，符合鱼类眼位
      const off = cellSize * 0.22;
      let ex = cx, ey = cy;
      if (headDir === 'left')  ex = fx + off;
      if (headDir === 'right') ex = fx + cellSize - off;
      if (headDir === 'up')    ey = fy + off;
      if (headDir === 'down')  ey = fy + cellSize - off;
      const eyeR   = cellSize * 0.14;
      const pupilR = cellSize * 0.075;
      // 眼白
      svg.appendChild(svgEl('circle', {
        cx: ex, cy: ey, r: eyeR,
        fill: '#f2ead9',
        stroke: hexA('#000', 0.5),
        'stroke-width': 1,
      }));
      // 瞳孔
      svg.appendChild(svgEl('circle', {
        cx: ex - eyeR * 0.15,
        cy: ey - eyeR * 0.10,
        r: pupilR,
        fill: '#141010',
      }));
      // 高光
      svg.appendChild(svgEl('circle', {
        cx: ex - eyeR * 0.35,
        cy: ey - eyeR * 0.35,
        r: eyeR * 0.28,
        fill: '#ffffff',
        opacity: 0.85,
      }));

      // 嘴：一小段线，朝向 headDir
      const mouthLen = cellSize * 0.18;
      let m1x = cx, m1y = cy + cellSize * 0.22;
      let m2x = cx, m2y = m1y;
      if (headDir === 'left')  { m1x = fx;                   m2x = fx + mouthLen; }
      if (headDir === 'right') { m1x = fx + cellSize - mouthLen; m2x = fx + cellSize; }
      if (headDir === 'up')    { m1y = fy;                   m2y = fy + mouthLen; m1x = cx; m2x = cx; }
      if (headDir === 'down')  { m1y = fy + cellSize - mouthLen; m2y = fy + cellSize; m1x = cx; m2x = cx; }
      svg.appendChild(svgEl('line', {
        x1: m1x, y1: m1y, x2: m2x, y2: m2y,
        stroke: hexA('#000', 0.55),
        'stroke-width': Math.max(1, cellSize * 0.05),
        'stroke-linecap': 'round',
      }));
    }

    parent.appendChild(svg);
  }

  private makeTrayItemEl(def: FishDef, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'inv-tray-item';
    el.dataset.trayIndex = String(index);
    el.title = `${def.name} · 拖入网格`;
    const shape = def.shape;
    const rows = shape.length, cols = shape[0].length;
    // 小尺寸预览（比网格里稍小）
    const s = Math.max(20, Math.floor(this.cellSize * 0.62));
    const shapeWrap = document.createElement('div');
    shapeWrap.className = 'inv-tray-item-shape';
    shapeWrap.style.width  = `${cols * s}px`;
    shapeWrap.style.height = `${rows * s}px`;
    // 用同一套连续鱼身渲染 —— 保证托盘鱼样式和网格鱼一致
    this.renderFishBody(shapeWrap, def, shape, s, /*highlight*/ false);
    el.appendChild(shapeWrap);
    const label = document.createElement('div');
    label.className = 'inv-tray-item-name';
    label.textContent = def.name;
    el.appendChild(label);
    return el;
  }

  private firstCell(shape: number[][]): { c: number; r: number } | null {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c]) return { c, r };
      }
    }
    return null;
  }

  /* ────────────────────────────────────────────────────────────
     交互 —— 拖放 + 旋转 + 丢弃
     ──────────────────────────────────────────────────────────── */

  private attachInput() {
    // 网格内点击已放置物品 → 开始拖动
    this.itemsEl.addEventListener('mousedown', (e) => {
      if (!this.open) return;
      if (e.button !== 0) return;
      const target = (e.target as HTMLElement).closest('.inv-item') as HTMLElement | null;
      if (!target) return;
      const itemId = target.dataset.itemId!;
      const item = this.inv.getItem(itemId);
      if (!item) return;
      // 记录光标在形状里的哪个格
      const gridRect = this.gridEl.getBoundingClientRect();
      const mc = Math.floor((e.clientX - gridRect.left) / this.cellSize);
      const mr = Math.floor((e.clientY - gridRect.top)  / this.cellSize);
      this.startDrag({
        fishId: item.fishId,
        rot: item.rot,
        fromItemId: itemId,
        offsetCol: mc - item.col,
        offsetRow: mr - item.row,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      // 先把它从网格里"拿出来"，好让空格可以被自己重叠
      this.inv.remove(itemId);
      this.rerenderItems();
      e.preventDefault();
    });

    // 悬停：给鼠标下的鱼画绿色描边（参考 Dredge 的选中态）
    this.itemsEl.addEventListener('mouseover', (e) => {
      if (!this.open || this.drag) return;
      const target = (e.target as HTMLElement).closest('.inv-item') as HTMLElement | null;
      if (!target) return;
      const itemId = target.dataset.itemId!;
      const item = this.inv.getItem(itemId);
      if (!item) return;
      target.innerHTML = '';
      this.renderFishBody(target, this.inv.fishDef(item.fishId), this.inv.itemShape(item), this.cellSize, /*highlight*/ true);
    });
    this.itemsEl.addEventListener('mouseout', (e) => {
      if (!this.open || this.drag) return;
      const target = (e.target as HTMLElement).closest('.inv-item') as HTMLElement | null;
      if (!target) return;
      const itemId = target.dataset.itemId!;
      const item = this.inv.getItem(itemId);
      if (!item) return;
      target.innerHTML = '';
      this.renderFishBody(target, this.inv.fishDef(item.fishId), this.inv.itemShape(item), this.cellSize, /*highlight*/ false);
    });

    // 待放入槽 → 开始拖动
    this.trayEl.addEventListener('mousedown', (e) => {
      if (!this.open) return;
      if (e.button !== 0) return;
      const target = (e.target as HTMLElement).closest('.inv-tray-item') as HTMLElement | null;
      if (!target) return;
      const idx = parseInt(target.dataset.trayIndex!, 10);
      const p = this.pending[idx];
      if (!p) return;
      // 从待放入槽先摘出来（不然拖失败再放回）
      this.pending.splice(idx, 1);
      this.rerenderTray();
      this.startDrag({
        fishId: p.fishId,
        rot: 0,
        fromItemId: null,
        offsetCol: 0,
        offsetRow: 0,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      e.preventDefault();
    });

    // 全局拖动跟随
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.updateDragGhost(e.clientX, e.clientY);
      this.updatePreview(e.clientX, e.clientY);
    });

    // 松手 → 放置或退回
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      if (e.button !== 0) return;
      this.dropDrag(e.clientX, e.clientY);
    });

    // 右键：拖动中丢弃 / 网格里删除
    window.addEventListener('contextmenu', (e) => {
      if (!this.open) return;
      // 拖动中：丢弃
      if (this.drag) {
        e.preventDefault();
        this.cancelDrag();
        return;
      }
      // 在网格里的物品上：删除
      const target = (e.target as HTMLElement).closest('.inv-item') as HTMLElement | null;
      if (target) {
        e.preventDefault();
        const itemId = target.dataset.itemId!;
        this.inv.remove(itemId);
        this.rerenderItems();
      }
    });

    // R 键旋转
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'i' || e.key === 'I' || e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
        return;
      }
      if (this.drag && (e.key === 'r' || e.key === 'R')) {
        e.stopPropagation();
        this.drag.rot = (this.drag.rot + 1) % 4;
        this.rebuildGhost();
        this.updateDragGhost();
        this.updatePreview();
      }
    }, true);
  }

  private startDrag(o: {
    fishId: string; rot: number; fromItemId: string | null;
    offsetCol: number; offsetRow: number;
    clientX: number; clientY: number;
  }) {
    const ghost = document.createElement('div');
    ghost.className = 'inv-ghost';
    document.body.appendChild(ghost);
    this.drag = {
      fishId: o.fishId,
      rot: o.rot,
      fromItemId: o.fromItemId,
      offsetCol: o.offsetCol,
      offsetRow: o.offsetRow,
      ghost,
    };
    this.rebuildGhost();
    this.updateDragGhost(o.clientX, o.clientY);
    this.updatePreview(o.clientX, o.clientY);
  }

  private rebuildGhost() {
    if (!this.drag) return;
    const def = FISH_LIBRARY[this.drag.fishId];
    const shape = rotateN(def.shape, this.drag.rot);
    const rows = shape.length, cols = shape[0].length;
    this.drag.ghost.innerHTML = '';
    this.drag.ghost.style.width  = `${cols * this.cellSize}px`;
    this.drag.ghost.style.height = `${rows * this.cellSize}px`;
    // 拖动中的鱼身：连续形状 + 绿色高亮（选中态）
    this.renderFishBody(this.drag.ghost, def, shape, this.cellSize, /*highlight*/ true);
    // 旋转后重新对齐 offset —— 用形状的左上有效格作为锚点
    const first = this.firstCell(shape);
    if (first) {
      this.drag.offsetCol = first.c;
      this.drag.offsetRow = first.r;
    }
  }

  private lastClientX = 0;
  private lastClientY = 0;
  private updateDragGhost(cx?: number, cy?: number) {
    if (!this.drag) return;
    if (typeof cx === 'number') this.lastClientX = cx;
    if (typeof cy === 'number') this.lastClientY = cy;
    // 让光标位于形状 offset 的中心
    const gx = this.lastClientX - (this.drag.offsetCol + 0.5) * this.cellSize;
    const gy = this.lastClientY - (this.drag.offsetRow + 0.5) * this.cellSize;
    this.drag.ghost.style.transform = `translate(${gx}px, ${gy}px)`;
  }

  private updatePreview(cx?: number, cy?: number) {
    if (!this.drag) {
      this.previewEl.innerHTML = '';
      return;
    }
    if (typeof cx === 'number') this.lastClientX = cx;
    if (typeof cy === 'number') this.lastClientY = cy;
    const gridRect = this.gridEl.getBoundingClientRect();
    const mc = Math.floor((this.lastClientX - gridRect.left) / this.cellSize);
    const mr = Math.floor((this.lastClientY - gridRect.top)  / this.cellSize);
    const anchorCol = mc - this.drag.offsetCol;
    const anchorRow = mr - this.drag.offsetRow;
    const ok = this.inv.canPlace(
      this.drag.fishId, anchorCol, anchorRow, this.drag.rot,
      this.drag.fromItemId ?? undefined,
    );
    // 光标不在网格上 —— 不画预览
    if (this.lastClientX < gridRect.left || this.lastClientX > gridRect.right
      || this.lastClientY < gridRect.top || this.lastClientY > gridRect.bottom) {
      this.previewEl.innerHTML = '';
      return;
    }
    // 画预览
    const def = FISH_LIBRARY[this.drag.fishId];
    const shape = rotateN(def.shape, this.drag.rot);
    let html = '';
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const cell_c = anchorCol + c;
        const cell_r = anchorRow + r;
        html += `<div class="inv-preview-cell ${ok ? 'ok' : 'bad'}"
          style="left:${cell_c * this.cellSize}px;top:${cell_r * this.cellSize}px;
                 width:${this.cellSize}px;height:${this.cellSize}px;"></div>`;
      }
    }
    this.previewEl.innerHTML = html;
  }

  private dropDrag(cx: number, cy: number) {
    if (!this.drag) return;
    const gridRect = this.gridEl.getBoundingClientRect();
    let placed = false;
    if (
      cx >= gridRect.left && cx <= gridRect.right &&
      cy >= gridRect.top  && cy <= gridRect.bottom
    ) {
      const mc = Math.floor((cx - gridRect.left) / this.cellSize);
      const mr = Math.floor((cy - gridRect.top)  / this.cellSize);
      const anchorCol = mc - this.drag.offsetCol;
      const anchorRow = mr - this.drag.offsetRow;
      if (this.inv.canPlace(this.drag.fishId, anchorCol, anchorRow, this.drag.rot)) {
        this.inv.place(this.drag.fishId, anchorCol, anchorRow, this.drag.rot);
        placed = true;
      }
    }
    if (!placed) {
      // 放不下 —— 退回待放入槽（无论来自哪里）
      this.pending.push({ fishId: this.drag.fishId });
      this.rerenderTray();
    }
    this.drag.ghost.remove();
    this.drag = null;
    this.previewEl.innerHTML = '';
    this.rerenderItems();
  }

  private cancelDrag() {
    if (!this.drag) return;
    // 取消：物品退回待放入槽（因为拖出时已经 remove 掉了）
    this.pending.push({ fishId: this.drag.fishId });
    this.rerenderTray();
    this.drag.ghost.remove();
    this.drag = null;
    this.previewEl.innerHTML = '';
  }
}
