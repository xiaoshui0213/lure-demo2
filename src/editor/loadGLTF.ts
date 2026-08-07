import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  stylizeHierarchy,
  attachOutlinesToStylizedMeshes,
  setStylizedSurfaceResponse,
  type StylizedSurfaceResponse,
} from '../render/StylizedMaterial';

/**
 * glTF / GLB 加载 · 处理 · 缓存
 *
 * 三个入口：
 *  loadGLTFModel(url, opts)     整个 glTF 作为 1 个模型
 *  loadGLTFFromFile(file, opts) 同上，但 file 版
 *  loadGLTFExploded(source,opts) 顶层子节点各自作为 1 个模型（scene 里含多物件时用）
 */

export interface GLTFLoadOptions {
  /** 归一化：把（整个）glTF 最长包围盒边缩放到该值，米 */
  fitSize?: number;
  /** 每个模型的底部对齐到 y=0（默认 true） */
  groundYToZero?: boolean;
  /** 每个模型 XZ 中心对齐原点（默认 true） */
  centerXZ?: boolean;
  /**
   * 材质 3渲2 化 —— 把 glTF 的 PBR 材质转成 StylizedMaterial
   * 保留：baseColor / normalMap / aoMap / vertexColors / 透明 / 双面
   * 强烈推荐设 true，保持画风统一
   */
  stylize?: boolean;
  /** @deprecated 请用 stylize —— 为了兼容旧代码保留 */
  toonify?: boolean;
  /** @deprecated 现在忽略；stylize 会直接沿用 glTF 材质自身颜色 */
  toonFallbackColor?: string;
  /** 开阴影（默认 true） */
  shadows?: boolean;
  /**
   * 把每个 mesh 材质的 baseColor 乘以该系数（>1 提亮，<1 变暗）
   * - 传 number：三通道等比缩放（推荐 1.0 ~ 2.0）
   * - 传 hex/Color：按颜色分通道相乘（可用来染色）
   */
  colorMultiply?: number | string | THREE.Color;
  /**
   * 色板重映射：按 HSL 分类把 glTF 里的材质颜色统一替换成参考图的固定色板
   * —— 参考 src/render/palettes.ts 里预置的 REFERENCE_ISLAND_PALETTE
   * 应用时机在 colorMultiply 之后，是"最终决定色"。
   */
  paletteRemap?: PaletteRemap;
  /** 命中规则后是否剥掉 .map（默认 false —— 有 UV 图集的模型不要开） */
  stripBaseMap?: boolean;
  /** 打开后会在 console 列出所有材质的原始 HSL 及命中的规则，方便调色 */
  debugPalette?: boolean;
  /** 单模型光照影响/饱和度；用于避免暖色自然光把礁石染黄 */
  surfaceResponse?: StylizedSurfaceResponse;
}

/* ────────────────────────────────────────────────────────────
   色板重映射（HSL 分类）
   ──────────────────────────────────────────────────────────── */

export interface PaletteRule {
  /** 色相区间（度数 0..360）。支持环绕：[340, 60] = 红橙横跨 0° */
  hue?: [number, number];
  /** 亮度区间 0..1 */
  lightness?: [number, number];
  /** 饱和度区间 0..1 */
  saturation?: [number, number];
  /** 命中后要换成的颜色（hex 或 THREE.Color 支持的格式） */
  color: string;
  /** 调试标签 */
  name?: string;
}

export type PaletteRemap = PaletteRule[];

export interface ExplodedPart {
  /** glTF 顶层子节点名，或 `part_i` */
  name: string;
  /** 该子节点单独的高度（归一化 + 对齐后） */
  height: number;
  /** 推荐的 y 下沉量：水面模型放置时用，让石头等物体略微沉入水面产生 foam */
  suggestedYOffset: number;
  /** 该子节点的独立 build factory */
  build: () => THREE.Object3D;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * 最大各向异性滤波值（在 main.ts 启动时用 renderer.capabilities.getMaxAnisotropy() 设置）
 * 硬件通常支持 16；默认 8 是安全兜底
 */
let MAX_ANISOTROPY = 8;
export function setMaxAnisotropy(n: number) {
  MAX_ANISOTROPY = Math.max(1, Math.floor(n));
}

/* ────────────────────────────────────────────────────────────
   公开：整个 glTF 作为 1 个模型
   ──────────────────────────────────────────────────────────── */

export async function loadGLTFModel(
  url: string,
  opts: GLTFLoadOptions = {},
): Promise<() => THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      if (opts.fitSize) normalizeSize(root, opts.fitSize);
      alignToOrigin(root, opts);
      if (opts.stylize || opts.toonify) stylizeHierarchy(root);
      // ⚠️ 顺序：palette 先跑（读原始 HSL），colorMultiply 后跑（提亮 palette 输出）
      if (opts.paletteRemap) applyPaletteRemap(root, opts.paletteRemap, { debug: opts.debugPalette, tag: url, stripBaseMap: opts.stripBaseMap });
      if (opts.colorMultiply !== undefined) applyColorMultiply(root, opts.colorMultiply);
      if (opts.surfaceResponse) setStylizedSurfaceResponse(root, opts.surfaceResponse);
      enhanceTextures(root);
      if (opts.shadows !== false) enableShadows(root);
      if (opts.stylize || opts.toonify) attachOutlinesToStylizedMeshes(root);
      return root;
    });
    cache.set(url, p);
  }
  const template = await p;
  return () => template.clone(true);
}

export async function loadGLTFFromFile(
  file: File,
  opts: GLTFLoadOptions = {},
): Promise<() => THREE.Object3D> {
  const url = URL.createObjectURL(file);
  const factory = await loadGLTFModel(url, opts);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return factory;
}

/* ────────────────────────────────────────────────────────────
   公开：把顶层子节点拆成多个独立模型
   （用于导入的 glTF 是"多物件场景"的情况，比如一个 rocks.glb 里包含 12 块石头）
   ──────────────────────────────────────────────────────────── */

export async function loadGLTFExploded(
  source: string | File,
  opts: GLTFLoadOptions = {},
): Promise<ExplodedPart[]> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;

    // 1) 全局归一化：先按整体尺寸缩放（保持每块子物件之间的相对大小）
    if (opts.fitSize) normalizeSize(scene, opts.fitSize);
    if (opts.stylize || opts.toonify) stylizeHierarchy(scene);
    // ⚠️ 顺序：palette 先跑（读原始 HSL），colorMultiply 后跑（提亮 palette 输出）
    if (opts.paletteRemap) applyPaletteRemap(scene, opts.paletteRemap, { debug: opts.debugPalette, tag: typeof source === 'string' ? source : source.name, stripBaseMap: opts.stripBaseMap });
    if (opts.colorMultiply !== undefined) applyColorMultiply(scene, opts.colorMultiply);
    if (opts.surfaceResponse) setStylizedSurfaceResponse(scene, opts.surfaceResponse);
    enhanceTextures(scene);
    // 描边留到 enableShadows 之后（在每个 child 循环里）
    scene.updateMatrixWorld(true);

    // 2) 拆分：把每个顶层子节点抽出、烘焙世界变换、包一层 wrapper 作为独立模型
    const topChildren = [...scene.children];
    const parts: ExplodedPart[] = [];

    for (let i = 0; i < topChildren.length; i++) {
      const child = topChildren[i];
      // 把 child 的世界变换烘进它的 local transform，然后从原 scene 剥离
      child.updateMatrixWorld(true);
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      child.matrixWorld.decompose(worldPos, worldQuat, worldScale);
      scene.remove(child);
      child.position.copy(worldPos);
      child.quaternion.copy(worldQuat);
      child.scale.copy(worldScale);

      const wrapper = new THREE.Group();
      wrapper.add(child);

      // 每个 child 独立居中 + 底部贴地（写到 child.position，wrapper 保持 (0,0,0)）
      // —— 这样 placeNode 里的 obj.position.set(x, y, z) 就是精准放置点
      wrapper.updateMatrixWorld(true);
      const partBox = new THREE.Box3().setFromObject(wrapper);
      const partCenter = partBox.getCenter(new THREE.Vector3());
      if (opts.centerXZ !== false) {
        child.position.x -= partCenter.x;
        child.position.z -= partCenter.z;
      }
      if (opts.groundYToZero !== false) {
        child.position.y -= partBox.min.y;
      }
      if (opts.shadows !== false) enableShadows(wrapper);
      if (opts.stylize || opts.toonify) attachOutlinesToStylizedMeshes(wrapper);

      wrapper.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(wrapper);
      const height = Math.max(0.01, box.max.y - box.min.y);
      // 推荐下沉：高度的 20%，上限 0.4m —— 让石头明显穿透水面产生 foam
      const suggestedYOffset = -Math.min(0.4, height * 0.20);

      // 跳过空顶层节点（Blender 导出时常带 Camera / Empty / Armature 等无 mesh 子节点）
      if (isPartEmpty(wrapper)) continue;

      const template = wrapper;
      parts.push({
        name: child.name || `part_${i}`,
        height,
        suggestedYOffset,
        build: () => template.clone(true),
      });
    }

    return parts;
  } finally {
    if (typeof source !== 'string') {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
}

/* ────────────────────────────────────────────────────────────
   内部工具
   ──────────────────────────────────────────────────────────── */

/** 判断拆分出的 part 是否"空白"—— 无 mesh 或包围盒几乎为零 */
function isPartEmpty(root: THREE.Object3D): boolean {
  let meshCount = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.attributes?.position?.count) meshCount++;
  });
  if (meshCount === 0) return true;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z) < 0.001;
}

function normalizeSize(root: THREE.Object3D, fitSize: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) root.scale.multiplyScalar(fitSize / maxDim);
}

function alignToOrigin(
  root: THREE.Object3D,
  opts: { centerXZ?: boolean; groundYToZero?: boolean },
) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  if (opts.centerXZ !== false) {
    root.position.x -= center.x;
    root.position.z -= center.z;
  }
  if (opts.groundYToZero !== false) {
    root.position.y -= box.min.y;
  }
}

function enableShadows(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // 描边 mesh 不参与投影 —— 会产生外扩壳一圈的假影子
    if (m.userData?.outline) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

/** 给所有贴图开各向异性 + 三线性 mipmap 过滤，消除斜视角 moire / 锯齿感 */
function enhanceTextures(root: THREE.Object3D) {
  const seen = new Set<THREE.Texture>();
  const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const slot of slots) {
        const tex = (mat as unknown as Record<string, THREE.Texture | undefined>)[slot];
        if (!tex || seen.has(tex)) continue;
        seen.add(tex);
        tex.anisotropy = MAX_ANISOTROPY;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
      }
    }
  });
}

function applyColorMultiply(root: THREE.Object3D, mult: number | string | THREE.Color) {
  const tint = typeof mult === 'number'
    ? new THREE.Color(mult, mult, mult)
    : (typeof mult === 'string' ? new THREE.Color(mult) : mult);

  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      // clone 一份材质避免影响 cache 里的 template
      const cloned = mat.clone() as THREE.Material & { color?: THREE.Color };
      if (cloned.color) cloned.color.multiply(tint);
      if (Array.isArray(m.material)) {
        const idx = (m.material as THREE.Material[]).indexOf(mat);
        (m.material as THREE.Material[])[idx] = cloned;
      } else {
        m.material = cloned;
      }
    }
  });
}

/* ────────────────────────────────────────────────────────────
   色板重映射：按 HSL 分类把材质 baseColor 替换成规则里的色
   ──────────────────────────────────────────────────────────── */

/** 色相 in-range 判定，支持环绕（a > b 时表示区间横跨 0°） */
function hueInRange(hueDeg: number, range: [number, number]): boolean {
  const [a, b] = range;
  return a <= b ? (hueDeg >= a && hueDeg <= b) : (hueDeg >= a || hueDeg <= b);
}

function ruleMatches(
  hueDeg: number, sat: number, light: number, rule: PaletteRule,
): boolean {
  if (rule.hue        && !hueInRange(hueDeg, rule.hue))                   return false;
  if (rule.lightness  && (light < rule.lightness[0]  || light > rule.lightness[1]))  return false;
  if (rule.saturation && (sat   < rule.saturation[0] || sat   > rule.saturation[1])) return false;
  return true;
}

/**
 * 遍历所有 mesh 的材质，把 baseColor.hsl 落进 rules 里第一条命中的规则，
 * 并把 baseColor 换成规则里的固定 hex。
 * —— 材质会被就地修改（不 clone；上游 stylizeHierarchy 已经建了新材质，安全）
 */
export function applyPaletteRemap(
  root: THREE.Object3D,
  rules: PaletteRemap,
  opts: {
    debug?: boolean;
    tag?: string;
    /**
     * 命中规则后，是否把 baseColor 贴图（.map）一并干掉。
     * 默认 false —— 因为"1 材质 + UV 图集"的模型剥了会全变一色（棕榈岛就是这种）
     * 只对**确认是"1 材质 + 无贴图或纯色贴图"**的模型（比如程序化礁石 glb）开启。
     */
    stripBaseMap?: boolean;
  } = {},
) {
  const stripBaseMap = opts.stripBaseMap ?? false;
  const seen = new Set<THREE.Material>();
  const hsl = { h: 0, s: 0, l: 0 };
  let hits = 0, misses = 0, skipped = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      const anyMat = mat as unknown as {
        color?: THREE.Color;
        name?: string;
        map?: THREE.Texture | null;
        vertexColors?: boolean;
        needsUpdate?: boolean;
      };
      if (!anyMat.color) continue;

      /* ── 跳过条件 ──
       * ① 材质开启 vertexColors —— 说明单材质用顶点色区分多个部件，
       *    改 color 只会挂上一层 tint，剥 VC 会把所有部件塞成同一个色
       * ② geometry 上真的有 color attribute（有的 glTF 会把 vertexColors=false
       *    但 mesh 依然带 color attribute，Three 会自动启用）—— 同样跳过
       */
      const usesVertexColors =
        !!anyMat.vertexColors ||
        !!(m.geometry?.getAttribute && m.geometry.getAttribute('color'));
      if (usesVertexColors) {
        skipped++;
        if (opts.debug) {
          // eslint-disable-next-line no-console
          console.log(
            `[palette${opts.tag ? ' ' + opts.tag : ''}] "${anyMat.name ?? '<no name>'}"`,
            `→ SKIPPED (uses vertex colors)`,
          );
        }
        continue;
      }

      anyMat.color.getHSL(hsl);
      const hueDeg = hsl.h * 360;
      const rule = rules.find((r) => ruleMatches(hueDeg, hsl.s, hsl.l, r));
      const origHex = anyMat.color.getHexString();
      if (rule) {
        anyMat.color.set(rule.color);
        // 关键：不干掉 map 的话，最终色 = palette × 贴图，palette 就白改了
        // 但只对"单色 + 贴图"的材质有效；atlas 贴图的模型已经在上面 skip 了
        if (stripBaseMap && anyMat.map) {
          anyMat.map = null;
          anyMat.needsUpdate = true;
        }
        hits++;
        if (opts.debug) {
          // eslint-disable-next-line no-console
          console.log(
            `[palette${opts.tag ? ' ' + opts.tag : ''}] "${anyMat.name ?? '<no name>'}"`,
            `#${origHex} H=${hueDeg.toFixed(0)}° S=${(hsl.s * 100).toFixed(0)}% L=${(hsl.l * 100).toFixed(0)}%`,
            `→ ${rule.color} (${rule.name ?? ''})`,
          );
        }
      } else {
        misses++;
        if (opts.debug) {
          // eslint-disable-next-line no-console
          console.log(
            `[palette${opts.tag ? ' ' + opts.tag : ''}] "${anyMat.name ?? '<no name>'}"`,
            `#${origHex} H=${hueDeg.toFixed(0)}° S=${(hsl.s * 100).toFixed(0)}% L=${(hsl.l * 100).toFixed(0)}%`,
            `→ (unmapped)`,
          );
        }
      }
    }
  });
  if (opts.debug) {
    // eslint-disable-next-line no-console
    console.log(`[palette${opts.tag ? ' ' + opts.tag : ''}] hits=${hits} misses=${misses} skipped=${skipped}`);
  }
}
