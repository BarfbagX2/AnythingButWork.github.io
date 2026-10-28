import { getMap, getWorld } from '../src/core/simulation';
import { NavGrid } from '../src/world/nav';
const map = getMap();
const world = getWorld(map);
const nav = new NavGrid(world, map, 17);
console.log('build ms', nav.buildMs.toFixed(0), 'nodes', nav.nodeCount, 'alive', nav.aliveCount(), 'edges', nav.edgeTo.length);
const tests: [string, any, any, number][] = [
  ['spawnA->spawnB', map.spawns[0].pos, map.spawns[1].pos, 0],
  ['spawnA->westGuardianB', map.spawns[0].pos, { x: -76, y: 0, z: 26 }, 0],
  ['spawnA->midRoof', map.spawns[0].pos, { x: -14, y: 5.5, z: 48 }, 0],
  ['spawnA->bridge', map.spawns[0].pos, { x: 0, y: 5.5, z: 48 }, 0],
  ['spawnA->perch', map.spawns[0].pos, { x: -64, y: 3.5, z: 18 }, 0],
  ['spawnA->boss', map.spawns[0].pos, map.midBoss.pos, 0],
  ['spawnB->T1campN', map.spawns[1].pos, { x: -24, y: 0, z: 82 }, 1],
];
for (const [name, a, b, team] of tests) {
  const t0 = performance.now();
  const p = nav.findPath(a, b, team);
  const ms = performance.now() - t0;
  if (!p) { console.log(name, 'NO PATH', ms.toFixed(2)); continue; }
  let len = 0; for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i-1].x, p[i].z - p[i-1].z);
  const kinds = p.map(x => x.kind).join('');
  console.log(name, 'pts', p.length, 'len', len.toFixed(0), 'ms', ms.toFixed(2), 'end', `${p[p.length-1].x.toFixed(1)},${p[p.length-1].y.toFixed(1)},${p[p.length-1].z.toFixed(1)}`, 'kinds', kinds.replace(/0+/g, m => m.length > 3 ? `0x${m.length}` : m));
}
