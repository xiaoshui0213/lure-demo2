import * as THREE from 'three';

/**
 * 程序化天空盒（低多边形 / 卡通感）
 * - 大 sphere 反面渲染
 * - 从天顶到地平线的三段颜色渐变
 * - 太阳盘 + 光晕
 * - 风格化云（FBM + 阈值 + 柔边，跟随天空色）
 */
export interface SkyUniforms {
  uSunDirection: { value: THREE.Vector3 };
  uZenithColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uGroundColor: { value: THREE.Color };
  uSunColor: { value: THREE.Color };
  uSunSize: { value: number };
  uSunSharpness: { value: number };
  uSunGlowStrength: { value: number };
  uHorizonSharpness: { value: number };
  /** 云相关 */
  uTime: { value: number };
  uCloudCoverage: { value: number };    // 0..1 覆盖率（越大云越多）
  uCloudSoftness: { value: number };    // 边缘柔和 0.02..0.3
  uCloudScale: { value: number };       // 噪声频率（越大云越碎）
  uCloudSpeed: { value: number };       // 飘动速度（uv/sec）
  uCloudHeight: { value: number };      // 云带下缘位置（0..1，0=地平线）
  uCloudColor: { value: THREE.Color };  // 云本体色
  uCloudShadowColor: { value: THREE.Color }; // 云背光/阴影色
  uCloudOpacity: { value: number };     // 整体不透明度 0..1
}

export function createSkyMaterial(): THREE.ShaderMaterial {
  const uniforms: SkyUniforms = {
    uSunDirection: { value: new THREE.Vector3(0.4, 0.35, 0.6).normalize() },
    // 用户 GUI 调整后固化的天空色（noon preset）
    uZenithColor: { value: new THREE.Color('#edece3') },
    uHorizonColor: { value: new THREE.Color('#dacca4') },
    uGroundColor: { value: new THREE.Color('#8fb9b4') },
    uSunColor: { value: new THREE.Color('#eed4af') },
    uSunSize: { value: 0.02 },
    uSunSharpness: { value: 800.0 },
    uSunGlowStrength: { value: 0.6 },
    uHorizonSharpness: { value: 2.2 },
    uTime: { value: 0 },
    uCloudCoverage: { value: 0.55 },
    uCloudSoftness: { value: 0.12 },
    uCloudScale: { value: 2.4 },
    uCloudSpeed: { value: 0.008 },
    uCloudHeight: { value: 0.08 },
    uCloudColor: { value: new THREE.Color('#ffffff') },
    uCloudShadowColor: { value: new THREE.Color('#c8c0b8') },
    uCloudOpacity: { value: 0.85 },
  };

  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldDir;

      uniform vec3  uSunDirection;
      uniform vec3  uZenithColor;
      uniform vec3  uHorizonColor;
      uniform vec3  uGroundColor;
      uniform vec3  uSunColor;
      uniform float uSunSize;
      uniform float uSunSharpness;
      uniform float uSunGlowStrength;
      uniform float uHorizonSharpness;

      uniform float uTime;
      uniform float uCloudCoverage;
      uniform float uCloudSoftness;
      uniform float uCloudScale;
      uniform float uCloudSpeed;
      uniform float uCloudHeight;
      uniform vec3  uCloudColor;
      uniform vec3  uCloudShadowColor;
      uniform float uCloudOpacity;

      // ── 2D hash / value noise / fbm ──
      float hash2(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash2(i);
        float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0));
        float d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float sum = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 5; i++) {
          sum += amp * vnoise(p);
          p *= 2.03;
          amp *= 0.5;
        }
        return sum;
      }

      // 将球面方向映射到平面 UV：仰角 + 方位角
      // 这样云带只沿方位角平铺，仰角只做纵向压缩，避免天顶极点畸变
      vec2 dirToCloudUV(vec3 dir) {
        float az = atan(dir.z, dir.x);        // -π..π
        float el = asin(clamp(dir.y, -1.0, 1.0)); // -π/2..π/2
        // az 归一化到 0..1；el 做非线性放大，让靠地平线的云"拉长"
        float u = az / 6.2831853 + 0.5;
        float v = 0.5 - el / 3.14159265;
        return vec2(u * 4.0, v * 2.0);          // 4:2 拉伸更像"长带云"
      }

      float cloudDensity(vec3 dir) {
        vec2 uv = dirToCloudUV(dir) * uCloudScale;
        // 慢速漂动
        uv += vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.35);

        // 两层 fbm 混合 —— 第 2 层做形状扭曲，产生蓬松感
        float warpX = fbm(uv * 0.5 + 11.7);
        float warpY = fbm(uv * 0.5 + 3.2);
        vec2 warped = uv + vec2(warpX, warpY) * 1.2;

        float n = fbm(warped);

        // 阈值 + 柔边 —— 覆盖率越高，云占比越大
        float thresh = 1.0 - uCloudCoverage;
        float d = smoothstep(thresh - uCloudSoftness, thresh + uCloudSoftness, n);
        return d;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = dir.y;

        float skyBlend    = pow(clamp(h, 0.0, 1.0), 1.0 / uHorizonSharpness);
        float groundBlend = pow(clamp(-h, 0.0, 1.0), 1.0 / 1.5);

        vec3 col = mix(uHorizonColor, uZenithColor, skyBlend);
        col      = mix(col, uGroundColor, groundBlend);

        // ── 云 ──
        // 只在 h > uCloudHeight 的区域画云；靠近地平线时用一个 smoothstep 淡入
        float aboveHorizon = smoothstep(uCloudHeight, uCloudHeight + 0.10, h);
        // 靠近天顶稍微淡出，避免俯视时头顶一片实心云
        float belowZenith  = 1.0 - smoothstep(0.75, 1.0, h) * 0.35;

        float dens = cloudDensity(dir) * aboveHorizon * belowZenith * uCloudOpacity;

        // 云自阴影：向太阳侧偏移采样，形成"迎光亮 / 背光暗"的分层
        vec3 lightOffsetDir = normalize(dir + normalize(uSunDirection) * 0.35);
        float lit = cloudDensity(lightOffsetDir);
        float shadow = clamp(dens - lit * 0.85, 0.0, 1.0);

        // 云本体色随光照方向偏移：迎光取 CloudColor + 太阳暖色，背光取 ShadowColor
        float sunFacing = clamp(dot(dir, normalize(uSunDirection)), 0.0, 1.0);
        vec3 litColor = mix(uCloudColor, uSunColor, sunFacing * 0.35);
        vec3 cloudCol = mix(uCloudShadowColor, litColor, 1.0 - shadow * 1.5);

        col = mix(col, cloudCol, dens);

        // ── 太阳 ──
        float sunDot  = max(dot(dir, normalize(uSunDirection)), 0.0);
        float sunDisk = pow(sunDot, uSunSharpness);
        float sunGlow = pow(sunDot, 6.0) * uSunGlowStrength;

        // 云会遮住太阳盘
        col += uSunColor * sunDisk * (1.0 - dens * 0.9);
        col += uSunColor * sunGlow * 0.35 * (1.0 - dens * 0.4);

        float sunHorizonInfluence = pow(sunDot, 3.0) * 0.4;
        col += uSunColor * sunHorizonInfluence * (1.0 - skyBlend);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createSkyDome(radius = 800): {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
} {
  const material = createSkyMaterial();
  const geo = new THREE.SphereGeometry(radius, 64, 32);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return { mesh, material };
}
