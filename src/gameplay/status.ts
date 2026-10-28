import type { Simulation } from '../core/simulation';
import type { AnyUnit, Unit } from './entities';
import { SF, type StatusInstance, type StatusSpec } from './types';

const CC_FLAGS = SF.STUN | SF.ROOT | SF.SILENCE | SF.DISARM;
const DOT_INTERVAL = 0.5;

export function applyStatus(
  sim: Simulation,
  target: Unit,
  spec: StatusSpec,
  sourceId: number,
  abilityId?: string,
): StatusInstance | null {
  if (!target.alive) return null;
  if (spec.debuff) {
    if (target.flags & SF.INVULNERABLE) return null;
    // Structures and the mid-boss ignore crowd control and slows.
    if (target.kind === 'structure' || target.kind === 'boss') {
      if (!spec.dps) return null;
    }
    if ((spec.flags ?? 0) & CC_FLAGS && target.flags & SF.UNSTOPPABLE) return null;
  }
  const duration = spec.duration;
  const existing = target.statuses.find((s) => s.spec.id === spec.id && s.sourceId === sourceId);
  if (existing) {
    existing.spec = spec;
    existing.endTime = Math.max(existing.endTime, sim.time + duration);
    if (spec.stacking === 'stack') existing.stacks = Math.min(spec.maxStacks ?? 99, existing.stacks + 1);
    if (spec.shield) existing.shieldLeft = Math.max(existing.shieldLeft, spec.shield);
    target.flags |= spec.flags ?? 0;
    return existing;
  }
  const inst: StatusInstance = {
    spec,
    sourceId,
    startTime: sim.time,
    endTime: sim.time + duration,
    stacks: 1,
    shieldLeft: spec.shield ?? 0,
    dotAccum: 0,
    abilityId,
  };
  target.statuses.push(inst);
  target.flags |= spec.flags ?? 0;
  if (spec.flags && spec.flags & SF.STUN) sim.interruptUnit(target);
  if (spec.flags && spec.flags & SF.SILENCE) sim.interruptUnit(target, true);
  sim.events.push({ t: 'status', unit: target.id, id: spec.id, on: true });
  return inst;
}

export function removeStatus(sim: Simulation, target: Unit, id: string): void {
  for (let i = target.statuses.length - 1; i >= 0; i--) {
    if (target.statuses[i].spec.id === id) {
      target.statuses.splice(i, 1);
      sim.events.push({ t: 'status', unit: target.id, id, on: false });
    }
  }
  refreshFlags(target);
}

export function cleanseDebuffs(sim: Simulation, target: Unit): void {
  for (let i = target.statuses.length - 1; i >= 0; i--) {
    const s = target.statuses[i];
    if (s.spec.debuff) {
      target.statuses.splice(i, 1);
      sim.events.push({ t: 'status', unit: target.id, id: s.spec.id, on: false });
    }
  }
  refreshFlags(target);
}

export function refreshFlags(u: Unit): void {
  let f = 0;
  for (const s of u.statuses) f |= s.spec.flags ?? 0;
  u.flags = f;
}

export function hasStatus(u: Unit, id: string): boolean {
  return u.statuses.some((s) => s.spec.id === id);
}

/** Expires statuses and applies damage/heal over time. */
export function updateStatuses(sim: Simulation, u: Unit, dt: number): void {
  if (u.statuses.length === 0) {
    u.flags = 0;
    return;
  }
  let flags = 0;
  for (let i = u.statuses.length - 1; i >= 0; i--) {
    const s = u.statuses[i];
    const expired = sim.time >= s.endTime || (s.spec.shield !== undefined && s.spec.shield > 0 && s.shieldLeft <= 0 && !s.spec.mods && !s.spec.flags);
    if (expired || !u.alive) {
      u.statuses.splice(i, 1);
      sim.events.push({ t: 'status', unit: u.id, id: s.spec.id, on: false });
      continue;
    }
    flags |= s.spec.flags ?? 0;
    if (s.spec.dps || s.spec.hps) {
      s.dotAccum += dt;
      if (s.dotAccum >= DOT_INTERVAL) {
        s.dotAccum -= DOT_INTERVAL;
        if (s.spec.dps) {
          sim.dealDamage(u as AnyUnit, {
            sourceId: s.sourceId,
            amount: s.spec.dps * DOT_INTERVAL * s.stacks,
            type: s.spec.dotType ?? 'spirit',
            abilityId: s.abilityId,
            isDot: true,
          });
          if (!u.alive) return;
        }
        if (s.spec.hps) sim.heal(u, s.spec.hps * DOT_INTERVAL * s.stacks, s.sourceId);
      }
    }
  }
  u.flags = flags;
}

/** Consumes shields for incoming damage; returns the remaining damage. */
export function absorbWithShields(u: Unit, amount: number, type: string): number {
  if (amount <= 0) return amount;
  for (const s of u.statuses) {
    if (s.shieldLeft <= 0) continue;
    const st = s.spec.shieldType ?? 'any';
    if (st !== 'any' && st !== type) continue;
    const take = Math.min(s.shieldLeft, amount);
    s.shieldLeft -= take;
    amount -= take;
    if (amount <= 0) return 0;
  }
  return amount;
}

export function totalShield(u: Unit): number {
  let t = 0;
  for (const s of u.statuses) t += Math.max(0, s.shieldLeft);
  return t;
}

/** Removes statuses flagged breakOnAttack (called when a hero attacks). */
export function breakStealth(sim: Simulation, u: Unit): void {
  if (!u.statuses.some((s) => s.spec.breakOnAttack)) return;
  for (let i = u.statuses.length - 1; i >= 0; i--) {
    if (u.statuses[i].spec.breakOnAttack) {
      sim.events.push({ t: 'status', unit: u.id, id: u.statuses[i].spec.id, on: false });
      u.statuses.splice(i, 1);
    }
  }
  refreshFlags(u);
}
