import Phaser from 'phaser';

export type AtmosphereFxConfig = {
  viewW: number;
  viewH: number;
  surfaceY: number;
  /** 太阳/光束汇聚点，默认画面上方偏中。 */
  sunX?: number;
  sunY?: number;
  /** 光束整体倾斜角（弧度，0=垂直向下，负值表示从右上向左下斜射）。 */
  rayAngle?: number;
};

const DEFAULT_RAY_ANGLE = -0.68;

/**
 * 程序生成的湖区氛围：斜射丁达尔光、太阳光晕与水下光柱。
 * 全部使用预烘焙 Canvas 纹理（含高斯模糊羽化）+ 轻量 sin 动画，避免每帧重绘。
 */
export class AtmosphereFx {
  private godRays!: Phaser.GameObjects.Image;
  private sunGlow!: Phaser.GameObjects.Image;
  private underwaterRays!: Phaser.GameObjects.Graphics;
  private visible = true;
  private nightDim = 1;
  private rayAngle = DEFAULT_RAY_ANGLE;

  constructor(private scene: Phaser.Scene) {}

  create(config: AtmosphereFxConfig) {
    this.rayAngle = config.rayAngle ?? DEFAULT_RAY_ANGLE;
    this.ensureTextures(config);
    const sunX = config.sunX ?? config.viewW * 0.66;
    const sunY = config.sunY ?? config.viewH * 0.08;

    this.sunGlow = this.scene.add.image(sunX, sunY, 'atmosphere-sun-glow')
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.18);

    this.godRays = this.scene.add.image(sunX, sunY, 'atmosphere-god-rays')
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1)
      // 保留柔和的叠加发光，但强度低于最初版本，避免再次洗白远景。
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.15);

    this.underwaterRays = this.scene.add.graphics().setDepth(-4).setScrollFactor(1);
  }

  update(timeMs: number, camera: Phaser.Cameras.Scene2D.Camera) {
    if (!this.visible) return;
    const time = timeMs * 0.001;
    const dim = this.nightDim;

    this.sunGlow.setAlpha((0.16 + Math.sin(time * 0.5) * 0.025) * dim);
    this.godRays
      .setAlpha((0.14 + Math.sin(time * 0.38 + 0.8) * 0.02) * dim)
      .setRotation(Math.sin(time * 0.07) * 0.01);

    this.drawUnderwaterRays(time, camera, dim);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.sunGlow.setVisible(visible);
    this.godRays.setVisible(visible);
    this.underwaterRays.setVisible(visible);
  }

  setNightDimmed(dimmed: boolean) {
    this.nightDim = dimmed ? 0.35 : 1;
  }

  private drawUnderwaterRays(time: number, camera: Phaser.Cameras.Scene2D.Camera, dim: number) {
    this.underwaterRays.clear();
    const surfaceY = this.scene.registry.get('fishingSurfaceY') as number ?? 545;
    const sunScreenX = this.scene.registry.get('atmosphereSunX') as number ?? 690;
    const sunWorldX = sunScreenX + camera.scrollX;
    const bottom = camera.scrollY + camera.height;
    if (bottom <= surfaceY + 8) return;

    const rayCount = 4;
    for (let index = 0; index < rayCount; index += 1) {
      const spread = (index - (rayCount - 1) / 2) / (rayCount - 1);
      const angle = this.rayAngle + spread * 0.22;
      // 光束是斜线，直接使用垂直距离会使其垂直投影提前结束，
      // 在画面内露出整齐的硬边。按角度反算长度并延伸到视口外。
      const verticalDistance = bottom - surfaceY + 320;
      const length = verticalDistance / Math.max(0.2, Math.cos(angle));
      const endX = sunWorldX + Math.sin(angle) * length;
      const endY = surfaceY + Math.cos(angle) * length;
      const alpha = (0.06 + Math.sin(time * 0.45 + index) * 0.012) * dim;
      this.underwaterRays.lineStyle(46 + index * 6, 0xe8f6ff, alpha * 0.5);
      this.underwaterRays.lineBetween(sunWorldX, surfaceY - 20, endX, endY);
      this.underwaterRays.lineStyle(22 + index * 4, 0xe8f6ff, alpha);
      this.underwaterRays.lineBetween(sunWorldX, surfaceY - 20, endX, endY);
      this.underwaterRays.lineStyle(9 + index * 2, 0xffffff, alpha * 0.6);
      this.underwaterRays.lineBetween(sunWorldX, surfaceY - 20, endX, endY);
    }
  }

  private ensureTextures(config: AtmosphereFxConfig) {
    if (!this.scene.textures.exists('atmosphere-god-rays')) {
      this.createGodRayTexture(config);
    }
    if (!this.scene.textures.exists('atmosphere-sun-glow')) {
      this.createSunGlowTexture();
    }
  }

  /** 斜射光束：偏向一侧的窄扇形（非左右对称），并用 canvas 模糊做羽化边缘。 */
  private createGodRayTexture(_config: AtmosphereFxConfig) {
    const width = 1800;
    const height = 1100;
    const canvas = this.scene.textures.createCanvas('atmosphere-god-rays', width, height);
    const ctx = canvas.context;
    const originX = width * 0.5;
    const originY = 0;
    ctx.clearRect(0, 0, width, height);

    const beams = 6;
    const spread = 0.24;
    const length = height * 1.05;

    ctx.save();
    ctx.filter = 'blur(26px)';
    for (let index = 0; index < beams; index += 1) {
      const t = index / (beams - 1);
      const angle = this.rayAngle + (t - 0.5) * spread;
      const beamWidth = 0.045 + Math.sin(t * Math.PI) * 0.03;
      const endX = originX + Math.sin(angle) * length;
      const endY = originY + Math.cos(angle) * length;
      const leftAngle = angle - beamWidth;
      const rightAngle = angle + beamWidth;
      const leftX = originX + Math.sin(leftAngle) * length;
      const leftY = originY + Math.cos(leftAngle) * length;
      const rightX = originX + Math.sin(rightAngle) * length;
      const rightY = originY + Math.cos(rightAngle) * length;

      const gradient = ctx.createLinearGradient(originX, originY, endX, endY);
      gradient.addColorStop(0, 'rgba(255, 250, 232, 0.36)');
      gradient.addColorStop(0.3, 'rgba(255, 246, 218, 0.2)');
      gradient.addColorStop(0.6, 'rgba(255, 242, 210, 0.09)');
      gradient.addColorStop(1, 'rgba(255, 238, 205, 0)');

      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.restore();
    canvas.refresh();
  }

  private createSunGlowTexture() {
    const size = 260;
    const canvas = this.scene.textures.createCanvas('atmosphere-sun-glow', size, size);
    const ctx = canvas.context;
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 251, 232, 0.8)');
    gradient.addColorStop(0.22, 'rgba(255, 246, 214, 0.4)');
    gradient.addColorStop(0.5, 'rgba(255, 240, 198, 0.16)');
    gradient.addColorStop(0.78, 'rgba(255, 234, 186, 0.05)');
    gradient.addColorStop(1, 'rgba(255, 230, 180, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
  }

}
