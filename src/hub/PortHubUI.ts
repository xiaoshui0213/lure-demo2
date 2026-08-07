/**
 * PortHubUI —— 平洛镇港口全屏 hub（循环视频背景 + DOM 热区/UI）
 *
 * 视频：public/videos/pingluo-port-loop.mp4
 * 静态兜底：public/maps/pingluo-port.png
 */

import { questState, QUEST_DEFS } from '../quest/QuestState';
import { BrokerDialogueUI } from '../ui/BrokerDialogueUI';

const MERCHANT_QUEST_ID = 'merchant_wreck';
const DEFAULT_VIDEO_URL = '/videos/pingluo-port-loop.mp4';
const DEFAULT_POSTER_URL = '/maps/pingluo-port.png';
const VIDEO_CACHE_VERSION = 3;

export interface PortHubUIOptions {
  container?: HTMLElement;
  /** 循环背景视频（默认 /videos/pingluo-port-loop.mp4） */
  videoUrl?: string;
  /** 视频加载失败或未放置时的静态兜底图 */
  posterUrl?: string;
  onSail?: () => void;
  onClose?: () => void;
}

interface Hotzone {
  id: string;
  label: string;
  icon: string;
  xPct: number;
  yPct: number;
  action: () => void;
  locked?: () => boolean;
  lockHint?: string;
}

export class PortHubUI {
  private root: HTMLElement;
  private plate: HTMLElement;
  private video: HTMLVideoElement;
  private toastEl: HTMLElement;
  private questPillEl: HTMLElement;
  private opts: PortHubUIOptions;
  private open = false;
  private imageAspect = 16 / 9;
  private resizeObs?: ResizeObserver;
  private broker: BrokerDialogueUI;
  private unsubQuest: () => void;
  private videoReady = false;

  constructor(opts: PortHubUIOptions) {
    this.opts = opts;
    this.injectStyle();

    this.broker = new BrokerDialogueUI({
      onAccept: () => {
        questState.acceptQuest(MERCHANT_QUEST_ID);
        this.showToast('✓ 已接受委托 · 前往浅水湾寻找漂流瓶');
        this.refreshHotzones();
      },
    });

    this.root = document.createElement('div');
    this.root.id = 'port-hub-overlay';
    this.root.className = 'port-hub-overlay';

    this.plate = document.createElement('div');
    this.plate.className = 'port-hub-plate';

    const posterUrl = (opts.posterUrl ?? DEFAULT_POSTER_URL) + '?v=2';
    const videoUrl = (opts.videoUrl ?? DEFAULT_VIDEO_URL) + `?v=${VIDEO_CACHE_VERSION}`;

    // 底层：循环视频（无 UI，纯画面）
    this.video = document.createElement('video');
    this.video.className = 'port-hub-video';
    this.video.src = videoUrl;
    this.video.poster = posterUrl;
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.addEventListener('loadedmetadata', () => {
      if (this.video.videoWidth > 0) {
        this.imageAspect = this.video.videoWidth / this.video.videoHeight;
        this.videoReady = true;
        this.updatePlateSize();
      }
    });
    this.video.addEventListener('error', () => {
      // 视频未放置或解码失败 → 用静态图兜底
      this.plate.style.backgroundImage = `url('${posterUrl}')`;
    });
    this.plate.appendChild(this.video);

    // 用 poster 先算宽高比（视频 metadata 到达前）
    const bgImg = new Image();
    bgImg.onload = () => {
      if (!this.videoReady) {
        this.imageAspect = bgImg.naturalWidth / bgImg.naturalHeight;
        this.updatePlateSize();
      }
    };
    bgImg.src = posterUrl;

    this.root.appendChild(this.plate);

    // 顶部栏
    const topbar = document.createElement('div');
    topbar.className = 'port-hub-topbar';
    topbar.innerHTML = `
      <div class="port-hub-title">
        <div class="port-hub-title-cn">平 洛 镇</div>
        <div class="port-hub-title-en">PINGLUO TOWN</div>
      </div>
      <div class="port-hub-quest-pill"></div>
    `;
    this.plate.appendChild(topbar);
    this.questPillEl = topbar.querySelector('.port-hub-quest-pill')!;

    // UI 层（叠在视频上方）
    const uiLayer = document.createElement('div');
    uiLayer.className = 'port-hub-ui-layer';
    this.plate.appendChild(uiLayer);

    // 热区容器
    const zonesLayer = document.createElement('div');
    zonesLayer.className = 'port-hub-zones';
    uiLayer.appendChild(zonesLayer);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'port-hub-toast';
    uiLayer.appendChild(this.toastEl);

    // 底部提示
    const hint = document.createElement('div');
    hint.className = 'port-hub-hint';
    hint.textContent = '点击热区互动 · 接受委托后可「出海」';
    uiLayer.appendChild(hint);

    (opts.container ?? document.body).appendChild(this.root);

    this.buildHotzones(zonesLayer);

    this.unsubQuest = questState.subscribe(() => {
      this.refreshQuestPill();
      this.refreshHotzones();
    });

    window.addEventListener('keydown', this.onKeyDown);
    this.resizeObs = new ResizeObserver(() => this.updatePlateSize());
    const stage = opts.container ?? document.body;
    this.resizeObs.observe(stage);
    window.addEventListener('resize', this.onWindowResize);

    this.refreshQuestPill();
  }

  private buildHotzones(layer: HTMLElement) {
    const zones: Hotzone[] = [
      {
        id: 'broker',
        label: '委托人',
        icon: '🪵',
        xPct: 48, yPct: 52,
        action: () => this.openBroker(),
      },
      {
        id: 'sail',
        label: '出海',
        icon: '⛵',
        xPct: 72, yPct: 68,
        locked: () => !questState.isActive(MERCHANT_QUEST_ID) && !questState.isCompleted(MERCHANT_QUEST_ID),
        lockHint: '先找委托人接受「沉船货运」委托',
        action: () => this.doSail(),
      },
      {
        id: 'warehouse',
        label: '仓库',
        icon: '📦',
        xPct: 28, yPct: 72,
        locked: () => true,
        lockHint: '仓库暂未开放',
        action: () => {},
      },
    ];

    for (const z of zones) {
      const el = document.createElement('button');
      el.className = 'port-hub-zone';
      el.dataset.zoneId = z.id;
      el.style.left = `${z.xPct}%`;
      el.style.top = `${z.yPct}%`;
      el.innerHTML = `
        <span class="port-hub-zone-icon">${z.icon}</span>
        <span class="port-hub-zone-label">${z.label}</span>
      `;
      el.addEventListener('click', () => {
        if (z.locked?.()) {
          this.showToast(`🔒 ${z.lockHint ?? '尚未解锁'}`);
          return;
        }
        z.action();
      });
      layer.appendChild(el);
    }
  }

  private refreshHotzones() {
    const sail = this.plate.querySelector('[data-zone-id="sail"]');
    const questActive = questState.isActive(MERCHANT_QUEST_ID) || questState.isCompleted(MERCHANT_QUEST_ID);
    sail?.classList.toggle('locked', !questActive);
  }

  private refreshQuestPill() {
    const status = questState.getStatus(MERCHANT_QUEST_ID);
    if (status === 'active' || status === 'completed') {
      // 进行中/已完成由全局 QuestTrackerUI 显示，港口内隐藏重复条
      this.questPillEl.style.display = 'none';
      return;
    }
    this.questPillEl.style.display = '';
    this.questPillEl.textContent = '📋 找委托人接委托';
    this.questPillEl.className = 'port-hub-quest-pill pending';
  }

  private openBroker() {
    const q = QUEST_DEFS[MERCHANT_QUEST_ID];
    const status = questState.getStatus(MERCHANT_QUEST_ID);
    if (status === 'available') this.broker.openOffer(q);
    else if (status === 'active') this.broker.openActive(q);
    else this.broker.openDone(q);
  }

  private doSail() {
    // 先开地图再关港口，避免淡出期间露出底层 Three.js 画面
    this.opts.onSail?.();
    this.hideImmediate();
  }

  isOpen() { return this.open; }
  isDialogueOpen() { return this.broker.isOpen(); }

  show() {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('visible');
    this.root.classList.remove('fading-out');
    requestAnimationFrame(() => this.updatePlateSize());
    this.refreshQuestPill();
    this.refreshHotzones();
    this.video.play().catch(() => { /* 浏览器策略或未就绪 */ });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('visible', 'fading-out');
    this.video.pause();
    this.opts.onClose?.();
  }

  private hideImmediate() {
    this.open = false;
    this.root.classList.remove('visible', 'fading-out');
    this.video.pause();
  }

  /** 带 fade 的显示（从地图/探险返回） */
  fadeIn() {
    this.show();
    this.root.classList.add('fading-in');
    window.setTimeout(() => this.root.classList.remove('fading-in'), 350);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.open || this.broker.isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onWindowResize = () => this.updatePlateSize();

  private updatePlateSize() {
    const parent = this.root.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w <= 0 || h <= 0) return;
    const containerAspect = w / h;
    if (containerAspect > this.imageAspect) {
      this.plate.style.height = h + 'px';
      this.plate.style.width = (h * this.imageAspect) + 'px';
    } else {
      this.plate.style.width = w + 'px';
      this.plate.style.height = (w / this.imageAspect) + 'px';
    }
  }

  private toastTimer = 0;
  showToast(msg: string, duration = 2000) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), duration);
  }

  dispose() {
    this.unsubQuest();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObs?.disconnect();
    this.broker.dispose();
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('port-hub-style')) return;
    const s = document.createElement('style');
    s.id = 'port-hub-style';
    s.textContent = `
.port-hub-overlay {
  position: absolute; inset: 0; z-index: 310;
  display: none; align-items: center; justify-content: center;
  background: #000; overflow: hidden;
  opacity: 1; transition: opacity 0.32s ease;
}
.port-hub-overlay.visible { display: flex; }
.port-hub-overlay.fading-out { opacity: 0; pointer-events: none; }
.port-hub-overlay.fading-in { animation: portFadeIn 0.35s ease; }
@keyframes portFadeIn { from { opacity: 0; } to { opacity: 1; } }

.port-hub-plate {
  position: relative;
  overflow: hidden;
  box-shadow: 0 0 60px rgba(0,0,0,0.6);
  background: #1a4060 center / cover no-repeat;
}

.port-hub-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  pointer-events: none;
  z-index: 0;
}

.port-hub-ui-layer {
  position: absolute; inset: 0;
  z-index: 2;
  pointer-events: none;
}
.port-hub-ui-layer .port-hub-zones,
.port-hub-ui-layer .port-hub-toast { pointer-events: auto; }
.port-hub-topbar { z-index: 3; }

.port-hub-topbar {
  position: absolute; top: 0; left: 0; right: 0;
  z-index: 3;
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 100%);
  pointer-events: none;
}
.port-hub-title-cn {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 22px; font-weight: 700; letter-spacing: 6px;
  color: #f4e8c8; text-shadow: 0 2px 8px rgba(0,0,0,0.8);
}
.port-hub-title-en {
  font-size: 10px; letter-spacing: 3px; color: rgba(244,232,200,0.55);
  margin-top: 2px;
}
.port-hub-quest-pill {
  font-family: -apple-system, "Segoe UI", sans-serif;
  font-size: 12px; font-weight: 600;
  padding: 6px 14px; border-radius: 999px;
  background: rgba(20,30,50,0.75);
  border: 1px solid rgba(255,255,255,0.12);
  color: #a0b0c0;
  backdrop-filter: blur(8px);
}
.port-hub-quest-pill.active { color: #80c0e0; border-color: rgba(128,192,224,0.4); }
.port-hub-quest-pill.done { color: #60d0a0; border-color: rgba(96,208,160,0.4); }

.port-hub-zones { position: absolute; inset: 0; }
.port-hub-zone {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: rgba(20, 30, 50, 0.72);
  border: 1.5px solid rgba(255, 216, 138, 0.5);
  border-radius: 12px;
  padding: 10px 16px;
  cursor: pointer;
  color: #fff;
  font-family: -apple-system, "Segoe UI", sans-serif;
  transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.port-hub-zone:hover {
  transform: translate(-50%, -50%) scale(1.06);
  background: rgba(40, 55, 80, 0.88);
  box-shadow: 0 6px 24px rgba(255,216,138,0.2);
}
.port-hub-zone.locked { opacity: 0.55; border-color: rgba(128,128,128,0.4); }
.port-hub-zone-icon { font-size: 22px; }
.port-hub-zone-label { font-size: 12px; font-weight: 700; letter-spacing: 1px; }

.port-hub-toast {
  position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
  padding: 10px 20px; border-radius: 8px;
  background: rgba(10,16,24,0.92);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e0e8f0; font-size: 13px;
  font-family: -apple-system, "Segoe UI", sans-serif;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s;
}
.port-hub-toast.visible { opacity: 1; }

.port-hub-hint {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: rgba(255,255,255,0.45);
  font-family: -apple-system, "Segoe UI", sans-serif;
  pointer-events: none;
}
`;
    document.head.appendChild(s);
  }
}
