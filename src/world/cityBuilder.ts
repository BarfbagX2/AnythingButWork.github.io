import { Rng, hashString } from '../core/rng';
import type { SolidDef } from './collision';

/**
 * Builds a city block layout from explicit open areas (streets, plazas) and
 * fixed-height overrides. Every other cell becomes a building whose height
 * is chosen per lot. Equal neighbouring cells are merged into large boxes so
 * collision and rendering stay cheap.
 */

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface HeightOverride extends Rect {
  height: number;
  style?: number;
}

export interface CitySpec {
  bounds: Rect;
  cell: number;
  lot: number;
  open: Rect[];
  overrides: HeightOverride[];
  /** Height of the perimeter wall band. */
  perimeterHeight: number;
  perimeterBand: number;
  seed: string;
  /** Mirror lot randomisation across z = 0 so both team halves match. */
  mirrorZ: boolean;
}

export interface CityResult {
  solids: SolidDef[];
  cols: number;
  rows: number;
  heights: Float32Array;
}

const inRect = (x: number, z: number, r: Rect) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

export function buildCity(spec: CitySpec): CityResult {
  const { bounds, cell } = spec;
  const cols = Math.round((bounds.maxX - bounds.minX) / cell);
  const rows = Math.round((bounds.maxZ - bounds.minZ) / cell);
  const heights = new Float32Array(cols * rows);
  const styles = new Int16Array(cols * rows);
  const open = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c + 0.5) * cell;
      const z = bounds.minZ + (r + 0.5) * cell;
      if (spec.open.some((o) => inRect(x, z, o))) open[r * cols + c] = 1;
    }
  }

  // Distance (in cells) to the nearest open cell, for facade vs interior heights.
  const dist = new Int16Array(cols * rows).fill(9999);
  const queue: number[] = [];
  for (let i = 0; i < open.length; i++) if (open[i]) {
    dist[i] = 0;
    queue.push(i);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const c = i % cols;
    const r = (i / cols) | 0;
    const nd = dist[i] + 1;
    const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1];
    for (const n of nb) {
      if (n >= 0 && dist[n] > nd) {
        dist[n] = nd;
        queue.push(n);
      }
    }
  }

  const facadeHeights = [7, 8.5, 10, 12, 14, 17];
  const interiorHeights = [12, 15, 18, 21, 24, 28];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (open[i]) continue;
      const x = bounds.minX + (c + 0.5) * cell;
      const z = bounds.minZ + (r + 0.5) * cell;
      const lz = spec.mirrorZ ? Math.abs(z) : z;
      const lotX = Math.floor((x - bounds.minX) / spec.lot);
      const lotZ = Math.floor(lz / spec.lot) + (spec.mirrorZ && z < 0 ? 0 : 0);
      const rng = new Rng(hashString(`${spec.seed}:${lotX}:${lotZ}`));
      const facade = dist[i] <= 2;
      let h = facade ? rng.pick(facadeHeights) : rng.pick(interiorHeights);
      const style = rng.int(0, 5);
      const edge =
        x - bounds.minX < spec.perimeterBand ||
        bounds.maxX - x < spec.perimeterBand ||
        z - bounds.minZ < spec.perimeterBand ||
        bounds.maxZ - z < spec.perimeterBand;
      if (edge) h = Math.max(h, spec.perimeterHeight);
      heights[i] = h;
      styles[i] = style;
    }
  }

  // Overrides win (0 height = open, no building).
  for (const o of spec.overrides) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bounds.minX + (c + 0.5) * cell;
        const z = bounds.minZ + (r + 0.5) * cell;
        if (inRect(x, z, o)) {
          heights[r * cols + c] = o.height;
          styles[r * cols + c] = o.style ?? 6;
          open[r * cols + c] = o.height <= 0 ? 1 : 0;
        }
      }
    }
  }

  // Greedy merge of equal cells into boxes.
  const used = new Uint8Array(cols * rows);
  const solids: SolidDef[] = [];
  const key = (i: number) => heights[i] * 64 + styles[i];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (used[i] || heights[i] <= 0) continue;
      const k = key(i);
      let w = 1;
      while (c + w < cols && !used[i + w] && heights[i + w] > 0 && key(i + w) === k) w++;
      let h = 1;
      outer: while (r + h < rows) {
        for (let cc = 0; cc < w; cc++) {
          const j = (r + h) * cols + c + cc;
          if (used[j] || heights[j] <= 0 || key(j) !== k) break outer;
        }
        h++;
      }
      for (let rr = 0; rr < h; rr++) for (let cc = 0; cc < w; cc++) used[(r + rr) * cols + c + cc] = 1;
      solids.push({
        kind: 'box',
        min: { x: bounds.minX + c * cell, y: 0, z: bounds.minZ + r * cell },
        max: { x: bounds.minX + (c + w) * cell, y: heights[i], z: bounds.minZ + (r + h) * cell },
        material: `building:${styles[i]}`,
      });
    }
  }
  return { solids, cols, rows, heights };
}

export function mirrorRectZ(r: Rect): Rect {
  return { minX: r.minX, maxX: r.maxX, minZ: -r.maxZ, maxZ: -r.minZ };
}

export function mirrorRectX(r: Rect): Rect {
  return { minX: -r.maxX, maxX: -r.minX, minZ: r.minZ, maxZ: r.maxZ };
}
