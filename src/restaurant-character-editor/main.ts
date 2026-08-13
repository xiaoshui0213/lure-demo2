import Phaser from 'phaser';
import {
  DEFAULT_RESTAURANT_CHARACTER_LAYOUT,
  cloneDefaultRestaurantCharacterLayout,
  loadRestaurantCharacterLayout,
  saveRestaurantCharacterLayout,
  type RestaurantCharacterLayout,
  type RestaurantCharacterPoseId,
} from '../fishing-scene/restaurantCharacterLayout';

const VIEW_W = 1280;
const VIEW_H = 720;
const PLAYER_ANCHOR = { x: 640, y: 398 };
const CUSTOMER_ANCHOR = { x: 590, y: 500 };
const POSE_IDS: RestaurantCharacterPoseId[] = [
  'playerIdle',
  'playerWalk',
  'youngWomanWalk',
  'youngWomanSeated',
];

function byId<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing editor element: ${id}`);
  return element as T;
}

class RestaurantCharacterEditor extends Phaser.Scene {
  private layout: RestaurantCharacterLayout = loadRestaurantCharacterLayout();
  private selectedPose: RestaurantCharacterPoseId = 'playerIdle';
  private sprites = new Map<RestaurantCharacterPoseId, Phaser.GameObjects.Sprite>();
  private selection!: Phaser.GameObjects.Graphics;
  private anchorGuide!: Phaser.GameObjects.Graphics;
  private animationsPaused = false;

  constructor() {
    super('RestaurantCharacterEditor');
  }

  preload() {
    this.load.image('restaurant-background', '/fishing/restaurant-background-new.png');
    this.load.image(
      'player-idle',
      '/fishing/restaurant/characters/player/player-idle-front.png',
    );
    this.load.spritesheet(
      'player-walk',
      '/fishing/restaurant/characters/player/player-walk-right.png',
      { frameWidth: 320, frameHeight: 600 },
    );
    this.load.image(
      'woman-seated',
      '/fishing/restaurant/characters/customers/young-woman/young-woman-seated-back.png',
    );
    this.load.spritesheet(
      'woman-walk',
      '/fishing/restaurant/characters/customers/young-woman/young-woman-walk-right.png',
      { frameWidth: 420, frameHeight: 720 },
    );
  }

  create() {
    this.add.image(VIEW_W / 2, VIEW_H / 2, 'restaurant-background')
      .setDisplaySize(VIEW_W, VIEW_H);
    this.createAnimations();
    this.anchorGuide = this.add.graphics().setDepth(50);
    this.selection = this.add.graphics().setDepth(51);

    this.createPoseSprite('playerIdle', 'player-idle', PLAYER_ANCHOR);
    this.createPoseSprite('playerWalk', 'player-walk', PLAYER_ANCHOR, 'editor-player-walk');
    this.createPoseSprite('youngWomanWalk', 'woman-walk', CUSTOMER_ANCHOR, 'editor-woman-walk');
    this.createPoseSprite('youngWomanSeated', 'woman-seated', CUSTOMER_ANCHOR);

    this.bindDom();
    this.selectPose(this.selectedPose);
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.handleArrowKey(event));
  }

  update() {
    this.drawSelection();
  }

  private createAnimations() {
    if (!this.anims.exists('editor-player-walk')) {
      this.anims.create({
        key: 'editor-player-walk',
        frames: this.anims.generateFrameNumbers('player-walk', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists('editor-woman-walk')) {
      this.anims.create({
        key: 'editor-woman-walk',
        frames: this.anims.generateFrameNumbers('woman-walk', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private anchorFor(poseId: RestaurantCharacterPoseId) {
    return poseId.startsWith('player') ? PLAYER_ANCHOR : CUSTOMER_ANCHOR;
  }

  private createPoseSprite(
    poseId: RestaurantCharacterPoseId,
    texture: string,
    anchor: { x: number; y: number },
    animation?: string,
  ) {
    const pose = this.layout[poseId];
    const sprite = this.add.sprite(
      anchor.x + pose.offsetX,
      anchor.y + pose.offsetY,
      texture,
    )
      .setOrigin(0.5, 1)
      .setDisplaySize(pose.width, pose.height)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    this.input.setDraggable(sprite);
    if (animation) sprite.play(animation);
    sprite.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const currentAnchor = this.anchorFor(poseId);
      pose.offsetX = Math.round(dragX - currentAnchor.x);
      pose.offsetY = Math.round(dragY - currentAnchor.y);
      sprite.setPosition(dragX, dragY);
      this.syncWalkingPoseFromReference(poseId);
      this.refreshForm();
    });
    this.sprites.set(poseId, sprite);
  }

  private bindDom() {
    document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectPose(button.dataset.pose as RestaurantCharacterPoseId);
      });
    });
    for (const id of ['offset-x', 'offset-y', 'width', 'height']) {
      byId<HTMLInputElement>(id).addEventListener('input', () => this.applyForm());
    }
    byId<HTMLButtonElement>('scale-down').addEventListener('click', () => this.scaleSelected(0.9));
    byId<HTMLButtonElement>('scale-up').addEventListener('click', () => this.scaleSelected(1.1));
    byId<HTMLButtonElement>('scale-reset').addEventListener('click', () => {
      this.layout[this.selectedPose] = structuredClone(
        DEFAULT_RESTAURANT_CHARACTER_LAYOUT[this.selectedPose],
      );
      this.syncWalkingPoseFromReference(this.selectedPose);
      this.applySelectedPose();
      this.refreshForm();
    });
    byId<HTMLButtonElement>('reset-all').addEventListener('click', () => {
      this.layout = cloneDefaultRestaurantCharacterLayout();
      for (const poseId of POSE_IDS) this.applyPose(poseId);
      this.refreshForm();
      this.setStatus('已恢复默认值，点击“保存并应用”后写入游戏。');
    });
    byId<HTMLButtonElement>('save').addEventListener('click', () => {
      saveRestaurantCharacterLayout(this.layout);
      this.setStatus('已保存。刷新钓鱼 Demo 后生效。');
    });
    byId<HTMLButtonElement>('open-game').addEventListener('click', () => {
      window.open('/fishing-demo.html', '_blank');
    });
    byId<HTMLButtonElement>('toggle-animation').addEventListener('click', () => {
      this.animationsPaused = !this.animationsPaused;
      for (const poseId of ['playerWalk', 'youngWomanWalk'] as RestaurantCharacterPoseId[]) {
        const sprite = this.sprites.get(poseId);
        if (!sprite) continue;
        if (this.animationsPaused) sprite.anims.pause();
        else sprite.anims.resume();
      }
      byId<HTMLButtonElement>('toggle-animation').textContent = this.animationsPaused
        ? '继续动画'
        : '暂停动画';
    });
  }

  private selectPose(poseId: RestaurantCharacterPoseId) {
    this.selectedPose = poseId;
    for (const [id, sprite] of this.sprites) sprite.setVisible(id === poseId);
    document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((button) => {
      button.classList.toggle('active', button.dataset.pose === poseId);
    });
    this.refreshForm();
    this.drawAnchor();
  }

  private applyForm() {
    const pose = this.layout[this.selectedPose];
    pose.offsetX = Number(byId<HTMLInputElement>('offset-x').value);
    pose.offsetY = Number(byId<HTMLInputElement>('offset-y').value);
    pose.width = Math.max(10, Number(byId<HTMLInputElement>('width').value));
    pose.height = Math.max(20, Number(byId<HTMLInputElement>('height').value));
    this.syncWalkingPoseFromReference(this.selectedPose);
    this.applySelectedPose();
  }

  private refreshForm() {
    const pose = this.layout[this.selectedPose];
    byId<HTMLInputElement>('offset-x').value = String(Math.round(pose.offsetX));
    byId<HTMLInputElement>('offset-y').value = String(Math.round(pose.offsetY));
    byId<HTMLInputElement>('width').value = String(Math.round(pose.width));
    byId<HTMLInputElement>('height').value = String(Math.round(pose.height));
  }

  private applySelectedPose() {
    this.applyPose(this.selectedPose);
  }

  private applyPose(poseId: RestaurantCharacterPoseId) {
    const sprite = this.sprites.get(poseId);
    if (!sprite) return;
    const pose = this.layout[poseId];
    const anchor = this.anchorFor(poseId);
    sprite
      .setPosition(anchor.x + pose.offsetX, anchor.y + pose.offsetY)
      .setDisplaySize(pose.width, pose.height);
  }

  private scaleSelected(factor: number) {
    const pose = this.layout[this.selectedPose];
    pose.width = Math.round(pose.width * factor);
    pose.height = Math.round(pose.height * factor);
    this.syncWalkingPoseFromReference(this.selectedPose);
    this.applySelectedPose();
    this.refreshForm();
  }

  private handleArrowKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const pose = this.layout[this.selectedPose];
    if (event.key === 'ArrowLeft') pose.offsetX -= step;
    if (event.key === 'ArrowRight') pose.offsetX += step;
    if (event.key === 'ArrowUp') pose.offsetY -= step;
    if (event.key === 'ArrowDown') pose.offsetY += step;
    this.syncWalkingPoseFromReference(this.selectedPose);
    this.applySelectedPose();
    this.refreshForm();
  }

  private syncWalkingPoseFromReference(poseId: RestaurantCharacterPoseId) {
    if (poseId !== 'playerIdle') return;
    const widthRatio = DEFAULT_RESTAURANT_CHARACTER_LAYOUT.playerWalk.width
      / DEFAULT_RESTAURANT_CHARACTER_LAYOUT.playerIdle.width;
    this.layout.playerWalk = {
      offsetX: this.layout.playerIdle.offsetX,
      offsetY: this.layout.playerIdle.offsetY,
      width: Math.round(this.layout.playerIdle.width * widthRatio),
      height: this.layout.playerIdle.height,
    };
    this.applyPose('playerWalk');
  }

  private drawAnchor() {
    const anchor = this.anchorFor(this.selectedPose);
    this.anchorGuide
      .clear()
      .lineStyle(1, 0xf2c879, 0.9)
      .lineBetween(anchor.x - 12, anchor.y, anchor.x + 12, anchor.y)
      .lineBetween(anchor.x, anchor.y - 12, anchor.x, anchor.y + 12);
  }

  private drawSelection() {
    const sprite = this.sprites.get(this.selectedPose);
    if (!sprite) return;
    const bounds = sprite.getBounds();
    this.selection
      .clear()
      .lineStyle(1.5, 0xffd68c, 0.95)
      .strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  private setStatus(text: string) {
    byId<HTMLDivElement>('status').textContent = text;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'scene-canvas',
  width: VIEW_W,
  height: VIEW_H,
  transparent: true,
  scene: RestaurantCharacterEditor,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
