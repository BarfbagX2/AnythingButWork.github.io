import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { BTN } from '../core/input';
import { dirFromYawPitch, raySphere, rayVerticalCapsule, type Vec3 } from '../core/math';
import type { AnyUnit, Hero, Projectile } from './entities';
import { held, pressed } from './movement';
import { applyStatus, breakStealth } from './status';
import { SF } from './types';

const MEL = BALANCE.melee;

export function heroEye(hero: Hero, out: Vec3): Vec3 {
  out.x = hero.pos.x;
  out.y = hero.pos.y + (hero.crouching ? hero.eyeHeight * 0.72 : hero.eyeHeight);
  out.z = hero.pos.z;
  return out;
}

export function startReload(sim: Simulation, hero: Hero): void {
  const w = hero.weapon;
  if (w.reloading || w.ammo >= w.magazine) return;
  w.reloading = true;
  w.reloadEnd = sim.time + w.def.reloadTime * hero.stats.reloadMul;
  w.burstLeft = 0;
  sim.events.push({ t: 'reload', unit: hero.id, done: false });
}

/** Weapon state machine: reload, fire modes, bursts, spread bloom. */
export function updateWeapon(sim: Simulation, hero: Hero, dt: number, canFire: boolean): void {
  const w = hero.weapon;
  const def = w.def;
  w.spread = Math.max(def.spread, w.spread - def.spreadRecovery * dt);
  if (w.reloading) {
    if (sim.time >= w.reloadEnd) {
      w.reloading = false;
      w.ammo = w.magazine;
      sim.events.push({ t: 'reload', unit: hero.id, done: true });
    }
    return;
  }
  if (pressed(hero, BTN.RELOAD) && w.ammo < w.magazine) {
    startReload(sim, hero);
    return;
  }
  if (!canFire) {
    w.burstLeft = 0;
    return;
  }
  if (w.burstLeft > 0 && sim.time >= w.nextBurst) {
    if (w.ammo > 0 || sim.time < hero.freeAmmoUntil) {
      fireShot(sim, hero);
      w.burstLeft--;
      w.nextBurst += (def.burstInterval ?? 0.08) / hero.stats.fireRateMul;
    } else w.burstLeft = 0;
  }
  const trigger = def.fireMode === 'auto' ? held(hero, BTN.FIRE) : pressed(hero, BTN.FIRE);
  if (trigger && sim.time >= w.nextFire && w.burstLeft === 0) {
    if (w.ammo <= 0 && sim.time >= hero.freeAmmoUntil) {
      startReload(sim, hero);
      return;
    }
    w.nextFire = sim.time + def.fireInterval / hero.stats.fireRateMul;
    fireShot(sim, hero);
    if (def.fireMode === 'burst') {
      w.burstLeft = (def.burstCount ?? 3) - 1;
      w.nextBurst = sim.time + (def.burstInterval ?? 0.08) / hero.stats.fireRateMul;
    }
  }
  // Auto reload when empty and not firing.
  if (w.ammo <= 0 && !w.reloading && sim.time >= hero.freeAmmoUntil && sim.time > w.nextFire) startReload(sim, hero);
}

const tmpEye = { x: 0, y: 0, z: 0 };
const tmpDir = { x: 0, y: 0, z: 0 };

function perturb(sim: Simulation, base: Vec3, cone: number, out: Vec3): Vec3 {
  if (cone <= 0) {
    out.x = base.x;
    out.y = base.y;
    out.z = base.z;
    return out;
  }
  // Uniform sample inside a cone around `base`.
  const r = cone * Math.sqrt(sim.rng.next());
  const th = sim.rng.next() * Math.PI * 2;
  // Build an orthonormal basis.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(base.y) > 0.95) {
    ux = 1;
    uy = 0;
  }
  // right = base x up
  let rx = base.y * uz - base.z * uy;
  let ry = base.z * ux - base.x * uz;
  let rz = base.x * uy - base.y * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // up2 = right x base
  const vx = ry * base.z - rz * base.y;
  const vy = rz * base.x - rx * base.z;
  const vz = rx * base.y - ry * base.x;
  const a = Math.tan(r) * Math.cos(th);
  const b = Math.tan(r) * Math.sin(th);
  out.x = base.x + rx * a + vx * b;
  out.y = base.y + ry * a + vy * b;
  out.z = base.z + rz * a + vz * b;
  const l = Math.hypot(out.x, out.y, out.z);
  out.x /= l;
  out.y /= l;
  out.z /= l;
  return out;
}

export function fireShot(sim: Simulation, hero: Hero): void {
  const w = hero.weapon;
  const def = w.def;
  if (sim.time >= hero.freeAmmoUntil) w.ammo = Math.max(0, w.ammo - 1);
  w.shotsFired++;
  hero.lastShotTime = sim.time;
  breakStealth(sim, hero);
  heroEye(hero, tmpEye);
  dirFromYawPitch(hero.aimDir, hero.input.yaw, hero.input.pitch);
  const moving = Math.hypot(hero.vel.x, hero.vel.z) > 1.5 || !hero.grounded;
  const cone = w.spread + (moving ? def.spreadMoving : 0) - (hero.crouching ? def.spread * 0.4 : 0);
  const speed = def.projectileSpeed * hero.stats.bulletVelocityMul;
  for (let i = 0; i < def.pellets; i++) {
    const d = perturb(sim, hero.aimDir, def.pellets > 1 ? Math.max(cone, def.spread) : cone, tmpDir);
    const p = sim.spawnProjectile(hero.id, hero.team, 'bullet');
    p.pos.x = tmpEye.x;
    p.pos.y = tmpEye.y;
    p.pos.z = tmpEye.z;
    p.origin.x = tmpEye.x;
    p.origin.y = tmpEye.y;
    p.origin.z = tmpEye.z;
    p.prevPos.x = tmpEye.x;
    p.prevPos.y = tmpEye.y;
    p.prevPos.z = tmpEye.z;
    p.vel.x = d.x * speed;
    p.vel.y = d.y * speed;
    p.vel.z = d.z * speed;
    p.gravity = def.gravity;
    p.radius = def.projectileRadius;
    p.damage = def.damage * hero.stats.weaponDamageMul;
    p.dmgType = 'bullet';
    p.critMul = def.critMul + hero.stats.headshotBonus;
    p.falloffStart = def.falloffStart;
    p.falloffEnd = def.falloffEnd;
    p.falloffMin = def.falloffMin;
    p.maxDist = def.range;
    p.hitsOrbs = true;
    p.visual = def.tracer;
    p.splash = def.splash;
    p.status = def.onHitStatus;
    sim.items.decorateBullet(hero, p);
  }
  w.spread = Math.min(def.spreadMax, w.spread + def.spreadPerShot);
  sim.events.push({ t: 'shot', unit: hero.id, from: { ...tmpEye }, dir: { ...hero.aimDir }, style: def.sound, pellets: def.pellets });
}

function falloff(p: Projectile, dist: number): number {
  if (dist <= p.falloffStart) return 1;
  if (dist >= p.falloffEnd) return p.falloffMin;
  const t = (dist - p.falloffStart) / (p.falloffEnd - p.falloffStart);
  return 1 + (p.falloffMin - 1) * t;
}

const segDir = { x: 0, y: 0, z: 0 };
const hitPt = { x: 0, y: 0, z: 0 };
const nrm = { x: 0, y: 1, z: 0 };

/** Default damage application for a projectile hitting a unit. */
export function projectileDamage(sim: Simulation, p: Projectile, u: AnyUnit, crit: boolean, point: Vec3): void {
  const dist = Math.hypot(point.x - p.origin.x, point.y - p.origin.y, point.z - p.origin.z);
  let dmg = p.damage * falloff(p, dist);
  if (crit) dmg *= p.critMul;
  if (p.kind === 'bullet') {
    const owner = sim.units.get(p.ownerId);
    if (owner && owner.kind === 'hero') dmg *= sim.items.bulletRangeMul(owner, dist);
  }
  if (u.kind === 'hero') dmg *= p.vsHeroMul;
  else if (u.kind === 'trooper' || u.kind === 'summon') dmg *= p.vsTrooperMul;
  sim.dealDamage(u, { sourceId: p.ownerId, amount: dmg, type: p.dmgType, crit, pos: { ...point }, abilityId: p.abilityId });
  if (p.status && u.alive) applyStatus(sim, u, p.status, p.ownerId, p.abilityId);
}

function splashAt(sim: Simulation, p: Projectile, point: Vec3, directId: number): void {
  if (!p.splash) return;
  const r = p.splash.radius;
  sim.forEachUnitNear(point, r + 2, (u) => {
    if (u.id === directId || !u.alive || u.team === p.team) return;
    const dx = u.pos.x - point.x;
    const dz = u.pos.z - point.z;
    const dy = u.centerY() - point.y;
    if (dx * dx + dz * dz + dy * dy * 0.5 > (r + u.radius) * (r + u.radius)) return;
    sim.dealDamage(u, { sourceId: p.ownerId, amount: p.damage * p.splash!.fraction, type: p.dmgType, pos: { x: u.pos.x, y: u.centerY(), z: u.pos.z } });
  });
  sim.events.push({ t: 'vfx', kind: 'blast', pos: { ...point }, radius: r, color: p.color, duration: 0.35 });
}

/** Moves projectiles with swept collision against world, units, and soul orbs. */
export function updateProjectiles(sim: Simulation, dt: number): void {
  const world = sim.world;
  for (const p of sim.projectiles) {
    if (!p.alive) continue;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.vel.y -= p.gravity * dt;
    const sx = p.vel.x * dt;
    const sy = p.vel.y * dt;
    const sz = p.vel.z * dt;
    let len = Math.hypot(sx, sy, sz);
    if (len < 1e-6) continue;
    const remaining = p.maxDist - p.traveled;
    let expiring = false;
    if (len >= remaining) {
      len = remaining;
      expiring = true;
    }
    segDir.x = sx / Math.hypot(sx, sy, sz);
    segDir.y = sy / Math.hypot(sx, sy, sz);
    segDir.z = sz / Math.hypot(sx, sy, sz);

    // Several passes allow piercing projectiles to hit multiple units per tick.
    for (let pass = 0; pass < 4 && p.alive; pass++) {
      const wt = world.raycast(p.pos, segDir, len, sim.tmpHit);
      const worldT = wt >= 0 ? wt : Infinity;
      let bestT = Math.min(worldT, len);
      let bestUnit: AnyUnit | null = null;
      let bestCrit = false;
      let orbIdx = -1;
      const midX = p.pos.x + segDir.x * len * 0.5;
      const midZ = p.pos.z + segDir.z * len * 0.5;
      sim.grid.query(midX, midZ, len * 0.5 + 4, (u) => {
        if (!u.alive || u.id === p.ownerId || p.hitIds.includes(u.id)) return;
        if (p.targetsAllies ? u.team !== p.team : u.team === p.team) return;
        if (u.flags & SF.INVISIBLE && u.kind === 'hero' && p.kind !== 'bullet') return;
        const r = u.radius + p.radius;
        const bodyTop = u.headRadius > 0 ? u.headHeight - u.headRadius * 0.6 : u.height;
        let t = rayVerticalCapsule(p.pos, segDir, u.pos.x, u.pos.z, u.pos.y, u.pos.y + bodyTop, r, bestT);
        let crit = false;
        if (u.headRadius > 0) {
          const hc = { x: u.pos.x, y: u.pos.y + u.headHeight, z: u.pos.z };
          const th = raySphere(p.pos, segDir, hc, u.headRadius + p.radius * 0.5);
          if (th >= 0 && th <= bestT && (t < 0 || th <= t + 0.05)) {
            t = th;
            crit = true;
          }
        }
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestUnit = u;
          bestCrit = crit;
        }
      });
      if (p.hitsOrbs) {
        for (let i = 0; i < sim.orbs.length; i++) {
          const o = sim.orbs[i];
          if (!o.alive) continue;
          const t = raySphere(p.pos, segDir, o.pos, o.radius);
          if (t >= 0 && t < bestT) {
            bestT = t;
            bestUnit = null;
            orbIdx = i;
          }
        }
      }
      hitPt.x = p.pos.x + segDir.x * bestT;
      hitPt.y = p.pos.y + segDir.y * bestT;
      hitPt.z = p.pos.z + segDir.z * bestT;
      if (orbIdx >= 0) {
        sim.claimOrb(sim.orbs[orbIdx], p.ownerId);
        // Orbs don't stop the bullet; continue from the orb.
        p.traveled += bestT;
        len -= bestT;
        p.pos.x = hitPt.x;
        p.pos.y = hitPt.y;
        p.pos.z = hitPt.z;
        continue;
      }
      if (bestUnit) {
        const u = bestUnit as AnyUnit;
        p.hitIds.push(u.id);
        if (p.onHit) p.onHit(u, { ...hitPt }, segDir);
        else {
          projectileDamage(sim, p, u, bestCrit, hitPt);
          splashAt(sim, p, hitPt, u.id);
        }
        sim.events.push({ t: 'impact', pos: { ...hitPt }, normal: { x: -segDir.x, y: -segDir.y, z: -segDir.z }, kind: 'unit', color: p.color });
        if (p.pierce > 0) {
          p.pierce--;
          p.traveled += bestT;
          len -= bestT;
          p.pos.x = hitPt.x;
          p.pos.y = hitPt.y;
          p.pos.z = hitPt.z;
          continue;
        }
        p.alive = false;
        p.pos.x = hitPt.x;
        p.pos.y = hitPt.y;
        p.pos.z = hitPt.z;
        break;
      }
      if (worldT <= len) {
        const h = sim.tmpHit;
        nrm.x = h.nx;
        nrm.y = h.ny;
        nrm.z = h.nz;
        if (p.onHit) p.onHit(null, { ...hitPt }, nrm);
        else splashAt(sim, p, hitPt, -1);
        p.onExpire?.({ ...hitPt });
        sim.events.push({ t: 'impact', pos: { ...hitPt }, normal: { ...nrm }, kind: 'world', color: p.color });
        p.alive = false;
        p.pos.x = hitPt.x;
        p.pos.y = hitPt.y;
        p.pos.z = hitPt.z;
        break;
      }
      // No hit this tick.
      p.pos.x += segDir.x * len;
      p.pos.y += segDir.y * len;
      p.pos.z += segDir.z * len;
      p.traveled += len;
      if (expiring || p.traveled >= p.maxDist) {
        p.alive = false;
        p.onExpire?.({ ...p.pos });
      }
      break;
    }
  }
}

// --- Melee & parry ----------------------------------------------------------

export function updateMelee(sim: Simulation, hero: Hero, canAct: boolean): void {
  if (!canAct) {
    hero.meleeStart = -1;
    return;
  }
  if (pressed(hero, BTN.PARRY) && sim.time >= hero.parryNext && hero.meleeSwingAt < 0) {
    hero.parryUntil = sim.time + MEL.parryWindow;
    hero.parryNext = sim.time + MEL.parryCooldown;
    sim.events.push({ t: 'parry', unit: hero.id, success: false });
  }
  if (sim.time < hero.parryUntil) return;

  if (pressed(hero, BTN.MELEE) && sim.time >= hero.meleeNext && hero.meleeSwingAt < 0) hero.meleeStart = sim.time;
  if (hero.meleeStart >= 0) {
    const chargedFor = sim.time - hero.meleeStart;
    const release = !held(hero, BTN.MELEE);
    if (release || chargedFor >= MEL.heavyChargeTime) {
      const heavy = chargedFor >= MEL.heavyChargeTime;
      hero.meleeHeavy = heavy;
      hero.meleeSwingAt = sim.time + MEL.swingDelay;
      hero.meleeStart = -1;
      hero.meleeNext = sim.time + (heavy ? MEL.heavyCooldown : MEL.lightCooldown);
      sim.events.push({ t: 'melee', unit: hero.id, heavy, hit: false });
      if (heavy) {
        // Short lunge.
        const fx = Math.sin(hero.yaw);
        const fz = Math.cos(hero.yaw);
        hero.forced = { kind: 'dash', vel: { x: fx * 9, y: 0, z: fz * 9 }, end: sim.time + 0.14, ballistic: false, hitIds: [], stopOnWall: true };
      }
    }
  }
  if (hero.meleeSwingAt >= 0 && sim.time >= hero.meleeSwingAt) {
    hero.meleeSwingAt = -1;
    resolveMelee(sim, hero, hero.meleeHeavy);
  }
}

function resolveMelee(sim: Simulation, hero: Hero, heavy: boolean): void {
  breakStealth(sim, hero);
  const range = heavy ? MEL.heavyRange : MEL.lightRange;
  const fx = Math.sin(hero.yaw);
  const fz = Math.cos(hero.yaw);
  let hitAny = false;
  const eye = heroEye(hero, { x: 0, y: 0, z: 0 });
  sim.forEachUnitNear(hero.pos, range + 3, (u) => {
    if (!u.alive || u.team === hero.team) return;
    const dx = u.pos.x - hero.pos.x;
    const dz = u.pos.z - hero.pos.z;
    const d = Math.hypot(dx, dz) - u.radius;
    if (d > range) return;
    const dy = u.pos.y - hero.pos.y;
    if (dy > 2.5 || dy < -u.height - 0.5) return;
    const dl = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / dl < 0.45 && d > 0.6) return;
    if (sim.world.segmentBlocked(eye, { x: u.pos.x, y: u.centerY(), z: u.pos.z })) return;
    hitAny = true;
    if (u.kind === 'hero' && sim.time < u.parryUntil) {
      // Parried: the attacker is stunned and the hit is negated.
      applyStatus(sim, hero, { id: 'parried', name: 'Parried', duration: MEL.parryStun, flags: SF.STUN, debuff: true, vfx: 'stun' }, u.id);
      u.parryUntil = 0;
      u.parryNext = sim.time + 0.5;
      sim.events.push({ t: 'parry', unit: u.id, success: true, attacker: hero.id });
      return;
    }
    let dmg = (heavy ? MEL.heavyDamage : MEL.lightDamage) * hero.stats.meleeDamageMul;
    dmg *= 1 + (hero.level - 1) * 0.04;
    if (u.kind === 'trooper' && heavy) dmg *= MEL.heavyMeleeTrooperMul;
    sim.meleeKillFlag = true;
    sim.dealDamage(u, { sourceId: hero.id, amount: dmg, type: 'melee', pos: { x: u.pos.x, y: u.centerY(), z: u.pos.z } });
    sim.meleeKillFlag = false;
    if (heavy && u.alive && u.kind !== 'structure' && u.kind !== 'boss') {
      u.vel.x += fx * 6;
      u.vel.z += fz * 6;
    }
  });
  if (hitAny) sim.events.push({ t: 'melee', unit: hero.id, heavy, hit: true });
}
