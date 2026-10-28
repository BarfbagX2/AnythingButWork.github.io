/** Measures bot hit rates vs a strafing target at several ranges per difficulty. */
import { BotManager } from '../src/ai/botManager';
import { Simulation, type Difficulty } from '../src/core/simulation';
import { arenaMap, place } from '../tests/helpers';

function rate(d: Difficulty, hero: string, range: number, strafe: boolean): number {
  const sim = new Simulation({ seed: 5, slots: [{ team: 0, heroId: hero, name: 'bot', isBot: true, difficulty: d }, { team: 1, heroId: 'rook', name: 'dummy', isBot: false }], waves: false, neutrals: false, boss: false, structures: false, pregame: 0 }, arenaMap());
  const bots = new BotManager(sim);
  const [bot, dummy] = sim.heroes;
  // Isolate aiming/firing: the bot decides as usual but doesn't relocate.
  sim.controllers.push((s) => {
    bots.update(s);
    bot.input.moveX = 0;
    bot.input.moveZ = 0;
    bot.input.buttons &= ~(4 | 8);
  });
  place(bot, { x: 0, y: 0, z: -60 });
  place(dummy, { x: 0, y: 0, z: -60 + range });
  dummy.hp = dummy.maxHp = 1e7;
  let fired = 0, hits = 0;
  for (let i = 0; i < 60 * 40; i++) {
    dummy.input = { ...dummy.input, moveX: strafe ? (Math.sin(i / 30) > 0 ? 1 : -1) : 0, moveZ: 0 };
    bot.weapon.ammo = bot.weapon.magazine; // isolate aim from reloads
    sim.step();
    for (const e of sim.events.drain()) {
      if (e.t === 'shot' && e.unit === bot.id) fired += e.pellets;
      if (e.t === 'damage' && e.src === bot.id && e.target === dummy.id) hits++;
    }
  }
  return fired ? hits / fired : -1;
}
for (const hero of ['tessa', 'vesper', 'cinder']) {
  for (const range of [12, 25, 40]) {
    const row = (['easy', 'normal', 'hard', 'expert'] as Difficulty[]).map((d) => `${d}:${(rate(d, hero, range, true) * 100).toFixed(0)}%`).join(' ');
    console.log(`${hero.padEnd(7)} ${String(range).padStart(2)}m strafe  ${row}`);
  }
}
