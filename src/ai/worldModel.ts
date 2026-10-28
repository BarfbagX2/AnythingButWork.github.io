import type { Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { Structure } from '../gameplay/entities';
import type { LaneId, TeamId } from '../world/mapTypes';

/**
 * Team-level understanding of the map, rebuilt about once per second from
 * information the team legitimately has: its own units, its own structures,
 * enemy structures (always visible) and enemy units currently in team vision.
 */

export interface LaneState {
  lane: LaneId;
  /** Lane path oriented from our base toward the enemy base. */
  path: Vec3[];
  cum: number[];
  length: number;
  /** Furthest progress of our troopers (metres from our base), -1 if none. */
  ourFront: number;
  /** Closest progress of visible enemy troopers (metres from our base). */
  enemyFront: number;
  ourTroopers: number;
  enemyTroopers: number;
  /** Where the waves meet (or our front if no contact). */
  clash: number;
  /** Next enemy structure to destroy in this lane. */
  nextEnemyStructure: Structure | null;
  /** Our last standing structure in this lane (closest to the enemy). */
  ourOuterStructure: Structure | null;
  enemyHeroesSeen: number;
}

export interface StructureThreat {
  s: Structure;
  enemyHeroes: number;
  enemyTroopers: number;
  urgency: number;
}

export interface TeamModel {
  lanes: LaneState[];
  threats: StructureThreat[];
  aliveAllies: number;
  aliveEnemies: number;
  /** Rough team strength comparison (>1 means we're ahead). */
  advantage: number;
  netWorthDiff: number;
}

function cumulative(path: Vec3[]): number[] {
  const c = [0];
  for (let i = 1; i < path.length; i++) c.push(c[i - 1] + distXZ(path[i - 1], path[i]));
  return c;
}

/** Projects a point onto a lane path, returning distance along it and lateral offset. */
export function projectOnPath(path: Vec3[], cum: number[], p: { x: number; z: number }): { s: number; off: number } {
  let best = { s: 0, off: Infinity };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
    const off = Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
    if (off < best.off) best = { s: cum[i - 1] + Math.sqrt(l2) * t, off };
  }
  return best;
}

export function pointOnPath(path: Vec3[], cum: number[], s: number): Vec3 {
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = path[i - 1];
  const b = path[i];
  const seg = cum[i] - cum[i - 1];
  const t = seg > 0 ? (s - cum[i - 1]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t };
}

const STRUCT_ORDER = ['guardian', 'walker', 'baseGuardian'];

export function buildTeamModel(sim: Simulation, team: TeamId): TeamModel {
  const enemy = (1 - team) as TeamId;
  const lanes: LaneState[] = sim.map.lanes.map((l) => {
    const path = team === 0 ? l.path : [...l.path].reverse();
    const cum = cumulative(path);
    return {
      lane: l.id,
      path,
      cum,
      length: cum[cum.length - 1],
      ourFront: -1,
      enemyFront: Infinity,
      ourTroopers: 0,
      enemyTroopers: 0,
      clash: 0,
      nextEnemyStructure: null,
      ourOuterStructure: null,
      enemyHeroesSeen: 0,
    };
  });
  for (const t of sim.troopers) {
    if (!t.alive) continue;
    const ls = lanes[t.lane];
    const ours = t.team === team;
    if (!ours && !t.visibleTo[team]) continue;
    const { s } = projectOnPath(ls.path, ls.cum, t.pos);
    if (ours) {
      ls.ourTroopers++;
      if (s > ls.ourFront) ls.ourFront = s;
    } else {
      ls.enemyTroopers++;
      if (s < ls.enemyFront) ls.enemyFront = s;
    }
  }
  for (const ls of lanes) {
    if (ls.ourFront < 0 && ls.enemyFront === Infinity) ls.clash = ls.length * 0.45;
    else if (ls.ourFront < 0) ls.clash = Math.max(0, ls.enemyFront - 8);
    else if (ls.enemyFront === Infinity) ls.clash = ls.ourFront;
    else ls.clash = Math.min(ls.ourFront, ls.enemyFront);
    for (const type of STRUCT_ORDER) {
      const s = sim.structureByKeyGet(`${enemy === 0 ? 'a' : 'b'}-${type}-${ls.lane}`);
      if (s && s.alive) {
        ls.nextEnemyStructure = s;
        break;
      }
    }
    if (!ls.nextEnemyStructure) {
      // Lane cleared: the base targets are next.
      const pre = enemy === 0 ? 'a' : 'b';
      const shrines = [sim.structureByKeyGet(`${pre}-shrine-0`), sim.structureByKeyGet(`${pre}-shrine-1`)].filter((x) => x && x.alive) as Structure[];
      const pick = shrines.sort((a, b) => distXZ(a.pos, ls.path[ls.path.length - 1]) - distXZ(b.pos, ls.path[ls.path.length - 1]))[0];
      ls.nextEnemyStructure = pick ?? sim.structureByKeyGet(`${pre}-patron`) ?? null;
      if (ls.nextEnemyStructure && !ls.nextEnemyStructure.alive) ls.nextEnemyStructure = null;
    }
    for (const type of [...STRUCT_ORDER]) {
      const s = sim.structureByKeyGet(`${team === 0 ? 'a' : 'b'}-${type}-${ls.lane}`);
      if (s && s.alive) {
        ls.ourOuterStructure = s;
        break;
      }
    }
  }
  const threats: StructureThreat[] = [];
  for (const s of sim.structures) {
    if (!s.alive || s.team !== team) continue;
    let eh = 0;
    let et = 0;
    sim.forEachUnitNear(s.pos, 32, (u) => {
      if (!u.alive || u.team !== enemy || distXZ(u.pos, s.pos) > 30) return;
      if (!u.visibleTo[team]) return;
      if (u.kind === 'hero') eh++;
      else if (u.kind === 'trooper') et++;
    });
    const recentlyHit = sim.time - s.lastDamagedAt < 3;
    // Troopers alone don't need heroes unless the structure is getting low.
    if ((eh > 0 && (recentlyHit || eh > 1)) || (et > 2 && recentlyHit && s.hpFrac() < 0.55)) {
      const tier = s.def.type === 'patron' ? 5 : s.def.type === 'shrine' ? 4 : s.def.type === 'baseGuardian' ? 3 : s.def.type === 'walker' ? 2 : 1;
      const urgency = (eh * 1.0 + et * 0.2) * (0.6 + tier * 0.25) * (recentlyHit ? 1.3 : 0.8) * (1.6 - s.hpFrac() * 0.6);
      threats.push({ s, enemyHeroes: eh, enemyTroopers: et, urgency });
    }
  }
  threats.sort((a, b) => b.urgency - a.urgency);
  for (const h of sim.heroes) {
    if (h.team !== enemy || !h.alive || !h.visibleTo[team]) continue;
    for (const ls of lanes) {
      const { off } = projectOnPath(ls.path, ls.cum, h.pos);
      if (off < 14) ls.enemyHeroesSeen++;
    }
  }
  let aliveAllies = 0;
  let aliveEnemies = 0;
  let nwA = 0;
  let nwE = 0;
  for (const h of sim.heroes) {
    if (h.team === team) {
      if (h.alive) aliveAllies++;
      nwA += h.netWorth;
    } else {
      if (h.alive) aliveEnemies++;
      nwE += h.netWorth;
    }
  }
  const advantage = (aliveAllies + 0.5) / (aliveEnemies + 0.5) * (1 + Math.max(-0.4, Math.min(0.4, (nwA - nwE) / Math.max(1, nwA + nwE))));
  return { lanes, threats, aliveAllies, aliveEnemies, advantage, netWorthDiff: nwA - nwE };
}
