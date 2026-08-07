import type { PaletteRemap } from '../editor/loadGLTF';

/**
 * 参考图配色（v5 · "浅卡其沙滩 · 明亮饱和绿"）
 *
 * 【视觉目标】
 * · 沙 / 岩石 三档全部落在"浅卡其"色系，最深也不会成褐色
 * · 草叶三档都是饱和明亮的黄绿系
 * · 阴影档提亮到 palette 里的实际色，只靠 shading 略微降饱和/降亮
 *
 * 【与 v4 对比】
 * · 阴影档从 #cba57c 拉到 #dcbe93 —— 不再是发脏的中棕
 * · 中沙从 #ecd0a4 拉到 #f0d8a8 —— 正统浅卡其
 * · 亮沙保持奶白 #f9ecc9
 * · 深绿从 #6bc233 拉到 #8fd63e —— 饱和度上抬
 * · 中绿 #a5df4e 保持
 * · 嫩叶 #c4ec7b 保持
 *
 * 【分类】按 baseColor 的 HSL：
 *   · 暖色系 (H 340°..60°) → 岩石/沙 3 档
 *   · 冷色系 (H 60°..160°) → 苔藓/草/叶 3 档
 *   · 近灰 (Sat < 0.12) → 兜底到岩石 2 档
 */
export const REFERENCE_ISLAND_PALETTE: PaletteRemap = [
  /* ── 木材（暖 + 高饱和 + 中低亮度）—— 树干、木箱、码头板等 ── */
  // 顺序必须在 sand 之前，否则树干会被 sand shadow 抢走
  {
    hue: [15, 45], lightness: [0, 0.30], saturation: [0.35, 1.0],
    color: '#7a4f2b',            // 参考图树干色（暖深棕）
    name: 'wood dark trunk',
  },
  {
    hue: [15, 45], lightness: [0.30, 0.50], saturation: [0.35, 1.0],
    color: '#a06b3d',            // 中亮木色（板材/桶）
    name: 'wood mid plank',
  },

  /* ── 暖色系（红橙 340°..60°）→ 岩石 / 沙 —— 保持亮度、拉暖黄饱和 ── */
  {
    hue: [340, 60], lightness: [0, 0.30],
    color: '#f0c880',            // 阴影档：暖蜜黄（不再灰白）
    name: 'sand shadow',
  },
  {
    hue: [340, 60], lightness: [0.30, 0.55],
    color: '#f8dba0',            // 主色：饱和奶黄
    name: 'sand mid',
  },
  {
    hue: [340, 60], lightness: [0.55, 1.0],
    color: '#fdeabf',            // 亮档：仍偏黄的奶白
    name: 'sand bright',
  },

  /* ── 冷色系（黄绿 60°..160°）→ 草 / 苔 / 叶 —— 饱和度上抬 ── */
  {
    hue: [60, 160], lightness: [0, 0.30],
    color: '#6ec914',            // 深绿：饱和翠青
    name: 'grass deep',
  },
  {
    hue: [60, 160], lightness: [0.30, 0.55],
    color: '#88d924',            // 中绿：饱和黄绿
    name: 'grass mid',
  },
  {
    hue: [60, 160], lightness: [0.55, 1.0],
    color: '#b3e848',            // 亮叶：饱和嫩黄绿
    name: 'leaves bright',
  },

  /* ── 灰色兜底 → 沙 2 档 ── */
  { saturation: [0, 0.12], lightness: [0, 0.4], color: '#f0c880', name: 'gray → sand shadow' },
  { saturation: [0, 0.12], lightness: [0.4, 1.0], color: '#f8dba0', name: 'gray → sand mid' },
];
