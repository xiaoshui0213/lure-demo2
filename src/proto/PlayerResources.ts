/**
 * PlayerResources —— 玩家出海资源（当前只有鱼饵）
 *
 * 单例，跨场景/UI 共享；localStorage 自动持久化。
 * 变化通过 onChange 通知订阅者（BaitHUD / Minimap 都在监听）。
 */

export type ResourceChangeReason = 'consume' | 'refill' | 'init' | 'reset';

interface ChangeEvent {
  bait: number;
  baitMax: number;
  reason: ResourceChangeReason;
}

type Listener = (e: ChangeEvent) => void;

const STORAGE_KEY = 'lure-player-resources-v1';
const DEFAULT_BAIT = 20;
const DEFAULT_BAIT_MAX = 20;

class PlayerResourcesImpl {
  bait: number = DEFAULT_BAIT;
  baitMax: number = DEFAULT_BAIT_MAX;
  private listeners: Listener[] = [];

  constructor() {
    this.load();
  }

  isFull(): boolean {
    return this.bait >= this.baitMax;
  }

  /** 尝试消耗 1 个鱼饵 —— 成功返回 true，不足返回 false */
  consumeBait(): boolean {
    if (this.bait <= 0) return false;
    this.bait -= 1;
    this.save();
    this.emit('consume');
    return true;
  }

  /** 补满鱼饵 */
  refillBait() {
    if (this.bait >= this.baitMax) return;
    this.bait = this.baitMax;
    this.save();
    this.emit('refill');
  }

  /** 提升上限（后续商店升级用，MVP 用不上） */
  setBaitMax(newMax: number, alsoFill = false) {
    this.baitMax = Math.max(1, Math.floor(newMax));
    if (alsoFill || this.bait > this.baitMax) this.bait = this.baitMax;
    this.save();
    this.emit('init');
  }

  reset() {
    this.bait = DEFAULT_BAIT;
    this.baitMax = DEFAULT_BAIT_MAX;
    this.save();
    this.emit('reset');
  }

  onChange(cb: Listener): () => void {
    this.listeners.push(cb);
    // 立即触发一次，方便订阅者初始化 UI
    cb({ bait: this.bait, baitMax: this.baitMax, reason: 'init' });
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(reason: ResourceChangeReason) {
    const ev: ChangeEvent = { bait: this.bait, baitMax: this.baitMax, reason };
    for (const l of this.listeners) l(ev);
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bait: this.bait,
        baitMax: this.baitMax,
      }));
    } catch { /* localStorage 不可用就不存 */ }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bait === 'number') this.bait = Math.max(0, Math.floor(data.bait));
      if (typeof data.baitMax === 'number') this.baitMax = Math.max(1, Math.floor(data.baitMax));
      if (this.bait > this.baitMax) this.bait = this.baitMax;
    } catch { /* 忽略 */ }
  }
}

/** 全局单例 */
export const playerResources = new PlayerResourcesImpl();
