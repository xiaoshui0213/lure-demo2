import * as THREE from 'three';

/**
 * StylizedMaterial —— 「高明度低饱和保留细节」的三渲二材质
 *
 * 目标视觉参考：Blender 三渲二 lookdev（奶油亮面 / 冷灰紫阴影 / 淡描边）
 *
 * 底层 = MeshToonMaterial —— 直接得到：
 *   ✓ Base Color 贴图（map）
 *   ✓ Normal Map（normalMap）
 *   ✓ AO Map（aoMap，需 mesh 有 uv2）
 *   ✓ Vertex Colors
 *   ✓ Alpha / EmissiveMap
 *   ✓ 阴影与雾
 *
 * 通过 onBeforeCompile 打两处补丁：
 *   ① 让 gradientMap 采样成 RGB（Three 默认只取 R）—— 就能做到「阴影偏冷、亮面偏暖」
 *   ② 加轻量 Rim Light —— 硅光突出剪影，避免物体贴到远景显得扁
 *
 * 使用：
 *   const mat = createStylizedMaterial({ color, map, normalMap, flatShading: true });
 *   或对 glTF：stylizeHierarchy(gltfScene)  —— in-place 转换所有 lit 材质
 *
 * 全局调参：改 StylizedConfig 后调 refreshStylizedGradient() / refreshRimUniforms()
 * —— 由于所有 stylized 材质共享同一份 gradient DataTexture + rim uniform，一次刷新全场景生效。
 */

/* ────────────────────────────────────────────────────────────
   全局配置（GUI 可实时调）
   ──────────────────────────────────────────────────────────── */

export const StylizedConfig = {
  /**
   * 4 段光照色带的 RGB。
   *
   * 【v3：柔和赛璐璐 —— 参考"手游卡通俯视地图"】
   * 阴影 / 亮面对比大幅收窄，让整个物体保持"通体明亮"，只在最背光处收 25% 亮度。
   *   band[i] × baseColor = 该光照角度的最终色
   * 保留 baseColor 的 hue，绿叶阴影仍是绿色、沙岩阴影仍是暖沙。
   *
   * 采样 UV = dotNL * 0.5 + 0.5：band[0] = 背光，band[N-1] = 朝光
   */
  bands: [
    [0.82, 0.82, 0.84], // 0 深阴影：仅比亮面暗 18%
    [0.90, 0.90, 0.90], // 1 中阴影
    [0.96, 0.96, 0.95], // 2 中调
    [1.00, 1.00, 0.98], // 3 亮面
  ] as Array<[number, number, number]>,

  /** Rim 颜色（暖白） */
  rimColor: [1.00, 0.98, 0.90] as [number, number, number],
  /** Rim 强度 —— 有描边就不需要很强的 Rim，0.03~0.08 即可 */
  rimStrength: 0.05,
  /** Rim 幂次，越大越靠近边缘 */
  rimPower: 3.5,

  /** ── 背面 hull 描边 ── */
  outline: {
    enabled: true,
    /** 屏幕像素级厚度（近似值；view-space + w 距离补偿） */
    thicknessPx: 1.0,
    /** 描边色 —— 用暖深棕代替纯黑，避免"油漆抠图感" */
    color: '#3a2a1e',
  },
};

/* ────────────────────────────────────────────────────────────
   共享 Gradient DataTexture
   ──────────────────────────────────────────────────────────── */

let SHARED_GRADIENT: THREE.DataTexture | null = null;

function writeGradient(data: Uint8Array) {
  const n = StylizedConfig.bands.length;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = StylizedConfig.bands[i];
    data[i * 4 + 0] = Math.round(clamp01(r) * 255);
    data[i * 4 + 1] = Math.round(clamp01(g) * 255);
    data[i * 4 + 2] = Math.round(clamp01(b) * 255);
    data[i * 4 + 3] = 255;
  }
}

function buildGradientTexture(): THREE.DataTexture {
  const n = StylizedConfig.bands.length;
  const data = new Uint8Array(n * 4);
  writeGradient(data);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;   // NearestFilter 才能得到"阶梯"感
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;    // gradient 是"光强"数据，不是 sRGB 颜色
  tex.needsUpdate = true;
  return tex;
}

function getSharedGradient(): THREE.DataTexture {
  if (!SHARED_GRADIENT) SHARED_GRADIENT = buildGradientTexture();
  return SHARED_GRADIENT;
}

/** 改 StylizedConfig.bands 后调，所有 stylized 材质会在下一帧更新 */
export function refreshStylizedGradient() {
  if (!SHARED_GRADIENT) return;
  writeGradient(SHARED_GRADIENT.image.data as Uint8Array);
  SHARED_GRADIENT.needsUpdate = true;
}

/* ────────────────────────────────────────────────────────────
   共享 Rim uniform —— 所有 stylized 材质使用同一份，改一次全场景生效
   ──────────────────────────────────────────────────────────── */

const SHARED_RIM = {
  uRimColor:    { value: new THREE.Color(...StylizedConfig.rimColor) },
  uRimStrength: { value: StylizedConfig.rimStrength },
  uRimPower:    { value: StylizedConfig.rimPower },
};

/** 从 StylizedConfig 同步 rim uniform */
export function refreshRimUniforms() {
  SHARED_RIM.uRimColor.value.setRGB(
    StylizedConfig.rimColor[0],
    StylizedConfig.rimColor[1],
    StylizedConfig.rimColor[2],
  );
  SHARED_RIM.uRimStrength.value = StylizedConfig.rimStrength;
  SHARED_RIM.uRimPower.value    = StylizedConfig.rimPower;
}

/* ────────────────────────────────────────────────────────────
   Shader 补丁
   ──────────────────────────────────────────────────────────── */

// 注意：把补丁定义成一个"命名常量函数"—— Three.js 的 programCache 用
// onBeforeCompile.toString() 做键，同一个函数引用会命中同一个编译产物，
// 所有 stylized 材质共享同一份 shader program（性能友好）。
const patchStylizedShader = (
  shader: THREE.WebGLProgramParametersWithUniforms,
) => {
  // 挂共享 rim uniform
  shader.uniforms.uRimColor    = SHARED_RIM.uRimColor;
  shader.uniforms.uRimStrength = SHARED_RIM.uRimStrength;
  shader.uniforms.uRimPower    = SHARED_RIM.uRimPower;

  // ① 让 gradientMap 采样成 RGB（默认只取 .r）
  //    Three.js r185 里 getGradientIrradiance 的原句就是下面这行。
  shader.fragmentShader = shader.fragmentShader.replace(
    'return vec3( texture2D( gradientMap, coord ).r );',
    'return texture2D( gradientMap, coord ).rgb;',
  );

  // ② 声明 rim uniform
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
uniform vec3  uRimColor;
uniform float uRimStrength;
uniform float uRimPower;`,
  );

  // ③ Rim 加在 tone mapping 之前 —— 让 ACES 把过亮的边缘压回自然范围
  //    normal / vViewPosition 在这一步已经就绪（normal_fragment_begin/maps 都跑完了）
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <tonemapping_fragment>',
    `{
  vec3 rimV = normalize(vViewPosition);
  float rimNdotV = 1.0 - max(dot(normal, rimV), 0.0);
  float rim = pow(rimNdotV, uRimPower) * uRimStrength;
  gl_FragColor.rgb += rim * uRimColor;
}
#include <tonemapping_fragment>`,
  );
};

/* ────────────────────────────────────────────────────────────
   工厂 API
   ──────────────────────────────────────────────────────────── */

export interface StylizedOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: THREE.Vector2;
  aoMap?: THREE.Texture | null;
  aoMapIntensity?: number;
  alphaMap?: THREE.Texture | null;
  flatShading?: boolean;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  emissive?: THREE.ColorRepresentation;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
  /** FPS overlay 用（e.g. 鱼竿）：关深度测试，保证画在其他物体之上 */
  depthTest?: boolean;
  depthWrite?: boolean;
}

export interface StylizedSurfaceResponse {
  /** 0 = 完全使用贴图/底色，1 = 正常接受场景光照 */
  lightInfluence?: number;
  /** 0 = 灰度，1 = 保留原始饱和度 */
  saturation?: number;
  /** 最终表面冷暖微调 */
  tint?: THREE.ColorRepresentation;
  /** 只抬升贴图暗部；0 = 不处理，1 = 完全趋向 shadowTint */
  shadowLift?: number;
  /** 暗部抬升所使用的目标色 */
  shadowTint?: THREE.ColorRepresentation;
}

/**
 * 给指定模型设置独立表面响应。
 * 用于礁石等不应被暖色太阳染黄的物体，同时保留贴图明暗细节。
 */
export function setStylizedSurfaceResponse(
  root: THREE.Object3D,
  response: StylizedSurfaceResponse,
) {
  const lightInfluence = THREE.MathUtils.clamp(response.lightInfluence ?? 1, 0, 1);
  const saturation = THREE.MathUtils.clamp(response.saturation ?? 1, 0, 1);
  const tint = new THREE.Color(response.tint ?? 0xffffff);
  const shadowLift = THREE.MathUtils.clamp(response.shadowLift ?? 0, 0, 1);
  const shadowTint = new THREE.Color(response.shadowTint ?? 0xffffff);
  const seen = new Set<THREE.Material>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshToonMaterial) || seen.has(material)) continue;
      seen.add(material);

      material.onBeforeCompile = (shader) => {
        patchStylizedShader(shader);
        shader.uniforms.uSurfaceLightInfluence = { value: lightInfluence };
        shader.uniforms.uSurfaceSaturation = { value: saturation };
        shader.uniforms.uSurfaceTint = { value: tint };
        shader.uniforms.uSurfaceShadowLift = { value: shadowLift };
        shader.uniforms.uSurfaceShadowTint = { value: shadowTint };

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
uniform float uSurfaceLightInfluence;
uniform float uSurfaceSaturation;
uniform vec3 uSurfaceTint;
uniform float uSurfaceShadowLift;
uniform vec3 uSurfaceShadowTint;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
float surfaceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = mix(vec3(surfaceLuma), diffuseColor.rgb, uSurfaceSaturation) * uSurfaceTint;
float surfaceDarkMask = 1.0 - smoothstep(0.05, 0.55, surfaceLuma);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  uSurfaceShadowTint,
  surfaceDarkMask * uSurfaceShadowLift
);`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
          `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
outgoingLight = mix(diffuseColor.rgb, outgoingLight, uSurfaceLightInfluence);`,
        );
      };
      material.customProgramCacheKey = () =>
        `stylized-surface-${lightInfluence}-${saturation}-${tint.getHexString()}-${shadowLift}-${shadowTint.getHexString()}`;
      material.needsUpdate = true;
    }
  });
}

/**
 * 建一条新的 stylized 材质（用于程序化模型 —— 船、岩石、岛屿、码头…）
 */
export function createStylizedMaterial(opts: StylizedOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    normalMap: opts.normalMap ?? null,
    // 弱化 normal，别把三渲二压回 PBR 感
    normalScale: opts.normalScale ?? new THREE.Vector2(0.55, 0.55),
    aoMap: opts.aoMap ?? null,
    aoMapIntensity: opts.aoMapIntensity ?? 0.85,
    alphaMap: opts.alphaMap ?? null,
    flatShading: opts.flatShading ?? false,
    vertexColors: opts.vertexColors ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1.0,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveMap: opts.emissiveMap ?? null,
    emissiveIntensity: opts.emissiveIntensity ?? 1.0,
    gradientMap: getSharedGradient(),
  });
  if (opts.depthTest === false)  mat.depthTest  = false;
  if (opts.depthWrite === false) mat.depthWrite = false;

  mat.onBeforeCompile = patchStylizedShader;
  mat.userData.stylized = true;
  return mat;
}

/**
 * 就地把一个 lit 材质（Standard / Physical / Toon / Phong / Lambert）转成 stylized
 * —— 保留：贴图、normal、AO、vertexColors、透明、双面、发光
 *   丢弃：PBR 特有的 metalness / roughness（三渲二不需要）
 * 返回新材质（旧材质不 dispose —— 可能还有别的 mesh 在用）
 */
export function stylizeStandardMaterial(src: THREE.Material): THREE.MeshToonMaterial {
  const s = src as THREE.MeshStandardMaterial;
  return createStylizedMaterial({
    color: s.color?.getHex() ?? 0xffffff,
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    normalScale: s.normalScale?.clone() ?? new THREE.Vector2(0.55, 0.55),
    aoMap: s.aoMap ?? null,
    aoMapIntensity: s.aoMapIntensity ?? 0.85,
    alphaMap: s.alphaMap ?? null,
    vertexColors: s.vertexColors ?? false,
    transparent: s.transparent ?? false,
    opacity: s.opacity ?? 1.0,
    side: s.side ?? THREE.FrontSide,
    emissive: s.emissive?.getHex() ?? 0x000000,
    emissiveMap: s.emissiveMap ?? null,
    emissiveIntensity: s.emissiveIntensity ?? 1.0,
  });
}

/** 遍历一棵子树，把里面所有 lit 材质换成 stylized（跳过 Basic/Line/ShaderMaterial 等） */
export function stylizeHierarchy(root: THREE.Object3D) {
  const cache = new Map<THREE.Material, THREE.MeshToonMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material;
    const list = Array.isArray(src) ? src : [src];
    const out: THREE.Material[] = [];
    let changed = false;
    for (const mat of list) {
      if (!mat) { out.push(mat); continue; }
      // 已 stylized，不动
      if ((mat.userData as { stylized?: boolean } | undefined)?.stylized) { out.push(mat); continue; }
      // 只处理有光照的材质；Basic/Line 保持原样（发光件、鱼线、粒子等）
      const anyMat = mat as unknown as {
        isMeshStandardMaterial?: boolean;
        isMeshPhysicalMaterial?: boolean;
        isMeshToonMaterial?: boolean;
        isMeshPhongMaterial?: boolean;
        isMeshLambertMaterial?: boolean;
      };
      const isLit = !!(anyMat.isMeshStandardMaterial
                    || anyMat.isMeshPhysicalMaterial
                    || anyMat.isMeshToonMaterial
                    || anyMat.isMeshPhongMaterial
                    || anyMat.isMeshLambertMaterial);
      if (!isLit) { out.push(mat); continue; }
      // 缓存：同一原材质多个 mesh 共用一个新材质，避免重复编译
      const cached = cache.get(mat);
      if (cached) { out.push(cached); changed = true; continue; }
      const newMat = stylizeStandardMaterial(mat);
      cache.set(mat, newMat);
      out.push(newMat);
      changed = true;
    }
    if (changed) {
      m.material = Array.isArray(src) ? out : out[0];
    }
  });
}

/* ────────────────────────────────────────────────────────────
   背面 hull 描边（Toon-style outlines）

   原理：给同一个 geometry 加一个"反面渲染 + 沿法线外挤"的克隆 mesh
   —— 摄像机看到的边缘刚好是反面被顶出来的一圈"壳"，视觉效果 = 描边
   thickness 用 view-space + 除以近平面距离的方式补偿，让屏幕像素厚度接近常量。
   ──────────────────────────────────────────────────────────── */

const OUTLINE_UNIFORMS = {
  uColor:      { value: new THREE.Color(StylizedConfig.outline.color) },
  uThicknessPx:{ value: StylizedConfig.outline.thicknessPx },
  /** viewport 高度 —— main.ts / editor 里 onResize 时更新 */
  uViewportH:  { value: 1080 },
};

/** 主循环 resize 时调，保证描边屏幕厚度稳定 */
export function setStylizedViewportHeight(h: number) {
  OUTLINE_UNIFORMS.uViewportH.value = Math.max(1, h);
}

/** GUI 改 StylizedConfig.outline 后调 */
export function refreshOutlineUniforms() {
  OUTLINE_UNIFORMS.uColor.value.set(StylizedConfig.outline.color);
  OUTLINE_UNIFORMS.uThicknessPx.value = StylizedConfig.outline.thicknessPx;
}

const OUTLINE_VERT = /* glsl */`
  uniform float uThicknessPx;
  uniform float uViewportH;
  void main() {
    // 沿视空间法线外挤，厚度 ∝ 到相机距离（w），除以视口高度换算屏幕像素
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 mvN   = normalize(mat3(modelViewMatrix) * normal);
    vec4 clip  = projectionMatrix * mvPos;
    // 每屏幕像素在 clip.w 深度下对应多少 view-space 单位：
    //   pixel_view = 2 * clip.w / (uViewportH * projectionMatrix[1][1])
    float pxToView = 2.0 * clip.w / (uViewportH * projectionMatrix[1][1]);
    mvPos.xyz += mvN * (uThicknessPx * pxToView);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const OUTLINE_FRAG = /* glsl */`
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

function createOutlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: OUTLINE_UNIFORMS,          // 全场共享（改一次全部更新）
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,                 // 只画反面
    // 深度 = 正常，让描边被更近的物体自然遮挡
    depthTest: true,
    depthWrite: true,
    // 关掉光照相关，避免 flatShading 影响法线插值
    fog: false,
  });
}

/**
 * 判断 mesh 是否适合加描边
 * - 必须是 Mesh 且有 geometry
 * - 材质是 stylized（其他材质自己决定视觉，不加）
 * - 不允许透明 / 关深度测试的（FPS overlay、bubbles、fishing line）
 * - 显式 userData.noOutline 也跳过
 */
function shouldOutline(mesh: THREE.Mesh): boolean {
  if (!mesh.isMesh || !mesh.geometry) return false;
  if (mesh.userData.noOutline) return false;
  const mat = mesh.material;
  const list = Array.isArray(mat) ? mat : [mat];
  // 只对 stylized 材质加
  const anyStylized = list.some((m) => (m as unknown as { userData?: { stylized?: boolean } })?.userData?.stylized);
  if (!anyStylized) return false;
  // 任何一个材质是 transparent / 关深度测试 —— 不加
  for (const m of list) {
    if (!m) continue;
    const mm = m as THREE.Material & { depthTest?: boolean; transparent?: boolean };
    if (mm.transparent) return false;
    if (mm.depthTest === false) return false;
  }
  return true;
}

/**
 * 遍历一棵子树，给所有 stylized 且尚未加过描边的 mesh 加上描边 child。
 * 描边挂成 mesh 的子节点 —— 跟随 mesh 变换、不影响物理 / raycast（除非显式加）。
 */
export function attachOutlinesToStylizedMeshes(root: THREE.Object3D) {
  if (!StylizedConfig.outline.enabled) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!shouldOutline(m)) return;
    // 已经加过就跳过（多次调用安全）
    if (m.children.some((c) => c.userData?.outline)) return;
    const outline = new THREE.Mesh(m.geometry, createOutlineMaterial());
    outline.name = m.name ? `${m.name}__outline` : 'outline';
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.frustumCulled = m.frustumCulled;
    outline.matrixAutoUpdate = false;      // 与父同步，无需 update
    outline.userData.outline = true;
    // 保持渲染顺序：描边先画（在 mesh 后面），mesh 覆盖描边内部
    outline.renderOrder = m.renderOrder - 0.1;
    m.add(outline);
  });
}

/* ────────────────────────────────────────────────────────────
   小工具
   ──────────────────────────────────────────────────────────── */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
