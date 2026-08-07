import { playerResources } from '../proto/PlayerResources';

/**
 * BaitHUD —— 屏幕左上角"鱼饵计数" pill
 *
 * 自动挂到 body 上，订阅 playerResources 的变化。
 * 存量比例：>50% 白色、30–50% 黄色、<30% 红色（提示玩家该回港了）。
 */
export class BaitHUD {
  private root: HTMLDivElement;
  private icon: HTMLDivElement;
  private text: HTMLSpanElement;
  private unsub: () => void;

  /** container 默认 document.body；传入 #stage 可让鱼饵 HUD 被限制在 16:9 游戏画幅内 */
  constructor(container?: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'bait-hud';

    this.icon = document.createElement('div');
    this.icon.className = 'bait-hud-icon';
    this.icon.innerHTML = BAIT_ICON_SVG;
    this.root.appendChild(this.icon);

    this.text = document.createElement('span');
    this.text.className = 'bait-hud-text';
    this.root.appendChild(this.text);

    (container ?? document.body).appendChild(this.root);
    this.injectStyle();

    this.unsub = playerResources.onChange((e) => this.render(e.bait, e.baitMax));
  }

  dispose() {
    this.unsub();
    this.root.remove();
  }

  private render(bait: number, baitMax: number) {
    this.text.textContent = `${bait} / ${baitMax}`;
    const pct = baitMax > 0 ? bait / baitMax : 0;
    this.root.classList.remove('bait-hud-warn', 'bait-hud-danger');
    if (pct < 0.30) this.root.classList.add('bait-hud-danger');
    else if (pct < 0.50) this.root.classList.add('bait-hud-warn');

    // 空盒子时轻微高亮闪一下（补给后即视觉）
    if (bait === baitMax) {
      this.root.classList.add('bait-hud-pulse');
      setTimeout(() => this.root.classList.remove('bait-hud-pulse'), 900);
    }
  }

  private injectStyle() {
    if (document.getElementById('bait-hud-style')) return;
    const s = document.createElement('style');
    s.id = 'bait-hud-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

const STYLE = /* css */`
.bait-hud {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 8px;
  background: rgba(20, 26, 38, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 22px;
  color: #fff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  user-select: none;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: background 0.2s, color 0.2s;
  pointer-events: none;
}
.bait-hud-icon {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  color: #ffd88a;
  transition: color 0.2s;
}
.bait-hud-icon svg { width: 22px; height: 22px; }
.bait-hud-text { min-width: 52px; text-align: right; }
.bait-hud-warn {
  color: #ffdc7a;
}
.bait-hud-warn .bait-hud-icon { color: #ffd066; }
.bait-hud-danger {
  color: #ff9484;
  border-color: rgba(255, 100, 80, 0.55);
  background: rgba(60, 22, 22, 0.78);
}
.bait-hud-danger .bait-hud-icon { color: #ff8060; }
.bait-hud-pulse {
  animation: baitPulse 0.9s ease-out;
}
@keyframes baitPulse {
  0%   { box-shadow: 0 0 0 0 rgba(120, 220, 140, 0.7); }
  100% { box-shadow: 0 0 0 18px rgba(120, 220, 140, 0);  }
}
`;

// 一条小蚯蚓形状的图标 —— 象征鱼饵
const BAIT_ICON_SVG = /* html */`
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 15 C 4 12, 7 10, 10 12 C 13 14, 15 10, 18 11 C 20 11.5, 21 13, 20.5 15"
    stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <circle cx="20.5" cy="15" r="1.1" fill="currentColor"/>
</svg>
`;
