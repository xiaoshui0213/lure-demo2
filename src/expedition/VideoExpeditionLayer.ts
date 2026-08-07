/**
 * VideoExpeditionLayer —— 白天冒险视频底层（Loop / Action）
 *
 * 视频文件放 public/videos/expedition/{id}.mp4
 * 若文件缺失，显示程序化占位画面（仍可推进流程）。
 */

export type VideoMode = 'loop' | 'action';

const VIDEO_BASE = '/videos/expedition';

/** 视频编号 → 文件名映射 */
export const EXPEDITION_VIDEOS: Record<string, { file: string; mode: VideoMode; label: string }> = {
  'V-D-14': { file: 'V-D-14.mp4', mode: 'loop',  label: '沉船探险海域巡航' },
  'V-D-15': { file: 'V-D-15.mp4', mode: 'loop',  label: '续航·偏航水道' },
  'V-D-16': { file: 'V-D-16.mp4', mode: 'loop',  label: '海面岔路口' },
  'V-D-16L': { file: 'V-D-16L.mp4', mode: 'action', label: '驶入左水道' },
  'V-D-16R': { file: 'V-D-16R.mp4', mode: 'action', label: '驶入右水道' },
  'V-D-17a': { file: 'V-D-17a.mp4', mode: 'action', label: '第一片木板' },
  'V-D-17b': { file: 'V-D-17b.mp4', mode: 'action', label: '更多木板' },
  'V-D-17c': { file: 'V-D-17c.mp4', mode: 'action', label: '木板密集区' },
  'V-D-20': { file: 'V-D-20.mp4', mode: 'action', label: '拾取漂流瓶' },
  'V-D-22': { file: 'V-D-22.mp4', mode: 'action', label: '沉船现身' },
  'V-D-23': { file: 'V-D-23.mp4', mode: 'action', label: '渔网打捞宝物' },
};

export class VideoExpeditionLayer {
  private root: HTMLElement;
  private video: HTMLVideoElement;
  private placeholder: HTMLElement;
  private labelEl: HTMLElement;
  private active = false;
  private currentId: string | null = null;
  private onActionEnd: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'expedition-video-layer';
    this.root.innerHTML = `
      <video class="exp-video" muted playsinline preload="auto"></video>
      <div class="exp-placeholder">
        <div class="exp-placeholder-waves"></div>
        <div class="exp-placeholder-label"></div>
        <div class="exp-placeholder-hint">视频占位 · 素材就绪后替换</div>
      </div>
    `;
    container.appendChild(this.root);

    this.video = this.root.querySelector('.exp-video')!;
    this.placeholder = this.root.querySelector('.exp-placeholder')!;
    this.labelEl = this.root.querySelector('.exp-placeholder-label')!;

    this.video.addEventListener('ended', () => {
      if (this.onActionEnd) this.onActionEnd();
    });
    this.video.addEventListener('error', () => this.showPlaceholder());

    this.injectStyle();
  }

  isActive() { return this.active; }

  show() {
    this.active = true;
    this.root.classList.add('visible');
  }

  hide() {
    this.active = false;
    this.video.pause();
    this.root.classList.remove('visible');
  }

  /** 播放 Loop（循环） */
  playLoop(videoId: string) {
    this.currentId = videoId;
    const def = EXPEDITION_VIDEOS[videoId];
    if (!def) return;
    this.labelEl.textContent = `${videoId} · ${def.label}`;
    this.video.loop = true;
    this.onActionEnd = null;
    this.tryPlay(`${VIDEO_BASE}/${def.file}`, () => this.showPlaceholder());
  }

  /** 播放 Action（一次，ended 回调） */
  playAction(videoId: string): Promise<void> {
    this.currentId = videoId;
    const def = EXPEDITION_VIDEOS[videoId];
    if (!def) return Promise.resolve();

    this.labelEl.textContent = `${videoId} · ${def.label}`;
    this.video.loop = false;
    this.onActionEnd = null;

    return new Promise<void>((resolve) => {
      const finish = () => {
        this.onActionEnd = null;
        resolve();
      };
      this.onActionEnd = finish;

      this.tryPlay(`${VIDEO_BASE}/${def.file}`, () => {
        // 占位：模拟 action 时长
        this.showPlaceholder();
        window.setTimeout(finish, 2800);
      });
    });
  }

  private tryPlay(src: string, onFail: () => void) {
    this.video.src = src;
    this.video.load();
    const onMeta = () => {
      this.video.removeEventListener('error', onErr);
      this.hidePlaceholder();
      this.video.play().catch(onFail);
    };
    const onErr = () => {
      this.video.removeEventListener('loadedmetadata', onMeta);
      onFail();
    };
    this.video.addEventListener('loadedmetadata', onMeta, { once: true });
    this.video.addEventListener('error', onErr, { once: true });
    // 超时兜底
    window.setTimeout(() => {
      if (this.placeholder.classList.contains('visible')) return;
      if (this.video.readyState < 1) onFail();
    }, 3000);
  }

  private showPlaceholder() {
    this.video.style.opacity = '0';
    this.placeholder.classList.add('visible');
  }

  private hidePlaceholder() {
    this.video.style.opacity = '1';
    this.placeholder.classList.remove('visible');
  }

  getCurrentId() { return this.currentId; }

  dispose() {
    this.hide();
    this.root.remove();
  }

  private injectStyle() {
    if (document.getElementById('exp-video-style')) return;
    const s = document.createElement('style');
    s.id = 'exp-video-style';
    s.textContent = `
#expedition-video-layer {
  position: absolute; inset: 0; z-index: 250;
  display: none; background: #1a4060;
}
#expedition-video-layer.visible { display: block; }
#expedition-video-layer .exp-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover;
  transition: opacity 0.3s;
}
#expedition-video-layer .exp-placeholder {
  position: absolute; inset: 0;
  display: none; align-items: center; justify-content: center; flex-direction: column;
  background: linear-gradient(180deg, #87b3d1 0%, #2a6090 40%, #1a4060 100%);
}
#expedition-video-layer .exp-placeholder.visible { display: flex; }
#expedition-video-layer .exp-placeholder-waves {
  position: absolute; bottom: 0; left: 0; right: 0; height: 35%;
  background: linear-gradient(180deg, transparent, rgba(100,180,220,0.3));
  animation: expWave 3s ease-in-out infinite;
}
@keyframes expWave {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
#expedition-video-layer .exp-placeholder-label {
  position: relative; z-index: 1;
  font-family: -apple-system, "Segoe UI", sans-serif;
  font-size: 18px; font-weight: 700; color: #fff;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5);
  letter-spacing: 2px;
}
#expedition-video-layer .exp-placeholder-hint {
  position: relative; z-index: 1; margin-top: 8px;
  font-size: 11px; color: rgba(255,255,255,0.45);
  font-family: -apple-system, "Segoe UI", sans-serif;
}
`;
    document.head.appendChild(s);
  }
}
