import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../data/balance';
import { ITEM_MAP } from '../../data/items';
import { TROOPERS } from '../../data/units';
import { grantSouls, levelForSouls } from '../../src/gameplay/economy';
import { applyHeroStats, deriveHeroStats } from '../../src/gameplay/stats';
import { spawnTrooper } from '../../src/gameplay/troopers';
import { BTN, aimAt, hold, makeSim, place } from '../helpers';

describe('souls and levels', () => {
  it('levels are derived from total souls and grant ability points', () => {
    expect(levelForSouls(0)).toBe(1);
    expect(levelForSouls(BALANCE.levels[1])).toBe(2);
    expect(levelForSouls(BALANCE.levels[5] + 1)).toBe(6);
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    const ap0 = h.abilityPoints;
    grantSouls(sim, h, BALANCE.levels[3] + 10, 'trooper');
    expect(h.level).toBe(4);
    const expectedAp = BALANCE.abilityPointsAtLevel.slice(1, 4).reduce((a, b) => a + b, 0);
    expect(h.abilityPoints).toBe(ap0 + expectedAp);
    const ev = sim.events.drain().filter((e) => e.t === 'level');
    expect(ev.length).toBe(3);
  });

  it('passive income accrues while the match is running', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    const s0 = h.souls;
    sim.run(10.1);
    expect(h.souls - s0).toBeCloseTo(BALANCE.economy.passiveSoulsPerSecond * 10, 0);
  });

  it('last-hitting a trooper pays souls, spawns an orb that can be secured, and pays nearby allies', () => {
    const sim = makeSim([
      { team: 0, heroId: 'vesper' },
      { team: 0, heroId: 'seraphine' },
    ]);
    const [h, ally] = sim.heroes;
    place(h, { x: 0, y: 0, z: 0 });
    place(ally, { x: 3, y: 0, z: 0 });
    const t = spawnTrooper(sim, 1, 1, 'rifle', 0)!;
    t.pos = { x: 0, y: 0, z: 10 };
    t.prevPos = { ...t.pos };
    t.hp = 1;
    const s0 = h.souls;
    const a0 = ally.souls;
    sim.dealDamage(t, { sourceId: h.id, amount: 5, type: 'bullet' });
    expect(t.alive).toBe(false);
    expect(h.match.lastHits).toBe(1);
    expect(h.souls).toBeGreaterThan(s0);
    expect(ally.souls).toBeGreaterThan(a0);
    expect(sim.orbs.length).toBe(1);
    const orb = sim.orbs[0];
    // Shoot the orb.
    const before = h.souls;
    h.weapon.spread = 0;
    aimAt(h, orb.pos);
    hold(sim, h, BTN.FIRE, 1);
    sim.run(0.2);
    expect(orb.alive).toBe(false);
    expect(h.match.orbsSecured).toBe(1);
    expect(h.souls - before).toBeGreaterThanOrEqual(Math.round(orb.value) - 1);
  });

  it('allies of the dead trooper can deny its orb', () => {
    const sim = makeSim([
      { team: 0, heroId: 'vesper' },
      { team: 1, heroId: 'cinder' },
    ]);
    const [killer, denier] = sim.heroes;
    place(killer, { x: 0, y: 0, z: -10 });
    place(denier, { x: 0, y: 0, z: 25 }, Math.PI);
    const t = spawnTrooper(sim, 1, 1, 'rifle', 0)!;
    t.pos = { x: 0, y: 0, z: 10 };
    t.hp = 1;
    sim.dealDamage(t, { sourceId: killer.id, amount: 5, type: 'bullet' });
    const orb = sim.orbs[0];
    sim.claimOrb(orb, denier.id);
    expect(orb.alive).toBe(false);
    expect(denier.match.denies).toBe(1);
  });

  it('melee last hits pay the full value directly (no orb)', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 }, 0);
    const t = spawnTrooper(sim, 1, 1, 'rifle', 0)!;
    t.pos = { x: 0, y: 0, z: 1.8 };
    t.prevPos = { ...t.pos };
    t.hp = 5;
    sim.step();
    hold(sim, h, BTN.MELEE, 2);
    sim.run(0.3);
    expect(t.alive).toBe(false);
    expect(sim.orbs.length).toBe(0);
    expect(TROOPERS.rifle.souls).toBeGreaterThan(0);
  });
});

describe('items and shop', () => {
  it('requires a shop and enough souls', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    sim.step();
    expect(sim.items.check(h, 'iron-lung').reason).toMatch(/shop/i);
    place(h, { x: -30, y: 0, z: -30 });
    sim.step();
    h.souls = 100;
    expect(sim.items.check(h, 'iron-lung').reason).toMatch(/souls/i);
    h.souls = 5000;
    h.actions.push({ type: 'buy', itemId: 'iron-lung' });
    sim.step();
    expect(h.items.map((i) => i.def.id)).toContain('iron-lung');
    expect(h.souls).toBe(5000 - ITEM_MAP['iron-lung'].cost);
  });

  it('item stats apply once and never stack across respawns', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: -30, y: 0, z: -30 });
    sim.step();
    const base = h.maxHp;
    h.souls = 5000;
    h.actions.push({ type: 'buy', itemId: 'iron-lung' });
    sim.step();
    expect(h.maxHp).toBe(base + 150);
    sim.dealDamage(h, { sourceId: -1, amount: 99999, type: 'pure' });
    sim.run(h.respawnAt - sim.time + 0.2);
    for (let i = 0; i < 5; i++) applyHeroStats(h, deriveHeroStats(h));
    expect(h.maxHp).toBe(base + 150);
    expect(h.hp).toBe(h.maxHp);
  });

  it('upgrading from a component credits its cost and replaces it', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: -30, y: 0, z: -30 });
    sim.step();
    h.souls = 10000;
    h.actions.push({ type: 'buy', itemId: 'iron-lung' });
    sim.step();
    const c = sim.items.check(h, 'colossus-heart');
    expect(c.cost).toBe(ITEM_MAP['colossus-heart'].cost - ITEM_MAP['iron-lung'].cost);
    h.actions.push({ type: 'buy', itemId: 'colossus-heart' });
    sim.step();
    const ids = h.items.map((i) => i.def.id);
    expect(ids).toContain('colossus-heart');
    expect(ids).not.toContain('iron-lung');
  });

  it('enforces category slots and flex slots', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: -30, y: 0, z: -30 });
    sim.step();
    h.souls = 100000;
    for (const id of ['iron-lung', 'healing-flask', 'fleet-boots']) h.actions.push({ type: 'buy', itemId: id });
    sim.step();
    expect(h.items.length).toBe(3);
    expect(sim.items.check(h, 'bullet-ward').reason).toMatch(/slot/i);
    sim.teams[0].flexSlots = 1;
    expect(sim.items.check(h, 'bullet-ward').ok).toBe(true);
  });

  it('selling refunds half and actives work with cooldowns', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: -30, y: 0, z: -30 });
    sim.step();
    h.souls = 5000;
    h.actions.push({ type: 'buy', itemId: 'healing-flask' });
    sim.step();
    h.hp = 100;
    hold(sim, h, BTN.I1, 1);
    const it = h.items[0];
    expect(it.cooldownEnd).toBeGreaterThan(sim.time);
    sim.run(3);
    expect(h.hp).toBeGreaterThan(200);
    const before = h.souls;
    h.actions.push({ type: 'sell', itemId: 'healing-flask' });
    sim.step();
    expect(h.items.length).toBe(0);
    expect(h.souls - before).toBe(Math.round(ITEM_MAP['healing-flask'].cost * BALANCE.economy.sellRefund));
  });
});
