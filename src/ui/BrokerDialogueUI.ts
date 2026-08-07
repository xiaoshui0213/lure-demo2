/**
 * BrokerDialogueUI —— DOM 版委托人对话（DREDGE 风底栏）
 */

import { QuestDef } from '../quest/QuestState';

export type BrokerDialogueMode = 'offer' | 'active' | 'done';

export interface BrokerDialogueUIOptions {
  onAccept: () => void;
  onClose?: () => void;
}

export class BrokerDialogueUI {
  private root: HTMLElement;
  private nameEl: HTMLElement;
  private bodyEl: HTMLElement;
  private highlightEl: HTMLElement;
  private actionEl: HTMLElement;
  private open = false;
  private mode: BrokerDialogueMode = 'offer';
  private quest: QuestDef | null = null;
  private opts: BrokerDialogueUIOptions;

  /** 委托人首次介绍委托时的台词 */
  private static readonly INTRO_TEXT =
    '浮木商会的货沉了。浅海某处有个瓶子漂着，里头有线索。你去找，照着走，货捞上来送到礁岛——那边有人等着。';

  constructor(opts: BrokerDialogueUIOptions) {
    this.opts = opts;
    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'broker-dialogue';
    this.root.innerHTML = `
      <div class="broker-dim"></div>
      <div class="broker-panel">
        <div class="broker-portrait">🪵</div>
        <div class="broker-text">
          <div class="broker-name"></div>
          <div class="broker-body"></div>
          <div class="broker-highlight"></div>
        </div>
        <div class="broker-action"></div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.nameEl = this.root.querySelector('.broker-name')!;
    this.bodyEl = this.root.querySelector('.broker-body')!;
    this.highlightEl = this.root.querySelector('.broker-highlight')!;
    this.actionEl = this.root.querySelector('.broker-action')!;

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen() { return this.open; }

  openOffer(quest: QuestDef) {
    this.quest = quest;
    this.mode = 'offer';
    this.open = true;
    this.root.classList.add('visible');
    this.refresh();
  }

  openActive(quest: QuestDef) {
    this.quest = quest;
    this.mode = 'active';
    this.open = true;
    this.root.classList.add('visible');
    this.refresh();
  }

  openDone(quest: QuestDef) {
    this.quest = quest;
    this.mode = 'done';
    this.open = true;
    this.root.classList.add('visible');
    this.refresh();
  }

  close() {
    this.open = false;
    this.root.classList.remove('visible');
    this.opts.onClose?.();
  }

  private refresh() {
    if (!this.quest) return;
    const q = this.quest;
    this.nameEl.textContent = `${q.factionIcon} ${q.factionName} · 委托人`;

    if (this.mode === 'offer') {
      this.bodyEl.textContent = BrokerDialogueUI.INTRO_TEXT;
      this.highlightEl.textContent = `📋 ${q.title} · ${q.objective}`;
      this.actionEl.innerHTML = '<kbd>1</kbd> 接受委托　<kbd>Esc</kbd> 离开';
    } else if (this.mode === 'active') {
      this.bodyEl.textContent =
        `${BrokerDialogueUI.INTRO_TEXT}\n\n委托已经接下。`;
      this.highlightEl.textContent = `📋 ${q.title} · ${q.objective}`;
      this.actionEl.innerHTML = '<kbd>Esc</kbd> 离开';
    } else {
      this.bodyEl.textContent =
        `${BrokerDialogueUI.INTRO_TEXT}\n\n今天的委托办完了。明儿日出再来。`;
      this.highlightEl.textContent = '';
      this.actionEl.innerHTML = '<kbd>Esc</kbd> 离开';
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.open) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'e') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (this.mode === 'offer' && (k === '1' || k === 'enter')) {
      e.preventDefault();
      e.stopPropagation();
      this.opts.onAccept();
      this.close();
    }
  };

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('broker-dialogue-style')) return;
    const s = document.createElement('style');
    s.id = 'broker-dialogue-style';
    s.textContent = `
#broker-dialogue {
  position: fixed; inset: 0; z-index: 450;
  display: none; align-items: flex-end; justify-content: center;
  pointer-events: none;
  font-family: -apple-system, "Segoe UI", sans-serif;
}
#broker-dialogue.visible { display: flex; pointer-events: auto; }
#broker-dialogue .broker-dim {
  position: absolute; inset: 0;
  background: rgba(2, 4, 8, 0.55);
}
#broker-dialogue .broker-panel {
  position: relative; z-index: 1;
  width: min(960px, 96vw);
  margin-bottom: 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 16px;
  padding: 18px 24px 16px;
  background: rgba(10, 16, 24, 0.96);
  border-top: 1px solid rgba(48, 64, 80, 0.6);
  box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
}
#broker-dialogue .broker-portrait {
  width: 56px; height: 56px; border-radius: 8px;
  background: rgba(128, 192, 224, 0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
}
#broker-dialogue .broker-name {
  font-size: 13px; font-weight: 700; color: #c0d0e0; margin-bottom: 6px;
}
#broker-dialogue .broker-body {
  font-size: 13px; color: #d0dce8; line-height: 1.55; margin-bottom: 8px;
  white-space: pre-line;
}
#broker-dialogue .broker-highlight {
  font-size: 12px; color: #60d0c0; font-weight: 600;
}
#broker-dialogue .broker-action {
  grid-column: 1 / -1;
  text-align: center; font-size: 11px; color: #708090; padding-top: 4px;
}
#broker-dialogue kbd {
  display: inline-block; padding: 1px 6px; margin: 0 2px;
  border-radius: 4px; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12); font-size: 10px;
}
`;
    document.head.appendChild(s);
  }
}
