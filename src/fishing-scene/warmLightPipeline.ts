import Phaser from 'phaser';

/**
 * WarmLightPipeline —— 一个自定义 PostFX 管线，用 GLSL 在场景上渲染多个点光源。
 *
 * 相比"多层圆环 + preFX.addBlur"这种蒙混过关的做法，这个 shader 直接对每个像素
 * 计算它到所有光源的距离，用 Gaussian 衰减合成辉光，数学上是连续函数，
 * 不会出现"环状阶梯"artifacts。可以给每个光源单独指定：
 *   - 位置 (x, y)
 *   - 半径 sigma（Gaussian 标准差，越大光晕越大越柔）
 *   - 强度 intensity（越大越亮）
 *   - 颜色 color（可以混合暖白灯 + 粉霓虹 + 冷鱼缸光）
 *
 * 光源上限 16，够放 8 盏吊灯 + 1 门灯 + 1 霓虹 + 若干扩展。
 */

const MAX_LIGHTS = 16;

const FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
// x,y = 位置像素坐标, z = sigma, w = intensity
uniform vec4 uLights[${MAX_LIGHTS}];
// 每盏灯的颜色（线性 rgb, 0-1）
uniform vec3 uLightColors[${MAX_LIGHTS}];

varying vec2 outTexCoord;

void main() {
  vec4 base = texture2D(uMainSampler, outTexCoord);
  // PostFX 纹理坐标以左下为 Y 原点，而场景光源使用左上原点。
  // 翻转 Y 后，光斑才会与 Phaser GameObject 的屏幕坐标重合。
  vec2 fragPos = vec2(
    outTexCoord.x * uResolution.x,
    (1.0 - outTexCoord.y) * uResolution.y
  );

  vec3 lightAccum = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 L = uLights[i];
    float intensity = L.w;
    if (intensity > 0.0) {
      vec2 diff = fragPos - L.xy;
      float d2 = dot(diff, diff);
      float sigma = L.z;
      // Gaussian 衰减：alpha = exp(-d^2 / (2 * sigma^2))
      float att = exp(-d2 / (2.0 * sigma * sigma));
      lightAccum += uLightColors[i] * att * intensity;
    }
  }

  // Screen 型提亮代替无上限直接相加：亮部逐渐趋近 1，不会大片硬性过曝。
  vec3 glow = vec3(1.0) - exp(-lightAccum);
  vec3 finalColor = base.rgb + (vec3(1.0) - base.rgb) * glow;

  gl_FragColor = vec4(finalColor, base.a);
}
`;

export type WarmLight = {
  x: number;
  y: number;
  sigma: number;      // Gaussian 标准差（像素）
  intensity: number;  // 强度 0~2 左右
  color: number;      // 0xRRGGBB
};

export class WarmLightPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private lightUniform: Float32Array;
  private colorUniform: Float32Array;
  private resolution: Float32Array;

  constructor(game: Phaser.Game) {
    super({ game, name: 'WarmLightPipeline', fragShader: FRAG });
    this.lightUniform = new Float32Array(MAX_LIGHTS * 4);
    this.colorUniform = new Float32Array(MAX_LIGHTS * 3);
    this.resolution = new Float32Array([game.canvas.width, game.canvas.height]);
  }

  /** 传入光源列表；不足 MAX_LIGHTS 的位置 intensity 会被填 0（自动无效化）。 */
  setLights(lights: WarmLight[]) {
    this.lightUniform.fill(0);
    this.colorUniform.fill(0);
    const n = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < n; i += 1) {
      const L = lights[i];
      this.lightUniform[i * 4 + 0] = L.x;
      this.lightUniform[i * 4 + 1] = L.y;
      this.lightUniform[i * 4 + 2] = L.sigma;
      this.lightUniform[i * 4 + 3] = L.intensity;
      this.colorUniform[i * 3 + 0] = ((L.color >> 16) & 0xff) / 255;
      this.colorUniform[i * 3 + 1] = ((L.color >> 8) & 0xff) / 255;
      this.colorUniform[i * 3 + 2] = (L.color & 0xff) / 255;
    }
  }

  /** 一般传视口原始尺寸（1280 × 720），不是缩放后的 canvas 尺寸。 */
  setResolution(w: number, h: number) {
    this.resolution[0] = w;
    this.resolution[1] = h;
  }

  onPreRender() {
    this.set2fv('uResolution', this.resolution);
    this.set4fv('uLights[0]', this.lightUniform);
    this.set3fv('uLightColors[0]', this.colorUniform);
  }
}
