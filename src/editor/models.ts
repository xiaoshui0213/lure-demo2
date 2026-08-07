import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { createBoat } from '../proto/Boat';
import { createStylizedMaterial, attachOutlinesToStylizedMeshes } from '../render/StylizedMaterial';

/**
 * 编辑器可放置的模型库
 * 未来把 factory 替换成 GLTFLoader().load(...) 即可无缝升级
 */

export interface ModelDef {
  id: string;
  name: string;
  swatch: string;      // UI 上显示的色块
  /**
   * 分类：
   * - fishing_spot（deprecated）：老"离散钓鱼点"—— 保留是为了兼容旧场景，新场景请用 fishing_zone
   * - fishing_zone：新"钓鱼海域"—— 大面积圆形，海域内自由抛竿，钩子系统会往里洒诱饵
   * - port_refill：港口补给圈，玩家进入自动补满鱼饵
   */
  category: 'nav' | 'obstacle' | 'landmark' | 'entity' | 'fishing_spot' | 'fishing_zone' | 'port_refill';
  yOffset: number;     // 建议放置高度（相对于水面 y=0）
  build: () => THREE.Object3D;
  rotatable?: boolean;
  scalable?: boolean;
  /** 检测半径（米）—— fishing_spot / fishing_zone / port_refill 用来做距离触发 */
  triggerRadius?: number;
  /** 钓鱼海域的品级 —— 决定钩子密度和大鱼概率 */
  zoneTier?: 'common' | 'rare' | 'lair';
}

/** 钓鱼点（离散老版本）的默认触发半径 */
export const DEFAULT_FISHING_SPOT_RADIUS = 7.5;
/** 钓鱼海域（新版本）默认半径 —— 大到玩家能在里面开船转圈找钓点 */
export const DEFAULT_FISHING_ZONE_RADIUS = 55;
/** 港口补给圈默认半径 */
export const DEFAULT_PORT_REFILL_RADIUS = 10;

/* ─── 工具函数 ─── */

function jitter(geo: THREE.BufferGeometry, amt: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (Math.random() - 0.5) * amt,
      pos.getY(i) + (Math.random() - 0.5) * amt * 0.4,
      pos.getZ(i) + (Math.random() - 0.5) * amt,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

/** 程序化模型统一用 stylized 材质（3渲2 + 冷暖色带 + 弱 Rim） */
const toon = (color: string) =>
  createStylizedMaterial({ color, flatShading: true });

/* ─── 模型 factories ─── */

/* ─── 卡通礁石（参考风格化白灰紫礁石） ───
 * ConvexGeometry 从随机点云生成 → 天然大切面
 * 顶点颜色做上下 warm→cool 渐变，模拟画好的紫灰阴影
 * flatShading + MeshToonMaterial 保持低多边卡通感
 */
function mulberry32(seed: number) {
  return function () {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RockOpts {
  size?: number;       // 参考尺寸（长宽方向），米
  seed?: number;       // 决定形状；缺省则每次随机
  color?: {
    light?: string;    // 顶面高光色
    mid?: string;      // 中段
    dark?: string;     // 底部/阴影
  };
}

function buildChunkyRock(opts: RockOpts = {}): THREE.Object3D {
  const size = opts.size ?? 1.4;
  const rand = mulberry32(opts.seed ?? Math.floor(Math.random() * 1e9));

  // 参考图石头偏扁 —— 宽 ≈ 深 > 高
  const w = size * (0.95 + (rand() - 0.5) * 0.35);
  const h = size * (0.65 + rand() * 0.30);
  const d = size * (0.95 + (rand() - 0.5) * 0.35);

  // 8 角点各带一点抖动 + 若干中间点 → 凸包出 8~12 个大面
  const points: THREE.Vector3[] = [];
  const corners: [number, number, number][] = [
    [-1, -1, -1], [1, -1, -1], [-1, -1, 1], [1, -1, 1],
    [-1,  1, -1], [1,  1, -1], [-1,  1, 1], [1,  1, 1],
  ];
  for (const [cx, cy, cz] of corners) {
    points.push(new THREE.Vector3(
      cx * (w / 2) * (0.85 + rand() * 0.25),
      cy * (h / 2) * (0.85 + rand() * 0.25),
      cz * (d / 2) * (0.85 + rand() * 0.25),
    ));
  }
  // 再洒 2~4 个随机中间点，让某几个面被切成更小的斜面
  const extra = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < extra; i++) {
    points.push(new THREE.Vector3(
      (rand() - 0.5) * w,
      (rand() - 0.5) * h,
      (rand() - 0.5) * d,
    ));
  }

  const geo = new ConvexGeometry(points);
  geo.computeVertexNormals();

  // 顶点颜色：底部冷紫灰 → 中段暖米 → 顶部近白（模拟参考图内建阴影）
  const light = new THREE.Color(opts.color?.light ?? '#f4ede1');
  const mid   = new THREE.Color(opts.color?.mid   ?? '#e2d6c2');
  const dark  = new THREE.Color(opts.color?.dark  ?? '#b6adba');

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y - yMin) / (yMax - yMin + 1e-6);
    const c = new THREE.Color();
    if (t > 0.55) {
      c.copy(mid).lerp(light, (t - 0.55) / 0.45);
    } else {
      c.copy(dark).lerp(mid, t / 0.55);
    }
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = createStylizedMaterial({
    vertexColors: true,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // 让底部贴在 group 的 y=0（配合 ModelDef.yOffset 就能微调下沉）
  const wrapper = new THREE.Group();
  wrapper.add(mesh);
  mesh.position.y = h / 2;
  // 世界 Y 轴上随机小旋转，实例之间不撞脸
  wrapper.rotation.y = rand() * Math.PI * 2;
  return wrapper;
}

function buildRock(): THREE.Object3D  { return buildChunkyRock({ size: 1.5 }); }
// 礁石(小/中/大) 已改用外部 glTF（public/models/rock_*.glb），
// 在 editor/main.ts 的 bootstrapUserModels() 里加载 & registerModel 注册

// 小岛(小/中/大) 已改用外部 glTF（public/models/island_*.glb），
// 在 editor/main.ts 的 bootstrapUserModels() 里通过 bootstrapExternalGltf 加载 & 注册

function buildBuoy(): THREE.Object3D {
  const g = new THREE.Group();
  const buoy = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    toon('#ff6b6b'),
  );
  buoy.position.y = 0.35;
  buoy.castShadow = true;
  g.add(buoy);
  const flag = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5),
    toon('#3d3d3d'),
  );
  flag.position.y = 0.85;
  g.add(flag);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 0.2),
    createStylizedMaterial({ color: '#ffd166', side: THREE.DoubleSide }),
  );
  banner.position.set(0.18, 1.05, 0);
  g.add(banner);
  return g;
}

function buildDock(): THREE.Object3D {
  const g = new THREE.Group();
  // 平台
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.15, 2.0),
    toon('#a17851'),
  );
  deck.position.y = 0.55;
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  // 支柱
  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.6, 5);
  const postMat = toon('#5a3d24');
  const positions: [number, number][] = [
    [-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85],
    [0, -0.85], [0, 0.85],
  ];
  for (const [x, z] of positions) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, -0.25, z);
    post.castShadow = true;
    g.add(post);
  }
  // 灯
  const lampPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5),
    toon('#3d3d3d'),
  );
  lampPole.position.set(1.3, 1.4, 0.85);
  g.add(lampPole);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#ffd18a' }),
  );
  lamp.position.set(1.3, 2.15, 0.85);
  g.add(lamp);
  return g;
}

function buildBossLair(): THREE.Object3D {
  const g = new THREE.Group();
  // 尖峰礁石
  const spire = new THREE.Mesh(
    jitter(new THREE.ConeGeometry(1.6, 5.5, 6, 3), 0.4),
    toon('#3b3540'),
  );
  spire.position.y = 2.5;
  spire.castShadow = true;
  g.add(spire);
  // 底盘
  const base = new THREE.Mesh(
    jitter(new THREE.CylinderGeometry(2.4, 3.0, 0.8, 8), 0.2),
    toon('#252029'),
  );
  base.position.y = 0.2;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  // 触角式辅礁
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const claw = new THREE.Mesh(
      jitter(new THREE.ConeGeometry(0.4, 1.8, 5, 2), 0.2),
      toon('#4a4250'),
    );
    claw.position.set(Math.cos(angle) * 1.8, 1.0, Math.sin(angle) * 1.8);
    claw.rotation.z = Math.cos(angle) * 0.3;
    claw.rotation.x = Math.sin(angle) * 0.3;
    claw.castShadow = true;
    g.add(claw);
  }
  return g;
}

function buildPortMarker(): THREE.Object3D {
  const g = new THREE.Group();
  // 大平台
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.2, 3.5),
    toon('#c99b6e'),
  );
  base.position.y = 0.6;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  // 小屋
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.2, 1.2),
    toon('#e0c48a'),
  );
  house.position.set(-0.5, 1.3, 0);
  house.castShadow = true;
  g.add(house);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 0.9, 4),
    toon('#a53f2b'),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.set(-0.5, 2.3, 0);
  g.add(roof);
  return g;
}

/**
 * 冒泡粒子组：小白球从 -depth 上升到 y=0.05，surface 停留后淡出重生
 * 用共享 SphereGeometry + 独立材质克隆（每颗气泡可独立控制 opacity）
 * 返回的 group 会在 userData 上挂 tick(dt: number) —— 试玩每帧调用一次
 */
interface BubbleEmitterOpts {
  areaRadius: number;              // XZ 抖动半径
  bubbleCount: number;             // 粒子数量
  spawnDepth: number;              // 气泡从水下多少米开始上升
  riseDuration: [number, number];  // 上升耗时 min..max (秒)
  surfaceRest: [number, number];   // 到水面后停留 min..max (秒)
  bubbleRadius: [number, number];  // 气泡半径 min..max (米)
}

function createBubbleEmitter(opts: BubbleEmitterOpts): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fishing-bubbles';

  const geo = new THREE.SphereGeometry(1, 8, 6);

  interface BubbleState {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    baseOpacity: number;
    xOff: number;
    zOff: number;
    scale: number;
    phase: number;       // 0..1 归一化生命周期
    rise: number;        // 秒
    rest: number;        // 秒
  }

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const bubbles: BubbleState[] = [];
  for (let i = 0; i < opts.bubbleCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: '#eaf6ff',
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    const scale = rand(opts.bubbleRadius[0], opts.bubbleRadius[1]);
    mesh.scale.setScalar(scale);
    group.add(mesh);

    bubbles.push({
      mesh,
      mat,
      baseOpacity: 0.45 + Math.random() * 0.35,
      xOff: (Math.random() * 2 - 1) * opts.areaRadius,
      zOff: (Math.random() * 2 - 1) * opts.areaRadius,
      scale,
      phase: Math.random(),   // 错开起始相位，避免"整齐冒泡"
      rise: rand(opts.riseDuration[0], opts.riseDuration[1]),
      rest: rand(opts.surfaceRest[0], opts.surfaceRest[1]),
    });
  }

  group.userData.tick = (dt: number) => {
    for (const b of bubbles) {
      const total = b.rise + b.rest;
      b.phase += dt / total;
      if (b.phase >= 1) {
        // 重生：新的 XZ + 大小 + 上升时长，模拟"泡泡不同处冒出"
        b.phase = 0;
        b.xOff = (Math.random() * 2 - 1) * opts.areaRadius;
        b.zOff = (Math.random() * 2 - 1) * opts.areaRadius;
        b.scale = rand(opts.bubbleRadius[0], opts.bubbleRadius[1]);
        b.rise = rand(opts.riseDuration[0], opts.riseDuration[1]);
        b.rest = rand(opts.surfaceRest[0], opts.surfaceRest[1]);
        b.baseOpacity = 0.45 + Math.random() * 0.35;
        b.mesh.scale.setScalar(b.scale);
      }
      const riseFrac = b.rise / total;
      let y: number, opacity: number;
      if (b.phase < riseFrac) {
        const rp = b.phase / riseFrac;
        // 水下：-depth → +0.05；用 pow(0.7) 让上升前段稍慢、后段加速
        y = -opts.spawnDepth * (1 - rp) + 0.05 * rp;
        // 出水前渐显（0..0.25 淡入到 baseOpacity）
        opacity = b.baseOpacity * Math.min(1, rp / 0.25);
      } else {
        // 停留在水面并淡出
        const sp = (b.phase - riseFrac) / (1 - riseFrac);
        y = 0.05;
        opacity = b.baseOpacity * (1 - sp);
      }
      b.mesh.position.set(b.xOff, y, b.zOff);
      b.mat.opacity = opacity;
    }
  };

  return group;
}

/**
 * 钓鱼点：水面上的发光浮标 + 底盘圆环，用于指示"这里可以钓鱼"
 * 视觉设计：细金属杆 + 顶部暖光小灯 + 水面透明圆环 + 冒泡粒子（暗示水下有鱼）
 * 圆环半径 = 触发范围，玩家一眼就知道要开多近才能钓
 * 顶层 userData.tick(dt) 会驱动所有子发射器 —— 试玩每帧调用
 */
function buildFishingSpot(): THREE.Object3D {
  const g = new THREE.Group();

  // 底盘：一个小浮盘让玩家能看到杆子从哪浮出水面
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.15, 8),
    toon('#7a4b2b'),
  );
  base.position.y = 0.08;
  base.castShadow = true;
  g.add(base);

  // 中央细杆
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 1.4, 6),
    toon('#3d3d3d'),
  );
  pole.position.y = 0.85;
  pole.castShadow = true;
  g.add(pole);

  // 顶部发光小灯（unlit basic → 有夜里也醒目）
  const lampGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 8),
    new THREE.MeshBasicMaterial({ color: '#ffd88a' }),
  );
  lampGlow.position.y = 1.65;
  g.add(lampGlow);

  // 外圈柔光晕，加一层放大的半透明球
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshBasicMaterial({
      color: '#ffe6b0',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  halo.position.y = 1.65;
  g.add(halo);

  // 水面触发范围圆环
  const r = DEFAULT_FISHING_SPOT_RADIUS;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.15, r, 48),
    new THREE.MeshBasicMaterial({
      color: '#4dd0ff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.name = 'fishing-range-ring';
  g.add(ring);

  // 内圈虚线状：4 个短弧（60° 一段）指示中心
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.65, 24),
    new THREE.MeshBasicMaterial({
      color: '#8ae6ff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.06;
  g.add(inner);

  // ── 冒泡：暗示"这里水下有鱼" ──
  // 分两层，一层集中在中心 1.2m 内的密集小气泡（主视觉），
  // 一层散布在 2.5m 更大范围的稀疏气泡（打破整齐，模拟鱼群移动）
  const bubblesCore = createBubbleEmitter({
    areaRadius: 1.2,
    bubbleCount: 18,
    spawnDepth: 0.6,
    riseDuration: [1.4, 2.6],
    surfaceRest: [0.35, 0.9],
    bubbleRadius: [0.045, 0.09],
  });
  const bubblesWide = createBubbleEmitter({
    areaRadius: 2.5,
    bubbleCount: 10,
    spawnDepth: 0.8,
    riseDuration: [2.2, 3.6],
    surfaceRest: [0.4, 1.1],
    bubbleRadius: [0.05, 0.11],
  });
  g.add(bubblesCore);
  g.add(bubblesWide);

  // 把两个 emitter 的 tick 汇总到顶层，试玩每帧只要调 g.userData.tick(dt) 就够
  g.userData.tick = (dt: number) => {
    bubblesCore.userData.tick(dt);
    bubblesWide.userData.tick(dt);
  };

  return g;
}

/**
 * 钓鱼海域（大面积圆形）—— 玩家进圈就能自由抛竿，无需精确站在浮标上
 * 视觉：半透明浅蓝圆盘 + 环形流光波纹（fragment shader）
 *
 * 编辑器里 zoneTier 通过 userData 挂到顶层，proto 加载时读出来
 * fillOpacity 参数：编辑器要看清边界给 0.35，试玩时会被 setZoneEditorVisual(false) 拉到 0.08
 */
function buildFishingZone(radius = DEFAULT_FISHING_ZONE_RADIUS, tier: 'common' | 'rare' | 'lair' = 'common'): THREE.Object3D {
  const g = new THREE.Group();
  g.userData.zoneTier = tier;
  g.userData.zoneRadius = radius;

  const tierColor: Record<'common' | 'rare' | 'lair', string> = {
    common: '#4dd0ff',
    rare: '#7d9bff',
    lair: '#c060ff',
  };
  const color = new THREE.Color(tierColor[tier]);

  /* ── 内部填充：非常淡的水色圆盘（编辑器里稍强，试玩弱化） ── */
  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.02;
  fill.name = 'zone-fill';
  fill.renderOrder = 1;
  g.add(fill);

  /* ── 外边界：一圈明显的粗环，永远显示（试玩也保留 —— 玩家要知道自己在不在圈内） ── */
  const borderMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const border = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.35, radius, 96),
    borderMat,
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = 0.04;
  border.name = 'zone-border';
  border.renderOrder = 2;
  g.add(border);

  /* ── 呼吸波纹：一圈自动扩散消失的环（shader 驱动，纯 fragment 里做 3 圈同心波） ── */
  const rippleMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: radius },
      uColor: { value: color },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec2 vLocal; // 局部 xz（-radius..+radius），用于算径向
      void main() {
        vUv = uv;
        // CircleGeometry 的 vertex position 就是本地 xz
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uRadius;
      uniform vec3  uColor;
      varying vec2 vLocal;
      void main() {
        float d = length(vLocal) / uRadius; // 0..1 到圈边
        if (d > 1.0) discard;

        // 3 圈波纹，从中心向外扩散、渐弱
        float acc = 0.0;
        for (int i = 0; i < 3; i++) {
          float phase = mod(uTime * 0.18 + float(i) * 0.333, 1.0);
          float ring = 1.0 - smoothstep(0.02, 0.04, abs(d - phase));
          float fade = 1.0 - phase;
          acc += ring * fade * 0.35;
        }

        // 外边缘再补一点渐隐（视觉更"融进海"）
        float edgeFade = smoothstep(1.0, 0.85, d);
        gl_FragColor = vec4(uColor, acc * edgeFade * 0.9);
      }
    `,
  });
  const ripples = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), rippleMat);
  ripples.rotation.x = -Math.PI / 2;
  ripples.position.y = 0.03;
  ripples.name = 'zone-ripples';
  ripples.renderOrder = 3;
  g.add(ripples);

  /* ── 中心标记（编辑器里对齐用）—— tick 里试玩阶段可以隐藏 ── */
  const center = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, 0.15, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
  center.position.y = 0.08;
  center.name = 'zone-center-marker';
  g.add(center);

  // 允许 main 里试玩阶段减弱视觉（把 fill 变很淡、隐藏中心标）
  g.userData.setZoneEditorVisual = (editorMode: boolean) => {
    fillMat.opacity = editorMode ? 0.18 : 0.06;
    borderMat.opacity = editorMode ? 0.65 : 0.35;
    center.visible = editorMode;
  };

  g.userData.tick = (dt: number) => {
    rippleMat.uniforms.uTime.value += dt;
  };

  return g;
}

/**
 * 港口补给圈：玩家进入自动补满鱼饵
 * 视觉：金色圆盘 + 十字标 —— 跟钓鱼海域颜色明显区分
 */
function buildPortRefill(radius = DEFAULT_PORT_REFILL_RADIUS): THREE.Object3D {
  const g = new THREE.Group();
  g.userData.refillRadius = radius;

  const color = new THREE.Color('#ffcc55');

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.02;
  fill.renderOrder = 1;
  g.add(fill);

  const border = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.35, radius, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = 0.04;
  border.renderOrder = 2;
  g.add(border);

  // 中央十字标（补给点）
  const cross1 = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.55, 0.08, 0.35),
    new THREE.MeshBasicMaterial({ color: '#fff2c0' }),
  );
  cross1.position.y = 0.10;
  g.add(cross1);
  const cross2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.08, radius * 0.55),
    new THREE.MeshBasicMaterial({ color: '#fff2c0' }),
  );
  cross2.position.y = 0.10;
  g.add(cross2);

  return g;
}

function buildStartSpawn(): THREE.Object3D {
  // 起点：小箭头/旗标 + 一艘船
  const g = new THREE.Group();
  const boat = createBoat();
  boat.position.y = 0.15;
  g.add(boat);
  // 起点标记：一圈发光环
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 2.6, 32),
    new THREE.MeshBasicMaterial({ color: '#4dd0ff', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  return g;
}

/* ─── 注册表 ─── */

export const MODEL_LIBRARY: ModelDef[] = [
  // 礁石(小/中/大) 由 bootstrapUserModels() 从 public/models/rock_*.glb 动态注册
  // 小岛(小/中/大) 由 bootstrapUserModels() 从 public/models/island_*.glb 动态注册
  {
    id: 'buoy',
    name: '浮标',
    swatch: '#ff6b6b',
    category: 'nav',
    yOffset: 0.0,
    build: buildBuoy,
    rotatable: true,
    scalable: false,
  },
  {
    id: 'dock',
    name: '码头',
    swatch: '#a17851',
    category: 'landmark',
    yOffset: 0.0,
    build: buildDock,
    rotatable: true,
    scalable: false,
  },
  {
    id: 'port',
    name: '港口',
    swatch: '#c99b6e',
    category: 'landmark',
    yOffset: -0.2,
    build: buildPortMarker,
    rotatable: true,
    scalable: false,
  },
  {
    id: 'boss',
    name: 'Boss 巢穴',
    swatch: '#3b3540',
    category: 'landmark',
    yOffset: -0.3,
    build: buildBossLair,
    rotatable: true,
    scalable: false,
  },
  {
    id: 'spawn',
    name: '起点（船）',
    swatch: '#4dd0ff',
    category: 'entity',
    yOffset: 0.0,
    build: buildStartSpawn,
    rotatable: true,
    scalable: false,
  },
  {
    id: 'fishing_spot',
    name: '钓鱼点（旧）',
    swatch: '#ffd88a',
    category: 'fishing_spot',
    yOffset: 0.0,
    build: buildFishingSpot,
    rotatable: false,
    scalable: false,
    triggerRadius: DEFAULT_FISHING_SPOT_RADIUS,
  },
  /* ── 新版：钓鱼海域，3 档 tier ── */
  {
    id: 'fishing_zone_common',
    name: '钓鱼海域(普通)',
    swatch: '#4dd0ff',
    category: 'fishing_zone',
    yOffset: 0.0,
    build: () => buildFishingZone(DEFAULT_FISHING_ZONE_RADIUS, 'common'),
    rotatable: false,
    scalable: true,
    triggerRadius: DEFAULT_FISHING_ZONE_RADIUS,
    zoneTier: 'common',
  },
  {
    id: 'fishing_zone_rare',
    name: '钓鱼海域(稀有)',
    swatch: '#7d9bff',
    category: 'fishing_zone',
    yOffset: 0.0,
    build: () => buildFishingZone(DEFAULT_FISHING_ZONE_RADIUS, 'rare'),
    rotatable: false,
    scalable: true,
    triggerRadius: DEFAULT_FISHING_ZONE_RADIUS,
    zoneTier: 'rare',
  },
  {
    id: 'fishing_zone_lair',
    name: '钓鱼海域(巢穴)',
    swatch: '#c060ff',
    category: 'fishing_zone',
    yOffset: 0.0,
    build: () => buildFishingZone(DEFAULT_FISHING_ZONE_RADIUS * 1.15, 'lair'),
    rotatable: false,
    scalable: true,
    triggerRadius: DEFAULT_FISHING_ZONE_RADIUS * 1.15,
    zoneTier: 'lair',
  },
  /* ── 港口补给圈 ── */
  {
    id: 'port_refill',
    name: '港口补给',
    swatch: '#ffcc55',
    category: 'port_refill',
    yOffset: 0.0,
    build: () => buildPortRefill(DEFAULT_PORT_REFILL_RADIUS),
    rotatable: false,
    scalable: true,
    triggerRadius: DEFAULT_PORT_REFILL_RADIUS,
  },
];

export function getModelDef(id: string): ModelDef | undefined {
  return MODEL_LIBRARY.find((m) => m.id === id);
}

/* ─── 运行时增删（用于导入 glTF / 用户上传） ─── */

type LibraryListener = () => void;
const listeners: LibraryListener[] = [];

/** 订阅模型库变化（UI 用来重新渲染 palette） */
export function onModelLibraryChange(cb: LibraryListener): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * 给一个 ModelDef 包装 build，让返回的 Object3D 树自动挂上 stylized 描边
 * —— 程序化模型（buildBoat / buildDock / buildIsland …）都会自动出描边
 *   glTF 模型在 loadGLTF 阶段已单独处理，这里 attach 一次是幂等的（会跳过已有）
 */
function wrapDefWithOutlines(def: ModelDef): ModelDef {
  const orig = def.build;
  return {
    ...def,
    build: () => {
      const g = orig();
      attachOutlinesToStylizedMeshes(g);
      return g;
    },
  };
}

// 一次性把 MODEL_LIBRARY 里所有内置条目包装描边
for (let i = 0; i < MODEL_LIBRARY.length; i++) {
  MODEL_LIBRARY[i] = wrapDefWithOutlines(MODEL_LIBRARY[i]);
}

/**
 * 注册或替换一个模型条目
 * - id 已存在时会覆盖（用来把占位低模换成真·glTF）
 * - 会自动包一层描边挂载
 * - 通知所有 listener 刷新 UI
 */
export function registerModel(def: ModelDef) {
  const wrapped = wrapDefWithOutlines(def);
  const idx = MODEL_LIBRARY.findIndex((m) => m.id === def.id);
  if (idx >= 0) MODEL_LIBRARY[idx] = wrapped;
  else MODEL_LIBRARY.push(wrapped);
  listeners.forEach((cb) => cb());
}

/** 从模型库移除条目（用于清理 glTF 拆分产生的空白变体） */
export function removeModel(id: string) {
  const idx = MODEL_LIBRARY.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  MODEL_LIBRARY.splice(idx, 1);
  listeners.forEach((cb) => cb());
  return true;
}

/* ─── 示例：把占位的 rock 换成真·glTF ────────────────────────
 *
 * 1) 把模型文件放到  public/models/rock.glb
 * 2) 在编辑器启动时（比如 main.ts 顶部）：
 *
 *    import { loadGLTFModel } from './loadGLTF';
 *    import { registerModel } from './models';
 *
 *    loadGLTFModel('/models/rock.glb', {
 *      fitSize: 2.5,        // 归一化到 ~1 格
 *      toonify: true,       // 材质卡通化保持画风一致
 *      groundYToZero: true, // 底部贴地
 *    }).then((build) => {
 *      registerModel({
 *        id: 'rock',              // 用同名 id 覆盖占位低模
 *        name: '礁石',
 *        swatch: '#7a7166',
 *        category: 'obstacle',
 *        yOffset: -0.3,
 *        build,
 *        rotatable: true,
 *        scalable: true,
 *      });
 *    });
 *
 * 已经放在场景里的 rock 节点会保留位置，之后放置的会自动用新模型。
 * ────────────────────────────────────────────────────────────── */
