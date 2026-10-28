/**
 * Uniform grid spatial index over the XZ plane, rebuilt every tick.
 * Rebuilding is cheaper and simpler than incremental updates for the few
 * hundred moving units a match contains.
 */
export interface Positioned {
  pos: { x: number; z: number };
  radius: number;
}

export class SpatialGrid<T extends Positioned> {
  private cells: T[][];
  private readonly cols: number;
  private readonly rows: number;
  private used: number[] = [];

  constructor(
    private readonly minX: number,
    private readonly minZ: number,
    maxX: number,
    maxZ: number,
    private readonly cellSize = 8,
  ) {
    this.cols = Math.ceil((maxX - minX) / cellSize) + 1;
    this.rows = Math.ceil((maxZ - minZ) / cellSize) + 1;
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  private idx(x: number, z: number): number {
    let c = Math.floor((x - this.minX) / this.cellSize);
    let r = Math.floor((z - this.minZ) / this.cellSize);
    if (c < 0) c = 0;
    else if (c >= this.cols) c = this.cols - 1;
    if (r < 0) r = 0;
    else if (r >= this.rows) r = this.rows - 1;
    return r * this.cols + c;
  }

  clear(): void {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
  }

  insert(item: T): void {
    const i = this.idx(item.pos.x, item.pos.z);
    if (this.cells[i].length === 0) this.used.push(i);
    this.cells[i].push(item);
  }

  /**
   * Calls fn for every item whose cell overlaps the circle (x, z, r).
   * Items larger than a cell (structures) should be queried with extra
   * radius by the caller. Return true from fn to stop early.
   */
  query(x: number, z: number, r: number, fn: (item: T) => boolean | void): void {
    const c0 = Math.max(0, Math.floor((x - r - this.minX) / this.cellSize));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / this.cellSize));
    const r0 = Math.max(0, Math.floor((z - r - this.minZ) / this.cellSize));
    const r1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / this.cellSize));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const cell = this.cells[rr * this.cols + cc];
        for (let k = 0; k < cell.length; k++) if (fn(cell[k])) return;
      }
    }
  }

  /** Collects items whose center lies within r of (x, z). */
  collect(x: number, z: number, r: number, out: T[], filter?: (item: T) => boolean): T[] {
    out.length = 0;
    const r2 = r * r;
    this.query(x, z, r, (it) => {
      const dx = it.pos.x - x;
      const dz = it.pos.z - z;
      if (dx * dx + dz * dz <= r2 && (!filter || filter(it))) out.push(it);
    });
    return out;
  }
}
