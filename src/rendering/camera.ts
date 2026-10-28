import * as THREE from 'three';
import { dirFromYawPitch } from '../core/math';
import type { CollisionWorld } from '../world/collision';
import { makeHit } from '../world/collision';

/**
 * Over-the-shoulder third-person camera. Yaw/pitch come straight from the
 * mouse each frame (not the simulation tick) for responsive aiming; the boom
 * is shortened when world geometry is in the way so the camera never clips
 * through walls.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  baseFov = 80;
  zoomFov = 50;
  zoom = 0;
  distance = 3.3;
  shoulder = 0.62;
  height = 0.32;
  private boom = 3.3;
  private kick = 0;
  private shake = 0;
  private hit = makeHit();
  freeCam = false;
  freePos = new THREE.Vector3(0, 60, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.08, 900);
  }

  addRecoil(deg: number): void {
    this.kick = Math.min(0.12, this.kick + (deg * Math.PI) / 180);
  }

  /** 1 = full screen shake; the "reduce camera shake" setting lowers it. */
  shakeScale = 1;

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount * this.shakeScale);
  }

  /** Current view pitch including visual recoil. */
  viewPitch(): number {
    return this.pitch + this.kick;
  }

  update(dt: number, eye: THREE.Vector3, world: CollisionWorld, zooming: boolean, zoomFov: number): void {
    this.zoom += ((zooming ? 1 : 0) - this.zoom) * (1 - Math.exp(-14 * dt));
    this.kick *= Math.exp(-10 * dt);
    this.shake *= Math.exp(-6 * dt);
    const fov = this.baseFov + (zoomFov - this.baseFov) * this.zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const pitch = this.viewPitch();
    if (this.freeCam) {
      this.camera.position.copy(this.freePos);
      const d = dirFromYawPitch({ x: 0, y: 0, z: 0 }, this.yaw, pitch);
      this.camera.lookAt(this.freePos.x + d.x, this.freePos.y + d.y, this.freePos.z + d.z);
      return;
    }
    const fwd = dirFromYawPitch({ x: 0, y: 0, z: 0 }, this.yaw, pitch);
    // Facing +Z with +Y up, the character's right-hand side is -X.
    const rightX = -Math.cos(this.yaw);
    const rightZ = Math.sin(this.yaw);
    const sh = this.shoulder * (1 - this.zoom * 0.3);
    const pivot = new THREE.Vector3(eye.x + rightX * sh, eye.y + this.height, eye.z + rightZ * sh);
    const desired = this.distance * (1 - this.zoom * 0.35);
    // Collision: cast from the head toward the shoulder pivot, then back along the boom.
    const head = { x: eye.x, y: eye.y + this.height, z: eye.z };
    const toPivot = { x: pivot.x - head.x, y: 0, z: pivot.z - head.z };
    const pl = Math.hypot(toPivot.x, toPivot.z);
    if (pl > 1e-4) {
      const t = world.raycast(head, { x: toPivot.x / pl, y: 0, z: toPivot.z / pl }, pl + 0.25, this.hit);
      if (t >= 0) {
        const s = Math.max(0, t - 0.25) / pl;
        pivot.set(head.x + toPivot.x * s, pivot.y, head.z + toPivot.z * s);
      }
    }
    const back = { x: -fwd.x, y: -fwd.y, z: -fwd.z };
    let allowed = desired;
    const t = world.raycast({ x: pivot.x, y: pivot.y, z: pivot.z }, back, desired + 0.3, this.hit);
    if (t >= 0) allowed = Math.max(0.35, t - 0.3);
    // Snap in quickly, ease out slowly.
    this.boom = allowed < this.boom ? allowed : this.boom + (allowed - this.boom) * (1 - Math.exp(-5 * dt));
    const pos = new THREE.Vector3(pivot.x + back.x * this.boom, pivot.y + back.y * this.boom, pivot.z + back.z * this.boom);
    if (pos.y < 0.3) pos.y = 0.3;
    if (this.shake > 0.01) pos.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25));
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.x + fwd.x, pos.y + fwd.y, pos.z + fwd.z);
  }

  /** World point under the crosshair (first solid hit, or far away). */
  crosshairTarget(world: CollisionWorld, maxDist: number, units: { pos: { x: number; y: number; z: number }; radius: number; height: number; id: number }[], ignoreId: number): THREE.Vector3 {
    const o = this.camera.position;
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    let best = maxDist;
    const t = world.raycast({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }, maxDist, this.hit);
    if (t >= 0) best = t;
    // Units under the crosshair (so aiming at a hero aims at the hero, not the wall behind).
    const tmp = new THREE.Vector3();
    for (const u of units) {
      if (u.id === ignoreId) continue;
      tmp.set(u.pos.x, u.pos.y + u.height * 0.55, u.pos.z).sub(o);
      const along = tmp.dot(d);
      if (along <= 0 || along >= best) continue;
      const perp2 = tmp.lengthSq() - along * along;
      const r = u.radius + 0.15;
      if (perp2 < r * r && Math.abs(tmp.y - d.y * along) < u.height * 0.6) best = along;
    }
    return new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
  }
}
