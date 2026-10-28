import type { HeroDef } from '../../src/gameplay/types';
import { ITEM_MAP } from '../items';
import { CINDER } from './cinder';
import { GIDEON } from './gideon';
import { KESTREL } from './kestrel';
import { MORTIS } from './mortis';
import { ROOK } from './rook';
import { SERAPHINE } from './seraphine';
import { TESSA } from './tessa';
import { VESPER } from './vesper';

export const HERO_LIST: HeroDef[] = [ROOK, VESPER, CINDER, MORTIS, SERAPHINE, KESTREL, TESSA, GIDEON];

/**
 * Validates hero data at load time so a bad definition fails loudly instead
 * of silently breaking a match.
 */
export function validateHero(h: HeroDef): string[] {
  const errs: string[] = [];
  const e = (m: string) => errs.push(`${h.id}: ${m}`);
  if (!h.id || !h.name) e('missing id/name');
  if (h.base.maxHp <= 0 || h.base.moveSpeed <= 0) e('invalid base stats');
  if (h.base.stamina < 1) e('stamina must be >= 1');
  const w = h.weapon;
  if (w.damage <= 0 || w.fireInterval <= 0 || w.magazine <= 0 || w.pellets < 1) e(`weapon ${w.id} invalid numbers`);
  if (w.projectileSpeed <= 0) e('weapon projectile speed must be > 0');
  if (w.falloffEnd < w.falloffStart) e('weapon falloffEnd < falloffStart');
  if (w.fireMode === 'burst' && !(w.burstCount && w.burstCount > 1)) e('burst weapon needs burstCount > 1');
  if (h.abilities.length !== 4) e('needs exactly 4 abilities');
  h.abilities.forEach((a, i) => {
    if (a.slot !== i + 1) e(`ability ${a.id} slot ${a.slot} should be ${i + 1}`);
    if (a.ultimate !== (i === 3)) e(`ability ${a.id} ultimate flag mismatch`);
    if (!(a.params.cooldown > 0)) e(`ability ${a.id} needs cooldown > 0`);
    if (a.upgrades.length !== 3) e(`ability ${a.id} needs 3 upgrades`);
    for (const up of a.upgrades) for (const k of Object.keys(up.mods)) if (!Number.isFinite(up.mods[k])) e(`ability ${a.id} upgrade ${k} not finite`);
    for (const [k, v] of Object.entries(a.params)) if (!Number.isFinite(v)) e(`ability ${a.id} param ${k} not finite`);
    if (typeof a.cast !== 'function') e(`ability ${a.id} missing cast`);
    if (a.targeting !== 'self' && a.targeting !== 'direction' && !(a.params.range > 0)) e(`ability ${a.id} needs range`);
  });
  for (const id of h.ai.build) if (!ITEM_MAP[id]) e(`build references unknown item ${id}`);
  if (h.ai.skillOrder.some((s) => s < 1 || s > 4)) e('skillOrder slots must be 1-4');
  return errs;
}

const errors = HERO_LIST.flatMap(validateHero);
if (errors.length) throw new Error(`Invalid hero data:\n${errors.join('\n')}`);

export const HEROES: Record<string, HeroDef> = Object.fromEntries(HERO_LIST.map((h) => [h.id, h]));
