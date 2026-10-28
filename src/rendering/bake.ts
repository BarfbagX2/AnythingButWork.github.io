import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction for procedurally assembled models: the direct child
 * meshes of each joint are merged into one vertex-coloured mesh per material
 * class (matte, metal, glow). Joint hierarchies (and therefore procedural
 * animation) are untouched.
 */

export interface BakeResult {
  materials: THREE.Material[];
  standard: THREE.MeshStandardMaterial[];
}

type Bucket = 'matte' | 'metal' | 'glow';

function classify(m: THREE.Material): Bucket | null {
  if (m instanceof THREE.MeshBasicMaterial) return m.transparent || m.map ? null : 'glow';
  if (m instanceof THREE.MeshStandardMaterial) {
    // Textured / emissive-mapped surfaces can't be represented by vertex colours.
    if (m.map || m.emissiveMap || m.transparent) return null;
    return m.metalness > 0.45 ? 'metal' : 'matte';
  }
  return null;
}

function colorOf(m: THREE.Material): THREE.Color {
  return (m as THREE.MeshStandardMaterial).color ?? new THREE.Color('#fff');
}

function prepare(mesh: THREE.Mesh): THREE.BufferGeometry {
  let g = mesh.geometry.clone();
  if (g.index) g = g.toNonIndexed();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  mesh.updateMatrix();
  g.applyMatrix4(mesh.matrix);
  const c = colorOf(mesh.material as THREE.Material);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Recursively bakes every joint under `root`, skipping objects in `keep`. */
export function bakeHierarchy(root: THREE.Object3D, keep: Set<THREE.Object3D>, castShadow: boolean, shared?: Partial<Record<Bucket, THREE.Material>>): BakeResult {
  const made: Partial<Record<Bucket, THREE.Material>> = { ...shared };
  const getMat = (b: Bucket): THREE.Material => {
    if (made[b]) return made[b]!;
    const m =
      b === 'glow'
        ? new THREE.MeshBasicMaterial({ vertexColors: true })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: b === 'metal' ? 0.35 : 0.75, metalness: b === 'metal' ? 0.8 : 0.08 });
    made[b] = m;
    return m;
  };
  const visit = (node: THREE.Object3D) => {
    const buckets = new Map<Bucket, THREE.Mesh[]>();
    for (const c of [...node.children]) {
      if (keep.has(c)) continue;
      if (c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh) && c.children.length === 0 && !Array.isArray(c.material)) {
        const b = classify(c.material as THREE.Material);
        const side = (c.material as THREE.Material).side;
        if (!b || side !== THREE.FrontSide) continue;
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b)!.push(c);
      }
    }
    for (const [b, meshes] of buckets) {
      if (meshes.length < 2) continue;
      const merged = mergeGeometries(meshes.map(prepare), false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      for (const m of meshes) node.remove(m);
      const mesh = new THREE.Mesh(merged, getMat(b));
      mesh.castShadow = castShadow && b !== 'glow';
      node.add(mesh);
    }
    for (const c of node.children) if (!keep.has(c) && c.children.length) visit(c);
  };
  visit(root);
  const materials = Object.values(made) as THREE.Material[];
  return { materials, standard: materials.filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial) };
}
