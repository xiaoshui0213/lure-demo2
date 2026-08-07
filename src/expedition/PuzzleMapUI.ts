/**
 * PuzzleMapUI —— 瓶内湿损谜题地图（后叠 UI，不进视频）
 */

export interface PuzzleMapUIOptions {
  onComplete: () => void;
}

/** 正确答案：左岔（谜语②「沉船在左舷」） */
const CORRECT_FORK = 'left';

export class PuzzleMapUI {
  private root: HTMLElement;
  private opts: PuzzleMapUIOptions;
  private _open = false;
  private solved = [false, false, false];

  constructor(opts: PuzzleMapUIOptions) {
    this.opts = opts;
    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'puzzle-map-ui';
    this.root.innerHTML = `
      <div class="puzzle-dim"></div>
      <div class="puzzle-panel">
        <div class="puzzle-title">🗺 湿损航海图</div>
        <div class="puzzle-map-visual">
          <div class="puzzle-island i1"></div>
          <div class="puzzle-island i2"></div>
          <div class="puzzle-island i3"></div>
          <div class="puzzle-route"></div>
        </div>
        <div class="puzzle-riddles"></div>
        <div class="puzzle-result"></div>
        <div class="puzzle-action">点击谜语解谜 · 三条全解后关闭</div>
      </div>
    `;
    document.body.appendChild(this.root);

    const riddlesEl = this.root.querySelector('.puzzle-riddles')!;
    const riddles = [
      { text: '「双子礁之间，取窄不取宽」', hint: '→ 选两岛间窄水道' },
      { text: '「潮声向西，沉船在左舷」', hint: '→ 选左岔' },
      { text: '「三片浮木指引，见木即近」', hint: '→ 后续留意木板' },
    ];
    riddles.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.className = 'puzzle-riddle';
      btn.innerHTML = `<span class="puzzle-riddle-text">${r.text}</span><span class="puzzle-riddle-hint"></span>`;
      btn.addEventListener('click', () => {
        if (this.solved[i]) return;
        this.solved[i] = true;
        btn.classList.add('solved');
        btn.querySelector('.puzzle-riddle-hint')!.textContent = r.hint;
        this.checkComplete();
      });
      riddlesEl.appendChild(btn);
    });

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen() { return this._open; }
  getCorrectFork() { return CORRECT_FORK; }

  showPanel() {
    this._open = true;
    this.solved = [false, false, false];
    this.root.querySelectorAll('.puzzle-riddle').forEach(el => {
      el.classList.remove('solved');
      el.querySelector('.puzzle-riddle-hint')!.textContent = '';
    });
    this.root.querySelector('.puzzle-result')!.textContent = '';
    this.root.classList.add('visible');
  }

  close() {
    this._open = false;
    this.root.classList.remove('visible');
  }

  private checkComplete() {
    if (!this.solved.every(Boolean)) return;
    const result = this.root.querySelector('.puzzle-result')!;
    result.textContent = '✓ 解谜完成 · 罗盘指向左舷水道';
    window.setTimeout(() => {
      this.close();
      this.opts.onComplete();
    }, 1200);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('puzzle-map-style')) return;
    const s = document.createElement('style');
    s.id = 'puzzle-map-style';
    s.textContent = `
#puzzle-map-ui {
  position: fixed; inset: 0; z-index: 420;
  display: none; align-items: center; justify-content: center;
  font-family: -apple-system, "Segoe UI", sans-serif;
}
#puzzle-map-ui.visible { display: flex; }
#puzzle-map-ui .puzzle-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
#puzzle-map-ui .puzzle-panel {
  position: relative; z-index: 1;
  width: min(520px, 92vw);
  padding: 24px;
  background: linear-gradient(145deg, #3a3020 0%, #2a2218 100%);
  border: 2px solid rgba(180,140,80,0.5);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  color: #e8dcc8;
}
#puzzle-map-ui .puzzle-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
#puzzle-map-ui .puzzle-map-visual {
  position: relative; height: 120px; margin-bottom: 16px;
  background: rgba(60,50,35,0.6); border-radius: 8px;
  border: 1px dashed rgba(180,140,80,0.3);
}
#puzzle-map-ui .puzzle-island {
  position: absolute; width: 24px; height: 24px;
  background: #8a9a7a; border-radius: 50% 50% 40% 40%;
  border: 1px solid #5a6a4a;
}
#puzzle-map-ui .puzzle-island.i1 { left: 15%; top: 40%; }
#puzzle-map-ui .puzzle-island.i2 { left: 45%; top: 25%; }
#puzzle-map-ui .puzzle-island.i3 { left: 75%; top: 45%; }
#puzzle-map-ui .puzzle-route {
  position: absolute; left: 20%; top: 50%; width: 60%; height: 2px;
  background: repeating-linear-gradient(90deg, #c0a060 0, #c0a060 6px, transparent 6px, transparent 12px);
  transform: rotate(-8deg);
}
#puzzle-map-ui .puzzle-riddle {
  display: block; width: 100%; text-align: left;
  padding: 10px 14px; margin-bottom: 8px;
  background: rgba(0,0,0,0.25); border: 1px solid rgba(180,140,80,0.25);
  border-radius: 6px; color: #d8c8a8; cursor: pointer;
  font-size: 13px; transition: background 0.15s;
}
#puzzle-map-ui .puzzle-riddle:hover { background: rgba(0,0,0,0.4); }
#puzzle-map-ui .puzzle-riddle.solved { border-color: rgba(96,208,160,0.5); color: #a0e0c0; }
#puzzle-map-ui .puzzle-riddle-hint { display: block; font-size: 11px; color: #80c0a0; margin-top: 4px; }
#puzzle-map-ui .puzzle-result { text-align: center; font-weight: 700; color: #ffd88a; margin: 8px 0; }
#puzzle-map-ui .puzzle-action { text-align: center; font-size: 11px; color: rgba(255,255,255,0.4); }
`;
    document.head.appendChild(s);
  }
}
