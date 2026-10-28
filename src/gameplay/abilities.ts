import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { dirFromYawPitch, raySphere, type Vec3 } from '../core/math';
import { heroEye } from './combat';
import type { AbilityState, AnyUnit, CastState, Hero, Projectile, Summon, SummonBehavior, Unit, Zone } from './entities';
import { endForced } from './movement';
import { applyStatus, breakStealth } from './status';
import { SF, type AbilityDef, type DamageType, type StatusSpec } from './types';

export type Affects = 'enemies' | 'allies' | 'alliesAndSelf' | 'all';

export interface ProjectileOpts {
  speed: number;
  radius: number;
  range: number;
  gravity?: number;
  damage?: number;
  type?: DamageType;
  visual: string;
  color?: string;
  pierce?: number;
  targetsAllies?: boolean;
  dir?: Vec3;
  origin?: Vec3;
  status?: StatusSpec;
  onHit?: (target: Unit | null, point: Vec3, normal: Vec3) => void;
  onExpire?: (point: Vec3) => void;
}

/** Reads an ability's param including applied upgrade tiers. */
export function abilityParam(state: AbilityState, name: string): number {
  const def = state.def;
  let v = def.params[name] ?? 0;
  for (let i = 0; i < state.level - 1 && i < 3; i++) v += def.upgrades[i].mods[name] ?? 0;
  return v;
}

export function abilityCooldown(hero: Hero, state: AbilityState): number {
  return Math.max(0.5, abilityParam(state, 'cooldown') * hero.stats.cooldownMul);
}

export function abilityRange(hero: Hero, state: AbilityState): number {
  return abilityParam(state, 'range') * hero.stats.rangeMul;
}

/**
 * Runtime context handed to an ability's cast function. It exposes the shared
 * combat infrastructure so every hero ability is a few lines of composition
 * instead of a bespoke combat system.
 */
export class AbilityContext {
  readonly origin: Vec3;
  readonly dir: Vec3;
  readonly point: Vec3;
  readonly target: AnyUnit | null;

  constructor(
    readonly sim: Simulation,
    readonly hero: Hero,
    readonly state: AbilityState,
    readonly cast: CastState,
  ) {
    this.origin = heroEye(hero, { x: 0, y: 0, z: 0 });
    this.dir = { ...cast.aimDir };
    this.point = { ...cast.aimPoint };
    this.target = cast.targetId >= 0 ? ((sim.units.get(cast.targetId) as AnyUnit | undefined) ?? null) : null;
  }

  get def(): AbilityDef {
    return this.state.def;
  }

  get time(): number {
    return this.sim.time;
  }

  p(name: string): number {
    return abilityParam(this.state, name);
  }

  /** Param plus spirit-power scaling from `${name}Scale`. */
  scaled(name: string): number {
    return this.p(name) + this.p(`${name}Scale`) * this.hero.stats.spiritPower;
  }

  dur(name: string): number {
    return this.p(name) * this.hero.stats.durationMul;
  }

  range(name = 'range'): number {
    return this.p(name) * this.hero.stats.rangeMul;
  }

  /** Upgrade tier reached (0 = none, 3 = max). */
  tier(): number {
    return Math.max(0, this.state.level - 1);
  }

  isEnemy(u: Unit): boolean {
    return u.team !== this.hero.team;
  }

  projectile(o: ProjectileOpts): Projectile {
    const sim = this.sim;
    const p = sim.spawnProjectile(this.hero.id, this.hero.team, 'ability');
    const org = o.origin ?? this.origin;
    const d = o.dir ?? this.dir;
    p.pos.x = p.prevPos.x = p.origin.x = org.x;
    p.pos.y = p.prevPos.y = p.origin.y = org.y;
    p.pos.z = p.prevPos.z = p.origin.z = org.z;
    p.vel.x = d.x * o.speed;
    p.vel.y = d.y * o.speed;
    p.vel.z = d.z * o.speed;
    p.gravity = o.gravity ?? 0;
    p.radius = o.radius;
    p.maxDist = o.range;
    p.damage = o.damage ?? 0;
    p.dmgType = o.type ?? 'spirit';
    p.visual = o.visual;
    p.color = o.color ?? this.def.color;
    p.pierce = o.pierce ?? 0;
    p.targetsAllies = o.targetsAllies ?? false;
    p.status = o.status;
    p.onHit = o.onHit;
    p.onExpire = o.onExpire;
    p.abilityId = this.def.id;
    p.critMul = 1;
    return p;
  }

  /** Applies fn to each matching unit within radius of center. Returns count. */
  aoe(center: Vec3, radius: number, affects: Affects, fn: (u: AnyUnit) => void, opts: { heroesOnly?: boolean; structures?: boolean; los?: boolean } = {}): number {
    let n = 0;
    const team = this.hero.team;
    this.sim.forEachUnitNear(center, radius + 3, (u) => {
      if (!u.alive) return;
      if (u.kind === 'structure' && !opts.structures) return;
      if (opts.heroesOnly && u.kind !== 'hero') return;
      if (affects === 'enemies' && u.team === team) return;
      if (affects === 'allies' && (u.team !== team || u.id === this.hero.id)) return;
      if (affects === 'alliesAndSelf' && u.team !== team) return;
      const dx = u.pos.x - center.x;
      const dz = u.pos.z - center.z;
      const dy = u.centerY() - center.y;
      const rr = radius + u.radius;
      if (dx * dx + dz * dz > rr * rr || Math.abs(dy) > radius + u.height) return;
      if (opts.los && this.sim.world.segmentBlocked({ x: center.x, y: center.y + 0.5, z: center.z }, { x: u.pos.x, y: u.centerY(), z: u.pos.z })) return;
      n++;
      fn(u);
    });
    return n;
  }

  damage(u: Unit, amount: number, type: DamageType = 'spirit'): number {
    return this.sim.dealDamage(u as AnyUnit, { sourceId: this.hero.id, amount, type, abilityId: this.def.id });
  }

  heal(u: Unit, amount: number): number {
    return this.sim.heal(u, amount, this.hero.id);
  }

  status(u: Unit, spec: Omit<StatusSpec, 'id' | 'name'> & { id?: string; name?: string }): void {
    applyStatus(this.sim, u, { id: spec.id ?? this.def.id, name: spec.name ?? this.def.name, ...spec }, this.hero.id, this.def.id);
  }

  stun(u: Unit, duration: number): void {
    this.status(u, { id: 'stun', name: 'Stunned', duration, flags: SF.STUN, debuff: true, vfx: 'stun' });
  }

  slow(u: Unit, pct: number, duration: number, id = `${this.def.id}-slow`): void {
    this.status(u, { id, name: 'Slowed', duration, mods: { moveSpeedPct: -pct }, debuff: true, vfx: 'slow' });
  }

  zone(center: Vec3, radius: number, duration: number, tickInterval: number, onTick: (z: Zone) => void, visual: string, follow = -1): Zone {
    return this.sim.spawnZone(this.hero.id, this.hero.team, center, radius, duration, tickInterval, onTick, visual, this.def.color, follow);
  }

  /** Straight-line dash of the caster. */
  dash(dx: number, dz: number, speed: number, duration: number, o: { onUnitHit?: (u: Unit) => boolean; onEnd?: () => void; stopOnWall?: boolean; up?: number } = {}): void {
    const h = this.hero;
    const l = Math.hypot(dx, dz) || 1;
    endForced(h);
    h.dashEnd = 0;
    h.forced = {
      kind: 'dash',
      vel: { x: (dx / l) * speed, y: o.up ?? 0, z: (dz / l) * speed },
      end: this.sim.time + duration,
      ballistic: false,
      onUnitHit: o.onUnitHit,
      onEnd: o.onEnd,
      hitIds: [],
      stopOnWall: o.stopOnWall ?? true,
    };
  }

  /** Ballistic leap toward a point with the given apex height. */
  leap(to: Vec3, apex: number, o: { onEnd?: () => void; onUnitHit?: (u: Unit) => boolean; maxTime?: number } = {}): void {
    const h = this.hero;
    const g = BALANCE.gravity;
    const dy = to.y - h.pos.y;
    const up = Math.sqrt(2 * g * Math.max(0.5, apex));
    const tUp = up / g;
    const fall = Math.max(0.2, apex - dy);
    const tDown = Math.sqrt((2 * fall) / g);
    const T = Math.min(o.maxTime ?? 3, tUp + tDown);
    const vx = (to.x - h.pos.x) / T;
    const vz = (to.z - h.pos.z) / T;
    endForced(h);
    h.grounded = false;
    h.forced = { kind: 'leap', vel: { x: vx, y: up, z: vz }, end: this.sim.time + T + 1.5, ballistic: true, onEnd: o.onEnd, onUnitHit: o.onUnitHit, hitIds: [], stopOnWall: false };
  }

  knockback(unit: Unit, dx: number, dz: number, speed: number, up = 3, duration = 0.25): void {
    const u = unit as AnyUnit;
    if (u.kind === 'structure' || u.kind === 'boss') return;
    if (u.flags & SF.UNSTOPPABLE) return;
    const l = Math.hypot(dx, dz) || 1;
    if (u.kind === 'hero') {
      if (u.zip) this.sim.knockOffZipline(u);
      endForced(u);
      u.forced = { kind: 'knockback', vel: { x: (dx / l) * speed, y: up, z: (dz / l) * speed }, end: this.sim.time + duration, ballistic: true, hitIds: [], stopOnWall: true };
      u.grounded = false;
    } else {
      u.vel.x += (dx / l) * speed;
      u.vel.z += (dz / l) * speed;
    }
  }

  /** Pulls a unit toward a point over time. */
  pull(unit: Unit, to: Vec3, speed: number): void {
    const u = unit as AnyUnit;
    const dx = to.x - u.pos.x;
    const dz = to.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return;
    if (u.kind === 'hero') {
      if (u.flags & SF.UNSTOPPABLE) return;
      if (u.zip) this.sim.knockOffZipline(u);
      endForced(u);
      u.forced = { kind: 'pull', vel: { x: (dx / d) * speed, y: 0, z: (dz / d) * speed }, end: this.sim.time + Math.min(0.6, d / speed), ballistic: false, hitIds: [], stopOnWall: true };
    } else if (u.kind !== 'structure' && u.kind !== 'boss') {
      const step = Math.min(d, speed * 0.1);
      u.pos.x += (dx / d) * step;
      u.pos.z += (dz / d) * step;
    }
  }

  summon(behavior: SummonBehavior, pos: Vec3, o: { hp: number; damage: number; range: number; attackInterval: number; speed: number; duration: number; visual: string; radius?: number; height?: number }): Summon {
    return this.sim.spawnSummon(this.hero, behavior, pos, o);
  }

  delay(seconds: number, fn: () => void): void {
    this.sim.schedule(seconds, fn);
  }

  vfx(kind: string, pos: Vec3, radius: number, duration: number, extra: { dir?: Vec3; to?: Vec3; unit?: number; color?: string } = {}): void {
    this.sim.events.push({ t: 'vfx', kind, pos: { ...pos }, radius, color: extra.color ?? this.def.color, duration, dir: extra.dir, to: extra.to, unit: extra.unit });
  }

  forwardXZ(): { x: number; z: number } {
    const l = Math.hypot(this.dir.x, this.dir.z) || 1;
    return { x: this.dir.x / l, z: this.dir.z / l };
  }

  groundAt(x: number, z: number, fromY: number): number {
    return this.sim.world.groundHeight(x, z, fromY + 0.6);
  }
}

// --- Targeting ----------------------------------------------------------------

/** Finds the unit closest to the aim ray within range and a small assist cone. */
export function findAimTarget(sim: Simulation, hero: Hero, range: number, enemies: boolean, coneDeg = 6): AnyUnit | null {
  const eye = heroEye(hero, { x: 0, y: 0, z: 0 });
  const dir = dirFromYawPitch({ x: 0, y: 0, z: 0 }, hero.input.yaw, hero.input.pitch);
  const cosLimit = Math.cos((coneDeg * Math.PI) / 180);
  let best: AnyUnit | null = null;
  let bestScore = -Infinity;
  sim.forEachUnitNear(eye, range + 2, (u) => {
    if (!u.alive || u.id === hero.id) return;
    if (enemies ? u.team === hero.team : u.team !== hero.team) return;
    if (u.kind === 'structure' && !enemies) return;
    if (enemies && u.flags & SF.INVISIBLE) return;
    const c = { x: u.pos.x, y: u.centerY(), z: u.pos.z };
    const dx = c.x - eye.x;
    const dy = c.y - eye.y;
    const dz = c.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range + u.radius) return;
    // Direct ray hit counts as perfect alignment.
    const direct = raySphere(eye, dir, c, u.radius + 0.4) >= 0;
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
    if (!direct && cos < cosLimit) return;
    if (sim.world.segmentBlocked(eye, c)) return;
    const score = (direct ? 2 : cos) + (u.kind === 'hero' ? 0.5 : 0) - d * 0.002;
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  });
  return best;
}

export function computeAimPoint(sim: Simulation, hero: Hero, range: number, out: Vec3): Vec3 {
  const eye = heroEye(hero, { x: 0, y: 0, z: 0 });
  const dir = dirFromYawPitch({ x: 0, y: 0, z: 0 }, hero.input.yaw, hero.input.pitch);
  const t = sim.world.raycast(eye, dir, range, sim.tmpHit);
  const d = t >= 0 ? Math.max(0, t - 0.2) : range;
  out.x = eye.x + dir.x * d;
  out.y = eye.y + dir.y * d;
  out.z = eye.z + dir.z * d;
  out.y = sim.world.groundHeight(out.x, out.z, out.y + 0.5);
  return out;
}

export type CastFailReason = 'locked' | 'cooldown' | 'silenced' | 'busy' | 'noTarget' | 'invalid' | null;

/** Attempts to start casting an ability. Returns the failure reason, or null on success. */
export function tryCastAbility(sim: Simulation, hero: Hero, slot: number): CastFailReason {
  const st = hero.abilities[slot - 1];
  if (!st || st.level <= 0) return 'locked';
  if (hero.flags & (SF.STUN | SF.SILENCE)) return 'silenced';
  if (hero.cast) return 'busy';
  if (hero.zip && st.def.targeting !== 'self') return 'busy';
  const maxCharges = abilityParam(st, 'charges');
  if (maxCharges > 1) {
    if (st.charges <= 0) return 'cooldown';
  } else if (sim.time < st.cooldownEnd) return 'cooldown';
  const range = abilityRange(hero, st);
  const def = st.def;
  let targetId = -1;
  if (def.targeting === 'enemy' || def.targeting === 'ally') {
    const t = findAimTarget(sim, hero, range, def.targeting === 'enemy', def.targeting === 'ally' ? 14 : 7);
    if (t) targetId = t.id;
    else if (def.targeting === 'ally') targetId = hero.id;
    else return 'noTarget';
  }
  const aimDir = dirFromYawPitch({ x: 0, y: 0, z: 0 }, hero.input.yaw, hero.input.pitch);
  const aimPoint = computeAimPoint(sim, hero, range > 0 ? range : 40, { x: 0, y: 0, z: 0 });
  const castTime = abilityParam(st, 'castTime');
  const cast: CastState = { slot, phase: 'windup', start: sim.time, end: sim.time + castTime, aimDir, aimPoint, targetId };
  sim.events.push({ t: 'cast', unit: hero.id, ability: def.id, slot, pos: { ...hero.pos }, dir: aimDir });
  if (castTime > 0) {
    hero.cast = cast;
    return null;
  }
  return executeAbility(sim, hero, st, cast) ? null : 'invalid';
}

function spendAbility(sim: Simulation, hero: Hero, st: AbilityState): void {
  const maxCharges = abilityParam(st, 'charges');
  const cd = abilityCooldown(hero, st);
  if (maxCharges > 1) {
    if (st.charges >= maxCharges) st.nextCharge = sim.time + cd;
    st.charges--;
    st.cooldownEnd = st.charges > 0 ? sim.time + 0.4 : st.nextCharge;
  } else st.cooldownEnd = sim.time + cd;
}

export function executeAbility(sim: Simulation, hero: Hero, st: AbilityState, cast: CastState): boolean {
  if (!st.def.params.keepsStealth) breakStealth(sim, hero);
  const ctx = new AbilityContext(sim, hero, st, cast);
  const ok = st.def.cast(ctx);
  if (ok === false) {
    hero.cast = null;
    return false;
  }
  spendAbility(sim, hero, st);
  const channel = abilityParam(st, 'channel') * (st.def.params.channelScalesDuration ? hero.stats.durationMul : 1);
  if (channel > 0) {
    hero.cast = { ...cast, phase: 'channel', start: sim.time, end: sim.time + channel };
  } else hero.cast = null;
  return true;
}

/** Advances windups and channels. */
export function updateCasting(sim: Simulation, hero: Hero, dt: number): void {
  const c = hero.cast;
  if (!c) return;
  const st = hero.abilities[c.slot - 1];
  if (c.phase === 'windup') {
    if (sim.time >= c.end) executeAbility(sim, hero, st, c);
    return;
  }
  const ctx = new AbilityContext(sim, hero, st, c);
  st.def.channelTick?.(ctx, dt);
  if (hero.cast && sim.time >= c.end) {
    hero.cast = null;
    st.def.channelEnd?.(ctx, false);
  }
}

/** Interrupts a windup (refunded) or channel (ends early). */
export function interruptCast(sim: Simulation, hero: Hero): void {
  const c = hero.cast;
  if (!c) return;
  hero.cast = null;
  const st = hero.abilities[c.slot - 1];
  if (c.phase === 'channel') {
    const ctx = new AbilityContext(sim, hero, st, c);
    st.def.channelEnd?.(ctx, true);
  }
}

/** Charge regeneration for multi-charge abilities. */
export function updateAbilityCharges(sim: Simulation, hero: Hero): void {
  for (const st of hero.abilities) {
    const maxCharges = abilityParam(st, 'charges');
    if (maxCharges <= 1) continue;
    if (st.charges < maxCharges && sim.time >= st.nextCharge && st.nextCharge > 0) {
      st.charges++;
      st.nextCharge = st.charges < maxCharges ? sim.time + abilityCooldown(hero, st) : 0;
      if (st.charges > 0 && sim.time >= st.cooldownEnd) st.cooldownEnd = 0;
    }
    if (st.charges > 0 && st.cooldownEnd > sim.time + 0.5) st.cooldownEnd = sim.time + 0.4;
  }
}

export function canUpgradeAbility(hero: Hero, slot: number): { ok: boolean; cost: number; reason?: string } {
  const st = hero.abilities[slot - 1];
  if (!st) return { ok: false, cost: 0, reason: 'invalid' };
  if (st.level >= 4) return { ok: false, cost: 0, reason: 'maxed' };
  const cost = st.level === 0 ? 1 : BALANCE.abilityUpgradeCost[st.level - 1];
  if (st.level === 0 && st.def.ultimate && hero.level < BALANCE.ultimateMinLevel) return { ok: false, cost, reason: `Requires level ${BALANCE.ultimateMinLevel}` };
  if (st.level > 0 && st.level - 1 >= 1 && hero.level < 2 * st.level) return { ok: false, cost, reason: `Requires level ${2 * st.level}` };
  if (hero.abilityPoints < cost) return { ok: false, cost, reason: 'Not enough ability points' };
  return { ok: true, cost };
}

export function upgradeAbility(hero: Hero, slot: number): boolean {
  const chk = canUpgradeAbility(hero, slot);
  if (!chk.ok) return false;
  const st = hero.abilities[slot - 1];
  hero.abilityPoints -= chk.cost;
  st.level++;
  if (st.level === 1) st.charges = Math.max(1, abilityParam(st, 'charges'));
  return true;
}
