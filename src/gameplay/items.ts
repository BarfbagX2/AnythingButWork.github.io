import { BALANCE } from '../../data/balance';
import { ITEM_MAP } from '../../data/items';
import type { Simulation } from '../core/simulation';
import type { AnyUnit, Hero, OwnedItem, Projectile } from './entities';
import type { DamageInfo } from './damage';
import { applyStatus, cleanseDebuffs } from './status';
import { SF, type ItemCategory, type ItemDef } from './types';

export interface BuyCheck {
  ok: boolean;
  cost: number;
  reason?: string;
  replaces?: string;
}

/**
 * Item purchasing, slots, and item behaviours. Stat modifiers are applied by
 * the stat derivation (stats.ts); this system owns ownership rules plus the
 * conditional passives and actives.
 */
export class ItemSystem {
  constructor(private readonly sim: Simulation) {}

  def(id: string): ItemDef | undefined {
    return ITEM_MAP[id];
  }

  slotUsage(hero: Hero): Record<ItemCategory, number> & { flexUsed: number; flexMax: number } {
    const cap = BALANCE.items.slotsPerCategory;
    const counts: Record<ItemCategory, number> = { weapon: 0, vitality: 0, spirit: 0 };
    for (const it of hero.items) counts[it.def.category]++;
    let flexUsed = 0;
    for (const k of ['weapon', 'vitality', 'spirit'] as ItemCategory[]) flexUsed += Math.max(0, counts[k] - cap);
    return { ...counts, flexUsed, flexMax: this.sim.teams[hero.team0].flexSlots };
  }

  /** Price after crediting an owned component. */
  check(hero: Hero, id: string, ignoreRange = false): BuyCheck {
    const def = ITEM_MAP[id];
    if (!def) return { ok: false, cost: 0, reason: 'Unknown item' };
    if (hero.items.some((i) => i.def.id === id)) return { ok: false, cost: def.cost, reason: 'Already owned' };
    // Owning an upgrade means you can't buy its component again.
    if (hero.items.some((i) => i.def.component === id)) return { ok: false, cost: def.cost, reason: 'Already upgraded' };
    let cost = def.cost;
    let replaces: string | undefined;
    if (def.component && hero.items.some((i) => i.def.id === def.component)) {
      cost -= ITEM_MAP[def.component].cost;
      replaces = def.component;
    }
    if (!ignoreRange && !hero.inShopRange && hero.alive) return { ok: false, cost, reason: 'Visit a shop to buy', replaces };
    if (hero.souls < cost) return { ok: false, cost, reason: 'Not enough souls', replaces };
    if (!replaces) {
      const u = this.slotUsage(hero);
      const cap = BALANCE.items.slotsPerCategory;
      if (u[def.category] >= cap && u.flexUsed >= u.flexMax) return { ok: false, cost, reason: `No free ${def.category} or flex slot` };
    }
    return { ok: true, cost, replaces };
  }

  buy(hero: Hero, id: string): boolean {
    const c = this.check(hero, id);
    if (!c.ok) return false;
    const def = ITEM_MAP[id];
    hero.souls -= c.cost;
    if (c.replaces) hero.items = hero.items.filter((i) => i.def.id !== c.replaces);
    hero.items.push({ def, cooldownEnd: 0, procReadyAt: 0 });
    this.sim.events.push({ t: 'buy', unit: hero.id, item: id });
    return true;
  }

  sell(hero: Hero, id: string): boolean {
    const idx = hero.items.findIndex((i) => i.def.id === id);
    if (idx < 0) return false;
    if (!hero.inShopRange && hero.alive) return false;
    const it = hero.items[idx];
    hero.items.splice(idx, 1);
    hero.souls += Math.round(it.def.cost * BALANCE.economy.sellRefund);
    this.sim.events.push({ t: 'buy', unit: hero.id, item: id, sold: true });
    return true;
  }

  /** Owned items with active effects, in activation order (keys Z X C V). */
  actives(hero: Hero): OwnedItem[] {
    return hero.items.filter((i) => i.def.active);
  }

  activate(hero: Hero, index: number): boolean {
    const it = this.actives(hero)[index];
    if (!it || !it.def.active || this.sim.time < it.cooldownEnd) return false;
    if (hero.flags & (SF.STUN | SF.SILENCE)) return false;
    const a = it.def.active;
    const sim = this.sim;
    switch (a.kind) {
      case 'heal':
        applyStatus(sim, hero, { id: 'item-heal', name: 'Healing Flask', duration: a.duration, hps: a.amount / a.duration, debuff: false, vfx: 'heal' }, hero.id);
        break;
      case 'shield':
        applyStatus(sim, hero, { id: 'item-shield', name: 'Shield', duration: a.duration, shield: a.amount, debuff: false, vfx: 'shield' }, hero.id);
        break;
      case 'cleanse':
        cleanseDebuffs(sim, hero);
        applyStatus(sim, hero, { id: 'item-cleanse', name: 'Purified', duration: 3, mods: { moveSpeedPct: 25 }, debuff: false, vfx: 'haste' }, hero.id);
        break;
      case 'haste':
        applyStatus(sim, hero, { id: 'item-haste', name: 'Haste', duration: a.duration, mods: { moveSpeedPct: a.moveSpeedPct }, debuff: false, vfx: 'haste' }, hero.id);
        break;
      case 'untargetable':
        applyStatus(sim, hero, { id: 'item-phantom', name: 'Phantom', duration: a.duration, flags: SF.INVULNERABLE, debuff: false, vfx: 'phantom' }, hero.id);
        break;
      case 'blink': {
        let dx = hero.input.moveX;
        let dz = hero.input.moveZ;
        if (Math.hypot(dx, dz) < 0.1) {
          dx = Math.sin(hero.yaw);
          dz = Math.cos(hero.yaw);
        }
        const l = Math.hypot(dx, dz);
        const from = { ...hero.pos };
        // Step along the direction and stop before walls.
        let best = 0;
        for (let d = 1; d <= a.distance; d += 0.5) {
          const x = hero.pos.x + (dx / l) * d;
          const z = hero.pos.z + (dz / l) * d;
          const gy = sim.world.groundHeight(x, z, hero.pos.y + 1.2);
          if (sim.world.overlapsCylinder(x, gy, z, hero.radius, hero.height, 0.5)) break;
          best = d;
        }
        if (best < 1) return false;
        hero.pos.x += (dx / l) * best;
        hero.pos.z += (dz / l) * best;
        hero.pos.y = sim.world.groundHeight(hero.pos.x, hero.pos.z, hero.pos.y + 1.2);
        hero.prevPos = { ...hero.pos };
        sim.events.push({ t: 'vfx', kind: 'blink', pos: from, to: { ...hero.pos }, radius: 1, color: '#9ef', duration: 0.4 });
        break;
      }
      case 'nova':
        sim.forEachUnitNear(hero.pos, a.radius + 2, (u) => {
          if (!u.alive || u.team === hero.team || u.kind === 'structure') return;
          if (Math.hypot(u.pos.x - hero.pos.x, u.pos.z - hero.pos.z) > a.radius + u.radius) return;
          sim.dealDamage(u, { sourceId: hero.id, amount: a.damage + hero.stats.spiritPower * 0.8, type: 'spirit' });
          applyStatus(sim, u, { id: 'nova-slow', name: 'Hexed', duration: 2, mods: { moveSpeedPct: -a.slowPct }, debuff: true, vfx: 'slow' }, hero.id);
        });
        sim.events.push({ t: 'vfx', kind: 'nova', pos: { ...hero.pos }, radius: a.radius, color: '#c58bff', duration: 0.5 });
        break;
    }
    it.cooldownEnd = sim.time + a.cooldown * hero.stats.cooldownMul;
    return true;
  }

  /** Per-tick item passives that depend on hero state. */
  update(hero: Hero, dt: number): void {
    for (const it of hero.items) {
      const p = it.def.passive;
      if (!p) continue;
      if (p.kind === 'lowHpRegen' && hero.alive && hero.hp / hero.maxHp < p.threshold) {
        hero.hp = Math.min(hero.maxHp, hero.hp + p.hps * dt);
      }
    }
  }

  trooperDamageMul(hero: Hero): number {
    let m = 1;
    for (const it of hero.items) if (it.def.passive?.kind === 'troopers') m += it.def.passive.damagePct / 100;
    return m;
  }

  trooperResistMul(hero: Hero): number {
    let m = 1;
    for (const it of hero.items) if (it.def.passive?.kind === 'troopers') m *= 1 - it.def.passive.resistPct / 100;
    return m;
  }

  /** Distance-conditional weapon damage multiplier. */
  bulletRangeMul(hero: Hero, dist: number): number {
    let m = 1;
    for (const it of hero.items) {
      const p = it.def.passive;
      if (p?.kind === 'closeRange' && dist <= p.range) m += p.weaponDamagePct / 100;
      else if (p?.kind === 'longRange' && dist >= p.range) m += p.weaponDamagePct / 100;
    }
    return m;
  }

  decorateBullet(hero: Hero, p: Projectile): void {
    void hero;
    void p;
  }

  onDamageDealt(hero: Hero, target: AnyUnit, info: DamageInfo, dealt: number): void {
    if (dealt <= 0 || !target.alive) return;
    const sim = this.sim;
    for (const it of hero.items) {
      const p = it.def.passive;
      if (!p) continue;
      switch (p.kind) {
        case 'headshotBonus':
          if (info.crit && info.type === 'bullet' && sim.time >= it.procReadyAt && target.kind === 'hero') {
            it.procReadyAt = sim.time + p.cooldown;
            sim.dealDamage(target, { sourceId: hero.id, amount: p.damage, type: 'pure', noLifesteal: true });
          }
          break;
        case 'spiritBurn':
          if (info.type === 'spirit' && !info.isDot && info.abilityId) {
            applyStatus(sim, target, { id: 'mystic-burn', name: 'Burning', duration: p.duration, dps: p.dps, dotType: 'spirit', debuff: true, vfx: 'burn' }, hero.id);
          }
          break;
        case 'bulletSlow':
          if (info.type === 'bullet' && target.kind !== 'structure') {
            applyStatus(sim, target, { id: 'frost-slow', name: 'Chilled', duration: p.duration, mods: { moveSpeedPct: -p.slowPct }, debuff: true, vfx: 'slow' }, hero.id);
          }
          break;
        case 'antiHeal':
          if (info.type === 'bullet' && target.kind === 'hero') {
            applyStatus(sim, target, { id: 'grave-rounds', name: 'Grave Mark', duration: p.duration, flags: SF.NO_HEAL, debuff: true, vfx: 'antiheal' }, hero.id);
          }
          break;
        default:
          break;
      }
    }
  }

  onDamageTaken(hero: Hero, dealt: number): void {
    if (dealt <= 0 || !hero.alive) return;
    for (const it of hero.items) {
      const p = it.def.passive;
      if (p?.kind === 'shieldOnLow' && hero.hp / hero.maxHp < p.threshold && this.sim.time >= it.procReadyAt) {
        it.procReadyAt = this.sim.time + p.cooldown;
        applyStatus(this.sim, hero, { id: 'emergency-barrier', name: 'Barrier', duration: 6, shield: p.shield, debuff: false, vfx: 'shield' }, hero.id);
      }
    }
  }

  onKill(hero: Hero, victim: Hero): void {
    void victim;
    for (const it of hero.items) {
      const p = it.def.passive;
      if (p?.kind === 'onKillHeal') this.sim.heal(hero, p.heal, hero.id);
    }
  }
}
