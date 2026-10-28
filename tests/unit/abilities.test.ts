import { describe, expect, it } from 'vitest';
import { abilityParam, tryCastAbility, upgradeAbility } from '../../src/gameplay/abilities';
import { applyStatus } from '../../src/gameplay/status';
import { SF } from '../../src/gameplay/types';
import { BTN, aimAt, hold, makeSim, place } from '../helpers';

describe('ability framework', () => {
  it('locked abilities cannot be cast; unlocking spends an ability point', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    expect(tryCastAbility(sim, h, 1)).toBe('locked');
    expect(h.abilityPoints).toBe(1);
    expect(upgradeAbility(h, 1)).toBe(true);
    expect(h.abilityPoints).toBe(0);
    expect(h.abilities[0].level).toBe(1);
    expect(upgradeAbility(h, 2)).toBe(false);
  });

  it('ultimates require the minimum level', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    h.abilityPoints = 5;
    expect(upgradeAbility(h, 4)).toBe(false);
    h.level = 6;
    expect(upgradeAbility(h, 4)).toBe(true);
  });

  it('casting starts the cooldown and blocks recasting until it ends', () => {
    const sim = makeSim([{ team: 0, heroId: 'seraphine' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    upgradeAbility(h, 3); // Radiant Pulse (self AoE, no target needed)
    hold(sim, h, BTN.A3, 1);
    const st = h.abilities[2];
    expect(st.cooldownEnd).toBeGreaterThan(sim.time);
    expect(tryCastAbility(sim, h, 3)).toBe('cooldown');
    sim.run(abilityParam(st, 'cooldown') + 0.1);
    expect(tryCastAbility(sim, h, 3)).toBe(null);
  });

  it('upgrades change ability parameters', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    h.abilityPoints = 10;
    h.level = 10;
    upgradeAbility(h, 1);
    const base = abilityParam(h.abilities[0], 'damage');
    upgradeAbility(h, 1);
    expect(abilityParam(h.abilities[0], 'damage')).toBe(base + 45);
  });

  it('AoE abilities damage every enemy in range and spare allies', () => {
    const sim = makeSim([
      { team: 0, heroId: 'seraphine' },
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'vesper' },
      { team: 1, heroId: 'cinder' },
    ]);
    const [caster, ally, e1, e2] = sim.heroes;
    place(caster, { x: 0, y: 0, z: 0 });
    place(ally, { x: 2, y: 0, z: 0 });
    place(e1, { x: 0, y: 0, z: 4 });
    place(e2, { x: -3, y: 0, z: 2 });
    upgradeAbility(caster, 3);
    const hp = [ally.hp, e1.hp, e2.hp];
    hold(sim, caster, BTN.A3, 1);
    expect(ally.hp).toBe(hp[0]);
    expect(e1.hp).toBeLessThan(hp[1]);
    expect(e2.hp).toBeLessThan(hp[2]);
  });

  it('projectile abilities travel and hit (hex bolt silences)', () => {
    const sim = makeSim([
      { team: 0, heroId: 'kestrel' },
      { team: 1, heroId: 'rook' },
    ]);
    const [k, r] = sim.heroes;
    place(k, { x: 0, y: 0, z: 0 });
    place(r, { x: 0, y: 0, z: 15 }, Math.PI);
    k.abilityPoints = 1;
    upgradeAbility(k, 2);
    aimAt(k, { x: 0, y: r.pos.y + 1.1, z: 15 });
    const hp0 = r.hp;
    hold(sim, k, BTN.A2, 1);
    sim.run(0.5);
    expect(r.hp).toBeLessThan(hp0);
    expect(r.flags & SF.SILENCE).toBeTruthy();
    // Silenced heroes can't cast.
    r.abilityPoints = 1;
    upgradeAbility(r, 3);
    expect(tryCastAbility(sim, r, 3)).toBe('silenced');
  });

  it('stuns interrupt channelled abilities', () => {
    const sim = makeSim([
      { team: 0, heroId: 'cinder' },
      { team: 1, heroId: 'rook' },
    ]);
    const [c, r] = sim.heroes;
    place(c, { x: 0, y: 0, z: 0 });
    place(r, { x: 0, y: 0, z: 3 });
    c.level = 6;
    c.abilityPoints = 1;
    upgradeAbility(c, 4);
    hold(sim, c, BTN.A4, 1);
    expect(c.cast?.phase).toBe('channel');
    applyStatus(sim, c, { id: 'stun', name: 'Stun', duration: 1, flags: SF.STUN, debuff: true }, r.id);
    expect(c.cast).toBe(null);
    const hp0 = r.hp;
    sim.run(2);
    // The nova never fired.
    expect(r.hp).toBeGreaterThanOrEqual(hp0 - 1);
  });

  it('dashes move the caster and respect walls', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 10 }, 0);
    upgradeAbility(h, 1);
    aimAt(h, { x: 0, y: 1.6, z: 30 });
    hold(sim, h, BTN.A1, 1);
    sim.run(1);
    // Charged toward +z but stopped by the wall at z = 20.
    expect(h.pos.z).toBeGreaterThan(15);
    expect(h.pos.z).toBeLessThan(20);
  });

  it('summons appear, fight for their owner and expire', () => {
    const sim = makeSim([
      { team: 0, heroId: 'mortis' },
      { team: 1, heroId: 'rook' },
    ]);
    const [m, r] = sim.heroes;
    place(m, { x: 0, y: 0, z: 0 });
    place(r, { x: 0, y: 0, z: 8 }, Math.PI);
    upgradeAbility(m, 1);
    hold(sim, m, BTN.A1, 1);
    expect(sim.summons.filter((s) => s.alive).length).toBe(2);
    const hp0 = r.hp;
    sim.run(4);
    expect(r.hp).toBeLessThan(hp0);
    sim.run(25);
    expect(sim.summons.filter((s) => s.alive).length).toBe(0);
  });
});

describe('status effects', () => {
  it('damage over time ticks and expires', () => {
    const sim = makeSim([
      { team: 0, heroId: 'cinder' },
      { team: 1, heroId: 'rook' },
    ]);
    const [c, r] = sim.heroes;
    place(r, { x: 0, y: 0, z: 0 });
    r.spiritResist = 0;
    // Disable regeneration so the total is exact.
    r.lastDamagedAt = sim.time;
    sim.step();
    r.stats.hpRegen = 0;
    const hp0 = r.hp;
    applyStatus(sim, r, { id: 'burn', name: 'Burn', duration: 2, dps: 50, dotType: 'pure', debuff: true }, c.id);
    let total = 0;
    for (const e of (sim.run(2.2), sim.events.drain())) if (e.t === 'damage' && e.target === r.id) total += e.amount;
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
    expect(hp0 - r.hp).toBeGreaterThan(80);
    expect(r.statuses.some((s) => s.spec.id === 'burn')).toBe(false);
  });

  it('slows reduce movement speed and stats are re-derived (no stacking)', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    sim.step();
    const base = h.stats.moveSpeed;
    applyStatus(sim, h, { id: 'slow', name: 'Slow', duration: 1, mods: { moveSpeedPct: -50 }, debuff: true }, -1);
    sim.step();
    expect(h.stats.moveSpeed).toBeCloseTo(base * 0.5, 1);
    sim.run(1.2);
    expect(h.stats.moveSpeed).toBeCloseTo(base, 5);
    // Re-deriving many times never accumulates.
    sim.run(2);
    expect(h.stats.moveSpeed).toBeCloseTo(base, 5);
  });

  it('roots stop movement but not shooting', () => {
    const sim = makeSim([{ team: 0, heroId: 'cinder' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    applyStatus(sim, h, { id: 'root', name: 'Root', duration: 2, flags: SF.ROOT, debuff: true }, -1);
    const ammo = h.weapon.ammo;
    hold(sim, h, BTN.FIRE, 30, { moveX: 0, moveZ: 1 });
    expect(Math.abs(h.pos.z)).toBeLessThan(0.05);
    expect(h.weapon.ammo).toBeLessThan(ammo);
  });
});
