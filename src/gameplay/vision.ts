import type { Simulation } from '../core/simulation';
import { distSqXZ } from '../core/math';
import type { AnyUnit } from './entities';
import { SF } from './types';

/**
 * Team vision ("fog of war"). A unit is visible to a team if it is within the
 * sight radius of any of that team's units; enemy heroes additionally need an
 * unobstructed line of sight (buildings block vision). Updated at 5 Hz.
 * The minimap and the bots' perception both read these flags, so bots never
 * receive information the player couldn't legitimately have.
 */
export const SIGHT: Record<string, number> = {
  hero: 34,
  trooper: 20,
  structure: 30,
  summon: 16,
  neutral: 0,
  boss: 0,
};

const eyeA = { x: 0, y: 0, z: 0 };
const eyeB = { x: 0, y: 0, z: 0 };

export function updateVision(sim: Simulation): void {
  if (sim.tick % 12 !== 0) return;
  const all = sim.allUnits();
  for (const u of all) {
    if (!u.alive) {
      u.visibleTo[0] = u.visibleTo[1] = false;
      continue;
    }
    for (const team of [0, 1] as const) {
      if (u.team === team) {
        u.visibleTo[team] = true;
        u.lastSeenBy[team] = sim.time;
        continue;
      }
      u.visibleTo[team] = isVisibleTo(sim, u, team);
      if (u.visibleTo[team]) u.lastSeenBy[team] = sim.time;
    }
  }
}

function isVisibleTo(sim: Simulation, target: AnyUnit, team: 0 | 1): boolean {
  if (target.flags & SF.REVEALED) return true;
  if (target.kind === 'structure') return true; // structures are always on the map
  const invisible = (target.flags & SF.INVISIBLE) !== 0;
  const needLos = target.kind === 'hero' || target.kind === 'boss';
  let seen = false;
  sim.forEachUnitNear(target.pos, 36, (v) => {
    if (seen || !v.alive || v.team !== team) return;
    let r = SIGHT[v.kind] ?? 0;
    if (r <= 0) return;
    if (invisible) r = Math.min(r, 5);
    if (distSqXZ(v.pos, target.pos) > r * r) return;
    if (needLos || invisible) {
      eyeA.x = v.pos.x;
      eyeA.y = v.pos.y + v.height * 0.9;
      eyeA.z = v.pos.z;
      eyeB.x = target.pos.x;
      eyeB.y = target.pos.y + target.height * 0.7;
      eyeB.z = target.pos.z;
      if (sim.world.segmentBlocked(eyeA, eyeB)) return;
    }
    seen = true;
  });
  return seen;
}
