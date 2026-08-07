import * as THREE from 'three';
import type { FishingRod } from './FishingRod';

/**
 * 第一人称钓鱼小游戏（3D 鱼竿驱动版 · 三键博弈）
 *
 * 参考了真实钓鱼游戏录屏后重新设计的手感，核心变化：
 * 不再是"一直按住 LMB 就行，鼠标随便拖一下"，而是三个鼠标键各管一件事，
 * 玩家必须根据鱼的状态切换按键 —— 这才是"博弈感和拉扯感"的来源。
 *
 * 状态机：
 *   IDLE
 *    → CASTING  (0.9s 抛物线飞出去)
 *    → WAITING  (随机 2~5s 等咬钩，浮标浮动)
 *    → BITE     (0.6s 咬钩窗口：浮标下沉抖动，玩家按 LMB 提竿进入 FIGHTING)
 *    → FIGHTING (核心博弈，见下)
 *    → LANDING  (0.5s 收竿动画)
 *    → RESULT
 *
 * FIGHTING 核心手感（区分"鱼在挣扎 pulling" / "鱼在喘气 resting" 两态）：
 *   · resting（鱼没在挣扎，线是安全的）
 *       - 按住 LMB = 收线：lineLen ↓，进度推进；张力小幅上升
 *       - 松开 LMB：什么都不做，张力自然回落
 *       - 这个阶段按 MMB 没有意义（只是白举着）
 *   · pulling（鱼开始猛拽 —— 竿身弯，线变黄/橙红，必须应对）
 *       - 按住 MMB（对抗拉力）：顶住鱼的拽力，张力只小幅上升，不会倒退进度
 *       - 不按 MMB（愣在原地或还在收线）：张力飙升 + 线被鱼拽出去一截（lineLen 反弹增加）
 *       - 这个阶段按 LMB 收效很差（象征性收一点，但张力代价很高，不建议）
 *   · 张力 100% = 断线失败；鱼体力耗尽 = 钓上成功
 *
 * 鱼线颜色（FishingRod.setLineTension）随张力从白 → 黄 → 橙红，直观地告诉玩家危险程度，
 * 不需要一直盯 HUD 上的细条。
 *
 * 与 main 的边界：
 *   start(spotWorld, boatWorld, preset, rod) → Promise<result>
 *   update(dt, waveHeightAt, boatWorld) 每帧调
 *   isActive() 用于 main 冻结船控 & 环视
 */

export interface FishParams {
  name: string;
  /** 初始线长（米）—— 决定整场博弈大致时长 */
  initialLine: number;

  /* ── resting 阶段（收线） ── */
  /** LMB 按住每秒收线（米） */
  reelSpeed: number;
  /** LMB 按住每秒张力基础增量 */
  reelTensionRate: number;
  /** 松开 LMB 时每秒张力下降 */
  restTensionDrop: number;

  /* ── pulling 阶段（对抗拉力） ── */
  /** 按住 MMB 顶住时，每秒张力增量（应该远小于不顶住的情况） */
  counterTensionRate: number;
  /** 不按 MMB 顶住时，每秒张力增量（应该明显更高，制造"必须反应"的压力） */
  exposedTensionRate: number;
  /** 不按 MMB 顶住时，鱼把线拽出去的速度（米/秒，lineLen 增加） */
  fishStripRate: number;
  /** pulling 阶段如果仍按住 LMB 收线，效果打的折扣（0..1，越低越不建议这么做） */
  reelDuringPullPenalty: number;

  /** 鱼挣扎(pulling)持续 min..max（秒） */
  pullPeriod: [number, number];
  /** 鱼喘气(resting)持续 min..max（秒） */
  restPeriod: [number, number];
  /** 咬钩前等待 min..max（秒） */
  biteWait: [number, number];
  /** 挣扎前的预警时间 min..max（秒）—— 给玩家切到 MMB 的反应窗口 */
  pullWarning?: [number, number];
  /** 进入 pulling 后前几秒惩罚打折（0..1），避免一发力就立刻崩线 */
  pullGrace?: number;
}

export const FISH_PRESETS: Record<string, FishParams> = {
  common: {
    name: '青鳞鱼',
    // ── 手感调整：让玩家至少要经历 3~4 次左右挣扎才能钓上（原来 1~2 次就到手）──
    initialLine: 18.0,              // 13→18：需要更多点击才能收到底（≈56 次点击）
    reelSpeed: 1.1,                 // (老字段，收线现在走 pendingReelClicks，保留兼容)
    reelTensionRate: 0.07,          // (同上，未使用)
    restTensionDrop: 0.55,          // 0.80→0.55：休息期张力回落变慢，条子能挂在中段更久
    counterTensionRate: 0.10,       // 0.06→0.10：顶住中键"仍会稳步涨"，逼玩家来回操作
    exposedTensionRate: 0.55,       // 0.28→0.55：不顶时张力飙升，几秒就红
    fishStripRate: 0.55,            // 0.38→0.55：不顶时鱼把线快速拽出去，抵消掉收线进度
    reelDuringPullPenalty: 0.15,
    pullPeriod: [2.8, 4.2],         // 2.2~3.8 → 2.8~4.2：每次挣扎更长
    restPeriod: [1.6, 2.4],         // 2.8~4.5 → 1.6~2.4：挣扎间隔更短，博弈密度翻倍
    biteWait: [1.8, 4.0],
    pullWarning: [0.9, 1.3],        // 1.0~1.6 → 0.9~1.3：预警期略短，反应窗小一点
    pullGrace: 0.5,                 // 1.0→0.5：挣扎初期宽限缩短，来不及切键就要付代价
  },
  medium: {
    name: '巨眼鱼',
    initialLine: 24.0,              // 17→24：更长的博弈流程
    reelSpeed: 0.95,
    reelTensionRate: 0.09,
    restTensionDrop: 0.45,          // 0.70→0.45
    counterTensionRate: 0.13,       // 0.08→0.13
    exposedTensionRate: 0.68,       // 0.34→0.68
    fishStripRate: 0.70,            // 0.48→0.70
    reelDuringPullPenalty: 0.10,
    pullPeriod: [3.2, 4.8],         // 2.5~4.2 → 3.2~4.8
    restPeriod: [1.3, 2.0],         // 2.2~3.5 → 1.3~2.0：休息更短
    biteWait: [2.5, 5.0],
    pullWarning: [0.8, 1.2],        // 0.9~1.4 → 0.8~1.2
    pullGrace: 0.35,                // 0.8→0.35
  },
};

export type FishingResult =
  | { success: true; fish: string }
  | { success: false; reason: 'break' | 'quit' | 'lost' };

type State = 'idle' | 'casting' | 'waiting' | 'bite' | 'fighting' | 'landing' | 'result';
type FishPhase = 'resting' | 'warning' | 'pulling';

/* ────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────── */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randRange = (r: [number, number]) => rand(r[0], r[1]);
function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/* ────────────────────────────────────────────────────────────
   HUD 元素：常驻三按钮提示（收线 / 对抗拉力 / 取消）+ 鱼体力条 + 结果卡
   ──────────────────────────────────────────────────────────── */

interface HudElements {
  root: HTMLElement;
  hint: HTMLElement;              // 上方状态文字（"等咬钩…" / "鱼在用力拉扯！" 等）
  btnReel: HTMLElement;            // 收线 按钮提示
  btnCounter: HTMLElement;         // 对抗拉力 按钮提示
  btnCancel: HTMLElement;          // 取消 按钮提示
  staminaDial: HTMLElement;        // 左圆圈：鱼体力表盘（消耗环）
  tensionMarker: HTMLElement;      // 右长条上的鱼形游标 —— 随张力从左往右移
  result: HTMLElement;
  resultTitle: HTMLElement;
  resultSub: HTMLElement;
}

/* ────────────────────────────────────────────────────────────
   MAIN CLASS
   ──────────────────────────────────────────────────────────── */

export class FishingGame {
  private state: State = 'idle';
  private rod: FishingRod | null = null;
  private params!: FishParams;
  private hud: HudElements;

  // 抛竿 / 落点
  private castT = 0;
  private readonly castDuration = 0.9;
  private target = new THREE.Vector3();
  private boatPos = new THREE.Vector3();

  // 等待咬钩
  private waitTimer = 0;
  private biteTimer = 0;
  private readonly biteWindow = 1.5;
  /** 咬钩等待时间乘数 —— 由钩子加成传入，<1 = 更快咬钩 */
  private biteWaitMult = 1.0;

  // 战斗
  private lineLen = 0;
  private tension = 0;
  /** 鱼体力：1=精力充沛，0=力竭。与鱼线张力是两个独立系统。 */
  private fishStamina = 1;
  private fishPhase: FishPhase = 'resting';
  private actionTimer = 0;
  private pullGraceTimer = 0;   // pulling 刚开始的惩罚缓升期（秒）
  private fishPullDirWorld = new THREE.Vector3(1, 0, 0);
  private landingT = 0;         // landing 阶段的 0..1 归一化进度
  private _landingStart = new THREE.Vector3();
  private _landingPos   = new THREE.Vector3();

  /** 浮标绕船摆动的"家角度"（世界 XZ 平面），battle 期间浮标始终在此角度 ±maxDev 内 */
  private homeAngle = 0;
  /** resting 阶段最大摆角 —— 平时基本不动，只做微小漂移 */
  private readonly restingMaxAngleDev = Math.PI / 18;   // ±10°（14° → 10°，更含蓄）
  /** pulling 阶段最大摆角 —— 鱼明显往一侧拽，但幅度收敛，避免鱼竿+镜头狂甩 */
  private readonly pullingMaxAngleDev = Math.PI / 9;    // ±20°（36° → 20°，鱼竿晃动明显减小）

  /** 当次挣扎鱼往哪边拽（-1 = 屏幕左，+1 = 屏幕右），warning→pulling 时定 */
  private pullSideDir: -1 | 1 = 1;
  /** 当次挣扎实际用的角度偏移（sign * amplitude * pullingMaxAngleDev） */
  private currentPullDev = 0;

  /** 钓鱼点圆心（世界 XZ），浮标必须待在这个圆内，越界会被 clamp 回来 */
  private spotCenter = new THREE.Vector2(0, 0);
  private spotRadius = 7.5;

  // 输入：鼠标键 + 鼠标横向移动（对抗判定用）
  private lmbHeld = false;   // 保留但收线改成靠 click，不靠 hold
  private mmbHeld = false;   // 对抗拉力
  /** 累计鼠标 X 位移（自上帧起），tick 里读完清零 */
  private frameMouseDX = 0;
  /** 平滑后的鼠标横向"推力"方向（-1..+1），+1 = 玩家在往右拉 */
  private counterInputX = 0;
  /** LMB 点击队列 —— 每次 mousedown +1，updateFighting 里消费 */
  private pendingReelClicks = 0;

  /** 每次点击 LMB 收线距离（米）—— 需要玩家高频点击才能明显收线 */
  private readonly reelPerClick = 0.32;
  /** 每次点击 LMB 张力增量 */
  private readonly reelTensionPerClick = 0.028;
  /** 休息期每次有效收线消耗的鱼体力。 */
  private readonly reelStaminaDrainPerClick = 0.00598;
  /** 正确反向对抗每秒最多消耗的鱼体力；约需 3~4 轮挣扎才能耗尽。 */
  private readonly counterStaminaDrainRate = 0.1645;

  private resolve: ((r: FishingResult) => void) | null = null;

  constructor(hudRoot: HTMLElement) {
    this.hud = {
      root:        hudRoot,
      hint:        hudRoot.querySelector('.fg-hud-hint')       as HTMLElement,
      btnReel:     hudRoot.querySelector('.fg-hud-btn-reel')    as HTMLElement,
      btnCounter:  hudRoot.querySelector('.fg-hud-btn-counter') as HTMLElement,
      btnCancel:   hudRoot.querySelector('.fg-hud-btn-cancel')  as HTMLElement,
      staminaDial:   hudRoot.querySelector('.fg-hud-stamina-dial') as HTMLElement,
      tensionMarker: hudRoot.querySelector('.fg-hud-tension-marker') as HTMLElement,
      result:      hudRoot.querySelector('.fg-hud-result')     as HTMLElement,
      resultTitle: hudRoot.querySelector('.fg-hud-result-title') as HTMLElement,
      resultSub:   hudRoot.querySelector('.fg-hud-result-sub')   as HTMLElement,
    };
    this.attachInput();
  }

  isActive() { return this.state !== 'idle'; }

  start(
    spotWorld: THREE.Vector3,
    boatWorld: THREE.Vector3,
    preset: FishParams,
    rod: FishingRod,
    /** 钓鱼点的水面圆心 + 半径（世界 XZ）；如果给了，浮标 XZ 会被硬性限制在这个圆内 */
    spotBounds?: { center: THREE.Vector3; radius: number },
    /**
     * 钩子加成（可选）—— 抛竿落点附近有涟漪/气泡/漂流瓶/鲨鱼鳍时传入
     * · biteWaitMult：咬钩等待时间乘数，<1 表示更快咬钩（0.4 = 咬钩快 2.5x）
     */
    hookBonus?: { biteWaitMult?: number },
  ): Promise<FishingResult> {
    if (this.state !== 'idle') return Promise.resolve({ success: false, reason: 'quit' });
    this.params = preset;
    this.rod = rod;
    this.biteWaitMult = Math.max(0.1, hookBonus?.biteWaitMult ?? 1.0);
    this.target.copy(spotWorld);
    this.boatPos.copy(boatWorld);
    this.lineLen = preset.initialLine;
    this.tension = 0;
    this.fishStamina = 1;
    this.fishPhase = 'resting';
    this.lmbHeld = false;
    this.mmbHeld = false;
    this.frameMouseDX = 0;
    this.counterInputX = 0;
    this.pendingReelClicks = 0;
    this.currentPullDev = 0;

    // 钓鱼点圆盘边界 —— 用于每帧夹紧浮标 XZ
    if (spotBounds) {
      this.spotCenter.set(spotBounds.center.x, spotBounds.center.z);
      this.spotRadius = Math.max(0.5, spotBounds.radius);
    } else {
      // 兼容旧调用：没给的话用一个非常大的圆等于不夹
      this.spotCenter.set(spotWorld.x, spotWorld.z);
      this.spotRadius = 1e6;
    }

    this.state = 'casting';
    this.castT = 0;
    rod.setVisible(true);
    rod.setBobberSink(0);
    rod.setRodBend(0);
    rod.setLineTension(0);

    // 记录浮标相对船的"家角度"：battle 阶段所有浮标位置都会被限制在此角度 ±maxAngleDev
    this.homeAngle = Math.atan2(spotWorld.z - boatWorld.z, spotWorld.x - boatWorld.x);

    this.showHud(true);
    this.setHint('抛竿…');
    this.setButtonsMode('none');
    this.updateFishStaminaBar();
    this.hideResult();

    return new Promise<FishingResult>((r) => (this.resolve = r));
  }

  quit() {
    if (this.state === 'idle') return;
    this.finish({ success: false, reason: 'quit' }, '收竿', '');
  }

  update(dt: number, waveHeightAt: (x: number, z: number) => number, boatWorld: THREE.Vector3) {
    if (!this.rod) return;
    if (this.state === 'idle') return;
    this.boatPos.copy(boatWorld);

    switch (this.state) {
      case 'casting': this.updateCasting(dt); break;
      case 'waiting': this.updateWaiting(dt); break;
      case 'bite':    this.updateBite(dt);    break;
      case 'fighting':this.updateFighting(dt); break;
      case 'landing': this.updateLanding(dt); break;
      case 'result':  break;
    }

    if (this.state !== 'casting') {
      this.rod.update(dt, waveHeightAt);
    }
  }

  /* ─── 各状态 ─── */

  private updateCasting(dt: number) {
    this.castT += dt / this.castDuration;
    const t = smoothstep01(this.castT);
    this.rod!.updateCast(this.target, t);
    if (this.castT >= 1) {
      this.state = 'waiting';
      this.rod!.setBobberXZ(this.target.x, this.target.z);
      this.rod!.setBobberSink(0);
      // 钩子加成 —— biteWaitMult<1 让咬钩更快
      this.waitTimer = randRange(this.params.biteWait) * this.biteWaitMult;
      this.setHint('等咬钩…');
    }
  }

  private updateWaiting(dt: number) {
    this.waitTimer -= dt;
    if (this.waitTimer <= 0) {
      this.state = 'bite';
      this.biteTimer = this.biteWindow;
      this.rod!.setBobberSink(0.35);
      this.rod!.setRodBend(0.35, this._vecToBoatFromBobber());
      this.rod!.setLineTension(0.3);
      this.setHint('<b>咬钩了！</b> 按住 <span class="fg-key">鼠标左键</span> 提竿');
      this.pulseHint();
    }
  }

  private updateBite(dt: number) {
    this.biteTimer -= dt;
    if (this.lmbHeld) {
      this.state = 'fighting';
      this.rod!.setBobberSink(0);
      this.fishPhase = 'resting';
      // 刚进战斗先给一段较长的安全收线期，让玩家熟悉按键
      this.actionTimer = rand(3.0, 4.5);
      this.pullGraceTimer = 0;
      this.setButtonsMode('resting');
      this.setHint('连续点击 <span class="fg-key">鼠标左键</span> 收线');
      return;
    }
    if (this.biteTimer <= 0) {
      this.rod!.setBobberSink(0);
      this.rod!.setRodBend(0);
      this.rod!.setLineTension(0);
      this.finish({ success: false, reason: 'lost' }, '鱼跑了', '反应太慢，下次要快点');
    } else {
      const wobble = 0.35 + Math.sin(this.biteTimer * 40) * 0.12;
      this.rod!.setBobberSink(wobble);
    }
  }

  private updateFighting(dt: number) {
    const p = this.params;

    /* ── 处理鼠标横向输入 —— 平滑成 -1..+1 的"当前推力" ──
     * frameMouseDX 是本帧累积的 movementX（像素），换算到 500 px/s = ±1 的量纲，
     * 再和上帧的 counterInputX 做一阶低通（响应快，松开手也很快归零）
     */
    if (dt > 0) {
      const rawPushX = Math.max(-1.4, Math.min(1.4, (this.frameMouseDX / dt) / 500));
      // 无输入时衰减更快，让"松手"更快复零
      const smoothA = Math.abs(rawPushX) > 0.01 ? 0.45 : 0.22;
      this.counterInputX = this.counterInputX + (rawPushX - this.counterInputX) * smoothA;
    }
    this.frameMouseDX = 0;

    if (this.fishPhase === 'resting') {
      // ── 安全阶段：点击左键收线（不再是按住）──
      if (this.pendingReelClicks > 0) {
        const n = this.pendingReelClicks;
        this.pendingReelClicks = 0;
        this.lineLen  -= this.reelPerClick * n;
        this.tension  += this.reelTensionPerClick * n;
        this.fishStamina -= this.reelStaminaDrainPerClick * n;
      }
      // 没点击 → 张力自然回落
      this.tension -= p.restTensionDrop * dt;
    } else if (this.fishPhase === 'warning') {
      // ── 预警阶段：鱼要发力了，但还没开始惩罚 —— 给玩家切到 MMB 的时间 ──
      this.tension -= p.restTensionDrop * 0.4 * dt;
      // 轻微竿弯 + 线微黄，提示"要来了"
      this.rod!.setRodBend(0.35, this.fishPullDirWorld);
      this.rod!.setLineTension(0.25);
      // 挣扎阶段前的 pendingReelClicks 收线也生效（玩家想在 warning 里挤一点收线可以）
      if (this.pendingReelClicks > 0) {
        const n = this.pendingReelClicks;
        this.pendingReelClicks = 0;
        this.lineLen  -= this.reelPerClick * 0.6 * n;   // 效率打折
        this.tension  += this.reelTensionPerClick * 1.2 * n;
        this.fishStamina -= this.reelStaminaDrainPerClick * 0.5 * n;
      }
    } else {
      // ── 挣扎阶段：必须"按住 MMB + 鼠标往鱼拉的反方向拉"才顶得住 ──
      const grace = p.pullGrace ?? 0;
      const graceMul = grace > 0 && this.pullGraceTimer > 0
        ? 0.25 + 0.75 * (1 - this.pullGraceTimer / grace)
        : 1.0;
      if (this.pullGraceTimer > 0) this.pullGraceTimer -= dt;

      // 玩家应该往"鱼拉方向的反侧"推鼠标：
      //   fish 往右拽（pullSideDir=+1）→ 玩家鼠标要 dx<0（往左）
      //   所以对齐得分 = -pullSideDir * counterInputX，>0 = 反向对抗，<0 = 顺鱼力（更糟）
      const align = -this.pullSideDir * this.counterInputX;

      if (this.mmbHeld) {
        if (align > 0.15) {
          // 反向对抗成功 —— 张力小幅涨，越用力对抗涨得越少（甚至可以微降）
          const effect = Math.min(1, align / 0.9);   // 0..1
          this.tension += p.counterTensionRate * (1 - effect * 0.85) * graceMul * dt;
          // 强对抗时还能小幅收线（象征"稳住 + 让鱼疲惫"）
          if (effect > 0.55) {
            this.lineLen -= 0.35 * effect * dt;
            // 只有“按住中键 + 朝鱼拉力反方向移动”才会显著消耗体力。
            // medium 鱼体型更大，体力消耗效率降低约 18%。
            const fishSizeMul = p.initialLine >= 20 ? 0.82 : 1;
            this.fishStamina -= this.counterStaminaDrainRate * effect * fishSizeMul * dt;
          }
        } else if (align < -0.15) {
          // 顺着鱼的方向推鼠标 —— 惩罚翻倍
          this.tension += p.counterTensionRate * 2.6 * graceMul * dt;
          this.lineLen += p.fishStripRate * 0.55 * graceMul * dt;
        } else {
          // 只按住中键不动手 —— 基础张力持续涨，不再是"顶住 = 万事大吉"
          this.tension += p.counterTensionRate * 1.7 * graceMul * dt;
          this.lineLen += p.fishStripRate * 0.15 * graceMul * dt;
        }
      } else {
        // MMB 完全没按 —— 满 penalty
        this.tension += p.exposedTensionRate * graceMul * dt;
        this.lineLen += p.fishStripRate * graceMul * dt;
      }

      // pulling 阶段点击左键（挣扎中还想收线）—— 极低效率，代价重
      if (this.pendingReelClicks > 0) {
        const n = this.pendingReelClicks;
        this.pendingReelClicks = 0;
        this.lineLen -= this.reelPerClick * p.reelDuringPullPenalty * n;
        this.tension += this.reelTensionPerClick * 3.0 * n;
      }
    }
    this.tension = Math.max(0, this.tension);
    this.fishStamina = clamp01(this.fishStamina);
    this.lineLen = Math.max(0, this.lineLen);

    // 鱼状态机：resting → warning → pulling → resting …
    this.actionTimer -= dt;
    if (this.fishPhase === 'resting') {
      if (this.actionTimer <= 0) {
        this.fishPhase = 'warning';
        const warn = p.pullWarning ?? [1.0, 1.4];
        this.actionTimer = randRange(warn);
        // 决定鱼往屏幕哪边拽 + 拽多远（0.55~1.0 幅度）
        // 用相机 forward × world-up 的叉积拿"屏幕右方"的世界方向，
        // 再和 homeAngle 比较：如果相机右方与 homeAngle+90° 同向 → +1 = 屏幕右；否则反过来
        this.pullSideDir = Math.random() < 0.5 ? -1 : 1;
        const amp = 0.55 + Math.random() * 0.45;
        this.currentPullDev = this.pullSideDir * this.pullingMaxAngleDev * amp;
        // homeAngle 视角约等于相机方向，所以 homeAngle + dev 的世界角度 = 屏幕左/右
        // 但如果视角反了，需要按 camera-right 校正符号
        const cameraSideSign = this.computeCameraSideSign();
        const worldDev = this.currentPullDev * cameraSideSign;
        const a = this.homeAngle + worldDev;
        this.fishPullDirWorld.set(Math.cos(a), 0, Math.sin(a));
        this.setButtonsMode('pulling');
        const sideText = this.pullSideDir < 0 ? '往左' : '往右';
        const counterText = this.pullSideDir < 0 ? '向右' : '向左';
        this.setHint(`鱼要${sideText}拽了… 按住 <span class="fg-key">鼠标中键</span> + 鼠标${counterText}拉`);
        this.pulseHint();
      }
    } else if (this.fishPhase === 'warning') {
      if (this.actionTimer <= 0) {
        this.fishPhase = 'pulling';
        this.actionTimer = randRange(p.pullPeriod);
        this.pullGraceTimer = p.pullGrace ?? 0;
        this.rod!.setRodBend(0.95, this.fishPullDirWorld);
        const sideText = this.pullSideDir < 0 ? '往左' : '往右';
        const counterText = this.pullSideDir < 0 ? '向右' : '向左';
        this.setHint(`<b>鱼在${sideText}用力拽！</b> <span class="fg-key">鼠标中键</span> + 鼠标${counterText}拉 顶住`);
        this.pulseHint();
      }
    } else {
      if (this.actionTimer <= 0) {
        this.fishPhase = 'resting';
        this.actionTimer = randRange(p.restPeriod);
        this.pullGraceTimer = 0;
        this.rod!.setRodBend(0.15);
        this.setButtonsMode('resting');
        this.setHint('连续点击 <span class="fg-key">鼠标左键</span> 收线');
      } else if (this.mmbHeld) {
        this.rod!.setRodBend(0.7, this.fishPullDirWorld);
      } else {
        this.rod!.setRodBend(0.95, this.fishPullDirWorld);
      }
    }

    // 浮标 XZ —— 始终位于以船为圆心、半径 lineLen 的圆上
    const dx = this.rod!.bobber.position.x - this.boatPos.x;
    const dz = this.rod!.bobber.position.z - this.boatPos.z;
    let angle = Math.atan2(dz, dx);
    // pulling 阶段：浮标飘向 fishPullDirWorld —— 漂移速度 0.9 rad/s（原 1.4）
    // 慢一点让画面更平稳，配合更小的最大摆角，鱼竿/镜头晃动幅度显著减小
    if (this.fishPhase === 'pulling') {
      const fishA = Math.atan2(this.fishPullDirWorld.z, this.fishPullDirWorld.x);
      let delta = fishA - angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      angle += Math.sign(delta) * Math.min(Math.abs(delta), 0.9 * dt);
    } else if (this.fishPhase === 'resting') {
      // resting 阶段慢慢往 homeAngle 回中
      let delta = this.homeAngle - angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      angle += Math.sign(delta) * Math.min(Math.abs(delta), 0.4 * dt);
    }
    // Clamp：不同阶段用不同最大摆角 —— resting 微幅漂移，pulling 明显甩向一侧
    const maxDev = this.fishPhase === 'pulling' ? this.pullingMaxAngleDev : this.restingMaxAngleDev;
    let angleFromHome = angle - this.homeAngle;
    while (angleFromHome > Math.PI) angleFromHome -= Math.PI * 2;
    while (angleFromHome < -Math.PI) angleFromHome += Math.PI * 2;
    angleFromHome = Math.max(-maxDev, Math.min(maxDev, angleFromHome));
    angle = this.homeAngle + angleFromHome;
    let bx = this.boatPos.x + Math.cos(angle) * this.lineLen;
    let bz = this.boatPos.z + Math.sin(angle) * this.lineLen;
    // Clamp XZ 到钓鱼点圆盘内 —— 硬性限制"鱼钩不出蓝圈"
    const ddx = bx - this.spotCenter.x;
    const ddz = bz - this.spotCenter.y;
    const dd2 = ddx * ddx + ddz * ddz;
    const r2 = this.spotRadius * this.spotRadius;
    if (dd2 > r2) {
      const s = this.spotRadius / Math.sqrt(dd2);
      bx = this.spotCenter.x + ddx * s;
      bz = this.spotCenter.y + ddz * s;
    }
    this.rod!.setBobberXZ(bx, bz);

    // UI 反馈
    this.updateFishStaminaBar();
    this.rod!.setLineTension(this.tension);
    this.updateButtonUrgency();

    // 结束判定
    if (this.tension >= 1) {
      this.rod!.setRodBend(0);
      this.finish({ success: false, reason: 'break' }, '线断了！', '张力持续拉满会崩线');
      return;
    }
    // 鱼体力耗尽才允许起鱼。体力主要通过正确的左右反向对抗消耗，
    // 当前数值约需 3~4 轮挣扎；lineLen 只负责浮标距离和收线表现，不再冒充体力。
    if (this.fishStamina <= 0.01) {
      this.state = 'landing';
      this.actionTimer = 1.2;                    // 从 0.5s 延长到 1.2s，给玩家"起竿"的画面时间
      this.landingT = 0;
      this.rod!.setLineTension(0);
      this.setButtonsMode('none');
      this.setHint('<b>上钩了！</b>');
      this.pulseHint();
      // 记录浮标此刻的世界位置，作为起竿动画的起点
      this._landingStart.copy(this.rod!.bobber.position);
    }
  }

  private updateLanding(dt: number) {
    this.landingT += dt / 1.2;
    // 起竿动画：鱼竿使劲往上一抬，浮标从水里"飞"到竿尖附近
    const t = smoothstep01(Math.min(1, this.landingT));
    // 竿弯到 max，方向朝相机后方（等于把鱼往身前拉）—— 视觉是"举竿"
    this.rod!.setRodBend(0.85 + t * 0.15, this._vecToBoatFromBobber().multiplyScalar(-1));
    // 浮标飞向竿尖：t=0 时在原位，t=1 时接近竿尖 30%（XZ）/ 60%（Y）
    const tip = this.rod!.getRodTipWorld();
    const sx = this._landingStart.x;
    const sy = this._landingStart.y;
    const sz = this._landingStart.z;
    this._landingPos.set(
      sx + (tip.x - sx) * t * 0.3,
      sy + (tip.y - sy) * t * 0.6,
      sz + (tip.z - sz) * t * 0.3,
    );
    this.rod!.setBobberOverride(this._landingPos);
    this.actionTimer -= dt;
    if (this.actionTimer <= 0) {
      this.rod!.setBobberOverride(null);
      this.finish(
        { success: true, fish: this.params.name },
        `🎣 钓上 <b>${this.params.name}</b>`,
        '已放入鱼篓（阶段 3 接入背包）',
      );
    }
  }

  /* ─── HUD & 结束 ─── */

  private finish(r: FishingResult, title: string, sub: string) {
    this.state = 'result';
    this.rod?.setRodBend(0);
    this.rod?.setBobberSink(0);
    this.rod?.setLineTension(0);
    this.hud.resultTitle.innerHTML = title;     // 允许 title 里带 <b> 强调
    this.hud.resultSub.textContent = sub;
    this.hud.result.classList.add('visible');
    this.hud.result.classList.toggle('success', r.success);
    this.hud.result.classList.toggle('fail', !r.success);
    // 成功要给更长的展示时间，让玩家看清"钓到什么鱼"；失败短一点直接进下一轮
    const displayMs = r.success ? 2800 : 1600;
    setTimeout(() => {
      this.hud.result.classList.remove('visible', 'success', 'fail');
      this.rod?.setVisible(false);
      this.showHud(false);
      this.state = 'idle';
      const res = this.resolve; this.resolve = null;
      if (res) res(r);
    }, displayMs);
  }

  private setHint(html: string) {
    this.hud.hint.innerHTML = html;
  }

  private pulseHint() {
    this.hud.hint.classList.remove('pulse');
    void this.hud.hint.offsetWidth;
    this.hud.hint.classList.add('pulse');
  }

  private showHud(v: boolean) {
    this.hud.root.classList.toggle('visible', v);
  }
  private hideResult() {
    this.hud.result.classList.remove('visible', 'success', 'fail');
  }

  /** 常驻三按钮：根据当前阶段决定哪个按钮"有效"（高亮），哪个变暗 */
  private setButtonsMode(mode: 'none' | 'resting' | 'pulling') {
    this.hud.btnReel.classList.toggle('active', mode === 'resting');
    this.hud.btnReel.classList.toggle('dim', mode === 'pulling');
    this.hud.btnCounter.classList.toggle('active', mode === 'pulling');
    this.hud.btnCounter.classList.toggle('dim', mode === 'resting');
    this.hud.btnCancel.classList.remove('active', 'dim');
  }

  /** pulling 阶段如果玩家迟迟不按 MMB，让"对抗拉力"按钮闪烁提醒 */
  private updateButtonUrgency() {
    const urgent = (this.fishPhase === 'warning' || this.fishPhase === 'pulling') && !this.mmbHeld;
    this.hud.btnCounter.classList.toggle('urgent', urgent);
  }

  private updateFishStaminaBar() {
    const stamina = clamp01(this.fishStamina);
    const tension = clamp01(this.tension);

    // ── 左圆圈：鱼体力表盘 ──
    // 通过 CSS var 驱动 conic-gradient 的填充角度；stamina=1 → 整圈绿，stamina=0 → 全暗。
    this.hud.staminaDial.style.setProperty('--stamina', stamina.toFixed(3));

    // ── 右长条：鱼线张力游标 ──
    // 长条背景是静态"左绿→右红"渐变，游标随 tension 从 0% 移到 100%。
    // 与 CSS 里的分段（0~42% 绿 / 42~72% 黄 / 72~100% 红）对齐，游标颜色跟着变。
    this.hud.tensionMarker.style.left = (tension * 100).toFixed(1) + '%';
    if (tension < 0.42) this.hud.tensionMarker.style.background = '#6b9c5c';       // 绿区
    else if (tension < 0.72) this.hud.tensionMarker.style.background = '#c48a2f';  // 黄区
    else this.hud.tensionMarker.style.background = '#a83a2f';                      // 红区
  }

  private _vecToBoatFromBobber(): THREE.Vector3 {
    const v = new THREE.Vector3(
      this.boatPos.x - this.target.x,
      0,
      this.boatPos.z - this.target.z,
    );
    if (v.lengthSq() < 1e-6) v.set(0, 0, -1);
    return v;
  }

  /**
   * 计算 pullSideDir=+1（屏幕右）在世界 XZ 里对应 homeAngle 的哪一侧（+1 or -1）。
   *
   * 原理：屏幕"右"方向的世界向量 = camera.forward × world_up（右手坐标）；
   * 把它跟 homeAngle+90° 方向做点积：如果点积 >0，说明 (homeAngle + +90°) 就是屏幕右，
   * 于是 pullSideDir=+1（屏幕右）→ 世界角度 = homeAngle + +currentPullDev，符号系数 = +1；
   * 反之翻个符号。
   */
  private computeCameraSideSign(): number {
    if (!this.rod) return 1;
    const cam = this.rod.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    // camera right = fwd × up；y 分量丢弃拿 XZ
    const rightX = fwd.z;
    const rightZ = -fwd.x;
    // homeAngle+90° 方向（左手 XZ 平面里 "+90°" 对应角度 +π/2）
    const perpX = Math.cos(this.homeAngle + Math.PI / 2);
    const perpZ = Math.sin(this.homeAngle + Math.PI / 2);
    // 点积
    const dot = rightX * perpX + rightZ * perpZ;
    return dot >= 0 ? 1 : -1;
  }

  /* ─── 输入：鼠标键 + 鼠标移动 ─── */

  private attachInput() {
    window.addEventListener('mousedown', (e) => {
      if (!this.isActive()) return;
      if (e.button === 0) {
        this.lmbHeld = true;
        // fighting 阶段：每次 LMB 点击 = 一次"收线"操作（updateFighting 里消费）
        if (this.state === 'fighting') this.pendingReelClicks += 1;
        // bite 阶段：LMB 点击就直接进战斗（不需要等到 hold 判定）
        // 提竿的边缘触发在 updateBite 里由 lmbHeld 也能命中，这里额外挂个 flag 保证极短点击也算
      } else if (e.button === 1) { e.preventDefault(); this.mmbHeld = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmbHeld = false;
      else if (e.button === 1) this.mmbHeld = false;
    });
    // 鼠标横向移动 —— 用来判断玩家是否在反向对抗
    window.addEventListener('mousemove', (e) => {
      if (!this.isActive()) return;
      this.frameMouseDX += e.movementX ?? 0;
    });
    // 中键有些浏览器会触发"自动滚动"手势，钓鱼期间要拦掉
    window.addEventListener('auxclick', (e) => {
      if (this.isActive() && e.button === 1) e.preventDefault();
    });
    // Esc / RMB 弃竿（对应参考视频里的"取消，鱼饵会丢失"）
    window.addEventListener('keydown', (e) => {
      if (!this.isActive()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.quit();
      }
    }, true);
    window.addEventListener('contextmenu', (e) => {
      if (!this.isActive()) return;
      e.preventDefault();
      this.quit();
    });
  }
}
