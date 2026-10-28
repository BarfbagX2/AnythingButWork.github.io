import { HERO_LIST } from '../data/heroes';
import type { Difficulty, HeroSlot } from '../src/core/simulation';

/** Deterministic all-bot lineup for headless matches. */
export function makeSlots(size: number, seed: number, difficulty: Difficulty | [Difficulty, Difficulty]): HeroSlot[] {
  const slots: HeroSlot[] = [];
  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < size; i++) {
      const def = HERO_LIST[(i * 3 + team * 5 + seed) % HERO_LIST.length];
      const diff = Array.isArray(difficulty) ? difficulty[team] : difficulty;
      slots.push({ team: team as 0 | 1, heroId: def.id, name: `${team === 0 ? 'A' : 'B'}${i}-${def.name.split(' ')[0]}`, isBot: true, difficulty: diff });
    }
  }
  return slots;
}
