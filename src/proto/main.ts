import * as THREE from 'three';
import GUI from 'lil-gui';
import { createSkyDome, type SkyUniforms } from './SkyMaterial';
import { createWaterMesh, type WaterUniforms } from './WaterMaterial';
import { createBoat } from './Boat';
import { getModelDef, registerModel } from '../editor/models';
import { loadGLTFExploded, loadGLTFModel, setMaxAnisotropy } from '../editor/loadGLTF';
import {
  initPhysics,
  stepPhysics,
  addStaticConvexCollider,
  createKinematicBoat,
} from './Physics';
import { FishingGame, FISH_PRESETS } from './FishingGame';
import { FishingRod } from './FishingRod';
import { HooksSystem } from './FishingHooks';
import { playerResources } from './PlayerResources';
import { playerActionPoints } from '../map/PlayerActionPoints';
import { BaitHUD } from '../ui/BaitHUD';
import { Minimap } from '../ui/Minimap';
import { FishShowcase } from '../ui/FishShowcase';
import { Inventory } from '../inventory/Inventory';
import { InventoryUI } from '../inventory/InventoryUI';
import { MapUI } from '../map/MapUI';
import { PortHubUI } from '../hub/PortHubUI';
import { ExpeditionController } from '../expedition/ExpeditionController';
import { hubState, type HubMode } from '../hub/HubState';
import { questState } from '../quest/QuestState';
import { QuestTrackerUI } from '../ui/QuestTrackerUI';
import type { MapNode } from '../map/mapNodes';
import {
  createStylizedMaterial,
  StylizedConfig,
  refreshStylizedGradient,
  refreshRimUniforms,
  refreshOutlineUniforms,
  setStylizedViewportHeight,
} from '../render/StylizedMaterial';
import { REFERENCE_ISLAND_PALETTE } from '../render/palettes';

// 编辑器点「试玩」会带 ?fromEditor=1 —— 重置行动点与鱼饵，避免沿用上次试玩消耗
if (new URLSearchParams(location.search).get('fromEditor') === '1') {
  playerResources.reset();
  playerActionPoints.reset();
}

/* ────────────────────────────────────────────────────────────
   基础渲染器 / 场景 / 相机
   ──────────────────────────────────────────────────────────── */

const app = document.getElementById('app') as HTMLDivElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const hintEl = document.getElementById('hint');

/** 关地图后回到哪里（从港口出海 vs 试玩中按 M） */
let mapCloseReturnsTo: HubMode = 'port_hub';

/** 仅在试玩模式显示 Three.js 场景，避免港口/地图切换时闪出画面 */
function syncPlayfieldVisibility() {
  const show3D = hubState.getMode() === 'play';
  app.style.visibility = show3D ? 'visible' : 'hidden';
  if (hintEl) hintEl.style.visibility = show3D ? 'visible' : 'hidden';
}
hubState.subscribe(() => syncPlayfieldVisibility());

/* ────────────────────────────────────────────────────────────
   16:9 画幅锁定
   #stage 是居中的固定 16:9 矩形（#viewport-frame 铺满窗口，黑色 letterbox）。
   渲染器 / 相机 / 深度 RT 全部按 #stage 的实际像素尺寸算，不再用 innerWidth/innerHeight，
   这样不管浏览器窗口比例如何，游戏画面本身（以及展示视频）永远是 16:9。
   ──────────────────────────────────────────────────────────── */
const GAME_ASPECT = 16 / 9;
function applyStageSize() {
  const ww = innerWidth;
  const wh = innerHeight;
  let w = ww;
  let h = w / GAME_ASPECT;
  if (h > wh) {
    h = wh;
    w = h * GAME_ASPECT;
  }
  stage.style.width = `${Math.round(w)}px`;
  stage.style.height = `${Math.round(h)}px`;
}
applyStageSize();
function stageWidth() { return stage.clientWidth || 1; }
function stageHeight() { return stage.clientHeight || 1; }

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(stageWidth(), stageHeight());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// 拉满贴图各向异性 —— 消除斜视角 moire/锯齿（对导入的 glTF 生效）
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, stageWidth() / stageHeight(), 0.1, 2000);

/* ────────────────────────────────────────────────────────────
   光照
   ──────────────────────────────────────────────────────────── */

const sun = new THREE.DirectionalLight('#fff2c4', 1.4);
sun.position.set(40, 45, 60);
sun.castShadow = true;
// 4K 阴影贴图 + 相对更紧凑的正交框（30m² 范围），
// 每 texel 覆盖 0.015m —— 足以支撑船级别的细节自阴影
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
// 进一步加大 bias —— 解决甲板/驾驶舱曲面上的平行条纹自阴影 artifact
sun.shadow.bias = -0.0012;
sun.shadow.normalBias = 0.10;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight('#a8d5e2', '#3d6f68', 0.6);
scene.add(hemi);

/* ────────────────────────────────────────────────────────────
   天空盒
   ──────────────────────────────────────────────────────────── */

const sky = createSkyDome(900);
const skyU = sky.material.uniforms as unknown as SkyUniforms;
scene.add(sky.mesh);

/* ────────────────────────────────────────────────────────────
   水面
   ──────────────────────────────────────────────────────────── */

const water = createWaterMesh(600, 280);
const waterU = water.material.uniforms as unknown as WaterUniforms;
waterU.uCameraNear.value = camera.near;
waterU.uCameraFar.value = camera.far;
scene.add(water.mesh);

/* ────────────────────────────────────────────────────────────
   海底 seabed（让"水深"有物理意义，形成近浅远深的自然渐变）
   ──────────────────────────────────────────────────────────── */

{
  const seabedGeo = new THREE.PlaneGeometry(800, 800, 60, 60);
  seabedGeo.rotateX(-Math.PI / 2);
  const pos = seabedGeo.attributes.position;
  // 让海底有起伏，让透明水面下的地形有变化
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const bump =
      Math.sin(x * 0.08) * 0.4 +
      Math.cos(z * 0.09) * 0.35 +
      Math.sin((x + z) * 0.13) * 0.25;
    pos.setY(i, bump);
  }
  seabedGeo.computeVertexNormals();
  const seabedMat = createStylizedMaterial({
    color: '#d9c396', // 米沙色，透过明亮水色会呈现蓝绿
    flatShading: true,
  });
  const seabed = new THREE.Mesh(seabedGeo, seabedMat);
  seabed.position.y = -3.2;
  seabed.name = 'seabed';
  seabed.receiveShadow = true;
  seabed.userData.noOutline = true;   // 大平面加描边会出现远处黑框
  scene.add(seabed);
}

/* ────────────────────────────────────────────────────────────
   礁石 / 岛礁 —— 从编辑器保存的场景（localStorage）动态加载
   ──────────────────────────────────────────────────────────── */

const editorSceneGroup = new THREE.Group();
editorSceneGroup.name = 'editor-scene';
scene.add(editorSceneGroup);

/** 圆柱碰撞体（XZ 平面圆 + 底/顶高度），用于 boat vs rocks 简易碰撞检测（fallback） */
interface Collider { x: number; z: number; r: number }
const colliders: Collider[] = [];

/** 钓鱼海域运行时数据 —— 玩家在海域内自由抛竿 */
export interface FishingZone {
  id: string;
  x: number;
  z: number;
  radius: number;
  tier: 'common' | 'rare' | 'lair';
  name: string;
  object: THREE.Object3D;   // 场景中的可视化 mesh（含波纹 shader tick）
}
const fishingZones: FishingZone[] = [];
// 当前船身在其内的钓鱼海域（每帧刷新），null = 不在任何一个海域
let activeFishingZone: FishingZone | null = null;

/** 港口补给圈 —— 玩家进入自动补满鱼饵 */
interface PortRefill {
  id: string;
  x: number;
  z: number;
  radius: number;
  object: THREE.Object3D;
}
const portRefills: PortRefill[] = [];
let activePortRefill: PortRefill | null = null;

// Rapier 就绪状态
const physics = {
  ready: false,
  boatBody: null as ReturnType<typeof createKinematicBoat>['body'] | null,
  boatController: null as ReturnType<typeof createKinematicBoat>['controller'] | null,
  boatCollider: null as ReturnType<typeof createKinematicBoat>['collider'] | null,
};

interface EditorNodeData {
  id: string;
  modelId: string;
  col: number;
  row: number;
  rotationY: number;
  scale: number;
  yOffset?: number;
  name?: string;
}
interface EditorSceneData {
  version: number;
  name: string;
  grid: { cellSize: number; cols: number; rows: number };
  nodes: EditorNodeData[];
}

function cellToWorldFromGrid(
  col: number,
  row: number,
  grid: { cellSize: number; cols: number; rows: number },
) {
  const halfW = (grid.cellSize * grid.cols) / 2;
  const halfH = (grid.cellSize * grid.rows) / 2;
  return {
    x: -halfW + (col + 0.5) * grid.cellSize,
    z: -halfH + (row + 0.5) * grid.cellSize,
  };
}

/** 将编辑器里「起点（船）」节点的位置/朝向同步到试玩场景的船体（须在 createBoat 之后调用）。 */
function applyBoatSpawnFromEditorScene(
  boatObj: THREE.Object3D,
  kin: { heading: number },
): void {
  const raw = localStorage.getItem('lure-editor-scene-v1');
  if (!raw) return;
  let data: EditorSceneData;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const spawnNode = data.nodes.find((nd) => nd.modelId === 'spawn');
  if (!spawnNode) return;

  const grid = data.grid ?? { cellSize: 4, cols: 24, rows: 24 };
  const { x, z } = cellToWorldFromGrid(spawnNode.col, spawnNode.row, grid);
  const def = getModelDef('spawn');
  const y = spawnNode.yOffset ?? def?.yOffset ?? 0;

  boatObj.position.set(x, y, z);
  boatObj.rotation.y = spawnNode.rotationY;
  kin.heading = spawnNode.rotationY;
  console.log(
    `[proto] 船起点已同步：(${x.toFixed(1)}, ${z.toFixed(1)}), heading=${spawnNode.rotationY.toFixed(2)}`,
  );
}

// 通用外部 glTF 引导 —— 礁石 / 小岛 都走这里；与编辑器版本保持接口一致
async function bootstrapExternalGltf(cfg: {
  url: string;
  id: string;
  name: string;
  swatch: string;
  fitSize: number;
  /** 模型库分类；default 'obstacle' */
  category?: 'nav' | 'obstacle' | 'landmark' | 'entity' | 'fishing_spot' | 'fishing_zone' | 'port_refill';
  /** baseColor 乘子；可用 RGB 分通道增益调节色温 */
  colorMultiply?: number | string | THREE.Color;
  /** 色板重映射（HSL 分类替换 baseColor），见 src/render/palettes.ts */
  paletteRemap?: import('../editor/loadGLTF').PaletteRemap;
  /** 降低暖色光照影响并对贴图去饱和 */
  surfaceResponse?: import('../render/StylizedMaterial').StylizedSurfaceResponse;
  /** 命中 palette 时是否剥掉 .map（默认 false —— UV 图集模型不要开） */
  stripBaseMap?: boolean;
}) {
  try {
    const parts = await loadGLTFExploded(cfg.url, {
      fitSize: cfg.fitSize,
      stylize: true,          // 3渲2 化，保留贴图/法线/AO
      groundYToZero: true,
      centerXZ: true,
      colorMultiply: cfg.colorMultiply ?? 1.0,
      paletteRemap: cfg.paletteRemap,
      surfaceResponse: cfg.surfaceResponse,
      stripBaseMap: cfg.stripBaseMap,
    });
    const category = cfg.category ?? 'obstacle';
    if (parts.length === 1) {
      registerModel({
        id: cfg.id, name: cfg.name, swatch: cfg.swatch,
        category, yOffset: parts[0].suggestedYOffset,
        build: parts[0].build, rotatable: true, scalable: true,
      });
    } else if (parts.length > 1) {
      parts.forEach((p, i) => {
        registerModel({
          id: `${cfg.id}_${i + 1}`, name: `${cfg.name} #${i + 1}`,
          swatch: cfg.swatch, category,
          yOffset: p.suggestedYOffset, build: p.build,
          rotatable: true, scalable: true,
        });
      });
    }
  } catch {
    console.warn(`[proto] ${cfg.url} 未找到，跳过`);
  }
}

async function loadEditorScene() {
  // 0) 先启动物理（并行加载 glTF）
  const physicsPromise = initPhysics().then(() => {
    // 物理就绪后创建船的 kinematic body（船已在下面 top-level 建了 mesh）
    // 船体尺寸参考 Boat.ts：X（船长）-3 ~ +5（含船首），Y ≈ 0，Z ±2
    //   半尺寸 (4.0, 0.7, 2.2)，中心偏移 +1 X（船头偏心）
    //   略微放大一点（+0.1）给安全余量，避免视觉贴脸时看到穿模
    const t = boat.position;
    const { body, controller, collider } = createKinematicBoat(
      new THREE.Vector3(4.1, 0.7, 2.3),
      new THREE.Vector3(1.0, 0.0, 0.0),
      new THREE.Vector3(t.x, t.y, t.z),
    );
    physics.boatBody = body;
    physics.boatController = controller;
    physics.boatCollider = collider;
    physics.ready = true;
    console.log('[proto] physics ready');
  }).catch((e) => console.warn('[proto] physics init failed', e));

  // 1) 拉起编辑器用到的外部 glTF —— 礁石 3 档 + 小岛 2 档
  await Promise.all([
    // 礁石：走 obstacle，参与船体碰撞
    bootstrapExternalGltf({ url: '/models/rock_small.glb',  id: 'rock_small',  name: '礁石(小)', swatch: '#cbd0d2', fitSize: 2.5, category: 'obstacle', colorMultiply: 1.75, surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' } }),
    bootstrapExternalGltf({ url: '/models/rock_medium.glb', id: 'rock',        name: '礁石(中)', swatch: '#d5d9da', fitSize: 4.0, category: 'obstacle', colorMultiply: 1.75, surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' } }),
    bootstrapExternalGltf({ url: '/models/rock_large.glb',  id: 'rock_large',  name: '礁石(大)', swatch: '#e3e6e6', fitSize: 8.0, category: 'obstacle', colorMultiply: 1.75, surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' } }),
    // 小岛：走 landmark，尺寸更大，暂不走碰撞（如需要后续挂 collider）
    // 小/中走参考图配色重映射；大保留原贴图
    bootstrapExternalGltf({ url: '/models/island_small.glb',  id: 'island_small',  name: '小岛(小)', swatch: '#c8b585', fitSize: 5.0,  category: 'landmark', colorMultiply: 1.50, paletteRemap: REFERENCE_ISLAND_PALETTE, surfaceResponse: { lightInfluence: 0.72, shadowLift: 0.48, shadowTint: '#80684f' } }),
    bootstrapExternalGltf({ url: '/models/island_medium.glb', id: 'island_medium', name: '小岛(中)', swatch: '#b7a06f', fitSize: 9.0,  category: 'landmark', colorMultiply: 1.50, paletteRemap: REFERENCE_ISLAND_PALETTE, surfaceResponse: { lightInfluence: 0.72, shadowLift: 0.48, shadowTint: '#80684f' } }),
    physicsPromise,
  ]);

  // 2) 读取编辑器保存的场景
  const raw = localStorage.getItem('lure-editor-scene-v1');
  if (!raw) {
    console.log('[proto] 未检测到编辑器场景，跳过');
    return;
  }
  let data: EditorSceneData;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('[proto] 编辑器场景 JSON 解析失败', e);
    return;
  }

  // 3) 网格 → 世界坐标（复用编辑器的规则）
  const grid = data.grid ?? { cellSize: 4, cols: 24, rows: 24 };
  const cellToWorld = (col: number, row: number) => cellToWorldFromGrid(col, row, grid);

  // 4) 实例化每个 node（跳过 glTF 拆分遗留的空白变体，迁移旧 #1 id）
  const skipModelIds = new Set(['island_medium_2', 'island_large', 'island_large_1', 'island_large_2']);
  const modelIdMigrations: Record<string, string> = {
    island_medium_1: 'island_medium',
  };
  let placed = 0;
  for (const nd of data.nodes) {
    if (skipModelIds.has(nd.modelId)) continue;
    const modelId = modelIdMigrations[nd.modelId] ?? nd.modelId;
    // 起点节点只驱动试玩船体，不重复放置编辑器里的标记模型
    if (modelId === 'spawn') continue;
    const def = getModelDef(modelId);
    if (!def) {
      console.warn(`[proto] 跳过未知模型 ${nd.modelId}`);
      continue;
    }
    const obj = def.build();
    const { x, z } = cellToWorld(nd.col, nd.row);
    const y = nd.yOffset ?? def.yOffset;
    obj.position.set(x, y, z);
    obj.rotation.y = nd.rotationY;
    obj.scale.setScalar(nd.scale);
    editorSceneGroup.add(obj);

    // 为障碍物类模型生成物理碰撞体
    if (def.category === 'obstacle') {
      obj.updateMatrixWorld(true);
      // ① Rapier convex hull（严格贴合模型外形）
      if (physics.ready) addStaticConvexCollider(obj);
      // ② 附带的简易 XZ 圆柱数据（用于 fallback / 调试可视化）
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const r = ((size.x + size.z) * 0.25) * 0.85;
      if (r > 0.1) colliders.push({ x, z, r });
    }

    // 钓鱼海域（新版）：登记到 fishingZones
    if (def.category === 'fishing_zone') {
      const tier = def.zoneTier ?? 'common';
      const label = def.name ?? '钓鱼海域';
      // 玩家缩放会同步生效 —— 海域实际半径 = def.triggerRadius * nd.scale
      const effRadius = (def.triggerRadius ?? 28) * nd.scale;
      fishingZones.push({
        id: nd.id,
        x, z,
        radius: effRadius,
        tier,
        name: nd.name ?? label,
        object: obj,
      });
      // 试玩里隐藏海域的可视 mesh（圆盘/边界/波纹）—— 玩家只应看到"水面上偶尔出现的
      // 涟漪 & 气泡"这种自然暗示，边界圈交给右下角 minimap
      obj.visible = false;
    }

    // 老"钓鱼点"数据 —— 迁移成 fishing_zone（半径拉大到跟新版一致，
    // 老场景不用重新摆也能有大海域）
    if (def.category === 'fishing_spot') {
      fishingZones.push({
        id: nd.id,
        x, z,
        radius: 55 * nd.scale,   // 与 DEFAULT_FISHING_ZONE_RADIUS 一致
        tier: 'common',
        name: nd.name ?? '钓鱼海域',
        object: obj,
      });
      // 隐藏老的浮标 + 灯 + 蓝圈 —— 玩家看不到，只保留 runtime 数据
      obj.visible = false;
    }

    // 港口补给圈
    if (def.category === 'port_refill') {
      portRefills.push({
        id: nd.id,
        x, z,
        radius: (def.triggerRadius ?? 10) * nd.scale,
        object: obj,
      });
    }

    placed++;
  }
  console.log(
    `[proto] 编辑器场景已加载：${placed} 个物件，${colliders.length} 个碰撞体，`
    + `${fishingZones.length} 个钓鱼海域，${portRefills.length} 个补给圈（"${data.name}"）`,
  );
}

// 后台加载 —— 不阻塞渲染；加载完再实例化 hooks / minimap（依赖 fishingZones）
loadEditorScene().then(() => {
  fishingHooks = new HooksSystem(scene, fishingZones);
  minimap = new Minimap(stage);   // 挂到 #stage，限制在 16:9 游戏画幅内
  console.log(`[proto] hooks + minimap ready，zones=${fishingZones.length}`);
});

/* ────────────────────────────────────────────────────────────
   船 —— 使用波高采样，物理浮在水面上（不会被浪盖过）
   ──────────────────────────────────────────────────────────── */

const boat = createBoat();
boat.rotation.order = 'YXZ';   // 先转 yaw、再叠 pitch/roll，避免 wave 起伏时 heading 被歪掉
scene.add(boat);

// 外部船模型的显示校准。运动、浮力、相机和碰撞仍统一挂在 boat Group 上。
// glTF 通常以 -Z 为船首；转 -90° 后对齐本项目的局部 +X 船首方向。
const BOAT_MODEL = {
  url: '/models/boat.glb',
  fitSize: 8.0,
  yawOffset: -Math.PI / 2,
  // 与 BOAT_FREEBOARD 组合决定吃水深度：
  //   hull_bottom_world = waveY + BOAT_FREEBOARD + visualYOffset
  //   visualYOffset = +0.10 → 完全脱离水面，杜绝水面 shader 从船身"穿透"
  visualYOffset: 0.10,
  // 提亮 glTF baseColor（1.0 = 原色，>1.0 变亮）；与之前石头 2.4 类似
  colorMultiply: 1.8,
};

async function replaceBoatWithGltf() {
  try {
    const build = await loadGLTFModel(BOAT_MODEL.url, {
      fitSize: BOAT_MODEL.fitSize,
      groundYToZero: true,
      centerXZ: true,
      stylize: true,          // ← 走 StylizedMaterial：顺带解决 PBR envMap 造成的"流动纹"
      shadows: true,
      colorMultiply: BOAT_MODEL.colorMultiply,
    });
    const importedBoat = build();
    importedBoat.name = 'imported-boat-model';
    importedBoat.rotation.y = BOAT_MODEL.yawOffset;
    importedBoat.position.y = BOAT_MODEL.visualYOffset;

    // 材质净化：
    //  - 强制不透明（glTF 里被误标 BLEND/MASK 的面会让水面 shader 穿透进来）
    //  - 关掉金属度、拉满粗糙度（无 env map 时 PBR 反射会产生"流动"般伪影）
    //  - 关闭环境贴图和 emissive map（避免任何依赖环境采样的效果）
    //  - 提高 renderOrder，保证在水面之后绘制
    //  - receiveShadow = false —— 船体保留 castShadow（在水/石头上会有影子），
    //    但不接收自阴影，杜绝甲板/驾驶舱曲面的 shadow acne 条纹
    // 注意：不能强制 FrontSide —— 该模型很多面法线朝内，一剔就消失
    importedBoat.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const mat = m as THREE.MeshStandardMaterial;
        mat.transparent = false;
        mat.depthWrite = true;
        mat.depthTest = true;
        mat.alphaTest = 0;
        if ('metalness' in mat) mat.metalness = 0;
        if ('roughness' in mat) mat.roughness = 1;
        if ('metalnessMap' in mat) mat.metalnessMap = null;
        if ('roughnessMap' in mat) mat.roughnessMap = null;
        if ('envMap' in mat) mat.envMap = null;
        if ('envMapIntensity' in mat) mat.envMapIntensity = 0;
        mat.needsUpdate = true;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.renderOrder = 10;
    });

    // 只移除旧的程序化船件，保留后续挂上来的 cameraRig / 物理挂点等
    for (const child of [...boat.children]) {
      if (child.name === 'camera-rig') continue;
      if (child.name === 'imported-boat-model') continue;
      boat.remove(child);
    }
    boat.add(importedBoat);
    console.log('[proto] 已加载外部船模型', BOAT_MODEL.url);
  } catch (e) {
    console.warn(`[proto] 船模型 ${BOAT_MODEL.url} 加载失败，继续使用程序化后备模型`, e);
  }
}

void replaceBoatWithGltf();

// 船的干舷（船底距水面的高度）——保证甲板始终在最大波峰之上
const BOAT_FREEBOARD = 0.55;
// 船的碰撞半径（大致的水线宽度，用于 vs 礁石圆柱检测）
const BOAT_RADIUS = 1.8;

/* ────────────────────────────────────────────────────────────
   船 · 运动学 · WASD 控制
   ──────────────────────────────────────────────────────────── */

const boatKin = {
  heading: 0,     // 船首朝向（rad），沿世界坐标 y 轴
  speed: 0,       // 当前前进速度（m/s，可为负表示倒车）
  turnRate: 0,    // 当前转向角速度（rad/s）
};

// 物理 init 在 loadEditorScene 里并行启动；此处尽早同步起点，确保 kinematic body 用正确坐标创建
applyBoatSpawnFromEditorScene(boat, boatKin);

/**
 * 船 · 运动学 —— 推力/阻力物理仿真（非线性 ease-in / ease-out）
 *
 * 速度方程：  dv/dt = F_thrust + F_drag
 *   F_thrust = W/S 键给出的推力（正/反）
 *   F_drag   = -sign(v) * (k_quad · v² + k_lin · |v|)
 *              → 二次阻力占主导（水阻），线性项让静止收敛更快
 *
 * 起步：v 小 → drag 很小 → 加速快
 * 接近极速：v 大 → drag ≈ thrust → 加速慢，平滑逼近
 * 松手：thrust=0，drag 单独减速；v 大时快、v 小时缓，最后自然停下
 *
 * 转向用同一套模型（角速度 + 角阻力），手感自然一致
 *
 * 终极速度 = sqrt((thrust - lin*v) / quad)
 * 当前默认：前进 ≈ 3.0 m/s，倒车 ≈ 2.0 m/s，最大转向 ≈ 1.05 rad/s
 */
const BOAT_TUNE = {
  // 平移 —— 极速 ≈ sqrt(thrustForward / dragQuadratic) ≈ 5.3 m/s
  thrustForward:  20.0,   // 前进推力（W 按下时）
  thrustReverse: 11.0,   // 倒车推力（S 按下时，比前进弱）
  dragQuadratic:  0.7,   // 二次阻力系数（主要阻尼）
  dragLinear:     0.4,   // 线性阻力系数（低速时收敛更干净）
  slowThrustMult: 0.35,  // Shift 慢速档：推力 × 0.35 → 极速降到 ≈ 3 m/s

  // 转向 —— 极速 ≈ sqrt(turnThrust / turnDragQuadratic) ≈ 0.5 rad/s
  turnThrust:        1.6,
  turnDragQuadratic: 5.5,
  turnDragLinear:    2.5,
};

// 零速钳位阈值：无输入且速度低于此值时强制归零 —— 杜绝浮点残留造成的漂移
const ZERO_CLAMP_SPEED    = 0.05;
const ZERO_CLAMP_TURNRATE = 0.03;

const keys = { w: false, a: false, s: false, d: false, shift: false };
function isTypingTarget(el: EventTarget | null) {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}
addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();

  // 键位状态永远跟随物理按键 —— 不管 UI 开没开，keydown/keyup 都要如实记录。
  // 这样解决了"按住 W → 弹出 UI → 关掉 UI → 继续按住 W 却不动"的卡键 bug：
  // 之前 UI 打开时会 return 掉 keydown 并清零 keys，导致关掉 UI 后即使物理键还按着，
  // 浏览器也不会再发新的 keydown（键从未 release 过），船就永远不动了。
  // → 现在 keys 永远真实反映键盘状态，"是否施力到船上"改由 tick 循环里
  //   `boatInputActive = !isUiBusy()` 兜底判断。
  if (k === 'w') keys.w = true;
  else if (k === 's') keys.s = true;
  else if (k === 'a') keys.a = true;
  else if (k === 'd') keys.d = true;
  else if (k === 'shift') keys.shift = true;

  // 只有"会触发新动作"的功能键需要按 UI 状态屏蔽（避免开着背包又按 F 二次开钓鱼）
  if (inventoryUI.isOpen()) return;   // 背包打开时功能键全交给 InventoryUI 自己
  if (portHub.isOpen() || portHub.isDialogueOpen()) return;
  if (mapUI.isOpen()) return;         // 地图打开时 M/Esc 由 MapUI 自己处理，其它功能键忽略
  if (expedition.isActive()) return;  // 探险中按键由 ExpeditionController 处理
  if (isFishingBusy() && (k === 'f')) return;   // 钓鱼中禁重复触发 F

  if (k === 'f') tryStartFishing();
  else if (k === 'i') inventoryUI.toggle();
  else if (k === 'm') tryOpenMapOrPort();
  // ── 调试快捷键 ──
  else if (k === 'h') {
    water.mesh.visible = !water.mesh.visible;
    console.log('[debug] water visible =', water.mesh.visible);
  }
  else if (k === 'j') {
    sun.castShadow = !sun.castShadow;
    console.log('[debug] sun shadow =', sun.castShadow);
  }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  else if (k === 's') keys.s = false;
  else if (k === 'a') keys.a = false;
  else if (k === 'd') keys.d = false;
  else if (k === 'shift') keys.shift = false;
});

// 窗口失焦 / tab 被切走：浏览器不会补发 keyup，容易残留"幽灵按键"
// （回来时物理键其实没按，keys.w 却还是 true，船会自己跑）——
// 主动把所有 keys 清零兜底。
function clearAllKeys() {
  keys.w = keys.s = keys.a = keys.d = keys.shift = false;
}
addEventListener('blur', clearAllKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearAllKeys();
});

// ── 让"点游戏窗口就能重新获得键盘焦点" ─────────────────────────
// 症状：在 Cursor 内嵌浏览器 / 分屏调试等场景下，鼠标点击 letterbox 黑边、
// UI 关闭后的 body 等非交互元素，document.hasFocus() 会保持 false，
// 于是玩家按 WASD 键盘事件根本到不了这个 tab。
// → 给 body 打上 tabIndex 使其可编程 focus；任何鼠标 mousedown 都主动
//   window.focus() + document.body.focus()，让键盘输入被"抢"回游戏。
//   （编辑器/输入框场景不受影响 —— 玩家点进 <input> 时浏览器会自己接管焦点）
document.body.tabIndex = -1;
addEventListener('mousedown', () => {
  if (!document.hasFocus()) {
    try { window.focus(); } catch {}
    try { document.body.focus({ preventScroll: true }); } catch {}
  }
}, true);

/**
 * JS 端复刻 shader 里的 Gerstner 波高（世界坐标）
 * shader 现在也用世界 xz 计算，两端结果一致，船能完美贴合水面
 */
function gerstnerHeight(
  wave: THREE.Vector4,
  x: number,
  z: number,
  t: number,
): number {
  const len = Math.hypot(wave.x, wave.y);
  if (len < 1e-4) return 0;
  const nx = wave.x / len;
  const ny = wave.y / len;
  const k = (Math.PI * 2) / wave.w;
  const c = Math.sqrt(9.8 / k);
  const f = k * (nx * x + ny * z - c * t);
  const a = wave.z / k;
  return a * Math.sin(f);
}

function waterHeightAt(worldX: number, worldZ: number, t: number): number {
  return (
    gerstnerHeight(waterU.uWaveA.value, worldX, worldZ, t) +
    gerstnerHeight(waterU.uWaveB.value, worldX, worldZ, t)
  );
}

// 相机绑到船上（第一人称：站在船头稍靠后）
const cameraRig = new THREE.Object3D();
cameraRig.name = 'camera-rig';
// 相机往船头方向推 —— 让第一人称视角靠近船头，
// 鱼竿基座（camera 子节点，local -Z=1.15m）看起来自然"从船头伸出"，而不是悬空
cameraRig.position.set(1.7, 1.9, 0);
cameraRig.rotation.y = -Math.PI / 2;
boat.add(cameraRig);
cameraRig.add(camera);
camera.position.set(0, 0, 0);
camera.rotation.order = 'YXZ';
camera.rotation.set(0, 0, 0);

/* ────────────────────────────────────────────────────────────
   场景 RenderTarget（同时含 color + depth，供水面 shader 采样）
   Pass1: 隐藏水面渲染到 sceneRT → 获取水下颜色 + 深度
   Pass2: 显示水面正常渲染 → 水面 shader 采样 sceneRT
   ──────────────────────────────────────────────────────────── */

function createSceneRT(w: number, h: number): THREE.WebGLRenderTarget {
  const depthTex = new THREE.DepthTexture(w, h);
  depthTex.type = THREE.UnsignedIntType;
  depthTex.format = THREE.DepthFormat;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    depthTexture: depthTex,
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  return rt;
}

let sceneRT = createSceneRT(
  Math.floor(stageWidth() * renderer.getPixelRatio()),
  Math.floor(stageHeight() * renderer.getPixelRatio()),
);
waterU.uDepthTexture.value = sceneRT.depthTexture;
waterU.uSceneColorTexture.value = sceneRT.texture;
waterU.uResolution.value.set(sceneRT.width, sceneRT.height);

/* ────────────────────────────────────────────────────────────
   鼠标环视
   ──────────────────────────────────────────────────────────── */

const LOOK_TUNE = {
  sensitivityYaw:   0.0022,   // 鼠标 →  yaw   —— 越大越灵敏（原 0.005）
  sensitivityPitch: 0.0018,   // 鼠标 →  pitch —— 越大越灵敏（原 0.004）
  followLerp:       0.10,     // 目标 → 实际的插值率（越大越紧，越小越顺滑）
  pitchMin: -0.8,
  pitchMax:  0.6,
};

/**
 * 钓鱼期间镜头 / 鱼竿的硬限位（相对"抛竿瞬间"锚点方向）。
 *   - Yaw 允许左右各 28°（比鱼把浮标带走的 20° 世界摆幅多一点余量，
 *     镜头能顺畅跟随，但幅度明显收敛 —— 之前 55° 会出现"鱼一发力鱼竿
 *     跟着镜头一起横扫半个屏幕"的过激动作，现在鱼竿只在中央附近轻晃）
 *   - Pitch 保留原先的绝对值限位（下 17° / 上 8°），因为俯仰不涉及绕圈问题
 */
const FISHING_MAX_YAW_DEV = 28 * Math.PI / 180;
const FISHING_PITCH_MIN   = -0.30;
const FISHING_PITCH_MAX   =  0.15;

/** 把任意角度归一到 (-π, π] —— 用来算"最短角差"，避免绕远路 */
function wrapAngle(a: number): number {
  while (a >   Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

const lookState = {
  yaw: 0,
  pitch: -0.05,
  targetYaw: 0,
  targetPitch: -0.05,
  dragging: false,
  lastX: 0,
  lastY: 0,
  /** 钓鱼时保存进入前的目标角度，钓完恢复 */
  savedYaw: 0,
  savedPitch: -0.05,
  wasFishing: false,
  /**
   * 抛竿瞬间的镜头 yaw —— 作为整个钓鱼过程中镜头/鱼竿旋转的"锚点"。
   * 每帧都把 yaw 硬 clamp 在 [anchor - MAX, anchor + MAX] 里，
   * 保证任何极端数值情况都不会让画面猛甩一大圈。
   */
  fishingAnchorYaw: 0,
};

// canvas 本身可获取焦点 —— 玩家点游戏画面就能拿到键盘焦点
renderer.domElement.tabIndex = 0;
(renderer.domElement.style as any).outline = 'none';   // 去掉 tabIndex 带来的焦点虚线框
renderer.domElement.addEventListener('mousedown', (e) => {
  // 任何在 canvas 上的鼠标按下都主动拿一次焦点 ——
  // 修复"关掉背包后 hasFocus=false 导致 WASD 不响应"的场景
  try { renderer.domElement.focus({ preventScroll: true }); } catch {}
  if (isUiBusy()) return;   // 钓鱼中或背包打开时 UI 捕获鼠标，不启动环视
  lookState.dragging = true;
  lookState.lastX = e.clientX;
  lookState.lastY = e.clientY;
});
addEventListener('mouseup', () => (lookState.dragging = false));
addEventListener('mousemove', (e) => {
  if (isUiBusy()) return;   // 钓鱼中或背包中鼠标全部交给对应 UI
  if (!lookState.dragging) return;
  const dx = e.clientX - lookState.lastX;
  const dy = e.clientY - lookState.lastY;
  lookState.lastX = e.clientX;
  lookState.lastY = e.clientY;
  lookState.targetYaw   -= dx * LOOK_TUNE.sensitivityYaw;
  lookState.targetPitch -= dy * LOOK_TUNE.sensitivityPitch;
  lookState.targetPitch = Math.max(LOOK_TUNE.pitchMin, Math.min(LOOK_TUNE.pitchMax, lookState.targetPitch));
});

renderer.domElement.addEventListener('wheel', (e) => {
  const fov = camera.fov + Math.sign(e.deltaY) * 2;
  camera.fov = Math.max(35, Math.min(85, fov));
  camera.updateProjectionMatrix();
}, { passive: true });

/* ────────────────────────────────────────────────────────────
   时段 preset
   ──────────────────────────────────────────────────────────── */

const params = {
  sailingSpeed: 1.0,
  flowSpeed: 0.08,   // 水面流动亮纹速度（纯视觉，不影响船），默认调低减少"水流推船"错觉
  waveScale: 1.0,
  timeOfDay: 'noon' as 'noon' | 'golden' | 'dusk' | 'night',
  exposure: 1.0,
};

type TimePresetName = typeof params.timeOfDay;
const PRESET_NAMES: TimePresetName[] = ['noon', 'golden', 'dusk', 'night'];

interface PresetPalette {
  sunDir: THREE.Vector3;
  zenith: string;
  horizon: string;
  ground: string;
  sun: string;
  shallow: string;
  deep: string;
  foam: string;
  streak: string;
  sunLight: number;
  hemi: number;
}

const presets: Record<TimePresetName, PresetPalette> = {
  // 用户 GUI 调整后固化的 noon preset —— 手游卡通亮蓝海面
  noon: {
    sunDir: new THREE.Vector3(0.15, 0.95, 0.28),
    zenith:  '#5bb8e6',   // 天顶：饱和蓝
    horizon: '#c8ecf7',   // 地平：淡青
    ground:  '#7cbccf',   // 地面反射（半球光下半）
    sun:     '#fffbe5',   // 阳光：暖白（趋近纯白）
    shallow: '#8ed8ea',   // 浅水：明亮青
    deep:    '#3e94c4',   // 深水：中调蓝
    foam:    '#ffffff',
    streak:  '#ffffff',
    sunLight: 1.4, hemi: 0.5,
  },
  golden: {
    sunDir: new THREE.Vector3(0.75, 0.32, 0.55),
    zenith: '#5aa8d6', horizon: '#ffd6a5', ground: '#8fb9b4', sun: '#fff2c4',
    shallow: '#8ee6d8', deep: '#1d6b7d', foam: '#fff4df', streak: '#ffe9bd',
    sunLight: 1.4, hemi: 0.55,
  },
  dusk: {
    sunDir: new THREE.Vector3(0.9, 0.15, 0.4),
    zenith: '#3d5a80', horizon: '#ee6c4d', ground: '#4a4e69', sun: '#ffb385',
    shallow: '#5fbfb7', deep: '#183e50', foam: '#ffd6bd', streak: '#ff9d74',
    sunLight: 1.1, hemi: 0.35,
  },
  night: {
    sunDir: new THREE.Vector3(0.3, 0.4, 0.6),
    zenith: '#0b1e3a', horizon: '#264a6d', ground: '#0a1622', sun: '#a6c6ff',
    shallow: '#296e70', deep: '#04202a', foam: '#8db8cc', streak: '#54a8b8',
    sunLight: 0.4, hemi: 0.15,
  },
};

function syncSun() {
  const dir = new THREE.Vector3().copy(sun.position).normalize();
  skyU.uSunDirection.value.copy(dir);
  waterU.uSunDirection.value.copy(dir);
  waterU.uHorizonColor.value.copy(skyU.uHorizonColor.value);
  waterU.uZenithColor.value.copy(skyU.uZenithColor.value);
  waterU.uSunColor.value.copy(skyU.uSunColor.value);

  // 天空 shader 与 Three.js 场景灯光原本是两套独立颜色。
  // 将实际照亮模型的太阳光、半球环境光同步到当前天空色，
  // 让 dusk / night 下的三渲二模型真正受到红紫/深蓝环境影响。
  sun.color.copy(skyU.uSunColor.value);
  hemi.color.copy(skyU.uZenithColor.value).lerp(skyU.uHorizonColor.value, 0.65);
  hemi.groundColor.copy(skyU.uGroundColor.value);
}

/* ────────────────────────────────────────────────────────────
   Preset 快照 / 持久化（localStorage）
   —— noon / golden / dusk / night 各自保存完整参数，互不覆盖
   ──────────────────────────────────────────────────────────── */

const PRESET_STORAGE_KEY = 'lure-proto-time-presets-v1';
const LEGACY_NOON_STORAGE_KEY = 'lure-proto-noon-preset-v2';

interface Snapshot {
  sky: {
    zenith: string; horizon: string; ground: string; sun: string;
    /** 风格化云（可选 —— 老存档没有时用默认值） */
    clouds?: {
      coverage: number; softness: number; scale: number; speed: number;
      height: number; opacity: number;
      color: string; shadowColor: string;
    };
  };
  water: {
    shallow: string; deep: string; foam: string; streak: string;
    fresnelStrength: number; sunSpecSharpness: number; sunSpecStrength: number;
    absorptionCoef: number; tintCoef: number;
    foamDistance: number; foamSoftness: number; foamNoiseStrength: number;
    streakScale: number; streakThreshold: number; streakSoftness: number; streakStrength: number;
  };
  light: { sunLight: number; hemi: number; sunDir: [number, number, number] };
  runtime: { sailingSpeed: number; flowSpeed: number; waveScale: number; exposure: number };
  look?: { sensitivityYaw: number; sensitivityPitch: number; followLerp: number };
  boat?: {
    thrustForward: number; thrustReverse: number;
    dragQuadratic: number; dragLinear: number; slowThrustMult: number;
    turnThrust: number; turnDragQuadratic: number; turnDragLinear: number;
  };
  stylized?: {
    bands: Array<[number, number, number]>;   // 4 段光照色带
    rimColor: [number, number, number];
    rimStrength: number;
    rimPower: number;
    outlineColor?: string;
    outlineThickness?: number;
  };
}

function captureSnapshot(): Snapshot {
  return {
    sky: {
      zenith:  '#' + skyU.uZenithColor.value.getHexString(),
      horizon: '#' + skyU.uHorizonColor.value.getHexString(),
      ground:  '#' + skyU.uGroundColor.value.getHexString(),
      sun:     '#' + skyU.uSunColor.value.getHexString(),
      clouds: {
        coverage:    skyU.uCloudCoverage.value,
        softness:    skyU.uCloudSoftness.value,
        scale:       skyU.uCloudScale.value,
        speed:       skyU.uCloudSpeed.value,
        height:      skyU.uCloudHeight.value,
        opacity:     skyU.uCloudOpacity.value,
        color:       '#' + skyU.uCloudColor.value.getHexString(),
        shadowColor: '#' + skyU.uCloudShadowColor.value.getHexString(),
      },
    },
    water: {
      shallow: '#' + waterU.uShallowColor.value.getHexString(),
      deep:    '#' + waterU.uDeepColor.value.getHexString(),
      foam:    '#' + waterU.uFoamColor.value.getHexString(),
      streak:  '#' + waterU.uStreakColor.value.getHexString(),
      fresnelStrength:   waterU.uFresnelStrength.value,
      sunSpecSharpness:  waterU.uSunSpecSharpness.value,
      sunSpecStrength:   waterU.uSunSpecStrength.value,
      absorptionCoef:    waterU.uAbsorptionCoef.value,
      tintCoef:          waterU.uTintCoef.value,
      foamDistance:      waterU.uFoamDistance.value,
      foamSoftness:      waterU.uFoamSoftness.value,
      foamNoiseStrength: waterU.uFoamNoiseStrength.value,
      streakScale:       waterU.uStreakScale.value,
      streakThreshold:   waterU.uStreakThreshold.value,
      streakSoftness:    waterU.uStreakSoftness.value,
      streakStrength:    waterU.uStreakStrength.value,
    },
    light: {
      sunLight: sun.intensity,
      hemi:     hemi.intensity,
      sunDir: (() => {
        const dir = sun.position.clone().normalize();
        return [dir.x, dir.y, dir.z];
      })(),
    },
    runtime: {
      sailingSpeed: params.sailingSpeed,
      flowSpeed:    params.flowSpeed,
      waveScale:    params.waveScale,
      exposure:     params.exposure,
    },
    look: {
      sensitivityYaw:   LOOK_TUNE.sensitivityYaw,
      sensitivityPitch: LOOK_TUNE.sensitivityPitch,
      followLerp:       LOOK_TUNE.followLerp,
    },
    boat: {
      thrustForward:     BOAT_TUNE.thrustForward,
      thrustReverse:     BOAT_TUNE.thrustReverse,
      dragQuadratic:     BOAT_TUNE.dragQuadratic,
      dragLinear:        BOAT_TUNE.dragLinear,
      slowThrustMult:    BOAT_TUNE.slowThrustMult,
      turnThrust:        BOAT_TUNE.turnThrust,
      turnDragQuadratic: BOAT_TUNE.turnDragQuadratic,
      turnDragLinear:    BOAT_TUNE.turnDragLinear,
    },
    stylized: {
      bands: StylizedConfig.bands.map((b) => [b[0], b[1], b[2]] as [number, number, number]),
      rimColor: [StylizedConfig.rimColor[0], StylizedConfig.rimColor[1], StylizedConfig.rimColor[2]],
      rimStrength: StylizedConfig.rimStrength,
      rimPower: StylizedConfig.rimPower,
      outlineColor:     StylizedConfig.outline.color,
      outlineThickness: StylizedConfig.outline.thicknessPx,
    },
  };
}

function applySnapshot(s: Snapshot) {
  sun.position.set(s.light.sunDir[0], s.light.sunDir[1], s.light.sunDir[2])
    .normalize()
    .multiplyScalar(80);
  skyU.uZenithColor.value.set(s.sky.zenith);
  skyU.uHorizonColor.value.set(s.sky.horizon);
  skyU.uGroundColor.value.set(s.sky.ground);
  skyU.uSunColor.value.set(s.sky.sun);
  if (s.sky.clouds) {
    const c = s.sky.clouds;
    skyU.uCloudCoverage.value = c.coverage;
    skyU.uCloudSoftness.value = c.softness;
    skyU.uCloudScale.value    = c.scale;
    skyU.uCloudSpeed.value    = c.speed;
    skyU.uCloudHeight.value   = c.height;
    skyU.uCloudOpacity.value  = c.opacity;
    skyU.uCloudColor.value.set(c.color);
    skyU.uCloudShadowColor.value.set(c.shadowColor);
  }

  waterU.uShallowColor.value.set(s.water.shallow);
  waterU.uDeepColor.value.set(s.water.deep);
  waterU.uFoamColor.value.set(s.water.foam);
  waterU.uStreakColor.value.set(s.water.streak);
  waterU.uFresnelStrength.value   = s.water.fresnelStrength;
  waterU.uSunSpecSharpness.value  = s.water.sunSpecSharpness;
  waterU.uSunSpecStrength.value   = s.water.sunSpecStrength;
  waterU.uAbsorptionCoef.value    = s.water.absorptionCoef;
  waterU.uTintCoef.value          = s.water.tintCoef;
  waterU.uFoamDistance.value      = s.water.foamDistance;
  waterU.uFoamSoftness.value      = s.water.foamSoftness;
  waterU.uFoamNoiseStrength.value = s.water.foamNoiseStrength;
  waterU.uStreakScale.value       = s.water.streakScale;
  waterU.uStreakThreshold.value   = s.water.streakThreshold;
  waterU.uStreakSoftness.value    = s.water.streakSoftness;
  waterU.uStreakStrength.value    = s.water.streakStrength;

  sun.intensity  = s.light.sunLight;
  hemi.intensity = s.light.hemi;

  params.sailingSpeed = s.runtime.sailingSpeed;
  params.flowSpeed    = s.runtime.flowSpeed;
  params.waveScale    = s.runtime.waveScale;
  params.exposure     = s.runtime.exposure;
  renderer.toneMappingExposure = s.runtime.exposure;

  if (s.look) {
    LOOK_TUNE.sensitivityYaw   = s.look.sensitivityYaw;
    LOOK_TUNE.sensitivityPitch = s.look.sensitivityPitch;
    LOOK_TUNE.followLerp       = s.look.followLerp;
  }
  if (s.boat) {
    BOAT_TUNE.thrustForward     = s.boat.thrustForward;
    BOAT_TUNE.thrustReverse     = s.boat.thrustReverse;
    BOAT_TUNE.dragQuadratic     = s.boat.dragQuadratic;
    BOAT_TUNE.dragLinear        = s.boat.dragLinear;
    BOAT_TUNE.slowThrustMult    = s.boat.slowThrustMult;
    BOAT_TUNE.turnThrust        = s.boat.turnThrust;
    BOAT_TUNE.turnDragQuadratic = s.boat.turnDragQuadratic;
    BOAT_TUNE.turnDragLinear    = s.boat.turnDragLinear;
  }
  if (s.stylized) {
    // 兼容旧存档（bands 长度不一致时按短的取）
    const n = Math.min(StylizedConfig.bands.length, s.stylized.bands.length);
    for (let i = 0; i < n; i++) {
      StylizedConfig.bands[i] = [
        s.stylized.bands[i][0],
        s.stylized.bands[i][1],
        s.stylized.bands[i][2],
      ];
    }
    StylizedConfig.rimColor = [
      s.stylized.rimColor[0],
      s.stylized.rimColor[1],
      s.stylized.rimColor[2],
    ];
    StylizedConfig.rimStrength = s.stylized.rimStrength;
    StylizedConfig.rimPower    = s.stylized.rimPower;
    if (s.stylized.outlineColor)     StylizedConfig.outline.color = s.stylized.outlineColor;
    if (s.stylized.outlineThickness !== undefined) StylizedConfig.outline.thicknessPx = s.stylized.outlineThickness;
    refreshStylizedGradient();
    refreshRimUniforms();
    refreshOutlineUniforms();
  }

  syncSun();
}

function cloneSnapshot(s: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(s)) as Snapshot;
}

const CLOUD_DEFAULTS: Record<TimePresetName, NonNullable<Snapshot['sky']['clouds']>> = {
  noon: {
    coverage: 0.55, softness: 0.14, scale: 2.4, speed: 0.008,
    height: 0.08, opacity: 0.85,
    color: '#ffffff', shadowColor: '#c8ccd4',
  },
  golden: {
    coverage: 0.62, softness: 0.16, scale: 2.6, speed: 0.010,
    height: 0.06, opacity: 0.90,
    color: '#ffe7c0', shadowColor: '#c9927a',
  },
  dusk: {
    coverage: 0.48, softness: 0.18, scale: 2.2, speed: 0.006,
    height: 0.05, opacity: 0.85,
    color: '#f6b9a0', shadowColor: '#5a3550',
  },
  night: {
    coverage: 0.40, softness: 0.20, scale: 2.8, speed: 0.005,
    height: 0.10, opacity: 0.70,
    color: '#5b6b86', shadowColor: '#1a2338',
  },
};

function createCodeDefaultSnapshot(name: TimePresetName, base: Snapshot): Snapshot {
  const result = cloneSnapshot(base);
  const p = presets[name];
  const dir = p.sunDir.clone().normalize();
  result.sky = {
    zenith: p.zenith,
    horizon: p.horizon,
    ground: p.ground,
    sun: p.sun,
    clouds: { ...CLOUD_DEFAULTS[name] },
  };
  result.water.shallow = p.shallow;
  result.water.deep = p.deep;
  result.water.foam = p.foam;
  result.water.streak = p.streak;
  result.light = {
    sunLight: p.sunLight,
    hemi: p.hemi,
    sunDir: [dir.x, dir.y, dir.z],
  };
  return result;
}

/** 将旧版/缺字段快照补全为当前结构，避免升级后读档报错。 */
function mergeSnapshot(base: Snapshot, saved: any): Snapshot {
  if (!saved || typeof saved !== 'object') return cloneSnapshot(base);
  const result = cloneSnapshot(base);
  result.sky = { ...result.sky, ...(saved.sky ?? {}) };
  result.water = { ...result.water, ...(saved.water ?? {}) };
  result.light = { ...result.light, ...(saved.light ?? {}) };
  result.runtime = { ...result.runtime, ...(saved.runtime ?? {}) };
  if (saved.look) result.look = { ...result.look!, ...saved.look };
  if (saved.boat) result.boat = { ...result.boat!, ...saved.boat };
  if (saved.stylized) {
    result.stylized = { ...result.stylized!, ...saved.stylized };
  }
  return result;
}

const codeDefaultBase = captureSnapshot();
const presetSnapshots = {} as Record<TimePresetName, Snapshot>;
for (const name of PRESET_NAMES) {
  presetSnapshots[name] = createCodeDefaultSnapshot(name, codeDefaultBase);
}

// 新版存储：四个 preset 各有一份完整快照。
let loadedPresetStore = false;
try {
  const raw = localStorage.getItem(PRESET_STORAGE_KEY);
  if (raw) {
    const stored = JSON.parse(raw) as Partial<Record<TimePresetName, Snapshot>>;
    for (const name of PRESET_NAMES) {
      if (stored[name]) presetSnapshots[name] = mergeSnapshot(presetSnapshots[name], stored[name]);
    }
    loadedPresetStore = true;
    console.log('[time presets] 已从 localStorage 加载');
  }
} catch (e) {
  console.warn('[time presets] 加载失败', e);
}

// 首次升级时只把旧版 noon 快照迁入 noon，不影响其他时段的代码默认值。
if (!loadedPresetStore) {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_NOON_STORAGE_KEY);
    if (legacyRaw) {
      presetSnapshots.noon = mergeSnapshot(presetSnapshots.noon, JSON.parse(legacyRaw));
    }
  } catch (e) {
    console.warn('[time presets] 旧版 noon preset 迁移失败', e);
  }
}

function writePresetStore() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presetSnapshots));
}

function savePreset(name: TimePresetName, snapshot: Snapshot = captureSnapshot()) {
  presetSnapshots[name] = cloneSnapshot(snapshot);
  writePresetStore();
}

applySnapshot(presetSnapshots[params.timeOfDay]);

/* ────────────────────────────────────────────────────────────
   GUI
   ──────────────────────────────────────────────────────────── */

const gui = new GUI({ title: 'LURE · Prototype' });

/* ── 自动保存 —— 任何 GUI 调整都会 debounce 落到 localStorage ──
   这样在试玩里调过的所有参数、返回编辑器再进来都还在  */
let autoSaveTimer: number | null = null;
function flushAutoSave() {
  if (autoSaveTimer !== null) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  try {
    savePreset(params.timeOfDay);
  } catch (e) {
    console.warn('[proto] 自动保存失败', e);
  }
}
function autoSave() {
  if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    flushAutoSave();
  }, 200);
}

// ── 保存 / 重置 preset ──
const presetActions = {
  saveCurrentPreset: () => {
    try {
      if (autoSaveTimer !== null) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      savePreset(params.timeOfDay);
      alert(`✓ 已保存当前状态到 ${params.timeOfDay} preset`);
    } catch (e) {
      console.warn(e);
      alert('保存失败：' + (e as Error).message);
    }
  },
  resetToCodeDefaults: () => {
    if (!confirm('清除四个时段的自定义 preset，恢复代码默认值？')) return;
    try {
      localStorage.removeItem(PRESET_STORAGE_KEY);
      localStorage.removeItem(LEGACY_NOON_STORAGE_KEY);
    } catch {}
    location.reload();
  },
};
gui.add(presetActions, 'saveCurrentPreset').name('★ 保存当前 preset');
gui.add(presetActions, 'resetToCodeDefaults').name('↻ 重置为代码默认');

let activePreset: TimePresetName = params.timeOfDay;
gui.add(params, 'timeOfDay', ['noon', 'golden', 'dusk', 'night'])
  .name('时段 preset')
  .onChange((v: TimePresetName) => {
    // 下拉值会先写入 params，因此使用 activePreset 保存切换前画面。
    if (autoSaveTimer !== null) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    savePreset(activePreset);
    activePreset = v;
    applySnapshot(presetSnapshots[v]);
    refreshGuiFromScene();
  });
// 「航行速度」已不再有意义（现在船速完全由 WASD 驱动），从 GUI 里移除。
// params.sailingSpeed 仍保留在 Snapshot 里以兼容旧 localStorage，但不再被使用。
// gui.add(params, 'sailingSpeed', 0, 3, 0.05).name('（不再使用）');
gui.add(params, 'flowSpeed', 0, 1.5, 0.02).name('水面 Flow 基础');
gui.add(params, 'waveScale', 0.2, 2.0, 0.05).name('浪高倍率');
gui.add(params, 'exposure', 0.5, 1.6, 0.02).name('曝光').onChange((v: number) => {
  renderer.toneMappingExposure = v;
});

const skyColorProxy = {
  zenith: '#' + skyU.uZenithColor.value.getHexString(),
  horizon: '#' + skyU.uHorizonColor.value.getHexString(),
  ground: '#' + skyU.uGroundColor.value.getHexString(),
  sun: '#' + skyU.uSunColor.value.getHexString(),
};
const skyFolder = gui.addFolder('天空');
skyFolder.addColor(skyColorProxy, 'zenith')
  .name('天顶色').onChange((v: string) => {
    skyU.uZenithColor.value.set(v);
    syncSun();
  });
skyFolder.addColor(skyColorProxy, 'horizon')
  .name('地平线色').onChange((v: string) => { skyU.uHorizonColor.value.set(v); syncSun(); });
skyFolder.addColor(skyColorProxy, 'ground')
  .name('地面反射色').onChange((v: string) => {
    skyU.uGroundColor.value.set(v);
    syncSun();
  });
skyFolder.addColor(skyColorProxy, 'sun')
  .name('太阳色').onChange((v: string) => { skyU.uSunColor.value.set(v); syncSun(); });
skyFolder.close();

const cloudColorProxy = {
  color: '#' + skyU.uCloudColor.value.getHexString(),
  shadowColor: '#' + skyU.uCloudShadowColor.value.getHexString(),
};
const cloudFolder = gui.addFolder('天空 · 风格化云');
cloudFolder.add(skyU.uCloudCoverage, 'value', 0, 1, 0.01).name('云量（覆盖率）');
cloudFolder.add(skyU.uCloudOpacity, 'value', 0, 1, 0.01).name('不透明度');
cloudFolder.add(skyU.uCloudSoftness, 'value', 0.02, 0.35, 0.005).name('边缘柔和');
cloudFolder.add(skyU.uCloudScale, 'value', 0.5, 6.0, 0.05).name('云块密度');
cloudFolder.add(skyU.uCloudHeight, 'value', -0.1, 0.5, 0.01).name('云带下缘（0=地平线）');
cloudFolder.add(skyU.uCloudSpeed, 'value', 0.0, 0.05, 0.001).name('飘动速度');
cloudFolder.addColor(cloudColorProxy, 'color')
  .name('云本体色').onChange((v: string) => skyU.uCloudColor.value.set(v));
cloudFolder.addColor(cloudColorProxy, 'shadowColor')
  .name('云阴影色').onChange((v: string) => skyU.uCloudShadowColor.value.set(v));
cloudFolder.close();

const waterColorProxy = {
  shallow: '#' + waterU.uShallowColor.value.getHexString(),
  deep: '#' + waterU.uDeepColor.value.getHexString(),
  foam: '#' + waterU.uFoamColor.value.getHexString(),
  streak: '#' + waterU.uStreakColor.value.getHexString(),
};
const waterColorFolder = gui.addFolder('水体 · 配色');
waterColorFolder.addColor(waterColorProxy, 'shallow')
  .name('浅水色').onChange((v: string) => waterU.uShallowColor.value.set(v));
waterColorFolder.addColor(waterColorProxy, 'deep')
  .name('深水色').onChange((v: string) => waterU.uDeepColor.value.set(v));
waterColorFolder.addColor(waterColorProxy, 'foam')
  .name('泡沫色').onChange((v: string) => waterU.uFoamColor.value.set(v));
waterColorFolder.addColor(waterColorProxy, 'streak')
  .name('亮纹色').onChange((v: string) => waterU.uStreakColor.value.set(v));
waterColorFolder.open();

const transparencyFolder = gui.addFolder('水体 · 透明感 / 深浅');
transparencyFolder.add(waterU.uAbsorptionCoef, 'value', 0.02, 1.5, 0.01)
  .name('吸收系数（越大越不透明）');
transparencyFolder.add(waterU.uTintCoef, 'value', 0.0, 1.5, 0.02)
  .name('水下场景染色');
transparencyFolder.open();

const foamFolder = gui.addFolder('水体 · 相交泡沫');
foamFolder.add(waterU.uFoamDistance, 'value', 0.1, 5.0, 0.05).name('泡沫距离');
foamFolder.add(waterU.uFoamSoftness, 'value', 0.05, 1.0, 0.02).name('边缘柔和');
foamFolder.add(waterU.uFoamNoiseStrength, 'value', 0.0, 1.5, 0.02).name('噪声破碎');
foamFolder.open();

const streakFolder = gui.addFolder('水体 · 流动亮纹');
streakFolder.add(waterU.uStreakScale, 'value', 0.05, 2.0, 0.01).name('纹路密度');
streakFolder.add(waterU.uStreakThreshold, 'value', 0.3, 0.9, 0.01).name('阈值');
streakFolder.add(waterU.uStreakSoftness, 'value', 0.01, 0.3, 0.01).name('柔和度');
streakFolder.add(waterU.uStreakStrength, 'value', 0.0, 1.5, 0.02).name('亮度');
streakFolder.close();

const lightFolder = gui.addFolder('水体 · 光照');
lightFolder.add(waterU.uFresnelStrength, 'value', 0.0, 1.0, 0.02).name('Fresnel 强度');
lightFolder.add(waterU.uSunSpecStrength, 'value', 0.0, 2.0, 0.02).name('Sun Spec');
lightFolder.add(waterU.uSunSpecSharpness, 'value', 20, 400, 5).name('Spec 锐度');
lightFolder.close();

const viewFolder = gui.addFolder('视角 · 鼠标环视');
viewFolder.add(LOOK_TUNE, 'sensitivityYaw',   0.0005, 0.01, 0.0002).name('水平灵敏度');
viewFolder.add(LOOK_TUNE, 'sensitivityPitch', 0.0005, 0.01, 0.0002).name('垂直灵敏度');
viewFolder.add(LOOK_TUNE, 'followLerp',       0.03,   0.30, 0.01).name('平滑度（越大越贴手）');
viewFolder.close();

const boatFolder = gui.addFolder('船 · 操控');
boatFolder.add(BOAT_TUNE, 'thrustForward',      1.0,  15.0, 0.1).name('前进推力');
boatFolder.add(BOAT_TUNE, 'thrustReverse',      0.5,  10.0, 0.1).name('倒车推力');
boatFolder.add(BOAT_TUNE, 'dragQuadratic',      0.1,   3.0, 0.05).name('直线·二次阻力');
boatFolder.add(BOAT_TUNE, 'dragLinear',         0.0,   3.0, 0.05).name('直线·线性阻力');
boatFolder.add(BOAT_TUNE, 'slowThrustMult',     0.05,  1.0, 0.05).name('Shift 慢速倍率');
boatFolder.add(BOAT_TUNE, 'turnThrust',         0.2,   8.0, 0.1).name('转向推力');
boatFolder.add(BOAT_TUNE, 'turnDragQuadratic',  0.5,  12.0, 0.1).name('转向·二次阻力');
boatFolder.add(BOAT_TUNE, 'turnDragLinear',     0.0,   8.0, 0.1).name('转向·线性阻力');
boatFolder.open();

/* ── 三渲二 —— 修改后所有 stylized 材质立即刷新 ── */

const rgbToHex = (rgb: [number, number, number]): string => {
  const to = (x: number) => {
    const v = Math.max(0, Math.min(255, Math.round(x * 255)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
};
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const styProxy = {
  band0: rgbToHex(StylizedConfig.bands[0]),  // 最暗
  band1: rgbToHex(StylizedConfig.bands[1]),  // 中阴影
  band2: rgbToHex(StylizedConfig.bands[2]),  // 中调
  band3: rgbToHex(StylizedConfig.bands[3]),  // 亮面
  rimColor: rgbToHex(StylizedConfig.rimColor),
  rimStrength: StylizedConfig.rimStrength,
  rimPower: StylizedConfig.rimPower,
  outlineColor: StylizedConfig.outline.color,
  outlineThickness: StylizedConfig.outline.thicknessPx,
};
function applyStylizedProxy() {
  StylizedConfig.bands[0] = hexToRgb(styProxy.band0);
  StylizedConfig.bands[1] = hexToRgb(styProxy.band1);
  StylizedConfig.bands[2] = hexToRgb(styProxy.band2);
  StylizedConfig.bands[3] = hexToRgb(styProxy.band3);
  StylizedConfig.rimColor = hexToRgb(styProxy.rimColor);
  StylizedConfig.rimStrength = styProxy.rimStrength;
  StylizedConfig.rimPower    = styProxy.rimPower;
  StylizedConfig.outline.color = styProxy.outlineColor;
  StylizedConfig.outline.thicknessPx = styProxy.outlineThickness;
  refreshStylizedGradient();
  refreshRimUniforms();
  refreshOutlineUniforms();
}
const stylizedFolder = gui.addFolder('画风 · 三渲二');
stylizedFolder.addColor(styProxy, 'band0').name('① 深阴影').onChange(applyStylizedProxy);
stylizedFolder.addColor(styProxy, 'band1').name('② 中阴影').onChange(applyStylizedProxy);
stylizedFolder.addColor(styProxy, 'band2').name('③ 中调').onChange(applyStylizedProxy);
stylizedFolder.addColor(styProxy, 'band3').name('④ 亮面').onChange(applyStylizedProxy);
stylizedFolder.addColor(styProxy, 'rimColor').name('Rim 颜色').onChange(applyStylizedProxy);
stylizedFolder.add(styProxy, 'rimStrength', 0, 0.5, 0.005).name('Rim 强度').onChange(applyStylizedProxy);
stylizedFolder.add(styProxy, 'rimPower',    0.5, 6.0, 0.1).name('Rim 幂次').onChange(applyStylizedProxy);
stylizedFolder.addColor(styProxy, 'outlineColor').name('描边颜色').onChange(applyStylizedProxy);
stylizedFolder.add(styProxy, 'outlineThickness', 0, 6, 0.1).name('描边厚度(px)').onChange(applyStylizedProxy);
stylizedFolder.close();

/** shader / 配置对象改变后，将所有 GUI 代理值和显示一起刷新。 */
function refreshGuiFromScene() {
  skyColorProxy.zenith = '#' + skyU.uZenithColor.value.getHexString();
  skyColorProxy.horizon = '#' + skyU.uHorizonColor.value.getHexString();
  skyColorProxy.ground = '#' + skyU.uGroundColor.value.getHexString();
  skyColorProxy.sun = '#' + skyU.uSunColor.value.getHexString();

  waterColorProxy.shallow = '#' + waterU.uShallowColor.value.getHexString();
  waterColorProxy.deep = '#' + waterU.uDeepColor.value.getHexString();
  waterColorProxy.foam = '#' + waterU.uFoamColor.value.getHexString();
  waterColorProxy.streak = '#' + waterU.uStreakColor.value.getHexString();

  cloudColorProxy.color = '#' + skyU.uCloudColor.value.getHexString();
  cloudColorProxy.shadowColor = '#' + skyU.uCloudShadowColor.value.getHexString();

  styProxy.band0 = rgbToHex(StylizedConfig.bands[0]);
  styProxy.band1 = rgbToHex(StylizedConfig.bands[1]);
  styProxy.band2 = rgbToHex(StylizedConfig.bands[2]);
  styProxy.band3 = rgbToHex(StylizedConfig.bands[3]);
  styProxy.rimColor = rgbToHex(StylizedConfig.rimColor);
  styProxy.rimStrength = StylizedConfig.rimStrength;
  styProxy.rimPower = StylizedConfig.rimPower;
  styProxy.outlineColor = StylizedConfig.outline.color;
  styProxy.outlineThickness = StylizedConfig.outline.thicknessPx;

  const updateFolder = (folder: GUI) => {
    folder.controllers.forEach((controller) => controller.updateDisplay());
    folder.folders.forEach(updateFolder);
  };
  updateFolder(gui);
}

// ── 全局 autosave ——   任何 GUI 控件变动都会触发（含所有 folder 内的） ──
gui.onChange(autoSave);
refreshGuiFromScene();

/* ────────────────────────────────────────────────────────────
   Resize
   ──────────────────────────────────────────────────────────── */

addEventListener('resize', onResize);
function onResize() {
  // 先按新窗口重新算 16:9 的 #stage 尺寸，再用 stage 的像素尺寸驱动渲染器/相机/深度 RT
  applyStageSize();
  const w = stageWidth();
  const h = stageHeight();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const rtw = Math.floor(w * renderer.getPixelRatio());
  const rth = Math.floor(h * renderer.getPixelRatio());
  sceneRT.dispose();
  sceneRT = createSceneRT(rtw, rth);
  waterU.uDepthTexture.value = sceneRT.depthTexture;
  waterU.uSceneColorTexture.value = sceneRT.texture;
  waterU.uResolution.value.set(rtw, rth);
  // 描边厚度按像素恒定，需要知道视口高度
  setStylizedViewportHeight(h);
}
// 首次调用一次
setStylizedViewportHeight(stageHeight());

/* ────────────────────────────────────────────────────────────
   主循环：两遍渲染
     Pass1 → 隐藏水面，渲染场景到 depthRT（获取水下物体深度）
     Pass2 → 显示水面，正常渲染到屏幕（水面 shader 读取 depthRT）
   ──────────────────────────────────────────────────────────── */

const baseWave = {
  a: waterU.uWaveA.value.z,
  b: waterU.uWaveB.value.z,
};

const hudSpeedEl = document.getElementById('hud-speed') as HTMLElement | null;
const fishingPromptEl = document.getElementById('fishing-prompt') as HTMLElement | null;

/** 每帧刷新：找出船身所在的钓鱼海域，null = 不在任何海域内 */
function updateActiveFishingZone(): void {
  // 钓鱼 UI 打开时把"按 F"提示藏起来，但不清 activeFishingZone（关掉 UI 后就地恢复）
  if (isFishingBusy()) {
    fishingPromptEl?.classList.remove('visible');
    return;
  }
  if (fishingZones.length === 0) {
    if (activeFishingZone !== null) {
      activeFishingZone = null;
      fishingPromptEl?.classList.remove('visible');
    }
    return;
  }
  const bx = boat.position.x;
  const bz = boat.position.z;
  // 海域是大范围圆，船中心在圈内就算进入（不像老"贴脸"点，不需要 pad）
  let nearest: FishingZone | null = null;
  let nearestD2 = Infinity;
  for (const z of fishingZones) {
    const dx = bx - z.x, dz = bz - z.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= z.radius * z.radius && d2 < nearestD2) {
      nearest = z;
      nearestD2 = d2;
    }
  }
  if (nearest !== activeFishingZone) {
    activeFishingZone = nearest;
    if (activeFishingZone) fishingPromptEl?.classList.add('visible');
    else fishingPromptEl?.classList.remove('visible');
  }
}

/** 每帧刷新：检测船是否在港口补给圈内 —— 进入自动补满鱼饵 */
function updateActivePortRefill(): void {
  if (portRefills.length === 0) return;
  const bx = boat.position.x;
  const bz = boat.position.z;
  let nearest: PortRefill | null = null;
  let nearestD2 = Infinity;
  for (const p of portRefills) {
    const dx = bx - p.x, dz = bz - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= p.radius * p.radius && d2 < nearestD2) {
      nearest = p;
      nearestD2 = d2;
    }
  }
  const wasIn = activePortRefill !== null;
  const isIn = nearest !== null;
  activePortRefill = nearest;
  // 进入补给圈 —— 触发一次补给（PlayerResources 里的 refillBait 会去重防抖）
  if (isIn && !wasIn) {
    onEnterPortRefill();
  }
}

// 补给回调 —— PlayerResources 就绪后被赋值
let onEnterPortRefill: () => void = () => {};

/* ────────────────────────────────────────────────────────────
   钓鱼小游戏（3D 鱼竿版）—— 冻结船控制 & 环视
   ──────────────────────────────────────────────────────────── */

const fishingHudEl = document.getElementById('fishing-hud') as HTMLElement | null;
const fishingRod   = new FishingRod(camera, scene);
const fishingGame  = fishingHudEl ? new FishingGame(fishingHudEl) : null;

// 钩子系统 & minimap —— loadEditorScene 拿到 zones 后再实例化
let fishingHooks: HooksSystem | null = null;
let minimap: Minimap | null = null;
const baitHud = new BaitHUD(stage);   // 挂到 #stage，限制在 16:9 游戏画幅内

// 玩家进入港口补给圈 → 立即补满
onEnterPortRefill = () => {
  if (playerResources.isFull()) return;
  playerResources.refillBait();
  showInvToast(`鱼饵已补满（${playerResources.bait}/${playerResources.baitMax}）`, 1800);
};

/* ────────────────────────────────────────────────────────────
   背包（Dredge 风不规则网格）—— 钓上的鱼放这里，玩家自行摆
   ──────────────────────────────────────────────────────────── */

/*
 * 货舱形状 —— 参考渔帆暗涌，船体截面式的不规则多边形。
 * 8 列 × 7 行的外包围盒，四角"削掉"做成圆角六边形；再散布 3 格"受损"格。
 *
 *   . . 1 1 1 1 . .
 *   . 1 1 1 1 1 1 .
 *   1 1 1 1 1 1 1 1
 *   1 1 1 1 X 1 1 1
 *   1 1 X 1 1 1 1 1
 *   . 1 1 1 1 1 X .
 *   . . 1 1 1 1 . .
 *
 * 有效格 = 44 - 3 = 41 格。
 */
const HOLD_COLS = 8;
const HOLD_ROWS = 7;
const holdBlocked: Array<[number, number]> = [
  // 四角削掉 —— 让外形像六边形/船体截面
  [0, 0], [1, 0], [6, 0], [7, 0],
  [0, 1],                 [7, 1],
  [0, 5],                 [7, 5],
  [0, 6], [1, 6], [6, 6], [7, 6],
  // 3 处受损 —— 顶部信息栏的"受损"计数会自动读这里
  [4, 3], [2, 4], [6, 5],
];
const inventory = new Inventory({
  cols: HOLD_COLS,
  rows: HOLD_ROWS,
  blocked: holdBlocked,
});
const inventoryUI = new InventoryUI(inventory, {
  cellSize: 46,
  container: stage,   // 挂到 #stage，限制在 16:9 游戏画幅内（原本挂在 body 上）
  onOpen: () => {
    // 打开背包时把鼠标拖拽状态复位；keys 不再强制清零 ——
    // 由 tick 里的 boatInputActive=!isUiBusy() 门控推进力，
    // 这样"打开 UI 时手还按着 W → 关掉 UI 立刻恢复推进"，不会再卡键。
    lookState.dragging = false;
  },
  onClose: () => {
    // 关闭背包后主动把键盘焦点抢回 body ——
    // 修复"关掉背包后 WASD 没反应"的手感 bug：
    // 拖拽鱼的过程中 activeElement 可能落到 .inv-item 之类的 div 上，
    // 甚至 document.hasFocus() 也会因为面板 blur 掉后没自动回到 body 而变 false，
    // 于是玩家键盘事件根本传不到 tab。这里主动 focus 一下就 OK。
    try { window.focus(); } catch {}
    try { document.body.focus({ preventScroll: true }); } catch {}
  },
});
const invToastEl = document.getElementById('inv-toast') as HTMLElement | null;
let invToastTimer = 0;
function showInvToast(msg: string, duration = 2200) {
  if (!invToastEl) return;
  invToastEl.textContent = msg;
  invToastEl.classList.add('visible');
  clearTimeout(invToastTimer);
  invToastTimer = window.setTimeout(() => invToastEl.classList.remove('visible'), duration);
}

const fishShowcase = new FishShowcase();

/** 右上角常驻任务条 */
const questTracker = new QuestTrackerUI(stage);

/** M 键 / 地图按钮：有委托时开航海地图，否则回港口 */
function tryOpenMapOrPort() {
  if (mapUI.isOpen()) { mapUI.hide(); return; }
  if (portHub.isOpen()) return;
  mapCloseReturnsTo = 'play';
  if (questState.isActive('merchant_wreck') || questState.isCompleted('merchant_wreck')) {
    hubState.setMode('world_map');
    mapUI.show();
  } else {
    hubState.setMode('port_hub');
    portHub.show();
  }
}

/* ────────────────────────────────────────────────────────────
   平洛镇港口 Hub + 航海地图 + 白天冒险
   ──────────────────────────────────────────────────────────── */
const portHub = new PortHubUI({
  container: stage,
  onSail: () => {
    mapCloseReturnsTo = 'port_hub';
    mapUI.setCurrentNode('pingzhi_town');
    hubState.setMode('world_map');
    mapUI.show();
  },
  onClose: () => {
    try { window.focus(); } catch {}
  },
});

const expedition = new ExpeditionController({
  container: stage,
  onExit: (success) => {
    if (success) {
      portHub.showToast('✓ 沉船货物已打捞 · 可返回港口');
    }
    mapUI.show();
    hubState.setMode('world_map');
    try { window.focus(); } catch {}
  },
});

/* ────────────────────────────────────────────────────────────
   航海地图（P2）—— 全屏叠加层，接受委托后由港口「出海」打开
   · 打开时冻结所有输入（并入 isUiBusy）
   · 点击可玩节点 → 消耗 AP → fade → hide → 钓鱼场景 或 白天冒险
   ──────────────────────────────────────────────────────────── */
const mapUI = new MapUI({
  container: stage,
  onTravel: (nodeId: string, node: MapNode) => {
    console.log('[map] travel to', nodeId);
    lookState.dragging = false;
    if (node.portHub) {
      hubState.setMode('port_hub');
      portHub.fadeIn();
      try { window.focus(); } catch {}
      return;
    }
    if (node.expeditionKey) {
      expedition.start(node.expeditionKey);
      return;
    }
    hubState.setMode('play');
    try { window.focus(); } catch {}
    try { document.body.focus({ preventScroll: true }); } catch {}
  },
  onReturnPort: () => {
    mapUI.setCurrentNode('pingzhi_town');
    hubState.setMode('port_hub');
    portHub.fadeIn();
  },
  onOpen: () => {
    lookState.dragging = false;
    hubState.setMode('world_map');
  },
  onClose: () => {
    if (hubState.getMode() === 'world_map') {
      hubState.setMode(mapCloseReturnsTo);
      if (mapCloseReturnsTo === 'port_hub') portHub.show();
    }
    try { window.focus(); } catch {}
    try { document.body.focus({ preventScroll: true }); } catch {}
  },
});

// 顶部"航海地图"按钮 —— 随时可以打开地图
const mapBtn = document.getElementById('map-btn');
if (mapBtn) {
  mapBtn.addEventListener('click', () => tryOpenMapOrPort());
}

/** 是否处于任何"接管输入的 UI 状态"—— 用于禁 WASD/环视 */
function isUiBusy(): boolean {
  return (fishingGame?.isActive() ?? false)
    || inventoryUI.isOpen()
    || fishShowcase.isActive()
    || mapUI.isOpen()
    || portHub.isOpen()
    || portHub.isDialogueOpen()
    || expedition.isActive();
}

/** 是否正在钓鱼中（含展示视频播放）—— 用来冻结船 / 环视 / 屏蔽 F 键重触发 */
function isFishingBusy(): boolean {
  return (fishingGame?.isActive() ?? false) || fishShowcase.isActive();
}

/** 按 F 触发钓鱼 —— 海域内自由抛竿（视角前方 8.5m），成功钓上自动开背包 */
function tryStartFishing(): void {
  if (!activeFishingZone) return;
  if (!fishingGame) return;
  if (fishingGame.isActive()) return;

  // 鱼饵不足 —— 弹提示，不进入钓鱼流程
  if (!playerResources.consumeBait()) {
    showInvToast('鱼饵不足，回港口补给', 2200);
    return;
  }

  // 只复位鼠标拖拽状态；keys 不再强制清零 ——
  // tick 里 boatInputActive=!isUiBusy() 会天然屏蔽船推力，
  // 且不会破坏物理键盘状态，UI 关掉的瞬间就能续按 W 继续开船。
  lookState.dragging = false;

  // 提前预热战利品展示视频的缓冲 —— 借着整个钓鱼博弈的时间（几秒到几十秒）
  // 让浏览器把视频下载好，钓上鱼那一刻就能立刻顺畅播放，不会卡在"缓冲中"
  fishShowcase.warmUp();

  // 抛竿目标 = 相机视角前方水面（不是船头方向 —— 玩家看向哪里就往哪里抛）
  // 这样即使船是横着停在海域里，玩家只要把视角对准鱼群，浮标就落在视角前方
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  // 兜底：如果玩家按 F 时几乎看向正下方（水平分量近 0），用船头方向；避免归一化后指向意外方向
  if (camForward.lengthSq() < 0.05) {
    const h = boat.rotation.y;
    camForward.set(Math.cos(h), 0, -Math.sin(h));
  } else {
    camForward.normalize();
  }
  const CAST_DISTANCE = 8.5;
  const castX = boat.position.x + camForward.x * CAST_DISTANCE;
  const castZ = boat.position.z + camForward.z * CAST_DISTANCE;

  // 查抛竿落点附近有没有钩子 —— 钩子决定 preset & 咬钩速度
  const hookBonus = fishingHooks?.getHookBonusAt(castX, castZ) ?? null;
  const presetKey = hookBonus?.presetKey ?? zoneDefaultPresetKey(activeFishingZone.tier);
  const preset = FISH_PRESETS[presetKey] ?? FISH_PRESETS.common;

  const spotWorld = new THREE.Vector3(castX, 0.05, castZ);
  const boatWorld = new THREE.Vector3(boat.position.x, boat.position.y, boat.position.z);
  console.log(
    `[proto] 抛竿 zone=${activeFishingZone.id} preset=${presetKey}`,
    `hook=${hookBonus?.hookType ?? 'none'}`,
    `(${castX.toFixed(1)}, ${castZ.toFixed(1)})`,
  );

  // 抛竿落点周围 30m 用来限制浮标可拽动的最大距离（旧代码传的是钓鱼点半径，
  // 新版海域太大不合适，改成以落点为中心的固定半径）
  fishingGame.start(spotWorld, boatWorld, preset, fishingRod, {
    center: new THREE.Vector3(castX, 0, castZ),
    radius: 6.0,
  }, {
    biteWaitMult: hookBonus?.biteSpeedMult ?? 1.0,
  }).then(async (result) => {
    if (result.success) {
      console.log('[proto] 钓上了！', result.fish);
      // 消耗掉钩子 —— 玩家"薅"了这个诱饵
      if (hookBonus) fishingHooks?.consumeHookAt(castX, castZ);
      // 展示视频：钓上鱼 → 强制切到战利品展示（冻结输入）→ 播完/跳过再进背包
      // isFishingBusy()/isUiBusy() 在播放期间会返回 true，船控 & 环视 & F 键都会被冻住
      await fishShowcase.play();
      // 展示结束后再打开背包 —— 鱼进"待放入"槽，让玩家自己拖入网格
      inventoryUI.onCatch(presetKey);
      showInvToast(`+1 ${preset.name} · 拖到网格里放好`, 2200);
    } else {
      console.log('[proto] 失败：', result.reason);
    }
  });
}

/** 海域 tier → 默认 preset key（钩子加成会 override 这个） */
function zoneDefaultPresetKey(tier: 'common' | 'rare' | 'lair'): string {
  // FISH_PRESETS 目前只有 common / medium 两档，先按 tier 映射；后续加更多 preset 时补
  if (tier === 'lair') return 'medium' in FISH_PRESETS ? 'medium' : 'common';
  if (tier === 'rare') return 'medium' in FISH_PRESETS ? 'medium' : 'common';
  return 'common';
}

/** 波高函数（供钓鱼浮标使用）—— 复用现有的 gerstner 求值 */
function waveHeightAt(worldX: number, worldZ: number): number {
  return waterHeightAt(worldX, worldZ, elapsed);
}

const clock = new THREE.Clock();
let elapsed = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // ── 战利品展示视频 / 航海地图 全屏遮挡时短路 ──
  // 此时 Three.js 场景 100% 被 UI 遮住，继续跑 renderer.render + 波形 + minimap
  // 完全是浪费主线程 + 抢 GPU，会导致展示视频"卡在第一帧 / 掉帧严重"、
  // 也会让地图上的 hover/click 反应变钝。
  // → 直接短路，只留 RAF 循环让 UI 独占资源。
  //   （clock.getDelta 已经在上面消费掉了，elapsed 也累加了，回来时波形是连续的）
  if (fishShowcase.isActive() || hubState.getMode() !== 'play') {
    if (expedition.isActive()) expedition.update(dt);
    requestAnimationFrame(tick);
    return;
  }

  waterU.uTime.value = elapsed;
  skyU.uTime.value = elapsed;
  waterU.uWaveA.value.z = baseWave.a * params.waveScale;
  waterU.uWaveB.value.z = baseWave.b * params.waveScale;
  waterU.uFlowSpeed.value = params.flowSpeed;

  // ── 船 · WASD 运动学（纯玩家输入驱动，与水流/波浪无耦合） ──
  // 推力 - 阻力 物理模型 → 天然非线性 ease-in / ease-out
  //
  // 输入 → 施力 的门槛：UI（背包 / 钓鱼 / 展示视频）打开时不接受玩家输入，
  // 但 keys 状态本身依然如实跟随物理键盘（见 keydown 处理器注释），
  // 这样 UI 关闭的瞬间只要玩家还按着 W，船立刻恢复推进，不再有"卡键"手感。
  const boatInputActive = !isUiBusy();
  const slowFactor = boatInputActive && keys.shift ? BOAT_TUNE.slowThrustMult : 1.0;

  // 前进/倒车推力
  const fThrust =
    (boatInputActive && keys.w ? BOAT_TUNE.thrustForward : 0) * slowFactor +
    (boatInputActive && keys.s ? -BOAT_TUNE.thrustReverse : 0) * slowFactor;

  // 阻力（永远反向于速度方向，v² 主导 + 少量线性收敛）
  const sSign = Math.sign(boatKin.speed);
  const sAbs  = Math.abs(boatKin.speed);
  const fDrag = -sSign * (BOAT_TUNE.dragQuadratic * sAbs * sAbs + BOAT_TUNE.dragLinear * sAbs);

  boatKin.speed += (fThrust + fDrag) * dt;
  // 无推力且慢到阈值时钳到 0，防止浮点残留导致的"自动漂移"
  if (fThrust === 0 && Math.abs(boatKin.speed) < ZERO_CLAMP_SPEED) boatKin.speed = 0;

  // 转向 —— 同样的推力/阻力模型（角速度）
  const tThrust =
    (boatInputActive && keys.a ? BOAT_TUNE.turnThrust : 0) +
    (boatInputActive && keys.d ? -BOAT_TUNE.turnThrust : 0);

  const tSign = Math.sign(boatKin.turnRate);
  const tAbs  = Math.abs(boatKin.turnRate);
  const tDrag = -tSign * (BOAT_TUNE.turnDragQuadratic * tAbs * tAbs + BOAT_TUNE.turnDragLinear * tAbs);

  boatKin.turnRate += (tThrust + tDrag) * dt;
  if (tThrust === 0 && Math.abs(boatKin.turnRate) < ZERO_CLAMP_TURNRATE) boatKin.turnRate = 0;

  // 应用航向
  boatKin.heading += boatKin.turnRate * dt;

  // 船 forward = 局部 +X（cameraRig 已把相机对准 +X）
  //   Y 旋转 θ 应用到 (1,0,0) → (cos θ, 0, -sin θ)
  const fx = Math.cos(boatKin.heading);
  const fz = -Math.sin(boatKin.heading);

  // ── 物理移动 —— Rapier 就绪时用 character controller，否则用简易圆-圆兜底 ──
  const desiredDX = fx * boatKin.speed * dt;
  const desiredDZ = fz * boatKin.speed * dt;

  if (physics.ready && physics.boatBody && physics.boatController && physics.boatCollider) {
    // Rapier 严格物理：character controller 会给出沿障碍表面滑行后的实际位移
    physics.boatController.computeColliderMovement(
      physics.boatCollider,
      { x: desiredDX, y: 0, z: desiredDZ },
    );
    const cm = physics.boatController.computedMovement();
    const t = physics.boatBody.translation();
    physics.boatBody.setNextKinematicTranslation({
      x: t.x + cm.x, y: t.y, z: t.z + cm.z,
    });

    // 同步船头朝向到物理 body（长方体 collider 必须跟着转，否则始终指向世界 X）
    const halfH = boatKin.heading * 0.5;
    physics.boatBody.setNextKinematicRotation({
      x: 0, y: Math.sin(halfH), z: 0, w: Math.cos(halfH),
    });

    // 步进物理世界
    stepPhysics(dt);

    // 读回 Rapier 更新后的位置，同步到 three 场景
    const nt = physics.boatBody.translation();
    boat.position.x = nt.x;
    boat.position.z = nt.z;

    // 若实际位移远小于期望（撞到东西），衰减速度
    const desiredLen = Math.hypot(desiredDX, desiredDZ);
    const actualLen = Math.hypot(cm.x, cm.z);
    if (desiredLen > 1e-4 && actualLen < desiredLen * 0.5) {
      boatKin.speed *= 0.55;
    }
  } else {
    // Fallback：物理未就绪时用简单圆-圆
    let nextX = boat.position.x + desiredDX;
    let nextZ = boat.position.z + desiredDZ;
    for (const c of colliders) {
      const dx = nextX - c.x;
      const dz = nextZ - c.z;
      const minDist = c.r + BOAT_RADIUS;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < minDist * minDist && dist2 > 1e-6) {
        const dist = Math.sqrt(dist2);
        const nx = dx / dist;
        const nz = dz / dist;
        nextX = c.x + nx * minDist;
        nextZ = c.z + nz * minDist;
        const vDotN = fx * boatKin.speed * nx + fz * boatKin.speed * nz;
        if (vDotN < 0) {
          const vx = fx * boatKin.speed - vDotN * nx;
          const vz = fz * boatKin.speed - vDotN * nz;
          const remaining = Math.hypot(vx, vz);
          boatKin.speed = remaining * (boatKin.speed >= 0 ? 1 : -1) * 0.75;
        }
      }
    }
    boat.position.x = nextX;
    boat.position.z = nextZ;
  }

  boat.rotation.y = boatKin.heading;

  // ── 船体浮力：直接采样世界坐标下的水面高度 + 干舷 ──
  // 波形在世界空间中稳定，boat 直接跟随，无 lerp（避免帧率波动导致的抖动）
  const bx = boat.position.x;
  const bz = boat.position.z;
  const waveY = waterHeightAt(bx, bz, elapsed);

  // 采样附近波高算坡度 → 船身自然 roll/pitch
  const eps = 1.2;
  const hR = waterHeightAt(bx + eps, bz, elapsed);
  const hL = waterHeightAt(bx - eps, bz, elapsed);
  const hF = waterHeightAt(bx, bz + eps, elapsed);
  const hB = waterHeightAt(bx, bz - eps, elapsed);
  const dhdx = (hR - hL) / (2 * eps);
  const dhdz = (hF - hB) / (2 * eps);

  // 直接赋值（wave 函数本身平滑，无需 lerp，反而 lerp 在变帧率下会抖）
  boat.position.y = waveY + BOAT_FREEBOARD;
  // 摇晃幅度降到 0.20（原 0.35），避免相机跟着晃产生"船在飘"的视错觉
  boat.rotation.z = dhdx * 0.20;
  boat.rotation.x = -dhdz * 0.20;

  // 同步物理 body 的 Y（虽然 gravity=0，但 body 的位置要跟船一致，
  // 免得高高的礁石 collider 顶部露出水面后跟胶囊互相错位）
  if (physics.ready && physics.boatBody) {
    const t = physics.boatBody.translation();
    physics.boatBody.setNextKinematicTranslation({
      x: t.x, y: boat.position.y, z: t.z,
    });
  }

  // 相机环视（不再加 micro-sway，避免与船体浮力叠加导致抖动感）
  // 钓鱼时接管：忽略玩家输入，把 targetYaw/Pitch 平滑指向浮标
  if (isFishingBusy()) {
    if (!lookState.wasFishing) {
      lookState.savedYaw   = lookState.targetYaw;
      lookState.savedPitch = lookState.targetPitch;
      // 记录抛竿瞬间的 yaw —— 后面所有帧的 yaw 都会硬 clamp 在这个锚点 ±MAX 内
      lookState.fishingAnchorYaw = lookState.yaw;
      lookState.wasFishing = true;
    }
    // 浮标世界位置 → cameraRig 局部坐标 → 求 yaw/pitch（camera.rotation.order = 'YXZ'）
    cameraRig.updateMatrixWorld();
    const localTgt = fishingRod.bobber.position.clone();
    cameraRig.worldToLocal(localTgt);
    const len = localTgt.length();
    if (len > 0.01) {
      // YXZ 顺序下，相机 forward = ( -sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch) )
      const fx = localTgt.x / len;
      const fy = localTgt.y / len;
      const fz = localTgt.z / len;
      const targetPitch = Math.asin(Math.max(-1, Math.min(1, fy)));
      const rawTargetYaw = Math.atan2(-fx, -fz);   // ∈ (-π, π]

      // ── Yaw 硬限位 ─────────────────────────────────────────────
      // 用 wrapAngle 算"从锚点到 rawTargetYaw 的最短角差"（结果 ∈ (-π, π]）；
      // 这样 rawTargetYaw 无论是 +3.1 还是 -3.1（跨 π 边界），得到的偏差都是短向。
      // 再把偏差硬 clamp 到 ±FISHING_MAX_YAW_DEV，把结果解卷成绝对 yaw。
      // → 无论何时都不会让 targetYaw 距离锚点超过 MAX，防止镜头绕远路狂甩。
      let yawDev = wrapAngle(rawTargetYaw - lookState.fishingAnchorYaw);
      yawDev = Math.max(-FISHING_MAX_YAW_DEV, Math.min(FISHING_MAX_YAW_DEV, yawDev));
      lookState.targetYaw = lookState.fishingAnchorYaw + yawDev;

      // 钓鱼专用 pitch 限幅：避免浮标离船很近时相机猛俯冲，视野被自己甲板占满
      lookState.targetPitch = Math.max(FISHING_PITCH_MIN, Math.min(FISHING_PITCH_MAX, targetPitch));
    }

    // Yaw 用"最短角差 lerp" —— 即使 targetYaw 与 yaw 之间隔了一个 2π，
    // 也走短的那一边；配合上面 targetYaw 已经被限位在 anchor ±MAX，
    // 双保险保证镜头/鱼竿的任何旋转都不会超出 MAX 一格。
    const yawDelta = wrapAngle(lookState.targetYaw - lookState.yaw);
    lookState.yaw += yawDelta * LOOK_TUNE.followLerp;
    lookState.pitch += (lookState.targetPitch - lookState.pitch) * LOOK_TUNE.followLerp;

    // 兜底硬 clamp：即使 lerp 因为浮点误差短暂越界，也强制拉回 anchor ±MAX。
    let yawFromAnchor = wrapAngle(lookState.yaw - lookState.fishingAnchorYaw);
    yawFromAnchor = Math.max(-FISHING_MAX_YAW_DEV, Math.min(FISHING_MAX_YAW_DEV, yawFromAnchor));
    lookState.yaw = lookState.fishingAnchorYaw + yawFromAnchor;
    lookState.pitch = Math.max(FISHING_PITCH_MIN, Math.min(FISHING_PITCH_MAX, lookState.pitch));
  } else {
    if (lookState.wasFishing) {
      // 刚结束钓鱼：不强制拉回，保持镜头在原钓鱼视角，玩家想调再拖鼠标
      lookState.wasFishing = false;
    }
    // 非钓鱼路径保持原始 lerp（targetYaw 是从鼠标累加的，与 yaw 差值本身就小，不会跨圈）
    lookState.yaw   += (lookState.targetYaw   - lookState.yaw)   * LOOK_TUNE.followLerp;
    lookState.pitch += (lookState.targetPitch - lookState.pitch) * LOOK_TUNE.followLerp;
  }

  camera.rotation.set(lookState.pitch, lookState.yaw, 0);

  // 天空盒跟随相机（保持"无限远"错觉）
  const camWorld = camera.getWorldPosition(new THREE.Vector3());
  sky.mesh.position.copy(camWorld);

  // 水面 mesh 平滑跟随相机 xz —— 波纹现在是世界空间，mesh 移动不影响相位
  // 直接赋值，不再 floor snap（snap 会导致离散跳变 = 抖动）
  water.mesh.position.x = camWorld.x;
  water.mesh.position.z = camWorld.z;

  // 阴影相机中心跟随船 —— 避免船移动时 shadow map texel 采样漂移
  // 造成的"顺水流方向流动"的自阴影条纹
  const sunDX = 40, sunDY = 45, sunDZ = 60;
  sun.position.set(boat.position.x + sunDX, sunDY, boat.position.z + sunDZ);
  sun.target.position.set(boat.position.x, 0, boat.position.z);
  sun.target.updateMatrixWorld();

  waterU.uCameraNear.value = camera.near;
  waterU.uCameraFar.value = camera.far;

  /* ── Pass1：隐藏水面 → 渲染场景到 sceneRT（拿到水下颜色 + 深度） ── */
  water.mesh.visible = false;
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);

  /* ── Pass2：显示水面 → 正常渲染到屏幕 ── */
  water.mesh.visible = true;
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);

  // 更新 HUD
  if (hudSpeedEl) hudSpeedEl.textContent = boatKin.speed.toFixed(1);

  // 检测船身所在的钓鱼海域 → 切换屏幕中央的 F 键提示
  updateActiveFishingZone();
  // 检测港口补给圈 —— 进入即补满
  updateActivePortRefill();

  // 驱动钓鱼海域的波纹 shader 时间
  for (const z of fishingZones) {
    const t = z.object.userData?.tick;
    if (typeof t === 'function') t(dt);
  }

  // 钩子系统（涟漪 / 气泡 / 漂流瓶 / 鲨鱼鳍）
  fishingHooks?.update(dt, boat.position);

  // Minimap
  minimap?.draw({
    boatX: boat.position.x,
    boatZ: boat.position.z,
    boatHeading: boat.rotation.y,
    zones: fishingZones,
    ports: portRefills,
    hooks: fishingHooks?.getMinimapMarkers() ?? [],
  });

  // 钓鱼小游戏每帧推进（内部会根据 state 自动 no-op）
  fishingGame?.update(dt, waveHeightAt, boat.position);

  requestAnimationFrame(tick);
}

// 页面加载：先进港口，再启动渲染循环（避免首帧闪出 Three.js 场景）
portHub.show();
hubState.setMode('port_hub');
syncPlayfieldVisibility();
tick();
