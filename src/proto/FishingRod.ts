import * as THREE from 'three';
import { createStylizedMaterial } from '../render/StylizedMaterial';

/**
 * 第一人称鱼竿 —— 挂在相机上，视觉上从画面右下伸出。
 *
 * 组成：
 *   rodPivot (相机子节点) → 以 base 为轴心，rod 顺着 +Y 方向延伸
 *     └── rod mesh (锥形圆柱，从粗到细)
 *   bobber (世界空间 Object3D，浮标 —— 跟波浪浮动，用 setBobberXZ 移动)
 *   line   (世界空间细圆柱，两点之间动态更新)
 *
 * 主要方法：
 *   setVisible(v)           显示/隐藏 rod + line + bobber
 *   updateCast(fromTip, toWorld, t01)   抛竿动画中被 FishingGame 调用（0..1）
 *   setBobberXZ(x, z)       从游戏逻辑设置浮标当前 XZ；Y 每帧根据 waveFn 计算
 *   setBobberSink(depth)    咬钩沉浮标（米）
 *   setRodBend(amount, dirXZWorld)  竿身向 dirXZ 方向弯曲；amount 0..1
 *   update(dt, waveHeightAt) 每帧更新 —— 更新竿的插值 / 浮标 Y / 线 mesh
 *
 * 竿尖世界坐标：getRodTipWorld()
 */

export class FishingRod {
  readonly rodRig: THREE.Group;        // 相机子节点，整个鱼竿的挂载点（固定不弯曲）
  readonly rodPivot: THREE.Group;      // rodRig 子节点，只装竿身，弯曲时旋转这个
  readonly rodMesh: THREE.Mesh;        // 竿身（沿 +Y 延伸）
  readonly bobber: THREE.Group;        // 世界空间浮标
  readonly line: THREE.Mesh;           // 世界空间鱼线（细圆柱）

  private lineMat: THREE.MeshBasicMaterial;
  private bobberMat: THREE.MeshBasicMaterial;

  private readonly rodLength: number;
  private readonly basePose: { pos: THREE.Vector3; euler: THREE.Euler };
  private currentBend = 0;               // 平滑后的弯曲量
  private targetBend = 0;                // setRodBend 设置的目标
  private bendDirWorld = new THREE.Vector3(0, 0, -1);
  private readonly bendMaxDeg = 26;      // 最大弯曲角度（42→26：鱼竿"弯"表示鱼在拽，但幅度收敛不再横扫半屏）

  // 浮标的 XZ 由游戏逻辑设置，Y 由波高函数决定
  private bobberX = 0;
  private bobberZ = 0;
  private bobberSink = 0;                // 咬钩时的额外下沉（米）
  private bobberYSmoothed = 0;
  /** 起竿动画时用：非 null 则跳过波浪跟随，直接使用这个世界坐标 */
  private bobberOverride: THREE.Vector3 | null = null;

  private visible = false;

  /** 保留相机引用 —— FishingGame 用来算屏幕左右方向（挣扎侧向拉扯 + 玩家反向对抗判定） */
  readonly camera: THREE.Camera;

  private readonly _tmpVec = new THREE.Vector3();
  private readonly _tmpVec2 = new THREE.Vector3();
  private readonly _tmpQuat = new THREE.Quaternion();
  private readonly _upY = new THREE.Vector3(0, 1, 0);

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    this.camera = camera;
    /* ── 竿的挂载：相机子节点，画面右下方 ── */
    // 相机 local: -Z=前, +X=右, +Y=上
    // 相机往船头前方推 —— 避免玩家往下看近距离浮标时，鱼竿末端戳进船体导致视觉消失
    this.basePose = {
      pos: new THREE.Vector3(0.42, -0.28, -1.15),
      // 让 rod 的 +Y 指向"前上外"方向：
      //   绕 X 轴 -55° 让 +Y 倾向前方 (-Z)
      //   绕 Z 轴 -22° 让 rod 稍微向右倾斜
      euler: new THREE.Euler(-0.96, 0.0, -0.38, 'ZYX'),
    };

    this.rodRig = new THREE.Group();
    this.rodRig.name = 'fishing-rod-rig';
    this.rodRig.position.copy(this.basePose.pos);
    this.rodRig.rotation.copy(this.basePose.euler);

    // rodPivot 挂在 rodRig 下，位置在 rodRig 原点（= 手柄顶端）—— 弯曲只旋转这个
    this.rodPivot = new THREE.Group();
    this.rodPivot.name = 'fishing-rod-pivot';
    this.rodRig.add(this.rodPivot);

    /* ── 色板：整体提亮 + 降饱和，走柔和水彩画感 ── */
    const COLOR = {
      shaft:      '#e0b58a',   // 主杆：浅暖米金（原 #c98846 提亮降饱和）
      shaftDark:  '#b48962',   // 主杆深色（渐深端）
      wrapRed:    '#d67f6b',   // 装饰丝带：柔和珊瑚红（原深朱红去饱和）
      wrapGold:   '#eed693',   // 金色纹饰环：淡奶油金
      wrapBlue:   '#7fa2c5',   // 蓝色接口环：浅雾蓝
      handleWood: '#8c6549',   // 手柄：浅木色（原深红木提亮）
      handleTip:  '#54402f',   // 手柄末端护套（比手柄深一档但不再纯黑）
      reelGold:   '#e6c88a',   // 卷线器主体：淡金
      reelBlue:   '#6f95b8',   // 卷线器中心：浅雾蓝
      holderWood: '#6a4c34',   // 杆座木：中木色
    };

    /**
     * 统一构造属性：StylizedMaterial（3渲2）+ 关闭深度测试 + 最高 renderOrder
     * —— 让手中鱼竿也遵循全场景的冷阴影 / 暖高光色带，避免 FPS overlay 出戏
     */
    const makeMat = (color: string, extra?: Partial<THREE.MeshToonMaterialParameters>) => {
      const m = createStylizedMaterial({ color, depthTest: false, depthWrite: false });
      if (extra) Object.assign(m, extra);
      return m;
    };

    // 竿身：从底部 0.02 半径到顶部 0.006 半径的圆锥圆柱
    this.rodLength = 2.4;
    const rodGeo = new THREE.CylinderGeometry(0.006, 0.02, this.rodLength, 12, 1);
    // 让 base 位于 y=0
    rodGeo.translate(0, this.rodLength / 2, 0);
    // 手中鱼竿关闭深度测试 —— 永远画在其他物体（包括船体）之前，
    // 避免相机视角俯视时基座被船体驾驶舱遮挡的问题（FPS 里"手不会穿墙"的经典处理）
    const rodMat = makeMat(COLOR.shaft);
    this.rodMesh = new THREE.Mesh(rodGeo, rodMat);
    this.rodMesh.castShadow = false;
    this.rodMesh.receiveShadow = false;
    this.rodMesh.renderOrder = 10000;    // 极高，保证在所有场景物体之后绘制（覆盖在其上）
    this.rodPivot.add(this.rodMesh);     // 只有竿身跟随弯曲

    /* ── 竿身装饰环（红丝带 + 金环 + 蓝接口）——
     * 沿竿身四段分布，仿参考图的螺旋丝带缠绕效果。
     * 每个环是一个薄的圆柱，半径略比对应位置的竿粗一点。
     * 由于半径线性从底部 0.02 递减到顶部 0.006，我们用 y 位置直接算出该处半径。
     */
    const rodRadiusAtY = (y: number) => 0.02 - (y / this.rodLength) * (0.02 - 0.006);
    const addRing = (y: number, height: number, radiusPad: number, color: string) => {
      const rAt = rodRadiusAtY(y);
      const g = new THREE.CylinderGeometry(rAt + radiusPad, rAt + radiusPad, height, 14);
      g.translate(0, y, 0);
      const m = makeMat(color);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 10001;   // 略高于竿身，避免 z-fight
      this.rodPivot.add(mesh);
    };
    // 靠近基座：宽蓝色接口环（把手柄→竿身的接点包住）
    addRing(0.02, 0.045, 0.005, COLOR.wrapBlue);
    // 基座上方：一圈金色细边
    addRing(0.060, 0.010, 0.006, COLOR.wrapGold);
    // 第 1 段红丝带（1/4 处）
    addRing(0.55, 0.055, 0.004, COLOR.wrapRed);
    addRing(0.60, 0.010, 0.005, COLOR.wrapGold);
    // 第 2 段红丝带（1/2 处）
    addRing(1.15, 0.050, 0.004, COLOR.wrapRed);
    addRing(1.20, 0.010, 0.004, COLOR.wrapGold);
    // 第 3 段红丝带（3/4 处，靠近竿尖）
    addRing(1.75, 0.045, 0.004, COLOR.wrapRed);
    addRing(1.80, 0.010, 0.004, COLOR.wrapGold);
    // 竿尖前的红色装饰（末梢强调色）
    addRing(2.25, 0.035, 0.003, COLOR.wrapRed);

    // ── 以下手柄 / 卷线器 / 杆座都挂在 rodRig 下（不参与弯曲），
    //    这样鱼被拽扯时，玩家看到的画面右下角始终是稳定的"握把"，不会飘 ──

    // 手柄：粗一点的圆柱（长 0.25m），从 y=0 向下延伸；深红木色
    const handleGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.25, 12);
    handleGeo.translate(0, -0.125, 0);
    const handle = new THREE.Mesh(handleGeo, makeMat(COLOR.handleWood));
    handle.renderOrder = 10000;
    this.rodRig.add(handle);

    // 手柄底端护套（更深的暗色小段，参考图末端有一个金色/深色收尾）
    const handleCapGeo = new THREE.CylinderGeometry(0.038, 0.030, 0.035, 12);
    handleCapGeo.translate(0, -0.265, 0);
    const handleCap = new THREE.Mesh(handleCapGeo, makeMat(COLOR.handleTip));
    handleCap.renderOrder = 10000;
    this.rodRig.add(handleCap);
    // 护套上金色装饰环
    const handleGoldGeo = new THREE.CylinderGeometry(0.039, 0.039, 0.008, 12);
    handleGoldGeo.translate(0, -0.245, 0);
    const handleGold = new THREE.Mesh(handleGoldGeo, makeMat(COLOR.wrapGold));
    handleGold.renderOrder = 10000;
    this.rodRig.add(handleGold);

    // 卷线器：外圈金色圆盘 + 中心蓝色小盘（参考图卷线器就是金蓝组合）
    const reelGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.048, 14);
    reelGeo.rotateZ(Math.PI / 2);
    reelGeo.translate(0.06, 0.03, 0);
    const reel = new THREE.Mesh(reelGeo, makeMat(COLOR.reelGold));
    reel.renderOrder = 10000;
    this.rodRig.add(reel);
    // 卷线器中心蓝盘
    const reelCoreGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.055, 14);
    reelCoreGeo.rotateZ(Math.PI / 2);
    reelCoreGeo.translate(0.06, 0.03, 0);
    const reelCore = new THREE.Mesh(reelCoreGeo, makeMat(COLOR.reelBlue));
    reelCore.renderOrder = 10001;
    this.rodRig.add(reelCore);

    // 杆座（船体上的插杆凹槽）—— 视觉锚点，让手柄"插进"座里，不会看起来悬空
    // 位于手柄下方，锥形上开口 + 圆柱底座
    const holderGrp = new THREE.Group();
    const cupGeo = new THREE.CylinderGeometry(0.075, 0.055, 0.14, 12, 1, true);
    cupGeo.translate(0, -0.35, 0);
    const holderMat = makeMat(COLOR.holderWood, { side: THREE.DoubleSide });
    const cup = new THREE.Mesh(cupGeo, holderMat);
    cup.renderOrder = 10000;
    holderGrp.add(cup);
    // 座底盘 —— 一个稍宽的圆盘让杆座看起来"焊在甲板上"
    const baseDiscGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12);
    baseDiscGeo.translate(0, -0.44, 0);
    const baseDisc = new THREE.Mesh(baseDiscGeo, makeMat(COLOR.handleWood));
    baseDisc.renderOrder = 10000;
    holderGrp.add(baseDisc);
    this.rodRig.add(holderGrp);

    camera.add(this.rodRig);

    /* ── 浮标：世界空间 —— 参考图里就是水面一个不起眼的小白点，别做太大 ── */
    this.bobber = new THREE.Group();
    this.bobber.name = 'fishing-bobber';
    const bobberBodyGeo = new THREE.SphereGeometry(0.045, 10, 8);
    this.bobberMat = new THREE.MeshBasicMaterial({ color: '#f2f2f2' });
    const bobberBody = new THREE.Mesh(bobberBodyGeo, this.bobberMat);
    bobberBody.renderOrder = 90;
    (this.bobberMat as any).depthTest = true;
    this.bobber.add(bobberBody);
    // 下半暗红小配重球（参考图浮标上有颗小红珠）
    const weightGeo = new THREE.SphereGeometry(0.022, 8, 6);
    const weightMat = new THREE.MeshBasicMaterial({ color: '#a02020' });
    const weight = new THREE.Mesh(weightGeo, weightMat);
    weight.position.y = -0.05;
    weight.renderOrder = 90;
    this.bobber.add(weight);
    scene.add(this.bobber);

    /* ── 鱼线：细圆柱，每帧重定位/缩放。颜色随张力变化（参考视频：平时白线，
       上鱼后变紧绷的黄色，张力越高越偏橙红）── */
    const lineGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1);
    // cylinder 中心在几何原点；不平移，updateLine 用 setPosition + lookAt 组合
    this.lineMat = new THREE.MeshBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.9 });
    this.line = new THREE.Mesh(lineGeo, this.lineMat);
    this.line.renderOrder = 95;
    scene.add(this.line);

    this.setVisible(false);
  }

  setVisible(v: boolean) {
    if (this.visible === v) return;
    this.visible = v;
    this.rodRig.visible = v;
    this.bobber.visible = v;
    this.line.visible = v;
    if (!v) this.bobberOverride = null;   // 结束后清覆盖，避免下一局残留
  }

  isVisible() { return this.visible; }

  /** 世界坐标：竿尖位置 */
  getRodTipWorld(out?: THREE.Vector3): THREE.Vector3 {
    const v = out ?? new THREE.Vector3();
    v.set(0, this.rodLength, 0);
    this.rodMesh.parent!.updateMatrixWorld();
    v.applyMatrix4(this.rodMesh.parent!.matrixWorld);
    return v;
  }

  /** 直接设置浮标的 XZ（世界空间）。Y 由波高函数决定。 */
  setBobberXZ(x: number, z: number) {
    this.bobberX = x;
    this.bobberZ = z;
  }

  /**
   * 起竿动画专用：给一个绝对世界坐标，跳过波浪跟随。
   * 传 null 关闭覆盖，恢复波浪跟随。
   */
  setBobberOverride(pos: THREE.Vector3 | null) {
    if (pos === null) {
      this.bobberOverride = null;
    } else {
      if (!this.bobberOverride) this.bobberOverride = new THREE.Vector3();
      this.bobberOverride.copy(pos);
    }
  }

  /** 咬钩时增加沉入深度（米）。0 = 浮在水面。 */
  setBobberSink(depth: number) {
    this.bobberSink = Math.max(0, depth);
  }

  /**
   * 鱼线张力可视化：0 = 松弛（白色），1 = 极限（橙红）
   * 中段过渡到黄色 —— 对应参考视频里"上鱼后鱼线一直是紧绷黄色"的视觉语言
   */
  setLineTension(t01: number) {
    const t = Math.max(0, Math.min(1, t01));
    // 白 #e8e8e8 → 黄 #ffd93d(0.55) → 橙红 #ff3b30(1.0)
    const c = new THREE.Color();
    if (t < 0.55) {
      c.lerpColors(new THREE.Color('#e8e8e8'), new THREE.Color('#ffd93d'), t / 0.55);
    } else {
      c.lerpColors(new THREE.Color('#ffd93d'), new THREE.Color('#ff3b30'), (t - 0.55) / 0.45);
    }
    this.lineMat.color.copy(c);
  }

  /** 是否挂钓（用于决定线是否显示"松弛下垂"还是"绷直"，目前仅供外部查询） */
  setLineSlack(_slack: number) {
    // 预留：未来可以让线在无张力时略微下垂弯曲，现在保持直线简单实现
  }

  /**
   * 竿身弯曲。amount 0..1；dirXZWorld = 世界 XZ 平面弯向哪儿。
   * dirXZWorld 长度会被归一化。
   */
  setRodBend(amount: number, dirXZWorld?: THREE.Vector3) {
    this.targetBend = Math.max(0, Math.min(1, amount));
    if (dirXZWorld) {
      this.bendDirWorld.set(dirXZWorld.x, 0, dirXZWorld.z);
      if (this.bendDirWorld.lengthSq() > 1e-6) this.bendDirWorld.normalize();
    }
  }

  /**
   * 每帧更新（无论是否可见，都调 —— 若不可见就跳出）
   *   waveHeightAt(x, z): 传入世界 XZ，返回该处水面 Y
   */
  update(dt: number, waveHeightAt: (x: number, z: number) => number) {
    if (!this.visible) return;

    // 平滑弯曲量
    const k = 1 - Math.exp(-8 * dt);
    this.currentBend += (this.targetBend - this.currentBend) * k;

    // 竿身弯曲：只旋转 rodPivot（竿身），rodRig（手柄+杆座）保持不动，
    // 这样鱼被拽扯时玩家看到的握把区域始终稳定在画面右下角
    if (this.currentBend > 1e-3 && this.rodRig.parent) {
      // rodPivot.parent = rodRig；rodRig 已经应用了 basePose 旋转，
      // 我们要在 rodRig 局部坐标系下算 bend 轴 —— 所以拿 rodRig.matrixWorld 反变换 bendDirWorld
      this.rodRig.updateMatrixWorld();
      this._tmpVec.copy(this.bendDirWorld);
      const invMat = this._tmpQuat.setFromRotationMatrix(this.rodRig.matrixWorld).invert();
      this._tmpVec.applyQuaternion(invMat);
      // 只保留 XZ 分量（不让它上下弯）
      this._tmpVec.y = 0;
      if (this._tmpVec.lengthSq() > 1e-6) {
        this._tmpVec.normalize();
        const angle = this.currentBend * this.bendMaxDeg * Math.PI / 180;
        // axis = up × dir （水平轴），让竿身 +Y 向 dir 倾斜
        this._tmpVec2.crossVectors(this._upY, this._tmpVec);
        if (this._tmpVec2.lengthSq() > 1e-6) {
          this._tmpVec2.normalize();
          this.rodPivot.quaternion.setFromAxisAngle(this._tmpVec2, angle);
        } else {
          this.rodPivot.rotation.set(0, 0, 0);
        }
      } else {
        this.rodPivot.rotation.set(0, 0, 0);
      }
    } else {
      // 无弯曲：竿身回正
      this.rodPivot.rotation.set(0, 0, 0);
    }

    // 浮标 Y：跟波面（-sink），做一层轻微平滑避免瞬时抖动
    if (this.bobberOverride) {
      // 起竿动画期间：跳过波浪跟随，直接用外部给的绝对坐标
      this.bobber.position.copy(this.bobberOverride);
      this.bobberX = this.bobberOverride.x;
      this.bobberZ = this.bobberOverride.z;
      this.bobberYSmoothed = this.bobberOverride.y;
    } else {
      const waveY = waveHeightAt(this.bobberX, this.bobberZ);
      const targetY = waveY - this.bobberSink;
      // 咬钩下沉时立刻响应（sink > 0.05）
      if (this.bobberSink > 0.05) this.bobberYSmoothed = targetY;
      else this.bobberYSmoothed += (targetY - this.bobberYSmoothed) * (1 - Math.exp(-10 * dt));
      this.bobber.position.set(this.bobberX, this.bobberYSmoothed, this.bobberZ);
    }

    // 直接设置浮标位置（抛竿中被 updateCast 覆盖）
    this.updateLine();
  }

  /** 抛竿动画：t01 从 0 到 1；浮标从 rod tip 抛物线飞到 target */
  updateCast(target: THREE.Vector3, t01: number) {
    const tip = this.getRodTipWorld(this._tmpVec);
    const t = Math.max(0, Math.min(1, t01));
    // XZ 线性插值
    const x = tip.x + (target.x - tip.x) * t;
    const z = tip.z + (target.z - tip.z) * t;
    // Y 抛物线：起点 tip.y，终点 target.y，弧顶 = max(tip.y, target.y) + 2
    const arcApex = Math.max(tip.y, target.y) + 2.2;
    const y = (1 - t) * (1 - t) * tip.y
            + 2 * (1 - t) * t * arcApex
            + t * t * target.y;
    this.bobber.position.set(x, y, z);
    this.bobberX = x;
    this.bobberZ = z;
    this.bobberYSmoothed = y;
    this.updateLine();
  }

  /** 每帧更新鱼线（一个细圆柱在 tip 与 bobber 之间） */
  private updateLine() {
    const tip = this.getRodTipWorld(this._tmpVec);
    const b = this.bobber.position;
    // 中点
    this.line.position.set((tip.x + b.x) * 0.5, (tip.y + b.y) * 0.5, (tip.z + b.z) * 0.5);
    // 方向：从 tip 到 b
    this._tmpVec2.set(b.x - tip.x, b.y - tip.y, b.z - tip.z);
    const len = this._tmpVec2.length();
    if (len < 1e-4) {
      this.line.visible = false;
      return;
    }
    this.line.visible = this.visible;
    this._tmpVec2.normalize();
    // cylinder 默认沿 +Y；旋转 +Y 对齐到方向
    this.line.quaternion.setFromUnitVectors(this._upY, this._tmpVec2);
    this.line.scale.set(1, len, 1);
  }
}
