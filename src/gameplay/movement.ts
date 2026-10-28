import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { BTN } from '../core/input';
import { approach, clamp } from '../core/math';
import type { Hero } from './entities';
import { SF } from './types';

const M = BALANCE.movement;
const Z = BALANCE.zipline;

const pushN = { x: 0, z: 0 };

export function pressed(hero: Hero, btn: number): boolean {
  return (hero.input.buttons & btn) !== 0 && (hero.prevButtons & btn) === 0;
}

export function held(hero: Hero, btn: number): boolean {
  return (hero.input.buttons & btn) !== 0;
}

/** Current non-sprint ground speed target for the hero. */
export function heroRunSpeed(sim: Simulation, hero: Hero): number {
  let s = hero.stats.moveSpeed;
  if (sim.time - hero.lastCombatTime > M.sprintDelay && sim.time - hero.lastShotTime > 1.5) s += hero.stats.sprintSpeed;
  return s;
}

function spendStamina(hero: Hero, n: number): boolean {
  if (hero.stamina < n) return false;
  if (hero.stamina >= hero.stats.stamina) hero.staminaNext = 0;
  hero.stamina -= n;
  return true;
}

export function updateStamina(sim: Simulation, hero: Hero, dt: number): void {
  const max = hero.stats.stamina;
  if (hero.stamina > max) hero.stamina = max;
  if (hero.stamina < max) {
    hero.staminaNext += dt;
    if (hero.staminaNext >= hero.stats.staminaCooldown) {
      hero.staminaNext = 0;
      hero.stamina++;
    }
  } else hero.staminaNext = 0;
  void sim;
}

/**
 * Integrates a hero for one fixed step. `moveMul` scales movement (casting,
 * channelling). Collision is resolved against the static world and
 * structure footprints.
 */
export function updateHeroMovement(sim: Simulation, hero: Hero, dt: number, moveMul: number): void {
  const world = sim.world;
  const stunned = (hero.flags & SF.STUN) !== 0;
  const rooted = stunned || (hero.flags & SF.ROOT) !== 0;
  const inp = hero.input;
  const vel = hero.vel;
  hero.wasGrounded = hero.grounded;
  const feet0 = hero.pos.y;

  if (hero.zip) {
    updateZipline(sim, hero, dt);
    return;
  }

  if (hero.forced) {
    const f = hero.forced;
    vel.x = f.vel.x;
    vel.z = f.vel.z;
    if (f.ballistic) {
      f.vel.y -= BALANCE.gravity * dt;
      vel.y = f.vel.y;
    } else vel.y = f.vel.y;
  } else {
    const dashing = sim.time < hero.dashEnd;
    // Desired horizontal velocity.
    const wishX = rooted ? 0 : inp.moveX;
    const wishZ = rooted ? 0 : inp.moveZ;
    let speed = heroRunSpeed(sim, hero) * moveMul;
    hero.crouching = !rooted && held(hero, BTN.CROUCH) && hero.grounded;
    if (hero.crouching && !hero.sliding) speed *= M.crouchSpeedMul;

    if (dashing) {
      vel.x = hero.dashVel.x;
      vel.z = hero.dashVel.z;
      if (!hero.grounded) vel.y = Math.max(vel.y, -2);
    } else if (hero.sliding) {
      if (sim.time >= hero.slideEnd || !held(hero, BTN.CROUCH) || !hero.grounded) hero.sliding = false;
      const sp = Math.hypot(vel.x, vel.z);
      const target = Math.max(speed * 0.6, sp - 9 * dt);
      if (sp > 1e-3) {
        vel.x = (vel.x / sp) * target;
        vel.z = (vel.z / sp) * target;
      }
      // Gentle steering while sliding.
      vel.x += wishX * 6 * dt;
      vel.z += wishZ * 6 * dt;
    } else if (hero.grounded) {
      vel.x = approach(vel.x, wishX * speed, M.accelGround * dt);
      vel.z = approach(vel.z, wishZ * speed, M.accelGround * dt);
    } else {
      // Air control (momentum preserving): accelerate along the wish
      // direction only while slower than run speed in that direction.
      const wl = Math.hypot(wishX, wishZ);
      if (wl > 0.05) {
        const dx = wishX / wl;
        const dz = wishZ / wl;
        const cur = vel.x * dx + vel.z * dz;
        const add = clamp(speed * wl - cur, 0, M.accelAir * dt);
        vel.x += dx * add;
        vel.z += dz * add;
        // Mild steering so strafing in the air is responsive.
        const side = vel.x * -dz + vel.z * dx;
        const steer = clamp(side, -M.accelAir * 0.4 * dt, M.accelAir * 0.4 * dt);
        vel.x -= -dz * steer;
        vel.z -= dx * steer;
      }
    }

    if (!rooted) {
      // Dash (ground or air): costs stamina.
      if (pressed(hero, BTN.DASH) && spendStamina(hero, M.staminaCostDash)) {
        let dx = inp.moveX;
        let dz = inp.moveZ;
        const l = Math.hypot(dx, dz);
        if (l < 0.1) {
          dx = Math.sin(hero.yaw);
          dz = Math.cos(hero.yaw);
        } else {
          dx /= l;
          dz /= l;
        }
        hero.dashVel.x = dx * M.dashSpeed;
        hero.dashVel.z = dz * M.dashSpeed;
        hero.dashEnd = sim.time + M.dashDuration;
        hero.sliding = false;
        if (!hero.grounded) vel.y = Math.max(vel.y, 1.5);
        sim.events.push({ t: 'move', unit: hero.id, kind: 'dash' });
      }
      // Slide: crouch while moving fast on the ground.
      if (pressed(hero, BTN.CROUCH) && hero.grounded && !hero.sliding) {
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > hero.stats.moveSpeed * 0.8) {
          hero.sliding = true;
          hero.slideEnd = sim.time + M.slideDuration;
          const boost = Math.max(sp, M.slideSpeed);
          vel.x = (vel.x / sp) * boost;
          vel.z = (vel.z / sp) * boost;
          if (sim.time - hero.dashEnd < 0.25) hero.freeAmmoUntil = sim.time + M.dashSlideFreeAmmo;
          sim.events.push({ t: 'move', unit: hero.id, kind: 'slide' });
        }
      }
      // Jump / double jump.
      if (pressed(hero, BTN.JUMP)) {
        const recentlyGrounded = hero.grounded || sim.time - hero.lastGroundTime < 0.1;
        if (recentlyGrounded && vel.y <= 0.5) {
          // Dash-jump: jumping right out of a dash.
          if (sim.time - hero.dashEnd < 0.12 && sim.time - hero.dashEnd > -M.dashDuration && spendStamina(hero, M.staminaCostDashJump - M.staminaCostDash)) {
            vel.x = hero.dashVel.x * M.dashJumpBoost * 0.75;
            vel.z = hero.dashVel.z * M.dashJumpBoost * 0.75;
            hero.dashEnd = 0;
          }
          vel.y = M.jumpSpeed;
          hero.grounded = false;
          hero.sliding = false;
          sim.events.push({ t: 'move', unit: hero.id, kind: 'jump' });
        } else if (hero.airJumps < 1 && spendStamina(hero, M.staminaCostDoubleJump)) {
          hero.airJumps++;
          vel.y = M.doubleJumpSpeed;
          // Double jump re-aims momentum toward input.
          if (Math.hypot(inp.moveX, inp.moveZ) > 0.2) {
            const sp = Math.max(Math.hypot(vel.x, vel.z), heroRunSpeed(sim, hero) * 0.9);
            vel.x = inp.moveX * sp;
            vel.z = inp.moveZ * sp;
          }
          sim.events.push({ t: 'move', unit: hero.id, kind: 'doubleJump' });
        }
      }
    }
    vel.y -= BALANCE.gravity * dt;
  }

  // --- Integrate horizontally with collision ---
  const pos = hero.pos;
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  const stepUp = hero.grounded ? M.stepHeight : M.stepHeight * 0.6;
  if (world.resolveCylinder(pos, hero.radius, hero.height, stepUp, pushN)) {
    const nl = Math.hypot(pushN.x, pushN.z);
    if (nl > 1e-6) {
      const nx = pushN.x / nl;
      const nz = pushN.z / nl;
      const into = vel.x * nx + vel.z * nz;
      if (into < 0) {
        // Mantle: airborne heroes moving into a low ledge climb onto it.
        if (!hero.grounded && !rooted && tryMantle(sim, hero, -nx, -nz)) {
          sim.events.push({ t: 'move', unit: hero.id, kind: 'mantle' });
        } else {
          vel.x -= into * nx;
          vel.z -= into * nz;
        }
        if (hero.forced && hero.forced.stopOnWall) endForced(hero);
        if (sim.time < hero.dashEnd) hero.dashEnd = sim.time;
      }
    }
  }
  sim.resolveStructureCollision(hero);

  // --- Vertical ---
  pos.y += vel.y * dt;
  const ground = world.groundHeight(pos.x, pos.z, Math.max(feet0, pos.y) + stepUp);
  if (pos.y <= ground) {
    pos.y = ground;
    if (vel.y < 0) vel.y = 0;
    if (!hero.wasGrounded) {
      hero.landedAt = sim.time;
      sim.events.push({ t: 'move', unit: hero.id, kind: 'land' });
    }
    hero.grounded = true;
  } else if (hero.wasGrounded && vel.y <= 0 && pos.y - ground < 0.65 && !(hero.forced && hero.forced.ballistic)) {
    pos.y = ground; // stick to slopes and stairs going down
    vel.y = 0;
    hero.grounded = true;
  } else {
    hero.grounded = false;
  }
  if (vel.y > 0) {
    const ceil = world.ceilingHeight(pos.x, pos.z, feet0 + hero.height - 0.05);
    if (pos.y + hero.height > ceil) {
      pos.y = ceil - hero.height;
      vel.y = 0;
    }
  }
  if (hero.grounded) {
    hero.airJumps = 0;
    hero.lastGroundTime = sim.time;
    if (hero.forced && hero.forced.ballistic && hero.forced.vel.y < 0) endForced(hero);
  }

  if (hero.forced) {
    const f = hero.forced;
    if (f.onUnitHit) {
      sim.forEachEnemyUnitNear(hero, hero.pos, hero.radius + 1.2, (u) => {
        if (f.hitIds.includes(u.id)) return;
        f.hitIds.push(u.id);
        if (f.onUnitHit!(u)) endForced(hero);
      });
    }
    if (hero.forced && sim.time >= f.end) endForced(hero);
  }

  // Safety net: never leave the playable space.
  if (pos.y < -10 || !world.inBounds(pos.x, pos.z)) sim.rescueUnit(hero);
}

export function endForced(hero: Hero): void {
  const f = hero.forced;
  if (!f) return;
  hero.forced = null;
  if (f.kind === 'dash' || f.kind === 'pull' || f.kind === 'knockback') {
    hero.vel.x *= 0.35;
    hero.vel.z *= 0.35;
  }
  f.onEnd?.();
}

function tryMantle(sim: Simulation, hero: Hero, dx: number, dz: number): boolean {
  const feet = hero.pos.y;
  const px = hero.pos.x + dx * (hero.radius + 0.35);
  const pz = hero.pos.z + dz * (hero.radius + 0.35);
  const top = sim.world.groundHeight(px, pz, feet + M.mantleReach);
  if (top <= feet + M.stepHeight * 0.5 || top > feet + M.mantleReach) return false;
  // Need head room on top of the ledge.
  if (sim.world.overlapsCylinder(px, top + 0.02, pz, hero.radius * 0.9, hero.height, 0.01)) return false;
  hero.pos.x = px;
  hero.pos.z = pz;
  hero.pos.y = top;
  hero.vel.y = 0;
  hero.vel.x *= 0.5;
  hero.vel.z *= 0.5;
  hero.grounded = true;
  return true;
}

// --- Ziplines -----------------------------------------------------------------

export interface ZipLine {
  index: number;
  id: string;
  team: number;
  lane: number;
  points: { x: number; y: number; z: number }[];
  cum: number[];
  length: number;
}

export function buildZipLines(defs: { id: string; team: number; lane: number; points: { x: number; y: number; z: number }[] }[]): ZipLine[] {
  return defs.map((d, index) => {
    const cum = [0];
    for (let i = 1; i < d.points.length; i++) {
      const a = d.points[i - 1];
      const b = d.points[i];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    return { index, id: d.id, team: d.team, lane: d.lane, points: d.points, cum, length: cum[cum.length - 1] };
  });
}

export function zipPoint(line: ZipLine, s: number, out: { x: number; y: number; z: number }): { tx: number; tz: number } {
  s = clamp(s, 0, line.length);
  let i = 1;
  while (i < line.cum.length - 1 && line.cum[i] < s) i++;
  const a = line.points[i - 1];
  const b = line.points[i];
  const segLen = line.cum[i] - line.cum[i - 1];
  const t = segLen > 0 ? (s - line.cum[i - 1]) / segLen : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { tx: (b.x - a.x) / l, tz: (b.z - a.z) / l };
}

/** Closest point on a zipline to (x, z) in the XZ plane. */
export function zipClosest(line: ZipLine, x: number, z: number): { s: number; dist: number; y: number } {
  let best = { s: 0, dist: Infinity, y: 0 };
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1];
    const b = line.points[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    const t = l2 > 0 ? clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1) : 0;
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best.dist) best = { s: line.cum[i - 1] + (line.cum[i] - line.cum[i - 1]) * t, dist: d, y: a.y + (b.y - a.y) * t };
  }
  return best;
}

export function tryAttachZipline(sim: Simulation, hero: Hero): boolean {
  if (sim.time < hero.zipCooldownUntil || hero.flags & (SF.STUN | SF.ROOT)) return false;
  let best: { line: ZipLine; s: number; dist: number } | null = null;
  for (const line of sim.ziplines) {
    if (line.team !== hero.team) continue;
    const c = zipClosest(line, hero.pos.x, hero.pos.z);
    if (c.dist <= Z.attachRange && hero.pos.y < c.y && (!best || c.dist < best.dist)) best = { line, s: c.s, dist: c.dist };
  }
  if (!best) return false;
  const tmp = { x: 0, y: 0, z: 0 };
  const tan = zipPoint(best.line, best.s, tmp);
  const fx = Math.sin(hero.yaw);
  const fz = Math.cos(hero.yaw);
  let dir: 1 | -1 = fx * tan.tx + fz * tan.tz >= 0 ? 1 : -1;
  // At the ends, always ride toward the other end.
  if (best.s < 1) dir = 1;
  if (best.s > best.line.length - 1) dir = -1;
  hero.zip = { lineIndex: best.line.index, s: best.s, dir, attachTime: sim.time };
  hero.forced = null;
  hero.dashEnd = 0;
  hero.sliding = false;
  sim.events.push({ t: 'zip', unit: hero.id, on: true });
  return true;
}

export function detachZipline(sim: Simulation, hero: Hero, jump: boolean): void {
  const z = hero.zip;
  if (!z) return;
  const line = sim.ziplines[z.lineIndex];
  const tmp = { x: 0, y: 0, z: 0 };
  const tan = zipPoint(line, z.s, tmp);
  hero.zip = null;
  hero.zipCooldownUntil = sim.time + Z.cooldownAfterDetach;
  hero.vel.x = tan.tx * z.dir * Z.speed * 0.45;
  hero.vel.z = tan.tz * z.dir * Z.speed * 0.45;
  hero.vel.y = jump ? 4 : 0;
  hero.grounded = false;
  hero.airJumps = 0;
  sim.events.push({ t: 'zip', unit: hero.id, on: false });
}

function updateZipline(sim: Simulation, hero: Hero, dt: number): void {
  const z = hero.zip!;
  const line = sim.ziplines[z.lineIndex];
  if (hero.flags & SF.STUN) {
    detachZipline(sim, hero, false);
    return;
  }
  // Reverse direction by looking back along the line.
  const tmp = { x: 0, y: 0, z: 0 };
  const tan = zipPoint(line, z.s, tmp);
  const fx = Math.sin(hero.yaw);
  const fz = Math.cos(hero.yaw);
  const along = (fx * tan.tx + fz * tan.tz) * z.dir;
  if (along < -0.6 && sim.time - z.attachTime > 0.4) z.dir = (z.dir * -1) as 1 | -1;
  z.s += z.dir * Z.speed * dt;
  if (pressed(hero, BTN.JUMP) || pressed(hero, BTN.CROUCH) || (pressed(hero, BTN.INTERACT) && sim.time - z.attachTime > 0.25)) {
    detachZipline(sim, hero, pressed(hero, BTN.JUMP));
    return;
  }
  if (z.s <= 0 || z.s >= line.length) {
    z.s = clamp(z.s, 0, line.length);
    detachZipline(sim, hero, false);
    return;
  }
  zipPoint(line, z.s, tmp);
  hero.pos.x = tmp.x;
  hero.pos.z = tmp.z;
  hero.pos.y = tmp.y - hero.height - 0.15;
  hero.vel.x = tan.tx * z.dir * Z.speed;
  hero.vel.z = tan.tz * z.dir * Z.speed;
  hero.vel.y = 0;
  hero.grounded = false;
}
