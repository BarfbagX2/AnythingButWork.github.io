import { BALANCE } from '../../data/balance';
import { HEROES } from '../../data/heroes';
import { buildHexlineWard } from '../../data/maps/city';
import { STRUCTURES } from '../../data/units';
import { interruptCast } from '../gameplay/abilities';
import { updateProjectiles } from '../gameplay/combat';
import { dealDamage as dealDamageImpl, heal as healImpl, type DamageInfo } from '../gameplay/damage';
import { claimOrb, onHeroKilled, onNeutralKilled, onStructureDestroyed, onTrooperKilled, passiveIncome, updateOrbs } from '../gameplay/economy';
import {
  Hero,
  Neutral,
  Projectile,
  SoulOrb,
  Structure,
  Summon,
  Trooper,
  Zone,
  type AnyUnit,
  type Pickup,
  type ProjectileKind,
  type SummonBehavior,
  type Unit,
} from '../gameplay/entities';
import { updateHero } from '../gameplay/heroSystem';
import { ItemSystem } from '../gameplay/items';
import { buildZipLines, detachZipline, endForced, type ZipLine } from '../gameplay/movement';
import { initCamps, provokeCamp, updateCamps, updateNeutrals, type BossState, type CampState } from '../gameplay/neutrals';
import { applyStatus, updateStatuses } from '../gameplay/status';
import { applyHeroStats, deriveHeroStats } from '../gameplay/stats';
import { refreshVulnerability, structureDowned, updateStructures } from '../gameplay/structures';
import { updateSummons } from '../gameplay/summons';
import { updateTroopers } from '../gameplay/troopers';
import type { HeroDef, NeutralDef, StatMods, TrooperDef } from '../gameplay/types';
import { SF } from '../gameplay/types';
import { updateVision } from '../gameplay/vision';
import { initWaves, updateWaves, type WaveState } from '../gameplay/waves';
import { CollisionWorld, makeHit } from '../world/collision';
import type { LaneId, MapDef, TeamId } from '../world/mapTypes';
import { EventQueue } from './events';
import type { PingKind } from './input';
import { distXZ, type Vec3 } from './math';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface HeroSlot {
  team: TeamId;
  heroId: string;
  name: string;
  isBot: boolean;
  difficulty?: Difficulty;
  personality?: string;
  lane?: LaneId;
}

export interface MatchConfig {
  seed: number;
  slots: HeroSlot[];
  waves: boolean;
  neutrals: boolean;
  boss: boolean;
  structures: boolean;
  pregame: number;
  startingSouls: number;
  mode: 'standard' | 'sandbox' | 'practice';
  /** Default difficulty for bots without one. */
  difficulty: Difficulty;
}

export function defaultConfig(partial: Partial<MatchConfig> = {}): MatchConfig {
  // Ignore explicitly-undefined fields so callers can pass optional overrides.
  const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) as Partial<MatchConfig>;
  return {
    seed: 1,
    slots: [],
    waves: true,
    neutrals: true,
    boss: true,
    structures: true,
    pregame: BALANCE.match.pregameSeconds,
    startingSouls: BALANCE.economy.startingSouls,
    mode: 'standard',
    difficulty: 'normal',
    ...defined,
  };
}

export interface Ping {
  team: TeamId;
  kind: PingKind;
  pos: Vec3;
  from: number;
  targetId: number;
  lane: number;
  time: number;
}

export interface TeamState {
  flexSlots: number;
  rejuvenatorUntil: number;
  kills: number;
  structuresDestroyed: number;
  pings: Ping[];
}

export type MatchPhase = 'pregame' | 'playing' | 'ended';

export interface SimPerf {
  tickMs: number;
  aiMs: number;
  heroesMs: number;
  unitsMs: number;
  projectilesMs: number;
}

interface Timer {
  at: number;
  fn: () => void;
}

const mapCache = new Map<string, MapDef>();
export function getMap(id = 'hexline-ward'): MapDef {
  let m = mapCache.get(id);
  if (!m) {
    if (id !== 'hexline-ward') throw new Error(`Unknown map ${id}`);
    m = buildHexlineWard();
    mapCache.set(id, m);
  }
  return m;
}

const worldCache = new WeakMap<MapDef, CollisionWorld>();
export function getWorld(map: MapDef): CollisionWorld {
  let w = worldCache.get(map);
  if (!w) {
    w = new CollisionWorld(map.bounds, map.solids);
    worldCache.set(map, w);
  }
  return w;
}

/**
 * Authoritative match simulation. Deterministic for a given seed and input
 * sequence, independent of rendering, and runnable headless in Node.
 */
export class Simulation {
  readonly tickRate = BALANCE.tickRate;
  readonly dt = 1 / BALANCE.tickRate;
  readonly config: MatchConfig;
  readonly map: MapDef;
  readonly world: CollisionWorld;
  readonly rng: Rng;
  readonly events = new EventQueue();
  readonly items: ItemSystem;
  readonly ziplines: ZipLine[];
  readonly tmpHit = makeHit();

  tick = 0;
  time = 0;
  phase: MatchPhase = 'pregame';
  winner: TeamId | -1 = -1;
  endTime = -1;
  /** Match clock: negative during pregame, 0 when troopers start. */
  matchStartTime: number;

  heroes: Hero[] = [];
  troopers: Trooper[] = [];
  structures: Structure[] = [];
  neutrals: Neutral[] = [];
  summons: Summon[] = [];
  projectiles: Projectile[] = [];
  orbs: SoulOrb[] = [];
  zones: Zone[] = [];
  pickups: Pickup[] = [];
  /** Telegraphed danger areas (structure stomps, salvos, boss slams). */
  hazards: { pos: Vec3; radius: number; until: number; team: number }[] = [];
  readonly units = new Map<number, AnyUnit>();
  readonly grid: SpatialGrid<AnyUnit>;
  teams: [TeamState, TeamState];
  waves: WaveState;
  camps: CampState[];
  boss: BossState;
  /** Last unit each hero damaged (summons assist their owner). */
  private lastTargets = new Map<number, number>();
  private timers: Timer[] = [];
  private nextId = 1;
  private structureByKey = new Map<string, Structure>();
  /** Per-tick hooks (AI) run before heroes update. */
  controllers: ((sim: Simulation) => void)[] = [];
  /** Set while resolving melee so trooper kills pay out directly. */
  meleeKillFlag = false;
  perf: SimPerf = { tickMs: 0, aiMs: 0, heroesMs: 0, unitsMs: 0, projectilesMs: 0 };

  constructor(config: Partial<MatchConfig>, map?: MapDef) {
    this.config = defaultConfig(config);
    this.map = map ?? getMap();
    this.world = getWorld(this.map);
    this.rng = new Rng(this.config.seed);
    this.items = new ItemSystem(this);
    this.ziplines = buildZipLines(this.map.ziplines);
    this.grid = new SpatialGrid(this.map.bounds.minX, this.map.bounds.minZ, this.map.bounds.maxX, this.map.bounds.maxZ, 8);
    const team = (): TeamState => ({ flexSlots: 0, rejuvenatorUntil: 0, kills: 0, structuresDestroyed: 0, pings: [] });
    this.teams = [team(), team()];
    this.waves = initWaves();
    this.camps = this.config.neutrals ? initCamps(this) : [];
    this.boss = { unitId: -1, respawnAt: this.config.boss ? BALANCE.midBoss.firstSpawn : Infinity, kills: 0 };
    this.matchStartTime = this.config.pregame;
    if (this.config.pregame <= 0) this.phase = 'playing';

    if (this.config.structures) {
      for (const p of this.map.structures) {
        const def = STRUCTURES[p.type];
        const s = new Structure(this.allocId(), p.team, def, p);
        s.pos = { ...p.pos };
        s.pos.y = this.world.groundHeight(p.pos.x, p.pos.z, 3);
        s.prevPos = { ...s.pos };
        this.structures.push(s);
        this.units.set(s.id, s);
        this.structureByKey.set(p.id, s);
      }
      refreshVulnerability(this);
    }
    for (const slot of this.config.slots) this.addHero(slot);
  }

  // --- Time ---------------------------------------------------------------------

  get matchTime(): number {
    return this.time - this.matchStartTime;
  }

  allocId(): number {
    return this.nextId++;
  }

  schedule(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  // --- Entity creation ---------------------------------------------------------

  addHero(slot: HeroSlot): Hero {
    const def: HeroDef | undefined = HEROES[slot.heroId];
    if (!def) throw new Error(`Unknown hero ${slot.heroId}`);
    const h = new Hero(this.allocId(), slot.team, def, slot.name, slot.isBot);
    const idx = this.heroes.filter((o) => o.team === slot.team).length;
    this.placeAtSpawn(h, idx);
    h.souls = this.config.startingSouls;
    this.heroes.push(h);
    this.units.set(h.id, h);
    // Derive stats immediately so the hero is valid before the first tick.
    applyHeroStats(h, deriveHeroStats(h));
    h.hp = h.maxHp;
    return h;
  }

  placeAtSpawn(h: Hero, idx: number): void {
    const sp = this.map.spawns[h.team0];
    const a = (idx / 6) * Math.PI * 2;
    h.pos.x = sp.pos.x + Math.cos(a) * 2.5;
    h.pos.z = sp.pos.z + Math.sin(a) * 1.5;
    h.pos.y = this.world.groundHeight(h.pos.x, h.pos.z, 3);
    h.prevPos = { ...h.pos };
    h.vel = { x: 0, y: 0, z: 0 };
    h.yaw = h.prevYaw = sp.yaw;
    h.input.yaw = sp.yaw;
    h.input.pitch = 0;
  }

  addTrooper(team: TeamId, def: TrooperDef, lane: LaneId, path: Vec3[]): Trooper {
    const t = new Trooper(this.allocId(), team, def, lane, path);
    t.spawnedAt = this.time;
    this.troopers.push(t);
    this.units.set(t.id, t);
    return t;
  }

  addNeutral(def: NeutralDef, campId: string, isBoss: boolean): Neutral {
    const n = new Neutral(this.allocId(), def, campId, isBoss);
    n.spawnedAt = this.time;
    this.neutrals.push(n);
    this.units.set(n.id, n);
    return n;
  }

  spawnSummon(
    owner: Hero,
    behavior: SummonBehavior,
    pos: Vec3,
    o: { hp: number; damage: number; range: number; attackInterval: number; speed: number; duration: number; visual: string; radius?: number; height?: number },
  ): Summon {
    const s = new Summon(this.allocId(), owner.team0, owner.id, behavior, this.time + o.duration, o.damage, o.range, o.attackInterval, o.speed, o.visual);
    s.maxHp = s.hp = o.hp;
    s.radius = o.radius ?? 0.5;
    s.height = o.height ?? 1.6;
    s.pos = { x: pos.x, y: this.world.groundHeight(pos.x, pos.z, pos.y + 1), z: pos.z };
    s.prevPos = { ...s.pos };
    s.yaw = owner.yaw;
    s.spawnedAt = this.time;
    this.summons.push(s);
    this.units.set(s.id, s);
    return s;
  }

  spawnProjectile(ownerId: number, team: number, kind: ProjectileKind): Projectile {
    const p = new Projectile(this.allocId(), ownerId, team as TeamId, kind);
    p.bornAt = this.time;
    this.projectiles.push(p);
    return p;
  }

  /** Straight projectile from a non-hero unit (troopers, neutrals, summons). */
  fireUnitProjectile(u: Unit, from: Vec3, to: Vec3, damage: number, speed: number, kind: ProjectileKind, vsHeroMul: number, range: number): Projectile {
    const p = this.spawnProjectile(u.id, u.team, kind);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    // Small inaccuracy so troopers don't laser heroes.
    const spread = 0.025;
    const ex = (this.rng.next() - 0.5) * spread;
    const ey = (this.rng.next() - 0.5) * spread;
    p.pos = { ...from };
    p.prevPos = { ...from };
    p.origin = { ...from };
    p.vel = { x: (dx / l + ex) * speed, y: (dy / l + ey) * speed, z: (dz / l - ex) * speed };
    p.damage = damage;
    p.dmgType = kind === 'ability' ? 'spirit' : 'bullet';
    p.maxDist = range;
    p.vsHeroMul = vsHeroMul;
    p.radius = 0.08;
    p.visual = kind === 'neutral' ? 'orbshot' : 'tracer-small';
    p.color = u.team === 0 ? '#ffc070' : u.team === 1 ? '#8cc8ff' : '#c58bff';
    return p;
  }

  spawnOrb(victimTeam: TeamId, value: number, pos: Vec3, killerId: number): SoulOrb {
    const o = new SoulOrb(this.allocId(), victimTeam, value, this.time, this.time + BALANCE.economy.orbLifetime, killerId);
    o.pos = { x: pos.x, y: pos.y + 1.6, z: pos.z };
    this.orbs.push(o);
    this.events.push({ t: 'orbSpawn', orb: o.id, pos: { ...o.pos } });
    return o;
  }

  spawnZone(ownerId: number, team: number, center: Vec3, radius: number, duration: number, tickInterval: number, onTick: (z: Zone) => void, visual: string, color: string, follow = -1): Zone {
    const z = new Zone(this.allocId(), ownerId, team as TeamId, radius, this.time + duration, tickInterval, onTick, visual, color, follow);
    z.pos = { ...center };
    z.nextTick = this.time;
    this.zones.push(z);
    return z;
  }

  // --- Queries ------------------------------------------------------------------

  allUnits(): AnyUnit[] {
    return [...this.units.values()];
  }

  /** Iterates units whose centre is within roughly r of pos (structures included). */
  forEachUnitNear(pos: { x: number; z: number }, r: number, fn: (u: AnyUnit) => void): void {
    this.grid.query(pos.x, pos.z, r + 4, (u) => {
      fn(u);
    });
  }

  forEachEnemyUnitNear(self: Unit, pos: Vec3, r: number, fn: (u: AnyUnit) => void): void {
    this.forEachUnitNear(pos, r, (u) => {
      if (!u.alive || u.team === self.team || u.id === self.id) return;
      if (distXZ(u.pos, pos) > r + u.radius) return;
      if (Math.abs(u.pos.y - pos.y) > 3) return;
      fn(u);
    });
  }

  structureDestroyed(key: string): boolean {
    const s = this.structureByKey.get(key);
    return !!s && !s.alive;
  }

  structureByKeyGet(key: string): Structure | undefined {
    return this.structureByKey.get(key);
  }

  lastTargetOf(heroId: number): number {
    return this.lastTargets.get(heroId) ?? -1;
  }

  inFountain(u: Unit): boolean {
    if (u.team !== 0 && u.team !== 1) return false;
    const z = this.map.spawns[u.team as TeamId].healZone;
    return u.pos.x >= z.minX && u.pos.x <= z.maxX && u.pos.z >= z.minZ && u.pos.z <= z.maxZ;
  }

  inEnemyFountain(u: Unit): boolean {
    if (u.team !== 0 && u.team !== 1) return false;
    const z = this.map.spawns[(1 - (u.team as number)) as TeamId].healZone;
    return u.pos.x >= z.minX && u.pos.x <= z.maxX && u.pos.z >= z.minZ && u.pos.z <= z.maxZ;
  }

  inShopRange(h: Hero): boolean {
    if (this.inFountain(h)) return true;
    for (const s of this.map.shops) if (s.team === h.team && distXZ(s.pos, h.pos) <= s.radius) return true;
    return false;
  }

  teamBuffMods(team: TeamId): StatMods[] {
    void team;
    return [];
  }

  // --- Combat hooks ------------------------------------------------------------

  dealDamage(target: AnyUnit, info: DamageInfo): number {
    const dealt = dealDamageImpl(this, target, info);
    const src = this.units.get(info.sourceId);
    if (src && src.kind === 'hero' && dealt > 0) this.lastTargets.set(src.id, target.id);
    if (target.kind === 'neutral' && target.alive && src) provokeCamp(this, target, src.id);
    return dealt;
  }

  heal(target: Unit, amount: number, sourceId: number, silent = false): number {
    return healImpl(this, target, amount, sourceId, silent);
  }

  interruptUnit(u: Unit, silenceOnly = false): void {
    if (u.kind !== 'hero') return;
    const h = u as Hero;
    interruptCast(this, h);
    if (!silenceOnly) {
      h.meleeStart = -1;
      h.meleeSwingAt = -1;
      if (h.forced && h.forced.kind !== 'knockback' && h.forced.kind !== 'pull') endForced(h);
    }
  }

  notifyHeroAggression(attacker: Hero, victim: Hero): void {
    const window = BALANCE.structures.aggroWindow;
    for (const s of this.structures) {
      if (!s.alive || s.team !== victim.team || s.def.range <= 0) continue;
      if (distXZ(s.pos, attacker.pos) <= s.def.range + 2) {
        s.aggroHero = attacker.id;
        s.aggroUntil = this.time + window;
      }
    }
    this.forEachUnitNear(victim.pos, 14, (u) => {
      if (u.kind === 'trooper' && u.alive && u.team === victim.team) {
        u.aggroHero = attacker.id;
        u.aggroUntil = this.time + window;
      }
    });
  }

  knockOffZipline(h: Hero): void {
    if (!h.zip) return;
    detachZipline(this, h, false);
    applyStatus(this, h, { id: 'zip-knock', name: 'Knocked Off', duration: BALANCE.zipline.knockOffStun, flags: SF.STUN, debuff: true, vfx: 'stun' }, -1);
  }

  knockbackUnit(u: AnyUnit, dx: number, dz: number, speed: number, up: number): void {
    if (u.kind === 'structure' || u.kind === 'boss' || u.flags & SF.UNSTOPPABLE) return;
    const l = Math.hypot(dx, dz) || 1;
    if (u.kind === 'hero') {
      if (u.zip) this.knockOffZipline(u);
      endForced(u);
      u.forced = { kind: 'knockback', vel: { x: (dx / l) * speed, y: up, z: (dz / l) * speed }, end: this.time + 0.4, ballistic: true, hitIds: [], stopOnWall: true };
      u.grounded = false;
    } else {
      u.pos.x += (dx / l) * speed * 0.15;
      u.pos.z += (dz / l) * speed * 0.15;
    }
  }

  /** Structures are solid cylinders for heroes and troopers. */
  resolveStructureCollision(u: Unit): void {
    for (const s of this.structures) {
      if (!s.alive) continue;
      const dx = u.pos.x - s.pos.x;
      const dz = u.pos.z - s.pos.z;
      const r = s.radius + u.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || u.pos.y > s.pos.y + s.height) continue;
      const d = Math.sqrt(d2) || 1e-3;
      u.pos.x = s.pos.x + (dx / d) * r;
      u.pos.z = s.pos.z + (dz / d) * r;
    }
  }

  rescueUnit(h: Hero): void {
    const idx = this.heroes.filter((o) => o.team === h.team).indexOf(h);
    this.placeAtSpawn(h, Math.max(0, idx));
    h.forced = null;
    h.zip = null;
  }

  claimOrb(orb: SoulOrb, shooterId: number): void {
    claimOrb(this, orb, shooterId);
  }

  addHazard(pos: Vec3, radius: number, duration: number, team: number): void {
    this.hazards.push({ pos: { ...pos }, radius, until: this.time + duration, team });
  }

  announce(text: string, team: number, kind: 'objective' | 'kill' | 'info' | 'boss' | 'warning'): void {
    this.events.push({ t: 'announce', text, team, kind });
  }

  addPing(h: Hero, kind: PingKind, x: number, z: number, targetId?: number, lane?: number): void {
    const team = this.teams[h.team0];
    const ping: Ping = { team: h.team0, kind, pos: { x, y: 0, z }, from: h.id, targetId: targetId ?? -1, lane: lane ?? -1, time: this.time };
    team.pings.push(ping);
    if (team.pings.length > 12) team.pings.shift();
    this.events.push({ t: 'ping', team: h.team0, kind, pos: { ...ping.pos }, from: h.id, targetId: ping.targetId });
  }

  // --- Death & respawn ------------------------------------------------------------

  killUnit(u: AnyUnit, killerId: number): void {
    if (!u.alive) return;
    if (u.kind === 'structure' && !structureDowned(this, u)) return;
    u.alive = false;
    u.hp = 0;
    u.diedAt = this.time;
    this.events.push({ t: 'death', unit: u.id, kind: u.kind, killer: killerId, pos: { ...u.pos } });
    switch (u.kind) {
      case 'hero':
        interruptCast(this, u);
        if (u.zip) detachZipline(this, u, false);
        u.forced = null;
        u.statuses = [];
        u.flags = 0;
        u.dashEnd = 0;
        u.sliding = false;
        onHeroKilled(this, u, killerId);
        break;
      case 'trooper':
        onTrooperKilled(this, u, killerId, this.meleeKillFlag);
        break;
      case 'structure':
        onStructureDestroyed(this, u, killerId);
        this.events.push({ t: 'structure', id: u.id, key: u.key, state: 'destroyed' });
        this.announce(`${u.team === 0 ? 'Amber' : 'Azure'} ${u.def.name} destroyed`, -1, 'objective');
        refreshVulnerability(this);
        if (u.def.type === 'patron') this.endMatch((1 - (u.team as number)) as TeamId);
        break;
      case 'neutral':
        onNeutralKilled(this, u, killerId);
        break;
      case 'boss':
        this.onBossKilled(u, killerId);
        break;
      case 'summon':
        break;
    }
  }

  private onBossKilled(b: Neutral, killerId: number): void {
    this.boss.unitId = -1;
    this.boss.respawnAt = this.matchTime + BALANCE.midBoss.respawn;
    this.boss.kills++;
    const killer = this.units.get(killerId);
    if (killer && killer.kind === 'hero') {
      for (const h of this.heroes) if (h.team === killer.team) {
        h.souls += BALANCE.midBoss.teamSouls;
        h.netWorth += BALANCE.midBoss.teamSouls;
        h.match.soulsEarned += BALANCE.midBoss.teamSouls;
        this.events.push({ t: 'souls', hero: h.id, amount: BALANCE.midBoss.teamSouls, pos: { ...b.pos }, source: 'boss' });
      }
    }
    this.pickups.push({ id: this.allocId(), kind: 'rejuvenator', pos: { ...b.pos, y: 0.6 }, alive: true, spawnTime: this.time, expireTime: this.time + 120 });
    this.announce('The Hollow King has fallen — claim the Rejuvenator!', -1, 'boss');
  }

  respawnHero(h: Hero): void {
    const idx = this.heroes.filter((o) => o.team === h.team).indexOf(h);
    this.placeAtSpawn(h, Math.max(0, idx));
    h.alive = true;
    h.diedAt = -1;
    h.hp = h.maxHp;
    h.statuses = [];
    h.flags = 0;
    h.attackers.clear();
    h.weapon.ammo = h.weapon.magazine;
    h.weapon.reloading = false;
    h.stamina = h.stats.stamina;
    h.cast = null;
    h.forced = null;
    h.zip = null;
    h.lastDamagedAt = -999;
    h.lastCombatTime = -999;
    this.events.push({ t: 'respawn', unit: h.id });
  }

  endMatch(winner: TeamId): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.winner = winner;
    this.endTime = this.time;
    this.events.push({ t: 'match', state: 'ended', winner });
    this.announce(`${winner === 0 ? 'Amber Covenant' : 'Azure Lodge'} wins!`, -1, 'objective');
  }

  // --- Main loop -----------------------------------------------------------------

  step(): void {
    const t0 = now();
    this.tick++;
    this.time += this.dt;
    const dt = this.dt;

    if (this.phase === 'pregame' && this.matchTime >= 0) {
      this.phase = 'playing';
      this.events.push({ t: 'match', state: 'playing' });
      this.announce('Troopers are deploying — the match has begun!', -1, 'info');
    }

    for (const u of this.units.values()) {
      u.prevPos.x = u.pos.x;
      u.prevPos.y = u.pos.y;
      u.prevPos.z = u.pos.z;
      u.prevYaw = u.yaw;
    }

    this.grid.clear();
    for (const u of this.units.values()) if (u.alive) this.grid.insert(u);

    const tAi = now();
    for (const c of this.controllers) c(this);
    this.perf.aiMs = now() - tAi;

    for (const u of this.units.values()) if (u.alive) updateStatuses(this, u, dt);

    const tH = now();
    for (const h of this.heroes) {
      updateHero(this, h, dt);
      this.items.update(h, dt);
    }
    this.perf.heroesMs = now() - tH;

    const tU = now();
    if (this.phase !== 'ended') {
      updateTroopers(this, dt);
      updateSummons(this, dt);
      updateCamps(this);
      updateNeutrals(this, dt);
      updateStructures(this, dt);
    }
    this.perf.unitsMs = now() - tU;

    const tP = now();
    updateProjectiles(this, dt);
    this.perf.projectilesMs = now() - tP;
    updateOrbs(this, dt);
    this.updateZones();
    this.updatePickups();
    this.runTimers();
    if (this.phase === 'playing') {
      updateWaves(this);
      passiveIncome(this);
      this.fountainDefense(dt);
    }
    updateVision(this);
    this.cleanup();
    this.perf.tickMs = now() - t0;
  }

  private updateZones(): void {
    for (const z of this.zones) {
      if (!z.alive) continue;
      if (z.followUnit >= 0) {
        const u = this.units.get(z.followUnit);
        if (u && u.alive) {
          z.pos.x = u.pos.x;
          z.pos.y = u.pos.y;
          z.pos.z = u.pos.z;
        } else z.endTime = this.time;
      }
      if (this.time >= z.endTime) {
        z.alive = false;
        continue;
      }
      if (this.time >= z.nextTick) {
        z.nextTick += z.tickInterval;
        z.onTick(z);
      }
    }
  }

  private updatePickups(): void {
    for (const p of this.pickups) {
      if (!p.alive) continue;
      if (this.time >= p.expireTime) {
        p.alive = false;
        continue;
      }
      for (const h of this.heroes) {
        if (!h.alive || distXZ(h.pos, p.pos) > 1.8 || Math.abs(h.pos.y - p.pos.y) > 2.5) continue;
        p.alive = false;
        if (p.kind === 'rejuvenator') {
          this.teams[h.team0].rejuvenatorUntil = this.time + BALANCE.midBoss.rejuvenatorDuration;
          this.announce(`${h.playerName} claimed the Rejuvenator for ${h.team === 0 ? 'Amber' : 'Azure'}!`, -1, 'boss');
        }
        break;
      }
    }
  }

  private fountainDefense(dt: number): void {
    for (const h of this.heroes) {
      if (h.alive && this.inEnemyFountain(h)) {
        this.dealDamage(h, { sourceId: -1, amount: h.maxHp * 0.35 * dt, type: 'pure', noLifesteal: true });
      }
    }
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const due: Timer[] = [];
    const keep: Timer[] = [];
    for (const t of this.timers) (t.at <= this.time ? due : keep).push(t);
    this.timers = keep;
    for (const t of due) t.fn();
  }

  private cleanup(): void {
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
    if (this.orbs.some((o) => !o.alive)) this.orbs = this.orbs.filter((o) => o.alive);
    if (this.zones.some((z) => !z.alive)) this.zones = this.zones.filter((z) => z.alive);
    if (this.pickups.some((p) => !p.alive)) this.pickups = this.pickups.filter((p) => p.alive);
    if (this.hazards.length && this.hazards.some((h) => h.until <= this.time)) this.hazards = this.hazards.filter((h) => h.until > this.time);
    if (this.tick % 30 !== 0) return;
    // Corpses linger briefly for death animations, then are removed.
    const expired = (u: Unit) => !u.alive && u.diedAt >= 0 && this.time - u.diedAt > 2.5;
    const drop = <T extends AnyUnit>(list: T[]): T[] => {
      if (!list.some(expired)) return list;
      return list.filter((u) => {
        if (expired(u)) {
          this.units.delete(u.id);
          return false;
        }
        return true;
      });
    };
    this.troopers = drop(this.troopers);
    this.neutrals = drop(this.neutrals);
    this.summons = drop(this.summons);
  }

  /** Runs the simulation for a number of seconds (headless helper). */
  run(seconds: number): void {
    const n = Math.round(seconds * this.tickRate);
    for (let i = 0; i < n; i++) this.step();
  }
}

const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
