/**
 * FishShowcase —— 钓上鱼后、放入背包前播放的"战利品展示"视频。
 *
 * 播放期间：
 *   - 全屏铺满 #stage（16:9 游戏画幅），与试玩画面完全对齐
 *   - 冻结船控 / 环视 / F 键（由调用方通过 isUiBusy()/isFishingBusy() 接管）
 *   - 允许点击画面或按任意键跳过
 *   - **一定播放到 'ended' 才 resolve**（除非玩家主动跳过），不会在视频还没放完时
 *     就提前把背包 UI 弹出来
 *
 * 用法：
 *   const showcase = new FishShowcase();
 *   showcase.warmUp();        // 提前触发缓冲（比如钓鱼小游戏刚开始时调用），
 *                              // 给浏览器几秒钓鱼博弈的时间把视频下载好，
 *                              // 避免真正播放时卡在"缓冲中"
 *   await showcase.play();    // resolve 于播放完毕 / 玩家跳过 / 视频彻底加载失败(兜底)
 */
export class FishShowcase {
  private root: HTMLElement;
  private video: HTMLVideoElement;
  private active = false;
  private warmed = false;

  constructor() {
    const root = document.getElementById('fish-showcase');
    const video = document.getElementById('fish-showcase-video') as HTMLVideoElement | null;
    if (!root || !video) {
      throw new Error('[FishShowcase] #fish-showcase / #fish-showcase-video 未找到，检查 prototype.html');
    }
    this.root = root;
    this.video = video;
  }

  isActive() {
    return this.active;
  }

  /**
   * 提前预热缓冲 —— 在真正需要播放前调用（例如抛竿的那一刻），
   * 给浏览器一段"玩家在博弈鱼"的时间把视频缓冲好，避免播放瞬间卡顿。
   * 幂等，可以多次调用。
   */
  warmUp() {
    if (this.warmed) return;
    this.warmed = true;
    try {
      this.video.load();
    } catch {
      /* 忽略 —— play() 时还有兜底逻辑 */
    }
  }

  /**
   * 播放展示视频；只在以下情况 resolve：
   *   1) 视频自然播放到结尾（'ended'）
   *   2) 玩家点击画面 / 按任意键主动跳过
   *   3) 视频彻底无法解码（'error'）或长时间连元数据都拿不到（兜底超时）
   * 正常播放路径下绝不会在视频放完之前 resolve，确保背包 UI 一定在视频结束后才出现。
   */
  play(): Promise<void> {
    if (this.active) return Promise.resolve();
    this.active = true;
    this.warmUp();   // 万一之前没预热过，这里兜底触发一次

    return new Promise<void>((resolve) => {
      let done = false;
      let hardTimeoutTimer = 0;

      const finish = () => {
        if (done) return;
        done = true;
        this.video.pause();
        this.root.classList.remove('visible');
        this.video.removeEventListener('ended', finish);
        this.video.removeEventListener('error', finish);
        this.video.removeEventListener('loadedmetadata', armHardTimeout);
        this.root.removeEventListener('click', finish);
        window.removeEventListener('keydown', onKeyDown);
        clearTimeout(hardTimeoutTimer);
        clearTimeout(metadataTimeoutTimer);
        this.active = false;
        resolve();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        finish();
      };

      /**
       * 硬超时 —— 只作为"视频彻底放不出来"的最后兜底，时长必须比视频本身长，
       * 否则会在正常播放过程中把视频掐断、背包 UI 提前弹出（历史 bug）。
       * 用 video.duration（拿到后）+ 3s 余量；拿不到时给一个足够宽松的默认值。
       */
      const armHardTimeout = () => {
        const dur = this.video.duration;
        const ms = Number.isFinite(dur) && dur > 0 ? dur * 1000 + 3000 : 20000;
        hardTimeoutTimer = window.setTimeout(finish, ms);
      };

      // 视频连"元数据"都拿不到（网络/文件问题）——给 8s 兜底，不让流程卡死
      const metadataTimeoutTimer = window.setTimeout(() => {
        if (!Number.isFinite(this.video.duration)) armHardTimeout();
      }, 8000);

      this.video.addEventListener('ended', finish);
      this.video.addEventListener('error', finish);
      this.root.addEventListener('click', finish);
      window.addEventListener('keydown', onKeyDown, true);

      if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
        armHardTimeout();
      } else {
        this.video.addEventListener('loadedmetadata', armHardTimeout, { once: true });
      }

      this.root.classList.add('visible');
      this.video.currentTime = 0;
      this.video.play().catch(() => finish());   // 浏览器拒绝自动播放等极端情况直接跳过
    });
  }
}
