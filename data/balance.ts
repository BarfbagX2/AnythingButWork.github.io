/**
 * Global balance configuration.
 *
 * Evidence: every number here is Category C/D (our own approximation) unless
 * marked [B] (taken from public documentation of the reference game). See
 * docs/RECONSTRUCTION_NOTES.md.
 */
export const BALANCE = {
  tickRate: 60,
  gravity: 21,

  movement: {
    accelGround: 60,
    accelAir: 14,
    friction: 12,
    jumpSpeed: 7.2,
    doubleJumpSpeed: 6.6,
    stepHeight: 0.55,
    /** Highest ledge (above feet) that can be mantled while airborne. */
    mantleReach: 1.35,
    dashSpeed: 15.5,
    dashDuration: 0.2,
    dashJumpBoost: 1.35,
    slideSpeed: 10.5,
    slideDuration: 0.75,
    crouchSpeedMul: 0.5,
    /** [B] double jump / dash / air dash cost 1 stamina, dash-jump 2. */
    staminaCostDash: 1,
    staminaCostDoubleJump: 1,
    staminaCostDashJump: 2,
    /** Out-of-combat delay before sprint speed applies. */
    sprintDelay: 4,
    /** [B] dash-slides grant temporary infinite ammo. */
    dashSlideFreeAmmo: 0.75,
  },

  melee: {
    lightDamage: 55,
    heavyDamage: 120,
    lightRange: 2.6,
    heavyRange: 3.4,
    lightCooldown: 0.75,
    heavyCooldown: 1.5,
    heavyChargeTime: 0.45,
    swingDelay: 0.15,
    /** [B] Parry lasts briefly, stuns melee attackers, ~4 s cooldown. */
    parryWindow: 0.55,
    parryCooldown: 4,
    parryStun: 1.75,
    heavyMeleeTrooperMul: 1.4,
  },

  zipline: {
    speed: 17,
    attachRange: 3.2,
    /** Hero damage taken while riding knocks the rider off. [B] */
    knockOffDamage: 1,
    knockOffStun: 0.6,
    cooldownAfterDetach: 0.8,
  },

  combat: {
    outOfCombatRegenDelay: 7,
    outOfCombatRegenPct: 0.015,
    fountainHealPct: 0.12,
    assistWindow: 10,
    /** Troopers and structures deal less damage to heroes in their own fountain. */
    fountainProtection: 0.25,
  },

  economy: {
    startingSouls: 600,
    passiveSoulsPerSecond: 1.6,
    trooperSoulGrowthPerMinute: 0.035,
    /** [B] last-hit souls partially drop as an orb that must be shot. */
    orbFraction: 0.45,
    orbLifetime: 2.2,
    orbRiseSpeed: 1.6,
    /** Share of trooper souls given to nearby allies of the killer. */
    shareRange: 24,
    shareFraction: 0.5,
    heroKillBase: 260,
    heroKillNetWorthFraction: 0.035,
    heroKillStreakBonus: 80,
    assistFraction: 0.55,
    /** Souls the victim loses on death (fraction of unspent). */
    deathSoulLossFraction: 0,
    sellRefund: 0.5,
  },

  /** Cumulative souls required for each level (index = level - 1). */
  levels: [0, 450, 1000, 1650, 2400, 3250, 4200, 5300, 6500, 7850, 9300, 10900, 12650, 14550, 16600, 18800, 21200, 23800, 26600, 29600],
  /** Ability points granted on reaching each level (index = level - 1). */
  abilityPointsAtLevel: [1, 1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 2],
  ultimateMinLevel: 6,
  abilityUpgradeCost: [1, 2, 5],

  respawn: {
    base: 7,
    perLevel: 1.3,
    perMinute: 0.6,
    max: 45,
    rejuvenatorMul: 0.6,
  },

  waves: {
    /** [B] a trooper wave spawns every 30 seconds per lane. */
    interval: 30,
    firstWave: 1,
    /** [B-ish] composition: ranged troopers plus a medic. */
    composition: ['rifle', 'rifle', 'rifle', 'medic'],
    heavyEvery: 3,
    heavyAfterMinutes: 7,
    /** Super troopers in a lane once that lane's enemy base guardian falls. */
    superAfterBaseGuardian: true,
    maxPerTeam: 90,
    hpGrowthPerMinute: 0.03,
    damageGrowthPerMinute: 0.025,
  },

  structures: {
    /** Enemy troopers within this radius disable backdoor protection. [B] */
    backdoorRadius: 26,
    aggroWindow: 2.5,
  },

  items: {
    /** [B] Tier 1 = 800, Tier 2 = 1600; tiers 3-4 extrapolated. */
    tierCost: [800, 1600, 3200, 6400],
    slotsPerCategory: 3,
    flexSlotsMax: 3,
  },

  midBoss: {
    firstSpawn: 8 * 60,
    respawn: 6 * 60,
    rejuvenatorDuration: 180,
    rejuvenatorTrooperHpMul: 1.4,
    rejuvenatorFireRatePct: 15,
    teamSouls: 900,
  },

  camps: {
    firstSpawn: 90,
    respawn: 120,
  },

  match: {
    pregameSeconds: 12,
    endDelay: 6,
  },
} as const;

export type Balance = typeof BALANCE;
