import { ITEM_MAP } from '../../data/items';
import { NEUTRALS, TROOPERS } from '../../data/units';
import type { SimEvent } from '../core/events';
import type { Vec3 } from '../core/math';
import type { MatchPhase, Simulation } from '../core/simulation';
import {
  Hero,
  Neutral,
  Projectile,
  SoulOrb,
  Summon,
  Trooper,
  Zone,
  type HeroMatchStats,
  type HeroStats,
  type ProjectileKind,
  type SummonBehavior,
} from '../gameplay/entities';
import { lanePathFor } from '../gameplay/troopers';
import type { StatusSpec } from '../gameplay/types';
import type { AnyTeam, LaneId, TeamId } from '../world/mapTypes';

/**
 * State snapshots: everything presentation (renderer, HUD, minimap, audio)
 * reads from the simulation, encoded per viewing team. The server only sends
 * an enemy hero's (or summon's) position and combat state while the viewer's
 * team can see it, so a modified client cannot reveal hidden enemies.
 */

type V = [number, number, number];
type B = 0 | 1;

export interface HeroSnap {
  id: number;
  name: string;
  bot: B;
  alive: B;
  hp: number;
  maxHp: number;
  diedAt: number;
  respawnAt: number;
  level: number;
  souls: number;
  netWorth: number;
  ap: number;
  streak: number;
  m: HeroMatchStats;
  it: [string, number][];
  vis: [B, B];
  /** Present only while visible to the viewer's team (always for allies). */
  live?: HeroLive;
}

export interface HeroLive {
  p: V;
  v: V;
  yaw: number;
  pitch: number;
  flags: number;
  g: B;
  cr: B;
  sl: B;
  landedAt: number;
  dashEnd: number;
  freeAmmo: number;
  stamina: number;
  staminaNext: number;
  zip: [number, number, 1 | -1, number] | null;
  forced: string | null;
  cast: [number, 'windup' | 'channel', number, number, number] | null;
  melee: [number, number, B];
  parryUntil: number;
  w: [number, number, B, number, number];
  ab: [number, number, number, number][];
  st: StatusSnap[];
  stats: HeroStats;
  shop: B;
  fountain: B;
  lastShot: number;
  lastCombat: number;
  in: [number, number, number, number, number];
}

export interface StatusSnap {
  spec: StatusSpec;
  src: number;
  start: number;
  end: number;
  stacks: number;
  shield: number;
}

export interface TrooperSnap { id: number; tm: TeamId; d: string; ln: LaneId; p: V; v: V; yaw: number; hp: number; maxHp: number; alive: B; diedAt: number; aa: number; fl: number; vis: [B, B] }
export interface StructureSnap { id: number; hp: number; maxHp: number; h: number; alive: B; diedAt: number; vul: B; ph: 1 | 2; tg: number; aa: number; bd: B; fl: number }
export interface NeutralSnap { id: number; d: string; c: string; b: B; p: V; v: V; yaw: number; hp: number; maxHp: number; alive: B; diedAt: number; aa: number; fl: number; tg: number }
export interface SummonSnap { id: number; tm: TeamId; o: number; bh: SummonBehavior; vs: string; p: V; yaw: number; hp: number; maxHp: number; alive: B; end: number; fl: number; aa: number; r: number; h: number }
export interface ProjectileSnap { id: number; o: number; tm: AnyTeam; k: ProjectileKind; vs: string; c: string; p: V; v: V; g: number; r: number; tr: number }
export interface OrbSnap { id: number; vt: TeamId; val: number; st: number; ex: number; p: V }
export interface ZoneSnap { id: number; o: number; tm: AnyTeam; r: number; end: number; vs: string; c: string; p: V; f: number }

export interface Snapshot {
  tick: number;
  time: number;
  phase: MatchPhase;
  winner: TeamId | -1;
  endTime: number;
  mst: number;
  teams: { flexSlots: number; rejuvenatorUntil: number; kills: number; structuresDestroyed: number; pings: Simulation['teams'][0]['pings'] }[];
  boss: Simulation['boss'];
  camps: { units: number[]; respawnAt: number; clearedBy: number }[];
  heroes: HeroSnap[];
  troopers: TrooperSnap[];
  structures: StructureSnap[];
  neutrals: NeutralSnap[];
  summons: SummonSnap[];
  projectiles: ProjectileSnap[];
  orbs: OrbSnap[];
  zones: ZoneSnap[];
  pickups: Simulation['pickups'];
  hazards: Simulation['hazards'];
  events: SimEvent[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const vec = (p: Vec3): V => [r3(p.x), r3(p.y), r3(p.z)];
const b = (x: boolean): B => (x ? 1 : 0);
const vis = (u: { visibleTo: [boolean, boolean] }): [B, B] => [b(u.visibleTo[0]), b(u.visibleTo[1])];

/** True when `viewerTeam` may see this unit's live state. Spectators (-1) see all. */
function canSee(u: { team: AnyTeam; visibleTo: [boolean, boolean]; alive: boolean }, viewerTeam: TeamId | -1): boolean {
  if (viewerTeam === -1 || u.team === viewerTeam || u.team === 2) return true;
  return u.visibleTo[viewerTeam] || !u.alive;
}

function heroLive(h: Hero): HeroLive {
  const w = h.weapon;
  return {
    p: vec(h.pos),
    v: vec(h.vel),
    yaw: r3(h.yaw),
    pitch: r3(h.pitch),
    flags: h.flags,
    g: b(h.grounded),
    cr: b(h.crouching),
    sl: b(h.sliding),
    landedAt: r3(h.landedAt),
    dashEnd: r3(h.dashEnd),
    freeAmmo: r3(h.freeAmmoUntil),
    stamina: r2(h.stamina),
    staminaNext: r3(h.staminaNext),
    zip: h.zip ? [h.zip.lineIndex, r3(h.zip.s), h.zip.dir, r3(h.zip.attachTime)] : null,
    forced: h.forced ? h.forced.kind : null,
    cast: h.cast ? [h.cast.slot, h.cast.phase, r3(h.cast.start), r3(h.cast.end), h.cast.targetId] : null,
    melee: [r3(h.meleeStart), r3(h.meleeSwingAt), b(h.meleeHeavy)],
    parryUntil: r3(h.parryUntil),
    w: [w.ammo, w.magazine, b(w.reloading), r3(w.reloadEnd), r3(w.spread)],
    ab: h.abilities.map((a) => [a.level, r3(a.cooldownEnd), a.charges, r3(a.nextCharge)]),
    st: h.statuses.map((s) => ({ spec: s.spec, src: s.sourceId, start: r3(s.startTime), end: r3(s.endTime), stacks: s.stacks, shield: r2(s.shieldLeft) })),
    stats: h.stats,
    shop: b(h.inShopRange),
    fountain: b(h.inFountain),
    lastShot: r3(h.lastShotTime),
    lastCombat: r3(h.lastCombatTime),
    in: [r3(h.input.moveX), r3(h.input.moveZ), r3(h.input.yaw), r3(h.input.pitch), h.input.buttons],
  };
}

/** Events that would reveal a hidden enemy hero's actions are withheld. */
export function filterEvents(sim: Simulation, events: SimEvent[], viewerTeam: TeamId | -1, viewerHero: number): SimEvent[] {
  if (viewerTeam === -1) return events.filter((e) => e.t !== 'announce' || e.unit === undefined);
  const hidden = (id: number | undefined) => {
    if (id === undefined) return false;
    const u = sim.units.get(id);
    return !!u && u.kind === 'hero' && !canSee(u, viewerTeam);
  };
  return events.filter((e) => {
    switch (e.t) {
      case 'shot':
      case 'cast':
      case 'move':
      case 'reload':
      case 'melee':
      case 'zip':
      case 'status':
        return !hidden(e.unit);
      case 'vfx':
        return !hidden(e.unit);
      case 'parry':
        return !hidden(e.unit);
      case 'ping':
        return e.team === viewerTeam;
      case 'botSay':
        return e.team === viewerTeam;
      case 'announce':
        if (e.unit !== undefined) return e.unit === viewerHero;
        return e.team === -1 || e.team === viewerTeam;
      default:
        return true;
    }
  });
}

/** Encodes the simulation as seen by `viewerTeam` (-1 = spectator, sees everything). */
export function encodeSnapshot(sim: Simulation, viewerTeam: TeamId | -1, events: SimEvent[]): Snapshot {
  return {
    tick: sim.tick,
    time: sim.time,
    phase: sim.phase,
    winner: sim.winner,
    endTime: sim.endTime,
    mst: sim.matchStartTime,
    teams: sim.teams.map((t, i) => ({
      flexSlots: t.flexSlots,
      rejuvenatorUntil: t.rejuvenatorUntil,
      kills: t.kills,
      structuresDestroyed: t.structuresDestroyed,
      pings: viewerTeam === -1 || viewerTeam === i ? t.pings : [],
    })),
    boss: { ...sim.boss },
    camps: sim.camps.map((c) => ({ units: c.unitIds, respawnAt: c.respawnAt, clearedBy: c.clearedBy })),
    heroes: sim.heroes.map((h) => ({
      id: h.id,
      name: h.playerName,
      bot: b(h.isBot),
      alive: b(h.alive),
      hp: r2(h.hp),
      maxHp: r2(h.maxHp),
      diedAt: r3(h.diedAt),
      respawnAt: r3(h.respawnAt),
      level: h.level,
      souls: Math.floor(h.souls),
      netWorth: Math.floor(h.netWorth),
      ap: h.abilityPoints,
      streak: h.killStreak,
      m: h.match,
      it: h.items.map((i) => [i.def.id, r3(i.cooldownEnd)]),
      vis: vis(h),
      live: canSee(h, viewerTeam) ? heroLive(h) : undefined,
    })),
    troopers: sim.troopers.map((t) => ({
      id: t.id, tm: t.team as TeamId, d: t.def.id, ln: t.lane, p: vec(t.pos), v: vec(t.vel), yaw: r3(t.yaw),
      hp: r2(t.hp), maxHp: r2(t.maxHp), alive: b(t.alive), diedAt: r3(t.diedAt), aa: r3(t.attackAnim), fl: t.flags, vis: vis(t),
    })),
    structures: sim.structures.map((s) => ({
      id: s.id, hp: r2(s.hp), maxHp: r2(s.maxHp), h: s.height, alive: b(s.alive), diedAt: r3(s.diedAt), vul: b(s.vulnerable),
      ph: s.phase, tg: s.targetId, aa: r3(s.attackAnim), bd: b(s.backdoor), fl: s.flags,
    })),
    neutrals: sim.neutrals.map((n) => ({
      id: n.id, d: n.def.id, c: n.campId, b: b(n.kind === 'boss'), p: vec(n.pos), v: vec(n.vel), yaw: r3(n.yaw),
      hp: r2(n.hp), maxHp: r2(n.maxHp), alive: b(n.alive), diedAt: r3(n.diedAt), aa: r3(n.attackAnim), fl: n.flags, tg: n.targetId,
    })),
    summons: sim.summons
      .filter((s) => canSee(s, viewerTeam))
      .map((s) => ({
        id: s.id, tm: s.team as TeamId, o: s.ownerId, bh: s.behavior, vs: s.visual, p: vec(s.pos), yaw: r3(s.yaw),
        hp: r2(s.hp), maxHp: r2(s.maxHp), alive: b(s.alive), end: r3(s.endTime), fl: s.flags, aa: r3(s.attackAnim), r: s.radius, h: s.height,
      })),
    projectiles: sim.projectiles
      .filter((p) => p.alive)
      .map((p) => ({ id: p.id, o: p.ownerId, tm: p.team, k: p.kind, vs: p.visual, c: p.color, p: vec(p.pos), v: vec(p.vel), g: p.gravity, r: p.radius, tr: r2(p.traveled) })),
    orbs: sim.orbs.filter((o) => o.alive).map((o) => ({ id: o.id, vt: o.victimTeam, val: o.value, st: o.spawnTime, ex: o.expireTime, p: vec(o.pos) })),
    zones: sim.zones
      .filter((z) => z.alive)
      // Enemy traps and mines are invisible to the other team.
      .filter((z) => viewerTeam === -1 || z.team === viewerTeam || (z.visual !== 'trap' && z.visual !== 'mine'))
      .map((z) => ({ id: z.id, o: z.ownerId, tm: z.team, r: z.radius, end: z.endTime, vs: z.visual, c: z.color, p: vec(z.pos), f: z.followUnit })),
    pickups: sim.pickups.filter((p) => p.alive),
    hazards: sim.hazards,
    events,
  };
}

// --- Client side ---------------------------------------------------------------

const toV = (a: V, out: Vec3): Vec3 => {
  out.x = a[0];
  out.y = a[1];
  out.z = a[2];
  return out;
};

function moveTo(u: { pos: Vec3; prevPos: Vec3; yaw: number; prevYaw: number }, p: V, yaw: number, fresh: boolean): void {
  if (fresh) toV(p, u.prevPos);
  else {
    u.prevPos.x = u.pos.x;
    u.prevPos.y = u.pos.y;
    u.prevPos.z = u.pos.z;
  }
  toV(p, u.pos);
  u.prevYaw = fresh ? yaw : u.yaw;
  u.yaw = yaw;
}

function applyHero(sim: Simulation, h: Hero, s: HeroSnap, keepInput: boolean): void {
  h.playerName = s.name;
  h.isBot = s.bot === 1;
  const wasAlive = h.alive;
  h.alive = s.alive === 1;
  h.hp = s.hp;
  h.maxHp = s.maxHp;
  h.diedAt = s.diedAt;
  h.respawnAt = s.respawnAt;
  h.level = s.level;
  h.souls = s.souls;
  h.netWorth = s.netWorth;
  h.abilityPoints = s.ap;
  h.killStreak = s.streak;
  h.match = s.m;
  h.visibleTo = [s.vis[0] === 1, s.vis[1] === 1];
  if (h.items.length !== s.it.length || h.items.some((it, i) => it.def.id !== s.it[i][0])) {
    h.items = s.it.filter(([id]) => ITEM_MAP[id]).map(([id, cd]) => ({ def: ITEM_MAP[id], cooldownEnd: cd, procReadyAt: 0 }));
  } else s.it.forEach(([, cd], i) => (h.items[i].cooldownEnd = cd));
  const l = s.live;
  if (!l) return;
  // A respawn teleports: don't interpolate across the map.
  moveTo(h, l.p, l.yaw, h.alive && !wasAlive);
  toV(l.v, h.vel);
  h.pitch = l.pitch;
  h.flags = l.flags;
  h.grounded = l.g === 1;
  h.crouching = l.cr === 1;
  h.sliding = l.sl === 1;
  h.landedAt = l.landedAt;
  h.dashEnd = l.dashEnd;
  h.freeAmmoUntil = l.freeAmmo;
  h.stamina = l.stamina;
  h.staminaNext = l.staminaNext;
  h.zip = l.zip ? { lineIndex: l.zip[0], s: l.zip[1], dir: l.zip[2], attachTime: l.zip[3] } : null;
  h.forced = l.forced
    ? { kind: l.forced as 'dash' | 'leap' | 'knockback' | 'pull', vel: { ...h.vel }, end: sim.time + 0.1, ballistic: false, hitIds: [], stopOnWall: false }
    : null;
  h.cast = l.cast
    ? { slot: l.cast[0], phase: l.cast[1], start: l.cast[2], end: l.cast[3], targetId: l.cast[4], aimDir: { x: 0, y: 0, z: 1 }, aimPoint: { ...h.pos } }
    : null;
  h.meleeStart = l.melee[0];
  h.meleeSwingAt = l.melee[1];
  h.meleeHeavy = l.melee[2] === 1;
  h.parryUntil = l.parryUntil;
  const w = h.weapon;
  w.ammo = l.w[0];
  w.magazine = l.w[1];
  w.reloading = l.w[2] === 1;
  w.reloadEnd = l.w[3];
  w.spread = l.w[4];
  l.ab.forEach((a, i) => {
    const st = h.abilities[i];
    if (!st) return;
    st.level = a[0];
    st.cooldownEnd = a[1];
    st.charges = a[2];
    st.nextCharge = a[3];
  });
  h.statuses = l.st.map((x) => ({ spec: x.spec, sourceId: x.src, startTime: x.start, endTime: x.end, stacks: x.stacks, shieldLeft: x.shield, dotAccum: 0 }));
  h.stats = l.stats;
  h.inShopRange = l.shop === 1;
  h.inFountain = l.fountain === 1;
  h.lastShotTime = l.lastShot;
  h.lastCombatTime = l.lastCombat;
  if (!keepInput) h.input = { moveX: l.in[0], moveZ: l.in[1], yaw: l.in[2], pitch: l.in[3], buttons: l.in[4] };
}

/** Rebuilds `list` in snapshot order, creating and removing units in `sim.units`. */
function reconcile<T extends { id: number }, S extends { id: number }>(
  sim: Simulation,
  list: T[],
  snaps: S[],
  create: (s: S) => T | null,
  update: (u: T, s: S, fresh: boolean) => void,
  registerUnit: boolean,
): T[] {
  const byId = new Map(list.map((u) => [u.id, u]));
  const out: T[] = [];
  for (const s of snaps) {
    let u = byId.get(s.id);
    let fresh = false;
    if (u) byId.delete(s.id);
    else {
      const c = create(s);
      if (!c) continue;
      u = c;
      fresh = true;
      if (registerUnit) sim.units.set(u.id, u as never);
    }
    update(u, s, fresh);
    out.push(u);
  }
  if (registerUnit) for (const id of byId.keys()) sim.units.delete(id);
  return out;
}

/**
 * Applies a snapshot to a client-side mirror simulation built from the same
 * match config (so structures and heroes share ids with the server). The
 * mirror is never stepped; it is a state container for presentation.
 */
export function applySnapshot(sim: Simulation, s: Snapshot, localHeroId = -1): void {
  sim.tick = s.tick;
  sim.time = s.time;
  sim.phase = s.phase;
  sim.winner = s.winner;
  sim.endTime = s.endTime;
  sim.matchStartTime = s.mst;
  s.teams.forEach((t, i) => Object.assign(sim.teams[i], t));
  Object.assign(sim.boss, s.boss);
  s.camps.forEach((c, i) => {
    const camp = sim.camps[i];
    if (!camp) return;
    camp.unitIds = c.units;
    camp.respawnAt = c.respawnAt;
    camp.clearedBy = c.clearedBy;
  });

  for (const hs of s.heroes) {
    const h = sim.units.get(hs.id);
    if (h && h.kind === 'hero') applyHero(sim, h, hs, h.id === localHeroId);
  }

  for (const st of s.structures) {
    const u = sim.units.get(st.id);
    if (!u || u.kind !== 'structure') continue;
    u.hp = st.hp;
    u.maxHp = st.maxHp;
    u.height = st.h;
    u.alive = st.alive === 1;
    u.diedAt = st.diedAt;
    u.vulnerable = st.vul === 1;
    u.phase = st.ph;
    u.targetId = st.tg;
    u.attackAnim = st.aa;
    u.backdoor = st.bd === 1;
    u.flags = st.fl;
  }

  sim.troopers = reconcile(
    sim,
    sim.troopers,
    s.troopers,
    (t) => (TROOPERS[t.d] ? new Trooper(t.id, t.tm, TROOPERS[t.d], t.ln, lanePathFor(sim, t.ln, t.tm)) : null),
    (u, t, fresh) => {
      moveTo(u, t.p, t.yaw, fresh);
      toV(t.v, u.vel);
      u.hp = t.hp;
      u.maxHp = t.maxHp;
      u.alive = t.alive === 1;
      u.diedAt = t.diedAt;
      u.attackAnim = t.aa;
      u.flags = t.fl;
      u.visibleTo = [t.vis[0] === 1, t.vis[1] === 1];
    },
    true,
  );

  sim.neutrals = reconcile(
    sim,
    sim.neutrals,
    s.neutrals,
    (n) => {
      const def = NEUTRALS[n.d];
      if (!def) return null;
      const u = new Neutral(n.id, def, n.c, n.b === 1);
      return u;
    },
    (u, n, fresh) => {
      moveTo(u, n.p, n.yaw, fresh);
      if (fresh) toV(n.p, u.home);
      toV(n.v, u.vel);
      u.hp = n.hp;
      u.maxHp = n.maxHp;
      u.alive = n.alive === 1;
      u.diedAt = n.diedAt;
      u.attackAnim = n.aa;
      u.flags = n.fl;
      u.targetId = n.tg;
    },
    true,
  );

  sim.summons = reconcile(
    sim,
    sim.summons,
    s.summons,
    (x) => new Summon(x.id, x.tm, x.o, x.bh, x.end, 0, 0, 1, 0, x.vs),
    (u, x, fresh) => {
      moveTo(u, x.p, x.yaw, fresh);
      u.hp = x.hp;
      u.maxHp = x.maxHp;
      u.alive = x.alive === 1;
      u.endTime = x.end;
      u.flags = x.fl;
      u.attackAnim = x.aa;
      u.radius = x.r;
      u.height = x.h;
    },
    true,
  );

  sim.projectiles = reconcile(
    sim,
    sim.projectiles,
    s.projectiles,
    (p) => new Projectile(p.id, p.o, p.tm, p.k),
    (u, p, fresh) => {
      if (fresh) toV(p.p, u.origin);
      toV(fresh ? p.p : [u.pos.x, u.pos.y, u.pos.z], u.prevPos);
      toV(p.p, u.pos);
      toV(p.v, u.vel);
      u.visual = p.vs;
      u.color = p.c;
      u.gravity = p.g;
      u.radius = p.r;
      u.traveled = p.tr;
    },
    false,
  );

  sim.orbs = reconcile(
    sim,
    sim.orbs,
    s.orbs,
    (o) => new SoulOrb(o.id, o.vt, o.val, o.st, o.ex, -1),
    (u, o) => {
      toV(o.p, u.pos);
    },
    false,
  );

  sim.zones = reconcile(
    sim,
    sim.zones,
    s.zones,
    (z) => new Zone(z.id, z.o, z.tm, z.r, z.end, 1, () => {}, z.vs, z.c, z.f),
    (u, z) => {
      toV(z.p, u.pos);
      u.radius = z.r;
      u.endTime = z.end;
    },
    false,
  );

  sim.pickups = s.pickups;
  sim.hazards = s.hazards;
}

/**
 * Visual-only extrapolation between snapshots: advances projectiles along
 * their velocity so fast tracers move smoothly at render rate.
 */
export function extrapolateProjectiles(sim: Simulation, dt: number): void {
  for (const p of sim.projectiles) {
    p.vel.y -= p.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    p.traveled += Math.hypot(p.vel.x, p.vel.y, p.vel.z) * dt;
  }
}
