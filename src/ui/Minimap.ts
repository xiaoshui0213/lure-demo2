import type { FishingZone } from '../proto/main';
import type { HookType, MinimapMarker } from '../proto/FishingHooks';

/**
 * Minimap —— 右下角 160×160 顶视图小地图
 *
 * 显示内容：
 *   · 半透明背景框
 *   · 钓鱼海域：按 tier 上色的圆
 *   · 港口补给：金色小方块
 *   · 鲨鱼鳍钩子：紫色小三角
 *   · 漂流瓶钩子：绿色小方块
 *   · 玩家船：白色三角，朝向 = boatHeading
 *
 * 中心=船，视野 = ±90m（可调）—— 相当于"跟随船的雷达视图"。
 * 玩家可以按 M 键在两种缩放间切换（跟随视 / 概览视 —— 后者尚未实现，仅占位）。
 */

const MAP_SIZE = 160;   // 边长（px）
const VIEW_RANGE = 90;  // 中心到边缘对应的世界距离（m）
const HALF = MAP_SIZE / 2;

const ZONE_COLOR: Record<'common' | 'rare' | 'lair', string> = {
  common: '#4dd0ff',
  rare: '#7d9bff',
  lair: '#c060ff',
};

const HOOK_COLOR: Record<HookType, string> = {
  ripple: 'transparent',
  bubble: 'transparent',
  drift_bottle: '#7bd979',
  shark_fin: '#c96ce6',
};

interface PortMarker {
  x: number;
  z: number;
  radius: number;
}

interface DrawInput {
  boatX: number;
  boatZ: number;
  /** 船的 y 旋转（弧度），rotation.y —— 用来画船头三角 */
  boatHeading: number;
  zones: FishingZone[];
  ports: PortMarker[];
  hooks: MinimapMarker[];
}

export class Minimap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  /** container 默认 document.body；传入 #stage 可让小地图被限制在 16:9 游戏画幅内 */
  constructor(container?: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'minimap-root';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = MAP_SIZE * this.dpr;
    this.canvas.height = MAP_SIZE * this.dpr;
    this.canvas.style.width = MAP_SIZE + 'px';
    this.canvas.style.height = MAP_SIZE + 'px';
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(this.dpr, this.dpr);

    (container ?? document.body).appendChild(this.root);
    this.injectStyle();
  }

  dispose() {
    this.root.remove();
  }

  draw(input: DrawInput) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    // 背景：柔和深蓝
    ctx.fillStyle = 'rgba(14, 24, 40, 0.85)';
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF - 1, 0, Math.PI * 2);
    ctx.fill();

    // 内环 & 十字准星（相当于罗盘）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF * 0.33, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(HALF, 6); ctx.lineTo(HALF, MAP_SIZE - 6);
    ctx.moveTo(6, HALF); ctx.lineTo(MAP_SIZE - 6, HALF);
    ctx.stroke();

    // 世界 → minimap 坐标（船在中心）
    const scale = HALF / VIEW_RANGE;
    const worldToMap = (wx: number, wz: number): [number, number] => {
      const dx = wx - input.boatX;
      const dz = wz - input.boatZ;
      return [HALF + dx * scale, HALF + dz * scale];
    };
    // 判断某世界坐标是否可能出现在圆形 minimap 内（含半径 buffer）
    const inRange = (wx: number, wz: number, extraR = 0): boolean => {
      const dx = wx - input.boatX;
      const dz = wz - input.boatZ;
      const d2 = dx * dx + dz * dz;
      const R = VIEW_RANGE + extraR;
      return d2 <= R * R;
    };

    // 用圆形 clip 限制绘制范围（超出的都不画）
    ctx.save();
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF - 2, 0, Math.PI * 2);
    ctx.clip();

    // ── 钓鱼海域 ──
    for (const z of input.zones) {
      if (!inRange(z.x, z.z, z.radius)) continue;
      const [px, py] = worldToMap(z.x, z.z);
      const r = z.radius * scale;
      const color = ZONE_COLOR[z.tier];
      // 填充：半透明
      ctx.fillStyle = hexToRgba(color, 0.20);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      // 描边
      ctx.strokeStyle = hexToRgba(color, 0.85);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Tier 图标（很小的字母）
      if (z.tier !== 'common' && r > 8) {
        ctx.fillStyle = color;
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.tier === 'rare' ? '★' : '☠', px, py);
      }
    }

    // ── 港口补给 ──
    for (const p of input.ports) {
      if (!inRange(p.x, p.z, p.radius)) continue;
      const [px, py] = worldToMap(p.x, p.z);
      // 圈
      ctx.fillStyle = 'rgba(255, 200, 80, 0.20)';
      ctx.beginPath();
      ctx.arc(px, py, p.radius * scale, 0, Math.PI * 2);
      ctx.fill();
      // 中心金色小方块
      ctx.fillStyle = '#ffcc55';
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.strokeStyle = '#8a5c0a';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 3, py - 3, 6, 6);
    }

    // ── 钩子标记 ──
    for (const h of input.hooks) {
      if (!inRange(h.x, h.z)) continue;
      const [px, py] = worldToMap(h.x, h.z);
      if (h.type === 'shark_fin') {
        // 紫色三角（尖头指北，仅装饰）
        ctx.fillStyle = HOOK_COLOR.shark_fin;
        ctx.beginPath();
        ctx.moveTo(px, py - 4);
        ctx.lineTo(px - 3.5, py + 3);
        ctx.lineTo(px + 3.5, py + 3);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (h.type === 'drift_bottle') {
        ctx.fillStyle = HOOK_COLOR.drift_bottle;
        ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 2.5, py - 2.5, 5, 5);
      }
      // ripple / bubble 不在 minimap 上显示（太密）
    }

    // ── 玩家船 —— 永远在中心 ──
    ctx.save();
    ctx.translate(HALF, HALF);
    // Three.js Y 轴 rotation 是绕 Y（世界 up），船头 -X 方向前进（沿用 main.ts 里的约定）
    // main 里 forward = (cos(h), -sin(h))；转换到 minimap 平面：yaw = -h - PI/2 让三角顶点朝上
    ctx.rotate(-input.boatHeading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-5, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.restore();  // 撤销 clip

    // 外圈亮环 —— 让 minimap 边缘清晰
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(HALF, HALF, HALF - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  private injectStyle() {
    if (document.getElementById('minimap-style')) return;
    const s = document.createElement('style');
    s.id = 'minimap-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

const STYLE = /* css */`
.minimap-root {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 90;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.10) inset;
  pointer-events: none;
}
.minimap-canvas {
  display: block;
}
`;

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
