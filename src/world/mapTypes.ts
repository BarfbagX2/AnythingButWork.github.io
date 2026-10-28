import type { Vec3 } from '../core/math';
import type { SolidDef } from './collision';

export type TeamId = 0 | 1;
export const NEUTRAL_TEAM = 2;
export type AnyTeam = TeamId | typeof NEUTRAL_TEAM;
export type LaneId = 0 | 1 | 2;

export const TEAM_NAMES: Record<TeamId, string> = { 0: 'Amber Covenant', 1: 'Azure Lodge' };

export interface LaneDef {
  id: LaneId;
  name: string;
  color: string;
  /** Path from team 0's base to team 1's base. Team 1 troopers walk it reversed. */
  path: Vec3[];
  width: number;
}

export type StructureType = 'guardian' | 'walker' | 'baseGuardian' | 'shrine' | 'patron';

export interface StructurePlacement {
  id: string;
  type: StructureType;
  team: TeamId;
  lane: LaneId | -1;
  pos: Vec3;
  yaw: number;
  /** Structure ids that must be destroyed before this one can be damaged. */
  requires: string[];
  /** If true, only one of `requires` needs to be destroyed. */
  requiresAny?: boolean;
}

export interface ZiplineDef {
  id: string;
  team: TeamId;
  lane: LaneId;
  /** Polyline of the cable (y = cable height). First point is the base end. */
  points: Vec3[];
}

export interface ShopDef {
  id: string;
  team: TeamId;
  pos: Vec3;
  radius: number;
}

export interface CampDef {
  id: string;
  tier: 1 | 2 | 3;
  pos: Vec3;
  /** Neutral unit type ids from data/neutrals. */
  units: string[];
}

export interface SpawnDef {
  pos: Vec3;
  yaw: number;
  /** Fountain: heroes inside heal quickly and can't be damaged by enemies far away. */
  healZone: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface RegionDef {
  id: string;
  kind: 'base' | 'lane' | 'jungle' | 'center' | 'camp' | 'boss';
  team?: TeamId;
  lane?: LaneId;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface MapDecor {
  lamps: { pos: Vec3; yaw: number }[];
  /** Ground paint regions (streets) for the renderer. */
  streets: { minX: number; minZ: number; maxX: number; maxZ: number; kind: 'lane' | 'street' | 'plaza' | 'base'; lane?: LaneId; team?: TeamId }[];
  /** Building lots: renderer groups solids by lot for facade variety. */
  props: { kind: 'crate' | 'barrier' | 'car' | 'planter' | 'tank' | 'antenna'; pos: Vec3; yaw: number }[];
}

export interface MapDef {
  id: string;
  name: string;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  solids: SolidDef[];
  lanes: LaneDef[];
  structures: StructurePlacement[];
  ziplines: ZiplineDef[];
  shops: ShopDef[];
  camps: CampDef[];
  spawns: Record<TeamId, SpawnDef>;
  midBoss: { pos: Vec3; radius: number };
  regions: RegionDef[];
  decor: MapDecor;
}
