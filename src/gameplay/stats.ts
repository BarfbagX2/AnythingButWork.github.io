import type { Hero, HeroStats } from './entities';
import type { StatKey, StatMods } from './types';

/**
 * Hero statistics are re-derived every tick from base values, level growth,
 * owned items, active statuses and team buffs. Nothing is ever added to a
 * stat in place, so buying/selling items, dying, or respawning can never
 * permanently stack bonuses.
 */

const RESIST_KEYS: StatKey[] = ['bulletResist', 'spiritResist'];

export interface ModAccumulator {
  sum: Record<string, number>;
  bulletResists: number[];
  spiritResists: number[];
}

export function newAccumulator(): ModAccumulator {
  return { sum: {}, bulletResists: [], spiritResists: [] };
}

export function addMods(acc: ModAccumulator, mods: StatMods | undefined, scale = 1): void {
  if (!mods) return;
  for (const k in mods) {
    const v = (mods as Record<string, number>)[k] * scale;
    if (k === 'bulletResist') acc.bulletResists.push(v);
    else if (k === 'spiritResist') acc.spiritResists.push(v);
    else acc.sum[k] = (acc.sum[k] ?? 0) + v;
  }
}

function combineResist(base: number, pcts: number[]): number {
  let keep = 1 - base;
  for (const p of pcts) keep *= 1 - p / 100;
  return Math.max(-1, Math.min(0.8, 1 - keep));
}

export function levelBonus(hero: Hero): { maxHp: number; weaponDamagePct: number; spiritPower: number } {
  const l = hero.level - 1;
  const g = hero.def.growth;
  return { maxHp: g.maxHp * l, weaponDamagePct: g.weaponDamagePct * l, spiritPower: g.spiritPower * l };
}

export function deriveHeroStats(hero: Hero, extra: StatMods[] = []): HeroStats {
  const acc = newAccumulator();
  const lb = levelBonus(hero);
  addMods(acc, { maxHp: lb.maxHp, weaponDamagePct: lb.weaponDamagePct, spiritPower: lb.spiritPower });
  for (const it of hero.items) addMods(acc, it.def.mods);
  for (const s of hero.statuses) addMods(acc, s.spec.mods, s.stacks);
  for (const m of extra) addMods(acc, m);
  const g = (k: string) => acc.sum[k] ?? 0;
  const b = hero.def.base;
  const movePct = Math.max(-75, g('moveSpeedPct'));
  const stats: HeroStats = {
    maxHp: Math.max(1, (b.maxHp + g('maxHp')) * (1 + g('maxHpPct') / 100)),
    hpRegen: b.hpRegen + g('hpRegen'),
    moveSpeed: Math.max(1.5, (b.moveSpeed + g('moveSpeed')) * (1 + movePct / 100)),
    sprintSpeed: b.sprintSpeed + g('sprintSpeed'),
    stamina: Math.max(1, Math.round(b.stamina + g('stamina'))),
    staminaCooldown: 5 / (1 + Math.max(-50, g('staminaCooldownPct')) / 100),
    weaponDamageMul: Math.max(0.1, 1 + g('weaponDamagePct') / 100),
    fireRateMul: Math.max(0.2, 1 + g('fireRatePct') / 100),
    magazineMul: Math.max(0.2, 1 + g('magazinePct') / 100),
    reloadMul: 1 / Math.max(0.2, 1 + g('reloadPct') / 100),
    bulletResist: combineResist(b.bulletResist, acc.bulletResists),
    spiritResist: combineResist(b.spiritResist, acc.spiritResists),
    spiritPower: Math.max(0, g('spiritPower')),
    cooldownMul: 1 - Math.min(50, Math.max(-50, g('cooldownPct'))) / 100,
    rangeMul: 1 + g('rangePct') / 100,
    durationMul: Math.max(0.2, 1 + g('durationPct') / 100),
    bulletLifesteal: Math.max(0, g('bulletLifesteal')) / 100,
    spiritLifesteal: Math.max(0, g('spiritLifesteal')) / 100,
    meleeDamageMul: Math.max(0.1, 1 + g('meleeDamagePct') / 100),
    headshotBonus: g('headshotPct') / 100,
    bulletVelocityMul: Math.max(0.3, 1 + g('bulletVelocityPct') / 100),
    healAmp: Math.max(0, 1 + g('healAmpPct') / 100),
    damageTakenMul: Math.max(0.1, 1 + g('damageTakenPct') / 100),
    spiritDamageMul: Math.max(0.1, 1 + g('spiritDamagePct') / 100),
  };
  return stats;
}

/** Applies derived stats to the hero, preserving the health fraction semantics. */
export function applyHeroStats(hero: Hero, stats: HeroStats): void {
  const oldMax = hero.maxHp;
  hero.stats = stats;
  hero.bulletResist = stats.bulletResist;
  hero.spiritResist = stats.spiritResist;
  if (stats.maxHp !== oldMax) {
    if (hero.alive && stats.maxHp > oldMax) hero.hp += stats.maxHp - oldMax;
    hero.maxHp = stats.maxHp;
    if (hero.hp > hero.maxHp) hero.hp = hero.maxHp;
  }
  const mag = Math.max(1, Math.round(hero.def.weapon.magazine * stats.magazineMul));
  if (mag !== hero.weapon.magazine) {
    hero.weapon.magazine = mag;
    if (hero.weapon.ammo > mag) hero.weapon.ammo = mag;
  }
}

export { RESIST_KEYS };
