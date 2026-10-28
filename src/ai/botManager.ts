import { BALANCE } from '../../data/balance';
import { DIFFICULTY } from '../../data/ai';
import type { Simulation } from '../core/simulation';
import { getNav, type NavGrid } from '../world/nav';
import type { TeamId } from '../world/mapTypes';
import { BotBrain } from './brain';
import { TeamCoordinator } from './team';

/** Creates and runs a brain for every bot hero plus a coordinator per team. */
export class BotManager {
  readonly nav: NavGrid;
  readonly teams: [TeamCoordinator, TeamCoordinator];
  readonly brains = new Map<number, BotBrain>();
  totalMs = 0;

  constructor(sim: Simulation) {
    this.nav = getNav(sim.world, sim.map, BALANCE.zipline.speed);
    const coord = (team: TeamId) => {
      const slots = sim.config.slots.filter((s) => s.team === team && s.isBot);
      const diffs = slots.map((s) => DIFFICULTY[s.difficulty ?? sim.config.difficulty].coordination);
      const c = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0.6;
      return new TeamCoordinator(team, sim, c);
    };
    this.teams = [coord(0), coord(1)];
    sim.heroes.forEach((h, i) => {
      if (!h.isBot) return;
      const slot = sim.config.slots[i];
      const brain = new BotBrain(h, this.nav, this.teams[h.team0], slot?.difficulty ?? sim.config.difficulty, slot?.personality, sim.config.seed * 7919 + h.id * 104729);
      this.brains.set(h.id, brain);
    });
  }

  brainOf(heroId: number): BotBrain | undefined {
    return this.brains.get(heroId);
  }

  update(sim: Simulation): void {
    const t0 = performance.now();
    if (sim.phase === 'ended') {
      for (const b of this.brains.values()) b.hero.input = { moveX: 0, moveZ: 0, yaw: b.hero.yaw, pitch: 0, buttons: 0 };
      return;
    }
    this.teams[0].update();
    this.teams[1].update();
    for (const b of this.brains.values()) b.update(sim);
    this.totalMs = performance.now() - t0;
  }
}
