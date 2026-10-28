import * as THREE from 'three';
import { Rng, hashString } from '../core/rng';
import type { SolidDef } from '../world/collision';
import type { MapDef } from '../world/mapTypes';
import { bakeHierarchy } from './bake';
import { FACADE_STYLES, makeAsphalt, makeConcrete, makeFacade, makeLaneLine, makeRadial, makeRoof, makeRing } from './textures';

export const TEAM_COLORS = { 0: new THREE.Color('#ffa63d'), 1: new THREE.Color('#4aa8ff') } as const;

interface GeoBuf {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

const newBuf = (): GeoBuf => ({ pos: [], nrm: [], uv: [], idx: [] });

function quad(b: GeoBuf, p: number[][], n: number[], uv: number[][]): void {
  const base = b.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    b.pos.push(p[i][0], p[i][1], p[i][2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.uv.push(uv[i][0], uv[i][1]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function toGeometry(b: GeoBuf): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** Adds a box's four walls with storey-based UVs (1 UV unit = 4 m). */
function addWalls(b: GeoBuf, s: SolidDef, tile = 4, skipBottom = 0): void {
  const { min, max } = s;
  const y0 = min.y + skipBottom;
  const y1 = max.y;
  const v0 = y0 / tile;
  const v1 = y1 / tile;
  // +Z face
  let w = (max.x - min.x) / tile;
  quad(b, [[min.x, y0, max.z], [max.x, y0, max.z], [max.x, y1, max.z], [min.x, y1, max.z]], [0, 0, 1], [[0, v0], [w, v0], [w, v1], [0, v1]]);
  // -Z face
  quad(b, [[max.x, y0, min.z], [min.x, y0, min.z], [min.x, y1, min.z], [max.x, y1, min.z]], [0, 0, -1], [[0, v0], [w, v0], [w, v1], [0, v1]]);
  w = (max.z - min.z) / tile;
  // +X face
  quad(b, [[max.x, y0, max.z], [max.x, y0, min.z], [max.x, y1, min.z], [max.x, y1, max.z]], [1, 0, 0], [[0, v0], [w, v0], [w, v1], [0, v1]]);
  // -X face
  quad(b, [[min.x, y0, min.z], [min.x, y0, max.z], [min.x, y1, max.z], [min.x, y1, min.z]], [-1, 0, 0], [[0, v0], [w, v0], [w, v1], [0, v1]]);
}

function addTop(b: GeoBuf, s: SolidDef, tile = 4): void {
  const { min, max } = s;
  const y = max.y;
  quad(
    b,
    [[min.x, y, max.z], [max.x, y, max.z], [max.x, y, min.z], [min.x, y, min.z]],
    [0, 1, 0],
    [[min.x / tile, max.z / tile], [max.x / tile, max.z / tile], [max.x / tile, min.z / tile], [min.x / tile, min.z / tile]],
  );
}

function addFlat(b: GeoBuf, minX: number, minZ: number, maxX: number, maxZ: number, y: number, tile: number): void {
  quad(
    b,
    [[minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ], [minX, y, minZ]],
    [0, 1, 0],
    [[minX / tile, maxZ / tile], [maxX / tile, maxZ / tile], [maxX / tile, minZ / tile], [minX / tile, minZ / tile]],
  );
}

/** Wedge geometry for ramps. */
function addRamp(b: GeoBuf, s: SolidDef): void {
  const { min, max } = s;
  const axis = s.axis ?? 'x';
  const dir = s.dir ?? 1;
  // Corner heights.
  const h = (x: number, z: number) => {
    const t = axis === 'x' ? (x - min.x) / (max.x - min.x) : (z - min.z) / (max.z - min.z);
    return min.y + (max.y - min.y) * (dir === 1 ? t : 1 - t);
  };
  const p00 = [min.x, h(min.x, min.z), min.z];
  const p10 = [max.x, h(max.x, min.z), min.z];
  const p11 = [max.x, h(max.x, max.z), max.z];
  const p01 = [min.x, h(min.x, max.z), max.z];
  const len = axis === 'x' ? max.x - min.x : max.z - min.z;
  const rise = max.y - min.y;
  const nl = Math.hypot(len, rise);
  const n = axis === 'x' ? [(-rise / nl) * dir, len / nl, 0] : [0, len / nl, (-rise / nl) * dir];
  quad(b, [p01, p11, p10, p00], n, [[0, 1], [3, 1], [3, 0], [0, 0]]);
  // Sides (triangles as degenerate quads).
  const side = (a: number[], bb: number[], c: number[], nn: number[]) => quad(b, [a, bb, c, c], nn, [[0, 0], [1, 0], [1, 1], [1, 1]]);
  if (axis === 'x') {
    side([min.x, min.y, max.z], [max.x, min.y, max.z], p11[1] > p01[1] ? p11 : p01, [0, 0, 1]);
    side([max.x, min.y, min.z], [min.x, min.y, min.z], p10[1] > p00[1] ? p10 : p00, [0, 0, -1]);
    const hx = dir === 1 ? max.x : min.x;
    quad(b, [[hx, min.y, min.z], [hx, min.y, max.z], [hx, max.y, max.z], [hx, max.y, min.z]], [dir, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  } else {
    side([max.x, min.y, min.z], [max.x, min.y, max.z], p11[1] > p10[1] ? p11 : p10, [1, 0, 0]);
    side([min.x, min.y, max.z], [min.x, min.y, min.z], p01[1] > p00[1] ? p01 : p00, [-1, 0, 0]);
    const hz = dir === 1 ? max.z : min.z;
    quad(b, [[max.x, min.y, hz], [min.x, min.y, hz], [min.x, max.y, hz], [max.x, max.y, hz]], [0, 0, dir], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

export interface WorldViewOptions {
  shadows: boolean;
  detail: number;
}

export class WorldView {
  readonly group = new THREE.Group();
  /** Static non-textured props, merged after construction. */
  private readonly props = new THREE.Group();
  readonly lampPools: THREE.InstancedMesh;
  private readonly disposables: { dispose(): void }[] = [];
  readonly ringTex = makeRing();
  readonly glowTex = makeRadial();

  constructor(
    private readonly map: MapDef,
    opts: WorldViewOptions,
  ) {
    const tFacades = FACADE_STYLES.map((st, i) => makeFacade(st, 100 + i * 7));
    const roofTex = makeRoof();
    const asphalt = makeAsphalt();
    const concrete = makeConcrete(9, '#55555c');
    const baseTiles = makeConcrete(11, '#4c4a52');
    const track = <T extends { dispose(): void }>(x: T) => {
      this.disposables.push(x);
      return x;
    };

    // --- Buildings, merged per facade style.
    const styleBufs: GeoBuf[] = FACADE_STYLES.map(newBuf);
    const roofBuf = newBuf();
    const trimBuf = newBuf();
    const concreteBuf = newBuf();
    const propBufs: Record<string, GeoBuf> = {};
    const rng = new Rng(77);
    const rooftopProps: { x: number; y: number; z: number; kind: number; s: number }[] = [];
    for (const s of map.solids) {
      if (s.invisible) continue;
      if (s.material.startsWith('building:')) {
        const style = Number(s.material.split(':')[1]) % FACADE_STYLES.length;
        addWalls(styleBufs[style], s);
        addTop(roofBuf, s, 8);
        // Cornice trim.
        const t = 0.25;
        const trim: SolidDef = { kind: 'box', min: { x: s.min.x - t, y: s.max.y - 0.35, z: s.min.z - t }, max: { x: s.max.x + t, y: s.max.y + 0.25, z: s.max.z + t }, material: 'trim' };
        addWalls(trimBuf, trim, 2);
        addTop(trimBuf, { ...trim, max: { ...trim.max } }, 2);
        // Occasional rooftop props on tall buildings.
        const area = (s.max.x - s.min.x) * (s.max.z - s.min.z);
        if (s.max.y > 9 && area > 60 && rng.chance(0.35)) {
          rooftopProps.push({ x: rng.range(s.min.x + 2, s.max.x - 2), y: s.max.y + 0.25, z: rng.range(s.min.z + 2, s.max.z - 2), kind: rng.int(0, 2), s: rng.range(0.8, 1.3) });
        }
      } else if (s.kind === 'ramp') {
        addRamp(concreteBuf, s);
      } else if (s.material === 'bridge' || s.material === 'pedestal') {
        addWalls(concreteBuf, s, 2);
        addTop(concreteBuf, s, 2);
      } else if (s.material.startsWith('prop:')) {
        const k = s.material;
        propBufs[k] ??= newBuf();
        addWalls(propBufs[k], s, 1);
        addTop(propBufs[k], s, 1);
      }
    }
    FACADE_STYLES.forEach((st, i) => {
      if (styleBufs[i].pos.length === 0) return;
      const mat = track(
        new THREE.MeshStandardMaterial({
          map: tFacades[i].map,
          emissiveMap: tFacades[i].emissive,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 1.25,
          roughness: 0.85,
          metalness: 0.05,
        }),
      );
      void st;
      const mesh = new THREE.Mesh(track(toGeometry(styleBufs[i])), mat);
      mesh.castShadow = opts.shadows;
      mesh.receiveShadow = opts.shadows;
      this.group.add(mesh);
    });
    const roofMesh = new THREE.Mesh(track(toGeometry(roofBuf)), track(new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95 })));
    roofMesh.receiveShadow = opts.shadows;
    this.group.add(roofMesh);
    const trimMesh = new THREE.Mesh(track(toGeometry(trimBuf)), track(new THREE.MeshStandardMaterial({ color: '#1c1b20', roughness: 0.7, metalness: 0.2 })));
    this.group.add(trimMesh);
    const concMesh = new THREE.Mesh(track(toGeometry(concreteBuf)), track(new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.9 })));
    concMesh.castShadow = opts.shadows;
    concMesh.receiveShadow = opts.shadows;
    this.group.add(concMesh);
    const propColors: Record<string, string> = { 'prop:barrier': '#8a8a8f', 'prop:crate': '#6b4f2e', 'prop:car': '#3c4a5c', 'prop:planter': '#4a5a3a', 'prop:tank': '#6a5a40' };
    for (const [k, b] of Object.entries(propBufs)) {
      const m = new THREE.Mesh(track(toGeometry(b)), track(new THREE.MeshStandardMaterial({ color: propColors[k] ?? '#777', roughness: 0.6, metalness: k === 'prop:car' ? 0.5 : 0.1 })));
      m.castShadow = opts.shadows;
      m.receiveShadow = opts.shadows;
      this.group.add(m);
    }
    this.addRooftopProps(rooftopProps, opts, track);

    // --- Ground.
    const groundBuf = newBuf();
    const { minX, minZ, maxX, maxZ } = map.bounds;
    addFlat(groundBuf, minX - 40, minZ - 40, maxX + 40, maxZ + 40, 0, 12);
    asphalt.repeat.set(1, 1);
    const ground = new THREE.Mesh(track(toGeometry(groundBuf)), track(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.55, metalness: 0.15, color: '#b8b8c4' })));
    ground.receiveShadow = opts.shadows;
    this.group.add(ground);

    // Plazas / bases / sidewalks as overlay decals.
    const plazaBuf = newBuf();
    const baseBuf = newBuf();
    for (const st of map.decor.streets) {
      if (st.kind === 'plaza') addFlat(plazaBuf, st.minX, st.minZ, st.maxX, st.maxZ, 0.015, 4);
      if (st.kind === 'base') addFlat(baseBuf, st.minX, st.minZ, st.maxX, st.maxZ, 0.02, 4);
    }
    if (plazaBuf.pos.length) this.group.add(this.receive(new THREE.Mesh(track(toGeometry(plazaBuf)), track(new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.8, color: '#a8a0a0' }))), opts));
    if (baseBuf.pos.length) this.group.add(this.receive(new THREE.Mesh(track(toGeometry(baseBuf)), track(new THREE.MeshStandardMaterial({ map: baseTiles, roughness: 0.6, metalness: 0.2 }))), opts));

    // Lane centre lines (dashed, lane coloured).
    for (const lane of map.lanes) {
      const lineTex = makeLaneLine(lane.color);
      const buf = newBuf();
      for (let i = 1; i < lane.path.length; i++) {
        const a = lane.path[i - 1];
        const b = lane.path[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const nx = (-dz / len) * 0.35;
        const nz = (dx / len) * 0.35;
        const v = len / 4;
        quad(buf, [[a.x + nx, 0.03, a.z + nz], [a.x - nx, 0.03, a.z - nz], [b.x - nx, 0.03, b.z - nz], [b.x + nx, 0.03, b.z + nz]], [0, 1, 0], [[0, 0], [1, 0], [1, v], [0, v]]);
      }
      const m = new THREE.Mesh(track(toGeometry(buf)), track(new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, depthWrite: false, color: '#ffffff' })));
      m.renderOrder = 1;
      this.group.add(m);
    }

    // Team emblems in bases.
    for (const team of [0, 1] as const) {
      const sp = map.spawns[team];
      const em = new THREE.Mesh(new THREE.CircleGeometry(9, 48), track(new THREE.MeshBasicMaterial({ map: this.ringTex, color: TEAM_COLORS[team], transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
      em.rotation.x = -Math.PI / 2;
      em.position.set(sp.pos.x, 0.04, sp.pos.z - (team === 1 ? 6 : -6));
      this.group.add(em);
    }
    // Mid-boss arena ring.
    const bossRing = new THREE.Mesh(new THREE.RingGeometry(map.midBoss.radius - 1.2, map.midBoss.radius, 64), track(new THREE.MeshBasicMaterial({ color: '#b057ff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
    bossRing.rotation.x = -Math.PI / 2;
    bossRing.position.set(map.midBoss.pos.x, 0.05, map.midBoss.pos.z);
    this.group.add(bossRing);

    // --- Lamps (instanced).
    const lamps = map.decor.lamps;
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.4, 6);
    poleGeo.translate(0, 2.7, 0);
    const poles = new THREE.InstancedMesh(track(poleGeo), track(new THREE.MeshStandardMaterial({ color: '#1d1e24', metalness: 0.6, roughness: 0.4 })), lamps.length);
    const headGeo = new THREE.SphereGeometry(0.32, 10, 8);
    const heads = new THREE.InstancedMesh(track(headGeo), track(new THREE.MeshBasicMaterial({ color: '#ffd68a' })), lamps.length);
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    const poolTex = makeRadial('rgba(255,200,120,0.55)', 'rgba(255,170,80,0)');
    this.lampPools = new THREE.InstancedMesh(track(poolGeo), track(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), lamps.length);
    const haloTex = makeRadial('rgba(255,210,140,0.9)', 'rgba(255,180,90,0)');
    const halos = new THREE.InstancedMesh(track(new THREE.PlaneGeometry(1, 1)), track(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), lamps.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    lamps.forEach((l, i) => {
      m4.makeTranslation(l.pos.x, 0, l.pos.z);
      poles.setMatrixAt(i, m4);
      const hx = l.pos.x + Math.sin(l.yaw) * 1.1;
      const hz = l.pos.z + Math.cos(l.yaw) * 1.1;
      m4.makeTranslation(hx, 5.3, hz);
      heads.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(hx, 0.025, hz), q.identity(), new THREE.Vector3(13, 1, 13));
      this.lampPools.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(hx, 5.3, hz), q.identity(), new THREE.Vector3(1.7, 1.7, 1.7));
      halos.setMatrixAt(i, m4);
    });
    poles.castShadow = opts.shadows;
    this.group.add(poles, heads, this.lampPools);
    this.halos = halos;
    this.group.add(halos);

    // --- Ziplines.
    for (const z of map.ziplines) {
      const color = TEAM_COLORS[z.team as 0 | 1];
      const pts = z.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      const tube = new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, Math.max(8, pts.length * 24), 0.06, 5, false);
      this.group.add(new THREE.Mesh(track(tube), track(new THREE.MeshBasicMaterial({ color }))));
      for (const p of pts) {
        const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.18, 0.25, p.y + 0.6, 8)), track(new THREE.MeshStandardMaterial({ color: '#2a2a30', metalness: 0.7, roughness: 0.4 })));
        pole.position.set(p.x, (p.y + 0.6) / 2, p.z);
        pole.castShadow = opts.shadows;
        this.props.add(pole);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), track(new THREE.MeshBasicMaterial({ color })));
        cap.position.set(p.x, p.y + 0.6, p.z);
        this.props.add(cap);
      }
    }

    // --- Shops (kiosks with glowing signs).
    for (const s of map.shops) {
      const g = new THREE.Group();
      const booth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 1.6), track(new THREE.MeshStandardMaterial({ color: '#3a2c3c', roughness: 0.6 })));
      booth.position.y = 1.3;
      booth.castShadow = opts.shadows;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 0.7, 0.2), track(new THREE.MeshBasicMaterial({ color: '#5cffc8' })));
      sign.position.set(0, 3.0, 0);
      const pool = new THREE.Mesh(new THREE.RingGeometry(s.radius - 0.25, s.radius, 48), track(new THREE.MeshBasicMaterial({ color: '#5cffc8', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending })));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.05;
      g.add(booth, sign);
      g.position.set(s.pos.x, 0, s.pos.z);
      g.rotation.y = s.team === 1 ? Math.PI : 0;
      for (const m of [booth, sign]) {
        g.updateMatrixWorld();
        m.applyMatrix4(g.matrix);
        this.props.add(m);
      }
      pool.position.set(s.pos.x, 0.05, s.pos.z);
      this.group.add(pool);
    }

    // --- Distant skyline outside the playable bounds.
    this.addSkyline(track, tFacades);
    void hashString;
    this.group.add(this.props);
    bakeHierarchy(this.props, new Set(), opts.shadows);
  }

  halos: THREE.InstancedMesh;

  private receive<T extends THREE.Mesh>(m: T, opts: WorldViewOptions): T {
    m.receiveShadow = opts.shadows;
    return m;
  }

  private addRooftopProps(list: { x: number; y: number; z: number; kind: number; s: number }[], opts: WorldViewOptions, track: <T extends { dispose(): void }>(x: T) => T): void {
    const tankGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.6, 12);
    tankGeo.translate(0, 3.2, 0);
    const legGeo = new THREE.BoxGeometry(2.4, 2, 2.4);
    legGeo.translate(0, 1, 0);
    const acGeo = new THREE.BoxGeometry(2.2, 1.2, 1.6);
    acGeo.translate(0, 0.6, 0);
    const antGeo = new THREE.CylinderGeometry(0.05, 0.08, 6, 4);
    antGeo.translate(0, 3, 0);
    const mat = track(new THREE.MeshStandardMaterial({ color: '#3b3533', roughness: 0.8 }));
    const metal = track(new THREE.MeshStandardMaterial({ color: '#55585e', roughness: 0.5, metalness: 0.6 }));
    const lights: THREE.Vector3[] = [];
    for (const p of list) {
      const g = new THREE.Group();
      if (p.kind === 0) {
        g.add(new THREE.Mesh(tankGeo, mat), new THREE.Mesh(legGeo, metal));
      } else if (p.kind === 1) {
        g.add(new THREE.Mesh(acGeo, metal));
      } else {
        g.add(new THREE.Mesh(antGeo, metal));
        lights.push(new THREE.Vector3(p.x, p.y + 6, p.z));
      }
      g.position.set(p.x, p.y, p.z);
      g.scale.setScalar(p.s);
      g.updateMatrix();
      for (const m of [...g.children]) {
        m.applyMatrix4(g.matrix);
        (m as THREE.Mesh).castShadow = opts.shadows;
        this.props.add(m);
      }
    }
    // Blinking aircraft-warning lights on antennas.
    for (const l of lights) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), track(new THREE.MeshBasicMaterial({ color: '#ff3030' })));
      s.position.copy(l);
      s.userData.blink = Math.random() * 6;
      this.blinkers.push(s);
      this.group.add(s);
    }
  }

  readonly blinkers: THREE.Mesh[] = [];

  private addSkyline(track: <T extends { dispose(): void }>(x: T) => T, facades: { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture }[]): void {
    const rng = new Rng(4242);
    const bufs = facades.map(newBuf);
    const { minX, minZ, maxX, maxZ } = this.map.bounds;
    const ring = (n: number, dist: number) => {
      for (let i = 0; i < n; i++) {
        const side = i % 4;
        const t = rng.range(-1.2, 1.2);
        const w = rng.range(10, 26);
        const d = rng.range(10, 26);
        const h = rng.range(25, 90);
        let cx = 0;
        let cz = 0;
        if (side === 0) {
          cx = t * (maxX + dist);
          cz = maxZ + dist + rng.range(0, 40);
        } else if (side === 1) {
          cx = t * (maxX + dist);
          cz = minZ - dist - rng.range(0, 40);
        } else if (side === 2) {
          cx = maxX + dist + rng.range(0, 40);
          cz = t * (maxZ + dist);
        } else {
          cx = minX - dist - rng.range(0, 40);
          cz = t * (maxZ + dist);
        }
        const s: SolidDef = { kind: 'box', min: { x: cx - w / 2, y: 0, z: cz - d / 2 }, max: { x: cx + w / 2, y: h, z: cz + d / 2 }, material: '' };
        const st = rng.int(0, facades.length - 1);
        addWalls(bufs[st], s, 4);
      }
    };
    ring(70, 12);
    ring(60, 70);
    bufs.forEach((b, i) => {
      if (!b.pos.length) return;
      const mat = track(new THREE.MeshStandardMaterial({ map: facades[i].map, emissiveMap: facades[i].emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.0, roughness: 0.9, color: '#777788' }));
      this.group.add(new THREE.Mesh(track(toGeometry(b)), mat));
    });
  }

  update(time: number): void {
    for (const b of this.blinkers) b.visible = Math.sin(time * 2.2 + (b.userData.blink as number)) > 0.6;
  }

  /** Billboards the lamp halos toward the camera. */
  faceCamera(camera: THREE.Camera): void {
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const camQ = camera.quaternion;
    for (let i = 0; i < this.halos.count; i++) {
      this.halos.getMatrixAt(i, m4);
      m4.decompose(pos, q, scl);
      m4.compose(pos, camQ, scl);
      this.halos.setMatrixAt(i, m4);
    }
    this.halos.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
