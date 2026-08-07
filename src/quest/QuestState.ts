/**
 * QuestState —— 委托任务进度（localStorage 持久化）
 *
 * MVP：仅「浮木商会 · 沉船探险」一条线。
 */

export type QuestStatus = 'available' | 'active' | 'completed';

export interface QuestDef {
  id: string;
  title: string;
  subtitle: string;
  faction: 'merchant';
  factionName: string;
  factionIcon: string;
  objective: string;
  hint: string;
}

export const QUEST_DEFS: Record<string, QuestDef> = {
  merchant_wreck: {
    id: 'merchant_wreck',
    title: '沉船货运',
    subtitle: '海上打捞 · 定点交付',
    faction: 'merchant',
    factionName: '浮木商会',
    factionIcon: '🪵',
    objective: '前往浅水湾寻找漂流瓶',
    hint: '出海后打开航海地图，进入「浅水湾」海域寻找漂流瓶',
  },
};

const STORAGE_KEY = 'lure-quest-state-v1';

type StoredQuest = { status: QuestStatus };

class QuestStateManager {
  private quests = new Map<string, StoredQuest>();
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, StoredQuest>;
      for (const [id, q] of Object.entries(data)) {
        if (q?.status) this.quests.set(id, { status: q.status });
      }
    } catch { /* ignore */ }
  }

  private save() {
    try {
      const obj: Record<string, StoredQuest> = {};
      for (const [id, q] of this.quests) obj[id] = q;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus(id: string): QuestStatus {
    return this.quests.get(id)?.status ?? 'available';
  }

  isActive(id: string): boolean {
    return this.getStatus(id) === 'active';
  }

  isCompleted(id: string): boolean {
    return this.getStatus(id) === 'completed';
  }

  /** 是否满足节点 requiresQuest 条件 */
  meetsRequirement(id: string): boolean {
    const s = this.getStatus(id);
    return s === 'active' || s === 'completed';
  }

  acceptQuest(id: string): boolean {
    if (!QUEST_DEFS[id]) return false;
    if (this.getStatus(id) !== 'available') return false;
    this.quests.set(id, { status: 'active' });
    this.save();
    this.notify();
    return true;
  }

  completeQuest(id: string): boolean {
    if (this.getStatus(id) !== 'active') return false;
    this.quests.set(id, { status: 'completed' });
    this.save();
    this.notify();
    return true;
  }

  /** 当前进行中的委托 id（无则 null） */
  getActiveQuestId(): string | null {
    for (const id of Object.keys(QUEST_DEFS)) {
      if (this.isActive(id)) return id;
    }
    return null;
  }

  /** 重置所有任务（调试） */
  resetAll() {
    this.quests.clear();
    this.save();
    this.notify();
  }
}

export const questState = new QuestStateManager();
