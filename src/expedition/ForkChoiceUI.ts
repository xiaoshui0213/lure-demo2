/**
 * ForkChoiceUI —— 海面岔路选择（左 / 右）
 */

export interface ForkChoiceUIOptions {
  onChoose: (dir: 'left' | 'right') => void;
}

export class ForkChoiceUI {
  private root: HTMLElement;
  private opts: ForkChoiceUIOptions;
  private _open = false;

  constructor(opts: ForkChoiceUIOptions) {
    this.opts = opts;
    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'fork-choice-ui';
    this.root.innerHTML = `
      <div class="fork-panel">
        <div class="fork-title">⚓ 海面岔路口</div>
        <div class="fork-sub">依据谜题选择水道</div>
        <div class="fork-buttons">
          <button class="fork-btn fork-left" data-dir="left">← 左舷水道</button>
          <button class="fork-btn fork-right" data-dir="right">右舷水道 →</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.root.querySelectorAll('.fork-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = (btn as HTMLElement).dataset.dir as 'left' | 'right';
        this.close();
        this.opts.onChoose(dir);
      });
    });
  }

  isOpen() { return this._open; }

  showPanel() {
    this._open = true;
    this.root.classList.add('visible');
  }

  close() {
    this._open = false;
    this.root.classList.remove('visible');
  }

  dispose() {
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('fork-choice-style')) return;
    const s = document.createElement('style');
    s.id = 'fork-choice-style';
    s.textContent = `
#fork-choice-ui {
  position: fixed; inset: 0; z-index: 410;
  display: none; align-items: flex-end; justify-content: center;
  padding-bottom: 80px;
  pointer-events: none;
  font-family: -apple-system, "Segoe UI", sans-serif;
}
#fork-choice-ui.visible { display: flex; pointer-events: auto; }
#fork-choice-ui .fork-panel {
  padding: 20px 28px;
  background: rgba(10, 16, 24, 0.92);
  border: 1px solid rgba(255, 216, 138, 0.4);
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
#fork-choice-ui .fork-title { font-size: 16px; font-weight: 700; color: #ffd88a; }
#fork-choice-ui .fork-sub { font-size: 12px; color: #8090a0; margin: 6px 0 16px; }
#fork-choice-ui .fork-buttons { display: flex; gap: 16px; }
#fork-choice-ui .fork-btn {
  padding: 12px 24px; font-size: 14px; font-weight: 700;
  border-radius: 8px; cursor: pointer; color: #fff;
  border: 1.5px solid rgba(255,255,255,0.2);
  background: rgba(40, 60, 90, 0.8);
  transition: transform 0.15s, background 0.15s;
}
#fork-choice-ui .fork-btn:hover { transform: scale(1.04); background: rgba(60, 90, 130, 0.9); }
#fork-choice-ui .fork-left { border-color: rgba(96,208,160,0.5); }
`;
    document.head.appendChild(s);
  }
}
