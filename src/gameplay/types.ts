import type { Vec3 } from '../core/math';
import type { AbilityContext } from './abilities';

export type DamageType = 'bullet' | 'spirit' | 'melee' | 'pure';

/**
 * Additive stat modifiers. Percent values are whole numbers (12 = +12%).
 * Resistances stack multiplicatively (diminishing returns); everything else
 * is additive. Stats are always re-derived from base + level + items +
 * statuses, never accumulated in place.
 */
export interface StatMods {
  maxHp?: number;
  maxHpPct?: number;
  hpRegen?: number;
  moveSpeed?: number;
  moveSpeedPct?: number;
  sprintSpeed?: number;
  stamina?: number;
  staminaCooldownPct?: number;
  weaponDamagePct?: number;
  fireRatePct?: number;
  magazinePct?: number;
  reloadPct?: number;
  bulletResist?: number;
  spiritResist?: number;
  spiritPower?: number;
  cooldownPct?: number;
  rangePct?: number;
  durationPct?: number;
  bulletLifesteal?: number;
  spiritLifesteal?: number;
  meleeDamagePct?: number;
  headshotPct?: number;
  bulletVelocityPct?: number;
  healAmpPct?: number;
  damageTakenPct?: number;
  spiritDamagePct?: number;
}

export type StatKey = keyof StatMods;

export const STAT_LABELS: Record<StatKey, string> = {
  maxHp: 'Max Health',
  maxHpPct: '% Max Health',
  hpRegen: 'Health Regen /s',
  moveSpeed: 'Move Speed (m/s)',
  moveSpeedPct: '% Move Speed',
  sprintSpeed: 'Sprint Speed (m/s)',
  stamina: 'Stamina',
  staminaCooldownPct: '% Stamina Recovery',
  weaponDamagePct: '% Weapon Damage',
  fireRatePct: '% Fire Rate',
  magazinePct: '% Ammo',
  reloadPct: '% Reload Speed',
  bulletResist: '% Bullet Resist',
  spiritResist: '% Spirit Resist',
  spiritPower: 'Spirit Power',
  cooldownPct: '% Cooldown Reduction',
  rangePct: '% Ability Range',
  durationPct: '% Ability Duration',
  bulletLifesteal: '% Bullet Lifesteal',
  spiritLifesteal: '% Spirit Lifesteal',
  meleeDamagePct: '% Melee Damage',
  headshotPct: '% Headshot Damage',
  bulletVelocityPct: '% Bullet Velocity',
  healAmpPct: '% Healing Received',
  damageTakenPct: '% Damage Taken',
  spiritDamagePct: '% Spirit Damage',
};

/** Status flags (bitmask). */
export const SF = {
  STUN: 1,
  ROOT: 2,
  SILENCE: 4,
  DISARM: 8,
  INVISIBLE: 16,
  REVEALED: 32,
  INVULNERABLE: 64,
  UNSTOPPABLE: 128,
  NO_HEAL: 256,
  SLOW_IMMUNE: 512,
} as const;

/** A fully-resolved status application (numbers already scaled). */
export interface StatusSpec {
  id: string;
  name: string;
  duration: number;
  /** refresh: reset duration; stack: add stack (up to maxStacks); */
  stacking?: 'refresh' | 'stack';
  maxStacks?: number;
  flags?: number;
  /** Stat mods applied per stack. */
  mods?: StatMods;
  /** Damage per second while active. */
  dps?: number;
  dotType?: DamageType;
  /** Healing per second while active. */
  hps?: number;
  /** Damage absorbed before health. */
  shield?: number;
  shieldType?: 'bullet' | 'spirit' | 'any';
  debuff: boolean;
  /** Removed when the unit fires, melees, or casts (stealth). */
  breakOnAttack?: boolean;
  /** Renderer hint. */
  vfx?: string;
}

export interface StatusInstance {
  spec: StatusSpec;
  sourceId: number;
  startTime: number;
  endTime: number;
  stacks: number;
  shieldLeft: number;
  dotAccum: number;
  abilityId?: string;
}

export type FireMode = 'auto' | 'semi' | 'burst';

export interface WeaponDef {
  id: string;
  name: string;
  /** Renderer model hint. */
  style: 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'cannon' | 'revolver' | 'lever' | 'staff';
  fireMode: FireMode;
  damage: number;
  pellets: number;
  /** Seconds between shots (between bursts for burst weapons). */
  fireInterval: number;
  burstCount?: number;
  burstInterval?: number;
  magazine: number;
  reloadTime: number;
  /** Base cone half-angle in radians. */
  spread: number;
  spreadMoving: number;
  spreadPerShot: number;
  spreadMax: number;
  spreadRecovery: number;
  falloffStart: number;
  falloffEnd: number;
  /** Damage fraction at falloffEnd and beyond. */
  falloffMin: number;
  range: number;
  critMul: number;
  projectileSpeed: number;
  gravity: number;
  projectileRadius: number;
  /** Visual recoil (degrees of camera kick). */
  recoil: number;
  splash?: { radius: number; fraction: number };
  onHitStatus?: StatusSpec;
  tracer: string;
  sound: 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'cannon' | 'sniper' | 'energy';
}

export type AbilityTargeting = 'self' | 'direction' | 'ground' | 'enemy' | 'ally';

export interface AbilityUpgrade {
  text: string;
  /** Added to params (use negative values to reduce, e.g. cooldown: -6). */
  mods: Record<string, number>;
}

export type AbilityAIKind =
  | 'damage'
  | 'cc'
  | 'escape'
  | 'engage'
  | 'heal'
  | 'shield'
  | 'buff'
  | 'summon'
  | 'zone'
  | 'finisher';

export interface AbilityAIHint {
  kind: AbilityAIKind;
  /** Consider using when the chosen target is within [minRange, maxRange]. */
  maxRange: number;
  minRange?: number;
  /** AoE radius around the aim point used to count targets. */
  aoeRadius?: number;
  /** Minimum number of enemy units (any) in the AoE to be worth it. */
  minTargets?: number;
  /** Requires an enemy hero target (won't waste on troopers). */
  heroOnly?: boolean;
  /** Use on trooper waves for farming. */
  farm?: boolean;
  /** Use when own HP fraction is below this. */
  selfHpBelow?: number;
  /** Use when an ally hero's HP fraction is below this. */
  allyHpBelow?: number;
  /** Use when the target's HP fraction is below this. */
  targetHpBelow?: number;
  /** Projectile speed for lead calculation (0 = instant). */
  projectileSpeed?: number;
  /** Aim at the ground near target rather than the body. */
  aimGround?: boolean;
}

export interface AbilityDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  slot: 1 | 2 | 3 | 4;
  ultimate: boolean;
  targeting: AbilityTargeting;
  /** Base params. Reserved keys: cooldown, range, castTime, channel, charges. */
  params: Record<string, number>;
  upgrades: [AbilityUpgrade, AbilityUpgrade, AbilityUpgrade];
  ai: AbilityAIHint;
  color: string;
  /** Movement allowed during windup/channel (multiplier). */
  castMoveMul?: number;
  /** Executes the ability. Return false to cancel (no cooldown spent). */
  cast: (ctx: AbilityContext) => boolean | void;
  /** Called every tick while channelling. */
  channelTick?: (ctx: AbilityContext, dt: number) => void;
  /** Called when the channel ends (completed or interrupted). */
  channelEnd?: (ctx: AbilityContext, interrupted: boolean) => void;
}

export interface HeroModelDesc {
  build: 'slim' | 'average' | 'heavy' | 'hulking' | 'small';
  height: number;
  headwear: 'none' | 'fedora' | 'hood' | 'tophat' | 'helmet' | 'bowler' | 'crown' | 'goggles' | 'horns';
  coat: 'none' | 'trench' | 'vest' | 'robe' | 'armor' | 'cape';
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  glow: string;
}

export type HeroRole = 'Initiator' | 'Bruiser' | 'Marksman' | 'Assassin' | 'Controller' | 'Support' | 'Summoner' | 'Specialist';

export interface HeroAIProfile {
  preferredRange: number;
  /** 0..1 how readily it takes fights. */
  aggression: number;
  /** Order of abilities to unlock/upgrade by slot. */
  skillOrder: (1 | 2 | 3 | 4)[];
  /** Item ids in rough purchase order. */
  build: string[];
  /** Personality used when none is configured. */
  defaultPersonality: string;
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  role: HeroRole;
  description: string;
  difficulty: 1 | 2 | 3;
  model: HeroModelDesc;
  base: {
    maxHp: number;
    hpRegen: number;
    moveSpeed: number;
    sprintSpeed: number;
    stamina: number;
    bulletResist: number;
    spiritResist: number;
  };
  growth: { maxHp: number; weaponDamagePct: number; spiritPower: number };
  weapon: WeaponDef;
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef];
  ai: HeroAIProfile;
}

export type ItemCategory = 'weapon' | 'vitality' | 'spirit';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  tier: 1 | 2 | 3 | 4;
  cost: number;
  description: string;
  icon: string;
  mods: StatMods;
  /** Item id this upgrades from (component). Its cost is credited. */
  component?: string;
  /** Conditional / proc behaviours handled by the item system. */
  passive?: ItemPassive;
  active?: ItemActive;
  /** Bot build heuristics. */
  tags: ('damage' | 'survival' | 'mobility' | 'spirit' | 'sustain' | 'utility' | 'antiheal' | 'burst' | 'farm')[];
}

export type ItemPassive =
  | { kind: 'headshotBonus'; damage: number; cooldown: number }
  | { kind: 'closeRange'; weaponDamagePct: number; range: number }
  | { kind: 'longRange'; weaponDamagePct: number; range: number }
  | { kind: 'lowHpRegen'; threshold: number; hps: number }
  | { kind: 'spiritBurn'; dps: number; duration: number }
  | { kind: 'bulletSlow'; slowPct: number; duration: number }
  | { kind: 'troopers'; damagePct: number; resistPct: number }
  | { kind: 'shieldOnLow'; threshold: number; shield: number; cooldown: number }
  | { kind: 'antiHeal'; duration: number }
  | { kind: 'onKillHeal'; heal: number };

export type ItemActive =
  | { kind: 'heal'; amount: number; duration: number; cooldown: number }
  | { kind: 'blink'; distance: number; cooldown: number }
  | { kind: 'shield'; amount: number; duration: number; cooldown: number }
  | { kind: 'cleanse'; cooldown: number }
  | { kind: 'haste'; moveSpeedPct: number; duration: number; cooldown: number }
  | { kind: 'nova'; damage: number; radius: number; cooldown: number; slowPct: number }
  | { kind: 'untargetable'; duration: number; cooldown: number };

export interface TrooperDef {
  id: string;
  name: string;
  maxHp: number;
  speed: number;
  radius: number;
  height: number;
  range: number;
  damage: number;
  /** Multiplier applied when attacking heroes. */
  heroDamageMul: number;
  attackInterval: number;
  projectileSpeed: number;
  melee: boolean;
  heals?: { amount: number; interval: number; range: number };
  souls: number;
  bulletResist: number;
  spiritResist: number;
}

export interface NeutralDef {
  id: string;
  name: string;
  maxHp: number;
  speed: number;
  radius: number;
  height: number;
  range: number;
  damage: number;
  attackInterval: number;
  melee: boolean;
  souls: number;
  leash: number;
}

export interface StructureDef {
  type: string;
  name: string;
  maxHp: number;
  radius: number;
  height: number;
  range: number;
  damage: number;
  heroDamageMul: number;
  /** Multiplier when attacking troopers/summons (low so waves can tank). */
  trooperDamageMul?: number;
  attackInterval: number;
  /** Fraction of damage blocked while no enemy troopers are near. */
  backdoorReduction: number;
  backdoorRegenPct: number;
  teamSouls: number;
  flexSlot: boolean;
  bulletResist: number;
  spiritResist: number;
  /** Walker AoE stomp. */
  stomp?: { radius: number; damage: number; interval: number };
  /** Delayed artillery at hero positions. */
  salvo?: { radius: number; damage: number; interval: number; delay: number; range: number };
}

export interface PathPoint extends Vec3 {}
