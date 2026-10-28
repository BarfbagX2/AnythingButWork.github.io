import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * Procedurally generated textures. The game ships with zero binary art
 * assets: every surface is drawn into canvases at load time.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount: number, alpha: number): void {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rng.range(0, 255));
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rng.next()})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
  }
}

export interface FacadeStyle {
  wall: string;
  trim: string;
  windowLit: string[];
  windowDark: string;
  litChance: number;
  cols: number;
  rows: number;
}

export const FACADE_STYLES: FacadeStyle[] = [
  { wall: '#3a2a26', trim: '#24191a', windowLit: ['#ffcf7a', '#ffb45a', '#ffe2a8'], windowDark: '#141820', litChance: 0.32, cols: 4, rows: 4 },
  { wall: '#2b3038', trim: '#191c22', windowLit: ['#9fd8ff', '#cfe9ff', '#ffd98a'], windowDark: '#10141b', litChance: 0.28, cols: 5, rows: 5 },
  { wall: '#4a3a2c', trim: '#2a2018', windowLit: ['#ffc36b', '#ff9e4a'], windowDark: '#18140f', litChance: 0.36, cols: 3, rows: 4 },
  { wall: '#33263a', trim: '#1c1422', windowLit: ['#ff9fe0', '#ffd27a', '#c4a0ff'], windowDark: '#120e18', litChance: 0.25, cols: 4, rows: 5 },
  { wall: '#2e3a33', trim: '#18201b', windowLit: ['#ffe9a8', '#b6ffcf'], windowDark: '#0f1512', litChance: 0.3, cols: 4, rows: 4 },
  { wall: '#3d3d42', trim: '#222226', windowLit: ['#ffd8a0', '#ffffff'], windowDark: '#121216', litChance: 0.22, cols: 6, rows: 6 },
  { wall: '#55483a', trim: '#2e261c', windowLit: ['#ffc070'], windowDark: '#1c1610', litChance: 0.5, cols: 3, rows: 2 },
  { wall: '#4b3b33', trim: '#2a201b', windowLit: ['#ffb070', '#ffd890'], windowDark: '#1a1411', litChance: 0.55, cols: 2, rows: 1 },
];

/** Facade texture: one tile = 4 m wide x 4 m tall (one storey). */
export function makeFacade(style: FacadeStyle, seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const [ce, cte] = canvas(S, S);
  const rng = new Rng(seed);
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, S, S);
  // Brick / panel noise.
  for (let y = 0; y < S; y += 8) {
    for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) {
      const v = rng.range(-12, 12);
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
      ctx.fillRect(x, y, 15, 7);
    }
  }
  noise(ctx, S, S, rng, 900, 0.08);
  // Floor trim line.
  ctx.fillStyle = style.trim;
  ctx.fillRect(0, S - 18, S, 18);
  cte.fillStyle = '#000';
  cte.fillRect(0, 0, S, S);
  const cols = style.cols;
  const rows = 1;
  const ww = S / cols;
  const wh = (S - 18) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * ww + ww * 0.18;
      const y = j * wh + wh * 0.22;
      const w = ww * 0.64;
      const h = wh * 0.6;
      ctx.fillStyle = style.trim;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      const lit = rng.next() < style.litChance;
      if (lit) {
        const col = rng.pick(style.windowLit);
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        const g = cte.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, col);
        g.addColorStop(1, '#000');
        cte.fillStyle = col;
        cte.globalAlpha = rng.range(0.55, 1);
        cte.fillRect(x, y, w, h);
        cte.globalAlpha = 1;
        // Blinds / silhouettes.
        if (rng.chance(0.4)) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x, y, w, h * rng.range(0.2, 0.6));
          cte.fillStyle = 'rgba(0,0,0,0.6)';
          cte.fillRect(x, y, w, h * 0.4);
        }
      } else {
        ctx.fillStyle = style.windowDark;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(120,140,170,0.08)';
        ctx.fillRect(x, y, w * 0.4, h);
      }
      // Mullion.
      ctx.fillStyle = style.trim;
      ctx.fillRect(x + w / 2 - 1, y, 2, h);
    }
  }
  return { map: tex(c), emissive: tex(ce) };
}

export function makeAsphalt(seed = 3): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(seed);
  ctx.fillStyle = '#26262b';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, rng, 9000, 0.12);
  // Cracks & patches.
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(10,10,12,${rng.range(0.3, 0.6)})`;
    ctx.lineWidth = rng.range(1, 2);
    ctx.beginPath();
    let x = rng.range(0, S);
    let y = rng.range(0, S);
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += rng.range(-30, 30);
      y += rng.range(-30, 30);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(${rng.range(30, 50)},${rng.range(30, 50)},${rng.range(35, 55)},0.5)`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(30, 90), rng.range(20, 70));
  }
  // Puddle sheen.
  for (let i = 0; i < 5; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(70,80,110,0.35)');
    g.addColorStop(1, 'rgba(70,80,110,0)');
    ctx.save();
    ctx.translate(rng.range(0, S), rng.range(0, S));
    ctx.scale(1, rng.range(0.4, 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(-60, -60, 120, 120);
    ctx.restore();
  }
  return tex(c);
}

export function makeConcrete(seed = 9, base = '#4a4a50'): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, rng, 4000, 0.1);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= S; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(S, i);
    ctx.stroke();
  }
  return tex(c);
}

export function makeRoof(seed = 5): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(seed);
  ctx.fillStyle = '#2c2a2a';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, rng, 3000, 0.15);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < S; i += 32) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(S, i);
    ctx.stroke();
  }
  return tex(c);
}

/** Soft radial gradient used for lamp light pools, glows and particles. */
export function makeRadial(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, false);
}

/** Ring texture for telegraphs and AoE indicators. */
export function makeRing(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.92, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, false);
}

/** Lane paint: dashed center line in the lane colour. */
export function makeLaneLine(color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(32, 256);
  ctx.clearRect(0, 0, 32, 256);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(10, 0, 12, 150);
  return tex(c);
}

export function makeSkyGradient(): THREE.CanvasTexture {
  const [c, ctx] = canvas(4, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#05060d');
  g.addColorStop(0.45, '#141530');
  g.addColorStop(0.7, '#3a2440');
  g.addColorStop(0.85, '#6a3a3a');
  g.addColorStop(1, '#1a1018');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = tex(c, false);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
