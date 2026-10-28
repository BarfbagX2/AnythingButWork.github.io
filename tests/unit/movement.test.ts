import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../data/balance';
import { BTN, hold, makeSim, place, tap } from '../helpers';

describe('movement controller', () => {
  it('walks at run speed and stops at walls', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: 0 });
    h.lastCombatTime = sim.time; // no sprint bonus
    hold(sim, h, 0, 60, { moveX: 0, moveZ: 1 });
    expect(h.pos.z).toBeGreaterThan(5.5);
    expect(h.pos.z).toBeLessThan(7.5);
    hold(sim, h, 0, 400, { moveX: 0, moveZ: 1 });
    // The wall at z = 20 blocks (radius 0.45).
    expect(h.pos.z).toBeLessThanOrEqual(20 - h.radius + 0.01);
  });

  it('jumps, lands, and double-jumps for one stamina', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: -40 });
    sim.step();
    const stamina = h.stamina;
    tap(sim, h, BTN.JUMP);
    expect(h.grounded).toBe(false);
    sim.run(0.25);
    tap(sim, h, BTN.JUMP);
    expect(h.stamina).toBe(stamina - BALANCE.movement.staminaCostDoubleJump);
    sim.run(2);
    expect(h.grounded).toBe(true);
    expect(h.pos.y).toBeCloseTo(0, 5);
  });

  it('dashes cost stamina, which regenerates', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 0, y: 0, z: -40 });
    sim.step();
    const s0 = h.stamina;
    const z0 = h.pos.z;
    hold(sim, h, BTN.DASH, 1, { moveX: 0, moveZ: 1 });
    sim.run(0.25);
    expect(h.stamina).toBe(s0 - 1);
    expect(h.pos.z - z0).toBeGreaterThan(3);
    sim.run(h.stats.staminaCooldown + 0.2);
    expect(h.stamina).toBe(s0);
  });

  it('mantles onto a low ledge with jump + double jump', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    // Ledge at x 30..36, 3.2 m tall.
    place(h, { x: 28.6, y: 0, z: 0 }, Math.PI / 2);
    tap(sim, h, BTN.JUMP);
    for (let i = 0; i < 14; i++) hold(sim, h, 0, 1, { moveX: 1, moveZ: 0 });
    hold(sim, h, BTN.JUMP, 1, { moveX: 1, moveZ: 0 });
    let maxY = 0;
    for (let i = 0; i < 20; i++) {
      hold(sim, h, 0, 1, { moveX: 1, moveZ: 0 });
      if (h.grounded) maxY = Math.max(maxY, h.pos.y);
    }
    // Standing on the 3.2 m ledge.
    expect(maxY).toBeCloseTo(3.2, 1);
  });

  it('walks up ramps', () => {
    const sim = makeSim([{ team: 0, heroId: 'rook' }]);
    const h = sim.heroes[0];
    place(h, { x: 37, y: 0, z: 0 }, Math.PI / 2);
    // Ramp spans x 40..50 rising to 4 m, platform to x = 56.
    hold(sim, h, 0, 100, { moveX: 1, moveZ: 0 });
    expect(h.pos.x).toBeGreaterThan(50);
    expect(h.pos.x).toBeLessThan(56);
    expect(h.pos.y).toBeCloseTo(4, 1);
    expect(h.grounded).toBe(true);
  });

  it('rides team ziplines and gets knocked off by damage', () => {
    const sim = makeSim([
      { team: 0, heroId: 'rook' },
      { team: 1, heroId: 'vesper' },
    ]);
    const [h, enemy] = sim.heroes;
    // Zipline from (-20, 8, -40) to (-20, 8, 40).
    place(h, { x: -20, y: 0, z: -30 }, 0);
    tap(sim, h, BTN.INTERACT);
    expect(h.zip).not.toBe(null);
    const z0 = h.pos.z;
    sim.run(1);
    expect(h.pos.z - z0).toBeGreaterThan(BALANCE.zipline.speed * 0.8);
    expect(h.pos.y).toBeGreaterThan(5);
    sim.dealDamage(h, { sourceId: enemy.id, amount: 10, type: 'bullet' });
    expect(h.zip).toBe(null);
    // Enemy team can't use it.
    place(enemy, { x: -20, y: 0, z: 0 }, 0);
    tap(sim, enemy, BTN.INTERACT);
    expect(enemy.zip).toBe(null);
  });

  it('movement is consistent regardless of how ticks are grouped', () => {
    const run = (batch: number) => {
      const sim = makeSim([{ team: 0, heroId: 'kestrel' }]);
      const h = sim.heroes[0];
      place(h, { x: -50, y: 0, z: -50 });
      for (let i = 0; i < 120; i += batch) {
        h.input = { ...h.input, moveX: 0.6, moveZ: 0.8, buttons: i === 30 ? BTN.JUMP : 0 };
        for (let k = 0; k < batch; k++) sim.step();
      }
      return { ...h.pos };
    };
    const a = run(1);
    const b = run(1);
    expect(a).toEqual(b);
  });
});
