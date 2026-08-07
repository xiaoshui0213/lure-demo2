import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier 物理封装 —— 面向 boat + rocks 的最小 API
 *
 * 世界重力设 0，因为船的 Y 位置由 Gerstner 波高驱动，不需要模拟重力。
 * 船用 KinematicPositionBased body + 官方 CharacterController，
 * 支持沿 obstacle 表面滑行、越过小台阶、按半径感知障碍等特性。
 */

export type RapierType = typeof RAPIER;

let rapier: RapierType | null = null;
let world: RAPIER.World | null = null;

export async function initPhysics(): Promise<{ rapier: RapierType; world: RAPIER.World }> {
  if (rapier && world) return { rapier, world };
  await RAPIER.init();
  rapier = RAPIER;
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  return { rapier, world };
}

export function stepPhysics(dt: number) {
  if (!world) return;
  world.timestep = Math.min(dt, 1 / 30);
  world.step();
}

/**
 * 从 Object3D（含任意子 Mesh 结构）提取世界坐标下的所有顶点，
 * 生成一个 static 刚体 + convex-hull collider —— 精确贴合模型外形
 */
export function addStaticConvexCollider(root: THREE.Object3D): RAPIER.RigidBody | null {
  if (!rapier || !world) return null;

  root.updateMatrixWorld(true);

  // 收集所有 mesh 子节点的世界空间顶点
  const vertices: number[] = [];
  const tmp = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      tmp.applyMatrix4(m.matrixWorld);
      vertices.push(tmp.x, tmp.y, tmp.z);
    }
  });

  if (vertices.length < 12) return null; // 至少 4 顶点

  // 顶点数太多时降采样，但保留极限点（bbox 8 角 + 6 面中点）避免 hull 收缩
  // Rapier 内部会做 hull 计算，多给几千顶点没关系
  const MAX_VERTS = 4000;
  const totalVerts = vertices.length / 3;
  let vertData: Float32Array;
  if (totalVerts > MAX_VERTS) {
    // 先算 bbox，把 8 个角点强制加入，防止降采样丢边缘顶点导致 hull 缩小
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < totalVerts; i++) {
      const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cornerVerts: number[] = [];
    for (const bx of [minX, maxX]) for (const by of [minY, maxY]) for (const bz of [minZ, maxZ]) {
      cornerVerts.push(bx, by, bz);
    }
    const stride = Math.max(1, Math.floor(totalVerts / MAX_VERTS));
    const sampled: number[] = [...cornerVerts];
    for (let i = 0; i < totalVerts; i += stride) {
      sampled.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
    }
    vertData = new Float32Array(sampled);
  } else {
    vertData = new Float32Array(vertices);
  }

  const bodyDesc = rapier.RigidBodyDesc.fixed();
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.convexHull(vertData);
  if (!colliderDesc) {
    console.warn('[physics] convex hull 生成失败');
    world.removeRigidBody(body);
    return null;
  }
  world.createCollider(colliderDesc, body);
  return body;
}

/**
 * 创建船的 kinematic 刚体 + character controller
 * - 用长方体 collider（贴合细长船身），配合 offset 让 collider 中心对齐船的视觉中心
 * - 每帧需 setNextKinematicRotation 同步船头朝向，否则 collider 会一直朝世界 X 方向
 */
export function createKinematicBoat(
  halfExtents: THREE.Vector3,       // 长方体半宽（x=船长/2, y=船高/2, z=船宽/2）
  localOffset: THREE.Vector3,       // collider 中心相对 body 位置的偏移（船头偏心时用）
  initPos: THREE.Vector3,
): { body: RAPIER.RigidBody; controller: RAPIER.KinematicCharacterController; collider: RAPIER.Collider } {
  if (!rapier || !world) throw new Error('physics not initialized');

  const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(initPos.x, initPos.y, initPos.z);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
    .setTranslation(localOffset.x, localOffset.y, localOffset.z);
  const collider = world.createCollider(colliderDesc, body);

  const controller = world.createCharacterController(0.05);   // 稍大的 offset，防止贴脸穿模
  controller.setSlideEnabled(true);
  // 船在水面移动，没有"地面"和"台阶"概念，禁用避免异常
  controller.setApplyImpulsesToDynamicBodies(false);

  return { body, controller, collider };
}

export function getWorld(): RAPIER.World | null { return world; }
export function getRapier(): RapierType | null { return rapier; }
