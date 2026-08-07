/**
 * mapNodes —— 航海地图 P1 上所有可点击节点的静态数据
 *
 * 设计：
 *   · 底图 (public/maps/world.png) 是一张 16:9 的完整插画，不做像素级拆分。
 *   · 每个节点只存 (xPct, yPct)（相对底图的百分比），MapUI 会把它转成 CSS `left/top`。
 *   · 想微调坐标：在 MapUI 里开着 dev 模式（url ?mapdev=1），
 *     鼠标点空白处即可在 console 打印当前 %，再回来改这里的数字。
 *
 * MVP 阶段：只有 `shallow_bay` (浅水湾) 是 playable。
 * 其它节点都是"可点但未开放"，点击弹 toast、不消耗 AP。
 * 后续开新海域，只需要把对应节点的 `playable` 置 true、给 `sceneKey` 即可。
 */

export type NodeKind =
  | 'port'          // 港口（补给鱼饵、进入商店 —— MVP 仅显示，不实现补给）
  | 'fishing_zone'  // 钓鱼海域 —— 点击进入试玩场景
  | 'boss'          // Boss 巢穴
  | 'story'         // 剧情/结构性节点（旧码头、灯塔废墟 etc.）
  | 'hazard';       // 危险区（漩涡、海沟）

export interface MapNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** 相对底图的百分比坐标（左上角为 0,0，右下角为 100,100） */
  xPct: number;
  yPct: number;
  /** 通行消耗的行动点 */
  costAP: number;
  /** 节点是否已解锁（未解锁显示锁 icon，点击弹 toast） */
  unlocked?: boolean;
  /** MVP：仅浅水湾 true —— true 表示"点击后跳转到试玩场景" */
  playable?: boolean;
  /** 跳转时带给 prototype 场景加载器的场景 key（未来用于分海域场景） */
  sceneKey?: string;
  /** 白天冒险节点 key（有值则进入视频探险，而非钓鱼场景） */
  expeditionKey?: string;
  /** 需要已接受/进行中的委托 id 才能进入 */
  requiresQuest?: string;
  /** 点击后进入港口 Hub（平洛镇等），而非 3D 试玩场景 */
  portHub?: boolean;
  /** 悬停 tooltip 上显示的一句话简介 */
  desc?: string;
}

export interface MapEdge {
  from: string;
  to: string;
}

/* ────────────────────────────────────────────────────────────
   节点数据 —— 坐标按 P1 底图 eyeball，实际部署时可用 dev 模式微调。
   ──────────────────────────────────────────────────────────── */
/*
 * 坐标按最新一版 world.png（P2 手绘航海地图）上每个图标的中心 eye-ball 得到。
 * 如果哪个节点位置对不齐，最简单：url 加 ?mapdev=1 → 点空白处 console 打印百分比 → 回来改这里。
 */
export const MAP_NODES: MapNode[] = [
  // ── 上排（近岸） ─────────────────────────────────────────────
  {
    id: 'shallow_bay',
    label: '浅水湾',
    kind: 'fishing_zone',
    xPct: 12.0, yPct: 19.0,          // 底图左上角的锚
    costAP: 1,
    unlocked: true,
    playable: true,                  // ← MVP 唯一可玩的海域
    sceneKey: 'shallow_bay',
    desc: '风平浪静的初始海域，杂鱼繁多，适合练习抛竿。',
  },
  {
    id: 'pingzhi_town',
    label: '平洛镇',
    kind: 'port',
    xPct: 35.5, yPct: 6.0,           // 顶部大六角塔
    costAP: 1,
    unlocked: true,
    playable: true,
    portHub: true,
    desc: '主城港口 —— 补给鱼饵、接受委托、整理渔获。',
  },
  {
    id: 'old_pier',
    label: '旧码头',
    kind: 'story',
    xPct: 41.5, yPct: 22.0,          // 平治镇下方的中六角塔
    costAP: 1,
    unlocked: true,
  },
  {
    id: 'north_reef_island',
    label: '北礁岛',
    kind: 'story',
    xPct: 46.0, yPct: 37.0,          // 旧码头下方的更大塔
    costAP: 1,
    unlocked: true,
  },
  {
    id: 'shallow_reef_point',
    label: '浅滩礁点',
    kind: 'fishing_zone',
    xPct: 55.0, yPct: 16.0,          // 中间偏上的小六角塔
    costAP: 1,
    unlocked: true,
    desc: '礁石密布的浅海，隐藏了不少中体型鱼类（暂未开放）。',
  },
  {
    id: 'sea_spider_reef',
    label: '海蜘礁',
    kind: 'fishing_zone',
    xPct: 70.5, yPct: 6.0,           // 顶部右侧的六角塔
    costAP: 2,
    unlocked: true,
    desc: '据说有蟹类大鱼出没（暂未开放）。',
  },
  {
    id: 'lighthouse_ruins_a',
    label: '灯塔废墟',
    kind: 'story',
    xPct: 68.5, yPct: 22.0,          // 一对灯塔中偏左那个
    costAP: 2,
    unlocked: false,
  },
  {
    id: 'lighthouse_ruins_b',
    label: '灯塔废墟',
    kind: 'story',
    xPct: 84.0, yPct: 10.5,          // 最右上角单独的灯塔
    costAP: 2,
    unlocked: false,
  },

  // ── 中排 ────────────────────────────────────────────────────
  {
    id: 'channel_junction',
    label: '航道岔口',
    kind: 'story',
    xPct: 8.0, yPct: 30.5,           // 浅水湾下方的箱子
    costAP: 1,
    unlocked: false,
  },
  {
    id: 'shipwreck_cemetery',
    label: '沉船墓地',
    kind: 'fishing_zone',
    xPct: 24.0, yPct: 40.5,          // 带锁链的锁头
    costAP: 2,
    unlocked: false,
    desc: '沉船残骸中藏着深海鱼类，需专用鱼饵。',
  },
  {
    id: 'undercurrent_area',
    label: '暗流区',
    kind: 'hazard',
    xPct: 39.0, yPct: 54.0,          // 中间下方带锁链的锁头
    costAP: 2,
    unlocked: false,
  },
  {
    id: 'monster_nest',
    label: '怪物巢穴',
    kind: 'fishing_zone',
    xPct: 55.0, yPct: 52.5,          // 中间偏右的黑色堡垒
    costAP: 3,
    unlocked: false,
    desc: '巨型鱼类的领地。',
  },
  {
    id: 'mist_ring',
    label: '迷雾环',
    kind: 'hazard',
    xPct: 81.0, yPct: 42.5,          // 右侧漩涡
    costAP: 2,
    unlocked: false,
  },
  {
    id: 'mutation_zone',
    label: '异化场域',
    kind: 'fishing_zone',
    xPct: 90.5, yPct: 62.0,          // 最右下的岛+锁头
    costAP: 3,
    unlocked: false,
    desc: '变异生物出没之地。',
  },

  // ── 下排（深海） ─────────────────────────────────────────────
  {
    id: 'sea_trench',
    label: '海沟',
    kind: 'hazard',
    xPct: 12.0, yPct: 61.5,          // 左下的漩涡
    costAP: 2,
    unlocked: false,
  },
  {
    id: 'abyss_entrance',
    label: '深渊入口',
    kind: 'story',
    xPct: 19.0, yPct: 81.5,          // 左下角锁头
    costAP: 3,
    unlocked: false,
  },
  {
    id: 'whirlpool',
    label: '漩涡',
    kind: 'hazard',
    xPct: 44.5, yPct: 79.0,          // 底部大漩涡
    costAP: 3,
    unlocked: false,
  },
  {
    id: 'boss_nest',
    label: 'Boss 巢穴',
    kind: 'boss',
    xPct: 65.0, yPct: 87.0,          // 底部带火焰的堡垒
    costAP: 4,
    unlocked: false,
    desc: '深渊的主宰之地。',
  },
];

/* ────────────────────────────────────────────────────────────
   连线数据 —— 用 SVG 画出可通行的航路（先做视觉，MVP 不做寻路）
   ──────────────────────────────────────────────────────────── */
const RAW_EDGES: Array<[string, string]> = [
  // 顶部主航道
  ['shallow_bay', 'pingzhi_town'],
  ['pingzhi_town', 'old_pier'],
  ['old_pier', 'shallow_reef_point'],
  ['shallow_reef_point', 'sea_spider_reef'],
  ['sea_spider_reef', 'lighthouse_ruins_b'],
  ['shallow_reef_point', 'lighthouse_ruins_a'],
  ['lighthouse_ruins_a', 'monster_nest'],

  // 港口 → 附近的礁石与码头
  ['old_pier', 'north_reef_island'],
  ['north_reef_island', 'undercurrent_area'],

  // 岔口分支
  ['shallow_bay', 'channel_junction'],
  ['channel_junction', 'shipwreck_cemetery'],
  ['shipwreck_cemetery', 'undercurrent_area'],
  ['undercurrent_area', 'monster_nest'],

  // 右上向下延伸
  ['lighthouse_ruins_b', 'mist_ring'],
  ['mist_ring', 'mutation_zone'],
  ['mist_ring', 'monster_nest'],

  // 下排深海
  ['channel_junction', 'sea_trench'],
  ['sea_trench', 'abyss_entrance'],
  ['abyss_entrance', 'whirlpool'],
  ['whirlpool', 'boss_nest'],
  ['boss_nest', 'monster_nest'],
];

export const MAP_EDGES: MapEdge[] = RAW_EDGES.map(([from, to]) => ({ from, to }));

/** 按 id 找节点 —— MapUI 里用 */
export function findNode(id: string): MapNode | undefined {
  return MAP_NODES.find((n) => n.id === id);
}

/** 节点是否可以点击进入游戏（unlocked + playable + 有 sceneKey / expeditionKey / portHub） */
export function canTravelTo(node: MapNode): boolean {
  if (!node.unlocked || !node.playable) return false;
  if (node.expeditionKey) return true;
  if (node.portHub) return true;
  return !!node.sceneKey;
}

/* ────────────────────────────────────────────────────────────
   自定义坐标持久化 —— dev 拖拽模式下用
   ────────────────────────────────────────────────────────────
   工作流：
     1. url 加 ?mapdev=1，进入拖拽编辑模式
     2. 拖动任何节点 → 新坐标存 localStorage
     3. 页面刷新 / 重开 → 自动读回覆盖 MAP_NODES 里代码写死的坐标
     4. 满意后点"导出坐标" → 把新坐标数组复制到剪贴板 →
        粘回本文件 MAP_NODES 里对应项，就 lock-in 到代码里了
     5. 想清空自定义、回到代码默认：dev 工具栏 → "重置到代码默认"
*/

const CUSTOM_COORDS_KEY = 'lure-map-node-coords-v1';

export type CustomCoords = Record<string, { xPct: number; yPct: number }>;

export function loadCustomCoords(): CustomCoords {
  try {
    const raw = localStorage.getItem(CUSTOM_COORDS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data as CustomCoords;
  } catch { /* ignore */ }
  return {};
}

export function saveCustomCoords(coords: CustomCoords): void {
  try {
    localStorage.setItem(CUSTOM_COORDS_KEY, JSON.stringify(coords));
  } catch { /* ignore */ }
}

export function clearCustomCoords(): void {
  try { localStorage.removeItem(CUSTOM_COORDS_KEY); } catch { /* ignore */ }
}

/** 把 localStorage 里的覆写坐标应用到 MAP_NODES —— 应在 MapUI 构造前调用一次 */
export function applyCustomCoords(): void {
  const c = loadCustomCoords();
  for (const n of MAP_NODES) {
    const o = c[n.id];
    if (o && typeof o.xPct === 'number' && typeof o.yPct === 'number') {
      n.xPct = o.xPct;
      n.yPct = o.yPct;
    }
  }
}

/** 用当前 MAP_NODES 里的坐标序列化成一段 TypeScript 代码 —— 直接粘回本文件 */
export function exportNodesAsCode(): string {
  const lines = MAP_NODES.map((n) => {
    // 每行按当前值输出，保留 id 便于对号入座
    return `  // ${n.label}\n  { id: '${n.id}', xPct: ${n.xPct.toFixed(2)}, yPct: ${n.yPct.toFixed(2)} },`;
  }).join('\n');
  return `// 从 dev 拖拽模式导出（${new Date().toLocaleString()}）\n// 请把每项的 xPct / yPct 覆盖到 mapNodes.ts 里 MAP_NODES 对应节点。\nconst UPDATED_COORDS = [\n${lines}\n];`;
}

/* ────────────────────────────────────────────────────────────
   自定义节点图标持久化 —— dev 上传图标后存 base64 到 localStorage
   ────────────────────────────────────────────────────────────
   数据结构：
     { [nodeId]: { dataUrl: string, sizePx: number } }
   · dataUrl —— 图片 base64（用 <img> 或 background-image 直接读）
     · sizePx  —— 显示尺寸（默认 56，用户可在 dev 工具栏调）
   · 因为 base64 图能很大，一次多个节点存到一个 key 里方便读写；
     单张图建议 <= 200KB，避免 localStorage 撑爆（有 5MB 上限）。
*/

const CUSTOM_ICONS_KEY = 'lure-map-node-icons-v1';

export interface NodeIconMeta {
  dataUrl: string;
  sizePx: number;
}
export type CustomIcons = Record<string, NodeIconMeta>;

export const DEFAULT_ICON_SIZE_PX = 56;

export function loadCustomIcons(): CustomIcons {
  try {
    const raw = localStorage.getItem(CUSTOM_ICONS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data as CustomIcons;
  } catch { /* ignore */ }
  return {};
}

export function saveCustomIcons(icons: CustomIcons): void {
  try {
    localStorage.setItem(CUSTOM_ICONS_KEY, JSON.stringify(icons));
  } catch (e) {
    console.warn('[mapNodes] 保存图标失败（可能是 localStorage 空间不足）:', e);
  }
}

export function setNodeIcon(id: string, dataUrl: string, sizePx = DEFAULT_ICON_SIZE_PX): void {
  const c = loadCustomIcons();
  c[id] = { dataUrl, sizePx };
  saveCustomIcons(c);
}

export function setNodeIconSize(id: string, sizePx: number): void {
  const c = loadCustomIcons();
  if (!c[id]) return;
  c[id].sizePx = sizePx;
  saveCustomIcons(c);
}

export function clearNodeIcon(id: string): void {
  const c = loadCustomIcons();
  delete c[id];
  saveCustomIcons(c);
}

export function clearAllNodeIcons(): void {
  try { localStorage.removeItem(CUSTOM_ICONS_KEY); } catch { /* ignore */ }
}
