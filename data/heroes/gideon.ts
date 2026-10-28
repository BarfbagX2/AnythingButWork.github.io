import { SF, type HeroDef } from '../../src/gameplay/types';
import { blast, weapon } from './common';

/** Gideon Brass — defensive specialist / engineer. Original character. */
export const GIDEON: HeroDef = {
  id: 'gideon',
  name: 'Gideon Brass',
  title: 'The Gearwright',
  role: 'Specialist',
  description: 'A union machinist who fortifies lanes with sentries and mines, patches up his crew, and locks enemies out of the fight.',
  difficulty: 2,
  model: { build: 'heavy', height: 1.0, headwear: 'bowler', coat: 'vest', primary: '#6b4a2a', secondary: '#2a1d10', accent: '#e0b35a', skin: '#c98f6a', glow: '#ffcf5a' },
  base: { maxHp: 650, hpRegen: 2.5, moveSpeed: 6.7, sprintSpeed: 2, stamina: 3, bulletResist: 0.05, spiritResist: 0.05 },
  growth: { maxHp: 34, weaponDamagePct: 3.2, spiritPower: 2.8 },
  weapon: weapon({
    id: 'rivet-driver',
    name: 'Rivet Driver (heavy pistol)',
    style: 'pistol',
    fireMode: 'auto',
    damage: 33,
    fireInterval: 0.3,
    magazine: 15,
    reloadTime: 2.2,
    spread: 0.01,
    spreadMoving: 0.02,
    spreadPerShot: 0.006,
    spreadMax: 0.04,
    falloffStart: 18,
    falloffEnd: 42,
    falloffMin: 0.55,
    range: 80,
    critMul: 1.6,
    projectileSpeed: 320,
    recoil: 2.2,
    tracer: 'rivet',
    sound: 'pistol',
  }),
  abilities: [
    {
      id: 'gideon-sentry',
      name: 'Deploy Sentry',
      icon: '⛫',
      slot: 1,
      ultimate: false,
      description: 'Deploy a sentry (2 charges) that fires {damage} damage {rate} times per second for {duration}s.',
      targeting: 'ground',
      params: { cooldown: 22, range: 10, charges: 2, damage: 13, damageScale: 0.15, rate: 4, duration: 24, hp: 480, hpScale: 3 },
      upgrades: [
        { text: '+6 sentry damage', mods: { damage: 6 } },
        { text: '+300 sentry health', mods: { hp: 300 } },
        { text: '+1 charge', mods: { charges: 1 } },
      ],
      ai: { kind: 'summon', maxRange: 18, minTargets: 1, farm: true, aimGround: true },
      color: '#ffcf5a',
      cast: (c) => {
        c.summon('turret', c.point, { hp: c.scaled('hp'), damage: c.scaled('damage'), range: 20, attackInterval: 1 / c.p('rate'), speed: 0, duration: c.dur('duration'), visual: 'sentry', radius: 0.55, height: 1.4 });
      },
    },
    {
      id: 'gideon-mine',
      name: 'Magnetic Mine',
      icon: '✱',
      slot: 2,
      ultimate: false,
      description: 'Toss a mine that arms on landing. Enemies that come within {trigger}m detonate it for {damage} damage and are rooted for {root}s.',
      targeting: 'direction',
      params: { cooldown: 14, range: 40, damage: 110, damageScale: 0.9, root: 1.0, trigger: 3, radius: 4.5, lifetime: 40 },
      upgrades: [
        { text: '+70 damage', mods: { damage: 70 } },
        { text: '+0.6s root', mods: { root: 0.6 } },
        { text: '-5s cooldown', mods: { cooldown: -5 } },
      ],
      ai: { kind: 'zone', maxRange: 22, heroOnly: false, farm: true, minTargets: 1, projectileSpeed: 22 },
      color: '#ff9f3a',
      cast: (c) => {
        const d = c.dir;
        const up = { x: d.x, y: d.y + 0.2, z: d.z };
        const l = Math.hypot(up.x, up.y, up.z);
        const arm = (pt: { x: number; y: number; z: number }) => {
          const pos = { x: pt.x, y: c.groundAt(pt.x, pt.z, pt.y), z: pt.z };
          const armAt = c.sim.time + 0.6;
          c.zone(pos, c.p('trigger'), c.p('lifetime'), 0.1, (z) => {
            if (c.sim.time < armAt) return;
            let near = false;
            c.aoe(z.pos, z.radius, 'enemies', () => {
              near = true;
            });
            if (!near) return;
            z.alive = false;
            blast(c, z.pos, c.p('radius'), c.scaled('damage'), (u) => c.status(u, { id: 'mine-root', name: 'Magnetised', duration: c.dur('root'), flags: SF.ROOT, debuff: true, vfx: 'root' }));
          }, 'mine');
        };
        c.projectile({ speed: 22, gravity: 20, radius: 0.25, range: c.range(), visual: 'mine', dir: { x: up.x / l, y: up.y / l, z: up.z / l }, onHit: (_u, p) => arm(p), onExpire: (p) => arm(p) });
      },
    },
    {
      id: 'gideon-repair',
      name: 'Overclock Repair',
      icon: '⚙',
      slot: 3,
      ultimate: false,
      description: 'Heal yourself, allied heroes and your constructs within {radius}m for {heal}.',
      targeting: 'self',
      params: { cooldown: 18, range: 0, radius: 9, heal: 100, healScale: 0.9 },
      upgrades: [
        { text: '+70 heal', mods: { heal: 70 } },
        { text: '+4m radius', mods: { radius: 4 } },
        { text: '-6s cooldown', mods: { cooldown: -6 } },
      ],
      ai: { kind: 'heal', maxRange: 9, selfHpBelow: 0.6, allyHpBelow: 0.55 },
      color: '#8dff8a',
      cast: (c) => {
        const pos = { ...c.hero.pos, y: c.hero.pos.y + 1 };
        c.aoe(pos, c.p('radius'), 'alliesAndSelf', (u) => {
          if (u.kind === 'trooper') return;
          c.heal(u, c.scaled('heal') * (u.kind === 'summon' ? 2 : 1));
        });
        c.vfx('nova', pos, c.p('radius'), 0.4, { color: '#8dff8a' });
      },
    },
    {
      id: 'gideon-lockdown',
      name: 'Lockdown',
      icon: '⛒',
      slot: 4,
      ultimate: true,
      description: 'Project a {radius}m lockdown field for {duration}s: enemies inside are disarmed and slowed {slow}%; allies inside gain +{resist}% bullet resist.',
      targeting: 'ground',
      params: { cooldown: 90, range: 25, castTime: 0.2, radius: 8, duration: 4, slow: 30, resist: 25 },
      upgrades: [
        { text: '+2s duration', mods: { duration: 2 } },
        { text: '+3m radius', mods: { radius: 3 } },
        { text: '-25s cooldown', mods: { cooldown: -25 } },
      ],
      ai: { kind: 'cc', maxRange: 22, aoeRadius: 7, minTargets: 2, heroOnly: true, aimGround: true },
      color: '#ffd35a',
      cast: (c) => {
        c.zone({ ...c.point }, c.p('radius'), c.dur('duration'), 0.25, (z) => {
          c.aoe(z.pos, z.radius, 'enemies', (u) => {
            c.status(u, { id: 'lockdown', name: 'Locked Down', duration: 0.4, flags: SF.DISARM, mods: { moveSpeedPct: -c.p('slow') }, debuff: true, vfx: 'disarm' });
          }, { heroesOnly: true });
          c.aoe(z.pos, z.radius, 'alliesAndSelf', (u) => {
            c.status(u, { id: 'lockdown-ward', name: 'Fortified', duration: 0.4, mods: { bulletResist: c.p('resist') }, debuff: false });
          }, { heroesOnly: true });
        }, 'lockdown');
      },
    },
  ],
  ai: {
    preferredRange: 18,
    aggression: 0.45,
    skillOrder: [1, 2, 3, 4, 1, 2, 4, 3],
    build: ['iron-lung', 'hollow-point', 'spirit-shard', 'bullet-ward', 'rapid-fire', 'lasting-hex', 'warden-plate', 'colossus-heart', 'burst-chamber', 'unbroken'],
    defaultPersonality: 'defensive',
  },
};
