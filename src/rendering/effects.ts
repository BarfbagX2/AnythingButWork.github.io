import * as THREE from 'three';
import type { SimEvent } from '../core/events';
import type { Simulation } from '../core/simulation';
import type { Projectile, Zone } from '../gameplay/entities';
import { makeRadial, makeRing } from './textures';

const MAX_PARTICLES = 3500;
const MAX_BEAMS = 700;
const MAX_GLOWS = 500;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  grav: number;
  drag: number;
}

interface TimedBeam {
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: THREE.Color;
  width: number;
  until: number;
  start: number;
  jagged: boolean;
  followUnit: number;
}

interface Decal {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  start: number;
  until: number;
  kind: 'warn' | 'shock' | 'zone' | 'sphere';
  radius: number;
  zoneId: number;
}

interface Glow {
  pos: THREE.Vector3;
  color: THREE.Color;
  size: number;
  until: number;
  start: number;
}

interface Arc {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  until: number;
  color: THREE.Color;
}

const vtx = /* glsl */ `
  attribute float size;
  attribute vec4 pcolor;
  varying vec4 vColor;
  void main() {
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform sampler2D map;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  }
`;

export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private pGeo: THREE.BufferGeometry;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pSize: Float32Array;
  private beams: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private timedBeams: TimedBeam[] = [];
  private timedGlows: Glow[] = [];
  private arcs: Arc[] = [];
  private decals: Decal[] = [];
  private decalPool: Decal[] = [];
  private zoneDecals = new Map<number, Decal>();
  private ringTex = makeRing();
  private glowTex = makeRadial();
  private m4 = new THREE.Matrix4();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private col = new THREE.Color();
  private beamCount = 0;
  private glowCount = 0;
  density = 1;
  time = 0;

  constructor() {
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 4);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeRadial() } },
      vertexShader: vtx,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.pGeo, pMat);
    points.frustumCulled = false;
    this.group.add(points);

    this.beams = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeRadial('rgba(255,255,255,1)', 'rgba(255,255,255,0.0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      MAX_BEAMS,
    );
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.group.add(this.beams);

    this.glows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      MAX_GLOWS,
    );
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 3), 3);
    this.glows.frustumCulled = false;
    this.glows.count = 0;
    this.group.add(this.glows);
  }

  /**
   * Pre-creates pooled decals/spheres (so their materials exist) and returns
   * a throwaway group exercising every effect material for shader warm-up.
   */
  prewarm(): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const ring = this.getDecal('warn');
      const sphere = this.getDecal('sphere');
      for (const d of [ring, sphere]) {
        d.mesh.visible = false;
        this.decals.splice(this.decals.indexOf(d), 1);
        this.decalPool.push(d);
      }
    }
    for (const d of this.decalPool) g.add(d.mesh.clone());
    return g;
  }

  // --- Particles -----------------------------------------------------------------

  emit(x: number, y: number, z: number, count: number, color: string | THREE.Color, o: { speed?: number; size?: number; life?: number; up?: number; grav?: number; spread?: number; drag?: number; dir?: THREE.Vector3 } = {}): void {
    const c = typeof color === 'string' ? this.col.set(color) : color;
    const n = Math.max(1, Math.round(count * this.density));
    const speed = o.speed ?? 4;
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      let vx = (Math.random() - 0.5) * 2;
      let vy = (Math.random() - 0.5) * 2 + (o.up ?? 0.5);
      let vz = (Math.random() - 0.5) * 2;
      if (o.dir) {
        const s = o.spread ?? 0.4;
        vx = o.dir.x + vx * s;
        vy = o.dir.y + vy * s;
        vz = o.dir.z + vz * s;
      }
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * (0.4 + Math.random() * 0.8);
      const life = (o.life ?? 0.5) * (0.6 + Math.random() * 0.6);
      this.particles.push({
        x, y, z,
        vx: (vx / l) * sp,
        vy: (vy / l) * sp,
        vz: (vz / l) * sp,
        life,
        max: life,
        size: (o.size ?? 0.25) * (0.7 + Math.random() * 0.6),
        r: c.r,
        g: c.g,
        b: c.b,
        grav: o.grav ?? 6,
        drag: o.drag ?? 1.5,
      });
    }
  }

  private updateParticles(dt: number): void {
    let w = 0;
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d - p.grav * dt;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.3;
      }
      ps[w++] = p;
      const k = w - 1;
      this.pPos[k * 3] = p.x;
      this.pPos[k * 3 + 1] = p.y;
      this.pPos[k * 3 + 2] = p.z;
      const a = p.life / p.max;
      this.pCol[k * 4] = p.r;
      this.pCol[k * 4 + 1] = p.g;
      this.pCol[k * 4 + 2] = p.b;
      this.pCol[k * 4 + 3] = Math.min(1, a * 1.5);
      this.pSize[k] = p.size * (0.5 + a * 0.5);
    }
    ps.length = w;
    this.pGeo.setDrawRange(0, w);
    (this.pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  // --- Beams & glows -------------------------------------------------------------

  private pushBeam(a: THREE.Vector3, b: THREE.Vector3, width: number, color: THREE.Color, camPos: THREE.Vector3): void {
    if (this.beamCount >= MAX_BEAMS) return;
    const dir = this.tmpC.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.divideScalar(len);
    const mid = this.tmpD.addVectors(a, b).multiplyScalar(0.5);
    const toCam = this.tmpA.subVectors(camPos, mid).normalize();
    const side = this.tmpB.crossVectors(dir, toCam).normalize().multiplyScalar(width);
    const normal = new THREE.Vector3().crossVectors(dir, side).normalize();
    this.m4.makeBasis(dir.clone().multiplyScalar(len), side, normal);
    this.m4.setPosition(mid);
    this.beams.setMatrixAt(this.beamCount, this.m4);
    this.beams.setColorAt(this.beamCount, color);
    this.beamCount++;
  }

  private pushGlow(pos: THREE.Vector3, size: number, color: THREE.Color, camQ: THREE.Quaternion): void {
    if (this.glowCount >= MAX_GLOWS) return;
    this.m4.compose(pos, camQ, this.tmpA.set(size, size, size));
    this.glows.setMatrixAt(this.glowCount, this.m4);
    this.glows.setColorAt(this.glowCount, color);
    this.glowCount++;
  }

  beam(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, color: string, width: number, duration: number, jagged = false, followUnit = -1): void {
    this.timedBeams.push({ a: new THREE.Vector3(a.x, a.y, a.z), b: new THREE.Vector3(b.x, b.y, b.z), color: new THREE.Color(color), width, until: this.time + duration, start: this.time, jagged, followUnit });
  }

  glow(p: { x: number; y: number; z: number }, color: string, size: number, duration: number): void {
    this.timedGlows.push({ pos: new THREE.Vector3(p.x, p.y, p.z), color: new THREE.Color(color), size, until: this.time + duration, start: this.time });
  }

  // --- Decals (rings, telegraphs, zones, spheres) ------------------------------------

  private getDecal(kind: Decal['kind']): Decal {
    let d = this.decalPool.pop();
    if (!d || (kind === 'sphere') !== (d.kind === 'sphere')) {
      if (d) this.decalPool.push(d);
      const mat = new THREE.MeshBasicMaterial({ map: kind === 'sphere' ? this.glowTex : this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const geo = kind === 'sphere' ? new THREE.SphereGeometry(1, 18, 12) : new THREE.CircleGeometry(1, 40);
      const mesh = new THREE.Mesh(geo, mat);
      if (kind !== 'sphere') mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      d = { mesh, mat, start: 0, until: 0, kind, radius: 1, zoneId: -1 };
      this.group.add(mesh);
    }
    d.kind = kind;
    d.mesh.visible = true;
    d.mat.map = kind === 'sphere' ? null : this.ringTex;
    d.mat.needsUpdate = true;
    this.decals.push(d);
    return d;
  }

  ring(pos: { x: number; y: number; z: number }, radius: number, color: string, duration: number, kind: 'warn' | 'shock'): void {
    const d = this.getDecal(kind);
    d.mesh.position.set(pos.x, pos.y + 0.06, pos.z);
    d.mat.color.set(color);
    d.radius = radius;
    d.start = this.time;
    d.until = this.time + duration;
    d.mesh.scale.setScalar(kind === 'warn' ? radius : 0.1);
  }

  sphere(pos: { x: number; y: number; z: number }, radius: number, color: string, duration: number): void {
    const d = this.getDecal('sphere');
    d.mesh.position.set(pos.x, pos.y, pos.z);
    d.mat.color.set(color);
    d.radius = radius;
    d.start = this.time;
    d.until = this.time + duration;
    d.mesh.scale.setScalar(0.2);
  }

  private updateDecals(): void {
    const t = this.time;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (d.kind === 'zone') continue;
      const k = (t - d.start) / Math.max(0.001, d.until - d.start);
      if (k >= 1) {
        d.mesh.visible = false;
        this.decals.splice(i, 1);
        this.decalPool.push(d);
        continue;
      }
      if (d.kind === 'warn') {
        d.mesh.scale.setScalar(d.radius);
        d.mat.opacity = 0.35 + 0.5 * k + Math.sin(t * 20) * 0.1;
      } else if (d.kind === 'shock') {
        d.mesh.scale.setScalar(d.radius * (0.2 + 0.8 * Math.sqrt(k)));
        d.mat.opacity = 1 - k;
      } else {
        d.mesh.scale.setScalar(d.radius * (0.3 + 0.7 * Math.sqrt(k)));
        d.mat.opacity = (1 - k) * 0.55;
      }
    }
  }

  private zoneColor(z: Zone): string {
    switch (z.visual) {
      case 'fire':
        return '#ff6a1a';
      case 'static':
        return '#59e8ff';
      case 'sanctuary':
        return '#fff1a0';
      case 'lockdown':
        return '#ffd35a';
      case 'singularity':
        return '#a07cff';
      case 'siphon':
        return '#ff3048';
      case 'trap':
        return '#ffd166';
      case 'mine':
        return '#ff9f3a';
      default:
        return z.color;
    }
  }

  private updateZones(sim: Simulation, viewerTeam: number): void {
    const live = new Set<number>();
    for (const z of sim.zones) {
      if (!z.alive) continue;
      // Enemy traps and mines are hidden.
      if ((z.visual === 'trap' || z.visual === 'mine') && z.team !== viewerTeam) continue;
      live.add(z.id);
      let d = this.zoneDecals.get(z.id);
      if (!d) {
        d = this.getDecal('zone');
        d.zoneId = z.id;
        this.zoneDecals.set(z.id, d);
        d.mat.color.set(this.zoneColor(z));
      }
      const small = z.visual === 'trap' || z.visual === 'mine';
      const r = small ? 0.6 : z.radius;
      d.mesh.position.set(z.pos.x, z.pos.y + 0.07, z.pos.z);
      d.mesh.scale.setScalar(r * (z.visual === 'singularity' ? 1 + Math.sin(this.time * 12) * 0.05 : 1));
      d.mat.opacity = 0.55 + Math.sin(this.time * 6 + z.id) * 0.15;
      d.mesh.rotation.z = this.time * (z.visual === 'singularity' ? 3 : 0.3);
      // Ambient particles.
      if (Math.random() < 0.5 * this.density) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * r;
        const px = z.pos.x + Math.cos(a) * rr;
        const pz = z.pos.z + Math.sin(a) * rr;
        if (z.visual === 'fire') this.emit(px, z.pos.y + 0.2, pz, 1, Math.random() < 0.5 ? '#ff7a1a' : '#ffcf4a', { speed: 1.5, up: 3, grav: -3, life: 0.7, size: 0.5 });
        else if (z.visual === 'static') this.emit(px, z.pos.y + 0.3, pz, 1, '#9ff6ff', { speed: 3, up: 1, grav: 0, life: 0.2, size: 0.25 });
        else if (z.visual === 'sanctuary') this.emit(px, z.pos.y + 0.2, pz, 1, '#fff1a0', { speed: 0.5, up: 3, grav: -1.5, life: 1.2, size: 0.3 });
        else if (z.visual === 'singularity') this.emit(px, z.pos.y + 0.5, pz, 1, '#b79bff', { speed: 2, dir: new THREE.Vector3(z.pos.x - px, 0.2, z.pos.z - pz).normalize(), spread: 0.1, grav: 0, life: 0.5, size: 0.35 });
        else if (z.visual === 'siphon') this.emit(px, z.pos.y + 0.4, pz, 1, '#ff3048', { speed: 2, dir: new THREE.Vector3(z.pos.x - px, 0.5, z.pos.z - pz).normalize(), grav: 0, life: 0.5, size: 0.3 });
        else if (z.visual === 'lockdown') this.emit(px, z.pos.y + 0.1, pz, 1, '#ffd35a', { speed: 0.3, up: 4, grav: -2, life: 0.8, size: 0.2 });
      }
    }
    for (const [id, d] of this.zoneDecals) {
      if (!live.has(id)) {
        d.mesh.visible = false;
        const i = this.decals.indexOf(d);
        if (i >= 0) this.decals.splice(i, 1);
        d.kind = 'warn';
        this.decalPool.push(d);
        this.zoneDecals.delete(id);
      }
    }
  }

  // --- Event handling ----------------------------------------------------------------

  handle(e: SimEvent, sim: Simulation, muzzleOf: (unit: number) => THREE.Vector3 | null): void {
    switch (e.t) {
      case 'shot': {
        const m = muzzleOf(e.unit);
        const p = m ?? new THREE.Vector3(e.from.x, e.from.y, e.from.z);
        const color = e.style === 'energy' ? '#9ff6ff' : e.style === 'smg' ? '#ffb060' : '#ffd890';
        this.glow(p, color, e.style === 'shotgun' || e.style === 'cannon' ? 1.1 : 0.7, 0.05);
        this.emit(p.x, p.y, p.z, e.style === 'shotgun' ? 5 : 2, color, { speed: 5, dir: new THREE.Vector3(e.dir.x, e.dir.y, e.dir.z), spread: 0.35, grav: 0, life: 0.08, size: 0.18 });
        break;
      }
      case 'impact':
        if (e.kind === 'world') {
          this.emit(e.pos.x, e.pos.y, e.pos.z, 3, '#ffd9a0', { speed: 4, dir: new THREE.Vector3(e.normal.x, e.normal.y, e.normal.z), spread: 0.8, life: 0.25, size: 0.12 });
          this.emit(e.pos.x, e.pos.y, e.pos.z, 1, '#888888', { speed: 0.8, up: 1, grav: -0.5, life: 0.5, size: 0.35 });
        } else if (e.kind === 'shield') {
          this.emit(e.pos.x, e.pos.y, e.pos.z, 3, '#9fd8ff', { speed: 3, life: 0.25, size: 0.2 });
        } else {
          this.emit(e.pos.x, e.pos.y, e.pos.z, 3, e.color ?? '#ff6060', { speed: 3, life: 0.25, size: 0.16 });
        }
        break;
      case 'death': {
        const u = sim.units.get(e.unit);
        const color = u && (u.team === 0 || u.team === 1) ? (u.team === 0 ? '#ffb347' : '#5ab4ff') : '#c58bff';
        const big = e.kind === 'structure' || e.kind === 'boss';
        this.emit(e.pos.x, e.pos.y + 1, e.pos.z, big ? 80 : e.kind === 'hero' ? 30 : 10, color, { speed: big ? 12 : 4, up: 1.5, life: big ? 1.6 : 0.8, size: big ? 0.9 : 0.35 });
        if (big) {
          this.ring(e.pos, 14, color, 1.2, 'shock');
          this.sphere({ x: e.pos.x, y: e.pos.y + 3, z: e.pos.z }, 9, color, 0.9);
          this.emit(e.pos.x, e.pos.y + 2, e.pos.z, 40, '#777777', { speed: 6, up: 2, grav: 2, life: 2.5, size: 1.4, drag: 2 });
        }
        break;
      }
      case 'heal': {
        const u = sim.units.get(e.target);
        if (u && e.amount >= 8) this.emit(u.pos.x, u.pos.y + 1, u.pos.z, Math.min(8, 1 + e.amount / 25), '#7dff9a', { speed: 1, up: 3, grav: -2, life: 0.8, size: 0.25 });
        break;
      }
      case 'orbTaken': {
        const h = sim.units.get(e.hero);
        const o = sim.orbs.find((x) => x.id === e.orb);
        if (o && h) {
          this.emit(o.pos.x, o.pos.y, o.pos.z, 12, e.denied ? '#ff5a5a' : '#c9ff6a', { speed: 5, life: 0.4, size: 0.3 });
        }
        break;
      }
      case 'respawn': {
        const u = sim.units.get(e.unit);
        if (u) {
          this.ring(u.pos, 3, '#ffffff', 0.6, 'shock');
          this.emit(u.pos.x, u.pos.y + 1, u.pos.z, 25, u.team === 0 ? '#ffb347' : '#5ab4ff', { speed: 3, up: 3, grav: -1, life: 1, size: 0.3 });
        }
        break;
      }
      case 'move':
        if (e.kind === 'dash' || e.kind === 'doubleJump') {
          const u = sim.units.get(e.unit);
          if (u) this.emit(u.pos.x, u.pos.y + 0.2, u.pos.z, 8, '#d0e0ff', { speed: 2, up: 0.2, grav: 0, life: 0.35, size: 0.4 });
        } else if (e.kind === 'land' || e.kind === 'slide') {
          const u = sim.units.get(e.unit);
          if (u) this.emit(u.pos.x, u.pos.y + 0.1, u.pos.z, 4, '#9a9aa8', { speed: 1.5, up: 0.3, grav: 0, life: 0.4, size: 0.4 });
        }
        break;
      case 'level': {
        const u = sim.units.get(e.unit);
        if (u) {
          this.ring(u.pos, 2.5, '#ffe28a', 0.8, 'shock');
          this.emit(u.pos.x, u.pos.y + 1, u.pos.z, 20, '#ffe28a', { speed: 2, up: 4, grav: -1, life: 1, size: 0.3 });
        }
        break;
      }
      case 'cast': {
        const u = sim.units.get(e.unit);
        if (u && e.ability !== 'upgrade') this.emit(u.pos.x, u.pos.y + 1.2, u.pos.z, 10, '#ffffff', { speed: 2, life: 0.4, size: 0.3 });
        break;
      }
      case 'parry':
        if (e.success) {
          const u = sim.units.get(e.unit);
          if (u) {
            this.sphere({ x: u.pos.x, y: u.pos.y + 1.2, z: u.pos.z }, 1.6, '#ffffff', 0.3);
            this.emit(u.pos.x, u.pos.y + 1.2, u.pos.z, 16, '#ffffff', { speed: 6, life: 0.3, size: 0.25 });
          }
        }
        break;
      case 'melee':
        if (e.hit) {
          const u = sim.units.get(e.unit);
          if (u) {
            const fx = Math.sin(u.yaw);
            const fz = Math.cos(u.yaw);
            this.emit(u.pos.x + fx * 1.5, u.pos.y + 1.2, u.pos.z + fz * 1.5, e.heavy ? 18 : 8, '#ffe0b0', { speed: 5, life: 0.25, size: 0.25 });
          }
        }
        break;
      case 'vfx':
        this.vfx(e, sim);
        break;
      default:
        break;
    }
  }

  private vfx(e: Extract<SimEvent, { t: 'vfx' }>, sim: Simulation): void {
    const { pos, color } = e;
    switch (e.kind) {
      case 'blast':
      case 'frost':
        this.sphere(pos, e.radius, color, 0.35);
        this.emit(pos.x, pos.y + 0.3, pos.z, 18 + e.radius * 3, color, { speed: e.radius * 2.2, up: 0.6, life: 0.5, size: 0.4 });
        break;
      case 'shockwave':
        this.ring(pos, e.radius, color, 0.5, 'shock');
        this.emit(pos.x, pos.y + 0.2, pos.z, 24, '#b0a090', { speed: e.radius * 1.6, up: 0.2, grav: 1, life: 0.6, size: 0.6 });
        break;
      case 'nova':
        this.sphere({ x: pos.x, y: pos.y, z: pos.z }, e.radius, color, 0.5);
        this.ring(pos, e.radius, color, 0.5, 'shock');
        this.emit(pos.x, pos.y, pos.z, 40, color, { speed: e.radius * 2.5, up: 0.3, life: 0.6, size: 0.45 });
        break;
      case 'warn':
        this.ring({ x: pos.x, y: sim.world.groundHeight(pos.x, pos.z, pos.y + 1), z: pos.z }, e.radius, color, e.duration, 'warn');
        break;
      case 'beam':
        if (e.to) this.beam(pos, e.to, color, e.radius, e.duration);
        break;
      case 'lightning':
        if (e.to) this.beam(pos, e.to, color, 0.35, e.duration, true);
        break;
      case 'healBeam':
        if (e.to) this.beam(pos, e.to, color, 0.25, e.duration);
        break;
      case 'tether':
        if (e.to) this.beam(pos, e.to, color, 0.2, e.duration);
        break;
      case 'mortar':
        if (e.to) this.arcs.push({ from: new THREE.Vector3(pos.x, pos.y, pos.z), to: new THREE.Vector3(e.to.x, e.to.y, e.to.z), start: this.time, until: this.time + e.duration, color: new THREE.Color(color) });
        break;
      case 'blink':
        this.emit(pos.x, pos.y + 1, pos.z, 20, color, { speed: 3, life: 0.5, size: 0.35 });
        if (e.to) this.emit(e.to.x, e.to.y + 1, e.to.z, 20, color, { speed: 3, life: 0.5, size: 0.35 });
        break;
      case 'charge':
      case 'raise':
        this.emit(pos.x, pos.y + 0.8, pos.z, 25, color, { speed: 3, up: 2, grav: -1, life: 0.8, size: 0.35 });
        break;
      case 'lockon':
        this.ring({ x: pos.x, y: pos.y - 0.8, z: pos.z }, 1.4, color, e.duration, 'warn');
        break;
      default:
        this.emit(pos.x, pos.y + 0.5, pos.z, 10, color, { speed: 2, life: 0.4, size: 0.3 });
    }
  }

  // --- Per-frame ----------------------------------------------------------------------

  private projectileColor(p: Projectile): THREE.Color {
    return this.col.set(p.color);
  }

  update(sim: Simulation, dt: number, camera: THREE.Camera, viewerTeam: number, unitPos: (id: number) => THREE.Vector3 | null): void {
    this.time = sim.time;
    this.beamCount = 0;
    this.glowCount = 0;
    const camPos = camera.position;
    const camQ = camera.quaternion;

    // Projectiles.
    for (const p of sim.projectiles) {
      if (!p.alive) continue;
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
      const head = this.tmpA.set(p.pos.x, p.pos.y, p.pos.z).clone();
      if (p.kind === 'bullet' || p.kind === 'trooper' || p.visual === 'tracer-small') {
        const len = Math.min(p.traveled + 0.5, Math.max(1.5, sp * 0.028));
        const tail = new THREE.Vector3(p.pos.x - (p.vel.x / sp) * len, p.pos.y - (p.vel.y / sp) * len, p.pos.z - (p.vel.z / sp) * len);
        const width = p.kind === 'trooper' ? 0.06 : p.visual === 'sniper' ? 0.12 : p.visual === 'pellet' ? 0.05 : 0.08;
        let c = this.projectileColor(p);
        if (p.kind === 'bullet') {
          c = this.col.set(p.visual === 'sniper' ? '#bfe8ff' : p.visual === 'ember' ? '#ff9a40' : p.visual === 'arc' ? '#9ff6ff' : p.visual === 'holy' ? '#fff3b0' : p.visual === 'soulshot' ? '#7dffcf' : '#ffe2a0');
        }
        this.pushBeam(tail, head, width, c, camPos);
        if (p.visual === 'soulshot' || p.visual === 'ember') this.pushGlow(head, 0.6, c, camQ);
      } else {
        const c = this.projectileColor(p);
        const size = p.visual === 'lance' ? 1.0 : p.visual === 'flask' ? 0.7 : p.visual === 'hexbolt' ? 1.1 : p.visual === 'hook' ? 0.4 : p.visual === 'orbshot' ? 0.8 : 0.6;
        this.pushGlow(head, size, c, camQ);
        if (Math.random() < 0.7 * this.density) this.emit(head.x, head.y, head.z, 1, c, { speed: 0.4, grav: 0, life: 0.3, size: size * 0.5 });
        if (p.visual === 'lance') {
          const tail = new THREE.Vector3(p.pos.x - (p.vel.x / sp) * 4, p.pos.y - (p.vel.y / sp) * 4, p.pos.z - (p.vel.z / sp) * 4);
          this.pushBeam(tail, head, 0.25, c, camPos);
        }
        if (p.visual === 'hook') {
          const owner = unitPos(p.ownerId);
          if (owner) this.pushBeam(owner, head, 0.05, this.col.set('#dddddd'), camPos);
        }
      }
    }

    // Soul orbs.
    for (const o of sim.orbs) {
      if (!o.alive) continue;
      const pulse = 0.85 + Math.sin(this.time * 10 + o.id) * 0.15;
      this.pushGlow(this.tmpB.set(o.pos.x, o.pos.y, o.pos.z), 1.1 * pulse, this.col.set('#c9ff6a'), camQ);
      if (Math.random() < 0.3) this.emit(o.pos.x, o.pos.y, o.pos.z, 1, '#e8ff9a', { speed: 0.6, grav: -1, life: 0.4, size: 0.2 });
    }
    // Pickups.
    for (const pk of sim.pickups) {
      if (!pk.alive) continue;
      const y = pk.pos.y + 0.8 + Math.sin(this.time * 2) * 0.25;
      this.pushGlow(this.tmpB.set(pk.pos.x, y, pk.pos.z), 2.4, this.col.set('#d68bff'), camQ);
      if (Math.random() < 0.5) this.emit(pk.pos.x, y, pk.pos.z, 1, '#e8b0ff', { speed: 1, up: 2, grav: -1, life: 0.8, size: 0.35 });
    }

    // Timed beams.
    for (let i = this.timedBeams.length - 1; i >= 0; i--) {
      const b = this.timedBeams[i];
      if (this.time > b.until) {
        this.timedBeams.splice(i, 1);
        continue;
      }
      const k = 1 - (this.time - b.start) / Math.max(0.001, b.until - b.start);
      const c = this.col.copy(b.color).multiplyScalar(0.5 + k);
      if (b.jagged) {
        let prev = b.a.clone();
        const segs = 6;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const next = b.a.clone().lerp(b.b, t);
          if (s < segs) next.add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
          this.pushBeam(prev, next, b.width * k, c, camPos);
          prev = next;
        }
      } else this.pushBeam(b.a, b.b, b.width * (0.4 + 0.6 * k), c, camPos);
    }
    // Mortar arcs.
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      if (this.time > a.until) {
        this.arcs.splice(i, 1);
        continue;
      }
      const t = (this.time - a.start) / (a.until - a.start);
      const p = a.from.clone().lerp(a.to, t);
      p.y += Math.sin(t * Math.PI) * 8;
      this.pushGlow(p, 1.0, a.color, camQ);
      if (Math.random() < 0.8) this.emit(p.x, p.y, p.z, 1, '#ff9955', { speed: 0.3, grav: 0, life: 0.4, size: 0.5 });
    }
    // Timed glows.
    for (let i = this.timedGlows.length - 1; i >= 0; i--) {
      const g = this.timedGlows[i];
      if (this.time > g.until) {
        this.timedGlows.splice(i, 1);
        continue;
      }
      this.pushGlow(g.pos, g.size, g.color, camQ);
    }

    this.beams.count = this.beamCount;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
    this.glows.count = this.glowCount;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;

    this.updateZones(sim, viewerTeam);
    this.updateDecals();
    this.updateParticles(dt);
  }
}
