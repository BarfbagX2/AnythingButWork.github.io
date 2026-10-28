// Minimal allocation-aware vector math for the simulation.
// The simulation deliberately does not depend on Three.js so it can run
// headless in Node (tests, autonomous matches, the multiplayer server).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy3(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale3(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function addScaled3(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: Vec3) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lenXZ = (a: Vec3) => Math.sqrt(a.x * a.x + a.z * a.z);

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalize3(out: Vec3, a: Vec3): Vec3 {
  const l = len3(a);
  if (l < 1e-9) return set3(out, 0, 0, 0);
  return scale3(out, a, 1 / l);
}

export function lerp3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const saturate = (v: number) => clamp(v, 0, 1);

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export const angleDiff = (a: number, b: number) => wrapAngle(a - b);

/**
 * Direction from yaw/pitch. Yaw 0 looks toward +Z, positive yaw rotates
 * toward +X. Positive pitch looks up.
 */
export function dirFromYawPitch(out: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(yaw) * cp;
  return out;
}

export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function yawPitchTo(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) };
}

/** Closest point parameter t in [0,1] on segment ab to point p. */
export function closestTOnSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  if (l2 < 1e-12) return 0;
  return clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1);
}

/**
 * Distance squared between segment p0-p1 and segment q0-q1, and the
 * parameter on the first segment at the closest approach.
 */
export function segSegDistSq(
  p0: Vec3,
  p1: Vec3,
  q0: Vec3,
  q1: Vec3,
  outT?: { s: number; t: number },
): number {
  const d1x = p1.x - p0.x, d1y = p1.y - p0.y, d1z = p1.z - p0.z;
  const d2x = q1.x - q0.x, d2y = q1.y - q0.y, d2z = q1.z - q0.z;
  const rx = p0.x - q0.x, ry = p0.y - q0.y, rz = p0.z - q0.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const cx = p0.x + d1x * s - (q0.x + d2x * t);
  const cy = p0.y + d1y * s - (q0.y + d2y * t);
  const cz = p0.z + d1z * s - (q0.z + d2z * t);
  if (outT) {
    outT.s = s;
    outT.t = t;
  }
  return cx * cx + cy * cy + cz * cz;
}

/** Ray/sphere intersection. Returns t >= 0 or -1. Direction must be normalized. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/**
 * Ray vs vertical capsule (axis from baseY+r to topY-r at (cx,cz)).
 * Returns t >= 0 or -1. Direction must be normalized.
 */
export function rayVerticalCapsule(
  o: Vec3,
  d: Vec3,
  cx: number,
  cz: number,
  baseY: number,
  topY: number,
  r: number,
  maxT: number,
): number {
  // Infinite cylinder test in XZ first.
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  const lo = baseY + r;
  const hi = Math.max(lo, topY - r);
  let best = -1;
  if (a > 1e-12) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / a;
      if (t < 0 && c <= 0) t = 0; // origin inside cylinder
      if (t >= 0 && t <= maxT) {
        const y = o.y + d.y * t;
        if (y >= lo && y <= hi) best = t;
      }
    }
  }
  if (best >= 0) return best;
  // Hemispherical caps.
  const t1 = raySphere(o, d, { x: cx, y: lo, z: cz }, r);
  const t2 = raySphere(o, d, { x: cx, y: hi, z: cz }, r);
  let t = -1;
  if (t1 >= 0 && t1 <= maxT) t = t1;
  if (t2 >= 0 && t2 <= maxT && (t < 0 || t2 < t)) t = t2;
  return t;
}

export function smoothDamp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}
