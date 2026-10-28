import type { DifficultyProfile } from '../../data/ai';
import type { Simulation } from '../core/simulation';
import type { Vec3 } from '../core/math';
import type { AnyUnit, Hero } from '../gameplay/entities';
import { SF } from '../gameplay/types';

/**
 * What a bot knows about one enemy. Positions are as last observed — bots
 * never read the true position of an unseen enemy.
 */
export interface Contact {
  id: number;
  kind: AnyUnit['kind'];
  team: number;
  pos: Vec3;
  vel: Vec3;
  lastSeen: number;
  firstSeen: number;
  visible: boolean;
  /** Seen directly (vs. reported by team vision). */
  direct: boolean;
  hpFrac: number;
  hp: number;
  maxHp: number;
  level: number;
  /** Rough damage-per-second estimate (heroes), used for threat. */
  dps: number;
}

const HERO_MEMORY = 8;
const UNIT_MEMORY = 1.5;
const VIEW_RANGE = 70;
const HEAR_RANGE = 32;

export class Perception {
  readonly contacts = new Map<number, Contact>();
  private nextUpdate = 0;
  lastUpdate = 0;

  constructor(
    private readonly self: Hero,
    private readonly diff: DifficultyProfile,
    private readonly rnd: () => number,
  ) {}

  update(sim: Simulation): void {
    if (sim.time < this.nextUpdate) return;
    this.nextUpdate = sim.time + this.diff.perceptionInterval * (0.85 + this.rnd() * 0.3);
    this.lastUpdate = sim.time;
    const me = this.self;
    if (!me.alive) {
      // Dead heroes still receive team vision (spectating teammates).
      for (const c of this.contacts.values()) c.visible = false;
    }
    const eye = { x: me.pos.x, y: me.pos.y + me.eyeHeight, z: me.pos.z };
    const cosFov = Math.cos(((this.diff.fov / 2) * Math.PI) / 180);
    const fx = Math.sin(me.yaw);
    const fz = Math.cos(me.yaw);
    const seenNow = new Set<number>();
    sim.forEachUnitNear(me.pos, VIEW_RANGE, (u) => {
      if (!u.alive || u.team === me.team) return;
      const dx = u.pos.x - me.pos.x;
      const dz = u.pos.z - me.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > VIEW_RANGE) return;
      const invisible = (u.flags & SF.INVISIBLE) !== 0 && !(u.flags & SF.REVEALED);
      let seen = false;
      let direct = false;
      if (me.alive && !invisible) {
        if (u.kind === 'structure') seen = true;
        else if ((u.kind === 'trooper' || u.kind === 'neutral') && d < 32) {
          // Troopers and creeps are loud; proximity is enough (saves raycasts).
          seen = true;
          direct = true;
        } else {
          const inFov = d < 4 || (dx * fx + dz * fz) / (d || 1) >= cosFov;
          const heard = u.kind === 'hero' && d < HEAR_RANGE && sim.time - u.lastShotTime < 0.6;
          if ((inFov || heard) && (u.kind !== 'hero' || d < VIEW_RANGE)) {
            const tgt = { x: u.pos.x, y: u.pos.y + u.height * 0.7, z: u.pos.z };
            if (!sim.world.segmentBlocked(eye, tgt)) {
              seen = true;
              direct = true;
            } else if (heard) {
              seen = true;
            }
          }
        }
      } else if (invisible && me.alive && d < 3.5) seen = true;
      // Team vision (what the minimap legitimately shows).
      if (!seen && u.visibleTo[me.team as 0 | 1] && !invisible) seen = true;
      if (seen) {
        seenNow.add(u.id);
        this.observe(sim, u, direct);
      }
    });
    // Team vision beyond our own view range (heroes only, for strategy).
    for (const h of sim.heroes) {
      if (h.team === me.team || !h.alive || seenNow.has(h.id)) continue;
      if (h.visibleTo[me.team as 0 | 1] && !((h.flags & SF.INVISIBLE) && !(h.flags & SF.REVEALED))) {
        seenNow.add(h.id);
        this.observe(sim, h, false);
      }
    }
    for (const [id, c] of this.contacts) {
      if (seenNow.has(id)) continue;
      c.visible = false;
      const u = sim.units.get(id);
      const mem = c.kind === 'hero' ? HERO_MEMORY : UNIT_MEMORY;
      if (sim.time - c.lastSeen > mem || !u) {
        this.contacts.delete(id);
        continue;
      }
      // Deaths are announced (kill feed): forget dead heroes immediately.
      if (!u.alive) this.contacts.delete(id);
    }
  }

  private observe(sim: Simulation, u: AnyUnit, direct: boolean): void {
    let c = this.contacts.get(u.id);
    if (!c) {
      c = {
        id: u.id,
        kind: u.kind,
        team: u.team,
        pos: { ...u.pos },
        vel: { ...u.vel },
        lastSeen: sim.time,
        firstSeen: sim.time,
        visible: true,
        direct,
        hpFrac: u.hpFrac(),
        hp: u.hp,
        maxHp: u.maxHp,
        level: u.kind === 'hero' ? u.level : 0,
        dps: 0,
      };
      this.contacts.set(u.id, c);
    }
    if (!c.visible && sim.time - c.lastSeen > 1) c.firstSeen = sim.time;
    c.pos.x = u.pos.x;
    c.pos.y = u.pos.y;
    c.pos.z = u.pos.z;
    c.vel.x = u.vel.x;
    c.vel.y = u.vel.y;
    c.vel.z = u.vel.z;
    c.lastSeen = sim.time;
    c.visible = true;
    c.direct = direct;
    c.hpFrac = u.hpFrac();
    c.hp = u.hp;
    c.maxHp = u.maxHp;
    if (u.kind === 'hero') {
      c.level = u.level;
      const w = u.def.weapon;
      c.dps = ((w.damage * w.pellets) / w.fireInterval) * u.stats.weaponDamageMul * 0.55 + u.stats.spiritPower * 0.6 + 25;
    } else if (u.kind === 'structure') {
      c.dps = u.def.damage / u.def.attackInterval;
    } else if (u.kind === 'trooper') {
      c.dps = (u.def.damage * u.def.heroDamageMul) / u.def.attackInterval;
    } else c.dps = 20;
  }

  /** Enemy heroes currently or recently seen. */
  enemyHeroes(maxAge = HERO_MEMORY): Contact[] {
    const out: Contact[] = [];
    const now = this.lastUpdate;
    for (const c of this.contacts.values()) if (c.kind === 'hero' && now - c.lastSeen <= maxAge) out.push(c);
    return out;
  }

  visibleEnemies(): Contact[] {
    const out: Contact[] = [];
    for (const c of this.contacts.values()) if (c.visible) out.push(c);
    return out;
  }

  /** Estimated enemy hero DPS that could reach `pos` within `radius`. */
  threatAt(pos: Vec3, radius: number, maxAge = 4): { dps: number; heroes: number } {
    let dps = 0;
    let heroes = 0;
    const now = this.lastUpdate;
    for (const c of this.contacts.values()) {
      if (c.kind !== 'hero' || now - c.lastSeen > maxAge) continue;
      if (Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) > radius) continue;
      dps += c.dps;
      heroes++;
    }
    return { dps, heroes };
  }

  get(id: number): Contact | undefined {
    return this.contacts.get(id);
  }
}
