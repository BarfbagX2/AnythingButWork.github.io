import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../data/balance';
import { HEROES } from '../../data/heroes';
import { applyStatus } from '../../src/gameplay/status';
import { SF, type ItemDef } from '../../src/gameplay/types';
import { BTN, aimAt, hold, makeSim, place } from '../helpers';

const centerOf = (h: { pos: { x: number; y: number; z: number }; height: number }) => ({ x: h.pos.x, y: h.pos.y + h.height * 0.5, z: h.pos.z });

describe('damage rules', () => {
  it('applies bullet and spirit resistances separately', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'vesper' },
    ]);
    const [a, b] = sim.heroes;
    b.bulletResist = 0.5;
    b.spiritResist = 0.25;
    const hp0 = b.hp;
    sim.dealDamage(b, { sourceId: a.id, amount: 100, type: 'bullet' });
    expect(hp0 - b.hp).toBeCloseTo(50, 5);
    const hp1 = b.hp;
    sim.dealDamage(b, { sourceId: a.id, amount: 100, type: 'spirit' });
    expect(hp1 - b.hp).toBeCloseTo(75, 5);
    const hp2 = b.hp;
    sim.dealDamage(b, { sourceId: a.id, amount: 100, type: 'pure' });
    expect(hp2 - b.hp).toBeCloseTo(100, 5);
  });

  it('blocks friendly fire and damage to invulnerable units', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 0, heroId: 'vesper' },
      { team: 1, heroId: 'cinder' },
    ]);
    const [a, ally, enemy] = sim.heroes;
    expect(sim.dealDamage(ally, { sourceId: a.id, amount: 100, type: 'bullet' })).toBe(0);
    applyStatus(sim, enemy, { id: 'inv', name: 'Inv', duration: 5, flags: SF.INVULNERABLE, debuff: false }, enemy.id);
    expect(sim.dealDamage(enemy, { sourceId: a.id, amount: 100, type: 'bullet' })).toBe(0);
  });

  it('shields absorb damage before health', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'vesper' },
    ]);
    const [a, b] = sim.heroes;
    applyStatus(sim, b, { id: 'sh', name: 'Shield', duration: 5, shield: 80, debuff: false }, b.id);
    const hp0 = b.hp;
    sim.dealDamage(b, { sourceId: a.id, amount: 50, type: 'pure' });
    expect(b.hp).toBe(hp0);
    sim.dealDamage(b, { sourceId: a.id, amount: 50, type: 'pure' });
    expect(hp0 - b.hp).toBeCloseTo(20, 5);
  });

  it('kills set a respawn timer, award souls and credit assists', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 0, heroId: 'seraphine' },
      { team: 1, heroId: 'vesper' },
    ]);
    const [killer, helper, victim] = sim.heroes;
    const k0 = killer.souls;
    const h0 = helper.souls;
    sim.dealDamage(victim, { sourceId: helper.id, amount: 100, type: 'pure' });
    sim.dealDamage(victim, { sourceId: killer.id, amount: 10000, type: 'pure' });
    expect(victim.alive).toBe(false);
    expect(victim.match.deaths).toBe(1);
    expect(killer.match.kills).toBe(1);
    expect(helper.match.assists).toBe(1);
    expect(killer.souls).toBeGreaterThan(k0);
    expect(helper.souls).toBeGreaterThan(h0);
    expect(victim.respawnAt).toBeGreaterThan(sim.time);
    // Respawns at its fountain with full health.
    sim.run(victim.respawnAt - sim.time + 0.1);
    expect(victim.alive).toBe(true);
    expect(victim.hp).toBe(victim.maxHp);
    expect(sim.inFountain(victim)).toBe(true);
  });

  it('bullet lifesteal heals the attacker', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'vesper' },
    ]);
    const [a, b] = sim.heroes;
    const lifesteal: ItemDef = { id: 'ls', name: 'LS', category: 'weapon', tier: 1, cost: 1, description: '', icon: '', mods: { bulletLifesteal: 50 }, tags: [] };
    a.items.push({ def: lifesteal, cooldownEnd: 0, procReadyAt: 0 });
    sim.step();
    a.hp = 100;
    sim.dealDamage(b, { sourceId: a.id, amount: 100, type: 'bullet' });
    expect(a.hp).toBeGreaterThan(140);
  });
});

describe('weapons', () => {
  it('consumes ammo, respects fire rate and reloads', () => {
    const sim = makeSim([{ team: 0, heroId: 'cinder' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    const w = h.weapon;
    const mag = w.magazine;
    // Hold fire for one second.
    hold(sim, h, BTN.FIRE, 60);
    const fired = mag - w.ammo;
    const expected = 1 / HEROES.cinder.weapon.fireInterval;
    expect(fired).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(fired).toBeLessThanOrEqual(Math.ceil(expected) + 1);
    hold(sim, h, BTN.RELOAD, 1);
    expect(w.reloading).toBe(true);
    sim.run(HEROES.cinder.weapon.reloadTime + 0.1);
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(mag);
  });

  it('semi-automatic weapons fire once per press', () => {
    const sim = makeSim([{ team: 0, heroId: 'vesper' }]);
    const h = sim.heroes[0];
    // Outside the fountain (which refills ammo).
    place(h, { x: 0, y: 0, z: 0 });
    const before = h.weapon.ammo;
    hold(sim, h, BTN.FIRE, 120);
    expect(before - h.weapon.ammo).toBe(1);
  });

  it('auto-reloads when the magazine is empty', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    h.weapon.ammo = 0;
    hold(sim, h, BTN.FIRE, 2);
    expect(h.weapon.reloading).toBe(true);
  });

  it('projectiles hit a target in front and walls block them', () => {
    const sim = makeSim([
      { team: 0, heroId: 'vesper' },
      { team: 1, heroId: 'rook' },
    ]);
    const [shooter, target] = sim.heroes;
    place(shooter, { x: 0, y: 0, z: 0 });
    place(target, { x: 0, y: 0, z: 12 }, Math.PI);
    shooter.weapon.spread = 0;
    aimAt(shooter, centerOf(target));
    const hp0 = target.hp;
    hold(sim, shooter, BTN.FIRE, 1);
    sim.run(0.2);
    expect(target.hp).toBeLessThan(hp0);
    // Behind the wall at z = 20..21.
    place(target, { x: 0, y: 0, z: 30 }, Math.PI);
    target.hp = target.maxHp;
    sim.run(1);
    aimAt(shooter, centerOf(target));
    hold(sim, shooter, BTN.FIRE, 1);
    sim.run(0.3);
    expect(target.hp).toBe(target.maxHp);
  });

  it('headshots deal critical damage', () => {
    const sim = makeSim([
      { team: 0, heroId: 'vesper' },
      { team: 1, heroId: 'rook' },
    ]);
    const [shooter, target] = sim.heroes;
    place(shooter, { x: 0, y: 0, z: 0 });
    place(target, { x: 0, y: 0, z: 10 }, Math.PI);
    target.bulletResist = 0;
    const crits: boolean[] = [];
    const amounts: number[] = [];
    for (const aimY of [target.pos.y + target.height * 0.45, target.pos.y + target.headHeight]) {
      target.hp = target.maxHp;
      shooter.weapon.spread = 0;
      aimAt(shooter, { x: 0, y: aimY, z: 10 });
      sim.run(1);
      hold(sim, shooter, BTN.FIRE, 1);
      sim.run(0.2);
      const ev = sim.events.drain().filter((e) => e.t === 'damage' && e.target === target.id);
      expect(ev.length).toBeGreaterThan(0);
      const d = ev[0] as Extract<(typeof ev)[number], { t: 'damage' }>;
      crits.push(d.crit);
      amounts.push(d.amount);
    }
    expect(crits).toEqual([false, true]);
    expect(amounts[1]).toBeGreaterThan(amounts[0] * 1.5);
  });

  it('damage falls off with distance', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'gideon' },
    ]);
    const [shooter, target] = sim.heroes;
    const dmgAt = (z: number) => {
      place(shooter, { x: -40, y: 0, z: -40 });
      place(target, { x: -40, y: 0, z: -40 + z }, Math.PI);
      target.hp = target.maxHp;
      shooter.weapon.spread = 0;
      aimAt(shooter, centerOf(target));
      sim.run(1);
      sim.events.drain();
      hold(sim, shooter, BTN.FIRE, 1);
      sim.run(0.3);
      return sim.events.drain().filter((e) => e.t === 'damage' && e.target === target.id).reduce((s, e) => s + (e as { amount: number }).amount, 0);
    };
    const near = dmgAt(4);
    const far = dmgAt(25);
    expect(near).toBeGreaterThan(far * 1.5);
  });
});

describe('melee and parry', () => {
  it('light melee damages an adjacent enemy; parry stuns the attacker', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'kestrel' },
    ]);
    const [a, b] = sim.heroes;
    place(a, { x: 0, y: 0, z: 0 }, 0);
    place(b, { x: 0, y: 0, z: 1.6 }, Math.PI);
    const hp0 = b.hp;
    hold(sim, a, BTN.MELEE, 2);
    sim.run(0.3);
    expect(b.hp).toBeLessThan(hp0);
    // Parry the next swing.
    sim.run(BALANCE.melee.lightCooldown);
    b.input.buttons = BTN.PARRY;
    sim.step();
    b.input.buttons = 0;
    const hp1 = b.hp;
    hold(sim, a, BTN.MELEE, 2);
    sim.run(0.3);
    // Parried: no damage taken (regeneration may tick up slightly).
    expect(b.hp).toBeGreaterThanOrEqual(hp1 - 0.01);
    expect(a.flags & SF.STUN).toBeTruthy();
  });
});
