import type { HeroDef } from '../../src/gameplay/types';
import { blast, weapon } from './common';

/** Cinder Vale — area damage specialist. Original character. */
export const CINDER: HeroDef = {
  id: 'cinder',
  name: 'Cinder Vale',
  title: 'The Ash Prophet',
  role: 'Controller',
  description: 'A street preacher of the burning gospel who sets whole lanes alight and ends teamfights with a single sermon.',
  difficulty: 2,
  model: { build: 'average', height: 1.0, headwear: 'hood', coat: 'robe', primary: '#7a2b1f', secondary: '#2b1612', accent: '#ffb347', skin: '#d6a07e', glow: '#ff7a1a' },
  base: { maxHp: 580, hpRegen: 2, moveSpeed: 6.9, sprintSpeed: 2, stamina: 3, bulletResist: 0, spiritResist: 0.05 },
  growth: { maxHp: 30, weaponDamagePct: 3.2, spiritPower: 3.2 },
  weapon: weapon({
    id: 'ember-repeater',
    name: 'Ember Repeater (SMG)',
    style: 'smg',
    damage: 10.5,
    fireInterval: 0.085,
    magazine: 36,
    reloadTime: 2.2,
    spread: 0.028,
    spreadMoving: 0.02,
    spreadPerShot: 0.002,
    spreadMax: 0.05,
    falloffStart: 14,
    falloffEnd: 34,
    falloffMin: 0.45,
    range: 60,
    critMul: 1.5,
    projectileSpeed: 150,
    recoil: 0.7,
    tracer: 'ember',
    sound: 'smg',
  }),
  abilities: [
    {
      id: 'cinder-napalm',
      name: 'Napalm Flask',
      icon: '♨',
      slot: 1,
      ultimate: false,
      description: 'Lob a flask that explodes for {damage} damage and leaves burning ground ({burn} dps) for {duration}s.',
      targeting: 'direction',
      params: { cooldown: 11, range: 60, damage: 70, damageScale: 0.7, burn: 30, burnScale: 0.35, radius: 4.2, duration: 4 },
      upgrades: [
        { text: '+1.5m radius', mods: { radius: 1.5 } },
        { text: '+20 burn dps', mods: { burn: 20 } },
        { text: '-4s cooldown', mods: { cooldown: -4 } },
      ],
      ai: { kind: 'damage', maxRange: 28, aoeRadius: 4, minTargets: 2, farm: true, projectileSpeed: 26, aimGround: true },
      color: '#ff7a1a',
      cast: (c) => {
        const d = c.dir;
        const up = { x: d.x, y: d.y + 0.25, z: d.z };
        const l = Math.hypot(up.x, up.y, up.z);
        const explode = (pt: { x: number; y: number; z: number }) => {
          const pos = { x: pt.x, y: c.groundAt(pt.x, pt.z, pt.y), z: pt.z };
          blast(c, pos, c.p('radius'), c.scaled('damage'));
          c.zone(pos, c.p('radius'), c.dur('duration'), 0.5, (z) => {
            c.aoe(z.pos, z.radius, 'enemies', (u) => c.damage(u, c.scaled('burn') * 0.5));
          }, 'fire');
        };
        c.projectile({
          speed: 26,
          gravity: 18,
          radius: 0.3,
          range: c.range(),
          visual: 'flask',
          dir: { x: up.x / l, y: up.y / l, z: up.z / l },
          onHit: (_u, point) => explode(point),
          onExpire: (point) => explode(point),
        });
      },
    },
    {
      id: 'cinder-flamedash',
      name: 'Flame Dash',
      icon: '➳',
      slot: 2,
      ultimate: false,
      description: 'Dash forward leaving a trail of fire that burns enemies for {burn} dps for {duration}s.',
      targeting: 'direction',
      params: { cooldown: 15, range: 8, burn: 35, burnScale: 0.3, duration: 3 },
      upgrades: [
        { text: '+1s trail duration', mods: { duration: 1 } },
        { text: '+25 burn dps', mods: { burn: 25 } },
        { text: '-5s cooldown', mods: { cooldown: -5 } },
      ],
      ai: { kind: 'escape', maxRange: 30, selfHpBelow: 0.45 },
      color: '#ff9c33',
      cast: (c) => {
        let dx = c.hero.input.moveX;
        let dz = c.hero.input.moveZ;
        if (Math.hypot(dx, dz) < 0.2) {
          const f = c.forwardXZ();
          dx = f.x;
          dz = f.z;
        }
        c.dash(dx, dz, 19, 0.42, { stopOnWall: true });
        for (let i = 0; i < 6; i++) {
          c.delay(i * 0.07, () => {
            c.zone({ ...c.hero.pos }, 2, c.dur('duration'), 0.5, (z) => {
              c.aoe(z.pos, z.radius, 'enemies', (u) => c.damage(u, c.scaled('burn') * 0.5));
            }, 'fire');
          });
        }
      },
    },
    {
      id: 'cinder-combust',
      name: 'Combustion',
      icon: '✺',
      slot: 3,
      ultimate: false,
      description: 'Ignite an enemy. After {delay}s they explode, dealing {damage} to all enemies within {radius}m.',
      targeting: 'enemy',
      params: { cooldown: 13, range: 26, delay: 2.5, damage: 115, damageScale: 1.0, radius: 5 },
      upgrades: [
        { text: '+2m radius', mods: { radius: 2 } },
        { text: '+70 damage', mods: { damage: 70 } },
        { text: 'Explosion stuns for 0.7s', mods: { stun: 0.7 } },
      ],
      ai: { kind: 'damage', maxRange: 24, aoeRadius: 5, minTargets: 1, farm: true },
      color: '#ff4d1a',
      cast: (c) => {
        const t = c.target;
        if (!t) return false;
        c.status(t, { id: 'combust', name: 'Combusting', duration: c.p('delay'), debuff: true, vfx: 'combust' });
        c.delay(c.p('delay'), () => {
          const pos = { x: t.pos.x, y: t.pos.y + 1, z: t.pos.z };
          blast(c, pos, c.p('radius'), c.scaled('damage'), (u) => {
            if (c.p('stun') > 0) c.stun(u, c.p('stun'));
          });
        });
      },
    },
    {
      id: 'cinder-nova',
      name: 'Inferno Nova',
      icon: '☀',
      slot: 4,
      ultimate: true,
      description: 'Channel for {channel}s, then erupt in a {radius}m nova dealing {damage} damage, stunning for {stun}s and burning survivors.',
      targeting: 'self',
      params: { cooldown: 100, range: 0, channel: 1.4, radius: 10, damage: 290, damageScale: 1.6, stun: 1.0, burn: 40 },
      upgrades: [
        { text: '+3m radius', mods: { radius: 3 } },
        { text: '+120 damage', mods: { damage: 120 } },
        { text: '-0.6s channel', mods: { channel: -0.6 } },
      ],
      ai: { kind: 'damage', maxRange: 8, aoeRadius: 9, minTargets: 2, heroOnly: true },
      color: '#ff3d00',
      castMoveMul: 0.3,
      cast: (c) => {
        c.vfx('charge', c.hero.pos, c.p('radius'), c.p('channel'), { unit: c.hero.id });
        c.status(c.hero, { id: 'nova-ward', name: 'Kindling', duration: c.p('channel'), mods: { bulletResist: 25 }, debuff: false });
        return true;
      },
      channelEnd: (c, interrupted) => {
        if (interrupted) return;
        const pos = { ...c.hero.pos, y: c.hero.pos.y + 1 };
        blast(c, pos, c.p('radius'), c.scaled('damage'), (u) => {
          c.stun(u, c.dur('stun'));
          c.status(u, { id: 'nova-burn', name: 'Burning', duration: 4, dps: c.p('burn'), dotType: 'spirit', debuff: true, vfx: 'burn' });
        }, 'nova');
      },
    },
  ],
  ai: {
    preferredRange: 16,
    aggression: 0.6,
    skillOrder: [1, 3, 2, 4, 1, 3, 4, 1],
    build: ['spirit-shard', 'quickened-mind', 'extended-drum', 'mystic-burn', 'arcane-surge', 'spirit-ward', 'lasting-hex', 'eclipse-heart', 'timewarp', 'archmage'],
    defaultPersonality: 'objective',
  },
};
