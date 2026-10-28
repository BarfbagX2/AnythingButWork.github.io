import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { SimEvent } from '../core/events';
import type { Simulation } from '../core/simulation';
import type { Hero } from '../gameplay/entities';
import { ThirdPersonCamera } from './camera';
import { Effects } from './effects';
import { TrooperView } from './trooperView';
import { CreatureView, HeroView, StructureView, SummonView } from './unitViews';
import { WorldView } from './worldView';

export type QualityPreset = 'low' | 'medium' | 'high' | 'custom';

export interface QualitySettings {
  preset: QualityPreset;
  resolutionScale: number;
  shadows: 'off' | 'low' | 'high';
  effects: number;
  viewDistance: number;
  postprocessing: boolean;
  fpsCap: number;
  textureQuality: 'low' | 'high';
}

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'custom'>, QualitySettings> = {
  low: { preset: 'low', resolutionScale: 0.65, shadows: 'off', effects: 0.4, viewDistance: 180, postprocessing: false, fpsCap: 60, textureQuality: 'low' },
  medium: { preset: 'medium', resolutionScale: 0.85, shadows: 'low', effects: 0.75, viewDistance: 260, postprocessing: true, fpsCap: 144, textureQuality: 'high' },
  high: { preset: 'high', resolutionScale: 1, shadows: 'high', effects: 1, viewDistance: 420, postprocessing: true, fpsCap: 240, textureQuality: 'high' },
};

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  renderMs: number;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 top = vec3(0.012, 0.015, 0.045);
    vec3 mid = vec3(0.07, 0.06, 0.16);
    vec3 horizon = vec3(0.32, 0.16, 0.2);
    vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
    col = mix(col, top, smoothstep(0.18, 0.7, h));
    // City glow near the horizon.
    col += vec3(0.25, 0.12, 0.08) * exp(-abs(h) * 14.0) * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: ThirdPersonCamera;
  readonly world: WorldView;
  readonly troopers: TrooperView;
  readonly effects = new Effects();
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0, renderMs: 0 };
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private moon: THREE.DirectionalLight;
  private heroViews = new Map<number, HeroView>();
  private structureViews = new Map<number, StructureView>();
  private creatureViews = new Map<number, CreatureView>();
  private summonViews = new Map<number, SummonView>();
  private pendingEvents: SimEvent[] = [];
  private quality: QualitySettings;
  private shadowsOn: boolean;
  private width = 1;
  private height = 1;
  private rejuv: THREE.Mesh;
  private camLight: THREE.PointLight;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly sim: Simulation,
    quality: QualitySettings,
  ) {
    this.quality = quality;
    this.shadowsOn = quality.shadows !== 'off';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.preset !== 'low', powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.shadowsOn;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.cam = new ThirdPersonCamera(1);

    this.scene.fog = new THREE.FogExp2('#16152a', 0.0085);
    this.scene.background = new THREE.Color('#090a16');
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.skyDome = sky;
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: '#e8e2ff', fog: false }));
    moonDisc.position.set(-260, 330, -420);
    moonDisc.lookAt(0, 0, 0);
    this.scene.add(moonDisc);

    this.scene.add(new THREE.HemisphereLight('#7080c8', '#4a3226', 1.25));
    this.scene.add(new THREE.AmbientLight('#2a2440', 0.7));
    // Soft fill that travels with the camera so nearby characters stay readable.
    this.camLight = new THREE.PointLight('#ffe6cc', 14, 32, 1.2);
    this.scene.add(this.camLight);
    this.moon = new THREE.DirectionalLight('#a9b8ff', 1.35);
    this.moon.position.set(-60, 120, -90);
    this.moon.castShadow = this.shadowsOn;
    const sz = quality.shadows === 'high' ? 2048 : 1024;
    this.moon.shadow.mapSize.set(sz, sz);
    const ext = quality.shadows === 'high' ? 60 : 45;
    Object.assign(this.moon.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 400 });
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.moon, this.moon.target);
    // Warm fill from street level.
    const fill = new THREE.DirectionalLight('#ff9a5a', 0.35);
    fill.position.set(80, 30, 60);
    this.scene.add(fill);

    this.world = new WorldView(sim.map, { shadows: this.shadowsOn, detail: 1 });
    this.scene.add(this.world.group);
    this.troopers = new TrooperView(this.shadowsOn);
    this.scene.add(this.troopers.group);
    this.scene.add(this.effects.group);
    this.effects.density = quality.effects;

    this.rejuv = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshBasicMaterial({ color: '#d68bff' }));
    this.rejuv.visible = false;
    this.scene.add(this.rejuv);

    for (const s of sim.structures) {
      const v = new StructureView(s, this.shadowsOn);
      this.structureViews.set(s.id, v);
      this.scene.add(v.group);
    }
    this.setupComposer();
  }

  private skyDome: THREE.Mesh;

  private setupComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.quality.postprocessing) return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.cam.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.75, 0.55, 0.72);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  setQuality(q: QualitySettings): void {
    const needShadowRebuild = (q.shadows !== 'off') !== this.shadowsOn;
    this.quality = q;
    this.effects.density = q.effects;
    this.renderer.shadowMap.enabled = q.shadows !== 'off';
    this.moon.castShadow = q.shadows !== 'off';
    if (needShadowRebuild) {
      this.shadowsOn = q.shadows !== 'off';
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.Material;
          m.needsUpdate = true;
        }
      });
    }
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = 2.2 / q.viewDistance;
    this.cam.camera.far = q.viewDistance + 300;
    this.cam.camera.updateProjectionMatrix();
    this.setupComposer();
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const pr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * this.quality.resolutionScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(this.width, this.height);
    this.cam.camera.aspect = this.width / this.height;
    this.cam.camera.updateProjectionMatrix();
  }

  queueEvents(events: SimEvent[]): void {
    for (const e of events) this.pendingEvents.push(e);
  }

  heroView(id: number): HeroView | undefined {
    return this.heroViews.get(id);
  }

  private syncViews(sim: Simulation): void {
    for (const h of sim.heroes) {
      if (!this.heroViews.has(h.id)) {
        const v = new HeroView(h, this.shadowsOn);
        this.heroViews.set(h.id, v);
        this.scene.add(v.rig.root);
      }
    }
    const liveN = new Set<number>();
    for (const n of sim.neutrals) {
      liveN.add(n.id);
      if (!this.creatureViews.has(n.id)) {
        const v = new CreatureView(n, this.shadowsOn);
        this.creatureViews.set(n.id, v);
        this.scene.add(v.group);
      }
    }
    for (const [id, v] of this.creatureViews) if (!liveN.has(id)) {
      this.scene.remove(v.group);
      this.creatureViews.delete(id);
    }
    const liveS = new Set<number>();
    for (const s of sim.summons) {
      liveS.add(s.id);
      if (!this.summonViews.has(s.id)) {
        const v = new SummonView(s, this.shadowsOn);
        this.summonViews.set(s.id, v);
        this.scene.add(v.group);
      }
    }
    for (const [id, v] of this.summonViews) if (!liveS.has(id)) {
      this.scene.remove(v.group);
      this.summonViews.delete(id);
    }
  }

  /** Renders a frame. `alpha` interpolates between the last two sim ticks. */
  render(sim: Simulation, alpha: number, dt: number, local: Hero | null, viewerTeam: number, zooming: boolean): void {
    const t0 = performance.now();
    this.renderer.info.reset();
    this.syncViews(sim);
    const time = sim.time;
    for (const [, v] of this.heroViews) v.update(alpha, time, dt, viewerTeam, v.hero === local, false);
    for (const [, v] of this.structureViews) v.update(time, viewerTeam);
    for (const [, v] of this.creatureViews) v.update(alpha, time, dt);
    for (const [, v] of this.summonViews) v.update(alpha, time, viewerTeam);
    this.troopers.update(sim.troopers, alpha, time, dt, this.cam.camera, viewerTeam, () => true);
    this.world.update(time);

    // Camera.
    if (local) {
      const lv = this.heroViews.get(local.id)!;
      const eye = lv.rig.root.position.clone();
      eye.y += local.crouching ? local.eyeHeight * 0.72 : local.eyeHeight;
      if (!local.alive) {
        eye.y += 3;
      }
      const zoomFov = local.def.weapon.style === 'lever' ? 32 : 55;
      this.cam.update(dt, eye, sim.world, zooming && local.alive, zoomFov);
      // Shadows follow the camera focus.
      const f = eye;
      this.moon.position.set(f.x - 60, f.y + 120, f.z - 90);
      this.moon.target.position.set(f.x, 0, f.z);
      this.moon.target.updateMatrixWorld();
    } else {
      this.cam.update(dt, new THREE.Vector3(0, 40, 0), sim.world, false, 60);
    }
    this.skyDome.position.copy(this.cam.camera.position);
    this.camLight.position.copy(this.cam.camera.position).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.updateMatrixWorld();
    this.world.faceCamera(this.cam.camera);

    // Event-driven effects need up-to-date muzzle transforms.
    const tmp = new THREE.Vector3();
    const muzzleOf = (unit: number) => {
      const v = this.heroViews.get(unit);
      return v ? v.muzzleWorld(tmp.clone()) : null;
    };
    for (const e of this.pendingEvents) {
      this.effects.handle(e, sim, muzzleOf);
      if (local && e.t === 'shot' && e.unit === local.id) this.cam.addRecoil(local.def.weapon.recoil);
      if (local && e.t === 'damage' && e.target === local.id && e.amount > 30) this.cam.addShake(Math.min(0.6, e.amount / 300));
      if (e.t === 'vfx' && (e.kind === 'shockwave' || e.kind === 'nova') && local && Math.hypot(e.pos.x - local.pos.x, e.pos.z - local.pos.z) < 20) this.cam.addShake(0.5);
    }
    this.pendingEvents.length = 0;
    this.effects.update(sim, dt, this.cam.camera, viewerTeam, (id) => {
      const u = sim.units.get(id);
      return u ? new THREE.Vector3(u.pos.x, u.pos.y + 1.3, u.pos.z) : null;
    });

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.cam.camera);
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
    this.stats.renderMs = performance.now() - t0;
  }

  /** Projects a world point to screen pixels (null if behind the camera). */
  project(p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.cam.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  dispose(): void {
    for (const v of this.heroViews.values()) v.dispose();
    this.world.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
