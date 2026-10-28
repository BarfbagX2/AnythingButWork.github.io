import { SF, type HeroDef } from '../../src/gameplay/types';
import { centerOf, weapon } from './common';

/** Kestrel Voss — close-range assassin. Original character. */
export const KESTREL: HeroDef = {
  id: 'kestrel',
  name: 'Kestrel Voss',
  title: 'The Hexblade',
  role: 'Assassin',
  description: 'A masked duelist who steps through shadows, hexes her prey silent and finishes them before help arrives.',
  difficulty: 3,
  model: { build: 'slim', height: 0.98, headwear: 'goggles', coat: 'vest', primary: '#3b1f3d', secondary: '#160c17', accent: '#e05cff', skin: '#c48f74', glow: '#d36bff' },
  base: { maxHp: 560, hpRegen: 2, moveSpeed: 7.3, sprintSpeed: 2.2, stamina: 3, bulletResist: 0, spiritResist: 0 },
  growth: { maxHp: 28, weaponDamagePct: 3.8, spiritPower: 2.8 },
  weapon: weapon({
    id: 'twin-vipers',
    name: 'Twin Vipers (revolvers)',
    style: 'revolver',
    damage: 21,
    fireInterval: 0.16,
    magazine: 12,
    reloadTime: 1.7,
    spread: 0.016,
    spreadMoving: 0.012,
    spreadPerShot: 0.006,
    spreadMax: 0.05,
    falloffStart: 10,
    falloffEnd: 30,
    falloffMin: 0.4,
    range: 60,
    critMul: 1.8,
    projectileSpeed: 420,
    recoil: 1.8,
    tracer: 'tracer',
    sound: 'pistol',
  }),
  abilities: [
    {
      id: 'kestrel-step',
      name: 'Shadow Step',
      icon: '⇝',
      slot: 1,
      ultimate: false,
      description: 'Blink up to {range}m. Your weapon deals +{bonus}% damage for 3s afterwards.',
      targeting: 'ground',
      params: { cooldown: 10, range: 14, bonus: 35 },
      upgrades: [
        { text: '+6m range', mods: { range: 6 } },
        { text: '-3s cooldown', mods: { cooldown: -3 } },
        { text: '+30% bonus damage', mods: { bonus: 30 } },
      ],
      ai: { kind: 'engage', maxRange: 18, minRange: 6, heroOnly: true, selfHpBelow: 0.3, aimGround: true },
      color: '#d36bff',
      cast: (c) => {
        const h = c.hero;
        const from = { ...h.pos };
        const dx = c.point.x - h.pos.x;
        const dz = c.point.z - h.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.5) return false;
        let best = -1;
        for (let d = Math.min(dist, c.range()); d >= 1; d -= 0.5) {
          const x = h.pos.x + (dx / dist) * d;
          const z = h.pos.z + (dz / dist) * d;
          const y = c.groundAt(x, z, Math.max(h.pos.y, c.point.y) + 1);
          if (!c.sim.world.overlapsCylinder(x, y, z, h.radius, h.height, 0.3)) {
            best = d;
            h.pos.x = x;
            h.pos.z = z;
            h.pos.y = y;
            break;
          }
        }
        if (best < 0) return false;
        h.prevPos = { ...h.pos };
        h.vel = { x: 0, y: 0, z: 0 };
        c.status(h, { id: 'ambush', name: 'Ambush', duration: 3, mods: { weaponDamagePct: c.p('bonus') }, debuff: false, vfx: 'ambush' });
        c.vfx('blink', from, 1, 0.4, { to: { ...h.pos } });
      },
    },
    {
      id: 'kestrel-hexbolt',
      name: 'Hex Bolt',
      icon: '✧',
      slot: 2,
      ultimate: false,
      description: 'Fire a bolt that deals {damage} damage and silences the target for {silence}s.',
      targeting: 'direction',
      params: { cooldown: 14, range: 36, damage: 90, damageScale: 0.8, silence: 1.5 },
      upgrades: [
        { text: '+0.7s silence', mods: { silence: 0.7 } },
        { text: '+60 damage', mods: { damage: 60 } },
        { text: '-4s cooldown', mods: { cooldown: -4 } },
      ],
      ai: { kind: 'cc', maxRange: 32, heroOnly: true, projectileSpeed: 60 },
      color: '#e05cff',
      cast: (c) => {
        c.projectile({
          speed: 60,
          radius: 0.45,
          range: c.range(),
          visual: 'hexbolt',
          onHit: (u) => {
            if (!u) return;
            c.damage(u, c.scaled('damage'));
            if (u.alive) c.status(u, { id: 'silence', name: 'Silenced', duration: c.dur('silence'), flags: SF.SILENCE, debuff: true, vfx: 'silence' });
          },
        });
      },
    },
    {
      id: 'kestrel-veil',
      name: 'Veil',
      icon: '◌',
      slot: 3,
      ultimate: false,
      description: 'Become invisible for {duration}s and gain +{haste}% move speed. Attacking breaks the veil.',
      targeting: 'self',
      params: { cooldown: 24, range: 0, duration: 4, haste: 30, keepsStealth: 1 },
      upgrades: [
        { text: '+2s duration', mods: { duration: 2 } },
        { text: '-6s cooldown', mods: { cooldown: -6 } },
        { text: 'Heal 150 when the veil ends', mods: { heal: 150 } },
      ],
      ai: { kind: 'escape', maxRange: 30, selfHpBelow: 0.4 },
      color: '#8f6bff',
      cast: (c) => {
        const d = c.dur('duration');
        c.status(c.hero, { id: 'veil', name: 'Veiled', duration: d, flags: SF.INVISIBLE, mods: { moveSpeedPct: c.p('haste') }, debuff: false, breakOnAttack: true, vfx: 'veil' });
        if (c.p('heal') > 0) c.delay(d, () => c.heal(c.hero, c.p('heal')));
        c.vfx('blink', c.hero.pos, 1, 0.3);
      },
    },
    {
      id: 'kestrel-deathmark',
      name: 'Death Mark',
      icon: '✝',
      slot: 4,
      ultimate: true,
      description: 'Mark an enemy hero. After {delay}s they take {damage} plus {missing}% of their missing health.',
      targeting: 'enemy',
      params: { cooldown: 80, range: 30, delay: 2.5, damage: 200, damageScale: 1.2, missing: 25 },
      upgrades: [
        { text: '+10% missing health', mods: { missing: 10 } },
        { text: '+120 damage', mods: { damage: 120 } },
        { text: '-25s cooldown', mods: { cooldown: -25 } },
      ],
      ai: { kind: 'finisher', maxRange: 28, heroOnly: true, targetHpBelow: 0.6 },
      color: '#ff2fa8',
      cast: (c) => {
        const t = c.target;
        if (!t || t.kind !== 'hero') return false;
        c.status(t, { id: 'deathmark', name: 'Death Mark', duration: c.p('delay'), flags: SF.REVEALED, debuff: true, vfx: 'deathmark' });
        c.delay(c.p('delay'), () => {
          if (!t.alive) return;
          const missing = t.maxHp - t.hp;
          c.damage(t, c.scaled('damage') + (missing * c.p('missing')) / 100);
          c.vfx('blast', centerOf(t), 2, 0.4);
        });
      },
    },
  ],
  ai: {
    preferredRange: 9,
    aggression: 0.8,
    skillOrder: [2, 1, 3, 4, 2, 1, 4, 2],
    build: ['hollow-point', 'point-blank', 'fleet-boots', 'headhunter', 'rapid-fire', 'blink-charm', 'executioner', 'burst-chamber', 'phantom-step', 'siege-breaker'],
    defaultPersonality: 'roamer',
  },
};
