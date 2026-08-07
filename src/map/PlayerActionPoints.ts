/**
 * PlayerActionPoints —— 玩家"行动点" (AP) 资源
 *
 * 模仿 PlayerResources 的模式：单例、localStorage 持久化、onChange 订阅。
 * 用途：航海地图上每次通行都要花掉 node.costAP。港口可以补满。
 *
 * MVP 阶段只需要：spend(n)、refill()、onChange。
 */

export type APChangeReason = 'spend' | 'refill' | 'init' | 'reset';

interface ChangeEvent {
  ap: number;
  apMax: number;
  reason: APChangeReason;
}

type Listener = (e: ChangeEvent) => void;

const STORAGE_KEY = 'lure-player-ap-v1';
const DEFAULT_AP = 8;
const DEFAULT_AP_MAX = 8;

class PlayerActionPointsImpl {
  ap: number = DEFAULT_AP;
  apMax: number = DEFAULT_AP_MAX;
  private listeners: Listener[] = [];

  constructor() {
    this.load();
  }

  has(n: number): boolean {
    return this.ap >= n;
  }

  /** 尝试消耗 n 点 AP —— 成功返回 true，不足返回 false（不改变数值） */
  spend(n: number): boolean {
    if (n <= 0) return true;
    if (this.ap < n) return false;
    this.ap -= n;
    this.save();
    this.emit('spend');
    return true;
  }

  /** 补满 —— 港口用 */
  refill() {
    if (this.ap >= this.apMax) return;
    this.ap = this.apMax;
    this.save();
    this.emit('refill');
  }

  setMax(newMax: number, alsoFill = false) {
    this.apMax = Math.max(1, Math.floor(newMax));
    if (alsoFill || this.ap > this.apMax) this.ap = this.apMax;
    this.save();
    this.emit('init');
  }

  reset() {
    this.ap = DEFAULT_AP;
    this.apMax = DEFAULT_AP_MAX;
    this.save();
    this.emit('reset');
  }

  onChange(cb: Listener): () => void {
    this.listeners.push(cb);
    cb({ ap: this.ap, apMax: this.apMax, reason: 'init' });
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(reason: APChangeReason) {
    const ev: ChangeEvent = { ap: this.ap, apMax: this.apMax, reason };
    for (const l of this.listeners) l(ev);
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ap: this.ap,
        apMax: this.apMax,
      }));
    } catch { /* ignore */ }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.ap === 'number') this.ap = Math.max(0, Math.floor(data.ap));
      if (typeof data.apMax === 'number') this.apMax = Math.max(1, Math.floor(data.apMax));
      if (this.ap > this.apMax) this.ap = this.apMax;
    } catch { /* ignore */ }
  }
}

/** 全局单例 */
export const playerActionPoints = new PlayerActionPointsImpl();
