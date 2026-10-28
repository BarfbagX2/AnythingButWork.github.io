import type { HeroDef } from '../../src/gameplay/types';
import type { AnyUnit } from '../../src/gameplay/entities';
import { blast, centerOf, weapon } from './common';

/** Tessa Arc — crowd-control specialist. Original character. */
export const TESSA: HeroDef = {
  id: 'tessa',
  name: 'Tessa Arc',
  title: 'The Stormwright',
  role: 'Controller',
  description: 'A rogue electrician who chains lightning through crowds and collapses whole teams into a crackling singularity.',
  difficulty: 2,
  model: { build: 'average', height: 0.98, headwear: 'goggles', coat: 'trench', primary: '#24425a', secondary: '#101c26', accent: '#7ff6ff', skin: '#d9a98a', glow: '#59e8ff' },
  base: { maxHp: 580, hpRegen: 2, moveSpeed: 6.9, sprintSpeed: 2, stamina: 3, bulletResist: 0, spiritResist: 0.05 },
  growth: { maxHp: 30, weaponDamagePct: 3, spiritPower: 3.2 },
  weapon: weapon({
    id: 'coil-carbine',
    name: 'Coil Carbine (burst rifle)',
    style: 'rifle',
    fireMode: 'burst',
    burstCount: 3,
    burstInterval: 0.07,
    damage: 20,
    fireInterval: 0.52,
    magazine: 24,
    reloadTime: 2.2,
    spread: 0.008,
    spreadMoving: 0.018,
    spreadPerShot: 0.003,
    spreadMax: 0.03,
    falloffStart: 28,
    falloffEnd: 60,
    falloffMin: 0.6,
    range: 100,
    critMul: 1.7,
    projectileSpeed: 620,
    recoil: 1.6,
    tracer: 'arc',
    sound: 'energy',
  }),
  abilities: [
    {
      id: 'tessa-chain',
      name: 'Chain Lightning',
      icon: 'ϟ',
      slot: 1,
      ultimate: false,
      description: 'Strike an enemy for {damage} damage; the bolt jumps to {jumps} more enemies within {jumpRange}m.',
      targeting: 'enemy',
      params: { cooldown: 10, range: 26, damage: 90, damageScale: 0.9, jumps: 3, jumpRange: 8, falloff: 0.75 },
      upgrades: [
        { text: '+2 jumps', mods: { jumps: 2 } },
        { text: '+50 damage', mods: { damage: 50 } },
        { text: '-3s cooldown', mods: { cooldown: -3 } },
      ],
      ai: { kind: 'damage', maxRange: 24, minTargets: 1, farm: true },
      color: '#7ff6ff',
      cast: (c) => {
        let cur: AnyUnit | null = c.target;
        if (!cur) return false;
        const hit: number[] = [];
        let dmg = c.scaled('damage');
        let from = c.origin;
        for (let i = 0; i <= c.p('jumps') && cur; i++) {
          hit.push(cur.id);
          c.damage(cur, dmg);
          c.vfx('lightning', from, 0.2, 0.25, { to: centerOf(cur) });
          from = centerOf(cur);
          dmg *= c.p('falloff');
          let next: AnyUnit | null = null;
          let bestD = c.p('jumpRange');
          c.aoe(from, c.p('jumpRange'), 'enemies', (u) => {
            if (hit.includes(u.id)) return;
            const d = Math.hypot(u.pos.x - from.x, u.pos.z - from.z);
            if (d < bestD) {
              bestD = d;
              next = u;
            }
          });
          cur = next;
        }
      },
    },
    {
      id: 'tessa-static',
      name: 'Static Field',
      icon: '⚡',
      slot: 2,
      ultimate: false,
      description: 'Electrify a {radius}m area for {duration}s: enemies inside are slowed {slow}% and take {dps} damage per second.',
      targeting: 'ground',
      params: { cooldown: 16, range: 28, radius: 6, duration: 3.5, slow: 35, dps: 28, dpsScale: 0.3 },
      upgrades: [
        { text: '+2m radius', mods: { radius: 2 } },
        { text: '+20 damage per second', mods: { dps: 20 } },
        { text: 'Enemies leaving the field are stunned 0.6s at expiry', mods: { stun: 0.6 } },
      ],
      ai: { kind: 'zone', maxRange: 26, aoeRadius: 6, minTargets: 2, farm: true, aimGround: true },
      color: '#59e8ff',
      cast: (c) => {
        const pos = { ...c.point };
        const z = c.zone(pos, c.p('radius'), c.dur('duration'), 0.5, (zz) => {
          c.aoe(zz.pos, zz.radius, 'enemies', (u) => {
            c.damage(u, c.scaled('dps') * 0.5);
            c.slow(u, c.p('slow'), 0.6, 'static-slow');
          });
        }, 'static');
        if (c.p('stun') > 0) c.delay(c.dur('duration') - 0.05, () => c.aoe(z.pos, z.radius, 'enemies', (u) => c.stun(u, c.p('stun'))));
      },
    },
    {
      id: 'tessa-overcharge',
      name: 'Overcharge',
      icon: '⌁',
      slot: 3,
      ultimate: false,
      description: 'Supercharge yourself for {duration}s: +{fireRate}% fire rate and +{speed} m/s move speed.',
      targeting: 'self',
      params: { cooldown: 20, range: 0, duration: 6, fireRate: 30, speed: 1.5 },
      upgrades: [
        { text: '+20% fire rate', mods: { fireRate: 20 } },
        { text: '+2s duration', mods: { duration: 2 } },
        { text: 'Also +20% bullet resist', mods: { resist: 20 } },
      ],
      ai: { kind: 'buff', maxRange: 25, minTargets: 1 },
      color: '#b6fbff',
      cast: (c) => {
        c.status(c.hero, { id: 'overcharge', name: 'Overcharged', duration: c.dur('duration'), mods: { fireRatePct: c.p('fireRate'), moveSpeed: c.p('speed'), bulletResist: c.p('resist') }, debuff: false, vfx: 'overcharge' });
      },
    },
    {
      id: 'tessa-singularity',
      name: 'Singularity',
      icon: '◉',
      slot: 4,
      ultimate: true,
      description: 'Open a singularity that drags enemies within {radius}m to its centre for {pullTime}s, then detonates for {damage} damage and a {stun}s stun.',
      targeting: 'ground',
      params: { cooldown: 95, range: 30, castTime: 0.25, radius: 9, pullTime: 1.5, damage: 150, damageScale: 1.0, stun: 1.2 },
      upgrades: [
        { text: '+3m radius', mods: { radius: 3 } },
        { text: '+100 damage', mods: { damage: 100 } },
        { text: '-25s cooldown', mods: { cooldown: -25 } },
      ],
      ai: { kind: 'cc', maxRange: 28, aoeRadius: 8, minTargets: 2, heroOnly: true, aimGround: true },
      color: '#a07cff',
      cast: (c) => {
        const center = { ...c.point, y: c.point.y + 1 };
        c.zone(center, c.p('radius'), c.p('pullTime'), 0.1, (z) => {
          c.aoe(z.pos, z.radius, 'enemies', (u) => c.pull(u, z.pos, 9));
        }, 'singularity');
        c.delay(c.p('pullTime'), () => {
          blast(c, center, 4.5, c.scaled('damage'), (u) => c.stun(u, c.dur('stun')), 'nova');
        });
      },
    },
  ],
  ai: {
    preferredRange: 20,
    aggression: 0.55,
    skillOrder: [1, 2, 3, 4, 1, 2, 4, 1],
    build: ['spirit-shard', 'extended-drum', 'quickened-mind', 'mystic-burn', 'arcane-surge', 'rapid-fire', 'timewarp', 'eclipse-heart', 'burst-chamber', 'archmage'],
    defaultPersonality: 'objective',
  },
};
