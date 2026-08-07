/**
 * SalvageQTE —— 渔网打捞 QTE（UI 控制，视频无 UI）
 */

export interface SalvageQTEOptions {
  onSuccess: () => void;
  onFail: () => void;
}

export class SalvageQTE {
  private root: HTMLElement;
  private ringEl: HTMLElement;
  private markerEl: HTMLElement;
  private opts: SalvageQTEOptions;
  private _open = false;
  private angle = 0;
  private markerAngle = 0;
  private rafId = 0;
  private hits = 0;
  private readonly TARGET_HITS = 3;
  private readonly GREEN_START = 240;
  private readonly GREEN_SIZE = 50;

  constructor(opts: SalvageQTEOptions) {
    this.opts = opts;
    this.injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'salvage-qte';
    this.root.innerHTML = `
      <div class="salvage-panel">
        <div class="salvage-title">🕸 渔网打捞</div>
        <div class="salvage-sub">光标进入绿区时按 <kbd>Space</kbd></div>
        <div class="salvage-ring">
          <div class="salvage-green"></div>
          <div class="salvage-marker"></div>
        </div>
        <div class="salvage-progress">0 / ${this.TARGET_HITS}</div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.ringEl = this.root.querySelector('.salvage-ring')!;
    this.markerEl = this.root.querySelector('.salvage-marker')!;

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen() { return this._open; }

  showPanel() {
    this._open = true;
    this.hits = 0;
    this.angle = 0;
    this.markerAngle = Math.random() * 360;
    this.root.classList.add('visible');
    this.updateProgress();
    this.tick();
  }

  close() {
    this._open = false;
    this.root.classList.remove('visible');
    cancelAnimationFrame(this.rafId);
  }

  private tick = () => {
    if (!this._open) return;
    this.angle = (this.angle + 2.8) % 360;
    this.markerEl.style.transform = `rotate(${this.angle}deg) translateY(-70px)`;
    this.rafId = requestAnimationFrame(this.tick);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._open || e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();

    const diff = Math.abs(((this.angle - this.markerAngle + 540) % 360) - 180);
    const inGreen = diff < this.GREEN_SIZE / 2;

    if (inGreen) {
      this.hits++;
      this.updateProgress();
      this.markerAngle = Math.random() * 360;
      this.root.querySelector('.salvage-green')!.setAttribute('style',
        `--green-start: ${this.markerAngle - this.GREEN_SIZE / 2}deg`);
      if (this.hits >= this.TARGET_HITS) {
        this.close();
        this.opts.onSuccess();
      }
    } else {
      this.close();
      this.opts.onFail();
    }
  };

  private updateProgress() {
    const el = this.root.querySelector('.salvage-progress')!;
    el.textContent = `${this.hits} / ${this.TARGET_HITS}`;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    cancelAnimationFrame(this.rafId);
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('salvage-qte-style')) return;
    const s = document.createElement('style');
    s.id = 'salvage-qte-style';
    s.textContent = `
#salvage-qte {
  position: fixed; inset: 0; z-index: 415;
  display: none; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.35);
  font-family: -apple-system, "Segoe UI", sans-serif;
}
#salvage-qte.visible { display: flex; }
#salvage-qte .salvage-panel { text-align: center; color: #fff; }
#salvage-qte .salvage-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
#salvage-qte .salvage-sub { font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 20px; }
#salvage-qte .salvage-ring {
  position: relative; width: 160px; height: 160px; margin: 0 auto 16px;
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.25);
  background: rgba(0,0,0,0.3);
}
#salvage-qte .salvage-green {
  position: absolute; inset: -3px;
  border-radius: 50%;
  background: conic-gradient(from var(--green-start, 240deg), transparent 0deg, rgba(96,208,160,0.7) 50deg, transparent 50deg);
}
#salvage-qte .salvage-marker {
  position: absolute; left: 50%; top: 50%;
  width: 4px; height: 16px; margin: -8px -2px;
  background: #fff; border-radius: 2px;
  transform-origin: center 70px;
  box-shadow: 0 0 8px rgba(255,255,255,0.8);
}
#salvage-qte .salvage-progress { font-size: 14px; font-weight: 700; color: #ffd88a; }
#salvage-qte kbd {
  padding: 1px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
}
`;
    document.head.appendChild(s);
  }
}
