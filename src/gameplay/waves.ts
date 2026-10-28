import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import type { LaneId, TeamId } from '../world/mapTypes';
import { spawnTrooper } from './troopers';

const W = BALANCE.waves;

export interface WaveState {
  nextWave: number;
  waveIndex: number;
}

export function initWaves(): WaveState {
  return { nextWave: W.firstWave, waveIndex: 0 };
}

/** Composition for one team's wave in one lane. */
export function waveComposition(sim: Simulation, team: TeamId, lane: LaneId, waveIndex: number): string[] {
  const comp: string[] = [...W.composition];
  const minutes = sim.matchTime / 60;
  if (minutes >= W.heavyAfterMinutes && waveIndex % W.heavyEvery === 0) comp.push('heavy');
  // Destroying the enemy base guardian in a lane upgrades your troopers there.
  const enemy = team === 0 ? 'b' : 'a';
  if (W.superAfterBaseGuardian && sim.structureDestroyed(`${enemy}-baseGuardian-${lane}`)) comp.push('super', 'super');
  return comp;
}

export function updateWaves(sim: Simulation): void {
  if (!sim.config.waves || sim.phase !== 'playing') return;
  const ws = sim.waves;
  if (sim.matchTime < ws.nextWave) return;
  ws.nextWave += W.interval;
  for (const team of [0, 1] as TeamId[]) {
    const alive = sim.troopers.reduce((n, t) => n + (t.alive && t.team === team ? 1 : 0), 0);
    for (const lane of [0, 1, 2] as LaneId[]) {
      if (alive >= W.maxPerTeam) break;
      const comp = waveComposition(sim, team, lane, ws.waveIndex);
      comp.forEach((type, slot) => spawnTrooper(sim, team, lane, type, slot));
    }
  }
  ws.waveIndex++;
}
