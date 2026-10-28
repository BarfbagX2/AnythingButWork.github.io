import * as THREE from 'three';
import { relationBarColor } from './palette';
import type { Trooper } from '../gameplay/entities';
import { TEAM_COLORS } from './worldView';

/**
 * All lane troopers are drawn with a handful of InstancedMeshes (one per body
 * part) so a hundred-plus troopers cost only a few draw calls. Parts are
 * animated procedurally by composing per-instance matrices.
 */

interface Part {
  mesh: THREE.InstancedMesh;
  /** Local offset from the trooper root. */
  offset: THREE.Vector3;
  pivotLeg?: -1 | 1;
  arm?: boolean;
  teamTint: boolean;
}

const MAX = 260;

export class TrooperView {
  readonly group = new THREE.Group();
  private parts: Part[] = [];
  private hpBg: THREE.InstancedMesh;
  private hpFill: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private m4b = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private col = new THREE.Color();
  private phases = new Map<number, number>();

  constructor(shadows: boolean) {
    const mk = (geo: THREE.BufferGeometry, color: string, offset: [number, number, number], teamTint: boolean, extra: Partial<Part> = {}, emissive = false) => {
      const mat = emissive ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 });
      const mesh = new THREE.InstancedMesh(geo, mat, MAX);
      mesh.count = 0;
      mesh.castShadow = shadows && !emissive;
      mesh.frustumCulled = false;
      if (teamTint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      this.group.add(mesh);
      this.parts.push({ mesh, offset: new THREE.Vector3(...offset), teamTint, ...extra });
    };
    const leg = new THREE.BoxGeometry(0.16, 0.8, 0.18);
    leg.translate(0, -0.4, 0);
    mk(new THREE.BoxGeometry(0.46, 0.55, 0.28), '#ffffff', [0, 1.2, 0], true);
    mk(new THREE.BoxGeometry(0.4, 0.12, 0.3), '#2a2a2e', [0, 0.92, 0], false);
    mk(new THREE.SphereGeometry(0.17, 10, 8), '#c9a385', [0, 1.62, 0], false);
    mk(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', [0, 1.65, 0], true);
    mk(new THREE.BoxGeometry(0.22, 0.05, 0.05), '#ffffff', [0, 1.64, 0.16], true, {}, true);
    mk(leg, '#25262b', [-0.12, 0.9, 0], false, { pivotLeg: -1 });
    mk(leg, '#25262b', [0.12, 0.9, 0], false, { pivotLeg: 1 });
    mk(new THREE.BoxGeometry(0.08, 0.1, 0.7), '#18181c', [0.22, 1.18, 0.3], false, { arm: true });
    mk(new THREE.BoxGeometry(0.34, 0.4, 0.16), '#3b3a33', [0, 1.22, -0.21], false);
    // Health bars (camera-facing quads).
    const bar = new THREE.PlaneGeometry(1, 0.11);
    this.hpBg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.6, depthWrite: false }), MAX);
    this.hpFill = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false }), MAX);
    this.hpFill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const m of [this.hpBg, this.hpFill]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
    }
  }

  update(troopers: Trooper[], alpha: number, time: number, dt: number, camera: THREE.Camera, viewerTeam: number, visible: (t: Trooper) => boolean): void {
    let n = 0;
    let bars = 0;
    const camQ = camera.quaternion;
    for (const t of troopers) {
      if (n >= MAX) break;
      if (!visible(t)) continue;
      const x = t.prevPos.x + (t.pos.x - t.prevPos.x) * alpha;
      const y = t.prevPos.y + (t.pos.y - t.prevPos.y) * alpha;
      const z = t.prevPos.z + (t.pos.z - t.prevPos.z) * alpha;
      const sc = t.def.height / 1.75;
      let ph = this.phases.get(t.id) ?? (t.id * 1.7) % 6.28;
      const sp = Math.hypot(t.vel.x, t.vel.z);
      ph += dt * sp * 2.2;
      this.phases.set(t.id, ph);
      let fall = 0;
      let sink = 0;
      if (!t.alive) {
        const d = time - t.diedAt;
        fall = Math.min(1, d / 0.45);
        sink = Math.max(0, d - 1.2) * 0.7;
      }
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), t.yaw);
      if (fall > 0) {
        this.q2.setFromAxisAngle(this.v.set(1, 0, 0), -fall * 1.45);
        this.q.multiply(this.q2);
      }
      this.m4b.compose(this.v.set(x, y - sink, z), this.q, this.s.set(sc, sc, sc));
      const team = t.team as 0 | 1;
      const tc = TEAM_COLORS[team];
      const swing = Math.sin(ph) * 0.6 * Math.min(1, sp / 4);
      for (const p of this.parts) {
        if (p.pivotLeg) {
          this.q2.setFromAxisAngle(this.v.set(1, 0, 0), swing * p.pivotLeg);
          this.m4.compose(p.offset, this.q2, this.s.set(1, 1, 1));
        } else if (p.arm) {
          const kick = t.attackAnim > 0 ? -0.15 : 0;
          this.q2.setFromAxisAngle(this.v.set(1, 0, 0), kick);
          this.m4.compose(p.offset, this.q2, this.s.set(1, 1, 1));
        } else {
          this.m4.makeTranslation(p.offset.x, p.offset.y + Math.abs(swing) * 0.03, p.offset.z);
        }
        this.m4.premultiply(this.m4b);
        p.mesh.setMatrixAt(n, this.m4);
        if (p.teamTint) {
          this.col.copy(tc);
          if (t.def.id === 'heavy' || t.def.id === 'super') this.col.multiplyScalar(0.7);
          if (t.def.id === 'medic') this.col.lerp(new THREE.Color('#ffffff'), 0.5);
          p.mesh.setColorAt(n, this.col);
        }
      }
      if (t.alive && t.hp < t.maxHp) {
        const frac = Math.max(0, t.hp / t.maxHp);
        const by = y + t.def.height + 0.45;
        this.m4.compose(this.v.set(x, by, z), camQ, this.s.set(1.0, 1, 1));
        this.hpBg.setMatrixAt(bars, this.m4);
        // Offset fill to the left edge.
        const off = new THREE.Vector3(-(1 - frac) * 0.5, 0, 0.001).applyQuaternion(camQ);
        this.m4.compose(this.v.set(x + off.x, by + off.y, z + off.z), camQ, this.s.set(frac, 1, 1));
        this.hpFill.setMatrixAt(bars, this.m4);
        this.hpFill.setColorAt(bars, this.col.set(relationBarColor(team, viewerTeam)));
        bars++;
      }
      n++;
    }
    for (const p of this.parts) {
      p.mesh.count = n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
    this.hpBg.count = bars;
    this.hpFill.count = bars;
    this.hpBg.instanceMatrix.needsUpdate = true;
    this.hpFill.instanceMatrix.needsUpdate = true;
    if (this.hpFill.instanceColor) this.hpFill.instanceColor.needsUpdate = true;
    if (this.phases.size > 600) {
      const live = new Set(troopers.map((t) => t.id));
      for (const id of this.phases.keys()) if (!live.has(id)) this.phases.delete(id);
    }
  }
}
