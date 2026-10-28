import { Simulation } from '../src/core/simulation';
import { HERO_LIST } from '../data/heroes';

const t0 = performance.now();
const slots = [] as any[];
for (let team = 0; team < 2; team++) for (let i = 0; i < 6; i++) slots.push({ team, heroId: HERO_LIST[(i + team) % HERO_LIST.length].id, name: `H${team}${i}`, isBot: true });
const sim = new Simulation({ seed: 7, slots });
console.log('build ms', (performance.now() - t0).toFixed(1), 'solids', sim.map.solids.length, 'structures', sim.structures.length);
let maxTick = 0, sum = 0, n = 0;
for (let s = 0; s < 60 * 60 * 4; s++) {
  sim.step();
  maxTick = Math.max(maxTick, sim.perf.tickMs); sum += sim.perf.tickMs; n++;
  if (s % (60 * 30) === 0) {
    const alive = sim.troopers.filter(t => t.alive);
    console.log(`t=${sim.matchTime.toFixed(0)} troopers=${alive.length} (a=${alive.filter(t=>t.team===0).length} b=${alive.filter(t=>t.team===1).length}) proj=${sim.projectiles.length} neutrals=${sim.neutrals.filter(x=>x.alive).length} structHP=${sim.structures.filter(x=>x.def.type==='guardian').map(x=>Math.round(x.hp)).join(',')}`);
  }
}
const ev = sim.events.drain();
console.log('avg tick ms', (sum / n).toFixed(3), 'max', maxTick.toFixed(2), 'events', ev.length);
console.log('hero souls', sim.heroes.map(h => h.souls).join(','));
