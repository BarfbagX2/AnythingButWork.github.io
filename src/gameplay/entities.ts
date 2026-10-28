import { emptyInput, type InputCommand, type PlayerAction } from '../core/input';
import { v3, type Vec3 } from '../core/math';
import type { AnyTeam, LaneId, StructurePlacement, TeamId } from '../world/mapTypes';
import type {
  AbilityDef,
  DamageType,
  HeroDef,
  ItemDef,
  NeutralDef,
  StatusInstance,
  StatusSpec,
  StructureDef,
  TrooperDef,
  WeaponDef,
} from './types';

export type UnitKind = 'hero' | 'trooper' | 'structure' | 'neutral' | 'boss' | 'summon';

export abstract class Unit {
  abstract readonly kind: UnitKind;
  pos: Vec3 = v3();
  prevPos: Vec3 = v3();
  vel: Vec3 = v3();
  yaw = 0;
  prevYaw = 0;
  radius = 0.45;
  height = 1.9;
  hp = 100;
  maxHp = 100;
  alive = true;
  diedAt = -1;
  spawnedAt = 0;
  /** Marked for removal from simulation lists. */
  removed = false;
  statuses: StatusInstance[] = [];
  /** Cached union of status flags, refreshed every tick. */
  flags = 0;
  bulletResist = 0;
  spiritResist = 0;
  /** Head hit sphere (crit zone). 0 radius = no crit zone. */
  headRadius = 0;
  headHeight = 0;
  lastDamagedAt = -999;
  /** Hero attacker id -> last time it dealt damage (assist attribution). */
  attackers = new Map<number, number>();
  /** Seconds the unit has been visible to each team, refreshed by vision. */
  visibleTo: [boolean, boolean] = [false, false];
  lastSeenBy: [number, number] = [-999, -999];

  constructor(
    public readonly id: number,
    public team: AnyTeam,
  ) {}

  hpFrac(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  centerY(): number {
    return this.pos.y + this.height * 0.5;
  }
}

export interface WeaponState {
  def: WeaponDef;
  ammo: number;
  magazine: number;
  reloading: boolean;
  reloadEnd: number;
  nextFire: number;
  burstLeft: number;
  nextBurst: number;
  spread: number;
  shotsFired: number;
}

export interface AbilityState {
  def: AbilityDef;
  /** 0 = locked, 1 = unlocked, 2..4 = upgrade tiers 1..3 applied. */
  level: number;
  cooldownEnd: number;
  charges: number;
  nextCharge: number;
  /** Ability-specific runtime data (e.g. toggled state). */
  data: Record<string, number>;
}

export interface CastState {
  slot: number;
  phase: 'windup' | 'channel';
  start: number;
  end: number;
  aimDir: Vec3;
  aimPoint: Vec3;
  targetId: number;
}

export interface ForcedMove {
  kind: 'dash' | 'leap' | 'knockback' | 'pull';
  vel: Vec3;
  end: number;
  /** Leaps follow a ballistic arc and end on landing. */
  ballistic: boolean;
  /** Abilities may react to touching enemies mid-dash. */
  onUnitHit?: (u: Unit) => boolean;
  onEnd?: () => void;
  hitIds: number[];
  stopOnWall: boolean;
}

export interface ZipState {
  lineIndex: number;
  /** Distance along the polyline. */
  s: number;
  dir: 1 | -1;
  attachTime: number;
}

export interface OwnedItem {
  def: ItemDef;
  cooldownEnd: number;
  procReadyAt: number;
}

export interface HeroStats {
  maxHp: number;
  hpRegen: number;
  moveSpeed: number;
  sprintSpeed: number;
  stamina: number;
  staminaCooldown: number;
  weaponDamageMul: number;
  fireRateMul: number;
  magazineMul: number;
  reloadMul: number;
  bulletResist: number;
  spiritResist: number;
  spiritPower: number;
  cooldownMul: number;
  rangeMul: number;
  durationMul: number;
  bulletLifesteal: number;
  spiritLifesteal: number;
  meleeDamageMul: number;
  headshotBonus: number;
  bulletVelocityMul: number;
  healAmp: number;
  damageTakenMul: number;
  spiritDamageMul: number;
}

export interface HeroMatchStats {
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  heroDamage: number;
  objectiveDamage: number;
  healing: number;
  soulsEarned: number;
  orbsSecured: number;
}

export class Hero extends Unit {
  readonly kind = 'hero' as const;
  pitch = 0;
  grounded = true;
  wasGrounded = true;
  crouching = false;
  sliding = false;
  slideEnd = 0;
  airJumps = 0;
  stamina = 3;
  staminaNext = 0;
  dashEnd = 0;
  dashVel = v3();
  /** Infinite ammo window granted by dash-slides (reference mechanic). */
  freeAmmoUntil = 0;
  lastGroundTime = 0;
  landedAt = 0;
  zip: ZipState | null = null;
  zipCooldownUntil = 0;
  forced: ForcedMove | null = null;
  weapon: WeaponState;
  abilities: AbilityState[];
  cast: CastState | null = null;
  meleeStart = -1;
  meleeSwingAt = -1;
  meleeHeavy = false;
  meleeNext = 0;
  parryUntil = 0;
  parryNext = 0;
  items: OwnedItem[] = [];
  souls = 0;
  netWorth = 0;
  level = 1;
  abilityPoints = 1;
  stats!: HeroStats;
  respawnAt = 0;
  lastCombatTime = -999;
  lastShotTime = -999;
  input: InputCommand = emptyInput();
  prevButtons = 0;
  actions: PlayerAction[] = [];
  aimDir: Vec3 = v3(0, 0, 1);
  eyeHeight = 1.65;
  killStreak = 0;
  inShopRange = false;
  inFountain = false;
  match: HeroMatchStats = {
    kills: 0,
    deaths: 0,
    assists: 0,
    lastHits: 0,
    denies: 0,
    heroDamage: 0,
    objectiveDamage: 0,
    healing: 0,
    soulsEarned: 0,
    orbsSecured: 0,
  };
  /** Last time a successful headshot proc'd an item. */
  procs: Record<string, number> = {};

  constructor(
    id: number,
    team: TeamId,
    public readonly def: HeroDef,
    /** Mutable: a network player can take over (and later return) a bot's hero. */
    public playerName: string,
    public isBot: boolean,
  ) {
    super(id, team);
    this.radius = 0.45;
    this.height = 1.9 * def.model.height;
    this.eyeHeight = 1.65 * def.model.height;
    this.headRadius = 0.24;
    this.headHeight = 1.72 * def.model.height;
    this.maxHp = def.base.maxHp;
    this.hp = this.maxHp;
    this.stamina = def.base.stamina;
    this.weapon = {
      def: def.weapon,
      ammo: def.weapon.magazine,
      magazine: def.weapon.magazine,
      reloading: false,
      reloadEnd: 0,
      nextFire: 0,
      burstLeft: 0,
      nextBurst: 0,
      spread: def.weapon.spread,
      shotsFired: 0,
    };
    this.abilities = def.abilities.map((a) => ({
      def: a,
      level: 0,
      cooldownEnd: 0,
      charges: a.params.charges ?? 1,
      nextCharge: 0,
      data: {},
    }));
  }

  get team0(): TeamId {
    return this.team as TeamId;
  }
}

export class Trooper extends Unit {
  readonly kind = 'trooper' as const;
  /** Index of the lane waypoint ahead (end of the current path segment). */
  pathIndex = 0;
  /** Distance travelled along the lane path (projection of the position). */
  progress = 0;
  /** Brief sideways detour used to get unstuck. */
  detourUntil = 0;
  detourX = 0;
  detourZ = 0;
  targetId = -1;
  nextAttack = 0;
  nextRetarget = 0;
  nextHeal = 0;
  stuckTime = 0;
  progressCheck = 0;
  progressPos = v3();
  /** Hero that attacked an allied hero nearby: troopers switch to it. */
  aggroHero = -1;
  aggroUntil = 0;
  buffed = false;
  attackAnim = 0;

  constructor(
    id: number,
    team: TeamId,
    public readonly def: TrooperDef,
    public readonly lane: LaneId,
    /** Lane path, already oriented for this team (index 0 = own base). */
    public readonly path: Vec3[],
  ) {
    super(id, team);
    this.radius = def.radius;
    this.height = def.height;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.headRadius = 0.2;
    this.headHeight = def.height - 0.2;
    this.bulletResist = def.bulletResist;
    this.spiritResist = def.spiritResist;
  }
}

export class Structure extends Unit {
  readonly kind = 'structure' as const;
  vulnerable = false;
  phase: 1 | 2 = 1;
  targetId = -1;
  nextAttack = 0;
  nextRetarget = 0;
  nextStomp = 0;
  nextSalvo = 0;
  /** Enemy hero that attacked an allied hero under this structure. */
  aggroHero = -1;
  aggroUntil = 0;
  backdoor = true;
  attackAnim = 0;

  constructor(
    id: number,
    team: TeamId,
    public readonly def: StructureDef,
    public readonly placement: StructurePlacement,
  ) {
    super(id, team);
    this.radius = def.radius;
    this.height = def.height;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.bulletResist = def.bulletResist;
    this.spiritResist = def.spiritResist;
    this.yaw = placement.yaw;
  }

  get key(): string {
    return this.placement.id;
  }
}

export class Neutral extends Unit {
  readonly kind: 'neutral' | 'boss';
  home: Vec3 = v3();
  targetId = -1;
  nextAttack = 0;
  leashing = false;
  attackAnim = 0;

  constructor(
    id: number,
    public readonly def: NeutralDef,
    public readonly campId: string,
    isBoss = false,
  ) {
    super(id, 2);
    this.kind = isBoss ? 'boss' : 'neutral';
    this.radius = def.radius;
    this.height = def.height;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.headRadius = isBoss ? 0 : 0.25;
    this.headHeight = def.height - 0.25;
  }
}

export type SummonBehavior = 'thrall' | 'turret' | 'decoy';

export class Summon extends Unit {
  readonly kind = 'summon' as const;
  targetId = -1;
  nextAttack = 0;
  attackAnim = 0;

  constructor(
    id: number,
    team: TeamId,
    public readonly ownerId: number,
    public readonly behavior: SummonBehavior,
    public endTime: number,
    public damage: number,
    public range: number,
    public attackInterval: number,
    public speed: number,
    public readonly visual: string,
  ) {
    super(id, team);
  }
}

export type ProjectileKind = 'bullet' | 'ability' | 'trooper' | 'structure' | 'neutral';

export class Projectile {
  pos: Vec3 = v3();
  prevPos: Vec3 = v3();
  origin: Vec3 = v3();
  vel: Vec3 = v3();
  gravity = 0;
  radius = 0.05;
  damage = 0;
  dmgType: DamageType = 'bullet';
  critMul = 1;
  falloffStart = 1e9;
  falloffEnd = 1e9;
  falloffMin = 1;
  maxDist = 100;
  traveled = 0;
  pierce = 0;
  hitIds: number[] = [];
  alive = true;
  /** Visual identifier for the renderer. */
  visual = 'tracer';
  color = '#ffd27a';
  /** Hits allies instead of enemies. */
  targetsAllies = false;
  /** Bullets from heroes can secure / deny soul orbs. */
  hitsOrbs = false;
  /** Damage multipliers by target kind (troopers/structures vs heroes). */
  vsHeroMul = 1;
  vsTrooperMul = 1;
  /** Custom resolution; when set, the default damage is skipped. */
  onHit?: (target: Unit | null, point: Vec3, normal: Vec3) => void;
  onExpire?: (point: Vec3) => void;
  status?: StatusSpec;
  splash?: { radius: number; fraction: number };
  abilityId?: string;
  bornAt = 0;

  constructor(
    public readonly id: number,
    public readonly ownerId: number,
    public readonly team: AnyTeam,
    public readonly kind: ProjectileKind,
  ) {}
}

export class SoulOrb {
  pos: Vec3 = v3();
  vel: Vec3 = v3();
  alive = true;
  readonly radius = 0.55;

  constructor(
    public readonly id: number,
    /** Team of the trooper that died; its enemies secure, its allies deny. */
    public readonly victimTeam: TeamId,
    public readonly value: number,
    public readonly spawnTime: number,
    public readonly expireTime: number,
    public readonly killerId: number,
  ) {}
}

export class Zone {
  alive = true;
  nextTick = 0;
  pos: Vec3 = v3();

  constructor(
    public readonly id: number,
    public readonly ownerId: number,
    public readonly team: AnyTeam,
    public radius: number,
    public endTime: number,
    public readonly tickInterval: number,
    public readonly onTick: (zone: Zone) => void,
    public readonly visual: string,
    public readonly color: string,
    public followUnit = -1,
  ) {}
}

export interface Pickup {
  id: number;
  kind: 'rejuvenator' | 'powerup';
  pos: Vec3;
  alive: boolean;
  spawnTime: number;
  expireTime: number;
}

export type AnyUnit = Hero | Trooper | Structure | Neutral | Summon;
