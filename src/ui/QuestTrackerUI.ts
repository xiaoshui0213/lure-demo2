/**
 * QuestTrackerUI —— 右上角常驻任务条，点击展开详情
 */

import { questState, QUEST_DEFS, type QuestDef } from '../quest/QuestState';

export class QuestTrackerUI {
  private root: HTMLElement;
  private pillEl: HTMLElement;
  private panelEl: HTMLElement;
  private unsub: () => void;
  private panelOpen = false;

  constructor(container: HTMLElement) {
    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'quest-tracker';
    this.root.innerHTML = `
      <button class="quest-tracker-pill" type="button" title="点击查看任务详情">
        <span class="quest-tracker-icon"></span>
        <span class="quest-tracker-label"></span>
        <span class="quest-tracker-chevron">▾</span>
      </button>
      <div class="quest-tracker-panel">
        <div class="quest-tracker-panel-head">
          <span class="quest-tracker-panel-title"></span>
          <button class="quest-tracker-close" type="button">✕</button>
        </div>
        <div class="quest-tracker-panel-sub"></div>
        <div class="quest-tracker-panel-objective"></div>
        <div class="quest-tracker-panel-hint"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.pillEl = this.root.querySelector('.quest-tracker-pill')!;
    this.panelEl = this.root.querySelector('.quest-tracker-panel')!;

    this.pillEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePanel();
    });
    this.root.querySelector('.quest-tracker-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePanel();
    });
    document.addEventListener('mousedown', this.onDocClick);

    this.unsub = questState.subscribe(() => this.refresh());
    this.refresh();
  }

  private getActiveQuest(): QuestDef | null {
    for (const q of Object.values(QUEST_DEFS)) {
      if (questState.isActive(q.id)) return q;
    }
    return null;
  }

  private refresh() {
    const q = this.getActiveQuest();
    if (!q) {
      this.root.classList.remove('visible');
      this.closePanel();
      document.getElementById('stage')?.classList.remove('has-quest-tracker');
      return;
    }

    this.root.classList.add('visible');
    document.getElementById('stage')?.classList.add('has-quest-tracker');

    this.root.querySelector('.quest-tracker-icon')!.textContent = q.factionIcon;
    this.root.querySelector('.quest-tracker-label')!.textContent =
      `${q.title} · ${q.objective}`;

    this.root.querySelector('.quest-tracker-panel-title')!.textContent =
      `${q.factionIcon} ${q.factionName} · ${q.title}`;
    this.root.querySelector('.quest-tracker-panel-sub')!.textContent = q.subtitle;
    this.root.querySelector('.quest-tracker-panel-objective')!.textContent = `目标：${q.objective}`;
    this.root.querySelector('.quest-tracker-panel-hint')!.textContent = `提示：${q.hint}`;
  }

  private togglePanel() {
    if (this.panelOpen) this.closePanel();
    else this.openPanel();
  }

  private openPanel() {
    this.panelOpen = true;
    this.panelEl.classList.add('open');
    this.pillEl.classList.add('open');
  }

  private closePanel() {
    this.panelOpen = false;
    this.panelEl.classList.remove('open');
    this.pillEl.classList.remove('open');
  }

  private onDocClick = (e: MouseEvent) => {
    if (!this.panelOpen) return;
    if (this.root.contains(e.target as Node)) return;
    this.closePanel();
  };

  dispose() {
    this.unsub();
    document.removeEventListener('mousedown', this.onDocClick);
    this.root.remove();
    document.getElementById('stage')?.classList.remove('has-quest-tracker');
  }

  private injectStyle() {
    if (document.getElementById('quest-tracker-style')) return;
    const s = document.createElement('style');
    s.id = 'quest-tracker-style';
    s.textContent = `
#quest-tracker {
  position: absolute;
  top: 16px; right: 16px;
  z-index: 370;
  display: none;
  font-family: -apple-system, "Segoe UI", sans-serif;
  pointer-events: none;
}
#quest-tracker.visible { display: block; }

#quest-tracker .quest-tracker-pill {
  pointer-events: auto;
  display: flex; align-items: center; gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px;
  border-radius: 999px;
  border: 1.5px solid rgba(128, 192, 224, 0.55);
  background: linear-gradient(180deg, rgba(25, 40, 60, 0.94) 0%, rgba(15, 25, 40, 0.94) 100%);
  color: #c8dce8;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.45);
  transition: border-color 0.15s, box-shadow 0.15s;
  text-align: left;
}
#quest-tracker .quest-tracker-pill:hover {
  border-color: rgba(128, 192, 224, 0.85);
  box-shadow: 0 4px 24px rgba(128, 192, 224, 0.2);
}
#quest-tracker .quest-tracker-pill.open {
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
}
#quest-tracker .quest-tracker-icon { font-size: 16px; flex-shrink: 0; }
#quest-tracker .quest-tracker-label {
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#quest-tracker .quest-tracker-chevron {
  font-size: 10px; opacity: 0.5; flex-shrink: 0;
  transition: transform 0.15s;
}
#quest-tracker .quest-tracker-pill.open .quest-tracker-chevron {
  transform: rotate(180deg);
}

#quest-tracker .quest-tracker-panel {
  pointer-events: auto;
  position: absolute; top: 100%; right: 0;
  width: min(360px, calc(100vw - 32px));
  margin-top: 4px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(128, 192, 224, 0.35);
  background: rgba(10, 16, 24, 0.96);
  box-shadow: 0 12px 40px rgba(0,0,0,0.55);
  backdrop-filter: blur(12px);
  display: none;
  color: #d0dce8;
  font-size: 13px; line-height: 1.55;
}
#quest-tracker .quest-tracker-panel.open { display: block; }

#quest-tracker .quest-tracker-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
#quest-tracker .quest-tracker-panel-title {
  font-weight: 700; color: #a0c8e8; font-size: 14px;
}
#quest-tracker .quest-tracker-close {
  width: 24px; height: 24px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.06);
  color: #8090a0; cursor: pointer; font-size: 11px;
}
#quest-tracker .quest-tracker-panel-sub {
  font-size: 11px; color: #708090; margin-bottom: 10px;
}
#quest-tracker .quest-tracker-panel-objective {
  color: #e0e8f0; margin-bottom: 8px;
}
#quest-tracker .quest-tracker-panel-hint {
  font-size: 12px; color: #80b0c0;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

/* 有任务条时，地图按钮下移避免重叠 */
#stage.has-quest-tracker #map-btn {
  top: 58px;
}
`;
    document.head.appendChild(s);
  }
}
