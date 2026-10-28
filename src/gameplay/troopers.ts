import { BALANCE } from '../../data/balance';
import { TROOPERS } from '../../data/units';
import type { Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { AnyUnit, Trooper } from './entities';
import type { LaneId, TeamId } from '../world/mapTypes';
import { SF } from './types';

const pushN = { x: 0, z: 0 };

/** Lane path oriented for a team (index 0 inside its own base). */
export function lanePathFor(sim: Simulation, lane: LaneId, team: TeamId): Vec3[] {
  const p = sim.map.lanes[lane].path;
  return team === 0 ? p : [...p].reverse();
}

export function spawnTrooper(sim: Simulation, team: TeamId, lane: LaneId, type: string, slot: number): Trooper | null {
  const def = TROOPERS[type];
  if (!def) throw new Error(`Unknown trooper type ${type}`);
  const path = lanePathFor(sim, lane, team);
  // Spawn at the base gate waypoint with a lateral offset per slot.
  // Spawn at the base gate: side lanes have an extra in-base waypoint.
  const startIdx = Math.max(0, Math.min(lane === 1 ? 1 : 2, path.length - 2));
  const a = path[startIdx];
  const b = path[startIdx + 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const side = ((slot % 3) - 1) * 1.6;
  const back = Math.floor(slot / 3) * 1.8;
  const t = sim.addTrooper(team, def, lane, path);
  t.pos.x = a.x + (-dz / l) * side - (dx / l) * back;
  t.pos.z = a.z + (dx / l) * side - (dz / l) * back;
  t.pos.y = sim.world.groundHeight(t.pos.x, t.pos.z, 2);
  t.prevPos.x = t.pos.x;
  t.prevPos.y = t.pos.y;
  t.prevPos.z = t.pos.z;
  t.pathIndex = startIdx + 1;
  t.yaw = Math.atan2(dx, dz);
  const minutes = Math.max(0, sim.matchTime / 60);
  let hpMul = 1 + BALANCE.waves.hpGrowthPerMinute * minutes;
  if (sim.teams[team].rejuvenatorUntil > sim.time) {
    hpMul *= BALANCE.midBoss.rejuvenatorTrooperHpMul;
    t.buffed = true;
  }
  t.maxHp = Math.round(def.maxHp * hpMul);
  t.hp = t.maxHp;
  t.progressPos.x = t.pos.x;
  t.progressPos.z = t.pos.z;
  t.progressCheck = sim.time + 2;
  return t;
}

function targetScore(t: Trooper, u: AnyUnit, d: number): number {
  switch (u.kind) {
    case 'trooper':
    case 'summon':
      return d;
    case 'structure':
      return d + 4;
    case 'hero':
      return d + 9;
    default:
      return d + 20;
  }
}

function acquireTarget(sim: Simulation, t: Trooper): void {
  const range = t.def.range + 5;
  if (t.aggroHero >= 0 && sim.time < t.aggroUntil) {
    const h = sim.units.get(t.aggroHero);
    if (h && h.alive && distXZ(h.pos, t.pos) < range + 3 && !(h.flags & SF.INVISIBLE)) {
      t.targetId = h.id;
      return;
    }
  }
  let best: AnyUnit | null = null;
  let bestScore = Infinity;
  sim.forEachUnitNear(t.pos, range + 3, (u) => {
    if (!u.alive || u.team === t.team || u.team === 2) return;
    if (u.kind === 'structure' && !u.vulnerable) return;
    if (u.flags & SF.INVISIBLE) return;
    const d = distXZ(u.pos, t.pos) - u.radius;
    if (d > range) return;
    if (Math.abs(u.pos.y - t.pos.y) > 6) return;
    const s = targetScore(t, u, d);
    if (s < bestScore) {
      bestScore = s;
      best = u;
    }
  });
  t.targetId = best ? (best as AnyUnit).id : -1;
}

export function updateTroopers(sim: Simulation, dt: number): void {
  const world = sim.world;
  for (const t of sim.troopers) {
    if (!t.alive) continue;
    if (t.flags & SF.STUN) continue;
    t.attackAnim = Math.max(0, t.attackAnim - dt);
    if (sim.time >= t.nextRetarget) {
      t.nextRetarget = sim.time + 0.3 + (t.id % 7) * 0.02;
      acquireTarget(sim, t);
    }
    const target = t.targetId >= 0 ? (sim.units.get(t.targetId) as AnyUnit | undefined) : undefined;
    let mx = 0;
    let mz = 0;
    const eye = { x: t.pos.x, y: t.pos.y + t.height * 0.85, z: t.pos.z };
    if (target && target.alive) {
      const dx = target.pos.x - t.pos.x;
      const dz = target.pos.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = t.def.range + target.radius;
      t.yaw = Math.atan2(dx, dz);
      const tc = { x: target.pos.x, y: target.kind === 'structure' ? target.pos.y + 2.5 : target.centerY(), z: target.pos.z };
      const inRange = d <= reach;
      const los = inRange && !world.segmentBlocked(eye, tc);
      if (inRange && los) {
        if (sim.time >= t.nextAttack) {
          t.nextAttack = sim.time + t.def.attackInterval * (0.9 + sim.rng.next() * 0.2);
          t.attackAnim = 0.2;
          const fireMul = t.buffed ? 1 + BALANCE.midBoss.rejuvenatorFireRatePct / 100 : 1;
          t.nextAttack = sim.time + (t.nextAttack - sim.time) / fireMul;
          const growth = 1 + BALANCE.waves.damageGrowthPerMinute * Math.max(0, sim.matchTime / 60);
          if (t.def.melee) {
            const dmg = t.def.damage * growth * (target.kind === 'hero' ? t.def.heroDamageMul : 1);
            sim.dealDamage(target, { sourceId: t.id, amount: dmg, type: 'bullet' });
          } else {
            // Slight lead on moving targets.
            const flight = d / t.def.projectileSpeed;
            tc.x += target.vel.x * flight * 0.6;
            tc.z += target.vel.z * flight * 0.6;
            sim.fireUnitProjectile(t, eye, tc, t.def.damage * growth, t.def.projectileSpeed, 'trooper', t.def.heroDamageMul, t.def.range + 6);
          }
        }
      } else {
        // Chase, but stay near the lane.
        mx = dx / (d || 1);
        mz = dz / (d || 1);
        if (!inRange && distXZ(t.pos, t.path[Math.min(t.pathIndex, t.path.length - 1)]) > 40) t.targetId = -1;
        if (inRange && !los) {
          // Side-step to find a line of sight.
          mx += -dz / (d || 1) * 0.6;
          mz += dx / (d || 1) * 0.6;
        }
      }
    } else if (t.pathIndex < t.path.length) {
      const wp = t.path[t.pathIndex];
      const dx = wp.x - t.pos.x;
      const dz = wp.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.5) t.pathIndex++;
      mx = dx / (d || 1);
      mz = dz / (d || 1);
      t.yaw = Math.atan2(dx, dz);
    }

    // Medic heals the most injured nearby ally trooper.
    const heals = t.def.heals;
    if (heals && sim.time >= t.nextHeal) {
      t.nextHeal = sim.time + heals.interval;
      let best: Trooper | null = null;
      let bestFrac = 0.95;
      for (const o of sim.troopers) {
        if (!o.alive || o.team !== t.team || o === t) continue;
        if (distXZ(o.pos, t.pos) > heals.range) continue;
        const f = o.hp / o.maxHp;
        if (f < bestFrac) {
          bestFrac = f;
          best = o;
        }
      }
      if (best) {
        sim.heal(best, heals.amount, t.id, true);
        sim.events.push({ t: 'vfx', kind: 'healBeam', pos: { ...eye }, to: { x: best.pos.x, y: best.centerY(), z: best.pos.z }, radius: 0.1, color: '#7dffb0', duration: 0.25 });
      }
    }

    // Separation from allied troopers.
    let sx = 0;
    let sz = 0;
    sim.grid.query(t.pos.x, t.pos.z, 1.6, (o) => {
      if (o === t || o.kind !== 'trooper' || !o.alive) return;
      const dx = t.pos.x - o.pos.x;
      const dz = t.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.4 * 1.4 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        sx += (dx / d) * (1.4 - d);
        sz += (dz / d) * (1.4 - d);
      }
    });
    const speed = t.def.speed * slowMul(t);
    t.vel.x = mx * speed + sx * 3;
    t.vel.z = mz * speed + sz * 3;
    // Knockback impulses decay.
    t.pos.x += t.vel.x * dt;
    t.pos.z += t.vel.z * dt;
    world.resolveCylinder(t.pos, t.radius, t.height, 0.6, pushN);
    sim.resolveStructureCollision(t);
    t.pos.y = world.groundHeight(t.pos.x, t.pos.z, t.pos.y + 0.6);

    // Stuck detection: skip ahead / nudge if no progress.
    if (sim.time >= t.progressCheck) {
      const moved = Math.hypot(t.pos.x - t.progressPos.x, t.pos.z - t.progressPos.z);
      if (moved < 0.8 && (mx !== 0 || mz !== 0)) {
        t.stuckTime += 2;
        if (t.stuckTime >= 6) {
          t.targetId = -1;
          if (t.pathIndex < t.path.length - 1) t.pathIndex++;
          t.stuckTime = 0;
        }
      } else t.stuckTime = 0;
      t.progressPos.x = t.pos.x;
      t.progressPos.z = t.pos.z;
      t.progressCheck = sim.time + 2;
    }
  }
}

export function slowMul(u: { statuses: { spec: { mods?: { moveSpeedPct?: number } }; stacks: number }[]; flags: number }): number {
  if (u.flags & SF.ROOT) return 0;
  let pct = 0;
  for (const s of u.statuses) pct += (s.spec.mods?.moveSpeedPct ?? 0) * s.stacks;
  return Math.max(0.25, 1 + pct / 100);
}
