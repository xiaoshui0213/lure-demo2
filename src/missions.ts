import { ZONE_PORT_W, ZONE_SHALLOW_W, WORLD_W, WORLD_H } from './constants';
import { ItemType } from './GameState';

export type MissionFaction = 'hoarder' | 'souls' | 'merchant';

export interface DailyMission {
  faction:    MissionFaction;
  title:      string;
  subtitle:   string;
  objective:  string;
  hint:       string;
  reward:     number;
  target:     number;
  deadline:   number;   // dayIndex by which this must be completed
  markerX?:   number;   // hoarder: treasure position
  markerY?:   number;
  riddle?:    string[]; // hoarder: cryptic location clues
  wreckX?:    number;   // merchant: sunken ship salvage point
  wreckY?:    number;
  deliveryX?: number;   // merchant: island delivery point
  deliveryY?: number;
  deliveryName?: string;
  bottleX?:   number;   // merchant: drifting bottle (first clue)
  bottleY?:   number;
  logClues?:  string[]; // merchant: torn journal clue lines
}

export interface ActiveMission extends DailyMission {
  progress:     number;
  bottleFound?: boolean;  // merchant: player collected the drifting bottle clue
}

// ─── Faction display names (changed per user request) ────────
export const FACTION_META: Record<MissionFaction, { name: string; icon: string; color: string }> = {
  hoarder:  { name: '残骸猎人', icon: '⚓', color: '#f0c060' },
  souls:    { name: '深渊教团', icon: '🔮', color: '#c080ff' },
  merchant: { name: '浮木商会', icon: '🪵', color: '#80c0e0' },
};

const FACTION_ORDER: MissionFaction[] = ['merchant', 'hoarder', 'souls'];

const HOARDER_REWARD  = 40;
const SOULS_REWARD    = 50;
const MERCHANT_REWARD = 45;

// ─── Zone bounds ─────────────────────────────────────────────
const SHALLOW_X = ZONE_PORT_W;                       // 240
const DEEP_X    = ZONE_PORT_W + ZONE_SHALLOW_W;      // 960
const DEEP_W    = WORLD_W - DEEP_X;                  // 840

// ─── Treasure (hoarder) ──────────────────────────────────────
function treasureMarker(dayIndex: number): { x: number; y: number } {
  const x = DEEP_X + 120 + (dayIndex * 173) % (DEEP_W - 240);
  const y = 180 + (dayIndex * 97) % (WORLD_H - 360);
  return { x, y };
}

export function generateRiddle(x: number, y: number, dayIndex: number): string[] {
  const relX = (x - DEEP_X) / DEEP_W;
  const relY = y / WORLD_H;

  let ewClue: string;
  if (relX < 0.30)      ewClue = '刚入黑水，深海西侧，背对浅海边界。';
  else if (relX < 0.60) ewClue = '深海腹地，四望皆是黑浪，无岸可见。';
  else                  ewClue = '深海最东端，几乎到了天边。';

  let nsClue: string;
  if (relY < 0.3)       nsClue = '偏北，海面冰冷，浪涌高过船舷。';
  else if (relY < 0.5)  nsClue = '略偏北，约在深海上半段。';
  else if (relY < 0.7)  nsClue = '略偏南，深海中段偏下。';
  else                  nsClue = '极南，礁石密布的黑暗水域。';

  const flavors = [
    '宝箱沉于黑色沙底，白昼才能辨清方向。',
    '涨潮前藏下，退潮后仍在原处。',
    '此处曾有沉船，残骸边就是目标。',
    '图上的叉是手绘，误差一个船身之内。',
    '白天才能看见水下的金色光晕。',
    '风平浪静时水面会有微弱反光。',
  ];
  return [ewClue, nsClue, flavors[dayIndex % flavors.length]];
}

// ─── Wreck + delivery (merchant) ─────────────────────────────
export const DELIVERY_ISLANDS: { x: number; y: number; name: string }[] = [
  { x: 380,  y: 160,  name: '北礁岛' },
  { x: 880,  y: 220,  name: '东北礁' },
  { x: 400,  y: 1020, name: '南风礁' },
  { x: 860,  y: 980,  name: '东南礁' },
];

function wreckMarker(dayIndex: number): { x: number; y: number } {
  const x = DEEP_X + 100 + (dayIndex * 211) % (DEEP_W - 200);
  const y = 200    + (dayIndex * 131) % (WORLD_H - 400);
  return { x, y };
}

/** Bottle spawns away from both the wreck and the delivery island.
 *  Generates 8 spread candidates and returns the one with the greatest
 *  minimum distance to either obstacle. */
function bottleMarker(
  wreck:  { x: number; y: number },
  island: { x: number; y: number },
  dayIndex: number,
): { x: number; y: number } {
  // Four X positions: far-west, mid-west, mid-east, far-east of shallow zone
  const xs = [
    SHALLOW_X + 80  + (dayIndex * 37) % 120,
    SHALLOW_X + 220 + (dayIndex * 43) % 120,
    SHALLOW_X + 420 + (dayIndex * 59) % 120,
    SHALLOW_X + 560 + (dayIndex * 67) % 120,
  ];
  // Two Y positions: north band and south band
  const ys = [
    100  + (dayIndex * 53) % 200,
    WORLD_H - 300 + (dayIndex * 71) % 200,
  ];

  const candidates: { x: number; y: number }[] = [];
  for (const bx of xs) for (const by of ys) candidates.push({ x: bx, y: by });

  const score = (c: { x: number; y: number }) => Math.min(
    Math.hypot(c.x - wreck.x,  c.y - wreck.y),
    Math.hypot(c.x - island.x, c.y - island.y),
  );

  return candidates.reduce((best, c) => score(c) > score(best) ? c : best);
}

/** Compass bearing text from bottle toward wreck */
function bearingText(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180; 0=east, 90=south
  // Normalize to 0..360 with North=0
  const bearing = ((angle + 360 + 90) % 360);
  if (bearing < 22.5 || bearing >= 337.5)  return '正北';
  if (bearing < 67.5)  return '东北';
  if (bearing < 112.5) return '正东';
  if (bearing < 157.5) return '东南';
  if (bearing < 202.5) return '正南';
  if (bearing < 247.5) return '西南';
  if (bearing < 292.5) return '正西';
  return '西北';
}

/** Distance clue between bottle and wreck */
function distanceText(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 500)  return '越过浅水，不算太远';
  if (d < 800)  return '需穿过浅海，进入深水区';
  return '极深处，须有备而往';
}

/** Wreck position in the deep zone described in prose */
function wreckRegionText(x: number, y: number): string {
  const relX = (x - DEEP_X) / DEEP_W;
  const relY = y / WORLD_H;

  let ew: string;
  if (relX < 0.35)      ew = '深海西侧，刚越过浅水边界';
  else if (relX < 0.65) ew = '深海腹地，四望皆是黑水';
  else                  ew = '深海东端，几乎到了天边';

  let ns: string;
  if (relY < 0.30)      ns = '北部';
  else if (relY < 0.50) ns = '偏北';
  else if (relY < 0.70) ns = '偏南';
  else                  ns = '南部';

  return `${ew}，${ns}`;
}

/** Generate the clue lines shown in the torn shipping log */
export function generateLogClues(
  bottle: { x: number; y: number },
  wreck: { x: number; y: number },
  dayIndex: number,
): string[] {
  const shipNames = ['浮木号', '信天翁', '海燕', '碎浪', '旧港'];
  const shipName  = shipNames[dayIndex % shipNames.length];
  const bearing   = bearingText(bottle, wreck);
  const dist      = distanceText(bottle, wreck);
  const region    = wreckRegionText(wreck.x, wreck.y);

  const cargos = ['茶叶', '瓷器', '烟草', '布匹', '香料'];
  const cargo  = cargos[dayIndex % cargos.length];

  return [
    `船名：${shipName}  ·  货物：${cargo}十二箱`,
    `事发前航向 ${bearing}，距此地${dist}`,
    `事发海域：${region}`,
    `注：木箱密封，入水后仍可打捞`,
  ];
}

/** Legacy alias kept for any existing callers */
export function generateWreckClue(x: number, y: number, dayIndex: number): string[] {
  const bottle = bottleMarker({ x, y }, dayIndex);
  return generateLogClues(bottle, { x, y }, dayIndex);
}

// ─── Mission generation ───────────────────────────────────────
function pickFaction(dayIndex: number): MissionFaction {
  return FACTION_ORDER[(dayIndex * 7 + 3) % FACTION_ORDER.length];
}

export function generateDailyMission(dayIndex: number): DailyMission {
  const faction  = pickFaction(dayIndex);
  const deadline = dayIndex + 2;

  if (faction === 'hoarder') {
    const { x, y } = treasureMarker(dayIndex);
    return {
      faction:   'hoarder',
      title:     '残骸寻宝',
      subtitle:  '秘图索骥 · 深海挖掘',
      objective: '持藏宝图前往深海，找到埋藏地点，按 [ E ] 发掘',
      hint:      '白天进入深海，靠近宝藏后海图才会显示金色 ✕ 标记',
      reward:    HOARDER_REWARD,
      target:    1,
      deadline,
      markerX:   x,
      markerY:   y,
      riddle:    generateRiddle(x, y, dayIndex),
    };
  }

  if (faction === 'souls') {
    return {
      faction:   'souls',
      title:     '深渊标本',
      subtitle:  '秘仪搜集 · 白天捕获',
      objective: '白天在深海钓取 2 条幽光鱼，带回港口交付',
      hint:      '接单后深海会出现幽光鱼钓点，放入货舱回港即可',
      reward:    SOULS_REWARD,
      target:    2,
      deadline,
    };
  }

  // merchant: drifting bottle → torn log clue → wreck salvage → island delivery
  const wreck  = wreckMarker(dayIndex);
  const island = DELIVERY_ISLANDS.reduce((best, candidate) => {
    const db = (best.x - wreck.x) ** 2 + (best.y - wreck.y) ** 2;
    const dc = (candidate.x - wreck.x) ** 2 + (candidate.y - wreck.y) ** 2;
    return dc > db ? candidate : best;
  });
  const bottle = bottleMarker(wreck, island, dayIndex);
    return {
    faction:      'merchant',
    title:        '沉船货运',
    subtitle:     '海上打捞 · 定点交付',
    objective:    `浅海打捞 · 运至${island.name}`,
    hint:         '先在浅海寻找漂流瓶，读取日志后前往深海寻找沉船',
    reward:       MERCHANT_REWARD,
    target:       1,
    deadline,
    bottleX:      bottle.x,
    bottleY:      bottle.y,
    logClues:     generateLogClues(bottle, wreck, dayIndex),
    wreckX:       wreck.x,
    wreckY:       wreck.y,
    deliveryX:    island.x,
    deliveryY:    island.y,
    deliveryName: island.name,
  };
}

// ─── NPC dialogue ─────────────────────────────────────────────
export function dailyNpcIntro(m: DailyMission): string {
  switch (m.faction) {
    case 'hoarder':
      return '残骸猎人的人丢来一张图，说深海有东西埋着。你去挖，白天动手，别等天黑。';
    case 'souls':
      return '深渊教团要两条幽光鱼。白天深海才有得钓——你懂的，天黑了深海就不一样了。';
    case 'merchant':
      return `浮木商会的货沉了。浅海某处有个瓶子漂着，里头有线索。你去找，照着走，货捞上来送到${m.deliveryName ?? '交货点'}——那边有人等着。`;
  }
}

export function dailyNpcActive(m: ActiveMission): string {
  if (m.progress >= m.target) {
    switch (m.faction) {
      case 'hoarder':  return '挖到了？把东西给我，钱拿走。';
      case 'souls':    return '鱼到了？放这儿，帐结了。';
      case 'merchant': return `货捞上来了？去${(m as DailyMission).deliveryName ?? '交货点'}把东西交了就行。`;
    }
  }
  switch (m.faction) {
    case 'hoarder':  return '图在你手里，深海，白天去。';
    case 'souls':    return '幽光鱼还没够。白天深海钓，两条进舱了再说。';
    case 'merchant':
      if (!m.bottleFound) return '瓶子还没找到。浅海里漂着呢，去捞起来看看。';
      return `日志读过了？那就知道去哪了。货捞上来，送到${m.deliveryName ?? '交货点'}，这事就结了。`;
  }
}

export function dailyNpcDone(): string {
  return '今天的事办完了。明儿日出再来。';
}

export function deadlineText(m: ActiveMission, currentDay: number): string {
  const left = m.deadline - currentDay;
  if (left <= 0) return '⚠ 已过期';
  if (left === 1) return '⚠ 明天截止';
  return `剩 ${left} 天`;
}

export function missionProgressText(m: ActiveMission): string {
  const meta = FACTION_META[m.faction];
  if (m.faction === 'merchant') {
    if (m.progress >= m.target) {
      return `${meta.icon} 货物已打捞 — 前往${m.deliveryName ?? '交货点'}交付`;
    }
    if (!m.bottleFound) {
      return `${meta.icon} 浮木商会 · 在浅海寻找漂流瓶 [ M ] 查看提示`;
    }
    return `${meta.icon} 浮木商会 · 已读日志，前往浅海打捞沉船`;
  }
  if (m.progress >= m.target) {
    return `${meta.icon} ${meta.name} · 已完成 — 回港找委托人领取 ${m.reward} 金`;
  }
  switch (m.faction) {
    case 'hoarder': return `${meta.icon} 残骸猎人 · 白天前往深海，读图索骥`;
    case 'souls':   return `${meta.icon} 深渊教团 · 白天深海钓幽光鱼 ${m.progress}/${m.target}`;
  }
}

export function canTurnIn(m: ActiveMission, cargoCount: (type: ItemType) => number): boolean {
  if (m.progress < m.target) return false;
  switch (m.faction) {
    case 'hoarder':  return cargoCount('treasure')  >= 1;
    case 'souls':    return cargoCount('glow_fish')  >= m.target;
    case 'merchant': return false; // delivered at sea island, not at port
  }
}
