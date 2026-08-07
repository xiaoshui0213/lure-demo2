import * as THREE from 'three';
import type { FishingZone } from './main';

/**
 * 海面钩子系统（slot 版）—— 涟漪 / 气泡 / 漂流瓶（鲨鱼鳍暂时禁用）
 *
 * 【设计原则】
 * 每个海域预先分配 N 个 **固定 slot 位置**（用 zone.id 做种子的确定性随机），
 * 每个 slot 有自己"偏好类型"—— 大部分是涟漪+气泡组合槽，1~3 个是漂流瓶槽。
 *
 * · 混合槽的涟漪和气泡是**同一个组合体、同时出现**（不是交替显示两种效果）
 * · slot 里的 hook 到期 → 消失（进入冷却）→ 冷却完再在 **同一位置** 重生
 * · 因此玩家看到的"这块海域的钓点"位置是稳定的，只是每个位置的效果在闪烁/呼吸
 * · 漂流瓶槽是完全静止的：不飘、不转，只轻轻上下浮
 *
 * 【接口】
 * · new HooksSystem(scene, zones) —— 构造时确定每个 zone 的所有 slot
 * · update(dt, boatPos) —— 每帧 tick 现有 hook + 补活到期的 slot
 * · getHookBonusAt(x,z) —— 抛竿时查 3.5m 内钩子加成
 * · consumeHookAt(x,z) —— 钓上后强制清掉最近钩子，slot 进入长冷却
 * · getMinimapMarkers() —— 只返回漂流瓶（涟漪/气泡太密不适合 minimap）
 */

// ─── 类型 ───

export type HookType = 'ripple' | 'bubble' | 'drift_bottle' | 'shark_fin';

export interface HookBonus {
  hookType: HookType;
  presetKey: string;
  biteSpeedMult: number;
}

export interface MinimapMarker {
  x: number;
  z: number;
  type: HookType;
}

interface Hook {
  type: HookType;
  x: number;
  z: number;
  object: THREE.Object3D;
  ttl: number;
  update?: (dt: number, hook: Hook) => void;
  dispose: () => void;
}

// ─── 每 tier 的 slot 分配 ───

interface TierSlotConfig {
  /** 涟漪 + 气泡组合槽个数（两种效果同时出现） */
  mixedSlots: number;
  /** 漂流瓶槽个数（位置固定，长寿命，稀有） */
  bottleSlots: number;
}

const TIER_SLOTS: Record<'common' | 'rare' | 'lair', TierSlotConfig> = {
  common: { mixedSlots: 5, bottleSlots: 1 },
  rare:   { mixedSlots: 6, bottleSlots: 2 },
  lair:   { mixedSlots: 8, bottleSlots: 3 },
};

// ─── 确定性 RNG（用 zone.id 做种子，每次加载海域 slot 位置一致） ───

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 钩子构造器 ───

/**
 * bubble cluster：更多、更大的气泡簇（作为组合体的一部分被 spawnRippleAndBubble 调用）
 * 返回的是"纯气泡"子对象 + tick，不单独当 Hook 用
 */
function buildBubbleCluster(): { object: THREE.Object3D; tick: (dt: number) => void; dispose: () => void } {
  const g = new THREE.Group();

  const bubbles: Array<{
    mesh: THREE.Mesh;
    startY: number;
    endY: number;
    delay: number;
    riseDur: number;
    popAt: number;
  }> = [];

  const N = 12 + Math.floor(Math.random() * 5);   // 12~16 个
  for (let i = 0; i < N; i++) {
    const r = 0.10 + Math.random() * 0.10;   // 0.10~0.20
    const bx = (Math.random() - 0.5) * 1.6;
    const bz = (Math.random() - 0.5) * 1.6;
    const startY = -0.7 - Math.random() * 0.5;
    const endY = 0.15;
    const delay = Math.random() * 1.8;
    const riseDur = 1.4 + Math.random() * 1.4;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshBasicMaterial({
        color: '#e8f6ff',
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    mesh.position.set(bx, startY, bz);
    mesh.visible = false;
    g.add(mesh);
    bubbles.push({ mesh, startY, endY, delay, riseDur, popAt: delay + riseDur });
  }

  let elapsed = 0;
  return {
    object: g,
    tick: (dt) => {
      elapsed += dt;
      for (const b of bubbles) {
        const t = (elapsed - b.delay) / b.riseDur;
        if (t < 0) { b.mesh.visible = false; continue; }
        if (t < 1) {
          b.mesh.visible = true;
          b.mesh.position.y = b.startY + (b.endY - b.startY) * t;
          (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t * 0.3);
        } else {
          const popT = Math.min(1, (elapsed - b.popAt) / 0.35);
          b.mesh.visible = popT < 1;
          const s = 1 + popT * 0.8;
          b.mesh.scale.setScalar(s);
          (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - popT);
        }
      }
    },
    dispose: () => {
      for (const b of bubbles) {
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    },
  };
}

/**
 * ripple + bubble 组合体 —— 涟漪和气泡**同时**出现在同一位置、同一生命周期，
 * 不是交替显示。这是"混合槽"唯一会生成的效果。
 */
function spawnRippleAndBubble(x: number, z: number): Hook {
  const RADIUS = 4.2;
  const LIFETIME = 5.5;

  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // ── 涟漪部分 ──
  const rippleMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: LIFETIME },
      uColor: { value: new THREE.Color('#eaf6ff') },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uLife;
      uniform vec3 uColor;
      varying vec2 vLocal;
      void main() {
        float t = clamp(uTime / uLife, 0.0, 1.0);
        float d = length(vLocal) / ${RADIUS.toFixed(3)};
        if (d > 1.0) discard;
        float acc = 0.0;
        for (int i = 0; i < 3; i++) {
          float phase = mod(t + float(i) * 0.30, 1.0);
          float ring = 1.0 - smoothstep(0.05, 0.11, abs(d - phase));
          float fade = 1.0 - phase * 0.7;
          acc += ring * fade * 0.95;
        }
        float lifeFade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.8, 1.0, t));
        gl_FragColor = vec4(uColor, min(1.0, acc) * lifeFade * 0.85);
      }
    `,
  });
  const rippleMesh = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48), rippleMat);
  rippleMesh.rotation.x = -Math.PI / 2;
  rippleMesh.position.y = 0.08;
  rippleMesh.renderOrder = 5;
  g.add(rippleMesh);

  // ── 气泡部分（同一 Group、同一生命周期） ──
  const bubbleCluster = buildBubbleCluster();
  g.add(bubbleCluster.object);

  return {
    type: 'bubble', x, z, object: g, ttl: LIFETIME,
    update: (dt) => {
      rippleMat.uniforms.uTime.value += dt;
      bubbleCluster.tick(dt);
    },
    dispose: () => {
      rippleMesh.geometry.dispose();
      rippleMat.dispose();
      bubbleCluster.dispose();
    },
  };
}

/**
 * drift bottle：完全静止（不飘、不转）—— 只做轻微 y 浮沉表示浮在水上
 */
function spawnDriftBottle(x: number, z: number): Hook {
  const LIFETIME = 60;   // 长寿命，几乎相当于固定物
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // 让 bottle 的 yaw 由 slot 位置决定（同一 slot 永远同一朝向）
  const yaw = (Math.sin(x * 0.31 + z * 0.17) * Math.PI);
  g.rotation.y = yaw;

  const glassMat = new THREE.MeshStandardMaterial({
    color: '#a3d0c8',
    transparent: true,
    opacity: 0.78,
    roughness: 0.32,
    metalness: 0.05,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 12), glassMat);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), glassMat);
  cap.position.x = 0.21;
  g.add(cap);
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.11, 8),
    new THREE.MeshStandardMaterial({ color: '#7a4a1c', roughness: 0.9 }),
  );
  cork.position.x = -0.21;
  cork.rotation.z = Math.PI / 2;
  g.add(cork);
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.20, 0.14),
    new THREE.MeshBasicMaterial({ color: '#f8e6a5', side: THREE.DoubleSide }),
  );
  paper.rotation.y = Math.PI / 2;
  g.add(paper);

  let elapsed = 0;
  return {
    type: 'drift_bottle', x, z, object: g, ttl: LIFETIME,
    update: (dt) => {
      elapsed += dt;
      // 只做轻微 y 浮沉 —— 不做 XZ 漂移、不做自转，位置绝对稳定
      g.position.y = 0.05 + Math.sin(elapsed * 1.6) * 0.03;
      body.rotation.x = Math.sin(elapsed * 1.0) * 0.08;
    },
    dispose: () => {
      body.geometry.dispose();
      cap.geometry.dispose();
      cork.geometry.dispose();
      paper.geometry.dispose();
      glassMat.dispose();
      (cork.material as THREE.Material).dispose();
      (paper.material as THREE.Material).dispose();
    },
  };
}

// ─── HooksSystem ───

/**
 * 单个"钓点槽"—— 位置固定，反复 spawn/despawn 同类型 hook
 */
interface HookSlot {
  x: number;
  z: number;
  /** 该 slot 会生成的类型；mixed 槽固定 ['bubble']（内部即涟漪+气泡组合体）；bottle 槽 = ['drift_bottle'] */
  types: HookType[];
  /** 当前 hook（null 表示 slot 空闲、正在冷却） */
  current: Hook | null;
  /** 距下次 spawn 的秒数（<=0 就 spawn） */
  cooldown: number;
  /** 上一次 spawn 用的 type index，用来交替 */
  lastTypeIdx: number;
}

interface ZoneHookState {
  zone: FishingZone;
  slots: HookSlot[];
}

export class HooksSystem {
  private zoneStates: ZoneHookState[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, zones: FishingZone[]) {
    this.scene = scene;
    for (const z of zones) {
      this.zoneStates.push({ zone: z, slots: this.makeSlots(z) });
    }
  }

  /** 用 zone.id 做种子确定性生成 slot 位置 —— 每次重启位置都一样 */
  private makeSlots(zone: FishingZone): HookSlot[] {
    const cfg = TIER_SLOTS[zone.tier];
    const rng = mulberry32(hashSeed(zone.id));
    const slots: HookSlot[] = [];

    // 用极坐标撒点 —— radius 分环，theta 分角度，避免挤成一堆
    const totalMixed = cfg.mixedSlots;
    for (let i = 0; i < totalMixed; i++) {
      // 环带 0.25..0.85 —— 不贴中心也不贴边
      const ringT = 0.28 + rng() * 0.6;
      // 角度均分 + 每 slot 抖 15°
      const baseAngle = (i / totalMixed) * Math.PI * 2;
      const angle = baseAngle + (rng() - 0.5) * 0.5;
      const r = ringT * zone.radius;
      const x = zone.x + Math.cos(angle) * r;
      const z = zone.z + Math.sin(angle) * r;
      slots.push({
        x, z,
        // 混合槽只有一种效果：涟漪 + 气泡组合体（同时出现，不交替）
        types: ['bubble'],
        current: null,
        cooldown: rng() * 3,           // 错开首次 spawn
        lastTypeIdx: -1,
      });
    }

    // 漂流瓶槽 —— 位置尽量远离 mixed 槽，用 golden angle
    for (let i = 0; i < cfg.bottleSlots; i++) {
      const angle = (i * 2.399) + rng() * 0.3;    // 137.5° 分布
      const r = zone.radius * (0.45 + rng() * 0.35);
      const x = zone.x + Math.cos(angle) * r;
      const z = zone.z + Math.sin(angle) * r;
      slots.push({
        x, z,
        types: ['drift_bottle'],
        current: null,
        cooldown: rng() * 4 + 1,
        lastTypeIdx: -1,
      });
    }
    return slots;
  }

  update(dt: number, boatPos: THREE.Vector3) {
    for (const st of this.zoneStates) {
      // LOD：船离 zone 边界 > 80m 就暂停 spawn（省 drawcall）
      const dx = boatPos.x - st.zone.x, dz = boatPos.z - st.zone.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const farAway = dist > st.zone.radius + 80;

      for (const slot of st.slots) {
        if (slot.current) {
          slot.current.ttl -= dt;
          if (slot.current.update) slot.current.update(dt, slot.current);
          if (slot.current.ttl <= 0) {
            this.disposeSlotHook(slot);
            // 混合槽冷却 0.8~1.6s；漂流瓶槽冷却 3~6s（保证一段时间"没瓶子"感受）
            slot.cooldown = slot.types[0] === 'drift_bottle' ? 3 + Math.random() * 3 : 0.8 + Math.random() * 0.8;
          }
        } else if (!farAway) {
          slot.cooldown -= dt;
          if (slot.cooldown <= 0) {
            const type = this.pickSlotType(slot);
            const hook = this.spawnByType(type, slot.x, slot.z);
            if (hook) {
              slot.current = hook;
              this.scene.add(hook.object);
            }
          }
        }
      }
    }
  }

  private pickSlotType(slot: HookSlot): HookType {
    if (slot.types.length === 1) return slot.types[0];
    // 交替（避免连续两次同类型）
    slot.lastTypeIdx = (slot.lastTypeIdx + 1) % slot.types.length;
    return slot.types[slot.lastTypeIdx];
  }

  private spawnByType(type: HookType, x: number, z: number): Hook | null {
    switch (type) {
      // 混合槽只会传 'bubble'（见 makeSlots）—— 组合体：涟漪 + 气泡同时出现
      case 'ripple':
      case 'bubble':       return spawnRippleAndBubble(x, z);
      case 'drift_bottle': return spawnDriftBottle(x, z);
      case 'shark_fin':    return null;   // 暂时禁用
    }
  }

  private disposeSlotHook(slot: HookSlot) {
    if (!slot.current) return;
    this.scene.remove(slot.current.object);
    slot.current.dispose();
    slot.current = null;
  }

  private forEachActiveHook(cb: (h: Hook, slot: HookSlot, state: ZoneHookState) => boolean | void) {
    for (const st of this.zoneStates) {
      for (const slot of st.slots) {
        if (!slot.current) continue;
        const stop = cb(slot.current, slot, st);
        if (stop) return;
      }
    }
  }

  /** 抛竿落点 3.5m 内查最强钩子（shark > bottle > bubble > ripple） */
  getHookBonusAt(x: number, z: number): HookBonus | null {
    const R2 = 3.5 * 3.5;
    let bestType: HookType | null = null;
    let bestScore = -1;
    const scoreOf = (t: HookType) => (
      t === 'shark_fin' ? 4 : t === 'drift_bottle' ? 3 : t === 'bubble' ? 2 : 1
    );
    this.forEachActiveHook((h) => {
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz > R2) return;
      const s = scoreOf(h.type);
      if (s > bestScore) { bestScore = s; bestType = h.type; }
    });
    if (!bestType) return null;
    switch (bestType) {
      case 'shark_fin':    return { hookType: 'shark_fin', presetKey: 'medium', biteSpeedMult: 0.4 };
      case 'drift_bottle': return { hookType: 'drift_bottle', presetKey: 'common', biteSpeedMult: 0.3 };
      case 'bubble':       return { hookType: 'bubble', presetKey: 'common', biteSpeedMult: 0.6 };
      case 'ripple':       return { hookType: 'ripple', presetKey: 'common', biteSpeedMult: 0.75 };
    }
  }

  /** 玩家钓上后清掉附近最强钩子，slot 进入长冷却（漂流瓶尤其重要，不能秒重生） */
  consumeHookAt(x: number, z: number) {
    const R2 = 3.5 * 3.5;
    // 找最强 slot
    let target: { slot: HookSlot; score: number } | null = null;
    const scoreOf = (t: HookType) => (
      t === 'shark_fin' ? 4 : t === 'drift_bottle' ? 3 : t === 'bubble' ? 2 : 1
    );
    this.forEachActiveHook((h, slot) => {
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz > R2) return;
      const s = scoreOf(h.type);
      if (!target || s > target.score) target = { slot, score: s };
    });
    if (!target) return;
    const t = target as { slot: HookSlot; score: number };
    this.disposeSlotHook(t.slot);
    // 漂流瓶被"薅"后：更长冷却（15~30s），玩家有明显"这个漂流瓶被我拿了"的反馈
    t.slot.cooldown = t.slot.types[0] === 'drift_bottle' ? 15 + Math.random() * 15 : 3 + Math.random() * 3;
  }

  /** minimap 上只显示漂流瓶（其他太密） */
  getMinimapMarkers(): MinimapMarker[] {
    const markers: MinimapMarker[] = [];
    this.forEachActiveHook((h) => {
      if (h.type === 'drift_bottle') markers.push({ x: h.x, z: h.z, type: h.type });
    });
    return markers;
  }
}
