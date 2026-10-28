import type { Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { Hero } from '../gameplay/entities';
import { EdgeKind, type NavGrid, type PathPoint } from '../world/nav';

export interface MoveIntent {
  moveX: number;
  moveZ: number;
  jump: boolean;
  interact: boolean;
  dash: boolean;
  crouch: boolean;
  /** Preferred look direction while travelling (yaw), if any. */
  lookYaw: number | null;
}

/**
 * Path following on the nav grid using only player inputs: walking,
 * jumping/double-jumping onto ledges (the mantle does the rest), stepping off
 * drops, and riding ziplines. Includes stuck detection and recovery.
 */
export class Navigator {
  path: PathPoint[] | null = null;
  idx = 0;
  dest: Vec3 | null = null;
  private lastRepath = -99;
  private progressPos: Vec3 = { x: 0, y: 0, z: 0 };
  private progressAt = 0;
  private stuckLevel = 0;
  private jumpPhase = 0;
  private zipTries = 0;
  private noZipUntil = 0;
  failed = false;
  /** Debug: last reason for a repath. */
  lastReason = '';

  constructor(
    private readonly nav: NavGrid,
    private readonly rnd: () => number,
  ) {}

  setDestination(sim: Simulation, hero: Hero, dest: Vec3, force = false): void {
    const moved = !this.dest || distXZ(this.dest, dest) > 3 || Math.abs(this.dest.y - dest.y) > 1.5;
    const stale = sim.time - this.lastRepath > 4;
    if (!force && !moved && !(stale && this.path && this.idx < this.path.length)) return;
    if (!force && sim.time - this.lastRepath < 0.4) return;
    this.dest = { ...dest };
    this.repath(sim, hero, moved ? 'new destination' : force ? 'forced' : 'refresh');
  }

  private repath(sim: Simulation, hero: Hero, reason: string): void {
    this.lastRepath = sim.time;
    this.lastReason = reason;
    if (!this.dest) return;
    const team = sim.time < this.noZipUntil ? -9 : hero.team;
    const p = this.nav.findPath(hero.pos, this.dest, team, 25000);
    this.failed = !p;
    this.path = p;
    this.idx = p && p.length > 1 ? 1 : 0;
    this.jumpPhase = 0;
  }

  clear(): void {
    this.path = null;
    this.dest = null;
  }

  arrived(hero: Hero, radius: number): boolean {
    return !!this.dest && distXZ(hero.pos, this.dest) <= radius && Math.abs(hero.pos.y - this.dest.y) < 2.5;
  }

  remaining(hero: Hero): number {
    if (!this.path) return this.dest ? distXZ(hero.pos, this.dest) : 0;
    let d = 0;
    let prev: Vec3 = hero.pos;
    for (let i = this.idx; i < this.path.length; i++) {
      d += distXZ(prev, this.path[i]);
      prev = this.path[i];
    }
    return d;
  }

  step(sim: Simulation, hero: Hero, out: MoveIntent): void {
    out.moveX = 0;
    out.moveZ = 0;
    out.jump = false;
    out.interact = false;
    out.dash = false;
    out.crouch = false;
    out.lookYaw = null;
    if (!this.path || !this.dest) return;

    // Riding a zipline: let it carry us, hop off near the end of our segment.
    if (hero.zip) {
      const wp = this.path[Math.min(this.idx, this.path.length - 1)];
      if (wp && distXZ(hero.pos, wp) < 5) out.jump = true;
      out.lookYaw = wp ? Math.atan2(wp.x - hero.pos.x, wp.z - hero.pos.z) : null;
      this.progressAt = sim.time;
      if (wp && distXZ(hero.pos, wp) < 6) this.idx = Math.min(this.idx + 1, this.path.length);
      return;
    }

    while (this.idx < this.path.length) {
      const wp = this.path[this.idx];
      const d = distXZ(hero.pos, wp);
      const dy = wp.y - hero.pos.y;
      const reach = this.idx === this.path.length - 1 ? 1.0 : wp.kind === EdgeKind.Zip ? 0 : 1.3;
      if (d < reach && Math.abs(dy) < 1.6) {
        this.idx++;
        this.jumpPhase = 0;
        continue;
      }
      break;
    }
    if (this.idx >= this.path.length) {
      // Final approach to the exact destination.
      const d = distXZ(hero.pos, this.dest);
      if (d > 0.8) {
        out.moveX = (this.dest.x - hero.pos.x) / d;
        out.moveZ = (this.dest.z - hero.pos.z) / d;
      }
      return;
    }
    const wp = this.path[this.idx];
    let tx = wp.x;
    let tz = wp.z;
    if (wp.kind === EdgeKind.Zip) {
      // Walk to the zipline start (previous node), face along the line, attach.
      const start = this.path[this.idx - 1] ?? hero.pos;
      const ds = distXZ(hero.pos, start);
      out.lookYaw = Math.atan2(wp.x - start.x, wp.z - start.z);
      if (ds > 1.6) {
        tx = start.x;
        tz = start.z;
      } else {
        out.interact = sim.tick % 6 === 0;
        this.zipTries++;
        if (this.zipTries > 120) {
          // Couldn't mount (wrong team line, cooldown...): avoid ziplines for a while.
          this.zipTries = 0;
          this.noZipUntil = sim.time + 20;
          this.repath(sim, hero, 'zipline failed');
        }
        return;
      }
    } else this.zipTries = 0;
    const dx = tx - hero.pos.x;
    const dz = tz - hero.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    out.moveX = dx / d;
    out.moveZ = dz / d;
    if (wp.kind === EdgeKind.Jump) {
      const dy = wp.y - hero.pos.y;
      if (dy > 0.4) {
        if (hero.grounded && d < 2.6) {
          out.jump = true;
          this.jumpPhase = 1;
        } else if (!hero.grounded && this.jumpPhase === 1 && hero.vel.y < 1.2 && dy > 0.9) {
          out.jump = true;
          this.jumpPhase = 2;
        }
      }
    }

    // Stuck detection & recovery.
    if (sim.time - this.progressAt > 1.2) {
      const moved = distXZ(hero.pos, this.progressPos) + Math.abs(hero.pos.y - this.progressPos.y);
      if (moved < 0.7) {
        this.stuckLevel++;
        if (this.stuckLevel === 1) out.jump = true;
        else if (this.stuckLevel === 2) this.repath(sim, hero, 'stuck');
        else if (this.stuckLevel >= 3) {
          const detour = this.nav.randomNear(hero.pos.x, hero.pos.z, 8, this.rnd);
          if (detour) {
            const saved = this.dest;
            this.dest = detour;
            this.repath(sim, hero, 'unstick detour');
            this.dest = saved;
            // Re-target the real destination after the detour.
            this.lastRepath = sim.time - 3.2;
          }
          this.stuckLevel = 0;
        }
      } else this.stuckLevel = 0;
      this.progressPos = { ...hero.pos };
      this.progressAt = sim.time;
    }
  }
}
