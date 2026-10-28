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
  private flick = 0;
  /** Previous ideal direction, for estimating the target's angular velocity. */
  private lastIdealYaw = 0;
  private lastIdealPitch = 0;
  private haveIdeal = false;
  private ffYaw = 0;
  private ffPitch = 0;
  /** True angular error (rad) between current aim and the ideal direction (debug). */
  trueError = Math.PI;
  /**
   * Error the bot *believes* it has: distance to its own (noisy) estimate of
   * where to aim. Trigger decisions use this, so aim noise produces genuine
   * misses instead of the bot waiting for its noise to cross zero.
   */
  error = Math.PI;

  constructor(
    private readonly diff: DifficultyProfile,
    private readonly rnd: () => number,
  ) {}

  private gauss(): number {
    // Sum of uniforms: mean 0, std 1 (close enough to normal here).
    return (this.rnd() + this.rnd() + this.rnd() + this.rnd() - 2) * 1.7320508;
  }

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
      this.haveIdeal = false;
      if (key >= 0) {
        this.reactUntil = now + d.reaction * (0.75 + this.rnd() * 0.5);
        this.flick = 1;
      }
    }
    // Aim error: an Ornstein–Uhlenbeck process in metres at the target whose
    // stationary std is sigma (correlation time ~0.4 s). Error grows with
    // target speed and distance (human precision is angular) and spikes
    // briefly after a flick to a new target.
    const range = point ? Math.hypot(point.x - eye.x, point.z - eye.z) : 20;
    const sigma = d.aimError * (1 + Math.min(1.2, targetSpeed / 10)) * (0.6 + range / 30) * (1 + this.flick * 1.5);
    const theta = 2.5;
    const kick = sigma * Math.sqrt(2 * theta * dt);
    this.errX += -this.errX * theta * dt + kick * this.gauss();
    this.errY += -this.errY * theta * dt + kick * 0.6 * this.gauss();
    this.flick = Math.max(0, this.flick - dt * 2.5);
    if (!point || now < this.reactUntil) {
      this.yawVel *= Math.exp(-6 * dt);
      this.pitchVel *= Math.exp(-6 * dt);
      this.error = Math.PI;
      this.trueError = Math.PI;
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
    // Target angular velocity (feed-forward): humans track by matching the
    // target's motion, so the spring damps relative to it. Skill scales how
    // well the motion is matched; without it a spring lags moving targets.
    const idealYaw = Math.atan2(dx, dz);
    const idealPitch = Math.atan2(point.y - eye.y, dist);
    if (this.haveIdeal && dt > 0) {
      // Perceived angular velocity lags reality by roughly a reaction time,
      // so sudden direction changes ("jukes") cause plausible misses.
      const k = 1 - Math.exp(-dt / Math.max(0.05, d.reaction * 0.8));
      this.ffYaw += ((angleDiff(idealYaw, this.lastIdealYaw) / dt) * d.prediction - this.ffYaw) * k;
      this.ffPitch += (((idealPitch - this.lastIdealPitch) / dt) * d.prediction - this.ffPitch) * k;
    } else {
      this.ffYaw = 0;
      this.ffPitch = 0;
    }
    const ffYaw = this.ffYaw;
    const ffPitch = this.ffPitch;
    this.lastIdealYaw = idealYaw;
    this.lastIdealPitch = idealPitch;
    this.haveIdeal = true;
    // Critically damped spring with a turn-rate cap.
    const w = 14;
    this.yawVel += (ey * w * w - (this.yawVel - ffYaw) * 2 * w) * dt;
    this.pitchVel += (ep * w * w - (this.pitchVel - ffPitch) * 2 * w) * dt;
    const cap = d.turnRate;
    this.yawVel = Math.max(-cap, Math.min(cap, this.yawVel));
    this.pitchVel = Math.max(-cap, Math.min(cap, this.pitchVel));
    this.yaw += this.yawVel * dt;
    this.pitch += this.pitchVel * dt;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    this.trueError = Math.hypot(angleDiff(idealYaw, this.yaw), idealPitch - this.pitch);
    this.error = Math.hypot(angleDiff(desiredYaw, this.yaw), desiredPitch - this.pitch);
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
    this.trueError = Math.PI;
  }
}
