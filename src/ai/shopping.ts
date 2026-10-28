import { BALANCE } from '../../data/balance';
import { ITEM_MAP, ITEMS } from '../../data/items';
import type { DifficultyProfile } from '../../data/ai';
import type { Simulation } from '../core/simulation';
import { canUpgradeAbility } from '../gameplay/abilities';
import type { Hero } from '../gameplay/entities';
import type { ItemDef } from '../gameplay/types';

/**
 * Bot economy decisions: which items to buy (adapted to the enemy team and
 * the match stage) and how to spend ability points. Bots buy through the
 * same queued actions a player's shop clicks produce.
 */

export interface EnemyComposition {
  spiritHeavy: number;
  bulletHeavy: number;
  healers: number;
  burst: number;
}

export function enemyComposition(sim: Simulation, hero: Hero): EnemyComposition {
  const c: EnemyComposition = { spiritHeavy: 0, bulletHeavy: 0, healers: 0, burst: 0 };
  for (const e of sim.heroes) {
    if (e.team === hero.team) continue;
    const role = e.def.role;
    if (role === 'Controller' || role === 'Summoner') c.spiritHeavy++;
    if (role === 'Marksman' || role === 'Assassin' || role === 'Bruiser') c.bulletHeavy++;
    if (role === 'Support') c.healers++;
    if (e.items.some((i) => i.def.tags.includes('sustain'))) c.healers += 0.5;
    if (role === 'Assassin') c.burst++;
  }
  return c;
}

/** The hero's build list, adapted to the enemy composition. */
export function adaptedBuild(sim: Simulation, hero: Hero): string[] {
  const build = [...hero.def.ai.build];
  const comp = enemyComposition(sim, hero);
  const insert = (id: string, at: number) => {
    if (!build.includes(id)) build.splice(Math.min(at, build.length), 0, id);
  };
  if (comp.spiritHeavy >= 3) insert('spirit-ward', 2);
  if (comp.bulletHeavy >= 4) insert('bullet-ward', 2);
  if (comp.healers >= 1.5) insert('anti-heal-rounds', 6);
  if (comp.burst >= 2) insert('barrier', 4);
  return build;
}

function itemValue(hero: Hero, it: ItemDef): number {
  const role = hero.def.role;
  let v = it.tier;
  const spiritHero = ['Controller', 'Summoner', 'Support'].includes(role);
  if (it.category === 'spirit') v += spiritHero ? 1 : -1.5;
  if (it.category === 'weapon') v += spiritHero ? -0.6 : 1;
  if (it.category === 'vitality') v += role === 'Bruiser' || role === 'Specialist' ? 0.8 : 0.3;
  if (it.tags.includes('farm')) v += 0.2;
  return v;
}

/**
 * Picks the next purchase. Returns item ids to sell first (to free a slot),
 * and the item to buy, or null.
 */
export function chooseNextBuy(sim: Simulation, hero: Hero, diff: DifficultyProfile, rnd: () => number): { buy: string; sell?: string } | null {
  const build = adaptedBuild(sim, hero);
  const owned = new Set(hero.items.map((i) => i.def.id));
  const upgradedFrom = new Set(hero.items.map((i) => i.def.component).filter(Boolean));
  // Sloppier bots sometimes skip ahead in their build.
  const sloppy = rnd() > diff.shopping;
  for (const id of build) {
    if (owned.has(id) || upgradedFrom.has(id)) continue;
    const def = ITEM_MAP[id];
    if (!def) continue;
    const chk = sim.items.check(hero, id, true);
    if (chk.ok) return { buy: id };
    if (chk.reason?.startsWith('No free')) {
      // Slots full: sell the weakest owned T1 of the same category (not a component of this item).
      const sellable = hero.items
        .filter((i) => i.def.category === def.category && i.def.tier < def.tier && i.def.id !== def.component)
        .sort((a, b) => a.def.tier - b.def.tier || a.def.cost - b.def.cost)[0];
      if (sellable && hero.souls + Math.round(sellable.def.cost * BALANCE.economy.sellRefund) >= chk.cost) return { buy: id, sell: sellable.def.id };
    }
    // Save up for the next build item unless it's far away.
    if (!sloppy && hero.souls < chk.cost && chk.cost - hero.souls < 900) return null;
    break;
  }
  // Fallback: best affordable useful item not in the build (avoid hoarding souls).
  if (hero.souls < 1200) return null;
  const options = ITEMS.filter((it) => !owned.has(it.id) && !upgradedFrom.has(it.id) && itemValue(hero, it) > 1 && sim.items.check(hero, it.id, true).ok)
    .sort((a, b) => itemValue(hero, b) - itemValue(hero, a));
  return options.length ? { buy: options[0].id } : null;
}

/** Spends ability points following the hero's skill order; ultimate ASAP. */
export function spendAbilityPoints(hero: Hero): (1 | 2 | 3 | 4)[] {
  const out: (1 | 2 | 3 | 4)[] = [];
  const sim = { ap: hero.abilityPoints };
  const levels = hero.abilities.map((a) => a.level);
  const tryUp = (slot: 1 | 2 | 3 | 4) => {
    const st = hero.abilities[slot - 1];
    const saved = st.level;
    st.level = levels[slot - 1];
    const savedAp = hero.abilityPoints;
    hero.abilityPoints = sim.ap;
    const chk = canUpgradeAbility(hero, slot);
    st.level = saved;
    hero.abilityPoints = savedAp;
    if (!chk.ok) return false;
    sim.ap -= chk.cost;
    levels[slot - 1]++;
    out.push(slot);
    return true;
  };
  // Unlock everything first (ult as soon as allowed), then follow the order.
  for (const slot of [4, 1, 2, 3] as const) if (levels[slot - 1] === 0) tryUp(slot);
  for (let guard = 0; guard < 12 && sim.ap > 0; guard++) {
    let any = false;
    for (const slot of hero.def.ai.skillOrder) {
      if (tryUp(slot)) {
        any = true;
        break;
      }
    }
    if (!any) break;
  }
  return out;
}
