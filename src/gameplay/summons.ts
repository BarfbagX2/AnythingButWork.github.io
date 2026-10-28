import type { Simulation } from '../core/simulation';
import { distXZ } from '../core/math';
import type { AnyUnit, Summon } from './entities';
import { SF } from './types';

const pushN = { x: 0, z: 0 };

/** Summoned units: thralls follow and fight for their owner, turrets hold position. */
export function updateSummons(sim: Simulation, dt: number): void {
  for (const s of sim.summons) {
    if (!s.alive) continue;
    s.attackAnim = Math.max(0, s.attackAnim - dt);
    if (sim.time >= s.endTime) {
      sim.killUnit(s, -1);
      continue;
    }
    if (s.flags & SF.STUN) continue;
    const owner = sim.units.get(s.ownerId);
    if (sim.tick % 15 === s.id % 15) s.targetId = pickTarget(sim, s, owner as AnyUnit | undefined);
    const target = s.targetId >= 0 ? (sim.units.get(s.targetId) as AnyUnit | undefined) : undefined;
    let mx = 0;
    let mz = 0;
    if (target && target.alive) {
      const d = distXZ(target.pos, s.pos);
      s.yaw = Math.atan2(target.pos.x - s.pos.x, target.pos.z - s.pos.z);
      if (d <= s.range + target.radius) {
        if (sim.time >= s.nextAttack) {
          s.nextAttack = sim.time + s.attackInterval;
          s.attackAnim = 0.25;
          const eye = { x: s.pos.x, y: s.pos.y + s.height * 0.8, z: s.pos.z };
          const tc = { x: target.pos.x, y: target.centerY(), z: target.pos.z };
          if (s.range <= 3.5) sim.dealDamage(target, { sourceId: s.id, amount: s.damage, type: 'spirit' });
          else if (!sim.world.segmentBlocked(eye, tc)) sim.fireUnitProjectile(s, eye, tc, s.damage, 70, 'ability', 1, s.range + 5);
        }
      } else if (s.behavior === 'thrall') {
        mx = (target.pos.x - s.pos.x) / d;
        mz = (target.pos.z - s.pos.z) / d;
      }
    } else if (s.behavior === 'thrall' && owner && owner.alive) {
      const d = distXZ(owner.pos, s.pos);
      if (d > 4) {
        mx = (owner.pos.x - s.pos.x) / d;
        mz = (owner.pos.z - s.pos.z) / d;
      }
    }
    if (mx !== 0 || mz !== 0) {
      s.pos.x += mx * s.speed * dt;
      s.pos.z += mz * s.speed * dt;
      s.yaw = Math.atan2(mx, mz);
      sim.world.resolveCylinder(s.pos, s.radius, s.height, 0.6, pushN);
      s.pos.y = sim.world.groundHeight(s.pos.x, s.pos.z, s.pos.y + 0.8);
    }
    s.vel.x = mx * s.speed;
    s.vel.z = mz * s.speed;
  }
}

function pickTarget(sim: Simulation, s: Summon, owner: AnyUnit | undefined): number {
  // Prefer what the owner is shooting at.
  if (owner && owner.kind === 'hero' && owner.alive) {
    const ot = sim.lastTargetOf(owner.id);
    if (ot >= 0) {
      const u = sim.units.get(ot);
      if (u && u.alive && u.team !== s.team && distXZ(u.pos, s.pos) < s.range + 10) return u.id;
    }
  }
  let best = -1;
  let bestD = s.behavior === 'turret' ? s.range + 1 : 14;
  sim.forEachUnitNear(s.pos, bestD + 2, (u) => {
    if (!u.alive || u.team === s.team || u.kind === 'structure' && !u.vulnerable) return;
    if (u.flags & SF.INVISIBLE) return;
    const d = distXZ(u.pos, s.pos);
    const score = d + (u.kind === 'hero' ? -3 : 0);
    if (score < bestD) {
      bestD = score;
      best = u.id;
    }
  });
  return best;
}
