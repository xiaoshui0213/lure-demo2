/**
 * ExpeditionController —— 沉船探险状态机（视频 + UI 分层）
 */

import { VideoExpeditionLayer } from './VideoExpeditionLayer';
import { ExpeditionHUD } from './ExpeditionHUD';
import { PuzzleMapUI } from './PuzzleMapUI';
import { ForkChoiceUI } from './ForkChoiceUI';
import { SalvageQTE } from './SalvageQTE';
import { questState } from '../quest/QuestState';
import { hubState } from '../hub/HubState';

export type ExpeditionPhase =
  | 'CRUISE'
  | 'BOTTLE'
  | 'PUZZLE_DONE'
  | 'FORK'
  | 'PATH'
  | 'CLUE_1'
  | 'CLUE_2'
  | 'CLUE_3'
  | 'WRECK'
  | 'SALVAGE'
  | 'DONE';

export interface ExpeditionControllerOptions {
  container: HTMLElement;
  /** 探险结束（成功/放弃） */
  onExit: (success: boolean) => void;
}

export class ExpeditionController {
  private video: VideoExpeditionLayer;
  private hud: ExpeditionHUD;
  private puzzle: PuzzleMapUI;
  private fork: ForkChoiceUI;
  private salvage: SalvageQTE;
  private opts: ExpeditionControllerOptions;
  private active = false;
  private phase: ExpeditionPhase = 'CRUISE';
  private cruiseTimer = 0;
  private keyHandler: (e: KeyboardEvent) => void;
  private fadeEl: HTMLElement;

  constructor(opts: ExpeditionControllerOptions) {
    this.opts = opts;

    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'expedition-fade';
    opts.container.appendChild(this.fadeEl);

    this.video = new VideoExpeditionLayer(opts.container);
    this.hud = new ExpeditionHUD(opts.container);
    this.puzzle = new PuzzleMapUI({ onComplete: () => this.onPuzzleDone() });
    this.fork = new ForkChoiceUI({ onChoose: (dir) => this.onForkChoose(dir) });
    this.salvage = new SalvageQTE({
      onSuccess: () => this.onSalvageSuccess(),
      onFail: () => this.onSalvageFail(),
    });

    this.keyHandler = (e) => this.onKeyDown(e);
    this.injectFadeStyle();
  }

  isActive() { return this.active; }
  getPhase() { return this.phase; }
  isUiOpen() {
    return this.puzzle.isOpen() || this.fork.isOpen() || this.salvage.isOpen();
  }

  /** 进入探险（从地图节点触发） */
  start(_expeditionKey: string) {
    if (this.active) return;
    this.active = true;
    this.phase = 'CRUISE';
    hubState.setMode('expedition');

    this.fadeEl.classList.add('in');
    window.setTimeout(() => {
      this.fadeEl.classList.remove('in');
      this.video.show();
      this.hud.show();
      this.enterPhase('CRUISE');
      window.addEventListener('keydown', this.keyHandler, true);
    }, 350);
  }

  /** 退出探险 */
  exit(success: boolean) {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.keyHandler, true);

    this.puzzle.close();
    this.fork.close();
    this.salvage.close();
    this.hud.hide();
    this.video.hide();

    this.fadeEl.classList.add('out');
    window.setTimeout(() => {
      this.fadeEl.classList.remove('out');
      hubState.setMode('world_map');
      this.opts.onExit(success);
    }, 350);
  }

  /** 每帧更新（main.ts tick 调用） */
  update(dt: number) {
    if (!this.active || this.isUiOpen()) return;

    if (this.phase === 'CRUISE') {
      this.cruiseTimer += dt;
      if (this.cruiseTimer >= 4) {
        this.hud.setPrompt('发现漂流瓶！按 [E] 拾取');
      }
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.active || this.isUiOpen()) return;
    const k = e.key.toLowerCase();

    if (k === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      this.exit(false);
      return;
    }

    if (k === 'e') {
      e.preventDefault();
      e.stopPropagation();
      if (this.phase === 'CRUISE' && this.cruiseTimer >= 4) {
        this.pickBottle();
      } else if (this.phase === 'WRECK') {
        this.approachWreck();
      }
    }
  }

  private async enterPhase(phase: ExpeditionPhase) {
    this.phase = phase;
    this.hud.setPhase(phase);
    this.hud.setPrompt('');
    this.cruiseTimer = 0;

    switch (phase) {
      case 'CRUISE':
        this.video.playLoop('V-D-14');
        break;
      case 'BOTTLE':
        await this.video.playAction('V-D-20');
        this.puzzle.showPanel();
        break;
      case 'PUZZLE_DONE':
        this.video.playLoop('V-D-15');
        window.setTimeout(() => this.enterPhase('FORK'), 3000);
        break;
      case 'FORK':
        this.video.playLoop('V-D-16');
        this.fork.showPanel();
        break;
      case 'PATH':
        this.video.playLoop('V-D-15');
        window.setTimeout(() => this.enterPhase('CLUE_1'), 2000);
        break;
      case 'CLUE_1':
        await this.video.playAction('V-D-17a');
        window.setTimeout(() => this.enterPhase('CLUE_2'), 800);
        break;
      case 'CLUE_2':
        await this.video.playAction('V-D-17b');
        window.setTimeout(() => this.enterPhase('CLUE_3'), 800);
        break;
      case 'CLUE_3':
        await this.video.playAction('V-D-17c');
        window.setTimeout(() => this.enterPhase('WRECK'), 800);
        break;
      case 'WRECK':
        this.video.playLoop('V-D-15');
        this.hud.setPrompt('按 [E] 靠近沉船');
        break;
      case 'SALVAGE':
        await this.video.playAction('V-D-22');
        this.salvage.showPanel();
        break;
      case 'DONE':
        questState.completeQuest('merchant_wreck');
        this.video.playLoop('V-D-14');
        this.hud.setPrompt('宝物已打捞 · 按 Esc 返航');
        break;
    }
  }

  private async pickBottle() {
    this.hud.setPrompt('');
    await this.enterPhase('BOTTLE');
  }

  private onPuzzleDone() {
    this.enterPhase('PUZZLE_DONE');
  }

  private async onForkChoose(dir: 'left' | 'right') {
    const correct = dir === this.puzzle.getCorrectFork();
    if (!correct) {
      this.hud.setPrompt('⚠ 走错了水道 · 3 秒后重试');
      window.setTimeout(() => {
        this.fork.showPanel();
        this.hud.setPrompt('');
      }, 3000);
      return;
    }
    await this.video.playAction(dir === 'left' ? 'V-D-16L' : 'V-D-16R');
    this.enterPhase('PATH');
  }

  private async approachWreck() {
    this.hud.setPrompt('');
    await this.enterPhase('SALVAGE');
  }

  private async onSalvageSuccess() {
    await this.video.playAction('V-D-23');
    this.enterPhase('DONE');
  }

  private onSalvageFail() {
    this.hud.setPrompt('打捞失败 · 再试一次');
    window.setTimeout(() => this.salvage.showPanel(), 1500);
  }

  dispose() {
    window.removeEventListener('keydown', this.keyHandler, true);
    this.video.dispose();
    this.hud.dispose();
    this.puzzle.dispose();
    this.fork.dispose();
    this.salvage.dispose();
    this.fadeEl.remove();
  }

  private injectFadeStyle() {
    if (document.getElementById('exp-fade-style')) return;
    const s = document.createElement('style');
    s.id = 'exp-fade-style';
    s.textContent = `
.expedition-fade {
  position: absolute; inset: 0; z-index: 500;
  background: #000; opacity: 0; pointer-events: none;
  transition: opacity 0.35s ease;
}
.expedition-fade.in, .expedition-fade.out { opacity: 1; pointer-events: auto; }
`;
    document.head.appendChild(s);
  }
}
