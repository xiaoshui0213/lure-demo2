/**
 * 鱼类形状库 —— Dredge 风格的不规则格子背包核心数据。
 *
 * 每种鱼有一个二值矩阵 `shape`，1 表示占格，0 表示空。矩阵原点在左上角，
 * 玩家在背包里放置鱼时，此矩阵会绕原点顺时针旋转 0/90/180/270 度。
 *
 * 稀有度/价值只是先占位，未来做售卖 / 图鉴时会用到；跟摆放几何无关。
 */

export type ShapeMatrix = number[][];    // [row][col]

export interface FishDef {
  /** 与 FishingGame FISH_PRESETS 对应的 id（用相同 key） */
  id: string;
  /** 中文名 */
  name: string;
  /** 稀有度：common / uncommon / rare / epic */
  tier: 'common' | 'uncommon' | 'rare' | 'epic';
  /** 售卖基础价（单位：金币，先占位） */
  basePrice: number;
  /** 形状矩阵，1 = 占格；矩阵中排在最前面的格是"头"，最后的是"尾" */
  shape: ShapeMatrix;
  /** 鱼身主色（会在此基础上做上浅下深的渐变，形成体积感） */
  color: string;
  /** 图标（emoji 或短字符，画在头部作为辅助辨识；SVG 鱼绘制不依赖此项） */
  icon: string;
}

/*
 * 鱼形状设计原则（参考渔帆暗涌）：
 *   - 小鱼：直线 2-3 格（占地少，好塞角落）
 *   - 中鱼：S 弯 / L 弯（挑战玩家的空间规划）
 *   - 大鱼：4 格以上 + 折角（占好几行，逼玩家权衡）
 *   矩阵里"读顺序第一格 = 鱼头"，"最后一格 = 鱼尾"。
 *   绘制时会在头位置画眼、尾位置画尾鳍，中间格画背/腹鳍与斑纹。
 */
export const FISH_LIBRARY: Record<string, FishDef> = {
  /* ── 青鳞鱼：小型直线鱼（1×2） ── */
  common: {
    id: 'common',
    name: '青鳞鱼',
    tier: 'common',
    basePrice: 12,
    shape: [
      [1, 1],
    ],
    color: '#5f7f95',
    icon: '🐟',
  },

  /* ── 巨眼鱼：中型 S 弯（更像真鱼的扭身姿态） ── */
  medium: {
    id: 'medium',
    name: '巨眼鱼',
    tier: 'uncommon',
    basePrice: 32,
    shape: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    color: '#b28550',
    icon: '🐠',
  },

  /* ── 深海鲈：长直 4 格 —— 又长又难塞 ── */
  large: {
    id: 'large',
    name: '深海鲈',
    tier: 'rare',
    basePrice: 65,
    shape: [
      [1, 1, 1, 1],
    ],
    color: '#5c7043',
    icon: '🐡',
  },

  /* ── 锤头鲨：宽头 T 形（3+1） ── */
  tShape: {
    id: 'tShape',
    name: '锤头鲨',
    tier: 'rare',
    basePrice: 88,
    shape: [
      [1, 1, 1],
      [0, 1, 0],
    ],
    color: '#6f7d84',
    icon: '🦈',
  },

  /* ── 海龟：2×2 方块 —— 圆胖的例外 ── */
  block: {
    id: 'block',
    name: '海龟',
    tier: 'epic',
    basePrice: 120,
    shape: [
      [1, 1],
      [1, 1],
    ],
    color: '#4d8d63',
    icon: '🐢',
  },
};

/* ────────────────────────────────────────────────────────────
   形状工具函数
   ──────────────────────────────────────────────────────────── */

/** 顺时针旋转 90° */
export function rotateCW(m: ShapeMatrix): ShapeMatrix {
  const rows = m.length;
  const cols = m[0].length;
  const out: ShapeMatrix = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[c][rows - 1 - r] = m[r][c];
    }
  }
  return out;
}

/** 对形状旋转 n × 90°（n=0/1/2/3） */
export function rotateN(m: ShapeMatrix, n: number): ShapeMatrix {
  const k = ((n % 4) + 4) % 4;
  let cur = m;
  for (let i = 0; i < k; i++) cur = rotateCW(cur);
  return cur;
}

/** 拿到形状的所有占格坐标 (col, row) 相对左上角，按读顺序（行优先） */
export function shapeCells(m: ShapeMatrix): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) out.push([c, r]);
    }
  }
  return out;
}

/** 形状占几格 */
export function shapeSize(m: ShapeMatrix): number {
  let n = 0;
  for (const row of m) for (const v of row) if (v) n++;
  return n;
}

/* ────────────────────────────────────────────────────────────
   颜色工具（在鱼绘制里用）
   ──────────────────────────────────────────────────────────── */

/** 亮度偏移一个 hex 色（amount 是每通道 -255..+255 的偏移） */
export function shadeHex(hex: string, amount: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  const shift = (v: number) => Math.max(0, Math.min(255, v + amount));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(shift(r))}${toHex(shift(g))}${toHex(shift(b))}`;
}
