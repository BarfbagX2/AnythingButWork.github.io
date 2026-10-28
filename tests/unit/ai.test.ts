import { describe, expect, it } from 'vitest';
import { BotManager } from '../../src/ai/botManager';
import { Simulation, type Difficulty, type HeroSlot } from '../../src/core/simulation';
import { distXZ } from '../../src/core/math';
import type { TeamId } from '../../src/world/mapTypes';
import { arenaMap, place } from '../helpers';

interface Setup {
  heroes: { team: TeamId; heroId: string; isBot?: boolean; difficulty?: Difficulty }[];
  structures?: boolean;
  souls?: number;
}

function botSim(s: Setup): { sim: Simulation; bots: BotManager } {
  const slots: HeroSlot[] = s.heroes.map((h, i) => ({ team: h.team, heroId: h.heroId, name: `B${i}`, isBot: h.isBot ?? true, difficulty: h.difficulty ?? 'hard' }));
  const sim = new Simulation(
    { seed: 11, slots, waves: false, neutrals: false, boss: false, structures: !!s.structures, pregame: 0, startingSouls: s.souls ?? 0 },
    arenaMap([], !!s.structures),
  );
  const bots = new BotManager(sim);
  sim.controllers.push((x) => bots.update(x));
  return { sim, bots };
}

function runUntil(sim: Simulation, seconds: number, cond: () => boolean): boolean {
  const n = Math.round(seconds * sim.tickRate);
  for (let i = 0; i < n; i++) {
    sim.step();
    if (cond()) return true;
  }
  return false;
}

describe('bot AI scenarios', () => {
  it('engages an enemy that steps around a corner', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'tessa' }, { team: 1, heroId: 'rook', isBot: false }] });
    const [bot, enemy] = sim.heroes;
    place(bot, { x: 0, y: 0, z: 30 }, Math.PI);
    place(enemy, { x: 0, y: 0, z: 10 });
    // Wall (z 20..21, x -10..10) blocks line of sight.
    sim.run(1.5);
    expect(bots.brainOf(bot.id)!.perception.get(enemy.id)?.visible ?? false).toBe(false);
    place(enemy, { x: 13, y: 0, z: 24 });
    const hp0 = enemy.hp;
    const hit = runUntil(sim, 5, () => enemy.hp < hp0 - 30);
    expect(hit).toBe(true);
  });

  it('retreats at low health when threatened', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'vesper' }, { team: 1, heroId: 'rook', isBot: false }] });
    const [bot, enemy] = sim.heroes;
    place(bot, { x: 0, y: 0, z: 0 });
    place(enemy, { x: 0, y: 0, z: 8 });
    sim.run(1);
    bot.hp = bot.maxHp * 0.12;
    const ok = runUntil(sim, 3, () => bots.brainOf(bot.id)!.goal?.kind === 'retreat');
    expect(ok).toBe(true);
    const d0 = distXZ(bot.pos, sim.map.spawns[0].pos);
    sim.run(3);
    expect(distXZ(bot.pos, sim.map.spawns[0].pos)).toBeLessThan(d0);
  });

  it('defends a structure under attack by an enemy hero', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'rook' }, { team: 1, heroId: 'vesper', isBot: false }], structures: true });
    const [bot, enemy] = sim.heroes;
    const g = sim.structureByKeyGet('a-guardian-1')!;
    place(bot, { x: -40, y: 0, z: -40 });
    place(enemy, { x: g.pos.x, y: 0, z: g.pos.z + 18 }, Math.PI);
    sim.run(1);
    const ok = runUntil(sim, 6, () => {
      sim.dealDamage(g, { sourceId: enemy.id, amount: 5, type: 'bullet' });
      return bots.brainOf(bot.id)!.goal?.kind === 'defend';
    });
    expect(ok).toBe(true);
  });

  it('buys an affordable item when at a shop', () => {
    const { sim } = botSim({ heroes: [{ team: 0, heroId: 'gideon' }], souls: 3000 });
    const bot = sim.heroes[0];
    place(bot, { x: -30, y: 0, z: -30 });
    const ok = runUntil(sim, 4, () => bot.items.length > 0);
    expect(ok).toBe(true);
    expect(bot.def.ai.build).toContain(bot.items[0].def.id);
  });

  it('spends ability points', () => {
    const { sim } = botSim({ heroes: [{ team: 0, heroId: 'cinder' }] });
    const bot = sim.heroes[0];
    sim.run(1);
    expect(bot.abilities.some((a) => a.level > 0)).toBe(true);
    expect(bot.abilityPoints).toBe(0);
  });

  it('responds to a human teammate asking to group up', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'rook', isBot: false }, { team: 0, heroId: 'seraphine' }] });
    const [human, bot] = sim.heroes;
    place(human, { x: 50, y: 0, z: -40 });
    place(bot, { x: -50, y: 0, z: -40 });
    sim.run(0.5);
    human.actions.push({ type: 'ping', kind: 'group', x: 50, z: -40 });
    const ok = runUntil(sim, 3, () => bots.brainOf(bot.id)!.goal?.kind === 'group');
    expect(ok).toBe(true);
    const d0 = distXZ(bot.pos, human.pos);
    sim.run(5);
    expect(distXZ(bot.pos, human.pos)).toBeLessThan(d0 - 20);
    // It also acknowledged the command.
  });

  it('navigates around an obstacle to reach its destination', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'kestrel' }] });
    const bot = sim.heroes[0];
    const brain = bots.brainOf(bot.id)!;
    place(bot, { x: 0, y: 0, z: 12 });
    brain.nav.setDestination(sim, bot, { x: 0, y: 0, z: 32 }, true);
    // Drive only the navigator (no strategy) for this test.
    let reached = false;
    const move = { moveX: 0, moveZ: 0, jump: false, interact: false, dash: false, crouch: false, lookYaw: null as number | null };
    for (let i = 0; i < 60 * 12 && !reached; i++) {
      brain.nav.step(sim, bot, move);
      bot.input = { moveX: move.moveX, moveZ: move.moveZ, yaw: 0, pitch: 0, buttons: move.jump ? 4 : 0 };
      sim.controllers.length = 0;
      sim.step();
      reached = distXZ(bot.pos, { x: 0, y: 0, z: 32 }) < 1.5;
    }
    expect(reached).toBe(true);
  });

  it('recovers after death and returns to play', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'rook' }, { team: 1, heroId: 'vesper', isBot: false }] });
    const bot = sim.heroes[0];
    place(bot, { x: 0, y: 0, z: 0 });
    sim.run(1);
    sim.dealDamage(bot, { sourceId: sim.heroes[1].id, amount: 1e6, type: 'pure' });
    expect(bot.alive).toBe(false);
    sim.run(bot.respawnAt - sim.time + 6);
    expect(bot.alive).toBe(true);
    expect(bots.brainOf(bot.id)!.goal).not.toBe(null);
    expect(distXZ(bot.pos, sim.map.spawns[0].pos)).toBeGreaterThan(8);
  });

  it('does not know the position of enemies it has never seen', () => {
    const { sim, bots } = botSim({ heroes: [{ team: 0, heroId: 'rook' }, { team: 1, heroId: 'vesper', isBot: false }] });
    const [bot, enemy] = sim.heroes;
    place(bot, { x: 0, y: 0, z: 40 }, 0);
    place(enemy, { x: 0, y: 0, z: 12 });
    sim.run(2);
    expect(bots.brainOf(bot.id)!.perception.get(enemy.id)).toBeUndefined();
  });

  it('joins an objective fight when the team calls the mid-boss', () => {
    const heroes = [0, 1, 2, 3].map(() => ({ team: 0 as TeamId, heroId: 'rook' }));
    const { sim, bots } = botSim({ heroes: [...heroes, { team: 1, heroId: 'vesper', isBot: false }] });
    for (const h of sim.heroes) place(h, { x: 60, y: 0, z: 40 + Math.random() * 4 });
    place(sim.heroes[4], { x: -80, y: 0, z: -80 });
    sim.boss.respawnAt = 0;
    sim.run(0.2);
    const ok = runUntil(sim, 4, () => sim.heroes.slice(0, 4).filter((h) => bots.brainOf(h.id)!.goal?.kind === 'boss').length >= 2);
    expect(ok).toBe(true);
  });
});

describe('difficulty affects decision and aim quality, not stats', () => {
  function hitRate(d: Difficulty): number {
    const { sim } = botSim({ heroes: [{ team: 0, heroId: 'tessa', difficulty: d }, { team: 1, heroId: 'rook', isBot: false }] });
    const [bot, dummy] = sim.heroes;
    place(bot, { x: 0, y: 0, z: -40 });
    place(dummy, { x: 0, y: 0, z: -18 });
    dummy.hp = dummy.maxHp = 1e7;
    let fired = 0;
    let hits = 0;
    for (let i = 0; i < 60 * 12; i++) {
      // Strafing target.
      dummy.input = { ...dummy.input, moveX: Math.sin(i / 25) > 0 ? 1 : -1, moveZ: 0 };
      sim.step();
      for (const e of sim.events.drain()) {
        if (e.t === 'shot' && e.unit === bot.id) fired += e.pellets;
        if (e.t === 'damage' && e.src === bot.id && e.target === dummy.id) hits++;
      }
    }
    return fired ? hits / fired : 0;
  }

  it('expert bots hit a strafing target more often than easy bots', () => {
    const easy = hitRate('easy');
    const expert = hitRate('expert');
    expect(expert).toBeGreaterThan(easy + 0.1);
    expect(easy).toBeGreaterThan(0.02);
    expect(expert).toBeLessThan(0.98);
  });

  it('bot heroes have identical stats regardless of difficulty', () => {
    const a = botSim({ heroes: [{ team: 0, heroId: 'rook', difficulty: 'easy' }] }).sim.heroes[0];
    const b = botSim({ heroes: [{ team: 0, heroId: 'rook', difficulty: 'expert' }] }).sim.heroes[0];
    expect(a.stats).toEqual(b.stats);
  });
});
