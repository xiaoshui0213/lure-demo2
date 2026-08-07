/**
 * HubState —— 当前游戏所处的大模式
 */

export type HubMode = 'port_hub' | 'world_map' | 'expedition' | 'play';

class HubStateManager {
  private mode: HubMode = 'port_hub';
  private listeners = new Set<(m: HubMode) => void>();

  getMode(): HubMode { return this.mode; }

  setMode(m: HubMode) {
    if (this.mode === m) return;
    this.mode = m;
    for (const fn of this.listeners) fn(m);
  }

  subscribe(fn: (m: HubMode) => void): () => void {
    this.listeners.add(fn);
    fn(this.mode);
    return () => this.listeners.delete(fn);
  }
}

export const hubState = new HubStateManager();
