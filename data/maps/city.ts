import type { Vec3 } from '../../src/core/math';
import type { SolidDef } from '../../src/world/collision';
import { buildCity, mirrorRectX, mirrorRectZ, type HeightOverride, type Rect } from '../../src/world/cityBuilder';
import type {
  CampDef,
  LaneDef,
  MapDecor,
  MapDef,
  RegionDef,
  ShopDef,
  StructurePlacement,
  TeamId,
  ZiplineDef,
} from '../../src/world/mapTypes';

/**
 * "Hexline Ward" — an original night-city lane map.
 *
 * Layout (top-down, +Z is north). Team 0 (Amber) base is south, team 1
 * (Azure) base is north; the map is mirrored across z = 0 so both teams
 * get identical geometry. Three lanes (West / Mid / East): the side lanes
 * are U-shaped streets, the middle lane is a straight, shorter avenue —
 * matching the tactical structure of the reference game's 3-lane layout.
 *
 *   +------------------ Azure base -----------------+
 *   | West lane |  jungle  | Mid |  jungle  | East   |
 *   |           |  camps   | lane|  camps   | lane   |
 *   |-----------+---- center avenue (z=0) ---+-------|
 *   |           | T3 camp  |     | mid boss |        |
 *   +------------------ Amber base -----------------+
 */

const R = (minX: number, minZ: number, maxX: number, maxZ: number): Rect => ({ minX, minZ, maxX, maxZ });
const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Rects defined for the north half (Azure side) are mirrored to the south. */
function bothHalves(rects: Rect[]): Rect[] {
  return rects.flatMap((r) => [r, mirrorRectZ(r)]);
}

function bothSides(rects: Rect[]): Rect[] {
  return rects.flatMap((r) => [r, mirrorRectX(r)]);
}

const BOUNDS = R(-104, -152, 104, 152);

// --- Open areas (streets, plazas, base interiors) ---------------------------
const LANE_MID = R(-8, -104, 8, 104);
const LANE_WEST_V = R(-84, -118, -68, 118);
const LANE_EAST_V = mirrorRectX(LANE_WEST_V);
const LANE_WEST_H_N = R(-84, 102, -30, 118);
const LANE_EAST_H_N = mirrorRectX(LANE_WEST_H_N);
const BASE_N = R(-30, 100, 30, 150);
const CENTER_AVE = R(-84, -6, 84, 6);
const AVE_WEST = R(-42, -102, -34, 102);
const AVE_EAST = mirrorRectX(AVE_WEST);
const J1_N = R(-68, 28, -8, 36);
const J2_N = R(-68, 60, -8, 68);
const T1_PLAZA_N = R(-30, 76, -18, 88);
const T1_CONN_N = R(-26, 68, -22, 76);
const T2_PLAZA_N = R(-62, 40, -50, 52);
const T2_CONN_N = R(-58, 36, -54, 60);
const T3_PLAZA = R(-54, -12, -22, 12);
const BOSS_PLAZA = R(24, -14, 52, 14);
const RAMP_YARD_N = R(-34, 40, -20, 52);

const openNorth: Rect[] = [
  LANE_WEST_H_N,
  LANE_EAST_H_N,
  BASE_N,
  ...bothSides([J1_N, J2_N, T1_PLAZA_N, T1_CONN_N, T2_PLAZA_N, T2_CONN_N, RAMP_YARD_N]),
];

const open: Rect[] = [
  LANE_MID,
  LANE_WEST_V,
  LANE_EAST_V,
  CENTER_AVE,
  AVE_WEST,
  AVE_EAST,
  T3_PLAZA,
  BOSS_PLAZA,
  ...bothHalves(openNorth),
];

// --- Fixed-height lots (high ground) ------------------------------------------
const ROOF_H = 5.5;
const PERCH_H = 3.5;
const overridesNorth: HeightOverride[] = [
  // Mid-lane rooftops joined by a bridge.
  { ...R(-20, 40, -8, 56), height: ROOF_H, style: 6 },
  { ...R(8, 40, 20, 56), height: ROOF_H, style: 6 },
  // Low perches beside the side lanes (double-jump + mantle).
  { ...R(-68, 12, -60, 24), height: PERCH_H, style: 7 },
  { ...R(-92, 40, -84, 52), height: PERCH_H, style: 7 },
  { ...R(60, 12, 68, 24), height: PERCH_H, style: 7 },
  { ...R(84, 40, 92, 52), height: PERCH_H, style: 7 },
  // Low storefronts around the T2 plazas.
  { ...R(-50, 44, -46, 48), height: PERCH_H, style: 7 },
  { ...R(46, 44, 50, 48), height: PERCH_H, style: 7 },
];
const overrides: HeightOverride[] = overridesNorth.flatMap((o) => [o, { ...mirrorRectZ(o), height: o.height, style: o.style }]);

// --- Explicit solids --------------------------------------------------------
function ramp(min: Vec3, max: Vec3, axis: 'x' | 'z', dir: 1 | -1): SolidDef {
  return { kind: 'ramp', min, max, axis, dir, material: 'concrete' };
}
function box(min: Vec3, max: Vec3, material: string, extra: Partial<SolidDef> = {}): SolidDef {
  return { kind: 'box', min, max, material, ...extra };
}
function mirrorSolidZ(s: SolidDef): SolidDef {
  const m: SolidDef = { ...s, min: { x: s.min.x, y: s.min.y, z: -s.max.z }, max: { x: s.max.x, y: s.max.y, z: -s.min.z } };
  if (s.kind === 'ramp' && s.axis === 'z') m.dir = (s.dir === 1 ? -1 : 1) as 1 | -1;
  return m;
}

const explicitNorth: SolidDef[] = [
  // Ramp from the courtyard up to the mid-lane rooftop (rises toward +x).
  ramp(P(-32, 0, 44), P(-20, ROOF_H, 48), 'x', 1),
  ramp(P(20, 0, 44), P(32, ROOF_H, 48), 'x', -1),
  // Bridge over the mid lane.
  box(P(-8, ROOF_H - 0.5, 46), P(8, ROOF_H, 50), 'bridge'),
];
const explicitSolids: SolidDef[] = explicitNorth.flatMap((s) => [s, mirrorSolidZ(s)]);

// Lane cover (barricades, crates, wrecked cars).
const props: MapDecor['props'] = [];
function cover(kind: MapDecor['props'][number]['kind'], x: number, z: number, yaw: number): void {
  const dims: Record<string, [number, number, number]> = {
    barrier: [3.2, 1.1, 0.8],
    crate: [1.5, 1.5, 1.5],
    car: [4.2, 1.5, 2.0],
    planter: [2.4, 0.9, 2.4],
    tank: [2.6, 2.6, 2.6],
  };
  const d = dims[kind];
  if (!d) return;
  const swap = Math.abs(Math.sin(yaw)) > 0.7;
  const hx = (swap ? d[2] : d[0]) / 2;
  const hz = (swap ? d[0] : d[2]) / 2;
  for (const zs of [1, -1]) {
    const zz = z * zs;
    props.push({ kind, pos: P(x, 0, zz), yaw });
    explicitSolids.push(box(P(x - hx, 0, zz - hz), P(x + hx, d[1], zz + hz), `prop:${kind}`));
  }
}
// Mid lane.
cover('barrier', -4.5, 16, 0);
cover('crate', 5, 22, 0);
cover('car', 4.5, 50, Math.PI / 2);
cover('barrier', -4.5, 84, 0);
cover('crate', -5, 58, 0);
// West lane.
cover('barrier', -72.5, 14, 0);
cover('car', -79.5, 44, Math.PI / 2);
cover('crate', -72, 58, 0);
cover('barrier', -79.5, 88, 0);
cover('planter', -60, 110, 0);
// East lane.
cover('barrier', 72.5, 14, 0);
cover('car', 79.5, 44, Math.PI / 2);
cover('crate', 72, 58, 0);
cover('barrier', 79.5, 88, 0);
cover('planter', 60, 110, 0);
// Jungle.
cover('crate', -38, 30, 0);
cover('crate', 38, 64, 0);
cover('tank', -38, 70, 0);
cover('tank', 38, 22, 0);
cover('barrier', -24, 32, 0);
cover('barrier', 24, 64, 0);

// Boundary walls (invisible, very tall) so nothing leaves the map.
const bw = 2;
explicitSolids.push(
  box(P(BOUNDS.minX - bw, 0, BOUNDS.minZ - bw), P(BOUNDS.maxX + bw, 200, BOUNDS.minZ), 'boundary', { invisible: true }),
  box(P(BOUNDS.minX - bw, 0, BOUNDS.maxZ), P(BOUNDS.maxX + bw, 200, BOUNDS.maxZ + bw), 'boundary', { invisible: true }),
  box(P(BOUNDS.minX - bw, 0, BOUNDS.minZ), P(BOUNDS.minX, 200, BOUNDS.maxZ), 'boundary', { invisible: true }),
  box(P(BOUNDS.maxX, 0, BOUNDS.minZ), P(BOUNDS.maxX + bw, 200, BOUNDS.maxZ), 'boundary', { invisible: true }),
);

// --- Lanes ---------------------------------------------------------------------
const westPath: Vec3[] = [P(-4, 0, -128), P(-16, 0, -118), P(-30, 0, -110), P(-76, 0, -110), P(-76, 0, 110), P(-30, 0, 110), P(-16, 0, 118), P(-4, 0, 128)];
const midPath: Vec3[] = [P(0, 0, -126), P(0, 0, -100), P(0, 0, 100), P(0, 0, 126)];
const eastPath: Vec3[] = westPath.map((p) => P(-p.x, 0, p.z));

const lanes: LaneDef[] = [
  { id: 0, name: 'West Lane', color: '#e8c24a', path: westPath, width: 16 },
  { id: 1, name: 'Mid Lane', color: '#5fd38d', path: midPath, width: 16 },
  { id: 2, name: 'East Lane', color: '#b07cf0', path: eastPath, width: 16 },
];

// --- Structures --------------------------------------------------------------
function structuresFor(team: TeamId): StructurePlacement[] {
  const s = team === 1 ? 1 : -1; // z sign
  const yaw = team === 1 ? Math.PI : 0; // face the enemy
  const t = team === 1 ? 'b' : 'a';
  const list: StructurePlacement[] = [
    { id: `${t}-guardian-0`, type: 'guardian', team, lane: 0, pos: P(-71.5, 0, 26 * s), yaw, requires: [] },
    { id: `${t}-guardian-1`, type: 'guardian', team, lane: 1, pos: P(4.5, 0, 30 * s), yaw, requires: [] },
    { id: `${t}-guardian-2`, type: 'guardian', team, lane: 2, pos: P(71.5, 0, 26 * s), yaw, requires: [] },
    { id: `${t}-walker-0`, type: 'walker', team, lane: 0, pos: P(-80, 0, 70 * s), yaw, requires: [`${t}-guardian-0`] },
    { id: `${t}-walker-1`, type: 'walker', team, lane: 1, pos: P(-4, 0, 68 * s), yaw, requires: [`${t}-guardian-1`] },
    { id: `${t}-walker-2`, type: 'walker', team, lane: 2, pos: P(80, 0, 70 * s), yaw, requires: [`${t}-guardian-2`] },
    { id: `${t}-baseGuardian-0`, type: 'baseGuardian', team, lane: 0, pos: P(-40, 0, 114.5 * s), yaw, requires: [`${t}-walker-0`] },
    { id: `${t}-baseGuardian-1`, type: 'baseGuardian', team, lane: 1, pos: P(4.5, 0, 95 * s), yaw, requires: [`${t}-walker-1`] },
    { id: `${t}-baseGuardian-2`, type: 'baseGuardian', team, lane: 2, pos: P(40, 0, 114.5 * s), yaw, requires: [`${t}-walker-2`] },
    {
      id: `${t}-shrine-0`, type: 'shrine', team, lane: -1, pos: P(-14, 0, 122 * s), yaw,
      requires: [`${t}-baseGuardian-0`, `${t}-baseGuardian-1`, `${t}-baseGuardian-2`], requiresAny: true,
    },
    {
      id: `${t}-shrine-1`, type: 'shrine', team, lane: -1, pos: P(14, 0, 122 * s), yaw,
      requires: [`${t}-baseGuardian-0`, `${t}-baseGuardian-1`, `${t}-baseGuardian-2`], requiresAny: true,
    },
    { id: `${t}-patron`, type: 'patron', team, lane: -1, pos: P(0, 0, 134 * s), yaw, requires: [`${t}-shrine-0`, `${t}-shrine-1`] },
  ];
  return list;
}
const structures = [...structuresFor(0), ...structuresFor(1)];

// Pedestals under structures (remain as rubble after destruction).
const pedestal: Record<string, number> = { guardian: 1.4, walker: 2.0, baseGuardian: 1.6, shrine: 1.8, patron: 3.2 };
for (const st of structures) {
  const h = pedestal[st.type];
  const hh = st.type === 'patron' ? 0.8 : 0.6;
  explicitSolids.push(box(P(st.pos.x - h, 0, st.pos.z - h), P(st.pos.x + h, hh, st.pos.z + h), 'pedestal'));
}

// --- Ziplines (team-owned, base gate -> forward guardian) ---------------------
function ziplinesFor(team: TeamId): ZiplineDef[] {
  const s = team === 1 ? 1 : -1;
  const t = team === 1 ? 'b' : 'a';
  const H = 9;
  return [
    { id: `${t}-zip-0`, team, lane: 0, points: [P(-28, H, 114 * s), P(-81, H, 114 * s), P(-81, H, 36 * s)] },
    { id: `${t}-zip-1`, team, lane: 1, points: [P(5.5, H, 114 * s), P(5.5, H, 38 * s)] },
    { id: `${t}-zip-2`, team, lane: 2, points: [P(28, H, 114 * s), P(81, H, 114 * s), P(81, H, 36 * s)] },
  ];
}
const ziplines = [...ziplinesFor(0), ...ziplinesFor(1)];

// --- Shops, camps, spawns -------------------------------------------------------
const shops: ShopDef[] = [];
for (const team of [0, 1] as TeamId[]) {
  const s = team === 1 ? 1 : -1;
  const t = team === 1 ? 'b' : 'a';
  shops.push({ id: `${t}-shop-base`, team, pos: P(-9, 0, 144 * s), radius: 7 });
  shops.push({ id: `${t}-shop-west`, team, pos: P(-38, 0, 90 * s), radius: 6 });
  shops.push({ id: `${t}-shop-east`, team, pos: P(38, 0, 90 * s), radius: 6 });
}

const camps: CampDef[] = [];
for (const s of [1, -1]) {
  const t = s === 1 ? 'n' : 's';
  camps.push({ id: `${t}-t1-w`, tier: 1, pos: P(-24, 0, 82 * s), units: ['husk', 'husk'] });
  camps.push({ id: `${t}-t1-e`, tier: 1, pos: P(24, 0, 82 * s), units: ['husk', 'husk'] });
  camps.push({ id: `${t}-t2-w`, tier: 2, pos: P(-56, 0, 46 * s), units: ['ghoul', 'husk', 'husk'] });
  camps.push({ id: `${t}-t2-e`, tier: 2, pos: P(56, 0, 46 * s), units: ['ghoul', 'husk', 'husk'] });
}
camps.push({ id: 'c-t3-w', tier: 3, pos: P(-38, 0, 0), units: ['brute', 'ghoul', 'ghoul'] });

const spawns: MapDef['spawns'] = {
  0: { pos: P(0, 0, -145), yaw: 0, healZone: R(-22, -152, 22, -138) },
  1: { pos: P(0, 0, 145), yaw: Math.PI, healZone: R(-22, 138, 22, 152) },
};

// --- Regions for AI reasoning ---------------------------------------------------
const regions: RegionDef[] = [
  { id: 'base-0', kind: 'base', team: 0, ...mirrorRectZ(BASE_N) },
  { id: 'base-1', kind: 'base', team: 1, ...BASE_N },
  { id: 'lane-0', kind: 'lane', lane: 0, ...LANE_WEST_V },
  { id: 'lane-1', kind: 'lane', lane: 1, ...LANE_MID },
  { id: 'lane-2', kind: 'lane', lane: 2, ...LANE_EAST_V },
  { id: 'boss', kind: 'boss', ...BOSS_PLAZA },
  { id: 'center', kind: 'center', ...CENTER_AVE },
];

// --- Decor ------------------------------------------------------------------------
const lamps: MapDecor['lamps'] = [];
for (let z = -96; z <= 96; z += 16) {
  lamps.push({ pos: P(-9.2, 0, z + 8), yaw: Math.PI / 2 });
  lamps.push({ pos: P(9.2, 0, z), yaw: -Math.PI / 2 });
}
for (let z = -112; z <= 112; z += 16) {
  for (const x of [-85.2, 67.0 + 18.2]) lamps.push({ pos: P(x, 0, z), yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2 });
  lamps.push({ pos: P(-66.8, 0, z + 8), yaw: -Math.PI / 2 });
  lamps.push({ pos: P(66.8, 0, z + 8), yaw: Math.PI / 2 });
}
for (let x = -60; x <= 60; x += 20) {
  if (Math.abs(x) < 12) continue;
  lamps.push({ pos: P(x, 0, 6.8), yaw: Math.PI });
  lamps.push({ pos: P(x + 10, 0, -6.8), yaw: 0 });
}

const streets: MapDecor['streets'] = [
  { ...LANE_MID, kind: 'lane', lane: 1 },
  { ...LANE_WEST_V, kind: 'lane', lane: 0 },
  { ...LANE_EAST_V, kind: 'lane', lane: 2 },
  { ...LANE_WEST_H_N, kind: 'lane', lane: 0 },
  { ...mirrorRectZ(LANE_WEST_H_N), kind: 'lane', lane: 0 },
  { ...LANE_EAST_H_N, kind: 'lane', lane: 2 },
  { ...mirrorRectZ(LANE_EAST_H_N), kind: 'lane', lane: 2 },
  { ...BASE_N, kind: 'base', team: 1 },
  { ...mirrorRectZ(BASE_N), kind: 'base', team: 0 },
  { ...CENTER_AVE, kind: 'street' },
  { ...AVE_WEST, kind: 'street' },
  { ...AVE_EAST, kind: 'street' },
  { ...T3_PLAZA, kind: 'plaza' },
  { ...BOSS_PLAZA, kind: 'plaza' },
  ...bothHalves(bothSides([J1_N, J2_N, T1_CONN_N, T2_CONN_N, RAMP_YARD_N])).map((r) => ({ ...r, kind: 'street' as const })),
  ...bothHalves(bothSides([T1_PLAZA_N, T2_PLAZA_N])).map((r) => ({ ...r, kind: 'plaza' as const })),
];

export function buildHexlineWard(): MapDef {
  const city = buildCity({
    bounds: BOUNDS,
    cell: 4,
    lot: 12,
    open,
    overrides,
    perimeterHeight: 30,
    perimeterBand: 8,
    seed: 'hexline-ward',
    mirrorZ: true,
  });
  return {
    id: 'hexline-ward',
    name: 'Hexline Ward',
    bounds: BOUNDS,
    solids: [...city.solids, ...explicitSolids],
    lanes,
    structures,
    ziplines,
    shops,
    camps,
    spawns,
    midBoss: { pos: P(38, 0, 0), radius: 14 },
    regions,
    decor: { lamps, streets, props },
  };
}
