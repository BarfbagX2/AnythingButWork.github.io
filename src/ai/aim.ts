import type { DifficultyProfile } from '../../data/ai';
import { angleDiff, type Vec3 } from '../core/math';

/**
 * Human-like aiming. Bots:
 *  - notice a new target only after a reaction delay,
 *  - turn toward it at a limited rate (critically damped),
 *  - carry a smoothly varying positional error (in metres at the target)
 *    that grows with target speed and briefly overshoots after a flick,
 *  - lead projectiles using an intercept solution scaled by prediction skill.
 * Misses therefore look like plausible tracking errors, not random jitter.
 */
export class AimController {
  yaw = 0;
  pitch = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private targetKey = -1;
  private reactUntil = 0;
  private errX = 0;
  private errY = 0;
  private errVX = 0;
  private errVY = 0;
  private flick = 0;
  /** Angular error (rad) between current aim and the ideal direction. */
  error = Math.PI;

  constructor(
    private readonly diff: DifficultyProfile,
    private readonly rnd: () => number,
  ) {}

  reset(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.yawVel = 0;
    this.pitchVel = 0;
  }

  /** True while the bot is still "reacting" to its current target. */
  reacting(now: number): boolean {
    return now < this.reactUntil;
  }

  /**
   * Predicts where to aim at a moving target for a projectile of the given
   * speed (Infinity/0 = hitscan-like).
   */
  lead(from: Vec3, target: Vec3, vel: Vec3, speed: number, gravity = 0): Vec3 {
    const p = this.diff.prediction;
    if (!speed || !Number.isFinite(speed) || speed > 2000) return { ...target };
    let t = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z) / speed;
    for (let i = 0; i < 3; i++) {
      const px = target.x + vel.x * t * p;
      const pz = target.z + vel.z * t * p;
      const py = target.y + (vel.y > 0 ? vel.y * t * p * 0.5 : 0);
      t = Math.hypot(px - from.x, py - from.y, pz - from.z) / speed;
    }
    const out = { x: target.x + vel.x * t * p, y: target.y, z: target.z + vel.z * t * p };
    if (gravity > 0) out.y += 0.5 * gravity * t * t;
    return out;
  }

  /**
   * Updates aim toward `point` (already led). `key` identifies the target so
   * switching targets triggers a reaction delay and a flick.
   */
  update(now: number, dt: number, eye: Vec3, point: Vec3 | null, key: number, targetSpeed: number): void {
    const d = this.diff;
    if (key !== this.targetKey) {
      this.targetKey = key;
      if (key >= 0) {
        this.reactUntil = now + d.reaction * (0.75 + this.rnd() * 0.5);
        this.flick = 1;
      }
    }
    // Error random walk (Ornstein–Uhlenbeck style), metres at the target.
    const sigma = d.aimError * (1 + Math.min(1.5, targetSpeed / 6)) * (1 + this.flick * 1.2);
    const k = 3.5;
    this.errVX += (-this.errX * k * k - this.errVX * 2 * k) * dt + (this.rnd() - 0.5) * sigma * 18 * dt;
    this.errVY += (-this.errY * k * k - this.errVY * 2 * k) * dt + (this.rnd() - 0.5) * sigma * 10 * dt;
    this.errX += this.errVX * dt;
    this.errY += this.errVY * dt;
    this.flick = Math.max(0, this.flick - dt * 2.5);
    if (!point || now < this.reactUntil) {
      this.yawVel *= Math.exp(-6 * dt);
      this.pitchVel *= Math.exp(-6 * dt);
      this.error = Math.PI;
      return;
    }
    const dx = point.x - eye.x;
    const dz = point.z - eye.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    // Apply lateral/vertical error in metres → radians.
    const desiredYaw = Math.atan2(dx, dz) + this.errX / dist;
    const desiredPitch = Math.atan2(point.y - eye.y, dist) + this.errY / dist;
    const ey = angleDiff(desiredYaw, this.yaw);
    const ep = desiredPitch - this.pitch;
    // Critically damped spring with a turn-rate cap.
    const w = 14;
    this.yawVel += (ey * w * w - this.yawVel * 2 * w) * dt;
    this.pitchVel += (ep * w * w - this.pitchVel * 2 * w) * dt;
    const cap = d.turnRate;
    this.yawVel = Math.max(-cap, Math.min(cap, this.yawVel));
    this.pitchVel = Math.max(-cap, Math.min(cap, this.pitchVel));
    this.yaw += this.yawVel * dt;
    this.pitch += this.pitchVel * dt;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    const trueYaw = Math.atan2(dx, dz);
    const truePitch = Math.atan2(point.y - eye.y, dist);
    this.error = Math.hypot(angleDiff(trueYaw, this.yaw), truePitch - this.pitch);
  }

  /** Snap-free look toward a direction when not engaging (walking). */
  lookToward(dt: number, yaw: number, pitch: number): void {
    const ey = angleDiff(yaw, this.yaw);
    const rate = Math.min(1, dt * 6);
    this.yaw += ey * rate;
    this.pitch += (pitch - this.pitch) * rate;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.error = Math.PI;
  }
}
