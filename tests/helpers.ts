import { BTN, emptyInput } from '../src/core/input';
import { yawPitchTo, type Vec3 } from '../src/core/math';
import { Simulation, type HeroSlot, type MatchConfig } from '../src/core/simulation';
import type { Hero } from '../src/gameplay/entities';
import type { SolidDef } from '../src/world/collision';
import type { MapDef, TeamId } from '../src/world/mapTypes';

/**
 * A small flat test arena (200 x 200 m) with a few walls, one ledge, a ramp,
 * a straight lane and a zipline. Lets tests exercise mechanics in isolation.
 */
export function arenaMap(extraSolids: SolidDef[] = [], withStructures = false): MapDef {
  const P = (x: number, y: number, z: number) => ({ x, y, z });
  const solids: SolidDef[] = [
    // A wall at z = 20 spanning x -10..10, 4 m tall.
    { kind: 'box', min: P(-10, 0, 20), max: P(10, 4, 21), material: 'building:0' },
    // A low ledge (3.2 m) at x 30..36 for mantling.
    { kind: 'box', min: P(30, 0, -5), max: P(36, 3.2, 5), material: 'building:1' },
    // A ramp rising toward +x from x 40 to 50 up to 4 m, then a platform.
    { kind: 'ramp', min: P(40, 0, -3), max: P(50, 4, 3), axis: 'x', dir: 1, material: 'concrete' },
    { kind: 'box', min: P(50, 0, -3), max: P(56, 4, 3), material: 'building:2' },
    ...extraSolids,
  ];
  const structures: MapDef['structures'] = withStructures
    ? [
        { id: 'a-guardian-1', type: 'guardian', team: 0, lane: 1, pos: P(-4, 0, -60), yaw: 0, requires: [] },
        { id: 'a-walker-1', type: 'walker', team: 0, lane: 1, pos: P(-4, 0, -75), yaw: 0, requires: ['a-guardian-1'] },
        { id: 'b-guardian-1', type: 'guardian', team: 1, lane: 1, pos: P(4, 0, 60), yaw: Math.PI, requires: [] },
        { id: 'b-walker-1', type: 'walker', team: 1, lane: 1, pos: P(4, 0, 75), yaw: Math.PI, requires: ['b-guardian-1'] },
        { id: 'b-patron', type: 'patron', team: 1, lane: -1, pos: P(0, 0, 90), yaw: Math.PI, requires: ['b-walker-1'] },
      ]
    : [];
  return {
    id: 'test-arena',
    name: 'Test Arena',
    bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
    solids,
    lanes: [
      { id: 0, name: 'West', color: '#ff0', path: [P(-60, 0, -90), P(-60, 0, 90)], width: 16 },
      { id: 1, name: 'Mid', color: '#0f0', path: [P(0, 0, -90), P(0, 0, -50), P(0, 0, 50), P(0, 0, 90)], width: 16 },
      { id: 2, name: 'East', color: '#f0f', path: [P(60, 0, -90), P(60, 0, 90)], width: 16 },
    ],
    structures,
    ziplines: [{ id: 'a-zip-1', team: 0, lane: 1, points: [P(-20, 8, -40), P(-20, 8, 40)] }],
    shops: [{ id: 'a-shop', team: 0, pos: P(-30, 0, -30), radius: 6 }],
    camps: [],
    spawns: {
      0: { pos: P(0, 0, -95), yaw: 0, healZone: { minX: -8, minZ: -100, maxX: 8, maxZ: -90 } },
      1: { pos: P(0, 0, 95), yaw: Math.PI, healZone: { minX: -8, minZ: 90, maxX: 8, maxZ: 100 } },
    },
    midBoss: { pos: P(80, 0, 80), radius: 10 },
    regions: [],
    decor: { lamps: [], streets: [], props: [] },
  };
}

export interface TestSimOpts extends Partial<MatchConfig> {
  map?: MapDef;
}

/** Creates a quiet simulation (no waves/neutrals/boss) with the given heroes. */
export function makeSim(heroes: { team: TeamId; heroId: string; isBot?: boolean }[], opts: TestSimOpts = {}): Simulation {
  const slots: HeroSlot[] = heroes.map((h, i) => ({ team: h.team, heroId: h.heroId, name: `T${i}`, isBot: h.isBot ?? false }));
  const { map, ...cfg } = opts;
  return new Simulation({ seed: 1, slots, waves: false, neutrals: false, boss: false, structures: false, pregame: 0, ...cfg }, map ?? arenaMap());
}

export function place(h: Hero, pos: Vec3, yaw = 0): void {
  h.pos = { ...pos };
  h.prevPos = { ...pos };
  h.vel = { x: 0, y: 0, z: 0 };
  h.yaw = yaw;
  h.input.yaw = yaw;
  h.grounded = true;
}

/** Points the hero's aim at a world point (from its eye). */
export function aimAt(h: Hero, target: Vec3): void {
  const eye = { x: h.pos.x, y: h.pos.y + h.eyeHeight, z: h.pos.z };
  const { yaw, pitch } = yawPitchTo(eye, target);
  h.input.yaw = yaw;
  h.input.pitch = pitch;
}

/** Holds the given buttons for n ticks, then releases (one tick). */
export function hold(sim: Simulation, h: Hero, buttons: number, ticks: number, extra?: Partial<typeof h.input>): void {
  for (let i = 0; i < ticks; i++) {
    h.input = { ...h.input, ...extra, buttons };
    sim.step();
  }
  h.input = { ...h.input, buttons: 0 };
  sim.step();
}

/** A single press (one tick down, one tick up). */
export function tap(sim: Simulation, h: Hero, button: number): void {
  hold(sim, h, button, 1);
}

export function idle(sim: Simulation, seconds: number): void {
  sim.run(seconds);
}

export function freshInput(h: Hero): void {
  h.input = { ...emptyInput(), yaw: h.input.yaw, pitch: h.input.pitch };
}

export { BTN };
