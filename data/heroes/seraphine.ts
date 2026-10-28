import type { HeroDef } from '../../src/gameplay/types';
import { centerOf, weapon } from './common';

/** Seraphine Ash — support. Original character. */
export const SERAPHINE: HeroDef = {
  id: 'seraphine',
  name: 'Seraphine Ash',
  title: 'The Lantern Sister',
  role: 'Support',
  description: 'A night-watch nun whose lantern mends wounds, wards allies and sanctifies the ground they fight on.',
  difficulty: 1,
  model: { build: 'small', height: 0.95, headwear: 'hood', coat: 'robe', primary: '#e8e2d0', secondary: '#7a6a4f', accent: '#ffe08a', skin: '#f0c9a8', glow: '#fff1a8' },
  base: { maxHp: 540, hpRegen: 3, moveSpeed: 7.0, sprintSpeed: 2, stamina: 3, bulletResist: 0, spiritResist: 0.05 },
  growth: { maxHp: 30, weaponDamagePct: 2.8, spiritPower: 3.2 },
  weapon: weapon({
    id: 'votive',
    name: 'Votive (auto rifle)',
    style: 'rifle',
    damage: 13,
    fireInterval: 0.115,
    magazine: 28,
    reloadTime: 2.1,
    spread: 0.014,
    spreadMoving: 0.02,
    spreadPerShot: 0.0025,
    spreadMax: 0.045,
    falloffStart: 20,
    falloffEnd: 45,
    falloffMin: 0.5,
    range: 80,
    critMul: 1.6,
    projectileSpeed: 240,
    recoil: 0.9,
    tracer: 'holy',
    sound: 'rifle',
  }),
  abilities: [
    {
      id: 'sera-mend',
      name: 'Mending Light',
      icon: '✚',
      slot: 1,
      ultimate: false,
      description: 'Heal an ally (or yourself) for {heal} instantly plus {hot} over 3s.',
      targeting: 'ally',
      params: { cooldown: 11, range: 30, heal: 110, healScale: 1.1, hot: 80, hotScale: 0.5 },
      upgrades: [
        { text: '+70 instant heal', mods: { heal: 70 } },
        { text: '-3s cooldown', mods: { cooldown: -3 } },
        { text: 'Also grants +20% move speed for 3s', mods: { haste: 20 } },
      ],
      ai: { kind: 'heal', maxRange: 28, allyHpBelow: 0.6, selfHpBelow: 0.45 },
      color: '#fff1a8',
      cast: (c) => {
        const t = c.target ?? c.hero;
        c.heal(t, c.scaled('heal'));
        c.status(t, { id: 'mend-hot', name: 'Mending', duration: 3, hps: c.scaled('hot') / 3, debuff: false, vfx: 'heal' });
        if (c.p('haste') > 0) c.status(t, { id: 'mend-haste', name: 'Blessed Stride', duration: 3, mods: { moveSpeedPct: c.p('haste') }, debuff: false, vfx: 'haste' });
        c.vfx('healBeam', c.origin, 0.2, 0.35, { to: centerOf(t) });
      },
    },
    {
      id: 'sera-aegis',
      name: 'Aegis',
      icon: '◈',
      slot: 2,
      ultimate: false,
      description: 'Ward an ally (or yourself) with a {shield} damage shield for {duration}s.',
      targeting: 'ally',
      params: { cooldown: 17, range: 30, shield: 200, shieldScale: 1.4, duration: 6 },
      upgrades: [
        { text: '+120 shield', mods: { shield: 120 } },
        { text: '-5s cooldown', mods: { cooldown: -5 } },
        { text: 'Shielded ally gains +15% bullet resist', mods: { resist: 15 } },
      ],
      ai: { kind: 'shield', maxRange: 28, allyHpBelow: 0.7, selfHpBelow: 0.55 },
      color: '#ffe08a',
      cast: (c) => {
        const t = c.target ?? c.hero;
        c.status(t, { id: 'aegis', name: 'Aegis', duration: c.dur('duration'), shield: c.scaled('shield'), mods: c.p('resist') > 0 ? { bulletResist: c.p('resist') } : undefined, debuff: false, vfx: 'shield' });
        c.vfx('healBeam', c.origin, 0.2, 0.3, { to: centerOf(t) });
      },
    },
    {
      id: 'sera-pulse',
      name: 'Radiant Pulse',
      icon: '✺',
      slot: 3,
      ultimate: false,
      description: 'A pulse of light: enemies within {radius}m take {damage} damage and are knocked back; allies gain +{haste}% move speed for 3s.',
      targeting: 'self',
      params: { cooldown: 15, range: 0, radius: 8, damage: 70, damageScale: 0.8, haste: 25 },
      upgrades: [
        { text: '+2m radius', mods: { radius: 2 } },
        { text: '+60 damage', mods: { damage: 60 } },
        { text: '-5s cooldown', mods: { cooldown: -5 } },
      ],
      ai: { kind: 'cc', maxRange: 7, aoeRadius: 7, minTargets: 1, heroOnly: false, selfHpBelow: 0.7 },
      color: '#fff6c9',
      cast: (c) => {
        const pos = { ...c.hero.pos, y: c.hero.pos.y + 1 };
        c.aoe(pos, c.p('radius'), 'enemies', (u) => {
          c.damage(u, c.scaled('damage'));
          c.knockback(u, u.pos.x - pos.x, u.pos.z - pos.z, 10, 3);
        });
        c.aoe(pos, c.p('radius'), 'alliesAndSelf', (u) => {
          c.status(u, { id: 'pulse-haste', name: 'Radiance', duration: 3, mods: { moveSpeedPct: c.p('haste') }, debuff: false, vfx: 'haste' });
        }, { heroesOnly: true });
        c.vfx('nova', pos, c.p('radius'), 0.45);
      },
    },
    {
      id: 'sera-sanctuary',
      name: 'Sanctuary',
      icon: '⛪',
      slot: 4,
      ultimate: true,
      description: 'Consecrate a {radius}m area for {duration}s: allies inside heal {hps} per second and take {reduction}% less damage.',
      targeting: 'self',
      params: { cooldown: 100, range: 0, radius: 9, duration: 6, hps: 60, hpsScale: 0.45, reduction: 25 },
      upgrades: [
        { text: '+2s duration', mods: { duration: 2 } },
        { text: '+40 healing per second', mods: { hps: 40 } },
        { text: '+15% damage reduction', mods: { reduction: 15 } },
      ],
      ai: { kind: 'heal', maxRange: 9, allyHpBelow: 0.55, selfHpBelow: 0.4, minTargets: 1 },
      color: '#fff3b0',
      cast: (c) => {
        c.zone({ ...c.hero.pos }, c.p('radius'), c.dur('duration'), 0.5, (z) => {
          c.aoe(z.pos, z.radius, 'alliesAndSelf', (u) => {
            c.heal(u, c.scaled('hps') * 0.5);
            c.status(u, { id: 'sanctuary', name: 'Sanctified', duration: 0.6, mods: { damageTakenPct: -c.p('reduction') }, debuff: false });
          }, { heroesOnly: true });
        }, 'sanctuary');
      },
    },
  ],
  ai: {
    preferredRange: 22,
    aggression: 0.35,
    skillOrder: [1, 2, 3, 4, 1, 2, 4, 3],
    build: ['spirit-shard', 'healing-flask', 'quickened-mind', 'extra-stamina', 'lasting-hex', 'barrier', 'timewarp', 'purifier', 'chrono-crown', 'phantom-step'],
    defaultPersonality: 'supportive',
  },
};
