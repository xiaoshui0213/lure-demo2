import * as THREE from 'three';

/**
 * 风格化卡通水体材质 v2 —— 对齐参考图 2（UE 湖水）
 *
 * 特性：
 *  - 少量 Gerstner 波做轻缓起伏
 *  - flat facet 法线（dFdx/dFdy），低多边形色块感
 *  - 采样 **场景颜色 + 场景深度**：
 *      - 水下部分：sceneColor 与水色按 Beer-Lambert 吸收混合
 *      - 水深越大越靠近深水色，出现「近处清浅、远处深」的自然渐变
 *      - 浅处能透出水下地形，形成透明感
 *  - 相交泡沫：水面与物体交界处白色泡沫边
 *  - 可选流动亮纹（painted highlights）
 *  - 弱 Fresnel + 硬边太阳高光
 */

export interface WaterUniforms {
  uTime: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };

  uShallowColor: { value: THREE.Color };
  uDeepColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uZenithColor: { value: THREE.Color };
  uFoamColor: { value: THREE.Color };
  uStreakColor: { value: THREE.Color };

  uWaveA: { value: THREE.Vector4 };
  uWaveB: { value: THREE.Vector4 };

  uFlowDir: { value: THREE.Vector2 };
  uFlowSpeed: { value: number };

  uFresnelStrength: { value: number };
  uSunSpecSharpness: { value: number };
  uSunSpecStrength: { value: number };

  // 吸收 / 透明
  uAbsorptionCoef: { value: number }; // 越大吸收越快（水色更快主导）
  uTintCoef: { value: number };       // 水色 tint 强度（对水下场景的染色）

  uFoamDistance: { value: number };
  uFoamSoftness: { value: number };
  uFoamNoiseStrength: { value: number };

  uStreakScale: { value: number };
  uStreakThreshold: { value: number };
  uStreakSoftness: { value: number };
  uStreakStrength: { value: number };

  uDepthTexture: { value: THREE.DepthTexture | null };
  uSceneColorTexture: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
}

export function createWaterMaterial(): THREE.ShaderMaterial {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: new THREE.Vector3(0.4, 0.35, 0.6).normalize() },
    uSunColor: { value: new THREE.Color('#fff2c4') },

    // 用户 GUI 调整后固化的配色（noon preset · 明亮青绿湖水）
    uShallowColor: { value: new THREE.Color('#ccfff7') },
    uDeepColor: { value: new THREE.Color('#81e8ea') },
    uHorizonColor: { value: new THREE.Color('#dacca4') },
    uZenithColor: { value: new THREE.Color('#edece3') },
    uFoamColor: { value: new THREE.Color('#ffffff') },
    uStreakColor: { value: new THREE.Color('#ffffff') },

    uWaveA: { value: new THREE.Vector4(1.0, 0.2, 0.05, 22.0) },
    uWaveB: { value: new THREE.Vector4(-0.3, 0.9, 0.03, 12.0) },

    uFlowDir: { value: new THREE.Vector2(0.0, -1.0) },
    uFlowSpeed: { value: 0.25 },

    uFresnelStrength: { value: 1.0 },
    uSunSpecSharpness: { value: 65.0 },
    uSunSpecStrength: { value: 0.8 },

    uAbsorptionCoef: { value: 0.16 },
    uTintCoef: { value: 0.34 },

    uFoamDistance: { value: 2.45 },
    uFoamSoftness: { value: 0.35 },
    uFoamNoiseStrength: { value: 0.32 },

    uStreakScale: { value: 0.35 },
    uStreakThreshold: { value: 0.52 },
    uStreakSoftness: { value: 0.18 },
    uStreakStrength: { value: 0.44 },

    uDepthTexture: { value: null },
    uSceneColorTexture: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 2000 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    side: THREE.DoubleSide,
    transparent: false,
    extensions: {
      derivatives: true,
    } as unknown as THREE.ShaderMaterialParameters['extensions'],
    vertexShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec4 uWaveA;
      uniform vec4 uWaveB;

      varying vec3 vWorldPos;
      varying vec3 vNormalSmooth;
      varying float vWaveHeight;

      // Gerstner 波 —— 同时累积 tangent / binormal，供后续算解析平滑法线
      vec3 gerstner(vec4 w, vec3 pos, inout vec3 tangent, inout vec3 binormal) {
        vec2 dir = normalize(w.xy);
        float steepness = w.z;
        float wavelength = w.w;
        float k = 6.28318530718 / wavelength;
        float c = sqrt(9.8 / k);
        float f = k * (dot(dir, pos.xz) - c * uTime);
        float a = steepness / k;

        // 对原始 pos.x / pos.z 求偏导，累加到 tangent / binormal
        tangent += vec3(
          -dir.x * dir.x * (steepness * sin(f)),
                dir.x * (steepness * cos(f)),
          -dir.x * dir.y * (steepness * sin(f))
        );
        binormal += vec3(
          -dir.x * dir.y * (steepness * sin(f)),
                dir.y * (steepness * cos(f)),
          -dir.y * dir.y * (steepness * sin(f))
        );

        return vec3(
          dir.x * (a * cos(f)),
          a * sin(f),
          dir.y * (a * cos(f))
        );
      }

      void main() {
        vec3 pos = position;

        // 关键：波形基于 WORLD xz 计算，与 mesh 位置无关
        // 这样水 mesh 可以自由跟随相机，波纹在世界空间中稳定，不会因为 mesh 移动产生相位跳变
        vec4 wpBase = modelMatrix * vec4(pos, 1.0);
        vec3 posForWave = vec3(wpBase.x, 0.0, wpBase.z);

        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);

        vec3 offset = vec3(0.0);
        offset += gerstner(uWaveA, posForWave, tangent, binormal);
        offset += gerstner(uWaveB, posForWave, tangent, binormal);
        pos += offset;

        vec3 smoothN = normalize(cross(binormal, tangent));

        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorldPos = wp.xyz;
        vNormalSmooth = normalize((modelMatrix * vec4(smoothN, 0.0)).xyz);
        vWaveHeight = offset.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec3  uSunDirection;
      uniform vec3  uSunColor;

      uniform vec3  uShallowColor;
      uniform vec3  uDeepColor;
      uniform vec3  uHorizonColor;
      uniform vec3  uZenithColor;
      uniform vec3  uFoamColor;
      uniform vec3  uStreakColor;

      uniform vec2  uFlowDir;
      uniform float uFlowSpeed;

      uniform float uFresnelStrength;
      uniform float uSunSpecSharpness;
      uniform float uSunSpecStrength;

      uniform float uAbsorptionCoef;
      uniform float uTintCoef;

      uniform float uFoamDistance;
      uniform float uFoamSoftness;
      uniform float uFoamNoiseStrength;

      uniform float uStreakScale;
      uniform float uStreakThreshold;
      uniform float uStreakSoftness;
      uniform float uStreakStrength;

      uniform sampler2D uDepthTexture;
      uniform sampler2D uSceneColorTexture;
      uniform vec2  uResolution;
      uniform float uCameraNear;
      uniform float uCameraFar;

      varying vec3 vWorldPos;
      varying vec3 vNormalSmooth;
      varying float vWaveHeight;

      /* ─── Noise / FBM ───────────────────────── */
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
          s += noise(p) * amp;
          p *= 2.03;
          amp *= 0.5;
        }
        return s;
      }

      /* ─── 深度解算 ────────────────────────── */
      float perspectiveDepthToViewZ(float depth, float near, float far) {
        float z_ndc = depth * 2.0 - 1.0;
        return (2.0 * near * far) / (far + near - z_ndc * (far - near));
      }

      vec3 sampleSky(vec3 dir) {
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 base = mix(uHorizonColor, uZenithColor, pow(h, 0.6));
        float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
        base += uSunColor * pow(sunDot, 40.0) * 0.6;
        return base;
      }

      void main() {
        /* ── 两套法线 ──
           N_flat  : dFdx/dFdy，per-facet，用于色块感 + 卡通 diffuse 分层
           N_smooth: 来自 vertex 的 Gerstner 解析法线，平滑，用于 spec/fresnel
                    这样太阳高光是软边光斑，而不是硬切面 ── */
        vec3 fdx = dFdx(vWorldPos);
        vec3 fdy = dFdy(vWorldPos);
        vec3 N_flat = normalize(cross(fdx, fdy));
        if (N_flat.y < 0.0) N_flat = -N_flat;

        vec3 N_smooth = normalize(vNormalSmooth);
        if (N_smooth.y < 0.0) N_smooth = -N_smooth;
        // 进一步向上偏，让高光更柔和（stylized 水面通常这样处理）
        N_smooth = normalize(mix(N_smooth, vec3(0.0, 1.0, 0.0), 0.35));

        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDirection);
        vec3 H = normalize(L + V);

        /* ── 水厚（水面与水下物体的距离，沿视线方向） ── */
        vec2 screenUV = gl_FragCoord.xy / uResolution;
        float sceneDepthRaw = texture2D(uDepthTexture, screenUV).x;
        float sceneEye = perspectiveDepthToViewZ(sceneDepthRaw, uCameraNear, uCameraFar);
        float waterEye = perspectiveDepthToViewZ(gl_FragCoord.z, uCameraNear, uCameraFar);
        float thickness = max(sceneEye - waterEye, 0.0);

        /* ── 水下场景颜色（Beer-Lambert 吸收 → 透明感 + 近浅远深） ── */
        vec3 sceneCol = texture2D(uSceneColorTexture, screenUV).rgb;
        float absorb = 1.0 - exp(-thickness * uAbsorptionCoef);
        vec3 waterTint = mix(uShallowColor, uDeepColor, absorb);
        vec3 tinted = mix(sceneCol, sceneCol * uShallowColor * 1.3, uTintCoef);
        vec3 col = mix(tinted, waterTint, absorb);

        /* ── 卡通阶梯光照（用 smooth 法线 + smoothstep，避免 facet 硬三角格子） ── */
        float NdotL = clamp(dot(N_smooth, L), 0.0, 1.0);
        float band = smoothstep(0.45, 0.65, NdotL) * 0.10
                   + smoothstep(0.82, 0.92, NdotL) * 0.05;
        col *= 0.9 + band;

        /* ── 弱 Fresnel（用 smooth 法线，避免硬边） ── */
        float NdotV = max(dot(N_smooth, V), 0.0);
        vec3 R = reflect(-V, N_smooth);
        float fresnel = pow(1.0 - NdotV, 5.0) * uFresnelStrength;
        col = mix(col, sampleSky(R), clamp(fresnel, 0.0, 1.0));

        /* ── Sun Spec（smooth 法线 + 平滑衰减，无硬切边） ── */
        float NdotH = max(dot(N_smooth, H), 0.0);
        // 双层：宽光晕 + 窄芯，避免只用高 pow 造成锐边
        float specWide = pow(NdotH, uSunSpecSharpness * 0.25);
        float specCore = pow(NdotH, uSunSpecSharpness);
        float spec = (specWide * 0.35 + specCore * 0.65) * uSunSpecStrength;
        col += uSunColor * spec;

        /* ── Flow ── */
        vec2 flow = normalize(uFlowDir) * uFlowSpeed * uTime;

        /* ── 流动亮纹 —— 旋转 UV + 双重 domain warp 打破轴对齐，避免"格子"感 ── */
        if (uStreakStrength > 0.001) {
          // 30° 旋转让噪声方向偏离 XZ 轴
          const float ang = 0.5236;
          float ca = cos(ang), sa = sin(ang);
          mat2 rot = mat2(ca, -sa, sa, ca);
          vec2 base = rot * vWorldPos.xz * uStreakScale;

          vec2 sUV1 = base + flow;
          vec2 sUV2 = base * 1.85 - flow * 0.55;

          // 第一次 warp：用两个独立噪声偏移形成非轴对齐扭曲
          vec2 w1 = vec2(
            fbm(sUV1 * 0.55),
            fbm(sUV1 * 0.55 + vec2(31.4, 7.3))
          ) - 0.5;
          sUV1 += w1 * 1.4;

          vec2 w2 = vec2(
            fbm(sUV2 * 0.48 + vec2(11.2, 47.9)),
            fbm(sUV2 * 0.48 + vec2(93.1, 17.6))
          ) - 0.5;
          sUV2 += w2 * 1.2;

          float n1 = fbm(sUV1);
          float n2 = fbm(sUV2);
          float streakNoise = clamp(n1 * n2 * 2.4, 0.0, 1.0);
          float streaks = smoothstep(uStreakThreshold, uStreakThreshold + uStreakSoftness, streakNoise);
          col += uStreakColor * streaks * uStreakStrength;
        }

        /* ── 相交泡沫（岸边 / 船体入水的白边） ── */
        float foamMask = 1.0 - smoothstep(0.0, uFoamDistance, thickness);
        float foamNoise = fbm(vWorldPos.xz * 1.4 + flow * 2.0);
        foamMask *= mix(1.0, foamNoise * 2.0, uFoamNoiseStrength);
        float foamOuter = smoothstep(0.0, uFoamSoftness, foamMask);
        float foamInner = smoothstep(0.6, 0.9, foamMask);
        float foam = clamp(foamOuter * 0.6 + foamInner * 0.95, 0.0, 1.0);
        col = mix(col, uFoamColor, foam);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  return material;
}

export function createWaterMesh(size = 600, segments = 220): {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
} {
  const material = createWaterMaterial();
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = false;
  mesh.name = 'water';
  return { mesh, material };
}
