import { SF, type HeroDef } from '../../src/gameplay/types';
import { centerOf, weapon } from './common';

/** Vesper Lune — precision marksman. Original character. */
export const VESPER: HeroDef = {
  id: 'vesper',
  name: 'Vesper Lune',
  title: 'The Long Night',
  role: 'Marksman',
  description: 'A rooftop sharpshooter who punishes anyone standing still and vanishes on a grappling line when the fight turns.',
  difficulty: 3,
  model: { build: 'slim', height: 1.0, headwear: 'fedora', coat: 'trench', primary: '#2f3a4f', secondary: '#1a1f2b', accent: '#d8d1b5', skin: '#e0b89a', glow: '#8fd3ff' },
  base: { maxHp: 520, hpRegen: 2, moveSpeed: 7.0, sprintSpeed: 2, stamina: 3, bulletResist: 0, spiritResist: 0 },
  growth: { maxHp: 28, weaponDamagePct: 4.2, spiritPower: 2.5 },
  weapon: weapon({
    id: 'vigil',
    name: 'Vigil (lever rifle)',
    style: 'lever',
    fireMode: 'semi',
    damage: 64,
    fireInterval: 0.75,
    magazine: 8,
    reloadTime: 2.6,
    spread: 0.0035,
    spreadMoving: 0.035,
    spreadPerShot: 0.01,
    spreadMax: 0.04,
    spreadRecovery: 0.08,
    falloffStart: 45,
    falloffEnd: 90,
    falloffMin: 0.65,
    range: 130,
    critMul: 2.0,
    projectileSpeed: 950,
    recoil: 5,
    tracer: 'sniper',
    sound: 'sniper',
  }),
  abilities: [
    {
      id: 'vesper-lance',
      name: 'Piercing Lance',
      icon: '➶',
      slot: 1,
      ultimate: false,
      description: 'After a brief aim, fire a round that pierces every enemy in a line for {damage} spirit damage.',
      targeting: 'direction',
      params: { cooldown: 15, range: 65, castTime: 0.35, damage: 130, damageScale: 1.2 },
      upgrades: [
        { text: '+60 damage', mods: { damage: 60 } },
        { text: '-4s cooldown', mods: { cooldown: -4 } },
        { text: 'Hit heroes are slowed 40%', mods: { slow: 40 } },
      ],
      ai: { kind: 'damage', maxRange: 55, projectileSpeed: 260, farm: true, minTargets: 1 },
      color: '#8fd3ff',
      castMoveMul: 0.3,
      cast: (c) => {
        const dmg = c.scaled('damage');
        c.projectile({
          speed: 260,
          radius: 0.35,
          range: c.range(),
          visual: 'lance',
          pierce: 12,
          onHit: (u) => {
            if (!u) return;
            c.damage(u, dmg);
            if (c.p('slow') > 0 && u.kind === 'hero' && u.alive) c.slow(u, c.p('slow'), 2);
          },
        });
      },
    },
    {
      id: 'vesper-grapnel',
      name: 'Grapnel',
      icon: '⚓',
      slot: 2,
      ultimate: false,
      description: 'Fire a grappling line up to {range}m; when it catches a surface you are pulled to it.',
      targeting: 'direction',
      params: { cooldown: 16, range: 30 },
      upgrades: [
        { text: '+10m range', mods: { range: 10 } },
        { text: '-5s cooldown', mods: { cooldown: -5 } },
        { text: '+2 stamina restored on landing', mods: { stamina: 2 } },
      ],
      ai: { kind: 'escape', maxRange: 40, selfHpBelow: 0.4 },
      color: '#cfe8ff',
      cast: (c) => {
        const st = c.state;
        c.projectile({
          speed: 110,
          radius: 0.15,
          range: c.range(),
          visual: 'hook',
          onHit: (u, point, normal) => {
            const to = u ? { x: u.pos.x, y: u.pos.y, z: u.pos.z } : { x: point.x + normal.x * 0.9, y: point.y + Math.max(0, normal.y) * 0.2, z: point.z + normal.z * 0.9 };
            c.vfx('tether', c.hero.pos, 0.1, 0.4, { to });
            c.leap(to, Math.max(1.5, to.y - c.hero.pos.y + 1.5), {
              onEnd: () => {
                if (c.p('stamina') > 0) c.hero.stamina = Math.min(c.hero.stats.stamina, c.hero.stamina + c.p('stamina'));
              },
            });
          },
          onExpire: () => {
            // Missed: refund most of the cooldown.
            st.cooldownEnd = c.sim.time + 1.5;
          },
        });
      },
    },
    {
      id: 'vesper-flare',
      name: 'Flare Trap',
      icon: '✷',
      slot: 3,
      ultimate: false,
      description: 'Place a trap (2 charges). Enemy heroes that trigger it take {damage} damage, are rooted for {root}s and revealed for 5s.',
      targeting: 'ground',
      params: { cooldown: 18, range: 25, charges: 2, damage: 60, damageScale: 0.6, root: 1.4, radius: 3, lifetime: 45 },
      upgrades: [
        { text: '+0.6s root', mods: { root: 0.6 } },
        { text: '+80 damage', mods: { damage: 80 } },
        { text: '+1 charge', mods: { charges: 1 } },
      ],
      ai: { kind: 'zone', maxRange: 20, heroOnly: true, aimGround: true },
      color: '#ffd166',
      cast: (c) => {
        const pos = { ...c.point };
        const armAt = c.sim.time + 1;
        c.zone(pos, c.p('radius'), c.p('lifetime'), 0.1, (z) => {
          if (c.sim.time < armAt) return;
          let fired = false;
          c.aoe(z.pos, z.radius, 'enemies', (u) => {
            fired = true;
            c.damage(u, c.scaled('damage'));
            c.status(u, { id: 'flare-root', name: 'Snared', duration: c.dur('root'), flags: SF.ROOT, debuff: true, vfx: 'root' });
            c.status(u, { id: 'flare-reveal', name: 'Revealed', duration: 5, flags: SF.REVEALED, debuff: true });
          }, { heroesOnly: true });
          if (fired) {
            c.vfx('blast', z.pos, z.radius, 0.4);
            z.alive = false;
          }
        }, 'trap');
      },
    },
    {
      id: 'vesper-deadeye',
      name: 'Deadeye',
      icon: '◎',
      slot: 4,
      ultimate: true,
      description: 'Lock onto an enemy hero and channel for {channel}s, then fire a shot dealing {damage} spirit damage. Interrupted by stuns.',
      targeting: 'enemy',
      params: { cooldown: 85, range: 75, channel: 1.1, damage: 380, damageScale: 2.2 },
      upgrades: [
        { text: '+120 damage', mods: { damage: 120 } },
        { text: '-0.4s channel', mods: { channel: -0.4 } },
        { text: '-30s cooldown', mods: { cooldown: -30 } },
      ],
      ai: { kind: 'finisher', maxRange: 70, heroOnly: true, targetHpBelow: 0.65 },
      color: '#ff5e7a',
      castMoveMul: 0,
      cast: (c) => {
        if (!c.target || c.target.kind !== 'hero') return false;
        c.vfx('lockon', centerOf(c.target), 1, c.p('channel'), { unit: c.target.id });
        return true;
      },
      channelEnd: (c, interrupted) => {
        const t = c.target;
        if (interrupted || !t || !t.alive) return;
        if (c.sim.world.segmentBlocked(c.origin, centerOf(t))) return;
        c.damage(t, c.scaled('damage'));
        c.vfx('beam', c.origin, 0.4, 0.3, { to: centerOf(t) });
      },
    },
  ],
  ai: {
    preferredRange: 32,
    aggression: 0.45,
    skillOrder: [1, 3, 2, 4, 1, 1, 4, 3],
    build: ['hollow-point', 'longshot', 'quick-hands', 'fleet-boots', 'headhunter', 'extra-stamina', 'executioner', 'blink-charm', 'anti-heal-rounds', 'phantom-step'],
    defaultPersonality: 'farmer',
  },
};
