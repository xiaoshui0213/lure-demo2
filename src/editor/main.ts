import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { createSkyDome, type SkyUniforms } from '../proto/SkyMaterial';
import { createWaterMesh, type WaterUniforms } from '../proto/WaterMaterial';
import { MODEL_LIBRARY, getModelDef, registerModel, removeModel, onModelLibraryChange, type ModelDef } from './models';
import { loadGLTFExploded, setMaxAnisotropy } from './loadGLTF';
import { createStylizedMaterial, setStylizedViewportHeight } from '../render/StylizedMaterial';
import { REFERENCE_ISLAND_PALETTE } from '../render/palettes';

/* ────────────────────────────────────────────────────────────
   配置
   ──────────────────────────────────────────────────────────── */

const GRID = {
  cellSize: 4,      // 每个格子 4m × 4m
  // 64 × 64 格 = 256m × 256m；原来 48 × 48 的可编辑面积是 192m × 192m
  cols: 64,         // 列数
  rows: 64,         // 行数
};

const STORAGE_KEY = 'lure-editor-scene-v1';
/** glTF 多顶层拆分时产生的空白变体 —— 加载时自动剔除 */
const DEPRECATED_MODEL_IDS = new Set(['island_medium_2', 'island_large', 'island_large_1', 'island_large_2']);
/** 旧版 #1 变体 id → 合并后的正式 id */
const MODEL_ID_MIGRATIONS: Record<string, string> = {
  island_medium_1: 'island_medium',
};

interface NodeData {
  id: string;
  modelId: string;
  col: number;
  row: number;
  rotationY: number;
  scale: number;
  /** 覆盖 def.yOffset —— 用于 Inspector 逐个调节石头下沉深度等 */
  yOffset?: number;
  name?: string;
}

interface SceneData {
  version: 1;
  name: string;
  grid: { cellSize: number; cols: number; rows: number };
  nodes: NodeData[];
}

/* ────────────────────────────────────────────────────────────
   基础渲染
   ──────────────────────────────────────────────────────────── */

const viewport = document.getElementById('viewport') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true });
// 编辑器以布局预览为主，限制像素比避免 4K 屏上 RT 过大
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.0));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

// 拉满贴图各向异性 —— 消除斜视角 moire/锯齿
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 3000);
camera.position.set(60, 55, 60);
camera.lookAt(0, 0, 0);

/* ────────────────────────────────────────────────────────────
   光照
   ──────────────────────────────────────────────────────────── */

const sun = new THREE.DirectionalLight('#fff2c4', 1.4);
sun.position.set(60, 80, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const shadowRange = (GRID.cellSize * Math.max(GRID.cols, GRID.rows)) / 2 + 20;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 300;
sun.shadow.camera.left = -shadowRange;
sun.shadow.camera.right = shadowRange;
sun.shadow.camera.top = shadowRange;
sun.shadow.camera.bottom = -shadowRange;
// 关键：解决 shadow acne（曲面上的平行条纹自阴影 artifact）
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun);

const hemi = new THREE.HemisphereLight('#a8d5e2', '#3d6f68', 0.6);
scene.add(hemi);

/* ────────────────────────────────────────────────────────────
   天空 + 水面（复用 prototype 管线）
   ──────────────────────────────────────────────────────────── */

const sky = createSkyDome(1500);
const skyU = sky.material.uniforms as unknown as SkyUniforms;
// 编辑器不需要动态云（FBM 开销大），关掉以减轻 fragment 压力
skyU.uCloudOpacity.value = 0;
scene.add(sky.mesh);

const worldSize = GRID.cellSize * Math.max(GRID.cols, GRID.rows) + 80;
// 预览用水面：64 段足够，原来 272 段 ≈ 7.4 万面，每帧双遍渲染非常吃 GPU
const water = createWaterMesh(worldSize, 64);
const waterU = water.material.uniforms as unknown as WaterUniforms;
waterU.uCameraNear.value = camera.near;
waterU.uCameraFar.value = camera.far;
scene.add(water.mesh);

// 海底 seabed
{
  const seabedGeo = new THREE.PlaneGeometry(worldSize * 1.5, worldSize * 1.5, 32, 32);
  seabedGeo.rotateX(-Math.PI / 2);
  const pos = seabedGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const bump = Math.sin(x * 0.08) * 0.4 + Math.cos(z * 0.09) * 0.35 + Math.sin((x + z) * 0.13) * 0.25;
    pos.setY(i, bump);
  }
  seabedGeo.computeVertexNormals();
  const seabed = new THREE.Mesh(seabedGeo, createStylizedMaterial({ color: '#d9c396', flatShading: true }));
  seabed.userData.noOutline = true;
  seabed.position.y = -3.2;
  seabed.receiveShadow = true;
  scene.add(seabed);
}

// 应用与 prototype 一致的 noon preset 配色（同步天空 → 水面 shader）
function syncSunToWater() {
  const dir = new THREE.Vector3().copy(sun.position).normalize();
  skyU.uSunDirection.value.copy(dir);
  waterU.uSunDirection.value.copy(dir);
  waterU.uHorizonColor.value.copy(skyU.uHorizonColor.value);
  waterU.uZenithColor.value.copy(skyU.uZenithColor.value);
  waterU.uSunColor.value.copy(skyU.uSunColor.value);
}
syncSunToWater();

/* ────────────────────────────────────────────────────────────
   深度 RT（水面 shader 采样，保证视觉一致）
   ──────────────────────────────────────────────────────────── */

function createSceneRT(w: number, h: number): THREE.WebGLRenderTarget {
  const depthTex = new THREE.DepthTexture(w, h);
  depthTex.type = THREE.UnsignedIntType;
  depthTex.format = THREE.DepthFormat;
  return new THREE.WebGLRenderTarget(w, h, {
    depthTexture: depthTex,
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
}
let sceneRT = createSceneRT(
  Math.floor(innerWidth * renderer.getPixelRatio()),
  Math.floor(innerHeight * renderer.getPixelRatio()),
);
waterU.uDepthTexture.value = sceneRT.depthTexture;
waterU.uSceneColorTexture.value = sceneRT.texture;
waterU.uResolution.value.set(sceneRT.width, sceneRT.height);

/* ────────────────────────────────────────────────────────────
   Orbit 控制
   ──────────────────────────────────────────────────────────── */

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.mouseButtons = {
  LEFT: -1 as unknown as THREE.MOUSE, // 禁用左键旋转，让左键专职放置
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: -1 as unknown as THREE.MOUSE, // 禁用右键，让右键专职删除
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};
controls.minDistance = 8;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0, 0);

/* ────────────────────────────────────────────────────────────
   Transform Gizmo（UE 风格：W 位移 / E 旋转 / R 缩放）
   ──────────────────────────────────────────────────────────── */

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(0.9);
transformControls.setSpace('world');
// r165+ 需要 getHelper()，r150- 直接 add(transformControls)
const gizmoHelper = (transformControls as unknown as { getHelper?: () => THREE.Object3D }).getHelper
  ? (transformControls as unknown as { getHelper: () => THREE.Object3D }).getHelper()
  : (transformControls as unknown as THREE.Object3D);
scene.add(gizmoHelper);

// 拖 gizmo 时禁用 Orbit，防止相机被一起转
transformControls.addEventListener('dragging-changed', (event) => {
  const ev = event as unknown as { value: boolean };
  controls.enabled = !ev.value;
  if (!ev.value && selectedId) {
    altDuplicateArmed = false;
    // 拖拽结束 → 刷 Inspector 显示最新值
    const inst = nodes.get(selectedId);
    if (inst) renderInspector(inst);
  }
});

// TransformControls 在 pointerDown 后、真正位移前会发 mouseDown。
// 此时 Alt 已按下就复制并把 gizmo 挂到副本上，行为与 UE 的 Alt+拖轴一致。
let altDuplicateArmed = false;
transformControls.addEventListener('mouseDown', () => {
  // 一次 gizmo 拖拽 = 一步撤销（含 Alt 复制后的拖动）
  if (selectedId) recordUndoSnapshot();
  if (!altDuplicateArmed || transformControls.mode !== 'translate' || !selectedId) return;
  const source = nodes.get(selectedId);
  if (!source) return;
  altDuplicateArmed = false; // 一次拖拽只能生成一个副本
  const copy = duplicateNodeForTransform(source);
  if (copy) selectNode(copy.data.id);
});

// gizmo 修改物体时，实时同步回 NodeData
transformControls.addEventListener('objectChange', () => {
  if (!selectedId) return;
  const inst = nodes.get(selectedId);
  if (!inst) return;
  const obj = inst.object;

  if (transformControls.mode === 'translate') {
    // XZ 吸附到最近格子，Y 自由（对应 yOffset）
    syncTranslatedNode(inst);
    inst.data.yOffset = obj.position.y;
    selectionRing.position.set(obj.position.x, 0.06, obj.position.z);
  } else if (transformControls.mode === 'rotate') {
    // 只保留 Y 旋转（水面上物体绕垂直轴转最自然）
    obj.rotation.x = 0;
    obj.rotation.z = 0;
    inst.data.rotationY = obj.rotation.y;
  } else if (transformControls.mode === 'scale') {
    // 强制等比缩放
    const s = Math.max(0.1, obj.scale.x);
    obj.scale.setScalar(s);
    inst.data.scale = s;
  }
  autoSave();
});

/* ────────────────────────────────────────────────────────────
   网格系统
   ──────────────────────────────────────────────────────────── */

const gridGroup = new THREE.Group();
gridGroup.name = 'grid';
scene.add(gridGroup);

function buildGridMesh() {
  gridGroup.clear();

  const totalW = GRID.cellSize * GRID.cols;
  const totalH = GRID.cellSize * GRID.rows;
  const halfW = totalW / 2;
  const halfH = totalH / 2;

  // 主要网格线
  const material = new THREE.LineBasicMaterial({
    color: 0x88bbff, transparent: true, opacity: 0.35,
  });
  const positions: number[] = [];
  for (let i = 0; i <= GRID.cols; i++) {
    const x = -halfW + i * GRID.cellSize;
    positions.push(x, 0.02, -halfH, x, 0.02, halfH);
  }
  for (let j = 0; j <= GRID.rows; j++) {
    const z = -halfH + j * GRID.cellSize;
    positions.push(-halfW, 0.02, z, halfW, 0.02, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geo, material);
  gridGroup.add(lines);

  // 边界高亮
  const boundGeo = new THREE.BufferGeometry();
  boundGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -halfW, 0.03, -halfH,  halfW, 0.03, -halfH,
     halfW, 0.03, -halfH,  halfW, 0.03,  halfH,
     halfW, 0.03,  halfH, -halfW, 0.03,  halfH,
    -halfW, 0.03,  halfH, -halfW, 0.03, -halfH,
  ], 3));
  const boundLines = new THREE.LineSegments(
    boundGeo,
    new THREE.LineBasicMaterial({ color: 0x4dd0ff, transparent: true, opacity: 0.8 }),
  );
  gridGroup.add(boundLines);
}
buildGridMesh();

// 高亮 cell（跟随鼠标）
const hoverGeo = new THREE.PlaneGeometry(GRID.cellSize, GRID.cellSize);
hoverGeo.rotateX(-Math.PI / 2);
const hover = new THREE.Mesh(
  hoverGeo,
  new THREE.MeshBasicMaterial({ color: 0x4dd0ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
);
hover.position.y = 0.04;
hover.visible = false;
scene.add(hover);

// 隐形的地面平面用于 raycast
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/* ────────────────────────────────────────────────────────────
   Grid 坐标 <-> 世界坐标
   ──────────────────────────────────────────────────────────── */

function cellToWorld(col: number, row: number): { x: number; z: number } {
  const halfW = (GRID.cellSize * GRID.cols) / 2;
  const halfH = (GRID.cellSize * GRID.rows) / 2;
  return {
    x: -halfW + (col + 0.5) * GRID.cellSize,
    z: -halfH + (row + 0.5) * GRID.cellSize,
  };
}

function worldToCell(x: number, z: number): { col: number; row: number } | null {
  const halfW = (GRID.cellSize * GRID.cols) / 2;
  const halfH = (GRID.cellSize * GRID.rows) / 2;
  const col = Math.floor((x + halfW) / GRID.cellSize);
  const row = Math.floor((z + halfH) / GRID.cellSize);
  if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) return null;
  return { col, row };
}

/* ────────────────────────────────────────────────────────────
   节点管理
   ──────────────────────────────────────────────────────────── */

interface NodeInstance {
  data: NodeData;
  object: THREE.Object3D;
  def: ModelDef;
}

const nodes = new Map<string, NodeInstance>(); // id → instance
const cellIndex = new Map<string, string>();   // "col,row" → node id
const nodesGroup = new THREE.Group();
nodesGroup.name = 'placed-nodes';
scene.add(nodesGroup);

function cellKey(col: number, row: number) { return `${col},${row}`; }

function makeId(): string {
  return 'n_' + Math.random().toString(36).slice(2, 9);
}

/* ─── 船只出生点 ───
 * 没有放置「起点（船）」节点时，编辑器始终在世界原点显示默认出生点；
 * 放置起点节点后，该节点自身就是出生点标识，默认标识自动隐藏，避免重叠。
 */
const defaultSpawnMarker = getModelDef('spawn')!.build();
defaultSpawnMarker.name = 'default-boat-spawn-marker';
defaultSpawnMarker.position.set(0, 0, 0);
scene.add(defaultSpawnMarker);

function updateSpawnMarker() {
  const placedSpawn = Array.from(nodes.values()).some((node) => node.data.modelId === 'spawn');
  defaultSpawnMarker.visible = !placedSpawn;
}

function placeNode(
  modelId: string,
  col: number,
  row: number,
  opts?: { rotationY?: number; scale?: number; id?: string; yOffset?: number; skipHistory?: boolean },
): NodeInstance | null {
  const def = getModelDef(modelId);
  if (!def) { console.warn('Unknown model:', modelId); return null; }

  if (!opts?.skipHistory) recordUndoSnapshot();

  // 覆盖已有节点
  const existing = cellIndex.get(cellKey(col, row));
  if (existing) removeNode(existing, true);

  const obj = def.build();
  const { x, z } = cellToWorld(col, row);
  const yOff = opts?.yOffset ?? def.yOffset;
  obj.position.set(x, yOff, z);
  obj.rotation.y = opts?.rotationY ?? 0;
  const s = opts?.scale ?? 1;
  obj.scale.setScalar(s);
  nodesGroup.add(obj);

  const data: NodeData = {
    id: opts?.id ?? makeId(),
    modelId,
    col, row,
    rotationY: opts?.rotationY ?? 0,
    scale: s,
    yOffset: opts?.yOffset,   // undefined 时使用 def.yOffset
  };

  const inst: NodeInstance = { data, object: obj, def };
  nodes.set(data.id, inst);
  cellIndex.set(cellKey(col, row), data.id);
  updateSpawnMarker();
  updateStats();
  autoSave();
  return inst;
}

/** Alt+拖动 gizmo 时创建副本。副本先与原物重叠，首次移出原格才写入 cellIndex。 */
function duplicateNodeForTransform(source: NodeInstance): NodeInstance | null {
  const obj = source.def.build();
  obj.position.copy(source.object.position);
  obj.rotation.copy(source.object.rotation);
  obj.scale.copy(source.object.scale);
  nodesGroup.add(obj);

  const data: NodeData = {
    ...source.data,
    id: makeId(),
    name: source.data.name ? `${source.data.name} 副本` : undefined,
  };
  const copy: NodeInstance = { data, object: obj, def: source.def };
  // 注意：不占用 source 当前 cell；否则复制时会把原物从 cellIndex 覆盖掉。
  nodes.set(data.id, copy);
  updateStats();
  return copy;
}

/** 将 gizmo 位移同步到数据与格索引；遇到占用格则还原到它自己的上一个合法格。 */
function syncTranslatedNode(inst: NodeInstance) {
  const cell = worldToCell(inst.object.position.x, inst.object.position.z);
  if (!cell) return;
  const oldKey = cellKey(inst.data.col, inst.data.row);
  const newKey = cellKey(cell.col, cell.row);
  if (oldKey === newKey) return;

  const occupier = cellIndex.get(newKey);
  if (occupier && occupier !== inst.data.id) {
    const original = cellToWorld(inst.data.col, inst.data.row);
    inst.object.position.set(original.x, inst.object.position.y, original.z);
    return;
  }

  // 原格只有在它确实属于当前实例时才能删除：
  // Alt 复制出的副本在移动前与原物同格，但 cellIndex 仍归原物所有。
  if (cellIndex.get(oldKey) === inst.data.id) cellIndex.delete(oldKey);
  cellIndex.set(newKey, inst.data.id);
  inst.data.col = cell.col;
  inst.data.row = cell.row;
}

function removeNode(id: string, skipHistory = false) {
  const inst = nodes.get(id);
  if (!inst) return;
  if (!skipHistory) recordUndoSnapshot();
  nodesGroup.remove(inst.object);
  inst.object.traverse((o) => {
    if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose?.();
  });
  cellIndex.delete(cellKey(inst.data.col, inst.data.row));
  nodes.delete(id);
  if (selectedId === id) selectNode(null);
  updateSpawnMarker();
  updateStats();
  autoSave();
}

function clearAll(skipHistory = false) {
  if (!skipHistory) recordUndoSnapshot();
  for (const id of Array.from(nodes.keys())) removeNode(id, true);
}

/* ────────────────────────────────────────────────────────────
   选中 & Inspector
   ──────────────────────────────────────────────────────────── */

let selectedId: string | null = null;
const selectionRing = new THREE.Mesh(
  new THREE.RingGeometry(GRID.cellSize * 0.55, GRID.cellSize * 0.62, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
);
selectionRing.rotation.x = -Math.PI / 2;
selectionRing.position.y = 0.06;
selectionRing.visible = false;
scene.add(selectionRing);

function selectNode(id: string | null) {
  selectedId = id;
  if (!id) {
    selectionRing.visible = false;
    transformControls.detach();
    renderInspector(null);
    return;
  }
  const inst = nodes.get(id);
  if (!inst) return;
  selectionRing.visible = true;
  selectionRing.position.set(inst.object.position.x, 0.06, inst.object.position.z);
  refreshGizmoAttachment();
  renderInspector(inst);
}

/** 只有 place 模式下把 gizmo 挂到选中节点上；select 模式一律隐藏 */
function refreshGizmoAttachment() {
  if (state.tool === 'place' && selectedId) {
    const inst = nodes.get(selectedId);
    if (inst) transformControls.attach(inst.object);
    else transformControls.detach();
  } else {
    transformControls.detach();
  }
}

/* ────────────────────────────────────────────────────────────
   工具状态
   ──────────────────────────────────────────────────────────── */

type Tool = 'place' | 'erase' | 'select';
const state = {
  tool: 'place' as Tool,
  currentModelId: 'rock' as string,
  currentRotation: 0,
  gridVisible: true,
  waterVisible: true,
};

/* ────────────────────────────────────────────────────────────
   UI —— 模型库 / 工具 / Inspector / Toolbar
   ──────────────────────────────────────────────────────────── */

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// 模型库
const modelListEl = el('model-list');
function renderModelList() {
  modelListEl.innerHTML = '';
  for (const def of MODEL_LIBRARY) {
    const card = document.createElement('div');
    card.className = 'model-card' + (def.id === state.currentModelId ? ' active' : '');
    card.innerHTML = `
      <div class="model-swatch" style="background:${def.swatch}"></div>
      <div class="model-info">
        <div class="model-name">${def.name}</div>
        <div class="model-hint">${def.category}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      state.currentModelId = def.id;
      state.tool = 'place';
      renderModelList();
      renderToolList();
      updateStats();
    });
    modelListEl.appendChild(card);
  }
}
renderModelList();

// 工具按钮
const toolListEl = el('tool-list');
function renderToolList() {
  toolListEl.innerHTML = '';
  const tools: [Tool, string][] = [
    ['place', '放置'],
    ['select', '选择'],
    ['erase', '橡皮擦'],
  ];
  const row = document.createElement('div');
  row.className = 'tool-row';
  for (const [t, label] of tools) {
    const b = document.createElement('button');
    b.className = 'btn' + (state.tool === t ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      state.tool = t;
      renderToolList();
      updateStats();
      refreshGizmoAttachment();
    });
    row.appendChild(b);
  }
  toolListEl.appendChild(row);
}
renderToolList();

// Inspector
const inspectorBodyEl = el('inspector-body');
function renderInspector(inst: NodeInstance | null) {
  if (!inst) {
    inspectorBodyEl.innerHTML = `<div class="empty-hint">未选中节点<br/>选择工具下点击节点即可编辑</div>`;
    return;
  }
  const d = inst.data;
  const world = cellToWorld(d.col, d.row);
  inspectorBodyEl.innerHTML = `
    <h2>${inst.def.name}</h2>
    <div class="field"><label>ID</label><input type="text" value="${d.id}" readonly /></div>
    <div class="field"><label>名称</label><input type="text" id="i-name" value="${d.name ?? ''}" placeholder="可选" /></div>
    <div class="field"><label>Model</label>
      <select id="i-model" style="flex:1;padding:6px 8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:4px;color:#e0e5ea;font-size:12px;">
        ${MODEL_LIBRARY.map((m) => `<option value="${m.id}" ${m.id === d.modelId ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
    </div>

    <h2>网格位置</h2>
    <div class="field axis-x"><label>Col</label><input type="number" id="i-col" value="${d.col}" step="1" min="0" max="${GRID.cols - 1}" /></div>
    <div class="field axis-z"><label>Row</label><input type="number" id="i-row" value="${d.row}" step="1" min="0" max="${GRID.rows - 1}" /></div>
    <div style="font-size:11px;color:#6b8395;margin:6px 0 10px;">世界坐标 (${world.x.toFixed(1)}, ${world.z.toFixed(1)})</div>

    <h2>Transform</h2>
    <div class="field axis-y"><label>Rot Y°</label><input type="number" id="i-rot" value="${(d.rotationY * 180 / Math.PI).toFixed(1)}" step="15" /></div>
    <div class="field"><label>Scale</label><input type="number" id="i-scale" value="${d.scale}" step="0.1" min="0.1" max="5" /></div>
    <div class="field axis-y"><label>Y 深度</label><input type="number" id="i-yoffset" value="${(d.yOffset ?? inst.def.yOffset).toFixed(2)}" step="0.05" title="负值 = 沉入水面（水面 y=0）；调到 -0.3 ~ -0.5 可看到 foam 效果" /></div>

    <div class="tool-row" style="margin-top:14px;">
      <button class="btn danger" id="i-delete">删除节点</button>
    </div>
  `;

  const bindNum = (idInput: string, cb: (v: number) => void) => {
    const inp = document.getElementById(idInput) as HTMLInputElement;
    inp.addEventListener('focus', () => recordUndoSnapshot());
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isNaN(v)) cb(v); });
  };
  bindNum('i-col', (v) => moveNodeToCell(d.id, Math.max(0, Math.min(GRID.cols - 1, Math.round(v))), d.row));
  bindNum('i-row', (v) => moveNodeToCell(d.id, d.col, Math.max(0, Math.min(GRID.rows - 1, Math.round(v)))));
  bindNum('i-rot', (v) => setNodeRotation(d.id, v * Math.PI / 180));
  bindNum('i-scale', (v) => setNodeScale(d.id, Math.max(0.1, Math.min(5, v))));
  bindNum('i-yoffset', (v) => setNodeYOffset(d.id, v));

  const nameInp = document.getElementById('i-name') as HTMLInputElement;
  nameInp.addEventListener('focus', () => recordUndoSnapshot());
  nameInp.addEventListener('input', (e) => {
    d.name = (e.target as HTMLInputElement).value;
    autoSave();
  });
  (document.getElementById('i-model') as HTMLSelectElement).addEventListener('change', (e) => {
    recordUndoSnapshot();
    const newModel = (e.target as HTMLSelectElement).value;
    replaceNodeModel(d.id, newModel, true);
  });
  (document.getElementById('i-delete') as HTMLButtonElement).addEventListener('click', () => {
    removeNode(d.id);
  });
}
renderInspector(null);

function moveNodeToCell(id: string, col: number, row: number) {
  const inst = nodes.get(id);
  if (!inst) return;
  if (cellIndex.get(cellKey(col, row)) && cellIndex.get(cellKey(col, row)) !== id) return; // 目标格已被占
  cellIndex.delete(cellKey(inst.data.col, inst.data.row));
  inst.data.col = col;
  inst.data.row = row;
  const { x, z } = cellToWorld(col, row);
  const yOff = inst.data.yOffset ?? inst.def.yOffset;
  inst.object.position.set(x, yOff, z);
  cellIndex.set(cellKey(col, row), id);
  if (selectedId === id) selectionRing.position.set(x, 0.06, z);
  autoSave();
}
function setNodeYOffset(id: string, y: number) {
  const inst = nodes.get(id);
  if (!inst) return;
  inst.data.yOffset = y;
  inst.object.position.y = y;
  autoSave();
}
function setNodeRotation(id: string, radY: number) {
  const inst = nodes.get(id);
  if (!inst) return;
  inst.data.rotationY = radY;
  inst.object.rotation.y = radY;
  autoSave();
}
function setNodeScale(id: string, s: number) {
  const inst = nodes.get(id);
  if (!inst) return;
  inst.data.scale = s;
  inst.object.scale.setScalar(s);
  autoSave();
}
function replaceNodeModel(id: string, newModelId: string, skipHistory = false) {
  const inst = nodes.get(id);
  if (!inst) return;
  const def = getModelDef(newModelId);
  if (!def) return;
  if (!skipHistory) recordUndoSnapshot();
  const { col, row, rotationY, scale, name } = inst.data;
  removeNode(id, true);
  const created = placeNode(newModelId, col, row, { rotationY, scale, id, skipHistory: true });
  if (created && name) { created.data.name = name; }
  selectNode(id);
}

/* ────────────────────────────────────────────────────────────
   Toolbar 按钮
   ──────────────────────────────────────────────────────────── */

let sceneName = '未命名场景';
const sceneNameEl = el('scene-name');

function updateSceneNameUI() {
  sceneNameEl.textContent = `— ${sceneName} —`;
}

el('new-scene').addEventListener('click', () => {
  if (nodes.size > 0 && !confirm('新建将清空当前场景，确定？')) return;
  clearAll();
  sceneName = '未命名场景';
  updateSceneNameUI();
});

el('save-scene').addEventListener('click', () => {
  const name = prompt('场景名称：', sceneName);
  if (!name) return;
  sceneName = name;
  updateSceneNameUI();
  autoSave();
  alert('✓ 已保存到浏览器 localStorage');
});

el('clear-scene').addEventListener('click', () => {
  if (!confirm('清空所有节点？')) return;
  clearAll();
});

el('download-scene').addEventListener('click', () => {
  const data = serialize();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (sceneName || 'scene') + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

const fileInputEl = el<HTMLInputElement>('file-input');
el('load-scene').addEventListener('click', () => fileInputEl.click());
fileInputEl.addEventListener('change', () => {
  const file = fileInputEl.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as SceneData;
      loadScene(data, { recordHistory: true });
      alert('✓ 场景已加载：' + data.name);
    } catch (e) { alert('导入失败：' + (e as Error).message); }
  };
  reader.readAsText(file);
  fileInputEl.value = '';
});

el('view-top').addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  const d = GRID.cellSize * Math.max(GRID.cols, GRID.rows) * 0.55;
  camera.position.set(0, d, 0.001);
  camera.lookAt(0, 0, 0);
  controls.update();
});
el('view-persp').addEventListener('click', () => {
  controls.target.set(0, 0, 0);
  const d = GRID.cellSize * Math.max(GRID.cols, GRID.rows) * 0.6;
  camera.position.set(d * 0.7, d * 0.65, d * 0.7);
  camera.lookAt(0, 0, 0);
  controls.update();
});
el('toggle-grid').addEventListener('click', () => {
  state.gridVisible = !state.gridVisible;
  gridGroup.visible = state.gridVisible;
});
el('toggle-water').addEventListener('click', () => {
  state.waterVisible = !state.waterVisible;
  water.mesh.visible = state.waterVisible;
});
el('play-mode').addEventListener('click', () => {
  const url = new URL(location.href);
  url.pathname = url.pathname.replace(/editor\.html$/, 'prototype.html');
  url.searchParams.set('fromEditor', '1');
  window.open(url.toString(), '_blank');
});

/* ────────────────────────────────────────────────────────────
   glTF / GLB 导入（按钮 + 拖拽）
   ──────────────────────────────────────────────────────────── */

const modelFileInputEl = el<HTMLInputElement>('model-file-input');
el('import-model').addEventListener('click', () => modelFileInputEl.click());
modelFileInputEl.addEventListener('change', async () => {
  const file = modelFileInputEl.files?.[0];
  modelFileInputEl.value = '';
  if (file) await importGLBFile(file);
});

// 拖入窗口任意位置即导入
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(glb|gltf)$/i.test(file.name)) return;
  e.preventDefault();
  await importGLBFile(file);
});

async function importGLBFile(file: File) {
  try {
    // 拆分模式：把 glTF 顶层子节点各自作为独立模型
    const parts = await loadGLTFExploded(file, {
      fitSize: 8.0,          // 整个 glTF 归一化到 8m，子物件之间保持相对比例
      stylize: true,         // 转成 StylizedMaterial（3渲2），保留 baseColor/normal/AO
      groundYToZero: true,
      centerXZ: true,
    });
    if (parts.length === 0) { alert('导入失败：glTF 没有可识别的顶层节点'); return; }

    const baseName = file.name.replace(/\.[^.]+$/, '');
    const idBase = sanitizeId(baseName);
    const stamp = Math.random().toString(36).slice(2, 5);

    const registered: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const displayName = part.name && !/^part_\d+$/.test(part.name)
        ? part.name
        : (parts.length === 1 ? baseName : `${baseName}_${i + 1}`);
      const id = `user_${idBase}_${sanitizeId(part.name || String(i))}_${stamp}`;
      registerModel({
        id,
        name: displayName,
        swatch: '#ffb84d',
        category: 'landmark',
        yOffset: part.suggestedYOffset,   // 按 part 高度自动算出的下沉量 → foam
        build: part.build,
        rotatable: true,
        scalable: true,
      });
      registered.push(id);
    }

    // 选中第一个便于立即放置
    if (registered.length > 0) {
      state.currentModelId = registered[0];
      state.tool = 'place';
      updateStats();
    }
    console.log(`[import] 已加入 ${parts.length} 个模型：`, registered);
    if (parts.length > 1) {
      // 只在多物件时提示一下，避免单模型也弹窗打扰
      console.log(`✓ 该 glTF 含 ${parts.length} 个物件，已各自注册到模型库`);
    }
  } catch (err) {
    console.error(err);
    alert('导入失败：' + (err as Error).message);
  }
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) || 'x';
}

// 模型库变化时刷新左侧 palette
onModelLibraryChange(() => {
  renderModelList();
  renderToolList();
});

/* ────────────────────────────────────────────────────────────
   序列化 / 反序列化
   ──────────────────────────────────────────────────────────── */

function serialize(): SceneData {
  return {
    version: 1,
    name: sceneName,
    grid: { ...GRID },
    nodes: Array.from(nodes.values()).map((n) => ({ ...n.data })),
  };
}

/** 将旧网格中的格坐标转换到当前网格，保持物件的世界坐标完全不变。 */
function migrateGridCoordinates(data: SceneData): SceneData {
  const source = data.grid ?? GRID;
  if (
    source.cellSize === GRID.cellSize
    && source.cols === GRID.cols
    && source.rows === GRID.rows
  ) return data;

  const sourceHalfW = (source.cellSize * source.cols) / 2;
  const sourceHalfH = (source.cellSize * source.rows) / 2;
  const targetHalfW = (GRID.cellSize * GRID.cols) / 2;
  const targetHalfH = (GRID.cellSize * GRID.rows) / 2;

  const migratedNodes = data.nodes
    .map((node) => {
      const worldX = -sourceHalfW + (node.col + 0.5) * source.cellSize;
      const worldZ = -sourceHalfH + (node.row + 0.5) * source.cellSize;
      const col = Math.floor((worldX + targetHalfW) / GRID.cellSize);
      const row = Math.floor((worldZ + targetHalfH) / GRID.cellSize);
      return { ...node, col, row };
    })
    .filter((node) => node.col >= 0 && node.col < GRID.cols && node.row >= 0 && node.row < GRID.rows);

  console.log(`[editor] 网格已从 ${source.cols}×${source.rows} 扩展到 ${GRID.cols}×${GRID.rows}，保留 ${migratedNodes.length} 个物件的位置`);
  return { ...data, grid: { ...GRID }, nodes: migratedNodes };
}

function loadScene(data: SceneData, opts?: { recordHistory?: boolean }) {
  if (opts?.recordHistory) recordUndoSnapshot();
  historySuspended = true;
  try {
    data = migrateGridCoordinates(data);
    clearAll(true);
    sceneName = data.name ?? '未命名场景';
    updateSceneNameUI();
    for (const nd of data.nodes) {
      placeNode(nd.modelId, nd.col, nd.row, {
        rotationY: nd.rotationY,
        scale: nd.scale,
        id: nd.id,
        yOffset: nd.yOffset,
        skipHistory: true,
      });
      if (nd.name) {
        const inst = nodes.get(nd.id);
        if (inst) inst.data.name = nd.name;
      }
    }
    updateSpawnMarker();
  } finally {
    historySuspended = false;
  }
}

/* ─── 撤销 / 重做（场景快照栈） ─── */
const MAX_UNDO = 50;
const undoStack: SceneData[] = [];
const redoStack: SceneData[] = [];
/** 恢复历史 / 批量 load 时不写入撤销栈 */
let historySuspended = false;

function cloneSceneData(): SceneData {
  return JSON.parse(JSON.stringify(serialize())) as SceneData;
}

function recordUndoSnapshot() {
  if (historySuspended) return;
  undoStack.push(cloneSceneData());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function applyHistorySnapshot(data: SceneData) {
  const keepSelect = selectedId;
  historySuspended = true;
  try {
    data = migrateGridCoordinates(data);
    clearAll(true);
    sceneName = data.name ?? '未命名场景';
    updateSceneNameUI();
    for (const nd of data.nodes) {
      placeNode(nd.modelId, nd.col, nd.row, {
        rotationY: nd.rotationY,
        scale: nd.scale,
        id: nd.id,
        yOffset: nd.yOffset,
        skipHistory: true,
      });
      if (nd.name) {
        const inst = nodes.get(nd.id);
        if (inst) inst.data.name = nd.name;
      }
    }
    updateSpawnMarker();
  } finally {
    historySuspended = false;
  }
  if (keepSelect && nodes.has(keepSelect)) selectNode(keepSelect);
  else selectNode(null);
  autoSave();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(cloneSceneData());
  applyHistorySnapshot(undoStack.pop()!);
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(cloneSceneData());
  applyHistorySnapshot(redoStack.pop()!);
}

let saveTimer: number | null = null;
let saveEnabled = false;   // 初始 loadScene 完成前禁止 autoSave，防止覆盖 localStorage
function autoSave() {
  if (!saveEnabled) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); }
    catch (e) { console.warn('save failed', e); }
    saveTimer = null;
  }, 350);
}

// 初始加载 localStorage —— 延后到 glTF 模型注册完成后，避免 rock_small / rock_medium / rock_large
// 因为异步加载还没完成而被 getModelDef 判为 undefined、被 loadScene 静默跳过
const initialSceneRaw = localStorage.getItem(STORAGE_KEY);
let initialSceneLoaded = false;
function tryLoadInitialScene() {
  if (initialSceneLoaded || !initialSceneRaw) {
    initialSceneLoaded = true;
    saveEnabled = true;
    return;
  }
  try {
    const data = JSON.parse(initialSceneRaw) as SceneData;
    const before = data.nodes.length;
    data.nodes = data.nodes
      .filter((n) => !DEPRECATED_MODEL_IDS.has(n.modelId))
      .map((n) => ({
        ...n,
        modelId: MODEL_ID_MIGRATIONS[n.modelId] ?? n.modelId,
      }));
    if (data.nodes.length < before) {
      console.log('[editor] 已移除空白变体节点:', [...DEPRECATED_MODEL_IDS].join(', '));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    loadScene(data);
    // loadScene 会把旧网格坐标无损迁移到当前 64×64 网格；
    // 初始加载期间 autoSave 被关闭，因此此处显式写回，确保 prototype 也读到新网格。
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch (e) { console.warn('load failed', e); }
  initialSceneLoaded = true;
  // 覆盖 loadScene 里 placeNode 触发的一堆 autoSave（虽然被 saveEnabled 挡住了，保险）
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveEnabled = true;
}
updateSceneNameUI();

/* ────────────────────────────────────────────────────────────
   鼠标交互（放置 / 删除 / 选中）
   ──────────────────────────────────────────────────────────── */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredCell: { col: number; row: number } | null = null;

function updatePointerFromEvent(e: MouseEvent) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
}

function pickCell(e: MouseEvent): { col: number; row: number } | null {
  updatePointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, point);
  if (!point) return null;
  return worldToCell(point.x, point.z);
}

function pickNode(e: MouseEvent): NodeInstance | null {
  updatePointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(nodesGroup.children, true);
  if (!hits.length) return null;
  // 找到 nodesGroup 直接子对象
  let obj: THREE.Object3D | null = hits[0].object;
  while (obj && obj.parent && obj.parent !== nodesGroup) obj = obj.parent;
  if (!obj) return null;
  for (const inst of nodes.values()) {
    if (inst.object === obj) return inst;
  }
  return null;
}

renderer.domElement.addEventListener('mousemove', (e) => {
  // 拖拽物体 / 操作 gizmo 时不做 cell 拾取
  if (dragMove || transformControls.dragging || transformControls.axis) {
    hover.visible = false;
    return;
  }
  const cell = pickCell(e);
  hoveredCell = cell;
  if (cell) {
    const { x, z } = cellToWorld(cell.col, cell.row);
    hover.position.set(x, 0.04, z);
    hover.visible = state.tool !== 'select';
    el('stat-cell').textContent = `(${cell.col}, ${cell.row})`;
  } else {
    hover.visible = false;
    el('stat-cell').textContent = '—';
  }
});

renderer.domElement.addEventListener('mouseleave', () => {
  hover.visible = false;
});

// 阻止右键菜单，专门用来删除
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

/* Select 模式：按住节点直接拖着走（无 gizmo 也能位移） */
interface DragMoveState {
  nodeId: string;
  startWorldHit: THREE.Vector3;
  startNodePos: THREE.Vector3;
  moved: boolean;
}
let dragMove: DragMoveState | null = null;

function onDragMouseMove(e: MouseEvent) {
  if (!dragMove) return;
  updatePointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const cur = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, cur)) return;
  const dx = cur.x - dragMove.startWorldHit.x;
  const dz = cur.z - dragMove.startWorldHit.z;
  if (Math.hypot(dx, dz) > 0.05) dragMove.moved = true;
  const inst = nodes.get(dragMove.nodeId);
  if (inst) {
    inst.object.position.x = dragMove.startNodePos.x + dx;
    inst.object.position.z = dragMove.startNodePos.z + dz;
    selectionRing.position.set(inst.object.position.x, 0.06, inst.object.position.z);
  }
}
function onDragMouseUp() {
  window.removeEventListener('mousemove', onDragMouseMove);
  window.removeEventListener('mouseup', onDragMouseUp);
  if (!dragMove) { controls.enabled = true; return; }
  const inst = nodes.get(dragMove.nodeId);
  if (inst && dragMove.moved) {
    // 松手 → XZ 吸附到最近格子
    const cell = worldToCell(inst.object.position.x, inst.object.position.z);
    if (cell) {
      const oldKey = cellKey(inst.data.col, inst.data.row);
      const newKey = cellKey(cell.col, cell.row);
      const occupier = cellIndex.get(newKey);
      if (occupier && occupier !== inst.data.id) {
        // 目标格已被占 → 回原位
        const orig = cellToWorld(inst.data.col, inst.data.row);
        inst.object.position.set(orig.x, inst.object.position.y, orig.z);
      } else {
        if (oldKey !== newKey) {
          cellIndex.delete(oldKey);
          cellIndex.set(newKey, inst.data.id);
          inst.data.col = cell.col;
          inst.data.row = cell.row;
        }
        const world = cellToWorld(inst.data.col, inst.data.row);
        inst.object.position.set(world.x, inst.object.position.y, world.z);
      }
      selectionRing.position.set(inst.object.position.x, 0.06, inst.object.position.z);
    }
    renderInspector(inst);
    autoSave();
  }
  dragMove = null;
  controls.enabled = true;
}
function startDragMove(inst: NodeInstance, e: MouseEvent): boolean {
  recordUndoSnapshot();
  updatePointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const startWorld = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, startWorld)) return false;
  dragMove = {
    nodeId: inst.data.id,
    startWorldHit: startWorld,
    startNodePos: inst.object.position.clone(),
    moved: false,
  };
  controls.enabled = false;
  window.addEventListener('mousemove', onDragMouseMove);
  window.addEventListener('mouseup', onDragMouseUp);
  return true;
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  // 正在操作 gizmo 时不进入自定义流程
  if (transformControls.dragging || transformControls.axis) return;

  // === Select 模式左键：按住节点直接拖着走（同时也起选中作用）===
  if (state.tool === 'select' && e.button === 0) {
    const hit = pickNode(e);
    if (hit) {
      if (hit.data.id !== selectedId) selectNode(hit.data.id);
      if (startDragMove(hit, e)) return;   // 拖拽启动成功 → 不再走 click 流程
    }
    // 空地：走标准 click（会 selectNode(null) 取消选中）
  }

  // 标准 click 检测
  const down = { x: e.clientX, y: e.clientY, t: performance.now() };
  const onUp = (ue: MouseEvent) => {
    renderer.domElement.removeEventListener('mouseup', onUp);
    if (transformControls.dragging) return;
    const dx = ue.clientX - down.x;
    const dy = ue.clientY - down.y;
    const moved = Math.hypot(dx, dy) > 3;
    const heldMs = performance.now() - down.t;
    if (moved || heldMs > 350) return; // 拖拽或长按不算点击
    handleClick(ue);
  };
  renderer.domElement.addEventListener('mouseup', onUp);
});

function handleClick(e: MouseEvent) {
  if (e.button === 2) {
    // 右键：删除节点
    const inst = pickNode(e) || (hoveredCell ? findByCell(hoveredCell.col, hoveredCell.row) : null);
    if (inst) removeNode(inst.data.id);
    return;
  }

  // 左键
  if (state.tool === 'select') {
    const inst = pickNode(e);
    selectNode(inst?.data.id ?? null);
    return;
  }

  if (state.tool === 'erase') {
    const inst = pickNode(e) || (hoveredCell ? findByCell(hoveredCell.col, hoveredCell.row) : null);
    if (inst) removeNode(inst.data.id);
    return;
  }

  // place 模式：点已有物体 → 选中（不覆盖），点空格子 → 放置
  const clickedNode = pickNode(e);
  if (clickedNode) {
    selectNode(clickedNode.data.id);
    return;
  }
  if (!hoveredCell) return;
  const cellNode = findByCell(hoveredCell.col, hoveredCell.row);
  if (cellNode) {
    selectNode(cellNode.data.id);
    return;
  }
  const created = placeNode(state.currentModelId, hoveredCell.col, hoveredCell.row, {
    rotationY: state.currentRotation,
  });
  if (created) selectNode(created.data.id);
}

function findByCell(col: number, row: number): NodeInstance | null {
  const id = cellIndex.get(cellKey(col, row));
  return id ? nodes.get(id) ?? null : null;
}

/* ────────────────────────────────────────────────────────────
   键盘快捷键
   ──────────────────────────────────────────────────────────── */

addEventListener('keydown', (e) => {
  // 输入框中不响应
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (e.key === 'Alt') altDuplicateArmed = true;

  // 撤销 / 重做
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
    return;
  }

  // UE 风格 gizmo 模式切换
  if (e.key === 'w' || e.key === 'W') { transformControls.setMode('translate'); updateGizmoStatus(); }
  if (e.key === 'e' || e.key === 'E') { transformControls.setMode('rotate');    updateGizmoStatus(); }
  if (e.key === 'r' || e.key === 'R') { transformControls.setMode('scale');     updateGizmoStatus(); }
  // 按住 shift = 关闭轴吸附（默认吸附 cellSize / 15° / 0.1）
  if (e.key === 'Shift') setGizmoSnap(false);

  // 快速 90° 旋转（原 R 的功能挪到 [ / ]）
  if (e.key === '[' || e.key === ']') {
    const dir = e.key === ']' ? 1 : -1;
    state.currentRotation = (state.currentRotation + dir * Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    if (selectedId) {
      recordUndoSnapshot();
      const inst = nodes.get(selectedId);
      if (inst) setNodeRotation(selectedId, inst.data.rotationY + dir * Math.PI / 2);
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId) removeNode(selectedId);
  }
  if (e.key === 'Escape') selectNode(null);

  // 1-9 数字键快速切模型
  if (/^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key) - 1;
    if (idx < MODEL_LIBRARY.length) {
      state.currentModelId = MODEL_LIBRARY[idx].id;
      state.tool = 'place';
      renderModelList();
      renderToolList();
      updateStats();
    }
  }
});
addEventListener('keyup', (e) => {
  if (e.key === 'Shift') setGizmoSnap(true);
  if (e.key === 'Alt') altDuplicateArmed = false;
});

function setGizmoSnap(on: boolean) {
  transformControls.translationSnap = on ? GRID.cellSize : null;
  transformControls.rotationSnap    = on ? THREE.MathUtils.degToRad(15) : null;
  transformControls.scaleSnap       = on ? 0.1 : null;
}
setGizmoSnap(true);

function updateGizmoStatus() {
  const modeNames: Record<string, string> = { translate: '位移(W)', rotate: '旋转(E)', scale: '缩放(R)' };
  el('stat-gizmo').textContent = modeNames[transformControls.mode] || '—';
}

/* ────────────────────────────────────────────────────────────
   状态栏
   ──────────────────────────────────────────────────────────── */

function updateStats() {
  const toolNames: Record<Tool, string> = { place: '放置', erase: '橡皮擦', select: '选择' };
  el('stat-tool').textContent = toolNames[state.tool];
  const def = getModelDef(state.currentModelId);
  el('stat-model').textContent = def?.name ?? '—';
  el('stat-count').textContent = String(nodes.size);
}
updateStats();

/* ────────────────────────────────────────────────────────────
   Bootstrap：加载 public/models/ 里的持久化 glTF 资产
   —— 用它们覆盖或补齐 MODEL_LIBRARY
   ──────────────────────────────────────────────────────────── */

async function bootstrapUserModels() {
  // 清理历史空白/拆分变体（刷新前若已注册过）
  removeModel('island_medium_1');
  removeModel('island_medium_2');
  removeModel('island_large');
  removeModel('island_large_1');
  removeModel('island_large_2');

  /* ── 礁石 3 档 ── */
  await bootstrapExternalGltf({
    url: '/models/rock_small.glb',
    id: 'rock_small',
    name: '礁石(小)',
    swatch: '#cbd0d2',
    fitSize: 2.5,
    category: 'obstacle',
    colorMultiply: 1.75,
    surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' },
  });
  await bootstrapExternalGltf({
    url: '/models/rock_medium.glb',
    id: 'rock',
    name: '礁石(中)',
    swatch: '#d5d9da',
    fitSize: 4.0,
    category: 'obstacle',
    colorMultiply: 1.75,
    surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' },
  });
  await bootstrapExternalGltf({
    url: '/models/rock_large.glb',
    id: 'rock_large',
    name: '礁石(大)',
    swatch: '#e3e6e6',
    fitSize: 8.0,
    category: 'obstacle',
    colorMultiply: 1.75,
    surfaceResponse: { lightInfluence: 0.34, saturation: 0.28, tint: '#f3efe5' },
  });

  /* ── 小岛 2 档 —— 放到 public/models/island_{small,medium}.glb ── */
  // 小 & 中：走参考图配色重映射（暖沙 + 冷绿苔藓 + 亮黄绿叶）
  await bootstrapExternalGltf({
    url: '/models/island_small.glb',
    id: 'island_small',
    name: '小岛(小)',
    swatch: '#c8b585',
    fitSize: 5.0,
    category: 'landmark',
    // 小岛用 UV 图集 + 单材质：paletteRemap 只轻微 tint，主要靠 colorMultiply 提亮
    colorMultiply: 1.50,
    paletteRemap: REFERENCE_ISLAND_PALETTE, // stripBaseMap 默认 false，图集保留
    surfaceResponse: {
      lightInfluence: 0.72,
      shadowLift: 0.48,
      shadowTint: '#80684f',
    },
  });
  await bootstrapExternalGltf({
    url: '/models/island_medium.glb',
    id: 'island_medium',
    name: '小岛(中)',
    swatch: '#b7a06f',
    fitSize: 9.0,
    category: 'landmark',
    colorMultiply: 1.50,
    paletteRemap: REFERENCE_ISLAND_PALETTE,
    surfaceResponse: {
      lightInfluence: 0.72,
      shadowLift: 0.48,
      shadowTint: '#80684f',
    },
  });

  // 模型注册完成 → 尝试加载 localStorage 里的初始场景
  tryLoadInitialScene();
}

/**
 * 通用外部 glTF 引导：把 public/models/*.glb 加载 → 归一化 → 3渲2 化 → 注册到 MODEL_LIBRARY
 * - 单顶层节点 → 注册 1 个 model（id 用 cfg.id）
 * - 多顶层节点 → 每个子节点各注册一个变体，id 加后缀 _1 / _2 / ...
 */
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
  paletteRemap?: import('./loadGLTF').PaletteRemap;
  /** 降低暖色光照影响并对贴图去饱和 */
  surfaceResponse?: import('../render/StylizedMaterial').StylizedSurfaceResponse;
  /** 命中 palette 时是否剥掉 .map（默认 false —— UV 图集模型不要开） */
  stripBaseMap?: boolean;
  /** 打开后 console 会列出所有材质命中/未命中 */
  debugPalette?: boolean;
}) {
  try {
    const parts = await loadGLTFExploded(cfg.url, {
      fitSize: cfg.fitSize,
      stylize: true,            // 走 StylizedMaterial，保留贴图 + 法线 + AO
      groundYToZero: true,
      centerXZ: true,
      colorMultiply: cfg.colorMultiply ?? 1.0,
      paletteRemap: cfg.paletteRemap,
      surfaceResponse: cfg.surfaceResponse,
      stripBaseMap: cfg.stripBaseMap,
      debugPalette: cfg.debugPalette,
    });
    const category = cfg.category ?? 'obstacle';
    if (parts.length === 1) {
      registerModel({
        id: cfg.id,
        name: cfg.name,
        swatch: cfg.swatch,
        category,
        yOffset: parts[0].suggestedYOffset,
        build: parts[0].build,
        rotatable: true,
        scalable: true,
      });
    } else if (parts.length > 1) {
      parts.forEach((p, i) => {
        registerModel({
          id: `${cfg.id}_${i + 1}`,
          name: `${cfg.name} #${i + 1}`,
          swatch: cfg.swatch,
          category,
          yOffset: p.suggestedYOffset,
          build: p.build,
          rotatable: true,
          scalable: true,
        });
      });
    }
    console.log(`[bootstrap] ${cfg.url} 加载完成，注册 ${parts.length} 个变体`);
  } catch (e) {
    console.warn(`[bootstrap] ${cfg.url} 未找到 —— 请把 .glb 放到 public/models/ 后刷新`, e);
  }
}
bootstrapUserModels();

/* ────────────────────────────────────────────────────────────
   Resize
   ──────────────────────────────────────────────────────────── */

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  const w = Math.floor(innerWidth * renderer.getPixelRatio());
  const h = Math.floor(innerHeight * renderer.getPixelRatio());
  sceneRT.dispose();
  sceneRT = createSceneRT(w, h);
  waterU.uDepthTexture.value = sceneRT.depthTexture;
  waterU.uSceneColorTexture.value = sceneRT.texture;
  waterU.uResolution.value.set(w, h);
  setStylizedViewportHeight(innerHeight);
});
setStylizedViewportHeight(innerHeight);

/* ────────────────────────────────────────────────────────────
   渲染循环（复用两遍渲染保持水面透明感）
   ──────────────────────────────────────────────────────────── */

const clock = new THREE.Clock();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  waterU.uTime.value = elapsed;

  controls.update();

  // 驱动模型自带的动画（目前只有钓鱼点的冒泡粒子）
  for (const inst of nodes.values()) {
    const t = inst.object.userData?.tick;
    if (typeof t === 'function') t(dt);
  }

  // 天空跟随相机（无限远错觉）
  const camWorld = camera.getWorldPosition(new THREE.Vector3());
  sky.mesh.position.copy(camWorld);
  water.mesh.position.x = camWorld.x;
  water.mesh.position.z = camWorld.z;

  waterU.uCameraNear.value = camera.near;
  waterU.uCameraFar.value = camera.far;

  if (state.waterVisible) {
    // Pass1: 深度 + 场景色 → RT（仅在水面开启时需要）
    water.mesh.visible = false;
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    // Pass2: 带透明水面的最终画面
    water.mesh.visible = true;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } else {
    // 水面关闭时跳过双遍渲染，直接单 pass
    water.mesh.visible = false;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  // FPS
  fpsAcc += dt; fpsFrames++;
  fpsTimer += dt;
  if (fpsTimer > 0.5) {
    el('stat-fps').textContent = String(Math.round(fpsFrames / fpsAcc));
    fpsAcc = 0; fpsFrames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(tick);
}
tick();
