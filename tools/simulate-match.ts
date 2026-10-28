/**
 * Headless autonomous match runner. Runs full bot-vs-bot matches and prints
 * timeline + summary statistics. Usage:
 *   npm run sim -- [--minutes 40] [--seed 1] [--difficulty normal] [--size 6] [--quiet]
 */
import { BotManager } from '../src/ai/botManager';
import { Simulation, type Difficulty } from '../src/core/simulation';
import { makeSlots } from './slots';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const minutes = Number(arg('minutes', '40'));
const seed = Number(arg('seed', '1'));
const difficulty = arg('difficulty', 'normal') as Difficulty;
const size = Number(arg('size', '6'));
const quiet = args.includes('--quiet');


const t0 = performance.now();
const sim = new Simulation({ seed, slots: makeSlots(size, seed, difficulty) });
const bots = new BotManager(sim);
sim.controllers.push((s) => bots.update(s));
console.log(`nav build ${bots.nav.buildMs.toFixed(0)}ms nodes ${bots.nav.aliveCount()}`);
let maxTick = 0;
let sumTick = 0;
let sumAi = 0;
let n = 0;
const kills = [0, 0];
const destroyed: string[] = [];
const maxTicks = minutes * 60 * sim.tickRate;
for (let i = 0; i < maxTicks && sim.phase !== 'ended'; i++) {
  sim.step();
  maxTick = Math.max(maxTick, sim.perf.tickMs);
  sumTick += sim.perf.tickMs;
  sumAi += bots.totalMs;
  n++;
  for (const e of sim.events.drain()) {
    if (e.t === 'heroKill') {
      const v = sim.units.get(e.victim);
      if (v) kills[1 - (v.team as number)]++;
    }
    if (e.t === 'structure' && e.state === 'destroyed') destroyed.push(`${(sim.matchTime / 60).toFixed(1)}m ${e.key}`);
    if (!quiet && e.t === 'announce' && e.kind !== 'warning') console.log(`[${(sim.matchTime / 60).toFixed(2)}m] ${e.text}`);
  }
  if (!quiet && i % (60 * 120) === 0 && i > 0) {
    const line = sim.heroes.map((h) => `${h.playerName}:L${h.level}/${h.match.kills}-${h.match.deaths}/${bots.brainOf(h.id)?.goal?.kind ?? '-'}`).join(' ');
    console.log(`  t=${(sim.matchTime / 60).toFixed(1)}m K ${kills[0]}-${kills[1]} troopers=${sim.troopers.filter((t) => t.alive).length} | ${line}`);
  }
}
const wall = (performance.now() - t0) / 1000;
console.log('---');
console.log(`result: ${sim.phase === 'ended' ? `team ${sim.winner} wins at ${(sim.matchTime / 60).toFixed(1)} min` : `no winner after ${minutes} min`}`);
console.log(`kills A ${kills[0]} B ${kills[1]}; structures destroyed: ${destroyed.length}`);
for (const d of destroyed) console.log('  ' + d);
console.log(`avg tick ${(sumTick / n).toFixed(3)}ms (ai ${(sumAi / n).toFixed(3)}ms) max ${maxTick.toFixed(1)}ms; wall ${wall.toFixed(1)}s for ${(n / 60 / 60).toFixed(1)} game-min`);
for (const h of sim.heroes) {
  console.log(`  ${h.playerName.padEnd(16)} L${String(h.level).padStart(2)} K/D/A ${h.match.kills}/${h.match.deaths}/${h.match.assists} LH ${h.match.lastHits} orbs ${h.match.orbsSecured} souls ${h.match.soulsEarned} items ${h.items.map((i) => i.def.id).join(',')}`);
}
