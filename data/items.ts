import type { ItemDef } from '../src/gameplay/types';
import { BALANCE } from './balance';

const T = BALANCE.items.tierCost;

/**
 * Item catalogue. Categories and tier pricing follow the reference game's
 * structure ([B]); every individual item is an original design ([C]).
 */
export const ITEMS: ItemDef[] = [
  // --- Weapon (orange) -------------------------------------------------------
  { id: 'hollow-point', name: 'Hollow Point Rounds', category: 'weapon', tier: 1, cost: T[0], icon: '◉', description: '+14% weapon damage.', mods: { weaponDamagePct: 14 }, tags: ['damage', 'farm'] },
  { id: 'quick-hands', name: 'Quick Hands', category: 'weapon', tier: 1, cost: T[0], icon: '⟳', description: '+30% reload speed, +10% ammo.', mods: { reloadPct: 30, magazinePct: 10 }, tags: ['damage'] },
  { id: 'extended-drum', name: 'Extended Drum', category: 'weapon', tier: 1, cost: T[0], icon: '▥', description: '+35% ammo, +5% fire rate.', mods: { magazinePct: 35, fireRatePct: 5 }, tags: ['damage', 'farm'] },
  { id: 'point-blank', name: 'Point Blank', category: 'weapon', tier: 1, cost: T[0], icon: '⊙', description: '+25% weapon damage to targets within 12 m.', mods: { bulletResist: 4 }, passive: { kind: 'closeRange', weaponDamagePct: 25, range: 12 }, tags: ['damage'] },
  { id: 'trooper-bane', name: 'Lane Breaker', category: 'weapon', tier: 1, cost: T[0], icon: '⚔', description: '+40% damage vs troopers & neutrals, take 25% less trooper damage.', mods: { hpRegen: 1 }, passive: { kind: 'troopers', damagePct: 40, resistPct: 25 }, tags: ['farm'] },
  { id: 'rapid-fire', name: 'Rapid Fire', category: 'weapon', tier: 2, cost: T[1], icon: '≫', description: '+20% fire rate, +6% weapon damage.', mods: { fireRatePct: 20, weaponDamagePct: 6 }, tags: ['damage'] },
  { id: 'headhunter', name: 'Headhunter', category: 'weapon', tier: 2, cost: T[1], icon: '☠', description: 'Headshots deal +55 bonus damage (6 s cooldown) and +25% headshot damage.', mods: { headshotPct: 25 }, passive: { kind: 'headshotBonus', damage: 55, cooldown: 6 }, tags: ['damage', 'burst'] },
  { id: 'vampire-rounds', name: 'Vampire Rounds', category: 'weapon', tier: 2, cost: T[1], icon: '♥', description: '+18% bullet lifesteal, +6% weapon damage.', mods: { bulletLifesteal: 18, weaponDamagePct: 6 }, tags: ['sustain', 'damage'] },
  { id: 'longshot', name: 'Longshot Scope', category: 'weapon', tier: 2, cost: T[1], icon: '⌖', description: '+30% weapon damage to targets beyond 18 m, +25% bullet velocity.', mods: { bulletVelocityPct: 25 }, passive: { kind: 'longRange', weaponDamagePct: 30, range: 18 }, tags: ['damage'] },
  { id: 'frost-rounds', name: 'Frost Rounds', category: 'weapon', tier: 2, cost: T[1], icon: '❄', description: 'Bullets slow targets by 20% for 1.5 s. +8% weapon damage.', mods: { weaponDamagePct: 8 }, passive: { kind: 'bulletSlow', slowPct: 20, duration: 1.5 }, tags: ['utility', 'damage'] },
  { id: 'burst-chamber', name: 'Burst Chamber', category: 'weapon', tier: 3, cost: T[2], icon: '✸', component: 'rapid-fire', description: '+32% fire rate, +14% weapon damage.', mods: { fireRatePct: 32, weaponDamagePct: 14 }, tags: ['damage'] },
  { id: 'executioner', name: 'Executioner', category: 'weapon', tier: 3, cost: T[2], icon: '⚰', component: 'headhunter', description: 'Headshots +110 bonus damage (5 s cd), +40% headshot damage, +10% weapon damage.', mods: { headshotPct: 40, weaponDamagePct: 10 }, passive: { kind: 'headshotBonus', damage: 110, cooldown: 5 }, tags: ['damage', 'burst'] },
  { id: 'anti-heal-rounds', name: 'Grave Rounds', category: 'weapon', tier: 3, cost: T[2], icon: '✝', description: 'Bullets prevent healing for 2 s. +18% weapon damage.', mods: { weaponDamagePct: 18 }, passive: { kind: 'antiHeal', duration: 2 }, tags: ['antiheal', 'damage'] },
  { id: 'siege-breaker', name: 'Siege Breaker', category: 'weapon', tier: 4, cost: T[3], icon: '♜', component: 'burst-chamber', description: '+45% fire rate, +28% weapon damage, +20% ammo.', mods: { fireRatePct: 45, weaponDamagePct: 28, magazinePct: 20 }, tags: ['damage'] },
  { id: 'crimson-feast', name: 'Crimson Feast', category: 'weapon', tier: 4, cost: T[3], icon: '❦', component: 'vampire-rounds', description: '+32% bullet lifesteal, +22% weapon damage, +150 health.', mods: { bulletLifesteal: 32, weaponDamagePct: 22, maxHp: 150 }, tags: ['sustain', 'damage'] },

  // --- Vitality (green) --------------------------------------------------------
  { id: 'iron-lung', name: 'Iron Lung', category: 'vitality', tier: 1, cost: T[0], icon: '✚', description: '+150 max health.', mods: { maxHp: 150 }, tags: ['survival'] },
  { id: 'healing-flask', name: 'Healing Flask', category: 'vitality', tier: 1, cost: T[0], icon: '⚗', description: 'Active: heal 260 over 5 s (30 s cd). +2 health regen.', mods: { hpRegen: 2 }, active: { kind: 'heal', amount: 260, duration: 5, cooldown: 30 }, tags: ['sustain'] },
  { id: 'fleet-boots', name: 'Fleet Boots', category: 'vitality', tier: 1, cost: T[0], icon: '➶', description: '+1 m/s sprint speed, +10% stamina recovery, +60 health.', mods: { sprintSpeed: 1, staminaCooldownPct: 10, maxHp: 60 }, tags: ['mobility'] },
  { id: 'bullet-ward', name: 'Bullet Ward', category: 'vitality', tier: 1, cost: T[0], icon: '⛨', description: '+14% bullet resist.', mods: { bulletResist: 14 }, tags: ['survival'] },
  { id: 'spirit-ward', name: 'Spirit Ward', category: 'vitality', tier: 1, cost: T[0], icon: '⛉', description: '+14% spirit resist.', mods: { spiritResist: 14 }, tags: ['survival'] },
  { id: 'second-wind', name: 'Second Wind', category: 'vitality', tier: 2, cost: T[1], icon: '❥', description: 'Below 35% health regenerate 30 health/s. +125 health.', mods: { maxHp: 125 }, passive: { kind: 'lowHpRegen', threshold: 0.35, hps: 30 }, tags: ['survival', 'sustain'] },
  { id: 'extra-stamina', name: 'Endurance Coil', category: 'vitality', tier: 2, cost: T[1], icon: '⚡', description: '+1 stamina, +20% stamina recovery, +0.5 m/s move speed.', mods: { stamina: 1, staminaCooldownPct: 20, moveSpeed: 0.5 }, tags: ['mobility'] },
  { id: 'barrier', name: 'Emergency Barrier', category: 'vitality', tier: 2, cost: T[1], icon: '◈', description: 'Falling below 30% health grants a 300 shield (40 s cd). +100 health.', mods: { maxHp: 100 }, passive: { kind: 'shieldOnLow', threshold: 0.3, shield: 300, cooldown: 40 }, tags: ['survival'] },
  { id: 'blink-charm', name: 'Blink Charm', category: 'vitality', tier: 2, cost: T[1], icon: '⇢', description: 'Active: teleport 10 m in your movement direction (18 s cd).', mods: { maxHp: 75 }, active: { kind: 'blink', distance: 10, cooldown: 18 }, tags: ['mobility', 'survival'] },
  { id: 'warden-plate', name: 'Warden Plate', category: 'vitality', tier: 3, cost: T[2], icon: '⛊', component: 'bullet-ward', description: '+28% bullet resist, +200 health.', mods: { bulletResist: 28, maxHp: 200 }, tags: ['survival'] },
  { id: 'purifier', name: 'Purifier', category: 'vitality', tier: 3, cost: T[2], icon: '☼', description: 'Active: remove all debuffs and gain 25% move speed for 3 s (35 s cd). +15% spirit resist.', mods: { spiritResist: 15 }, active: { kind: 'cleanse', cooldown: 35 }, tags: ['survival', 'utility'] },
  { id: 'colossus-heart', name: 'Colossus Heart', category: 'vitality', tier: 3, cost: T[2], icon: '❤', component: 'iron-lung', description: '+400 max health, +4 health regen.', mods: { maxHp: 400, hpRegen: 4 }, tags: ['survival'] },
  { id: 'phantom-step', name: 'Phantom Step', category: 'vitality', tier: 4, cost: T[3], icon: '☁', component: 'blink-charm', description: 'Active: become untargetable for 2 s (40 s cd). +250 health, +1 m/s move speed.', mods: { maxHp: 250, moveSpeed: 1 }, active: { kind: 'untargetable', duration: 2, cooldown: 40 }, tags: ['survival', 'mobility'] },
  { id: 'unbroken', name: 'Unbroken', category: 'vitality', tier: 4, cost: T[3], icon: '✠', component: 'warden-plate', description: '+35% bullet resist, +25% spirit resist, +350 health.', mods: { bulletResist: 35, spiritResist: 25, maxHp: 350 }, tags: ['survival'] },

  // --- Spirit (purple) ---------------------------------------------------------
  { id: 'spirit-shard', name: 'Spirit Shard', category: 'spirit', tier: 1, cost: T[0], icon: '✦', description: '+14 spirit power.', mods: { spiritPower: 14 }, tags: ['spirit', 'farm'] },
  { id: 'quickened-mind', name: 'Quickened Mind', category: 'spirit', tier: 1, cost: T[0], icon: '⌛', description: '+10% cooldown reduction.', mods: { cooldownPct: 10 }, tags: ['spirit'] },
  { id: 'far-reach', name: 'Far Reach', category: 'spirit', tier: 1, cost: T[0], icon: '↗', description: '+15% ability range, +6 spirit power.', mods: { rangePct: 15, spiritPower: 6 }, tags: ['spirit'] },
  { id: 'soul-siphon', name: 'Soul Siphon', category: 'spirit', tier: 1, cost: T[0], icon: '☯', description: '+12% spirit lifesteal.', mods: { spiritLifesteal: 12 }, tags: ['sustain', 'spirit'] },
  { id: 'mystic-burn', name: 'Mystic Burn', category: 'spirit', tier: 2, cost: T[1], icon: '♨', description: 'Ability damage burns for 30 dps over 3 s. +12 spirit power.', mods: { spiritPower: 12 }, passive: { kind: 'spiritBurn', dps: 30, duration: 3 }, tags: ['spirit', 'damage'] },
  { id: 'lasting-hex', name: 'Lasting Hex', category: 'spirit', tier: 2, cost: T[1], icon: '∞', description: '+20% ability duration, +10 spirit power.', mods: { durationPct: 20, spiritPower: 10 }, tags: ['spirit', 'utility'] },
  { id: 'arcane-surge', name: 'Arcane Surge', category: 'spirit', tier: 2, cost: T[1], icon: '✺', component: 'spirit-shard', description: '+30 spirit power, +8% spirit damage.', mods: { spiritPower: 30, spiritDamagePct: 8 }, tags: ['spirit', 'burst'] },
  { id: 'hex-nova', name: 'Hex Nova', category: 'spirit', tier: 2, cost: T[1], icon: '✹', description: 'Active: 160 spirit damage around you and 30% slow (25 s cd). +8 spirit power.', mods: { spiritPower: 8 }, active: { kind: 'nova', damage: 160, radius: 7, cooldown: 25, slowPct: 30 }, tags: ['spirit', 'burst'] },
  { id: 'timewarp', name: 'Timewarp Sigil', category: 'spirit', tier: 3, cost: T[2], icon: '⧗', component: 'quickened-mind', description: '+22% cooldown reduction, +12 spirit power.', mods: { cooldownPct: 22, spiritPower: 12 }, tags: ['spirit'] },
  { id: 'eclipse-heart', name: 'Eclipse Heart', category: 'spirit', tier: 3, cost: T[2], icon: '◐', component: 'arcane-surge', description: '+60 spirit power, +12% spirit damage.', mods: { spiritPower: 60, spiritDamagePct: 12 }, tags: ['spirit', 'burst'] },
  { id: 'haste-sigil', name: 'Haste Sigil', category: 'spirit', tier: 3, cost: T[2], icon: '⇶', description: 'Active: +40% move speed for 4 s (30 s cd). +15 spirit power, +1 stamina.', mods: { spiritPower: 15, stamina: 1 }, active: { kind: 'haste', moveSpeedPct: 40, duration: 4, cooldown: 30 }, tags: ['mobility', 'spirit'] },
  { id: 'archmage', name: 'Archmage Seal', category: 'spirit', tier: 4, cost: T[3], icon: '✪', component: 'eclipse-heart', description: '+100 spirit power, +18% spirit damage, +10% cooldown reduction.', mods: { spiritPower: 100, spiritDamagePct: 18, cooldownPct: 10 }, tags: ['spirit', 'burst'] },
  { id: 'chrono-crown', name: 'Chrono Crown', category: 'spirit', tier: 4, cost: T[3], icon: '♛', component: 'timewarp', description: '+35% cooldown reduction, +30 spirit power, +25% ability duration.', mods: { cooldownPct: 35, spiritPower: 30, durationPct: 25 }, tags: ['spirit', 'utility'] },
];

export const ITEM_MAP: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
