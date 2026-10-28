/** Diagnostic: goal distribution and structure damage sources over a match. */
import { BotManager } from '../src/ai/botManager';
import { Simulation } from '../src/core/simulation';
import { makeSlots } from './slots';

const minutes = Number(process.argv[2] ?? 25);
const seed = Number(process.argv[3] ?? 2);
const sim = new Simulation({ seed, slots: makeSlots(6, seed, 'normal') });
const bots = new BotManager(sim);
sim.controllers.push((s) => bots.update(s));
const goalTime: Record<string, number>[] = [{}, {}];
const structDmg: Record<string, number> = {};
let calls: Record<string, number> = {};
for (let i = 0; i < minutes * 3600 && sim.phase !== 'ended'; i++) {
  sim.step();
  for (const e of sim.events.drain()) {
    if (e.t === 'damage') {
      const tgt = sim.units.get(e.target);
      if (tgt && tgt.kind === 'structure') {
        const src = sim.units.get(e.src);
        const k = `${src ? src.kind : '?'}->${tgt.def.type}`;
        structDmg[k] = (structDmg[k] ?? 0) + e.amount;
      }
    }
  }
  if (i % 60 === 0) for (const b of bots.brains.values()) {
    const g = b.hero.alive ? (b.goal?.kind ?? 'none') : 'dead';
    goalTime[b.hero.team][g] = (goalTime[b.hero.team][g] ?? 0) + 1;
  }
  if (i % 600 === 0) for (const t of bots.teams) for (const c of t.calls) calls[`${t.team}:${c.kind}`] = (calls[`${t.team}:${c.kind}`] ?? 0) + 1;
}
const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ');
console.log('goal-seconds team0:', fmt(goalTime[0]));
console.log('goal-seconds team1:', fmt(goalTime[1]));
console.log('structure damage:', fmt(Object.fromEntries(Object.entries(structDmg).map(([k, v]) => [k, Math.round(v)]))));
console.log('calls (sampled every 10s):', fmt(calls));
console.log('destroyed:', sim.structures.filter((s) => !s.alive).map((s) => s.key).join(' '));
