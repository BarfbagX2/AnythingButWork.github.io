import * as THREE from 'three';
import type { Hero, Neutral, Structure, Summon } from '../gameplay/entities';
import { SF } from '../gameplay/types';
import { Animator, buildHeroRig, disposeRig, type Rig } from './characters';
import { TEAM_COLORS } from './worldView';
import { bakeHierarchy } from './bake';

const std = (color: string | THREE.Color, rough = 0.6, metal = 0.2) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const basic = (color: string | THREE.Color) => new THREE.MeshBasicMaterial({ color });

function shadowAll(g: THREE.Object3D, on: boolean): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = on;
  });
}

/** Fresnel rim + hex-band shimmer: reads as a barrier without hiding the scene. */
function makeShieldMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color.clone() }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float time;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0);
        float bands = smoothstep(0.92, 1.0, sin(vP.y * 6.0 - time * 2.5) * 0.5 + 0.5);
        float a = rim * 0.38 + bands * 0.05;
        gl_FragColor = vec4(color * (0.6 + rim), a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// --- Nameplates ---------------------------------------------------------------

export class Nameplate {
  readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private last = '';

  constructor(width = 256, height = 64, scaleX = 2.2) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, transparent: true, sizeAttenuation: true });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(scaleX, (scaleX * height) / width, 1);
    this.sprite.renderOrder = 10;
  }

  draw(name: string, hpFrac: number, shieldFrac: number, color: string, level: number, extra = ''): void {
    const key = `${name}|${hpFrac.toFixed(3)}|${shieldFrac.toFixed(2)}|${color}|${level}|${extra}`;
    if (key === this.last) return;
    this.last = key;
    const c = this.ctx;
    const W = this.canvas.width;
    c.clearRect(0, 0, W, this.canvas.height);
    c.font = 'bold 22px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillText(name, W / 2 + 1, 23);
    c.fillStyle = color;
    c.fillText(name, W / 2, 22);
    if (extra) {
      c.font = 'bold 16px system-ui, sans-serif';
      c.fillStyle = '#ffd36a';
      c.fillText(extra, W / 2, 62);
    }
    const bx = 28;
    const bw = W - 56;
    c.fillStyle = 'rgba(0,0,0,0.7)';
    c.fillRect(bx - 2, 30, bw + 4, 16);
    c.fillStyle = color === '#7fe08a' ? '#4fd66a' : color;
    c.fillRect(bx, 32, bw * Math.max(0, Math.min(1, hpFrac)), 12);
    if (shieldFrac > 0) {
      c.fillStyle = 'rgba(220,240,255,0.85)';
      c.fillRect(bx, 32, bw * Math.min(1, shieldFrac), 4);
    }
    // Level badge.
    c.fillStyle = '#111';
    c.fillRect(2, 28, 22, 20);
    c.fillStyle = '#fff';
    c.font = 'bold 14px system-ui, sans-serif';
    c.fillText(String(level), 13, 43);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

// --- Heroes ---------------------------------------------------------------------

export class HeroView {
  readonly rig: Rig;
  readonly anim = new Animator();
  readonly plate = new Nameplate();
  readonly statusFx = new THREE.Group();
  private stunRing: THREE.Mesh;
  private shieldBubble: THREE.Mesh;
  private slowRing: THREE.Mesh;
  private ghost = false;
  lastHp: number;
  hitFlash = 0;
  lastLanding = -1;

  constructor(readonly hero: Hero, shadows: boolean) {
    this.rig = buildHeroRig(hero.def.model, hero.def.weapon, TEAM_COLORS[hero.team0], shadows);
    this.rig.root.add(this.statusFx);
    this.plate.sprite.position.y = hero.height + 0.55;
    this.rig.root.add(this.plate.sprite);
    this.stunRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 18), basic('#ffe066'));
    this.stunRing.rotation.x = Math.PI / 2;
    this.stunRing.position.y = hero.height + 0.15;
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shieldBubble.position.y = hero.height * 0.5;
    this.slowRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 20), new THREE.MeshBasicMaterial({ color: '#6fc8ff', transparent: true, opacity: 0.8, depthWrite: false }));
    this.slowRing.rotation.x = -Math.PI / 2;
    this.slowRing.position.y = 0.05;
    this.statusFx.add(this.stunRing, this.shieldBubble, this.slowRing);
    this.lastHp = hero.hp;
  }

  update(alpha: number, time: number, dt: number, viewerTeam: number, isLocal: boolean, firstPersonHide: boolean): void {
    const h = this.hero;
    const r = this.rig.root;
    r.position.set(
      h.prevPos.x + (h.pos.x - h.prevPos.x) * alpha,
      h.prevPos.y + (h.pos.y - h.prevPos.y) * alpha,
      h.prevPos.z + (h.pos.z - h.prevPos.z) * alpha,
    );
    let dy = h.yaw - h.prevYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    r.rotation.y = h.prevYaw + dy * alpha;
    if (h.hp < this.lastHp - 0.5) this.hitFlash = 1;
    this.lastHp = h.hp;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    const fx = Math.sin(h.yaw);
    const fz = Math.cos(h.yaw);
    const forward = h.vel.x * fx + h.vel.z * fz;
    const strafe = h.vel.x * fz - h.vel.z * fx;
    if (h.landedAt > this.lastLanding && time - h.landedAt < 0.2) this.lastLanding = h.landedAt;
    const landing = Math.max(0, 1 - (time - this.lastLanding) / 0.18);
    const castSt = h.cast;
    this.anim.apply(this.rig, {
      dt,
      time,
      speed: Math.hypot(h.vel.x, h.vel.z),
      forward,
      strafe,
      grounded: h.grounded,
      vy: h.vel.y,
      crouching: h.crouching,
      sliding: h.sliding,
      pitch: h.pitch,
      firing: time - h.lastShotTime < 0.03 ? 1 : 0,
      reloading: h.weapon.reloading ? 1 - Math.max(0, h.weapon.reloadEnd - time) / (h.def.weapon.reloadTime * h.stats.reloadMul) : 0,
      casting: castSt ? 1 : 0,
      meleeing: h.meleeSwingAt >= 0 || h.meleeStart >= 0 ? 1 : 0,
      zip: !!h.zip,
      stunned: (h.flags & SF.STUN) !== 0,
      deadFor: h.alive ? -1 : time - h.diedAt,
      hitFlash: this.hitFlash,
      landing,
      dashing: time < h.dashEnd || (h.forced !== null && h.forced.kind === 'dash'),
    });
    r.visible = h.alive || time - h.diedAt < 3;
    // Invisibility: allies see a ghost, enemies see nothing.
    const invisible = (h.flags & SF.INVISIBLE) !== 0 && !(h.flags & SF.REVEALED);
    const ghost = invisible && (h.team === viewerTeam);
    if (invisible && h.team !== viewerTeam) r.visible = false;
    if (ghost !== this.ghost) {
      this.ghost = ghost;
      for (const m of this.rig.liveMaterials) {
        m.transparent = ghost;
        m.opacity = ghost ? 0.35 : 1;
        m.needsUpdate = true;
      }
    }
    this.rig.body.visible = !firstPersonHide;
    // Status visuals.
    this.stunRing.visible = (h.flags & SF.STUN) !== 0 && h.alive;
    this.stunRing.rotation.z = time * 6;
    let shield = 0;
    let slowed = false;
    for (const s of h.statuses) {
      shield += Math.max(0, s.shieldLeft);
      if ((s.spec.mods?.moveSpeedPct ?? 0) < 0 || s.spec.flags! & SF.ROOT) slowed = true;
    }
    this.shieldBubble.visible = shield > 0 && h.alive;
    this.slowRing.visible = slowed && h.alive;
    const color = h.team === viewerTeam ? (isLocal ? '#ffffff' : '#7fe08a') : '#ff5a5a';
    this.plate.sprite.visible = h.alive && !isLocal;
    if (this.plate.sprite.visible) this.plate.draw(h.playerName, h.hp / h.maxHp, shield / h.maxHp, color, h.level);
  }

  /** World position of the weapon muzzle (for tracers / flashes). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.rig.muzzle.getWorldPosition(out);
  }

  dispose(): void {
    disposeRig(this.rig);
    this.plate.dispose();
  }
}

// --- Structures ------------------------------------------------------------------

export class StructureView {
  readonly group = new THREE.Group();
  private readonly statue = new THREE.Group();
  private readonly rubble = new THREE.Group();
  private readonly shield: THREE.Mesh;
  private readonly glowMats: THREE.MeshBasicMaterial[] = [];
  private readonly plate = new Nameplate(256, 64, 4);
  private spinner: THREE.Object3D | null = null;
  private lastPhase = 1;

  constructor(readonly s: Structure, shadows: boolean) {
    const team = s.team as 0 | 1;
    const tc = TEAM_COLORS[team];
    const glow = basic(tc);
    this.glowMats.push(glow);
    const stone = std('#5d5a57', 0.85, 0.05);
    const dark = std('#2b2a2e', 0.6, 0.4);
    const brass = std('#8a6a35', 0.4, 0.75);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.statue) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const type = s.def.type;
    if (type === 'guardian' || type === 'baseGuardian') {
      const k = type === 'baseGuardian' ? 1.15 : 1;
      add(new THREE.CylinderGeometry(0.9 * k, 1.25 * k, 3.6 * k, 8), stone, 0, 0.6 + 1.8 * k, 0);
      add(new THREE.BoxGeometry(2.6 * k, 0.9 * k, 1.3 * k), stone, 0, 0.6 + 3.9 * k, 0);
      const head = add(new THREE.BoxGeometry(0.9 * k, 1.0 * k, 0.9 * k), dark, 0, 0.6 + 4.9 * k, 0);
      add(new THREE.BoxGeometry(0.6 * k, 0.12 * k, 0.05), glow, 0, 0.6 + 4.95 * k, 0.46 * k);
      void head;
      // Arms holding a lantern blade.
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.45 * k, 2.2 * k, 0.45 * k), stone, side * 1.4 * k, 0.6 + 3.0 * k, 0.2);
      }
      add(new THREE.BoxGeometry(0.18, 3.6 * k, 0.18), brass, 1.4 * k, 0.6 + 2.8 * k, 0.75);
      const lantern = add(new THREE.OctahedronGeometry(0.42 * k), glow, -1.4 * k, 0.6 + 1.7 * k, 0.6);
      this.spinner = lantern;
      if (type === 'baseGuardian') add(new THREE.TorusGeometry(1.6, 0.08, 6, 24), glow, 0, 0.6 + 6.0, 0).rotation.x = Math.PI / 2;
    } else if (type === 'walker') {
      // A four-legged siege walker.
      const body = add(new THREE.BoxGeometry(3.2, 2.0, 3.6), dark, 0, 5.2, 0);
      void body;
      add(new THREE.BoxGeometry(2.0, 1.2, 1.6), stone, 0, 6.6, 0.4);
      add(new THREE.BoxGeometry(1.4, 0.18, 0.08), glow, 0, 6.6, 1.22);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = add(new THREE.CylinderGeometry(0.28, 0.4, 5.2, 8), brass, sx * 1.9, 2.4, sz * 1.9);
          leg.rotation.z = sx * 0.22;
          leg.rotation.x = -sz * 0.22;
          add(new THREE.SphereGeometry(0.5, 8, 6), dark, sx * 1.5, 4.8, sz * 1.5);
        }
        add(new THREE.CylinderGeometry(0.3, 0.38, 2.6, 10).rotateX(Math.PI / 2), dark, sx * 2.0, 5.6, 1.4);
        add(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10).rotateX(Math.PI / 2), glow, sx * 2.0, 5.6, 2.72);
      }
    } else if (type === 'shrine') {
      add(new THREE.CylinderGeometry(1.2, 1.7, 0.8, 6), stone, 0, 0.6 + 0.4, 0);
      add(new THREE.CylinderGeometry(0.55, 0.9, 4.2, 4), dark, 0, 0.6 + 2.9, 0).rotation.y = Math.PI / 4;
      const crystal = add(new THREE.OctahedronGeometry(0.9), glow, 0, 0.6 + 5.8, 0);
      crystal.scale.y = 1.6;
      this.spinner = crystal;
      for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(1.3 + i * 0.25, 0.04, 4, 24), glow, 0, 0.6 + 5.8, 0).rotation.x = Math.PI / 2 + i * 0.5;
    } else if (type === 'patron') {
      add(new THREE.CylinderGeometry(3.0, 3.6, 1.2, 12), stone, 0, 0.8 + 0.6, 0);
      add(new THREE.CylinderGeometry(1.0, 1.6, 4.0, 10), dark, 0, 0.8 + 3.2, 0);
      const mask = add(new THREE.SphereGeometry(2.0, 20, 16), brass, 0, 0.8 + 7.2, 0);
      mask.scale.set(1, 1.2, 0.8);
      for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.35, 10, 8), glow, side * 0.75, 0.8 + 7.6, 1.5);
      add(new THREE.BoxGeometry(1.2, 0.15, 0.2), glow, 0, 0.8 + 6.5, 1.55);
      const ring = new THREE.Group();
      ring.position.y = 0.8 + 7.2;
      this.statue.add(ring);
      for (let i = 0; i < 2; i++) {
        const t = add(new THREE.TorusGeometry(3.0 + i * 0.6, 0.1, 6, 40), glow, 0, 0, 0, ring);
        t.rotation.x = Math.PI / 2 + i * 0.6;
      }
      this.spinner = ring;
    }
    // Rubble (shown once destroyed).
    for (let i = 0; i < 7; i++) {
      const m = add(new THREE.BoxGeometry(0.8 + Math.random(), 0.5 + Math.random() * 0.6, 0.8 + Math.random()), stone, (Math.random() - 0.5) * s.radius * 2.4, 0.9, (Math.random() - 0.5) * s.radius * 2.4, this.rubble);
      m.rotation.set(Math.random(), Math.random(), Math.random());
    }
    this.rubble.visible = false;
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(s.radius + 1.6, 24, 16), makeShieldMaterial(tc));
    this.shield.scale.y = (s.height + 1.5) / (s.radius + 1.6);
    this.shield.position.y = s.height * 0.5;
    this.group.add(this.statue, this.rubble, this.shield);
    this.plate.sprite.position.y = s.height + 2.6;
    this.group.add(this.plate.sprite);
    this.group.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.group.rotation.y = s.yaw;
    shadowAll(this.statue, shadows);
    // Glow parts keep their pulsing material; everything else is merged.
    const keep = new Set<THREE.Object3D>();
    this.statue.traverse((o) => {
      if (o instanceof THREE.Mesh && this.glowMats.includes(o.material as THREE.MeshBasicMaterial)) keep.add(o);
    });
    if (this.spinner) keep.add(this.spinner);
    bakeHierarchy(this.statue, keep, shadows);
    bakeHierarchy(this.rubble, new Set(), shadows);
  }

  update(time: number, viewerTeam: number): void {
    const s = this.s;
    if (this.spinner) this.spinner.rotation.y = time * 0.8;
    const alive = s.alive;
    this.statue.visible = alive;
    this.rubble.visible = !alive;
    this.shield.visible = alive && !s.vulnerable;
    if (this.shield.visible) (this.shield.material as THREE.ShaderMaterial).uniforms.time.value = time;
    const pulse = s.attackAnim > 0 ? 1.8 : 1;
    for (const m of this.glowMats) m.color.copy(TEAM_COLORS[s.team as 0 | 1]).multiplyScalar(pulse * (0.5 + 0.5 * (s.hp / s.maxHp)));
    if (s.def.type === 'patron' && s.phase === 2 && this.lastPhase === 1) {
      this.lastPhase = 2;
      this.statue.position.y = -4;
      this.statue.rotation.z = 0.25;
    }
    this.plate.sprite.visible = alive;
    if (alive) {
      const color = s.team === viewerTeam ? '#7fe08a' : '#ff5a5a';
      const status = !s.vulnerable ? 'INVULNERABLE' : s.backdoor ? 'PROTECTED' : '';
      this.plate.draw(`${s.def.name}${s.phase === 2 ? ' (weakened)' : ''}`, s.hp / s.maxHp, 0, color, Math.round((s.hp / s.maxHp) * 100), status);
    }
  }
}

// --- Neutrals & boss --------------------------------------------------------------

export class CreatureView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly plate: Nameplate;
  private phase = Math.random() * 6;

  constructor(readonly n: Neutral, shadows: boolean) {
    const boss = n.kind === 'boss';
    const skin = std(boss ? '#2a1a35' : n.def.id === 'brute' ? '#3d3028' : '#3a3a33', 0.9, 0.05);
    const eye = basic(boss ? '#d06bff' : '#b6ff4a');
    const r = n.radius;
    const h = n.height;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 12, 10), skin);
    torso.scale.set(1, h / (r * 2.2), 0.8);
    torso.position.y = h * 0.55;
    torso.rotation.x = boss ? 0 : 0.35;
    this.body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 10, 8), skin);
    head.position.set(0, h * 0.88, r * 0.45);
    this.body.add(head);
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 6, 6), eye);
      e.position.set(side * r * 0.18, h * 0.9, r * 0.82);
      this.body.add(e);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.16, h * 0.45, 4, 6), skin);
      arm.position.set(side * r * 0.95, h * 0.45, r * 0.25);
      arm.rotation.z = side * 0.25;
      this.body.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.2, h * 0.25, 4, 6), skin);
      leg.position.set(side * r * 0.45, h * 0.18, 0);
      this.body.add(leg);
    }
    if (boss) {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.42, r * 0.35, 8, 1, true), basic('#e0b048'));
      crown.position.set(0, h * 1.02, r * 0.45);
      this.body.add(crown);
      const aura = new THREE.Mesh(new THREE.TorusGeometry(r * 1.6, 0.12, 6, 32), basic('#b057ff'));
      aura.rotation.x = Math.PI / 2;
      aura.position.y = 0.2;
      this.body.add(aura);
    }
    this.group.add(this.body);
    shadowAll(this.body, shadows);
    bakeHierarchy(this.body, new Set(), shadows);
    this.plate = new Nameplate(256, 64, boss ? 4 : 1.8);
    this.plate.sprite.position.y = h + (boss ? 1.5 : 0.6);
    this.group.add(this.plate.sprite);
  }

  update(alpha: number, time: number, dt: number): void {
    const n = this.n;
    this.group.position.set(n.prevPos.x + (n.pos.x - n.prevPos.x) * alpha, n.prevPos.y + (n.pos.y - n.prevPos.y) * alpha, n.prevPos.z + (n.pos.z - n.prevPos.z) * alpha);
    this.group.rotation.y = n.yaw;
    const sp = Math.hypot(n.vel.x, n.vel.z);
    this.phase += dt * (1.5 + sp * 2);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.08 * (sp > 0.5 ? 1 : 0.3);
    this.body.rotation.x = n.attackAnim > 0 ? 0.3 : 0;
    if (!n.alive) {
      const d = time - n.diedAt;
      this.body.rotation.z = Math.min(1.5, d * 3);
      this.group.position.y -= Math.max(0, d - 1) * 0.8;
    }
    this.plate.sprite.visible = n.alive && n.hp < n.maxHp;
    if (this.plate.sprite.visible) this.plate.draw(n.def.name, n.hp / n.maxHp, 0, '#e0c060', 0);
  }
}

// --- Summons --------------------------------------------------------------------

export class SummonView {
  readonly group = new THREE.Group();
  private readonly plate = new Nameplate(256, 64, 1.4);

  constructor(readonly s: Summon, shadows: boolean) {
    const tc = TEAM_COLORS[s.team as 0 | 1];
    if (s.visual === 'thrall') {
      const bone = std('#c9c3b0', 0.8, 0);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 6), bone);
      body.position.y = 0.95;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bone);
      head.position.y = 1.55;
      const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), basic('#7dffcf'));
      eyes.position.set(0, 1.58, 0.17);
      this.group.add(body, head, eyes);
    } else if (s.visual === 'boneward') {
      const bone = std('#d9d2bc', 0.8, 0);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6 + i * 0.2, 5), bone);
        const a = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.3, 0.8, Math.sin(a) * 0.3);
        spike.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
        this.group.add(spike);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), basic('#7dffcf'));
      orb.position.y = 2.1;
      this.group.add(orb);
    } else {
      const metal = std('#6b5a3a', 0.4, 0.8);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5), metal);
        const a = (i / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3);
        leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
        this.group.add(leg);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.55), metal);
      head.position.y = 1.15;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8).rotateX(Math.PI / 2), std('#222', 0.4, 0.8));
      barrel.position.set(0, 1.15, 0.5);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), basic(tc));
      light.position.set(0, 1.36, 0.1);
      this.group.add(head, barrel, light);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 20), new THREE.MeshBasicMaterial({ color: tc, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.group.add(ring);
    this.plate.sprite.position.y = s.height + 0.5;
    this.group.add(this.plate.sprite);
    shadowAll(this.group, shadows);
  }

  update(alpha: number, time: number, viewerTeam: number): void {
    const s = this.s;
    this.group.position.set(s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha, s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha, s.prevPos.z + (s.pos.z - s.prevPos.z) * alpha);
    this.group.rotation.y = s.yaw;
    if (!s.alive) this.group.scale.setScalar(Math.max(0.01, 1 - (time - s.diedAt) * 1.5));
    this.plate.sprite.visible = s.alive && s.hp < s.maxHp;
    if (this.plate.sprite.visible) this.plate.draw('', s.hp / s.maxHp, 0, s.team === viewerTeam ? '#7fe08a' : '#ff5a5a', 0);
  }
}
