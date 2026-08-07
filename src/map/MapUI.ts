/**
 * MapUI —— P1 航海地图全屏叠加层
 *
 * 结构：
 *   #map-overlay                    <-- 铺满 #stage，z-index 高于游戏但低于 fishShowcase
 *     └─ .map-plate                 <-- 底图 (background-image: /maps/world.png)
 *         ├─ svg.map-edges          <-- 节点之间的航路线（视觉参考）
 *         ├─ svg.map-nodes          <-- 所有节点热区（每个 <g> 是一个节点）
 *         ├─ .map-hud-ap            <-- 左上：行动点 pill
 *         ├─ .map-hud-bait          <-- 左上：鱼饵 pill（复用 playerResources）
 *         ├─ .map-topbar            <-- 顶部标题
 *         ├─ .map-close-btn         <-- 右上：关闭按钮（按 M 或点它关地图）
 *         └─ .map-tooltip           <-- 鼠标悬停节点时显示的信息卡
 *
 * 交互：
 *   · 点可玩节点 (canTravelTo)         → 消耗 AP → fade → onTravel(id)
 *   · 点未开放节点                      → toast "此海域尚未开放"，不消耗 AP
 *   · 点未解锁节点                      → toast "此节点尚未解锁"
 *   · AP 不足                          → toast "行动点不足，返回港口补给"
 *   · 按 M / Esc / 点右上关闭按钮        → 关地图（不消耗 AP）
 *   · url ?mapdev=1 时点空白处          → console.log 相对百分比（用来微调 mapNodes 坐标）
 *
 * 使用：
 *   const map = new MapUI({
 *     container: stage,
 *     onTravel: (id) => { ... },
 *   });
 *   map.show();
 *   map.hide();
 *   map.isOpen();
 */

import {
  MAP_NODES, canTravelTo,
  applyCustomCoords, loadCustomCoords, saveCustomCoords, clearCustomCoords, exportNodesAsCode,
  loadCustomIcons, setNodeIcon, setNodeIconSize, clearNodeIcon, clearAllNodeIcons,
  DEFAULT_ICON_SIZE_PX,
  type MapNode, type NodeKind, type CustomIcons,
} from './mapNodes';
import { playerActionPoints } from './PlayerActionPoints';
import { playerResources } from '../proto/PlayerResources';
import { questState } from '../quest/QuestState';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** RGB 欧氏距离平方 —— 抠透明时用，避免开方 */
function colorDist2(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export interface MapUIOptions {
  /** 挂载容器（默认 document.body；建议传 #stage 以受 16:9 画幅约束） */
  container?: HTMLElement;
  /** 玩家选择一个可玩节点后，MapUI 会先扣 AP + 播 fade，然后触发这个回调 */
  onTravel: (nodeId: string, node: MapNode) => void;
  /** 关闭地图后的回调（M/Esc/关闭按钮） */
  onClose?: () => void;
  /** 点击「返回港口」 */
  onReturnPort?: () => void;
  /** 打开地图时的回调（可用来暂停游戏音乐等） */
  onOpen?: () => void;
  /** 地图底图 URL，默认 /maps/world.png */
  bgUrl?: string;
}

/** 节点样式（颜色 / icon）—— 按 NodeKind 分档 */
const NODE_STYLE: Record<NodeKind, { color: string; icon: string; label: string }> = {
  port:         { color: '#f4d18a', icon: '⚓', label: '港口' },
  fishing_zone: { color: '#7ec8ff', icon: '🎣', label: '钓鱼海域' },
  boss:         { color: '#ff7a68', icon: '💀', label: 'Boss' },
  story:        { color: '#c8b48a', icon: '⛵', label: '航路点' },
  hazard:       { color: '#c084fc', icon: '🌀', label: '危险区' },
};

/** 节点热区半径（px） */
const NODE_RADIUS = 22;

export class MapUI {
  private root: HTMLElement;
  private plate: HTMLElement;
  private edgesSvg: SVGSVGElement;
  private nodesLayer: HTMLElement;
  private toastEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private apEl: HTMLElement;
  private apMaxEl: HTMLElement;
  private opts: MapUIOptions;
  private open = false;
  private devMode = false;
  private unsubAP: () => void;
  private unsubBait: () => void;
  private baitEl: HTMLElement;
  private baitMaxEl: HTMLElement;
  /** 当前"所在节点"—— 后续可以做路径高亮，MVP 只显示一个"你在这里"图标 */
  private currentNodeId: string = 'shallow_bay';
  /** 当前 hover 的节点 id（用于 tooltip） */
  private hoverNodeId: string | null = null;
  /** 底图真实宽高比（w/h），onload 前默认 16:9 */
  private imageAspect: number = 16 / 9;
  /** ResizeObserver 用来监听 stage 尺寸变化（16:9 letterbox 会跟窗口变） */
  private resizeObs?: ResizeObserver;
  /** 自定义节点图标（dev 上传的 base64），drawNodes 时读一次 */
  private customIcons: CustomIcons = {};
  /** dev 模式当前选中的节点 id（用来把上传/尺寸操作定位到这个节点） */
  private devSelectedId: string | null = null;

  constructor(opts: MapUIOptions) {
    this.opts = opts;
    this.devMode = new URLSearchParams(location.search).has('mapdev');

    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'map-overlay';
    this.root.className = 'map-overlay' + (this.devMode ? ' devmode' : '');

    this.plate = document.createElement('div');
    this.plate.className = 'map-plate';
    // MAP_BG_VERSION 每次替换 world.png 时手动 +1，浏览器就会重新拉图，不会命中旧缓存
    const MAP_BG_VERSION = 2;
    const bgUrl = (opts.bgUrl ?? '/maps/world.png') + `?v=${MAP_BG_VERSION}`;
    this.plate.style.backgroundImage = `url('${bgUrl}')`;

    // 底图 onload 后记住真实图片宽高比，用来 JS 直接算 plate 尺寸。
    // 之前尝试用 aspect-ratio + max-width/height CSS 组合让浏览器自动 letterbox，
    // 但在 flex 容器里浏览器不同步算 max-* 约束，会把 plate 塌成 0 高度 —— UI 全错乱。
    // 改成 JS 显式设 width/height，在图片 onload 和窗口 resize 时都重算一次。
    const bgImg = new Image();
    bgImg.onload = () => {
      this.imageAspect = bgImg.naturalWidth / bgImg.naturalHeight;
      this.updatePlateSize();
    };
    bgImg.onerror = () => {
      console.warn('[MapUI] 底图加载失败:', bgUrl);
    };
    bgImg.src = bgUrl;

    this.root.appendChild(this.plate);

    // 注意：地图底图 (world.png) 上已经手绘好了完整的航路线，
    // 不再由 JS 画任何 SVG 连线 —— 否则会盖在原画上产生双重线条 / 虚线穿帮。
    // 保留 edgesSvg 引用只是避免 drawEdges/dispose 之类的旧代码引用报错。
    this.edgesSvg = document.createElementNS(SVG_NS, 'svg');
    this.edgesSvg.setAttribute('class', 'map-edges');
    this.edgesSvg.style.display = 'none';
    this.plate.appendChild(this.edgesSvg);

    // HTML 层：节点（每个节点是一个绝对定位的 div，避开 SVG 非等比拉伸导致的椭圆化）
    this.nodesLayer = document.createElement('div');
    this.nodesLayer.className = 'map-nodes';
    this.plate.appendChild(this.nodesLayer);

    // 顶部标题 + 编辑节点 + 关闭按钮
    const topbar = document.createElement('div');
    topbar.className = 'map-topbar';
    topbar.innerHTML = `
      <div class="map-title">
        <div class="map-title-cn">航 海 地 图</div>
        <div class="map-title-en">NAVIGATION CHART</div>
      </div>
      <div class="map-topbar-actions">
        <button class="map-port-btn" title="返回平洛镇港口">⚓ 返回港口</button>
        <button class="map-edit-btn" title="进入节点编辑模式 —— 摆放位置 / 上传图标">🛠 编辑节点</button>
        <button class="map-close-btn" title="关闭 (M / Esc)">✕</button>
      </div>
    `;
    this.plate.appendChild(topbar);
    this.editBtnEl = topbar.querySelector('.map-edit-btn') as HTMLButtonElement;
    this.editBtnEl.addEventListener('click', () => this.enterDevMode());
    topbar.querySelector('.map-port-btn')!.addEventListener('click', () => {
      this.hide();
      this.opts.onReturnPort?.();
    });
    topbar.querySelector('.map-close-btn')!.addEventListener('click', () => this.hide());

    // 左上 HUD：AP + 鱼饵
    const hud = document.createElement('div');
    hud.className = 'map-hud';
    hud.innerHTML = `
      <div class="map-hud-pill map-hud-ap" title="行动点 —— 每次通行消耗，回港口补满">
        <span class="map-hud-icon">⛵</span>
        <span class="map-hud-num"><b class="ap-cur">0</b> / <span class="ap-max">0</span></span>
        <span class="map-hud-label">行动点</span>
      </div>
      <div class="map-hud-pill map-hud-bait" title="鱼饵 —— 每次抛竿消耗，回港口补满">
        <span class="map-hud-icon">🪱</span>
        <span class="map-hud-num"><b class="bait-cur">0</b> / <span class="bait-max">0</span></span>
        <span class="map-hud-label">鱼饵</span>
      </div>
    `;
    this.plate.appendChild(hud);
    this.apEl    = hud.querySelector('.ap-cur')!    as HTMLElement;
    this.apMaxEl = hud.querySelector('.ap-max')!    as HTMLElement;
    this.baitEl    = hud.querySelector('.bait-cur')! as HTMLElement;
    this.baitMaxEl = hud.querySelector('.bait-max')! as HTMLElement;

    // Tooltip（hover 节点）
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'map-tooltip';
    this.plate.appendChild(this.tooltipEl);

    // Toast（点击结果反馈）
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'map-toast';
    this.plate.appendChild(this.toastEl);

    // dev 模式：拖拽节点重定位 + 工具栏
    if (this.devMode) this.buildDevToolbar();

    (opts.container ?? document.body).appendChild(this.root);

    // 应用 localStorage 里 dev 拖拽保存的自定义坐标（覆盖代码写死的值）
    // 用户随便打开 devMode 拖动过，之后普通模式打开地图也会用他新摆的位置
    applyCustomCoords();

    // 只绘节点热区 —— 航路线由底图自带，不再 JS 绘制
    this.drawNodes();

    // 订阅资源变化
    this.unsubAP = playerActionPoints.onChange((e) => {
      this.apEl.textContent    = String(e.ap);
      this.apMaxEl.textContent = String(e.apMax);
      this.apEl.classList.toggle('low', e.ap <= 1);
    });
    this.unsubBait = playerResources.onChange((e) => {
      this.baitEl.textContent    = String(e.bait);
      this.baitMaxEl.textContent = String(e.baitMax);
      this.baitEl.classList.toggle('low', e.bait <= 3);
    });

    // 键盘：M / Esc 关地图
    window.addEventListener('keydown', this.onKeyDown);

    // stage 尺寸变化（16:9 letterbox 会随窗口调整）→ 重算 plate 尺寸
    // 用 ResizeObserver 而不是 window.resize，能覆盖 devtools 打开等间接情况
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.updatePlateSize());
      this.resizeObs.observe(this.root);
    } else {
      window.addEventListener('resize', this.onWindowResize);
    }
    // 先按初始默认 16:9 算一遍，图片 onload 会再算一遍
    this.updatePlateSize();

    // 默认隐藏
    this.hideImmediate();
  }

  private onWindowResize = () => this.updatePlateSize();

  /** 按图片真实宽高比把 plate 塞进 overlay 里最大能容纳的矩形（letterbox） */
  private updatePlateSize() {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w <= 0 || h <= 0) return;
    const overlayAspect = w / h;
    if (this.imageAspect >= overlayAspect) {
      // 图片比舞台更宽 → 顶宽 letterbox（上下露黑边）
      this.plate.style.width  = w + 'px';
      this.plate.style.height = (w / this.imageAspect) + 'px';
    } else {
      // 图片比舞台更高 → 顶高 letterbox（左右露黑边）
      this.plate.style.height = h + 'px';
      this.plate.style.width  = (h * this.imageAspect) + 'px';
    }
  }

  isOpen(): boolean { return this.open; }

  show() {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('visible');
    // 从可能的 fade-out 状态恢复
    this.root.classList.remove('fading-out');
    // 打开时重算一次 —— 隐藏期间 stage 若被 resize 过（比如缩窗口），plate 尺寸要跟上
    // 用 rAF 是因为刚 add class 时 clientWidth 还是 0（display 从 none → flex 需要一帧）
    requestAnimationFrame(() => this.updatePlateSize());
    this.opts.onOpen?.();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('visible');
    this.root.classList.remove('fading-out');
    this.opts.onClose?.();
  }

  private hideImmediate() {
    this.open = false;
    this.root.classList.remove('visible', 'fading-out');
  }

  toggle() {
    if (this.open) this.hide(); else this.show();
  }

  /** 设置"你现在在这里"的节点 —— 传入 id 更新地图上高亮的锚点 */
  setCurrentNode(id: string) {
    this.currentNodeId = id;
    // 重画节点让 .current 状态更新
    this.drawNodes();
  }

  dispose() {
    this.unsubAP();
    this.unsubBait();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObs?.disconnect();
    this.root.remove();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.open) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'm') {
      e.preventDefault();
      this.hide();
    }
  };

  /* ────────────────────────────────────────────────────────────
     绘制
     ──────────────────────────────────────────────────────────── */

  private drawNodes() {
    // 清空节点层
    while (this.nodesLayer.firstChild) this.nodesLayer.removeChild(this.nodesLayer.firstChild);

    // 刷新一遍自定义图标缓存（dev 上传后立即重画时能拿到最新）
    this.customIcons = loadCustomIcons();

    for (const n of MAP_NODES) {
      const style = NODE_STYLE[n.kind];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = this.nodeClasses(n).join(' ');
      el.style.left = `${n.xPct}%`;
      el.style.top  = `${n.yPct}%`;
      el.dataset.id = n.id;
      el.style.setProperty('--node-color', style.color);
      el.setAttribute('aria-label', n.label);

      // 结构：
      //   .map-node-icon        -> 自定义 base64 图标（若上传过）
      //   .map-node-ring        -> 高亮圈（hover 才出现；playable 常驻呼吸）
      //   .map-node-me          -> "你在这里"的 ⛵（仅当前节点，浮在上方，不遮挡）
      //   .map-node-lock        -> 🔒 图标（仅未解锁，hover 才出现）
      const isHere = n.id === this.currentNodeId;
      const icon = this.customIcons[n.id];
      let iconHtml = '';
      if (icon) {
        el.classList.add('has-icon');
        const size = icon.sizePx || DEFAULT_ICON_SIZE_PX;
        el.style.setProperty('--icon-size', `${size}px`);
        iconHtml = `<img class="map-node-icon" src="${icon.dataUrl}" alt="${n.label}" draggable="false">`;
      }

      // dev 模式下选中的节点加个绿色边框
      if (this.devMode && this.devSelectedId === n.id) {
        el.classList.add('dev-selected');
      }

      el.innerHTML = `
        ${iconHtml}
        <div class="map-node-ring"></div>
        ${isHere && !icon ? '<div class="map-node-me">⛵</div>' : ''}
        ${!n.unlocked && !icon ? '<div class="map-node-lock">🔒</div>' : ''}
      `;

      el.addEventListener('mouseenter', () => this.onHover(n));
      el.addEventListener('mouseleave', () => this.onUnhover(n));

      if (this.devMode) {
        // dev 拖拽：mousedown 起手，移动阈值内视为 click 忽略，超过阈值就开始拖
        this.attachDevDrag(el, n);
      } else {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onClickNode(n);
        });
      }
      this.nodesLayer.appendChild(el);
    }
  }

  /* ────────────────────────────────────────────────────────────
     Dev 拖拽：给节点接 mousedown → mousemove → mouseup
     ──────────────────────────────────────────────────────────── */
  private attachDevDrag(el: HTMLButtonElement, n: MapNode) {
    const DRAG_THRESHOLD_PX = 4;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // dev 模式下按下即"选中"这个节点 —— 工具栏的图标上传/尺寸操作都会作用到它
      this.devSelectNode(n.id);

      const startX = e.clientX;
      const startY = e.clientY;
      const startXPct = n.xPct;
      const startYPct = n.yPct;
      let dragging = false;
      // 把 tooltip 关掉，免得挡视线
      this.tooltipEl.classList.remove('visible');

      const onMove = (ev: MouseEvent) => {
        const dxPx = ev.clientX - startX;
        const dyPx = ev.clientY - startY;
        if (!dragging && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        el.classList.add('dragging');

        const rect = this.plate.getBoundingClientRect();
        const dxPct = (dxPx / rect.width) * 100;
        const dyPct = (dyPx / rect.height) * 100;
        n.xPct = Math.max(0, Math.min(100, startXPct + dxPct));
        n.yPct = Math.max(0, Math.min(100, startYPct + dyPct));
        el.style.left = `${n.xPct}%`;
        el.style.top  = `${n.yPct}%`;
        // 实时更新工具栏读数
        this.updateDevReadout(n);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dragging) {
          el.classList.remove('dragging');
          // 存进 localStorage，下次刷新自动生效
          const c = loadCustomCoords();
          c[n.id] = { xPct: +n.xPct.toFixed(2), yPct: +n.yPct.toFixed(2) };
          saveCustomCoords(c);
          this.showToast(`${n.label} → ${n.xPct.toFixed(1)}, ${n.yPct.toFixed(1)}（已保存到 localStorage）`, 1600);
        }
        // 未越过阈值 → 视为 click，dev 模式下不导航到场景，只显示 tooltip
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  private devReadoutEl?: HTMLElement;
  private devBarEl?: HTMLElement;
  private editBtnEl?: HTMLButtonElement;
  private updateDevReadout(n: MapNode) {
    if (this.devReadoutEl) {
      this.devReadoutEl.textContent = `${n.id}: xPct=${n.xPct.toFixed(2)}, yPct=${n.yPct.toFixed(2)}`;
    }
  }

  /**
   * 把图标的棋盘格 / 纯色背景抠成真透明。
   * 原理：采四角小块的主色（棋盘格通常是两种灰），把整图中接近这些颜色的像素 alpha 置 0。
   * 不会误伤灰色石头主体 —— 只要主体颜色跟四角背景色差够大。
   */
  private processIconTransparency(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (w < 2 || h < 2) { resolve(dataUrl); return; }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, w, h);
          const d = imageData.data;

          // 四角已经是透明 → 真透明 PNG，直接返回
          const cornerIdx = [
            0,
            (w - 1) * 4,
            ((h - 1) * w) * 4,
            ((h - 1) * w + (w - 1)) * 4,
          ];
          if (cornerIdx.every((i) => d[i + 3] < 20)) {
            resolve(dataUrl);
            return;
          }

          // 采四角 8×8 区域的颜色作为背景色候选
          const bgColors: Array<{ r: number; g: number; b: number }> = [];
          const samplePatch = (ox: number, oy: number) => {
            const size = Math.min(8, Math.floor(w / 2), Math.floor(h / 2));
            for (let y = oy; y < oy + size; y++) {
              for (let x = ox; x < ox + size; x++) {
                const i = (y * w + x) * 4;
                if (d[i + 3] < 20) continue;
                bgColors.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
              }
            }
          };
          samplePatch(0, 0);
          samplePatch(Math.max(0, w - 8), 0);
          samplePatch(0, Math.max(0, h - 8));
          samplePatch(Math.max(0, w - 8), Math.max(0, h - 8));

          if (bgColors.length === 0) { resolve(dataUrl); return; }

          // 聚成最多 4 种代表性背景色（棋盘格通常 2 种）
          const unique: Array<{ r: number; g: number; b: number }> = [];
          for (const c of bgColors) {
            if (!unique.some((u) => colorDist2(u, c) < 28 * 28)) unique.push(c);
            if (unique.length >= 4) break;
          }

          // 额外：常见 Photoshop / 预览棋盘格色
          unique.push({ r: 204, g: 204, b: 204 });
          unique.push({ r: 255, g: 255, b: 255 });
          unique.push({ r: 192, g: 192, b: 192 });
          unique.push({ r: 153, g: 153, b: 153 });
          unique.push({ r: 128, g: 128, b: 128 });

          const THRESH2 = 42 * 42; // 色差阈值（欧氏距离平方）
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 10) continue;
            const pix = { r: d[i], g: d[i + 1], b: d[i + 2] };
            if (unique.some((u) => colorDist2(u, pix) < THRESH2)) {
              d[i + 3] = 0;
            }
          }

          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('图标加载失败'));
      img.src = dataUrl;
    });
  }

  /* ────────────────────────────────────────────────────────────
     Dev 工具栏（下方）：节点选择 + 图标上传 + 尺寸 + 导出 + 重置 + 完成
     ────────────────────────────────────────────────────────────
     两行结构：
       Row 1：状态徽章 + 当前选中节点信息 + 完成按钮
       Row 2：图标上传 + 尺寸滑块 + 清除图标 + 导出坐标 + 重置坐标 + 清除所有图标
  */
  private buildDevToolbar() {
    const bar = document.createElement('div');
    bar.className = 'map-devbar';
    bar.innerHTML = `
      <div class="map-devbar-row">
        <span class="map-devbar-badge">DEV · 编辑模式</span>
        <span class="map-devbar-readout">点击节点选中 · 拖动重新定位 · 尺寸自动存 localStorage</span>
        <button class="map-devbar-btn done" title="保存并切换到正常地图模式">✓ 完成并游玩</button>
      </div>
      <div class="map-devbar-row">
        <label class="map-devbar-label">当前节点：</label>
        <select class="map-devbar-select"></select>
        <button class="map-devbar-btn upload" title="给选中节点上传一张图标（PNG/JPG）—— 会自动抠掉棋盘格/白底">🖼 上传图标</button>
        <label class="map-devbar-checkbox" title="上传时自动抠掉棋盘格 / 纯色背景变成透明">
          <input type="checkbox" class="map-devbar-autobg" checked> 上传时抠透明
        </label>
        <button class="map-devbar-btn debg" title="对已上传的图标再抠一次透明（修棋盘格）" disabled>✨ 重新抠透明</button>
        <label class="map-devbar-slider-wrap" title="调节选中节点图标的显示尺寸">
          尺寸 <input type="range" class="map-devbar-slider" min="16" max="160" value="56" disabled>
          <span class="map-devbar-slider-val">56 px</span>
        </label>
        <button class="map-devbar-btn clear-icon" title="删除选中节点的图标">🗑 清除图标</button>
        <span class="map-devbar-spacer"></span>
        <button class="map-devbar-btn export" title="把所有节点当前坐标复制到剪贴板（TS 代码）">📋 导出坐标</button>
        <button class="map-devbar-btn reset" title="清除 localStorage 里的自定义坐标 → 恢复代码里写死的默认值">↺ 重置坐标</button>
        <button class="map-devbar-btn clear-all" title="删除所有节点的自定义图标">🧹 清除所有图标</button>
      </div>
      <input type="file" class="map-devbar-file" accept="image/*" style="display:none">
    `;
    this.plate.appendChild(bar);
    this.devBarEl = bar;

    this.devReadoutEl = bar.querySelector('.map-devbar-readout') as HTMLElement;

    // ── 节点下拉 ──
    const select = bar.querySelector('.map-devbar-select') as HTMLSelectElement;
    for (const n of MAP_NODES) {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `${n.label}  (${n.id})`;
      select.appendChild(opt);
    }
    // 默认选中第一个
    this.devSelectedId = MAP_NODES[0]?.id ?? null;
    if (this.devSelectedId) select.value = this.devSelectedId;
    select.addEventListener('change', () => this.devSelectNode(select.value));

    // ── 尺寸滑块 ──
    const slider = bar.querySelector('.map-devbar-slider') as HTMLInputElement;
    const sliderVal = bar.querySelector('.map-devbar-slider-val') as HTMLElement;
    slider.addEventListener('input', () => {
      if (!this.devSelectedId) return;
      const size = +slider.value;
      sliderVal.textContent = `${size} px`;
      setNodeIconSize(this.devSelectedId, size);
      // 只更新对应 el 的 css var，避免整表重画（图标 + 遮罩同步变大）
      const el = this.nodesLayer.querySelector(
        `.map-node[data-id="${this.devSelectedId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.style.setProperty('--icon-size', `${size}px`);
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
      }
    });

    // ── 图标上传 ──
    const uploadBtn = bar.querySelector('.map-devbar-btn.upload') as HTMLButtonElement;
    const fileInput = bar.querySelector('.map-devbar-file') as HTMLInputElement;
    const autoBg = bar.querySelector('.map-devbar-autobg') as HTMLInputElement;
    const debgBtn = bar.querySelector('.map-devbar-btn.debg') as HTMLButtonElement;
    uploadBtn.addEventListener('click', () => {
      if (!this.devSelectedId) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f || !this.devSelectedId) return;
      if (f.size > 500 * 1024) {
        if (!confirm(`此图片较大 (${(f.size / 1024).toFixed(0)}KB)，可能会撑爆 localStorage（5MB 上限）。继续上传？`)) {
          fileInput.value = '';
          return;
        }
      }
      const nodeId = this.devSelectedId;
      const size = +slider.value;
      const doKey = autoBg.checked;
      const reader = new FileReader();
      reader.onload = async () => {
        const raw = String(reader.result || '');
        if (!raw.startsWith('data:image/')) {
          this.showToast('❌ 文件不是图片格式', 2000);
          return;
        }
        try {
          const dataUrl = doKey ? await this.processIconTransparency(raw) : raw;
          setNodeIcon(nodeId, dataUrl, size);
          this.customIcons = loadCustomIcons();
          this.drawNodes();
          this.devSelectNode(nodeId);
          this.showToast(
            doKey ? `✅ ${nodeId} 图标已上传（已抠透明底）` : `✅ ${nodeId} 图标已上传`,
            2000,
          );
        } catch (err) {
          console.warn('[mapdev] 图标处理失败，回退原图:', err);
          setNodeIcon(nodeId, raw, size);
          this.customIcons = loadCustomIcons();
          this.drawNodes();
          this.devSelectNode(nodeId);
          this.showToast('⚠️ 抠透明失败，已用原图 · 可再点「重新抠透明」', 2600);
        }
      };
      reader.readAsDataURL(f);
      fileInput.value = '';
    });

    // ── 对已上传图标重新抠透明（修棋盘格） ──
    debgBtn.addEventListener('click', async () => {
      if (!this.devSelectedId) return;
      const meta = loadCustomIcons()[this.devSelectedId];
      if (!meta) return;
      try {
        const fixed = await this.processIconTransparency(meta.dataUrl);
        setNodeIcon(this.devSelectedId, fixed, meta.sizePx || DEFAULT_ICON_SIZE_PX);
        this.customIcons = loadCustomIcons();
        this.drawNodes();
        this.devSelectNode(this.devSelectedId);
        this.showToast('✨ 已重新抠透明底', 1800);
      } catch (err) {
        console.warn('[mapdev] 重新抠透明失败:', err);
        this.showToast('❌ 抠透明失败', 1800);
      }
    });

    // ── 清除单个 / 全部图标 ──
    const clearIconBtn = bar.querySelector('.map-devbar-btn.clear-icon') as HTMLButtonElement;
    clearIconBtn.addEventListener('click', () => {
      if (!this.devSelectedId) return;
      clearNodeIcon(this.devSelectedId);
      this.customIcons = loadCustomIcons();
      this.drawNodes();
      this.showToast(`🗑 已清除 ${this.devSelectedId} 的图标`, 1600);
    });

    const clearAllBtn = bar.querySelector('.map-devbar-btn.clear-all') as HTMLButtonElement;
    clearAllBtn.addEventListener('click', () => {
      if (!confirm('删除所有节点的自定义图标？此操作不可恢复。')) return;
      clearAllNodeIcons();
      this.customIcons = {};
      this.drawNodes();
      this.showToast('🧹 已清除所有节点图标', 1800);
    });

    // ── 导出坐标 ──
    const exportBtn = bar.querySelector('.map-devbar-btn.export') as HTMLButtonElement;
    exportBtn.addEventListener('click', async () => {
      const code = exportNodesAsCode();
      try {
        await navigator.clipboard.writeText(code);
        this.showToast('✅ 已复制到剪贴板 · 请粘到 src/map/mapNodes.ts', 2400);
      } catch {
        console.log('[mapdev] 剪贴板不可用，坐标输出到 console:');
        console.log(code);
        this.showToast('剪贴板 API 不可用，坐标已输出到 console', 2400);
      }
    });

    // ── 重置坐标 ──
    const resetBtn = bar.querySelector('.map-devbar-btn.reset') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      if (!confirm('清除 localStorage 里的自定义坐标，恢复到代码写死的默认值？')) return;
      clearCustomCoords();
      location.reload();
    });

    // ── 完成 ──
    const doneBtn = bar.querySelector('.map-devbar-btn.done') as HTMLButtonElement;
    doneBtn.addEventListener('click', () => this.exitDevMode());

    // 初始化选中节点状态（同步滑块和视觉高亮）
    if (this.devSelectedId) this.devSelectNode(this.devSelectedId);
  }

  /** 选中一个节点 —— 更新下拉、滑块、readout、视觉高亮 */
  private devSelectNode(id: string) {
    this.devSelectedId = id;
    if (!this.devBarEl) return;

    // 下拉同步
    const select = this.devBarEl.querySelector('.map-devbar-select') as HTMLSelectElement;
    if (select && select.value !== id) select.value = id;

    // 滑块 —— 从当前图标读尺寸，没图标就 disable
    const icons = loadCustomIcons();
    const meta = icons[id];
    const slider = this.devBarEl.querySelector('.map-devbar-slider') as HTMLInputElement;
    const sliderVal = this.devBarEl.querySelector('.map-devbar-slider-val') as HTMLElement;
    const clearIconBtn = this.devBarEl.querySelector('.map-devbar-btn.clear-icon') as HTMLButtonElement;
    const debgBtn = this.devBarEl.querySelector('.map-devbar-btn.debg') as HTMLButtonElement;
    if (meta) {
      slider.disabled = false;
      slider.value = String(meta.sizePx || DEFAULT_ICON_SIZE_PX);
      sliderVal.textContent = `${slider.value} px`;
      clearIconBtn.disabled = false;
      debgBtn.disabled = false;
    } else {
      slider.disabled = true;
      slider.value = String(DEFAULT_ICON_SIZE_PX);
      sliderVal.textContent = `${DEFAULT_ICON_SIZE_PX} px  (未上传)`;
      clearIconBtn.disabled = true;
      debgBtn.disabled = true;
    }

    // Readout
    const node = MAP_NODES.find((n) => n.id === id);
    if (this.devReadoutEl && node) {
      this.devReadoutEl.textContent =
        `${node.label} · xPct=${node.xPct.toFixed(2)}, yPct=${node.yPct.toFixed(2)}`;
    }

    // 视觉高亮：只更新 .dev-selected class（不整表重画，避免拖拽中闪烁）
    this.nodesLayer.querySelectorAll('.map-node.dev-selected').forEach((el) => {
      el.classList.remove('dev-selected');
    });
    const selEl = this.nodesLayer.querySelector(`.map-node[data-id="${id}"]`);
    selEl?.classList.add('dev-selected');
  }

  /**
   * 不刷新页面地退出拖拽模式：
   * 保留 localStorage 中已摆好的坐标，移除 dev UI，再重画节点以恢复正常点击进入场景。
   */
  private exitDevMode() {
    this.devMode = false;
    this.devSelectedId = null;
    this.root.classList.remove('devmode');
    this.devBarEl?.remove();
    this.devBarEl = undefined;
    this.devReadoutEl = undefined;
    this.tooltipEl.classList.remove('visible');
    if (this.editBtnEl) this.editBtnEl.style.display = '';    // 恢复"🛠 编辑节点"

    // drawNodes 会根据 devMode=false 重新绑定普通 click → onClickNode。
    this.drawNodes();

    // 清掉地址中的 ?mapdev=1，刷新/分享地址时也保持正常模式。
    const url = new URL(location.href);
    url.searchParams.delete('mapdev');
    history.replaceState(null, '', url);
    this.showToast('✓ 已退出编辑模式 · 现在可以点击浅水湾进入场景', 2600);
  }

  /**
   * 从正常模式进入 dev 编辑模式（不需要刷新页面）：
   * 加上 devmode class + 建工具栏 + 重绑节点交互（拖拽而不是导航）。
   * 也会同步更新 URL 加上 ?mapdev=1，方便刷新后保持在编辑模式。
   */
  private enterDevMode() {
    if (this.devMode) return;
    this.devMode = true;
    this.root.classList.add('devmode');
    if (this.editBtnEl) this.editBtnEl.style.display = 'none';   // 藏掉入口
    this.tooltipEl.classList.remove('visible');

    this.buildDevToolbar();      // 建底部工具栏（含默认选中第一个节点）
    this.drawNodes();             // 重画：绑 attachDevDrag 而不是 click

    const url = new URL(location.href);
    url.searchParams.set('mapdev', '1');
    history.replaceState(null, '', url);
    this.showToast('🛠 已进入编辑模式 · 拖动节点重定位，或点选后上传图标', 2400);
  }

  private nodeClasses(n: MapNode): string[] {
    const cls = ['map-node', `kind-${n.kind}`];
    if (!n.unlocked) cls.push('locked');
    if (n.requiresQuest && !questState.meetsRequirement(n.requiresQuest)) cls.push('quest-locked');
    if (canTravelTo(n) && (!n.requiresQuest || questState.meetsRequirement(n.requiresQuest))) cls.push('playable');
    if (n.id === this.currentNodeId) cls.push('current');
    return cls;
  }

  /* ────────────────────────────────────────────────────────────
     交互
     ──────────────────────────────────────────────────────────── */

  private onHover(n: MapNode) {
    this.hoverNodeId = n.id;
    const style = NODE_STYLE[n.kind];
    const isHere = n.id === this.currentNodeId;
    const questLocked = n.requiresQuest && !questState.meetsRequirement(n.requiresQuest);
    const questObjective = (n.id === 'shallow_bay' && questState.isActive('merchant_wreck'))
      ? '📋 委托目标 · 寻找漂流瓶'
      : null;
    const portReturn = n.portHub
      ? (isHere ? '▶ 你在这里 · 点击返回港口' : `▶ 可通行 · 返回港口 · 消耗 ${n.costAP} AP`)
      : null;
    const status =
      !n.unlocked        ? '🔒 未解锁'
      : questLocked      ? '📋 需先接受相关委托'
      : questObjective   ? `<span class="tt-ok">${questObjective}</span>`
      : portReturn       ? `<span class="tt-ok">${portReturn}</span>`
      : (canTravelTo(n) && isHere) ? `<span class="tt-ok">▶ 你在这里 · 点击开始（不消耗 AP）</span>`
      : canTravelTo(n)   ? `<span class="tt-ok">▶ 可通行 · 消耗 ${n.costAP} AP</span>`
      : '⚠️ 暂未开放';
    this.tooltipEl.innerHTML = `
      <div class="tt-header">
        <span class="tt-icon" style="color:${style.color}">${style.icon}</span>
        <span class="tt-name">${n.label}</span>
        <span class="tt-kind">${style.label}</span>
      </div>
      ${n.desc ? `<div class="tt-desc">${n.desc}</div>` : ''}
      <div class="tt-status">${status}</div>
    `;
    // Tooltip 位置：节点右上方，若靠右边则翻到左侧
    const rightSide = n.xPct > 70;
    const bottomSide = n.yPct < 20;
    this.tooltipEl.style.left = `${n.xPct}%`;
    this.tooltipEl.style.top  = `${n.yPct}%`;
    this.tooltipEl.classList.toggle('side-left', rightSide);
    this.tooltipEl.classList.toggle('side-bottom', bottomSide);
    this.tooltipEl.classList.add('visible');
  }

  private onUnhover(n: MapNode) {
    if (this.hoverNodeId === n.id) {
      this.tooltipEl.classList.remove('visible');
      this.hoverNodeId = null;
    }
  }

  private onClickNode(n: MapNode) {
    if (!n.unlocked) {
      this.showToast(`🔒 ${n.label} · 尚未解锁`);
      return;
    }
    if (n.requiresQuest && !questState.meetsRequirement(n.requiresQuest)) {
      this.showToast(`📋 ${n.label} · 需先在港口接受委托`);
      return;
    }
    if (!canTravelTo(n)) {
      this.showToast(`⚠️ ${n.label} · 此海域暂未开放`);
      return;
    }
    if (n.id === this.currentNodeId) {
      // 已在这个节点 —— 直接进钓鱼场景，不消耗 AP
      this.travelTo(n, 0);
      return;
    }
    if (!playerActionPoints.has(n.costAP)) {
      this.showToast(`⛵ 行动点不足 · 需要 ${n.costAP}，当前 ${playerActionPoints.ap}`);
      return;
    }
    this.travelTo(n, n.costAP);
  }

  /** 消耗 AP → fade 转场 → onTravel → hide */
  private travelTo(n: MapNode, cost: number) {
    if (cost > 0) playerActionPoints.spend(cost);
    this.setCurrentNode(n.id);
    // fade-out 300ms 后触发 onTravel + hide
    this.root.classList.add('fading-out');
    // 关闭 tooltip
    this.tooltipEl.classList.remove('visible');
    window.setTimeout(() => {
      // 选节点进海域：直接 hide，不走 onClose（否则会误触发回港口）
      this.hideImmediate();
      this.opts.onTravel(n.id, n);
    }, 320);
  }

  private toastTimer = 0;
  private showToast(msg: string, duration = 1800) {
    this.toastEl.innerHTML = msg;
    this.toastEl.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), duration);
  }

  /* ────────────────────────────────────────────────────────────
     样式
     ──────────────────────────────────────────────────────────── */
  private injectStyle() {
    if (document.getElementById('map-ui-style')) return;
    const s = document.createElement('style');
    s.id = 'map-ui-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

const STYLE = /* css */`
.map-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;                 /* 高于游戏与钓鱼 HUD (100)、背包 (200)，低于展示视频 (400) */
  display: none;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  opacity: 0;
  transition: opacity 0.28s ease;
  font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
  color: #eaeef2;
  user-select: none;
}
.map-overlay.visible {
  display: flex;
  opacity: 1;
}
.map-overlay.fading-out {
  opacity: 0;
}

/* 底图容器：width/height 由 JS updatePlateSize() 显式设为像素，
 * 严格按图片真实宽高比 letterbox 进 overlay 内 —— 保证 background 完全不拉伸不裁切，
 * 于是节点 xPct/yPct 就是图片本身的百分比坐标。
 */
.map-plate {
  position: relative;
  flex: none;                   /* 别让 flex 父级把它拉扁 */
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  background-color: #1a1614;    /* 底图没加载出来时的占位色 */
}

/* ── 顶部标题 + 关闭按钮 ── */
.map-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;         /* 底片不挡点击，只让子元素 auto */
}
.map-title {
  pointer-events: none;
  text-align: center;
  flex: 1;
  text-shadow: 0 2px 8px rgba(0,0,0,0.9);
}
.map-title-cn {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 12px;
  color: #f3d9a8;
  padding-left: 12px;           /* 让 letter-spacing 视觉居中 */
}
.map-title-en {
  font-size: 10px;
  letter-spacing: 4px;
  color: rgba(255, 216, 138, 0.55);
  margin-top: 2px;
}
.map-topbar-actions {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.map-close-btn {
  pointer-events: auto;
  width: 34px; height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(255, 216, 138, 0.5);
  background: rgba(20, 15, 10, 0.7);
  color: #f3d9a8;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
  backdrop-filter: blur(6px);
}
.map-close-btn:hover {
  background: rgba(80, 40, 20, 0.85);
  box-shadow: 0 0 12px rgba(255, 216, 138, 0.35);
}
.map-close-btn:active { transform: scale(0.94); }

.map-port-btn {
  pointer-events: auto;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(128, 192, 224, 0.45);
  background: rgba(20, 30, 50, 0.75);
  color: #a0c8e8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  backdrop-filter: blur(6px);
}
.map-port-btn:hover {
  background: rgba(40, 60, 90, 0.9);
  transform: scale(1.02);
}

/* "🛠 编辑节点" —— 正常模式进入 dev 编辑的入口 */
.map-edit-btn {
  pointer-events: auto;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 140, 26, 0.75);
  background: rgba(30, 20, 12, 0.8);
  color: #ffcc80;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 1px;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s, transform 0.1s;
  backdrop-filter: blur(6px);
}
.map-edit-btn:hover {
  background: rgba(80, 50, 20, 0.9);
  color: #ffdca8;
  box-shadow: 0 0 14px rgba(255, 140, 26, 0.5);
}
.map-edit-btn:active { transform: scale(0.96); }

/* ── 左上 HUD（AP + Bait） ── */
.map-hud {
  position: absolute;
  top: 60px;
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.map-hud-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(20, 15, 10, 0.72);
  border: 1px solid rgba(255, 216, 138, 0.35);
  border-radius: 999px;
  font-size: 13px;
  backdrop-filter: blur(8px);
  min-width: 140px;
}
.map-hud-icon { font-size: 16px; }
.map-hud-num  { font-size: 14px; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
.map-hud-num b {
  font-weight: 700; font-size: 16px; color: #f3d9a8; margin-right: 2px;
  transition: color 0.2s;
}
.map-hud-num b.low { color: #ff8060; }
.map-hud-label {
  margin-left: auto;
  font-size: 11px; letter-spacing: 2px;
  color: rgba(240, 217, 168, 0.6);
}

/* 节点热区层 —— 航路线由底图 world.png 自带，这里只放节点 */
.map-nodes {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  overflow: visible;
  pointer-events: none;
}

/* ── 自定义节点图标 ── */
.map-node.has-icon {
  /* 热区跟图标一样大，方便点 / 拖 */
  width: var(--icon-size, 56px);
  height: var(--icon-size, 56px);
}
.map-node .map-node-icon {
  position: absolute;
  left: 50%; top: 50%;
  width: var(--icon-size, 56px);
  height: var(--icon-size, 56px);
  transform: translate(-50%, -50%);
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
  transition: transform 0.15s ease, filter 0.15s ease;
}
/* 有自定义图标时：藏掉金圈 / ⛵ / 🔒 / id 标签，只留图标本身 */
.map-node.has-icon .map-node-ring,
.map-node.has-icon .map-node-me,
.map-node.has-icon .map-node-lock,
.map-overlay.devmode .map-node.has-icon .map-node-ring,
.map-overlay.devmode .map-node.has-icon .map-node-me,
.map-overlay.devmode .map-node.has-icon .map-node-lock,
.map-overlay.devmode .map-node.has-icon::after {
  display: none !important;
}

/* 有图标时的状态反馈全部落到图标本身上（不用 ring/boat/lock 元素） */
.map-node:hover .map-node-icon {
  transform: translate(-50%, -50%) scale(1.08);
  filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 6px rgba(255, 216, 138, 0.7));
}
/* 可玩节点（浅水湾）：图标常驻轻微呼吸，替代原来的呼吸圈 */
.map-node.has-icon.playable .map-node-icon {
  animation: iconPulse 2.0s ease-in-out infinite;
}
@keyframes iconPulse {
  0%, 100% { filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7)); }
  50%      { filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 14px rgba(255, 216, 138, 0.85)); }
}
/* 当前所在节点：图标常驻金色发光 */
.map-node.has-icon.current .map-node-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 12px rgba(255, 216, 138, 0.9));
}
.map-node.has-icon.current:hover .map-node-icon {
  filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 18px rgba(255, 216, 138, 1));
}

/* ── 节点：透明可点热区 —— 底图 world.png 上的手绘节点保持 100% 可见 ── */
/* 设计哲学：
 *   · 默认几乎不可见 —— 只有 playable（浅水湾）显示常驻脉冲圈引导视线
 *   · Hover 时：环上有一个高亮圈 + 顶部悬浮 tooltip
 *   · 未解锁节点 hover 时才出现 🔒 图标
 *   · 当前所在节点：常驻一枚小船 ⛵，浮在圆圈上方不遮挡下面的画
 *   → 玩家永远看到的是你 P1 底图本身，而不是被 UI 盖住的另一张地图
 */
.map-node {
  --node-color: #ffd88a;
  --ring-size: 46px;              /* hitbox 圆直径 —— 视觉热区大小 */
  position: absolute;
  width: var(--ring-size);
  height: var(--ring-size);
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  outline: none;
  font-family: inherit;
  color: inherit;
}
.map-node:hover { z-index: 3; }

/* 高亮圈：hover 才淡入 */
.map-node-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--node-color);
  box-shadow:
    0 0 22px rgba(255, 216, 138, 0.65),
    0 0 0 1px rgba(0, 0, 0, 0.4) inset;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
}
.map-node:hover .map-node-ring,
.map-node:focus-visible .map-node-ring {
  opacity: 0.95;
  transform: scale(1.0);
}

/* Playable（浅水湾）—— 常驻呼吸圈，一眼就知道"这里能进" */
.map-node.playable .map-node-ring {
  opacity: 0.65;
  animation: nodePulseRing 1.8s ease-in-out infinite;
}
.map-node.playable:hover .map-node-ring {
  opacity: 1;
  animation-play-state: paused;
}
@keyframes nodePulseRing {
  0%, 100% {
    opacity: 0.55;
    transform: scale(0.92);
    box-shadow: 0 0 12px rgba(255, 216, 138, 0.35), 0 0 0 1px rgba(0,0,0,0.4) inset;
  }
  50% {
    opacity: 0.95;
    transform: scale(1.08);
    box-shadow: 0 0 32px rgba(255, 216, 138, 0.85), 0 0 0 1px rgba(0,0,0,0.4) inset;
  }
}

/* 未解锁：hover 时出现的 🔒 —— 底图上不加任何常驻标记 */
.map-node.locked .map-node-ring {
  border-color: rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.75);
}
.map-node-lock {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%) scale(0.85);
  font-size: 20px;
  opacity: 0;
  pointer-events: none;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.map-node:hover .map-node-lock {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1.0);
}

/* 当前所在节点：金色圈 + 顶部悬浮的小船，不盖住底图上的名字 */
.map-node.current .map-node-ring {
  opacity: 0.9;
  transform: scale(1.0);
  border-color: #ffd88a;
  border-width: 2.5px;
  animation: none;
  box-shadow:
    0 0 24px rgba(255, 216, 138, 0.75),
    0 0 0 1px rgba(0, 0, 0, 0.55) inset;
}
.map-node-me {
  position: absolute;
  left: 50%;
  bottom: 100%;
  margin-bottom: 6px;
  transform: translateX(-50%);
  font-size: 22px;
  pointer-events: none;
  text-shadow: 0 2px 5px rgba(0, 0, 0, 0.85);
  animation: mapBoatBob 2.2s ease-in-out infinite;
}
@keyframes mapBoatBob {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50%      { transform: translateX(-50%) translateY(-4px); }
}

/* 键盘 focus 增强 —— 视觉上等同 hover */
.map-node:focus-visible .map-node-ring {
  border-color: #ffd88a;
  box-shadow:
    0 0 24px rgba(255, 216, 138, 0.85),
    0 0 0 2px rgba(255, 216, 138, 0.6) inset;
}

/* ── Tooltip ── */
.map-tooltip {
  position: absolute;
  transform: translate(24px, -50%);     /* 默认：节点右侧 */
  min-width: 200px;
  max-width: 260px;
  padding: 12px 14px;
  background: rgba(15, 11, 7, 0.94);
  border: 1px solid rgba(255, 216, 138, 0.55);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 5;
  font-size: 12px;
}
.map-tooltip.visible { opacity: 1; }
.map-tooltip.side-left  { transform: translate(calc(-100% - 24px), -50%); }
.map-tooltip.side-bottom { transform: translate(24px, 24px); }
.map-tooltip.side-bottom.side-left { transform: translate(calc(-100% - 24px), 24px); }
.tt-header {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid rgba(255, 216, 138, 0.2);
}
.tt-icon { font-size: 16px; }
.tt-name { font-size: 14px; font-weight: 700; color: #f3d9a8; letter-spacing: 1px; }
.tt-kind { margin-left: auto; font-size: 10px; letter-spacing: 1.5px; color: rgba(240, 217, 168, 0.6); }
.tt-desc { color: #c8bda5; line-height: 1.5; margin-bottom: 6px; }
.tt-status { font-size: 12px; color: #a89078; }
.tt-status .tt-ok { color: #a8e0a8; font-weight: 600; }

/* ── Toast（点击反馈） ── */
.map-toast {
  position: absolute;
  left: 50%; bottom: 60px;
  transform: translate(-50%, 20px);
  padding: 12px 22px;
  background: rgba(15, 11, 7, 0.94);
  border: 1px solid rgba(255, 216, 138, 0.55);
  border-radius: 999px;
  font-size: 13px;
  color: #f5efd8;
  opacity: 0;
  pointer-events: none;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  transition: opacity 0.2s ease, transform 0.2s ease;
  white-space: nowrap;
  z-index: 6;
}
.map-toast.visible {
  opacity: 1;
  transform: translate(-50%, 0);
}

/* ── Dev 编辑模式：底部工具栏（两行） ── */
.map-devbar {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(20, 15, 10, 0.94);
  border: 1.5px solid #ff8c1a;
  border-radius: 10px;
  color: #ffe4b5;
  font-size: 12px;
  font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.7);
  z-index: 20;
  max-width: 96%;
}
.map-devbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.map-devbar-spacer { flex: 1; }
.map-devbar-badge {
  padding: 3px 8px;
  background: #ff8c1a;
  color: #201306;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 1px;
  font-size: 11px;
  flex: none;
}
.map-devbar-readout {
  min-width: 260px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  color: #f0e5d0;
  padding: 0 6px;
  flex: 1;
}
.map-devbar-label {
  color: #f0e5d0;
  font-size: 12px;
}
.map-devbar-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #f0e5d0;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.map-devbar-checkbox input { accent-color: #ff8c1a; cursor: pointer; }
.map-devbar-btn.debg {
  background: rgba(120, 160, 220, 0.3);
  border-color: rgba(150, 190, 240, 0.65);
  color: #d0e5ff;
}
.map-devbar-btn.debg:hover:not(:disabled) {
  background: rgba(120, 170, 240, 0.5);
  color: #fff;
}
.map-devbar-select {
  background: rgba(30, 22, 14, 0.9);
  border: 1px solid rgba(255, 216, 138, 0.4);
  color: #ffe4b5;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  min-width: 160px;
}
.map-devbar-slider-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(30, 22, 14, 0.75);
  border-radius: 4px;
  color: #f0e5d0;
  font-size: 11px;
}
.map-devbar-slider {
  width: 120px;
  accent-color: #ff8c1a;
}
.map-devbar-slider:disabled { opacity: 0.4; }
.map-devbar-slider-val { min-width: 80px; text-align: right; color: #ffcc80; }
.map-devbar-btn {
  background: rgba(255, 216, 138, 0.15);
  border: 1px solid rgba(255, 216, 138, 0.55);
  color: #ffe4b5;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.15s;
}
.map-devbar-btn:hover  { background: rgba(255, 216, 138, 0.35); color: #fff; }
.map-devbar-btn:active { transform: translateY(1px); }
.map-devbar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.map-devbar-btn.upload {
  background: rgba(80, 130, 200, 0.35);
  border-color: rgba(150, 190, 240, 0.7);
  color: #d0e5ff;
}
.map-devbar-btn.upload:hover { background: rgba(90, 150, 230, 0.55); color: #fff; }
.map-devbar-btn.clear-icon,
.map-devbar-btn.clear-all,
.map-devbar-btn.reset {
  border-color: rgba(255, 120, 100, 0.6);
  color: #ffb0a0;
}
.map-devbar-btn.clear-icon:hover,
.map-devbar-btn.clear-all:hover,
.map-devbar-btn.reset:hover { background: rgba(255, 100, 80, 0.25); color: #fff; }
.map-devbar-btn.done {
  border-color: rgba(110, 195, 122, 0.9);
  background: rgba(74, 154, 86, 0.72);
  color: #f4fff0;
}
.map-devbar-btn.done:hover {
  background: rgba(74, 174, 92, 0.95);
  box-shadow: 0 0 14px rgba(110, 195, 122, 0.55);
}

/* Dev 模式下：所有节点热区可见（虚线圈 + id 小标签），方便一次找到全部节点 */
.map-overlay.devmode .map-node .map-node-ring {
  opacity: 0.55;
  transform: scale(1.0);
  border-style: dashed;
  border-color: #ff8c1a;
  animation: none;
  box-shadow: 0 0 12px rgba(255, 140, 26, 0.4);
}
.map-overlay.devmode .map-node:hover .map-node-ring {
  opacity: 1;
  border-color: #ffd88a;
  border-style: solid;
  box-shadow: 0 0 24px rgba(255, 216, 138, 0.9);
}
.map-overlay.devmode .map-node::after {
  content: attr(data-id);
  position: absolute;
  left: 50%; top: 100%;
  transform: translate(-50%, 4px);
  font-size: 10px;
  color: #ffcc80;
  padding: 1px 5px;
  background: rgba(20, 15, 10, 0.9);
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
}
.map-overlay.devmode .map-node.dragging {
  cursor: grabbing !important;
  z-index: 10;
}
.map-overlay.devmode .map-node.dragging .map-node-ring {
  border-color: #6ec37a;
  border-style: solid;
  opacity: 1;
  box-shadow: 0 0 28px rgba(110, 195, 122, 0.9);
}
.map-overlay.devmode .map-node { cursor: grab; }

/* dev 模式下：被选中的节点用亮蓝色描边区分（跟拖拽绿、hover 金错开） */
.map-overlay.devmode .map-node.dev-selected .map-node-ring {
  border-color: #7ec8ff;
  border-style: solid;
  opacity: 1;
  box-shadow: 0 0 20px rgba(126, 200, 255, 0.85);
}
.map-overlay.devmode .map-node.dev-selected::after {
  color: #7ec8ff;
  background: rgba(20, 30, 45, 0.95);
}
`;
