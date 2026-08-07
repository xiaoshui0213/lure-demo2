import * as THREE from 'three';
import { createStylizedMaterial, attachOutlinesToStylizedMeshes } from '../render/StylizedMaterial';

/**
 * 低多边形船只（占位，Peak / 参考图风格）
 * 用基础几何拼装 —— 后续可换成 glTF 资产
 *
 * 材质：统一走 StylizedMaterial（3渲2 + 冷暖色带 + 弱 Rim），保持画风一致
 */
export function createBoat(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'boat';

  const hullMat     = createStylizedMaterial({ color: '#7ec6b1', flatShading: true });
  const hullDarkMat = createStylizedMaterial({ color: '#3d6f68', flatShading: true });
  const woodMat     = createStylizedMaterial({ color: '#c48b5a', flatShading: true });
  const woodDarkMat = createStylizedMaterial({ color: '#7a4b2b', flatShading: true });
  const metalMat    = createStylizedMaterial({ color: '#2d2d2d', flatShading: true });

  // 船体（下半：绿色低多边形梯形体）
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.0, 0);
  hullShape.lineTo(2.0, 0);
  hullShape.lineTo(1.5, 0.9);
  hullShape.lineTo(-1.5, 0.9);
  hullShape.lineTo(-2.0, 0);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 5.5,
    bevelEnabled: false,
    curveSegments: 4,
  });
  hullGeo.translate(0, -0.9, -2.75);
  hullGeo.rotateY(Math.PI / 2);
  // 前端尖头
  const bowGeo = new THREE.ConeGeometry(1.6, 2.2, 4, 1);
  bowGeo.rotateZ(-Math.PI / 2);
  bowGeo.rotateY(Math.PI / 4);
  bowGeo.translate(3.6, -0.45, 0);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  const bow = new THREE.Mesh(bowGeo, hullMat);
  hull.castShadow = true;
  bow.castShadow = true;
  group.add(hull, bow);

  // 船体上缘（深色描边条）
  const rimGeo = new THREE.BoxGeometry(6.5, 0.12, 4.0);
  const rim = new THREE.Mesh(rimGeo, hullDarkMat);
  rim.position.y = 0.05;
  group.add(rim);

  // 甲板
  const deckGeo = new THREE.BoxGeometry(6.2, 0.08, 3.7);
  const deck = new THREE.Mesh(deckGeo, woodMat);
  deck.position.y = 0.08;
  group.add(deck);

  // 舱室
  const cabinGeo = new THREE.BoxGeometry(1.8, 1.2, 2.4);
  const cabin = new THREE.Mesh(cabinGeo, woodMat);
  cabin.position.set(-1.2, 0.75, 0);
  cabin.castShadow = true;
  group.add(cabin);

  const roofGeo = new THREE.BoxGeometry(2.0, 0.1, 2.6);
  const roof = new THREE.Mesh(roofGeo, woodDarkMat);
  roof.position.set(-1.2, 1.4, 0);
  group.add(roof);

  // 桅杆
  const mastGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.5, 6);
  const mast = new THREE.Mesh(mastGeo, woodDarkMat);
  mast.position.set(0.3, 2.3, 0);
  mast.castShadow = true;
  group.add(mast);

  // 桅杆横梁
  const crossGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
  crossGeo.rotateZ(Math.PI / 2);
  const cross = new THREE.Mesh(crossGeo, woodDarkMat);
  cross.position.set(0.3, 3.4, 0);
  group.add(cross);

  // 钓鱼杆（斜插在船头右舷）
  const rodGeo = new THREE.CylinderGeometry(0.03, 0.02, 3.2, 6);
  const rod = new THREE.Mesh(rodGeo, metalMat);
  rod.position.set(2.0, 1.1, 1.3);
  rod.rotation.z = -Math.PI / 4;
  rod.rotation.y = -Math.PI / 8;
  group.add(rod);

  // 救生圈
  const ringGeo = new THREE.TorusGeometry(0.3, 0.08, 6, 12);
  const ringMat = createStylizedMaterial({ color: '#ff6b6b', flatShading: true });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(-0.6, 0.55, 1.7);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  attachOutlinesToStylizedMeshes(group);
  return group;
}
