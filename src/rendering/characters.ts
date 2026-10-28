import * as THREE from 'three';
import type { HeroModelDesc, WeaponDef } from '../gameplay/types';
import { bakeHierarchy } from './bake';

/**
 * Procedurally built, procedurally animated humanoid characters. Each hero
 * gets a joint hierarchy (hips → spine → chest → shoulders/arms, hips → legs)
 * with distinct proportions, headwear, coats and weapons, so silhouettes are
 * readable at a distance without any external model files.
 */

const BUILD = {
  slim: { shoulder: 0.2, torsoW: 0.36, torsoD: 0.22, limb: 0.07, hip: 0.13, head: 0.13, legLen: 0.9 },
  average: { shoulder: 0.23, torsoW: 0.42, torsoD: 0.25, limb: 0.08, hip: 0.14, head: 0.135, legLen: 0.88 },
  heavy: { shoulder: 0.27, torsoW: 0.5, torsoD: 0.32, limb: 0.1, hip: 0.16, head: 0.14, legLen: 0.86 },
  hulking: { shoulder: 0.33, torsoW: 0.62, torsoD: 0.38, limb: 0.125, hip: 0.18, head: 0.145, legLen: 0.86 },
  small: { shoulder: 0.19, torsoW: 0.34, torsoD: 0.2, limb: 0.065, hip: 0.12, head: 0.13, legLen: 0.8 },
} as const;

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

function capsule(r: number, len: number): THREE.BufferGeometry {
  return cached(`cap:${r.toFixed(3)}:${len.toFixed(3)}`, () => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 8);
    g.translate(0, -len / 2 - r * 0.3, 0);
    return g;
  });
}

function box(w: number, h: number, d: number, ty = 0): THREE.BufferGeometry {
  return cached(`box:${w}:${h}:${d}:${ty}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, ty, 0);
    return g;
  });
}

export interface CharacterMaterials {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  metal: THREE.MeshStandardMaterial;
  teamGlow: THREE.MeshBasicMaterial;
  all: THREE.Material[];
}

function makeMaterials(m: HeroModelDesc, teamColor: THREE.Color): CharacterMaterials {
  const primary = new THREE.MeshStandardMaterial({ color: m.primary, roughness: 0.75, metalness: 0.05 });
  const secondary = new THREE.MeshStandardMaterial({ color: m.secondary, roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: m.accent, roughness: 0.45, metalness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: m.skin, roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: m.glow });
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3c42', roughness: 0.35, metalness: 0.85 });
  const teamGlow = new THREE.MeshBasicMaterial({ color: teamColor });
  return { primary, secondary, accent, skin, glow, metal, teamGlow, all: [primary, secondary, accent, skin, glow, metal, teamGlow] };
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean): THREE.Mesh {
  const x = new THREE.Mesh(g, m);
  x.castShadow = shadow;
  return x;
}

export function buildWeapon(w: WeaponDef, mats: CharacterMaterials, shadow: boolean): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = mesh(geo, mat, shadow);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (w.style) {
    case 'shotgun':
      add(box(0.12, 0.12, 0.85), mats.metal, 0, 0, 0.35);
      add(box(0.1, 0.16, 0.35), mats.secondary, 0, -0.04, -0.12);
      add(box(0.09, 0.08, 0.3), mats.accent, 0, -0.08, 0.35);
      break;
    case 'lever':
      add(box(0.06, 0.06, 1.05), mats.metal, 0, 0.02, 0.45);
      add(box(0.08, 0.12, 0.45), mats.secondary, 0, -0.03, -0.1);
      add(box(0.06, 0.06, 0.28), mats.accent, 0, 0.1, 0.28);
      break;
    case 'smg':
      add(box(0.09, 0.13, 0.55), mats.metal, 0, 0, 0.2);
      add(box(0.06, 0.2, 0.08), mats.secondary, 0, -0.14, 0.12);
      add(box(0.05, 0.05, 0.2), mats.glow, 0, 0.04, 0.48);
      break;
    case 'cannon':
      add(box(0.16, 0.16, 0.5), mats.metal, 0, 0, 0.2);
      add(cached('bell', () => new THREE.CylinderGeometry(0.16, 0.09, 0.22, 10).rotateX(Math.PI / 2)), mats.accent, 0, 0, 0.55);
      add(box(0.08, 0.18, 0.1), mats.secondary, 0, -0.14, 0);
      break;
    case 'revolver':
    case 'pistol':
      add(box(0.07, 0.11, 0.36), mats.metal, 0, 0, 0.14);
      add(box(0.06, 0.17, 0.08), mats.secondary, 0, -0.1, 0);
      add(box(0.05, 0.05, 0.1), mats.accent, 0, 0.02, 0.33);
      break;
    case 'staff':
      add(box(0.05, 0.05, 1.3), mats.secondary, 0, 0, 0.3);
      add(cached('staffOrb', () => new THREE.SphereGeometry(0.1, 8, 6)), mats.glow, 0, 0, 0.98);
      break;
    default:
      add(box(0.08, 0.12, 0.8), mats.metal, 0, 0, 0.3);
      add(box(0.07, 0.14, 0.3), mats.secondary, 0, -0.04, -0.12);
      add(box(0.05, 0.16, 0.08), mats.secondary, 0, -0.14, 0.18);
      add(box(0.04, 0.04, 0.12), mats.glow, 0, 0.07, 0.15);
  }
  return g;
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  weapon: THREE.Group;
  weapon2: THREE.Group | null;
  muzzle: THREE.Object3D;
  skirt: THREE.Mesh | null;
  mats: CharacterMaterials;
  /** Materials actually used after baking (for flashes / ghosting). */
  liveMaterials: THREE.Material[];
  flashMaterials: THREE.MeshStandardMaterial[];
  hipHeight: number;
  scale: number;
}

export function buildHeroRig(model: HeroModelDesc, weapon: WeaponDef, teamColor: THREE.Color, shadow: boolean): Rig {
  const B = BUILD[model.build];
  const mats = makeMaterials(model, teamColor);
  const s = model.height;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);
  const legLen = B.legLen;
  const hipHeight = legLen + 0.02;
  const hips = new THREE.Group();
  hips.position.y = hipHeight;
  body.add(hips);
  hips.add(mesh(box(B.torsoW * 0.9, 0.2, B.torsoD, 0), mats.secondary, shadow));
  // Belt with team-coloured buckle.
  const belt = mesh(box(B.torsoW * 0.95, 0.06, B.torsoD + 0.02, 0.08), mats.accent, false);
  hips.add(belt);
  const buckle = mesh(box(0.08, 0.06, 0.03, 0.08), mats.teamGlow, false);
  buckle.position.z = B.torsoD / 2 + 0.01;
  hips.add(buckle);

  const spine = new THREE.Group();
  spine.position.y = 0.1;
  hips.add(spine);
  const torsoH = 0.55;
  const chest = mesh(box(B.torsoW, torsoH, B.torsoD, torsoH / 2), mats.primary, shadow);
  spine.add(chest);
  // Shoulder pads / collar.
  const collar = mesh(box(B.torsoW * 1.05, 0.1, B.torsoD * 1.08, torsoH - 0.02), mats.accent, false);
  spine.add(collar);
  // Chest emblem (team colour) for readability.
  const emblem = mesh(box(0.1, 0.1, 0.02, torsoH * 0.62), mats.teamGlow, false);
  emblem.position.z = B.torsoD / 2 + 0.012;
  spine.add(emblem);
  if (model.coat === 'armor') {
    const plate = mesh(box(B.torsoW * 1.12, torsoH * 0.7, B.torsoD * 1.15, torsoH * 0.55), mats.metal, shadow);
    spine.add(plate);
    for (const side of [-1, 1]) {
      const pauldron = mesh(cached('pauldron', () => new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mats.metal, shadow);
      pauldron.position.set(side * (B.torsoW / 2 + 0.04), torsoH - 0.02, 0);
      pauldron.scale.set(1.2, 0.9, 1.1);
      spine.add(pauldron);
    }
  } else if (model.coat === 'vest') {
    spine.add(mesh(box(B.torsoW * 1.04, torsoH * 0.75, B.torsoD * 1.06, torsoH * 0.45), mats.secondary, false));
  } else if (model.coat === 'cape') {
    const cape = mesh(box(B.torsoW * 1.1, 1.0, 0.04, -0.2), mats.accent, shadow);
    cape.position.set(0, torsoH, -B.torsoD / 2 - 0.03);
    spine.add(cape);
  }

  // Head.
  const head = new THREE.Group();
  head.position.y = torsoH + 0.06;
  spine.add(head);
  const neck = mesh(box(0.1, 0.08, 0.1, 0.04), mats.skin, false);
  head.add(neck);
  const skull = mesh(cached(`head:${B.head}`, () => new THREE.SphereGeometry(B.head, 14, 12)), mats.skin, shadow);
  skull.position.y = 0.08 + B.head;
  skull.scale.set(0.95, 1.08, 1.0);
  head.add(skull);
  const eyeGeo = cached('eye', () => new THREE.SphereGeometry(0.022, 6, 6));
  for (const side of [-1, 1]) {
    const eye = mesh(eyeGeo, mats.glow, false);
    eye.position.set(side * 0.045, 0.08 + B.head * 1.05, B.head * 0.88);
    head.add(eye);
  }
  addHeadwear(model, head, B.head, mats, shadow);

  // Arms.
  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * (B.torsoW / 2 + B.limb * 0.6), torsoH - 0.06, 0);
    spine.add(arm);
    arm.add(mesh(capsule(B.limb, 0.24), mats.primary, shadow));
    const fore = new THREE.Group();
    fore.position.y = -0.32;
    arm.add(fore);
    fore.add(mesh(capsule(B.limb * 0.88, 0.22), model.coat === 'armor' ? mats.metal : mats.primary, shadow));
    const hand = mesh(cached(`hand:${B.limb}`, () => new THREE.SphereGeometry(B.limb * 0.95, 8, 6)), mats.skin, false);
    hand.position.y = -0.33;
    fore.add(hand);
    return { arm, fore };
  };
  // Facing +Z, the character's right side is -X.
  const L = mkArm(1);
  const R = mkArm(-1);

  // Legs.
  const mkLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * B.hip, 0, 0);
    hips.add(leg);
    leg.add(mesh(capsule(B.limb * 1.15, legLen * 0.38), mats.secondary, shadow));
    const shin = new THREE.Group();
    shin.position.y = -legLen * 0.5;
    leg.add(shin);
    shin.add(mesh(capsule(B.limb * 1.0, legLen * 0.36), mats.secondary, shadow));
    const boot = mesh(box(B.limb * 2.2, 0.1, 0.26, 0), mats.metal, shadow);
    boot.position.set(0, -legLen * 0.48, 0.05);
    shin.add(boot);
    return { leg, shin };
  };
  const LL = mkLeg(-1);
  const LR = mkLeg(1);

  // Coat skirt (trench / robe) hanging from the hips.
  let skirt: THREE.Mesh | null = null;
  if (model.coat === 'trench' || model.coat === 'robe') {
    const len = model.coat === 'robe' ? legLen * 0.95 : legLen * 0.72;
    const geo = cached(`skirt:${B.torsoW}:${len}`, () => {
      const g = new THREE.CylinderGeometry(B.torsoW * 0.55, B.torsoW * (model.coat === 'robe' ? 0.85 : 0.75), len, 12, 1, true);
      g.translate(0, -len / 2, 0);
      return g;
    });
    const mat = model.coat === 'robe' ? mats.primary : mats.primary;
    skirt = new THREE.Mesh(geo, mat);
    (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    skirt.castShadow = shadow;
    skirt.scale.z = B.torsoD / B.torsoW + 0.25;
    skirt.position.y = 0.06;
    hips.add(skirt);
  }

  // Weapon in the right hand (dual wield for revolvers).
  // Barrel (+Z) is rotated onto the forearm's -Y so the gun follows the arm.
  const weaponG = buildWeapon(weapon, mats, shadow);
  weaponG.position.set(0, -0.33, 0.02);
  weaponG.rotation.x = Math.PI / 2;
  R.fore.add(weaponG);
  let weapon2: THREE.Group | null = null;
  if (weapon.style === 'revolver') {
    weapon2 = buildWeapon(weapon, mats, shadow);
    weapon2.position.set(0, -0.33, 0.02);
    weapon2.rotation.x = Math.PI / 2;
    L.fore.add(weapon2);
  }
  const muzzle = new THREE.Object3D();
  const muzzleZ = weapon.style === 'lever' ? 1.0 : weapon.style === 'shotgun' ? 0.8 : weapon.style === 'rifle' ? 0.72 : weapon.style === 'cannon' ? 0.65 : 0.4;
  muzzle.position.set(0, 0, muzzleZ);
  weaponG.add(muzzle);

  // Merge static parts per joint to cut draw calls (animation is per joint).
  const keep = new Set<THREE.Object3D>([muzzle]);
  if (skirt) keep.add(skirt);
  const baked = bakeHierarchy(body, keep, shadow);
  const live = new Set<THREE.Material>(baked.materials);
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) live.add(o.material as THREE.Material);
  });
  const liveMaterials = [...live];
  const flashMaterials = liveMaterials.filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial);

  return {
    root,
    body,
    hips,
    spine,
    head,
    armL: L.arm,
    armR: R.arm,
    foreL: L.fore,
    foreR: R.fore,
    legL: LL.leg,
    legR: LR.leg,
    shinL: LL.shin,
    shinR: LR.shin,
    weapon: weaponG,
    weapon2,
    muzzle,
    skirt,
    mats,
    liveMaterials,
    flashMaterials,
    hipHeight,
    scale: s,
  };
}

function addHeadwear(model: HeroModelDesc, head: THREE.Group, r: number, mats: CharacterMaterials, shadow: boolean): void {
  const top = 0.08 + r * 2.05;
  const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number, z = 0) => {
    const x = mesh(g, m, shadow);
    x.position.set(0, y, z);
    head.add(x);
    return x;
  };
  switch (model.headwear) {
    case 'fedora':
      add(cached(`brim:${r}`, () => new THREE.CylinderGeometry(r * 2.1, r * 2.1, 0.025, 20)), mats.secondary, top - 0.05);
      add(cached(`crown:${r}`, () => new THREE.CylinderGeometry(r * 1.05, r * 1.2, 0.16, 16)), mats.secondary, top + 0.03);
      add(cached(`band:${r}`, () => new THREE.CylinderGeometry(r * 1.21, r * 1.21, 0.035, 16)), mats.accent, top - 0.02);
      break;
    case 'tophat':
      add(cached(`tbrim:${r}`, () => new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.025, 20)), mats.secondary, top - 0.05);
      add(cached(`tcrown:${r}`, () => new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.36, 16)), mats.secondary, top + 0.13);
      add(cached(`tband:${r}`, () => new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.05, 16)), mats.glow, top);
      break;
    case 'bowler':
      add(cached(`bbrim:${r}`, () => new THREE.CylinderGeometry(r * 1.5, r * 1.5, 0.02, 20)), mats.secondary, top - 0.05);
      add(cached(`bdome:${r}`, () => new THREE.SphereGeometry(r * 1.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mats.secondary, top - 0.05);
      break;
    case 'hood': {
      const h = add(cached(`hood:${r}`, () => new THREE.SphereGeometry(r * 1.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)), mats.primary, top - r * 1.1, -0.02);
      h.scale.set(1, 1.15, 1.05);
      (h.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      break;
    }
    case 'helmet':
      add(cached(`helm:${r}`, () => new THREE.SphereGeometry(r * 1.18, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), mats.metal, top - r * 0.95);
      add(box(r * 1.6, 0.04, 0.05, 0), mats.glow, top - r * 0.95, r * 1.05);
      break;
    case 'goggles':
      add(box(r * 2.1, 0.07, 0.06, 0), mats.metal, top - r * 0.85, r * 0.85);
      for (const side of [-1, 1]) {
        const l = mesh(cached('lens', () => new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10).rotateX(Math.PI / 2)), mats.glow, false);
        l.position.set(side * 0.05, top - r * 0.85, r * 0.9);
        head.add(l);
      }
      break;
    case 'crown':
      add(cached(`crownG:${r}`, () => new THREE.CylinderGeometry(r * 1.0, r * 0.9, 0.1, 8, 1, true)), mats.accent, top);
      break;
    case 'horns':
      for (const side of [-1, 1]) {
        const h = mesh(cached('horn', () => new THREE.ConeGeometry(0.04, 0.22, 6)), mats.accent, shadow);
        h.position.set(side * r * 0.7, top, 0);
        h.rotation.z = -side * 0.5;
        head.add(h);
      }
      break;
    default:
      break;
  }
}

export interface PoseInput {
  dt: number;
  time: number;
  speed: number;
  /** Signed forward speed relative to facing, for backpedal. */
  forward: number;
  strafe: number;
  grounded: boolean;
  vy: number;
  crouching: boolean;
  sliding: boolean;
  pitch: number;
  firing: number;
  reloading: number;
  casting: number;
  meleeing: number;
  zip: boolean;
  stunned: boolean;
  deadFor: number;
  hitFlash: number;
  landing: number;
  dashing: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Procedural animation state that persists between frames. */
export class Animator {
  phase = 0;
  lean = 0;
  airBlend = 0;
  crouchBlend = 0;
  slideBlend = 0;
  aimBlend = 1;
  recoil = 0;

  apply(rig: Rig, p: PoseInput): void {
    const dt = Math.min(0.05, p.dt);
    const k = 1 - Math.exp(-14 * dt);
    const run = Math.min(1, p.speed / 7);
    this.phase += dt * (p.speed * 1.55 + 0.001) * (p.forward < -0.3 ? -1 : 1);
    this.airBlend = lerp(this.airBlend, p.grounded || p.zip ? 0 : 1, k);
    this.crouchBlend = lerp(this.crouchBlend, p.crouching && !p.sliding ? 1 : 0, k);
    this.slideBlend = lerp(this.slideBlend, p.sliding ? 1 : 0, k);
    this.lean = lerp(this.lean, (p.dashing ? 0.35 : run * 0.12) - this.slideBlend * 0.5, k);
    this.recoil = Math.max(this.recoil - dt * 6, 0);
    if (p.firing > 0.9) this.recoil = Math.min(1, this.recoil + 0.6);

    if (p.deadFor >= 0) {
      const t = Math.min(1, p.deadFor / 0.6);
      rig.body.rotation.x = -t * (Math.PI / 2) * 0.95;
      rig.body.position.y = rig.scale * 0.15 * t - Math.max(0, p.deadFor - 1.5) * 0.6;
      rig.armL.rotation.set(-2.6 * t, 0, 0.4 * t);
      rig.armR.rotation.set(-2.6 * t, 0, -0.4 * t);
      rig.legL.rotation.set(0.2 * t, 0, 0);
      rig.legR.rotation.set(-0.1 * t, 0, 0);
      return;
    }
    rig.body.rotation.x = 0;

    const sw = Math.sin(this.phase * 2.6);
    const cw = Math.cos(this.phase * 2.6);
    const amp = 0.75 * run * (1 - this.airBlend) * (1 - this.slideBlend);
    // Legs.
    let thighL = sw * amp;
    let thighR = -sw * amp;
    let kneeL = Math.max(0, -cw) * amp * 1.3 + 0.05;
    let kneeR = Math.max(0, cw) * amp * 1.3 + 0.05;
    // Air pose.
    thighL = lerp(thighL, -0.7, this.airBlend);
    thighR = lerp(thighR, -0.25, this.airBlend);
    kneeL = lerp(kneeL, 1.1, this.airBlend);
    kneeR = lerp(kneeR, 0.6, this.airBlend);
    // Crouch.
    thighL = lerp(thighL, -1.0, this.crouchBlend);
    thighR = lerp(thighR, -0.3, this.crouchBlend);
    kneeL = lerp(kneeL, 1.6, this.crouchBlend);
    kneeR = lerp(kneeR, 1.4, this.crouchBlend);
    // Slide: legs forward.
    thighL = lerp(thighL, -1.35, this.slideBlend);
    thighR = lerp(thighR, -1.0, this.slideBlend);
    kneeL = lerp(kneeL, 0.2, this.slideBlend);
    kneeR = lerp(kneeR, 1.2, this.slideBlend);
    if (p.zip) {
      thighL = -0.35 + Math.sin(p.time * 3) * 0.08;
      thighR = -0.2 - Math.sin(p.time * 3) * 0.08;
      kneeL = 0.5;
      kneeR = 0.4;
    }
    rig.legL.rotation.set(thighL, 0, 0);
    rig.legR.rotation.set(thighR, 0, 0);
    rig.shinL.rotation.set(kneeL, 0, 0);
    rig.shinR.rotation.set(kneeR, 0, 0);

    // Hips height (bob, crouch, slide, landing squash).
    const bob = Math.abs(sw) * 0.06 * run * (1 - this.airBlend);
    const drop = this.crouchBlend * 0.32 + this.slideBlend * 0.55 + p.landing * 0.12;
    rig.hips.position.y = rig.hipHeight - drop + bob;
    rig.hips.rotation.y = sw * 0.12 * run;

    // Spine: lean + aim pitch.
    const flinch = p.hitFlash * 0.15;
    rig.spine.rotation.x = this.lean - p.pitch * 0.35 - flinch + this.slideBlend * -0.2;
    rig.spine.rotation.y = -rig.hips.rotation.y;
    rig.head.rotation.x = -p.pitch * 0.4;
    if (p.stunned) {
      rig.head.rotation.z = Math.sin(p.time * 9) * 0.2;
      rig.spine.rotation.z = Math.sin(p.time * 7) * 0.08;
    } else {
      rig.head.rotation.z = 0;
      rig.spine.rotation.z = 0;
    }
    if (rig.skirt) {
      rig.skirt.rotation.x = -this.lean * 0.6 + Math.max(0, -thighL, -thighR) * 0.35;
    }

    // Arms: aim pose with recoil; reload lowers the gun; casting raises the off-hand.
    const aimPitch = p.pitch * 0.65 + 0.0;
    const rec = this.recoil * 0.25;
    let rArmX = -Math.PI / 2 - aimPitch + 0.05 - rec - this.lean * 0.5;
    let rForeX = -0.1 + rec * 0.5;
    let lArmX = -Math.PI / 2 - aimPitch + 0.2 - rec - this.lean * 0.5;
    let lForeX = -0.35;
    // Off-hand (on +X) swings inward (-Z rotation) to support the weapon.
    let lArmZ = -0.55;
    const rArmZ = 0.05;
    if (rig.weapon2) {
      lArmZ = -0.12;
      lForeX = -0.1;
      lArmX = rArmX;
    }
    if (p.reloading > 0) {
      const r = Math.sin(Math.min(1, p.reloading) * Math.PI);
      rArmX = lerp(rArmX, -0.6, r);
      rForeX = lerp(rForeX, -1.2, r);
      lArmX = lerp(lArmX, -0.9, r);
      lForeX = lerp(lForeX, -1.4, r);
    }
    if (p.casting > 0) {
      lArmX = lerp(lArmX, -2.6, p.casting);
      lArmZ = lerp(lArmZ, -0.2, p.casting);
      lForeX = lerp(lForeX, -0.2, p.casting);
    }
    if (p.meleeing > 0) {
      const m = Math.sin(Math.min(1, p.meleeing) * Math.PI);
      lArmX = lerp(lArmX, -1.9, m);
      lArmZ = lerp(lArmZ, -0.3, m);
      lForeX = lerp(lForeX, 0, m);
    }
    if (p.zip) {
      lArmX = -Math.PI + 0.1;
      lArmZ = -0.15;
      lForeX = 0;
    }
    // Swing the arms a little when running and not aiming hard.
    const swing = sw * 0.15 * run * (1 - this.airBlend);
    rig.armR.rotation.set(rArmX + swing * 0.3, 0, rArmZ);
    rig.foreR.rotation.set(rForeX, 0, 0);
    rig.armL.rotation.set(lArmX - swing * 0.3, 0, lArmZ);
    rig.foreL.rotation.set(lForeX, 0, 0);

    // Hit flash.
    const flash = p.hitFlash;
    // A small emissive floor keeps dark costumes readable at night.
    for (const m of rig.flashMaterials) m.emissive.setRGB(0.05 + flash * 0.8, 0.05 + flash * 0.1, 0.07 + flash * 0.1);
  }
}

export function disposeRig(rig: Rig): void {
  for (const m of rig.mats.all) m.dispose();
  for (const m of rig.liveMaterials) m.dispose();
}
