import { clamp, type Vec3 } from '../core/math';

/**
 * Static collision world built from axis-aligned boxes and ramps (wedges).
 * The city map is made of buildings, platforms, bridges and ramps, which this
 * representation covers exactly, so collision always matches what is drawn.
 */

export type SolidKind = 'box' | 'ramp';

export interface SolidDef {
  kind: SolidKind;
  min: Vec3;
  max: Vec3;
  /** Ramps: horizontal axis along which the top surface rises. */
  axis?: 'x' | 'z';
  /** Ramps: +1 rises toward +axis, -1 rises toward -axis. */
  dir?: 1 | -1;
  /** Renderer material hint. */
  material: string;
  /** Projectiles and line of sight pass through (railings, grates). */
  seeThrough?: boolean;
  /** Can't be stood on (lamp posts, thin props). */
  noWalk?: boolean;
  /** Excluded from rendering (invisible boundary walls). */
  invisible?: boolean;
}

interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface Solid extends SolidDef {
  index: number;
  planes?: Plane[];
  slope?: number;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  /** Solid index, or -1 for the ground plane. */
  solid: number;
}

export function makeHit(): RayHit {
  return { t: 0, nx: 0, ny: 1, nz: 0, solid: -1 };
}

export class CollisionWorld {
  readonly solids: Solid[] = [];
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cellSize = 8;
  readonly cols: number;
  readonly rows: number;
  private readonly cells: number[][];
  private stamp: Uint32Array;
  private stampId = 1;

  constructor(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }, defs: SolidDef[]) {
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.maxX = bounds.maxX;
    this.maxZ = bounds.maxZ;
    this.cols = Math.ceil((this.maxX - this.minX) / this.cellSize);
    this.rows = Math.ceil((this.maxZ - this.minZ) / this.cellSize);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    for (const def of defs) this.add(def);
    this.stamp = new Uint32Array(this.solids.length + 1);
  }

  private add(def: SolidDef): void {
    if (def.max.x <= def.min.x || def.max.y <= def.min.y || def.max.z <= def.min.z) {
      throw new Error(`Degenerate solid: ${JSON.stringify(def)}`);
    }
    const s: Solid = { ...def, index: this.solids.length };
    if (s.kind === 'ramp') {
      const axis = s.axis ?? 'x';
      const dir = s.dir ?? 1;
      const run = axis === 'x' ? s.max.x - s.min.x : s.max.z - s.min.z;
      const k = (s.max.y - s.min.y) / run;
      s.slope = k;
      const inv = 1 / Math.sqrt(k * k + 1);
      const planes: Plane[] = [
        { nx: -1, ny: 0, nz: 0, d: -s.min.x },
        { nx: 1, ny: 0, nz: 0, d: s.max.x },
        { nx: 0, ny: 0, nz: -1, d: -s.min.z },
        { nx: 0, ny: 0, nz: 1, d: s.max.z },
        { nx: 0, ny: -1, nz: 0, d: -s.min.y },
      ];
      // Sloped top: y <= minY + k * (distance along rising direction).
      if (axis === 'x') {
        if (dir === 1) planes.push({ nx: -k * inv, ny: inv, nz: 0, d: (s.min.y - k * s.min.x) * inv });
        else planes.push({ nx: k * inv, ny: inv, nz: 0, d: (s.min.y + k * s.max.x) * inv });
      } else {
        if (dir === 1) planes.push({ nx: 0, ny: inv, nz: -k * inv, d: (s.min.y - k * s.min.z) * inv });
        else planes.push({ nx: 0, ny: inv, nz: k * inv, d: (s.min.y + k * s.max.z) * inv });
      }
      s.planes = planes;
    }
    this.solids.push(s);
    const c0 = this.colOf(s.min.x);
    const c1 = this.colOf(s.max.x);
    const r0 = this.rowOf(s.min.z);
    const r1 = this.rowOf(s.max.z);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(s.index);
  }

  colOf(x: number): number {
    return clamp(Math.floor((x - this.minX) / this.cellSize), 0, this.cols - 1);
  }

  rowOf(z: number): number {
    return clamp(Math.floor((z - this.minZ) / this.cellSize), 0, this.rows - 1);
  }

  /** Height of the top surface of a solid at (x, z), assuming (x, z) is inside its footprint. */
  topAt(s: Solid, x: number, z: number): number {
    if (s.kind === 'box') return s.max.y;
    const k = s.slope!;
    if ((s.axis ?? 'x') === 'x') {
      const u = clamp(x, s.min.x, s.max.x);
      return s.dir === -1 ? s.min.y + k * (s.max.x - u) : s.min.y + k * (u - s.min.x);
    }
    const u = clamp(z, s.min.z, s.max.z);
    return s.dir === -1 ? s.min.y + k * (s.max.z - u) : s.min.y + k * (u - s.min.z);
  }

  private nextStamp(): number {
    this.stampId++;
    if (this.stampId === 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /** Iterates unique solids whose grid cells overlap the XZ rectangle. */
  forEachNear(minX: number, minZ: number, maxX: number, maxZ: number, fn: (s: Solid) => void): void {
    const id = this.nextStamp();
    const c0 = this.colOf(minX);
    const c1 = this.colOf(maxX);
    const r0 = this.rowOf(minZ);
    const r1 = this.rowOf(maxZ);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const si = cell[i];
          if (this.stamp[si] === id) continue;
          this.stamp[si] = id;
          fn(this.solids[si]);
        }
      }
    }
  }

  /**
   * Highest walkable surface at (x, z) whose height is <= maxY.
   * The ground plane (y = 0) is always walkable inside the map bounds.
   */
  groundHeight(x: number, z: number, maxY: number): number {
    let best = 0;
    const cell = this.cells[this.rowOf(z) * this.cols + this.colOf(x)];
    for (let i = 0; i < cell.length; i++) {
      const s = this.solids[cell[i]];
      if (s.noWalk) continue;
      if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) continue;
      const top = this.topAt(s, x, z);
      if (top <= maxY + 1e-4 && top > best) best = top;
    }
    return best;
  }

  /**
   * Lowest solid underside above y at (x, z) (ceiling), or Infinity.
   */
  ceilingHeight(x: number, z: number, y: number): number {
    let best = Infinity;
    const cell = this.cells[this.rowOf(z) * this.cols + this.colOf(x)];
    for (let i = 0; i < cell.length; i++) {
      const s = this.solids[cell[i]];
      if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) continue;
      if (s.min.y >= y && s.min.y < best) best = s.min.y;
    }
    return best;
  }

  /**
   * Pushes a vertical cylinder out of blocking solids in the XZ plane.
   * Surfaces at or below feetY + stepHeight are not blocking (they can be
   * stepped onto). Returns true if any push occurred, and writes the
   * accumulated push normal into `outNormal` if provided.
   */
  resolveCylinder(
    pos: Vec3,
    radius: number,
    height: number,
    stepHeight: number,
    outNormal?: { x: number; z: number },
  ): boolean {
    let pushed = false;
    if (outNormal) {
      outNormal.x = 0;
      outNormal.z = 0;
    }
    const feet = pos.y;
    const head = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      this.forEachNear(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, (s) => {
        if (s.min.y >= head - 0.05) return;
        const cx = clamp(pos.x, s.min.x, s.max.x);
        const cz = clamp(pos.z, s.min.z, s.max.z);
        const top = this.topAt(s, cx, cz);
        if (top <= feet + stepHeight && !s.noWalk) return;
        if (s.noWalk && s.max.y <= feet + 0.05) return;
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) return;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          dx /= d;
          dz /= d;
          const pen = radius - d;
          pos.x += dx * pen;
          pos.z += dz * pen;
        } else {
          // Center inside footprint: push out through the nearest edge.
          const left = pos.x - s.min.x;
          const right = s.max.x - pos.x;
          const back = pos.z - s.min.z;
          const front = s.max.z - pos.z;
          const m = Math.min(left, right, back, front);
          dx = 0;
          dz = 0;
          if (m === left) {
            pos.x = s.min.x - radius;
            dx = -1;
          } else if (m === right) {
            pos.x = s.max.x + radius;
            dx = 1;
          } else if (m === back) {
            pos.z = s.min.z - radius;
            dz = -1;
          } else {
            pos.z = s.max.z + radius;
            dz = 1;
          }
        }
        if (outNormal) {
          outNormal.x += dx;
          outNormal.z += dz;
        }
        any = true;
        pushed = true;
      });
      if (!any) break;
    }
    return pushed;
  }

  /** Is a vertical cylinder overlapping any blocking solid? */
  overlapsCylinder(x: number, y: number, z: number, radius: number, height: number, stepHeight = 0): boolean {
    let hit = false;
    this.forEachNear(x - radius, z - radius, x + radius, z + radius, (s) => {
      if (hit) return;
      if (s.min.y >= y + height - 0.05) return;
      const cx = clamp(x, s.min.x, s.max.x);
      const cz = clamp(z, s.min.z, s.max.z);
      const top = this.topAt(s, cx, cz);
      if (top <= y + stepHeight) return;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < radius * radius) hit = true;
    });
    return hit;
  }

  private rayBox(s: Solid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, hit: RayHit): boolean {
    let tmin = 0;
    let tmax = maxT;
    let nx = 0, ny = 0, nz = 0;
    // X slab
    if (Math.abs(dx) < 1e-12) {
      if (ox < s.min.x || ox > s.max.x) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (s.min.x - ox) * inv;
      let t2 = (s.max.x - ox) * inv;
      let n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = n;
        ny = 0;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    // Y slab
    if (Math.abs(dy) < 1e-12) {
      if (oy < s.min.y || oy > s.max.y) return false;
    } else {
      const inv = 1 / dy;
      let t1 = (s.min.y - oy) * inv;
      let t2 = (s.max.y - oy) * inv;
      let n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = n;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    // Z slab
    if (Math.abs(dz) < 1e-12) {
      if (oz < s.min.z || oz > s.max.z) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (s.min.z - oz) * inv;
      let t2 = (s.max.z - oz) * inv;
      let n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = 0;
        nz = n;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (tmin < hit.t) {
      hit.t = tmin;
      hit.nx = nx;
      hit.ny = ny;
      hit.nz = nz;
      hit.solid = s.index;
      if (tmin === 0 && nx === 0 && ny === 0 && nz === 0) hit.ny = 1;
      return true;
    }
    return false;
  }

  private rayConvex(s: Solid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, hit: RayHit): boolean {
    let tEnter = 0;
    let tExit = maxT;
    let enter: Plane | null = null;
    for (const p of s.planes!) {
      const denom = p.nx * dx + p.ny * dy + p.nz * dz;
      const dist = p.d - (p.nx * ox + p.ny * oy + p.nz * oz);
      if (Math.abs(denom) < 1e-12) {
        if (dist < 0) return false;
        continue;
      }
      const t = dist / denom;
      if (denom < 0) {
        if (t > tEnter) {
          tEnter = t;
          enter = p;
        }
      } else if (t < tExit) tExit = t;
      if (tEnter > tExit) return false;
    }
    if (tEnter < hit.t) {
      hit.t = tEnter;
      hit.nx = enter ? enter.nx : 0;
      hit.ny = enter ? enter.ny : 1;
      hit.nz = enter ? enter.nz : 0;
      hit.solid = s.index;
      return true;
    }
    return false;
  }

  /**
   * Casts a ray (direction must be normalized). Returns distance to the first
   * hit or -1. Includes the ground plane at y = 0.
   */
  raycast(o: Vec3, d: Vec3, maxDist: number, hit: RayHit = makeHit(), includeSeeThrough = false): number {
    hit.t = maxDist;
    hit.solid = -2;
    // Ground plane.
    if (d.y < -1e-9 && o.y >= 0) {
      const t = -o.y / d.y;
      if (t < hit.t) {
        hit.t = t;
        hit.nx = 0;
        hit.ny = 1;
        hit.nz = 0;
        hit.solid = -1;
      }
    }
    const id = this.nextStamp();
    // Amanatides & Woo traversal across XZ grid cells.
    const cs = this.cellSize;
    let cx = Math.floor((o.x - this.minX) / cs);
    let cz = Math.floor((o.z - this.minZ) / cs);
    const stepX = d.x > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(d.x) > 1e-12 ? cs / Math.abs(d.x) : Infinity;
    const tDeltaZ = Math.abs(d.z) > 1e-12 ? cs / Math.abs(d.z) : Infinity;
    const nextBoundX = this.minX + (cx + (stepX > 0 ? 1 : 0)) * cs;
    const nextBoundZ = this.minZ + (cz + (stepZ > 0 ? 1 : 0)) * cs;
    let tMaxX = Math.abs(d.x) > 1e-12 ? (nextBoundX - o.x) / d.x : Infinity;
    let tMaxZ = Math.abs(d.z) > 1e-12 ? (nextBoundZ - o.z) / d.z : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows) {
        const cell = this.cells[cz * this.cols + cx];
        for (let i = 0; i < cell.length; i++) {
          const si = cell[i];
          if (this.stamp[si] === id) continue;
          this.stamp[si] = id;
          const s = this.solids[si];
          if (s.seeThrough && !includeSeeThrough) continue;
          if (s.kind === 'box') this.rayBox(s, o.x, o.y, o.z, d.x, d.y, d.z, hit.t, hit);
          else this.rayConvex(s, o.x, o.y, o.z, d.x, d.y, d.z, hit.t, hit);
        }
      } else if (
        (cx < 0 && stepX < 0) ||
        (cx >= this.cols && stepX > 0) ||
        (cz < 0 && stepZ < 0) ||
        (cz >= this.rows && stepZ > 0)
      ) {
        break; // moving away from the grid
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (hit.t <= tNext || tNext > maxDist) break;
      tCell = tNext;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    void tCell;
    return hit.solid === -2 ? -1 : hit.t;
  }

  private tmpDir = { x: 0, y: 0, z: 0 };
  private tmpHit = makeHit();

  /** True if the segment from a to b is blocked by world geometry. */
  segmentBlocked(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-6) return false;
    const d = this.tmpDir;
    d.x = dx / l;
    d.y = dy / l;
    d.z = dz / l;
    return this.raycast(a, d, l - 0.01, this.tmpHit) >= 0;
  }

  /** Is the point inside any solid? */
  pointInside(x: number, y: number, z: number): boolean {
    const cell = this.cells[this.rowOf(z) * this.cols + this.colOf(x)];
    for (let i = 0; i < cell.length; i++) {
      const s = this.solids[cell[i]];
      if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) continue;
      if (y < s.min.y) continue;
      if (y <= this.topAt(s, x, z)) return true;
    }
    return false;
  }

  inBounds(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}
