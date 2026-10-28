import type { Vec3 } from '../core/math';
import type { CollisionWorld } from './collision';
import type { MapDef } from './mapTypes';

/**
 * Layered navigation grid ("2.5D navmesh"). Each 2 m cell can hold several
 * walkable surfaces (street, ramp, rooftop, bridge). Nodes connect with:
 *  - walk edges (continuous ground, verified by sampling the collision world)
 *  - jump edges (ledges reachable with jump + double jump + mantle)
 *  - drop edges (one-way, stepping off a ledge)
 *  - zipline edges (team-owned, fast travel)
 * Bots use exactly the same movement rules as players to traverse them.
 */

export const enum EdgeKind {
  Walk = 0,
  Jump = 1,
  Drop = 2,
  Zip = 3,
}

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  /** How to reach this point from the previous one. */
  kind: EdgeKind;
  /** Zipline index for zip links. */
  zip?: number;
}

const CELL = 2;
const STEP = 0.6;
const JUMP_MAX = 3.5;
const DROP_MAX = 14;
const RADIUS = 0.5;
const HEIGHT = 1.85;

class MinHeap {
  private idx: Int32Array;
  private key: Float32Array;
  size = 0;

  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.key = new Float32Array(cap);
  }

  clear(): void {
    this.size = 0;
  }

  push(i: number, k: number): void {
    if (this.size >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2);
      ni.set(this.idx);
      const nk = new Float32Array(this.key.length * 2);
      nk.set(this.key);
      this.idx = ni;
      this.key = nk;
    }
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p];
      this.key[n] = this.key[p];
      n = p;
    }
    this.idx[n] = i;
    this.key[n] = k;
  }

  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx[--this.size];
    const lastK = this.key[this.size];
    let n = 0;
    for (;;) {
      let c = 2 * n + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lastK) break;
      this.idx[n] = this.idx[c];
      this.key[n] = this.key[c];
      n = c;
    }
    this.idx[n] = lastI;
    this.key[n] = lastK;
    return top;
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly minX: number;
  readonly minZ: number;
  nodeCount = 0;
  nodeX!: Float32Array;
  nodeY!: Float32Array;
  nodeZ!: Float32Array;
  /** Zero means the node is unreachable/removed. */
  nodeAlive!: Uint8Array;
  cellStart!: Int32Array;
  cellCount!: Uint8Array;
  edgeStart!: Int32Array;
  edgeTo!: Int32Array;
  edgeCost!: Float32Array;
  edgeKind!: Uint8Array;
  edgeTeam!: Int8Array;
  edgeZip!: Int16Array;
  private g!: Float32Array;
  private parent!: Int32Array;
  private parentEdge!: Int32Array;
  private stamp!: Uint32Array;
  private closed!: Uint32Array;
  private stampId = 1;
  private heap!: MinHeap;
  buildMs = 0;

  constructor(
    private readonly world: CollisionWorld,
    map: MapDef,
    zipSpeed: number,
  ) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.minX = map.bounds.minX;
    this.minZ = map.bounds.minZ;
    this.cols = Math.round((map.bounds.maxX - map.bounds.minX) / CELL);
    this.rows = Math.round((map.bounds.maxZ - map.bounds.minZ) / CELL);
    this.buildNodes();
    this.buildEdges(map, zipSpeed);
    this.prune(map);
    const n = this.nodeCount;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.parentEdge = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(4096);
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  private cellCenter(c: number, r: number): [number, number] {
    return [this.minX + (c + 0.5) * CELL, this.minZ + (r + 0.5) * CELL];
  }

  /** Walkable surface heights at (x, z). */
  private surfacesAt(x: number, z: number): number[] {
    const hs: number[] = [];
    if (!this.world.pointInside(x, 0.05, z)) hs.push(0);
    this.world.forEachNear(x, z, x, z, (s) => {
      if (s.noWalk || s.invisible) return;
      if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) return;
      const y = this.world.topAt(s, x, z);
      if (y > 60) return;
      if (!hs.some((h) => Math.abs(h - y) < 0.3)) hs.push(y);
    });
    return hs.filter((y) => !this.world.overlapsCylinder(x, y + 0.02, z, RADIUS, HEIGHT, STEP * 0.8) && !this.world.pointInside(x, y + 0.6, z));
  }

  private buildNodes(): void {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const ncell = this.cols * this.rows;
    this.cellStart = new Int32Array(ncell).fill(-1);
    this.cellCount = new Uint8Array(ncell);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const [x, z] = this.cellCenter(c, r);
        const hs = this.surfacesAt(x, z).sort((a, b) => a - b);
        if (!hs.length) continue;
        const ci = r * this.cols + c;
        this.cellStart[ci] = xs.length;
        this.cellCount[ci] = hs.length;
        for (const y of hs) {
          xs.push(x);
          ys.push(y);
          zs.push(z);
        }
      }
    }
    this.nodeCount = xs.length;
    this.nodeX = Float32Array.from(xs);
    this.nodeY = Float32Array.from(ys);
    this.nodeZ = Float32Array.from(zs);
    this.nodeAlive = new Uint8Array(this.nodeCount).fill(1);
  }

  /** Samples ground continuity between two points. */
  walkBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(dist / 0.7));
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const gy = this.world.groundHeight(x, z, y + STEP);
      if (Math.abs(gy - y) > STEP) return false;
      if (this.world.overlapsCylinder(x, gy + 0.02, z, RADIUS * 0.85, HEIGHT, STEP * 0.8)) return false;
      y = gy;
    }
    return Math.abs(y - by) < 0.35;
  }

  private buildEdges(map: MapDef, zipSpeed: number): void {
    const start: number[] = [];
    const to: number[] = [];
    const cost: number[] = [];
    const kind: number[] = [];
    const team: number[] = [];
    const zip: number[] = [];
    const zipLinks: { from: number; to: number; cost: number; team: number; zip: number }[] = [];
    map.ziplines.forEach((z, zi) => {
      const a = z.points[0];
      const b = z.points[z.points.length - 1];
      let len = 0;
      for (let i = 1; i < z.points.length; i++) len += Math.hypot(z.points[i].x - z.points[i - 1].x, z.points[i].z - z.points[i - 1].z);
      const na = this.nearestRaw(a.x, 0, a.z);
      const nb = this.nearestRaw(b.x, 0, b.z);
      if (na < 0 || nb < 0) return;
      // Cost in "run metres": zip travel is ~2.4x faster than running, plus mounting overhead.
      const c = (len * 7) / zipSpeed + 8;
      zipLinks.push({ from: na, to: nb, cost: c, team: z.team, zip: zi });
      zipLinks.push({ from: nb, to: na, cost: c, team: z.team, zip: zi });
    });
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ci = r * this.cols + c;
        const s0 = this.cellStart[ci];
        if (s0 < 0) continue;
        for (let k = 0; k < this.cellCount[ci]; k++) {
          const n = s0 + k;
          start[n] = to.length;
          const nx = this.nodeX[n];
          const ny = this.nodeY[n];
          const nz = this.nodeZ[n];
          for (const [dc, dr] of dirs) {
            const c2 = c + dc;
            const r2 = r + dr;
            if (c2 < 0 || r2 < 0 || c2 >= this.cols || r2 >= this.rows) continue;
            const cj = r2 * this.cols + c2;
            const s1 = this.cellStart[cj];
            if (s1 < 0) continue;
            const diag = dc !== 0 && dr !== 0;
            for (let m = s1; m < s1 + this.cellCount[cj]; m++) {
              const my = this.nodeY[m];
              const dy = my - ny;
              const d = diag ? CELL * Math.SQRT2 : CELL;
              if (Math.abs(dy) <= STEP * 2.2 && this.walkBetween(nx, ny, nz, this.nodeX[m], my, this.nodeZ[m])) {
                if (diag) {
                  // Avoid corner cutting: both orthogonal neighbours must be walkable too.
                  if (!this.hasWalkableAt(c + dc, r, ny) || !this.hasWalkableAt(c, r + dr, ny)) continue;
                }
                to.push(m);
                cost.push(Math.hypot(d, dy));
                kind.push(EdgeKind.Walk);
                team.push(-1);
                zip.push(-1);
              } else if (!diag && dy > STEP && dy <= JUMP_MAX) {
                if (this.world.ceilingHeight(nx, nz, ny + 0.5) < ny + JUMP_MAX + HEIGHT) continue;
                to.push(m);
                cost.push(d + 3 + dy);
                kind.push(EdgeKind.Jump);
                team.push(-1);
                zip.push(-1);
              } else if (!diag && dy < -STEP && dy >= -DROP_MAX) {
                to.push(m);
                cost.push(d + 1 + -dy * 0.15);
                kind.push(EdgeKind.Drop);
                team.push(-1);
                zip.push(-1);
              }
            }
          }
          for (const z of zipLinks) {
            if (z.from !== n) continue;
            to.push(z.to);
            cost.push(z.cost);
            kind.push(EdgeKind.Zip);
            team.push(z.team);
            zip.push(z.zip);
          }
        }
      }
    }
    start[this.nodeCount] = to.length;
    this.edgeStart = Int32Array.from(start);
    this.edgeTo = Int32Array.from(to);
    this.edgeCost = Float32Array.from(cost);
    this.edgeKind = Uint8Array.from(kind);
    this.edgeTeam = Int8Array.from(team);
    this.edgeZip = Int16Array.from(zip);
  }

  private hasWalkableAt(c: number, r: number, y: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const ci = r * this.cols + c;
    const s0 = this.cellStart[ci];
    if (s0 < 0) return false;
    for (let m = s0; m < s0 + this.cellCount[ci]; m++) if (Math.abs(this.nodeY[m] - y) <= STEP * 2.2) return true;
    return false;
  }

  /** Removes nodes not reachable from the team spawns (sealed rooftops etc.). */
  private prune(map: MapDef): void {
    const seen = new Uint8Array(this.nodeCount);
    const q: number[] = [];
    for (const t of [0, 1] as const) {
      const sp = map.spawns[t].pos;
      const n = this.nearestRaw(sp.x, sp.y, sp.z);
      if (n >= 0 && !seen[n]) {
        seen[n] = 1;
        q.push(n);
      }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const n = q[qi];
      for (let e = this.edgeStart[n]; e < this.edgeStart[n + 1]; e++) {
        const m = this.edgeTo[e];
        if (!seen[m]) {
          seen[m] = 1;
          q.push(m);
        }
      }
    }
    // Nodes only reachable by dropping (one-way) are kept if they can get back.
    for (let n = 0; n < this.nodeCount; n++) this.nodeAlive[n] = seen[n];
  }

  private nearestRaw(x: number, y: number, z: number, maxCells = 4): number {
    const c0 = Math.floor((x - this.minX) / CELL);
    const r0 = Math.floor((z - this.minZ) / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let rad = 0; rad <= maxCells; rad++) {
      for (let r = r0 - rad; r <= r0 + rad; r++) {
        for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const ci = r * this.cols + c;
          const s0 = this.cellStart[ci];
          if (s0 < 0) continue;
          for (let m = s0; m < s0 + this.cellCount[ci]; m++) {
            if (this.nodeAlive && !this.nodeAlive[m]) continue;
            const dy = this.nodeY[m] - y;
            // Prefer surfaces at or just below the query height.
            const d = Math.hypot(this.nodeX[m] - x, this.nodeZ[m] - z) + (dy > 0.8 ? dy * 3 : Math.abs(dy) * 0.6);
            if (d < bestD) {
              bestD = d;
              best = m;
            }
          }
        }
      }
      if (best >= 0 && rad >= 1) break;
    }
    return best;
  }

  nearestNode(x: number, y: number, z: number): number {
    return this.nearestRaw(x, y, z, 6);
  }

  nodePos(n: number): Vec3 {
    return { x: this.nodeX[n], y: this.nodeY[n], z: this.nodeZ[n] };
  }

  /**
   * A* from `from` to `to`. Zipline edges are only usable by `team`.
   * Returns null if unreachable or the search budget is exceeded.
   */
  findPath(from: Vec3, to: Vec3, team: number, maxExpand = 30000): PathPoint[] | null {
    const s = this.nearestNode(from.x, from.y, from.z);
    const goal = this.nearestNode(to.x, to.y, to.z);
    if (s < 0 || goal < 0) return null;
    if (s === goal) return [{ x: to.x, y: this.nodeY[goal], z: to.z, kind: EdgeKind.Walk }];
    const id = ++this.stampId;
    const gx = this.nodeX[goal];
    const gy = this.nodeY[goal];
    const gz = this.nodeZ[goal];
    const h = (n: number) => Math.hypot(this.nodeX[n] - gx, this.nodeZ[n] - gz) + Math.abs(this.nodeY[n] - gy) * 0.5;
    this.heap.clear();
    this.stamp[s] = id;
    this.g[s] = 0;
    this.parent[s] = -1;
    this.parentEdge[s] = -1;
    this.heap.push(s, h(s));
    let expanded = 0;
    let found = false;
    while (this.heap.size > 0) {
      const n = this.heap.pop();
      if (this.closed[n] === id) continue;
      this.closed[n] = id;
      if (n === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const gn = this.g[n];
      for (let e = this.edgeStart[n]; e < this.edgeStart[n + 1]; e++) {
        const m = this.edgeTo[e];
        if (!this.nodeAlive[m]) continue;
        const et = this.edgeTeam[e];
        if (et >= 0 && et !== team) continue;
        const ng = gn + this.edgeCost[e];
        if (this.stamp[m] !== id || ng < this.g[m]) {
          this.stamp[m] = id;
          this.g[m] = ng;
          this.parent[m] = n;
          this.parentEdge[m] = e;
          this.heap.push(m, ng + h(m));
        }
      }
    }
    if (!found) return null;
    const raw: PathPoint[] = [];
    let n = goal;
    while (n >= 0) {
      const e = this.parentEdge[n];
      raw.push({ x: this.nodeX[n], y: this.nodeY[n], z: this.nodeZ[n], kind: e >= 0 ? (this.edgeKind[e] as EdgeKind) : EdgeKind.Walk, zip: e >= 0 && this.edgeZip[e] >= 0 ? this.edgeZip[e] : undefined });
      n = this.parent[n];
    }
    raw.reverse();
    // Final point: the actual destination if it's on the goal surface.
    if (Math.abs(to.y - gy) < 1 && Math.hypot(to.x - gx, to.z - gz) < CELL * 1.5) raw.push({ x: to.x, y: gy, z: to.z, kind: EdgeKind.Walk });
    return this.smooth(raw);
  }

  /** String-pulling over walk segments; special links are kept verbatim. */
  private smooth(path: PathPoint[]): PathPoint[] {
    if (path.length <= 2) return path;
    const out: PathPoint[] = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = i + 1;
      // Extend while every intermediate link is a walk and a straight walk is possible.
      for (let k = i + 2; k < path.length && k - i < 24; k++) {
        if (path[k].kind !== EdgeKind.Walk) break;
        let ok = true;
        for (let q = i + 1; q <= k; q++) if (path[q].kind !== EdgeKind.Walk) ok = false;
        if (!ok) break;
        const a = path[i];
        const b = path[k];
        if (!this.walkBetween(a.x, a.y, a.z, b.x, b.y, b.z)) break;
        j = k;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  /** Random reachable node near a point (for unsticking / wandering). */
  randomNear(x: number, z: number, radius: number, rnd: () => number): Vec3 | null {
    for (let tries = 0; tries < 12; tries++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * radius;
      const n = this.nearestNode(x + Math.cos(a) * d, 0, z + Math.sin(a) * d);
      if (n >= 0 && this.nodeAlive[n]) return this.nodePos(n);
    }
    return null;
  }

  aliveCount(): number {
    let c = 0;
    for (let i = 0; i < this.nodeCount; i++) c += this.nodeAlive[i];
    return c;
  }
}

const navCache = new WeakMap<MapDef, NavGrid>();
export function getNav(world: CollisionWorld, map: MapDef, zipSpeed: number): NavGrid {
  let n = navCache.get(map);
  if (!n) {
    n = new NavGrid(world, map, zipSpeed);
    navCache.set(map, n);
  }
  return n;
}
