import Phaser from 'phaser';
import { StartScene } from './scenes/StartScene';
import { GameScene }  from './scenes/GameScene';
import { W, H } from './constants';

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#060c18',
  scene: [StartScene, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  parent: document.body,
});
