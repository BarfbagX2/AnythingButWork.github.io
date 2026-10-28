import { BALANCE } from '../../data/balance';
import { NEUTRALS } from '../../data/units';
import type { Simulation } from '../core/simulation';
import { distXZ } from '../core/math';
import type { AnyUnit, Neutral } from './entities';
import type { CampDef } from '../world/mapTypes';
import { SF } from './types';

const pushN = { x: 0, z: 0 };

export interface CampState {
  def: CampDef;
  unitIds: number[];
  respawnAt: number;
  clearedBy: number;
}

export interface BossState {
  unitId: number;
  respawnAt: number;
  kills: number;
}

export function initCamps(sim: Simulation): CampState[] {
  return sim.map.camps.map((def) => ({ def, unitIds: [], respawnAt: BALANCE.camps.firstSpawn, clearedBy: -1 }));
}

function spawnCamp(sim: Simulation, c: CampState): void {
  c.unitIds = [];
  c.def.units.forEach((type, i) => {
    const def = NEUTRALS[type];
    const a = (i / c.def.units.length) * Math.PI * 2;
    const n = sim.addNeutral(def, c.def.id, false);
    n.home.x = c.def.pos.x + Math.cos(a) * 2.2;
    n.home.z = c.def.pos.z + Math.sin(a) * 2.2;
    n.home.y = sim.world.groundHeight(n.home.x, n.home.z, 2);
    n.pos.x = n.prevPos.x = n.home.x;
    n.pos.z = n.prevPos.z = n.home.z;
    n.pos.y = n.prevPos.y = n.home.y;
    n.yaw = sim.rng.range(-Math.PI, Math.PI);
    c.unitIds.push(n.id);
  });
}

export function spawnBoss(sim: Simulation): Neutral {
  const def = NEUTRALS.midboss;
  const n = sim.addNeutral(def, 'boss', true);
  const p = sim.map.midBoss.pos;
  n.home.x = n.pos.x = n.prevPos.x = p.x;
  n.home.z = n.pos.z = n.prevPos.z = p.z;
  n.home.y = n.pos.y = n.prevPos.y = 0;
  const minutes = Math.max(0, sim.matchTime / 60);
  n.maxHp = Math.round(def.maxHp * (1 + 0.04 * minutes));
  n.hp = n.maxHp;
  n.bulletResist = 0.2;
  n.spiritResist = 0.2;
  sim.announce('The Hollow King has risen in the east plaza!', -1, 'boss');
  return n;
}

export function updateCamps(sim: Simulation): void {
  if (sim.matchTime < 0) return;
  for (const c of sim.camps) {
    const alive = c.unitIds.filter((id) => {
      const u = sim.units.get(id);
      return u && u.alive;
    });
    if (c.unitIds.length > 0 && alive.length === 0) {
      c.unitIds = [];
      c.respawnAt = sim.matchTime + BALANCE.camps.respawn;
    }
    if (c.unitIds.length === 0 && sim.matchTime >= c.respawnAt) spawnCamp(sim, c);
  }
  const b = sim.boss;
  if (b.unitId < 0 && sim.matchTime >= b.respawnAt) b.unitId = spawnBoss(sim).id;
}

/** Neutral creeps: idle until provoked, chase within a leash, then reset. */
export function updateNeutrals(sim: Simulation, dt: number): void {
  for (const n of sim.neutrals) {
    if (!n.alive) continue;
    n.attackAnim = Math.max(0, n.attackAnim - dt);
    if (n.flags & SF.STUN) continue;
    const isBoss = n.kind === 'boss';
    let target = n.targetId >= 0 ? (sim.units.get(n.targetId) as AnyUnit | undefined) : undefined;
    if (target && (!target.alive || distXZ(target.pos, n.home) > n.def.leash + 6)) {
      target = undefined;
      n.targetId = -1;
      if (!isBoss) n.leashing = true;
    }
    if (isBoss && (!target || sim.tick % 30 === 0)) {
      // The boss attacks the closest hero (of either team) inside its arena.
      let best: AnyUnit | null = null;
      let bestD = n.def.range + 6;
      sim.forEachUnitNear(n.pos, bestD, (u) => {
        if (!u.alive || u.kind !== 'hero' || u.flags & SF.INVISIBLE) return;
        const d = distXZ(u.pos, n.pos);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      });
      n.targetId = best ? (best as AnyUnit).id : -1;
      target = best ?? undefined;
    }
    let mx = 0;
    let mz = 0;
    if (n.leashing) {
      const dx = n.home.x - n.pos.x;
      const dz = n.home.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) {
        n.leashing = false;
        n.hp = n.maxHp;
        n.attackers.clear();
      } else {
        mx = dx / d;
        mz = dz / d;
        n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.2 * dt);
      }
    } else if (target) {
      const dx = target.pos.x - n.pos.x;
      const dz = target.pos.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      n.yaw = Math.atan2(dx, dz);
      const reach = n.def.range + target.radius + n.radius * 0.5;
      if (d <= reach) {
        if (sim.time >= n.nextAttack) {
          n.nextAttack = sim.time + n.def.attackInterval;
          n.attackAnim = 0.35;
          const minutes = Math.max(0, sim.matchTime / 60);
          const dmg = n.def.damage * (1 + 0.03 * minutes);
          if (n.def.melee) sim.dealDamage(target, { sourceId: n.id, amount: dmg, type: 'bullet' });
          else {
            const eye = { x: n.pos.x, y: n.pos.y + n.height * 0.8, z: n.pos.z };
            const tc = { x: target.pos.x, y: target.centerY(), z: target.pos.z };
            sim.fireUnitProjectile(n, eye, tc, dmg, isBoss ? 45 : 60, 'neutral', 1, n.def.range + 8);
          }
          if (isBoss && sim.rng.chance(0.25)) {
            // Slam: telegraphed AoE around the boss.
            const pos = { ...n.pos };
            sim.events.push({ t: 'vfx', kind: 'warn', pos, radius: 7, color: '#c04cff', duration: 0.9 });
            sim.addHazard(pos, 7, 0.95, 2);
            sim.schedule(0.9, () => {
              if (!n.alive) return;
              sim.forEachUnitNear(pos, 8, (u) => {
                if (u.kind !== 'hero' || !u.alive || distXZ(u.pos, pos) > 7 + u.radius) return;
                sim.dealDamage(u, { sourceId: n.id, amount: 160, type: 'spirit' });
                sim.knockbackUnit(u, u.pos.x - pos.x, u.pos.z - pos.z, 10, 5);
              });
              sim.events.push({ t: 'vfx', kind: 'shockwave', pos, radius: 7, color: '#c04cff', duration: 0.5 });
            });
          }
        }
      } else if (n.def.speed > 0) {
        mx = dx / d;
        mz = dz / d;
      }
    } else if (!isBoss) {
      const d = distXZ(n.pos, n.home);
      if (d > 1.5) {
        mx = (n.home.x - n.pos.x) / d;
        mz = (n.home.z - n.pos.z) / d;
      }
    }
    if (n.def.speed > 0 && (mx !== 0 || mz !== 0)) {
      const sp = n.def.speed * (n.leashing ? 1.4 : 1);
      n.pos.x += mx * sp * dt;
      n.pos.z += mz * sp * dt;
      n.yaw = Math.atan2(mx, mz);
      sim.world.resolveCylinder(n.pos, n.radius, n.height, 0.6, pushN);
      n.pos.y = sim.world.groundHeight(n.pos.x, n.pos.z, n.pos.y + 0.6);
    }
    n.vel.x = mx * n.def.speed;
    n.vel.z = mz * n.def.speed;
  }
}

/** When a camp member is attacked, the whole camp aggroes on the attacker. */
export function provokeCamp(sim: Simulation, n: Neutral, attackerId: number): void {
  if (n.kind === 'boss') return;
  const c = sim.camps.find((cc) => cc.def.id === n.campId);
  const ids = c ? c.unitIds : [n.id];
  for (const id of ids) {
    const u = sim.units.get(id);
    if (u && u.alive && u.kind === 'neutral' && !u.leashing && u.targetId < 0) u.targetId = attackerId;
  }
}
