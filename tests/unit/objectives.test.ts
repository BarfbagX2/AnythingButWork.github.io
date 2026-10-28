import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../data/balance';
import { PATRON_PHASE2 } from '../../data/units';
import { Simulation } from '../../src/core/simulation';
import { spawnTrooper } from '../../src/gameplay/troopers';
import { arenaMap, makeSim, place } from '../helpers';

const withStructures = () => makeSim([{ team: 0, heroId: 'rook' }, { team: 1, heroId: 'vesper' }], { structures: true, map: arenaMap([], true) });

describe('structures and objectives', () => {
  it('later structures are invulnerable until their prerequisites fall', () => {
    const sim = withStructures();
    const [a] = sim.heroes;
    const g = sim.structureByKeyGet('b-guardian-1')!;
    const w = sim.structureByKeyGet('b-walker-1')!;
    expect(g.vulnerable).toBe(true);
    expect(w.vulnerable).toBe(false);
    expect(sim.dealDamage(w, { sourceId: a.id, amount: 500, type: 'pure' })).toBe(0);
    sim.dealDamage(g, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    expect(g.alive).toBe(false);
    expect(w.vulnerable).toBe(true);
  });

  it('backdoor protection reduces damage when no enemy troopers are near', () => {
    const sim = withStructures();
    const [a] = sim.heroes;
    const g = sim.structureByKeyGet('b-guardian-1')!;
    sim.run(0.5);
    expect(g.backdoor).toBe(true);
    const hp0 = g.hp;
    sim.dealDamage(g, { sourceId: a.id, amount: 1000, type: 'pure' });
    expect(hp0 - g.hp).toBeCloseTo(1000 * (1 - g.def.backdoorReduction), 3);
    // Friendly troopers near the enemy structure disable the protection.
    for (let i = 0; i < 3; i++) {
      const t = spawnTrooper(sim, 0, 1, 'rifle', i)!;
      t.pos = { x: g.pos.x + 3 + i, y: 0, z: g.pos.z - 10 };
    }
    sim.run(0.5);
    expect(g.backdoor).toBe(false);
  });

  it('structures prefer troopers and switch to heroes that attack allied heroes', () => {
    const sim = withStructures();
    const [a, b] = sim.heroes;
    const g = sim.structureByKeyGet('b-guardian-1')!;
    place(a, { x: g.pos.x, y: 0, z: g.pos.z - 12 });
    place(b, { x: g.pos.x + 2, y: 0, z: g.pos.z - 6 });
    const t = spawnTrooper(sim, 0, 1, 'rifle', 0)!;
    t.pos = { x: g.pos.x - 2, y: 0, z: g.pos.z - 8 };
    t.prevPos = { ...t.pos };
    sim.run(0.5);
    expect(g.targetId).toBe(t.id);
    sim.dealDamage(b, { sourceId: a.id, amount: 10, type: 'bullet' });
    sim.run(0.5);
    expect(g.targetId).toBe(a.id);
  });

  it('the Patron has two phases and its death ends the match', () => {
    const sim = withStructures();
    const [a] = sim.heroes;
    for (const k of ['b-guardian-1', 'b-walker-1']) sim.dealDamage(sim.structureByKeyGet(k)!, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    const p = sim.structureByKeyGet('b-patron')!;
    expect(p.vulnerable).toBe(true);
    sim.dealDamage(p, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    expect(p.alive).toBe(true);
    expect(p.phase).toBe(2);
    expect(p.maxHp).toBe(PATRON_PHASE2.maxHp);
    expect(sim.phase).toBe('playing');
    sim.dealDamage(p, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    expect(p.alive).toBe(false);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(0);
  });

  it('destroying structures pays the team and unlocks flex slots', () => {
    const sim = withStructures();
    const [a] = sim.heroes;
    const s0 = a.souls;
    sim.dealDamage(sim.structureByKeyGet('b-guardian-1')!, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    expect(a.souls).toBeGreaterThan(s0);
    sim.dealDamage(sim.structureByKeyGet('b-walker-1')!, { sourceId: a.id, amount: 1e9, type: 'pure', ignoreGates: true });
    expect(sim.teams[0].flexSlots).toBe(1);
  });
});

describe('trooper waves', () => {
  it('waves spawn on schedule in every lane for both teams', () => {
    const sim = makeSim([], { waves: true });
    sim.run(BALANCE.waves.firstWave + 0.1);
    const comp = BALANCE.waves.composition.length;
    expect(sim.troopers.filter((t) => t.alive).length).toBe(comp * 3 * 2);
    sim.run(BALANCE.waves.interval);
    // Earlier troopers may already have died; count the fresh wave.
    expect(sim.troopers.filter((t) => sim.time - t.spawnedAt < 0.5).length).toBe(comp * 3 * 2);
  });

  it('troopers advance along their lane and fight enemy troopers', () => {
    const sim = makeSim([], { waves: true });
    sim.run(BALANCE.waves.firstWave + 0.1);
    const t = sim.troopers.find((x) => x.team === 0 && x.lane === 1)!;
    const z0 = t.pos.z;
    sim.run(5);
    expect(t.pos.z).toBeGreaterThan(z0 + 15);
    // Waves meet in the middle and kill each other.
    sim.run(60);
    expect(sim.troopers.some((x) => !x.alive) || sim.troopers.length < 48).toBe(true);
  });

  it('troopers never accumulate beyond the cap and never get permanently stuck', () => {
    const sim = makeSim([], { waves: true });
    sim.run(240);
    const alive = sim.troopers.filter((t) => t.alive);
    expect(alive.filter((t) => t.team === 0).length).toBeLessThanOrEqual(BALANCE.waves.maxPerTeam + 10);
    for (const t of alive) expect(t.stuckTime).toBeLessThan(10);
  });
});

describe('match state machine', () => {
  it('goes pregame -> playing at the configured time', () => {
    const sim = new Simulation({ seed: 3, slots: [{ team: 0, heroId: 'rook', name: 'A', isBot: false }], pregame: 2, waves: false, neutrals: false, boss: false }, arenaMap());
    expect(sim.phase).toBe('pregame');
    sim.run(1);
    expect(sim.phase).toBe('pregame');
    sim.run(1.1);
    expect(sim.phase).toBe('playing');
  });

  it('enemy heroes inside a fountain are punished', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }, { team: 1, heroId: 'vesper' }]);
    const [, b] = sim.heroes;
    place(b, { x: 0, y: 0, z: -95 });
    sim.run(4);
    expect(b.alive).toBe(false);
  });
});
