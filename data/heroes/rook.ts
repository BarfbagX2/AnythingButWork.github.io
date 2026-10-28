import { SF, type HeroDef } from '../../src/gameplay/types';
import { blast, weapon } from './common';

/** Rook Hale — frontline bruiser/initiator. Original character. */
export const ROOK: HeroDef = {
  id: 'rook',
  name: 'Rook Hale',
  title: 'The Iron Saint',
  role: 'Bruiser',
  description: 'A plated penitent who crashes into fights, drains the life of everyone around him and refuses to fall.',
  difficulty: 1,
  model: { build: 'hulking', height: 1.08, headwear: 'helmet', coat: 'armor', primary: '#5b5f66', secondary: '#2c2f35', accent: '#c9a24d', skin: '#c79a7c', glow: '#ff9b3d' },
  base: { maxHp: 720, hpRegen: 2.5, moveSpeed: 6.7, sprintSpeed: 2, stamina: 3, bulletResist: 0.05, spiritResist: 0 },
  growth: { maxHp: 36, weaponDamagePct: 3.2, spiritPower: 2.5 },
  weapon: weapon({
    id: 'penitent',
    name: 'Penitent (pump shotgun)',
    style: 'shotgun',
    fireMode: 'semi',
    damage: 9.5,
    pellets: 8,
    fireInterval: 0.85,
    magazine: 6,
    reloadTime: 2.4,
    spread: 0.075,
    spreadMoving: 0.01,
    spreadPerShot: 0,
    spreadMax: 0.08,
    falloffStart: 7,
    falloffEnd: 20,
    falloffMin: 0.3,
    range: 35,
    critMul: 1.4,
    projectileSpeed: 260,
    recoil: 4,
    tracer: 'pellet',
    sound: 'shotgun',
  }),
  abilities: [
    {
      id: 'rook-charge',
      name: 'Shoulder Charge',
      icon: '➽',
      slot: 1,
      ultimate: false,
      description: 'Charge forward, dealing {damage} damage to everything in the way and stunning the first hero hit for {stun}s.',
      targeting: 'direction',
      params: { cooldown: 14, range: 10, duration: 0.6, speed: 15, damage: 80, damageScale: 0.9, stun: 0.8 },
      upgrades: [
        { text: '+45 damage', mods: { damage: 45 } },
        { text: '-4s cooldown', mods: { cooldown: -4 } },
        { text: '+0.5s stun', mods: { stun: 0.5 } },
      ],
      ai: { kind: 'engage', maxRange: 9, minRange: 2, heroOnly: true },
      color: '#ffb35c',
      cast: (c) => {
        const f = c.forwardXZ();
        let stunned = false;
        c.vfx('charge', c.hero.pos, 1.2, c.p('duration'), { unit: c.hero.id });
        c.dash(f.x, f.z, c.p('speed'), c.p('duration'), {
          onUnitHit: (u) => {
            if (u.kind === 'structure') return true;
            c.damage(u, c.scaled('damage'));
            if (u.kind === 'hero' && !stunned) {
              stunned = true;
              c.stun(u, c.dur('stun'));
              c.knockback(u, f.x, f.z, 11, 2.5, 0.3);
              return true;
            }
            c.knockback(u, f.x, f.z, 8, 1.5);
            return false;
          },
        });
      },
    },
    {
      id: 'rook-siphon',
      name: 'Blood Siphon',
      icon: '♨',
      slot: 2,
      ultimate: false,
      description: 'For {duration}s drain {dps} damage per second from enemies within {radius}m, healing for part of the damage.',
      targeting: 'self',
      params: { cooldown: 22, range: 0, duration: 5, radius: 7, dps: 18, dpsScale: 0.3, heroHeal: 0.6, otherHeal: 0.3 },
      upgrades: [
        { text: '+2m radius', mods: { radius: 2 } },
        { text: '+10 damage per second', mods: { dps: 10 } },
        { text: '-7s cooldown', mods: { cooldown: -7 } },
      ],
      ai: { kind: 'damage', maxRange: 6, aoeRadius: 6, minTargets: 2, farm: true },
      color: '#ff4a5a',
      cast: (c) => {
        c.zone(c.hero.pos, c.p('radius'), c.dur('duration'), 0.5, (z) => {
          let heal = 0;
          c.aoe(z.pos, z.radius, 'enemies', (u) => {
            const d = c.damage(u, c.scaled('dps') * 0.5);
            heal += d * (u.kind === 'hero' ? c.p('heroHeal') : c.p('otherHeal'));
          });
          if (heal > 0) c.heal(c.hero, heal);
        }, 'siphon', c.hero.id);
      },
    },
    {
      id: 'rook-bulwark',
      name: 'Bulwark',
      icon: '⛨',
      slot: 3,
      ultimate: false,
      description: 'Brace for {duration}s: +{bulletResist}% bullet resist, +{spiritResist}% spirit resist, and heal {heal}.',
      targeting: 'self',
      params: { cooldown: 24, range: 0, duration: 5, bulletResist: 30, spiritResist: 20, heal: 110, healScale: 1.0 },
      upgrades: [
        { text: '+2s duration', mods: { duration: 2 } },
        { text: '+90 heal', mods: { heal: 90 } },
        { text: 'Unstoppable while active', mods: { unstoppable: 1 } },
      ],
      ai: { kind: 'shield', maxRange: 30, selfHpBelow: 0.55 },
      color: '#c9a24d',
      cast: (c) => {
        c.status(c.hero, {
          duration: c.dur('duration'),
          mods: { bulletResist: c.p('bulletResist'), spiritResist: c.p('spiritResist') },
          flags: c.p('unstoppable') > 0 ? SF.UNSTOPPABLE : 0,
          debuff: false,
          vfx: 'bulwark',
        });
        c.heal(c.hero, c.scaled('heal'));
      },
    },
    {
      id: 'rook-earthbreaker',
      name: 'Earthbreaker',
      icon: '⛰',
      slot: 4,
      ultimate: true,
      description: 'Leap to a location and slam down, dealing {damage} damage and stunning enemies within {radius}m for {stun}s.',
      targeting: 'ground',
      params: { cooldown: 90, range: 22, castTime: 0.2, radius: 7, damage: 200, damageScale: 1.4, stun: 1.0 },
      upgrades: [
        { text: '+2m radius', mods: { radius: 2 } },
        { text: '+110 damage', mods: { damage: 110 } },
        { text: '-25s cooldown', mods: { cooldown: -25 } },
      ],
      ai: { kind: 'engage', maxRange: 20, minRange: 4, aoeRadius: 6, minTargets: 1, heroOnly: true, aimGround: true },
      color: '#ff8c2a',
      cast: (c) => {
        const to = { ...c.point };
        c.vfx('warn', to, c.p('radius'), 0.9);
        c.leap(to, 6, {
          onEnd: () => {
            const pos = { ...c.hero.pos };
            blast(c, pos, c.p('radius'), c.scaled('damage'), (u) => c.stun(u, c.dur('stun')), 'shockwave');
          },
        });
      },
    },
  ],
  ai: {
    preferredRange: 6,
    aggression: 0.75,
    skillOrder: [1, 2, 3, 4, 2, 1, 4, 3],
    build: ['iron-lung', 'point-blank', 'bullet-ward', 'healing-flask', 'second-wind', 'vampire-rounds', 'colossus-heart', 'warden-plate', 'crimson-feast', 'unbroken'],
    defaultPersonality: 'aggressive',
  },
};
