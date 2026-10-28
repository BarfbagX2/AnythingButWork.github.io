import type { HeroDef } from '../../src/gameplay/types';
import { blast, centerOf, weapon } from './common';

/** Mortis Grey — summoner. Original character. */
export const MORTIS: HeroDef = {
  id: 'mortis',
  name: 'Mortis Grey',
  title: 'The Undertaker',
  role: 'Summoner',
  description: 'A tall mortician who brings the dead back to work: thralls that push lanes, bone wards that hold ground, and a tether that drinks a hero dry.',
  difficulty: 2,
  model: { build: 'slim', height: 1.12, headwear: 'tophat', coat: 'trench', primary: '#2a2a2e', secondary: '#121214', accent: '#9be3c9', skin: '#b9b2a6', glow: '#7dffcf' },
  base: { maxHp: 600, hpRegen: 2, moveSpeed: 6.8, sprintSpeed: 2, stamina: 3, bulletResist: 0, spiritResist: 0.05 },
  growth: { maxHp: 32, weaponDamagePct: 3, spiritPower: 3 },
  weapon: weapon({
    id: 'grave-bell',
    name: 'Grave Bell (hand cannon)',
    style: 'cannon',
    damage: 27,
    fireInterval: 0.34,
    magazine: 14,
    reloadTime: 2.4,
    spread: 0.012,
    spreadMoving: 0.02,
    spreadPerShot: 0.006,
    spreadMax: 0.04,
    falloffStart: 20,
    falloffEnd: 45,
    falloffMin: 0.6,
    range: 70,
    critMul: 1.5,
    projectileSpeed: 85,
    projectileRadius: 0.12,
    recoil: 2.5,
    splash: { radius: 1.6, fraction: 0.35 },
    tracer: 'soulshot',
    sound: 'cannon',
  }),
  abilities: [
    {
      id: 'mortis-thralls',
      name: 'Raise Thralls',
      icon: '☠',
      slot: 1,
      ultimate: false,
      description: 'Raise {count} thralls ({hp} health, {damage} damage per hit) that fight for {duration}s.',
      targeting: 'self',
      params: { cooldown: 28, range: 0, count: 2, hp: 300, hpScale: 3, damage: 22, damageScale: 0.25, duration: 20 },
      upgrades: [
        { text: '+1 thrall', mods: { count: 1 } },
        { text: '+150 thrall health', mods: { hp: 150 } },
        { text: '+12 thrall damage', mods: { damage: 12 } },
      ],
      ai: { kind: 'summon', maxRange: 20, farm: true, minTargets: 1 },
      color: '#7dffcf',
      cast: (c) => {
        const n = Math.round(c.p('count'));
        for (let i = 0; i < n; i++) {
          const a = c.hero.yaw + (i - (n - 1) / 2) * 0.9;
          const pos = { x: c.hero.pos.x + Math.sin(a) * 2, y: c.hero.pos.y, z: c.hero.pos.z + Math.cos(a) * 2 };
          c.summon('thrall', pos, { hp: c.scaled('hp'), damage: c.scaled('damage'), range: 2.2, attackInterval: 0.9, speed: 6.8, duration: c.dur('duration'), visual: 'thrall', radius: 0.5, height: 1.7 });
        }
        c.vfx('raise', c.hero.pos, 3, 0.6);
      },
    },
    {
      id: 'mortis-chill',
      name: 'Grave Chill',
      icon: '❄',
      slot: 2,
      ultimate: false,
      description: 'Burst of grave-cold at a location: {damage} damage and {slow}% slow for {duration}s within {radius}m.',
      targeting: 'ground',
      params: { cooldown: 13, range: 26, castTime: 0.2, damage: 85, damageScale: 0.8, radius: 5, slow: 40, duration: 3 },
      upgrades: [
        { text: '+1.5m radius', mods: { radius: 1.5 } },
        { text: '+60 damage', mods: { damage: 60 } },
        { text: '+20% slow', mods: { slow: 20 } },
      ],
      ai: { kind: 'cc', maxRange: 24, aoeRadius: 5, minTargets: 1, farm: true, aimGround: true },
      color: '#9be3ff',
      cast: (c) => {
        blast(c, c.point, c.p('radius'), c.scaled('damage'), (u) => c.slow(u, c.p('slow'), c.dur('duration')), 'frost');
      },
    },
    {
      id: 'mortis-ward',
      name: 'Bone Ward',
      icon: '♜',
      slot: 3,
      ultimate: false,
      description: 'Plant a bone ward that shoots enemies for {damage} damage every {interval}s for {duration}s.',
      targeting: 'ground',
      params: { cooldown: 24, range: 12, damage: 20, damageScale: 0.2, interval: 0.6, duration: 16, hp: 420 },
      upgrades: [
        { text: '+8s duration', mods: { duration: 8 } },
        { text: '+12 damage', mods: { damage: 12 } },
        { text: '-0.2s attack interval', mods: { interval: -0.2 } },
      ],
      ai: { kind: 'zone', maxRange: 18, minTargets: 1, farm: true, aimGround: true },
      color: '#d9f7e9',
      cast: (c) => {
        c.summon('turret', c.point, { hp: c.p('hp'), damage: c.scaled('damage'), range: 18, attackInterval: c.p('interval'), speed: 0, duration: c.dur('duration'), visual: 'boneward', radius: 0.6, height: 2.2 });
      },
    },
    {
      id: 'mortis-harvest',
      name: 'Soul Harvest',
      icon: '⛓',
      slot: 4,
      ultimate: true,
      description: 'Tether an enemy hero for up to {channel}s, draining {dps} health per second, healing yourself and slowing them {slow}%.',
      targeting: 'enemy',
      params: { cooldown: 90, range: 18, channel: 4, dps: 70, dpsScale: 0.55, slow: 30, breakRange: 26 },
      upgrades: [
        { text: '+35 drain per second', mods: { dps: 35 } },
        { text: '+1.5s duration', mods: { channel: 1.5 } },
        { text: '-25s cooldown', mods: { cooldown: -25 } },
      ],
      ai: { kind: 'damage', maxRange: 16, heroOnly: true },
      color: '#59ffb5',
      castMoveMul: 0.6,
      cast: (c) => {
        if (!c.target || c.target.kind !== 'hero') return false;
        c.state.data.acc = 0;
        return true;
      },
      channelTick: (c, dt) => {
        const t = c.target;
        const h = c.hero;
        if (!t || !t.alive || Math.hypot(t.pos.x - h.pos.x, t.pos.z - h.pos.z) > c.p('breakRange') || c.sim.world.segmentBlocked(c.origin, centerOf(t))) {
          h.cast = null;
          return;
        }
        c.state.data.acc = (c.state.data.acc ?? 0) + dt;
        if (c.state.data.acc >= 0.25) {
          c.state.data.acc -= 0.25;
          const d = c.damage(t, c.scaled('dps') * 0.25);
          c.heal(h, d);
          c.slow(t, c.p('slow'), 0.4, 'harvest-slow');
          c.vfx('tether', centerOf(h), 0.15, 0.27, { to: centerOf(t) });
        }
      },
    },
  ],
  ai: {
    preferredRange: 18,
    aggression: 0.5,
    skillOrder: [1, 2, 3, 4, 1, 2, 4, 1],
    build: ['spirit-shard', 'iron-lung', 'trooper-bane', 'lasting-hex', 'arcane-surge', 'soul-siphon', 'spirit-ward', 'eclipse-heart', 'colossus-heart', 'archmage'],
    defaultPersonality: 'farmer',
  },
};
