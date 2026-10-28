import type { Simulation } from '../core/simulation';
import type { AnyUnit, Hero, Unit } from './entities';
import { absorbWithShields } from './status';
import { SF, type DamageType } from './types';
import type { Vec3 } from '../core/math';

export interface DamageInfo {
  sourceId: number;
  amount: number;
  type: DamageType;
  crit?: boolean;
  abilityId?: string;
  pos?: Vec3;
  isDot?: boolean;
  noLifesteal?: boolean;
  /** Skip structure gating/backdoor (internal use only). */
  ignoreGates?: boolean;
}

/** Resolves the hero responsible for damage from a unit (summons -> owner). */
export function responsibleHero(sim: Simulation, sourceId: number): Hero | null {
  const src = sim.units.get(sourceId);
  if (!src) return null;
  if (src.kind === 'hero') return src;
  if (src.kind === 'summon') {
    const owner = sim.units.get(src.ownerId);
    return owner && owner.kind === 'hero' ? owner : null;
  }
  return null;
}

/**
 * The single entry point for all damage. Enforces team rules, invulnerability,
 * structure gating, backdoor protection, resistances, shields, lifesteal,
 * attribution, and death. Returns the health damage actually dealt.
 */
export function dealDamage(sim: Simulation, target: AnyUnit, info: DamageInfo): number {
  if (!target.alive || info.amount <= 0 || !Number.isFinite(info.amount)) return 0;
  const src = sim.units.get(info.sourceId) as AnyUnit | undefined;
  if (src && src.team === target.team) return 0;
  const pos = info.pos ?? { x: target.pos.x, y: target.centerY(), z: target.pos.z };

  if (target.flags & SF.INVULNERABLE) {
    sim.events.push({ t: 'impact', pos, normal: { x: 0, y: 1, z: 0 }, kind: 'shield' });
    return 0;
  }

  let amount = info.amount;
  if (target.kind === 'structure' && !info.ignoreGates) {
    if (!target.vulnerable) {
      sim.events.push({ t: 'impact', pos, normal: { x: 0, y: 1, z: 0 }, kind: 'shield' });
      return 0;
    }
    if (target.backdoor) amount *= 1 - target.def.backdoorReduction;
  }

  const srcHero = responsibleHero(sim, info.sourceId);
  if (info.type === 'spirit' && srcHero) amount *= srcHero.stats.spiritDamageMul;
  if (info.type === 'bullet' || info.type === 'melee') amount *= 1 - target.bulletResist;
  else if (info.type === 'spirit') amount *= 1 - target.spiritResist;
  if (target.kind === 'hero') amount *= target.stats.damageTakenMul;
  if (target.kind === 'trooper' && srcHero) {
    // Item passive: bonus damage vs troopers / reduced trooper damage taken is applied in items.
    amount *= sim.items.trooperDamageMul(srcHero);
  }
  if (src && src.kind === 'trooper' && target.kind === 'hero') amount *= sim.items.trooperResistMul(target);

  const before = amount;
  amount = absorbWithShields(target, amount, info.type === 'melee' ? 'bullet' : info.type);
  const shielded = before - amount;
  const dealt = Math.min(target.hp, amount);
  target.hp -= amount;
  target.lastDamagedAt = sim.time;

  if (srcHero) {
    target.attackers.set(srcHero.id, sim.time);
    if (target.kind === 'hero') {
      srcHero.match.heroDamage += dealt;
      srcHero.lastCombatTime = sim.time;
      target.lastCombatTime = sim.time;
    } else if (target.kind === 'structure') {
      srcHero.match.objectiveDamage += dealt;
    }
    if (!info.noLifesteal && dealt > 0) {
      const ls =
        info.type === 'bullet' || info.type === 'melee'
          ? srcHero.stats.bulletLifesteal * (target.kind === 'hero' ? 1 : 0.4)
          : info.type === 'spirit'
            ? srcHero.stats.spiritLifesteal * (target.kind === 'hero' ? 1 : 0.4)
            : 0;
      if (ls > 0) heal(sim, srcHero, dealt * ls, srcHero.id, true);
    }
    sim.items.onDamageDealt(srcHero, target, info, dealt);
  }
  if (target.kind === 'hero' && src && src.kind !== 'hero') target.lastCombatTime = Math.max(target.lastCombatTime, sim.time - 2);

  // Structures and troopers react to heroes attacking allied heroes nearby.
  if (srcHero && target.kind === 'hero') sim.notifyHeroAggression(srcHero, target);

  sim.events.push({
    t: 'damage',
    src: srcHero ? srcHero.id : info.sourceId,
    target: target.id,
    amount: Math.round(amount + shielded),
    type: info.type,
    crit: !!info.crit,
    pos,
    shielded: Math.round(shielded),
  });

  if (target.kind === 'hero') {
    if (target.zip && srcHero) sim.knockOffZipline(target);
    sim.items.onDamageTaken(target, dealt);
  }

  if (target.hp <= 0) {
    target.hp = 0;
    sim.killUnit(target, srcHero ? srcHero.id : info.sourceId);
  }
  return dealt;
}

export function heal(sim: Simulation, target: Unit, amount: number, sourceId: number, silent = false): number {
  if (!target.alive || amount <= 0) return 0;
  if (target.flags & SF.NO_HEAL) return 0;
  let a = amount;
  if (target.kind === 'hero') a *= (target as Hero).stats.healAmp;
  const actual = Math.min(target.maxHp - target.hp, a);
  if (actual <= 0) return 0;
  target.hp += actual;
  const src = sim.units.get(sourceId);
  if (src && src.kind === 'hero' && src.id !== target.id) src.match.healing += actual;
  if (!silent && actual >= 1) sim.events.push({ t: 'heal', target: target.id, amount: Math.round(actual), src: sourceId });
  return actual;
}

