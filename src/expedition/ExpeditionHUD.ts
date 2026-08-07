/**
 * ExpeditionHUD —— 探险顶栏：阶段 + 目标
 */

import type { ExpeditionPhase } from './ExpeditionController';

const PHASE_META: Record<ExpeditionPhase, { label: string; objective: string }> = {
  CRUISE:       { label: '巡航', objective: '寻找海面漂流瓶' },
  BOTTLE:       { label: '拾瓶', objective: '查看瓶内谜题地图' },
  PUZZLE_DONE:  { label: '解谜', objective: '沿航线继续前行' },
  FORK:         { label: '岔路', objective: '依据谜题选择正确水道' },
  PATH:         { label: '水道', objective: '跟随浮木线索' },
  CLUE_1:       { label: '线索', objective: '发现第一片木板' },
  CLUE_2:       { label: '线索', objective: '更多漂浮木板' },
  CLUE_3:       { label: '线索', objective: '接近沉船区域' },
  WRECK:        { label: '沉船', objective: '靠近沉船残骸' },
  SALVAGE:      { label: '打捞', objective: '撒网打捞宝物' },
  DONE:         { label: '完成', objective: '携带宝物返航' },
};

export class ExpeditionHUD {
  private root: HTMLElement;
  private phaseEl: HTMLElement;
  private objEl: HTMLElement;
  private promptEl: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'expedition-hud';
    this.root.innerHTML = `
      <div class="exp-hud-bar">
        <span class="exp-hud-phase"></span>
        <span class="exp-hud-sep">·</span>
        <span class="exp-hud-objective"></span>
      </div>
      <div class="exp-hud-prompt"></div>
    `;
    container.appendChild(this.root);
    this.phaseEl = this.root.querySelector('.exp-hud-phase')!;
    this.objEl = this.root.querySelector('.exp-hud-objective')!;
    this.promptEl = this.root.querySelector('.exp-hud-prompt')!;
    this.injectStyle();
  }

  show() {
    this.visible = true;
    this.root.classList.add('visible');
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
  }

  isVisible() { return this.visible; }

  setPhase(phase: ExpeditionPhase) {
    const m = PHASE_META[phase];
    this.phaseEl.textContent = m.label;
    this.objEl.textContent = m.objective;
  }

  setPrompt(text: string) {
    this.promptEl.textContent = text;
    this.promptEl.classList.toggle('visible', !!text);
  }

  dispose() {
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('exp-hud-style')) return;
    const s = document.createElement('style');
    s.id = 'exp-hud-style';
    s.textContent = `
#expedition-hud {
  position: absolute; top: 0; left: 0; right: 0; z-index: 360;
  pointer-events: none;
  display: none;
  font-family: -apple-system, "Segoe UI", sans-serif;
}
#expedition-hud.visible { display: block; }
#expedition-hud .exp-hud-bar {
  margin: 14px auto 0;
  width: fit-content;
  padding: 8px 20px;
  border-radius: 999px;
  background: rgba(10, 16, 24, 0.82);
  border: 1px solid rgba(255, 216, 138, 0.35);
  color: #e8e0d0;
  font-size: 13px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
#expedition-hud .exp-hud-phase { font-weight: 700; color: #ffd88a; }
#expedition-hud .exp-hud-sep { margin: 0 8px; opacity: 0.4; }
#expedition-hud .exp-hud-prompt {
  text-align: center; margin-top: 12px;
  font-size: 14px; font-weight: 600; color: #fff;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8);
  opacity: 0; transition: opacity 0.2s;
}
#expedition-hud .exp-hud-prompt.visible { opacity: 1; }
#expedition-hud .exp-hud-prompt kbd {
  display: inline-block; padding: 2px 8px; margin: 0 4px;
  border-radius: 4px; background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
}
`;
    document.head.appendChild(s);
  }
}
