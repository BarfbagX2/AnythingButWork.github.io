import type { AbilityContext } from '../../src/gameplay/abilities';
import type { AnyUnit, Unit } from '../../src/gameplay/entities';
import type { WeaponDef } from '../../src/gameplay/types';
import type { Vec3 } from '../../src/core/math';

/** Weapon defaults; hero files override what makes each gun distinct. */
export function weapon(w: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'style' | 'damage' | 'fireInterval' | 'magazine'>): WeaponDef {
  return {
    fireMode: 'auto',
    pellets: 1,
    reloadTime: 2.2,
    spread: 0.012,
    spreadMoving: 0.02,
    spreadPerShot: 0.004,
    spreadMax: 0.05,
    spreadRecovery: 0.12,
    falloffStart: 22,
    falloffEnd: 50,
    falloffMin: 0.55,
    range: 90,
    critMul: 1.65,
    projectileSpeed: 420,
    gravity: 0,
    projectileRadius: 0.04,
    recoil: 1.2,
    tracer: 'tracer',
    sound: 'rifle',
    ...w,
  };
}

/** Ground point clamped to the ability range (aim point already is). */
export function groundPoint(c: AbilityContext): Vec3 {
  const p = { ...c.point };
  p.y = c.groundAt(p.x, p.z, p.y);
  return p;
}

export function isHero(u: Unit): boolean {
  return u.kind === 'hero';
}

export function centerOf(u: Unit): Vec3 {
  return { x: u.pos.x, y: u.centerY(), z: u.pos.z };
}

export function alive(u: AnyUnit | null | undefined): u is AnyUnit {
  return !!u && u.alive;
}

/** Spirit-damage explosion helper used by several heroes. */
export function blast(c: AbilityContext, pos: Vec3, radius: number, damage: number, extra?: (u: AnyUnit) => void, vfx = 'blast'): number {
  const n = c.aoe(pos, radius, 'enemies', (u) => {
    c.damage(u, damage);
    if (extra && u.alive) extra(u);
  }, { structures: false });
  c.vfx(vfx, pos, radius, 0.45);
  return n;
}
