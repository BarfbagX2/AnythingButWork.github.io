import { DIFFICULTY, PERSONALITIES, type DifficultyProfile, type Personality } from '../../data/ai';
import { BALANCE } from '../../data/balance';
import { ITEM_MAP } from '../../data/items';
import type { Simulation } from '../core/simulation';
import { BTN, ABILITY_BTNS, ITEM_BTNS, emptyInput, type InputCommand } from '../core/input';
import { distXZ, type Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { abilityParam } from '../gameplay/abilities';
import { heroEye } from '../gameplay/combat';
import type { AnyUnit, Hero } from '../gameplay/entities';
import { SF, type AbilityDef } from '../gameplay/types';
import type { NavGrid } from '../world/nav';
import { AimController } from './aim';
import { Navigator, type MoveIntent } from './navigator';
import { Perception, type Contact } from './perception';
import { chooseNextBuy, spendAbilityPoints } from './shopping';
import { evaluateGoals, type Goal } from './strategy';
import type { TeamCoordinator } from './team';

export interface BotDebug {
  goal: string;
  reason: string;
  utilities: { kind: string; score: number; reason: string }[];
  state: string;
  targetId: number;
  targetKind: string;
  destination: Vec3 | null;
  path: Vec3[];
  contacts: { id: number; pos: Vec3; visible: boolean; age: number; kind: string }[];
  threat: number;
  action: string;
  retreatReason: string;
  intent: string;
}

interface CombatTarget {
  id: number;
  kind: AnyUnit['kind'] | 'orb';
  point: Vec3;
  vel: Vec3;
  radius: number;
  score: number;
}

interface PendingCast {
  slot: number;
  point: Vec3;
  targetId: number;
  deadline: number;
  lob?: { speed: number; gravity: number; bias: number };
  label: string;
}

const HAZARD_KINDS = new Set(['fire', 'static', 'singularity', 'lockdown', 'siphon']);

/**
 * Layered bot controller: perception → strategy (utility goals) → tactics
 * (targets, positioning, abilities) → motor control (navigation, aim, fire).
 * Its only output is the same InputCommand a human produces.
 */
export class BotBrain {
  readonly diff: DifficultyProfile;
  readonly personality: Personality;
  readonly rng: Rng;
  readonly perception: Perception;
  readonly aim: AimController;
  readonly nav: Navigator;
  goal: Goal | null = null;
  private goals: Goal[] = [];
  private nextDecision = 0;
  private nextTargetEval = 0;
  private nextAbilityEval = 0;
  private nextShop = 0;
  private target: CombatTarget | null = null;
  private pending: PendingCast | null = null;
  private strafeDir = 1;
  private strafeUntil = 0;
  private jumpCooldown = 0;
  private meleeHoldUntil = 0;
  private fireToggle = false;
  private lastHp = 0;
  private recentDamage = 0;
  private nextItemCost = Infinity;
  private dest: Vec3 | null = null;
  private state = 'idle';
  private actionLabel = '';
  private retreatReason = '';
  private move: MoveIntent = { moveX: 0, moveZ: 0, jump: false, interact: false, dash: false, crouch: false, lookYaw: null };
  readonly debug: BotDebug = { goal: '', reason: '', utilities: [], state: '', targetId: -1, targetKind: '', destination: null, path: [], contacts: [], threat: 0, action: '', retreatReason: '', intent: '' };

  constructor(
    readonly hero: Hero,
    navGrid: NavGrid,
    readonly team: TeamCoordinator,
    difficulty: keyof typeof DIFFICULTY,
    personality: string | undefined,
    seed: number,
  ) {
    this.diff = DIFFICULTY[difficulty];
    this.personality = PERSONALITIES[personality ?? hero.def.ai.defaultPersonality] ?? PERSONALITIES.aggressive;
    this.rng = new Rng(seed);
    const rnd = () => this.rng.next();
    this.perception = new Perception(hero, this.diff, rnd);
    this.aim = new AimController(this.diff, rnd);
    this.nav = new Navigator(navGrid, rnd);
    this.aim.reset(hero.yaw, 0);
    this.lastHp = hero.hp;
  }

  private get retreatHp(): number {
    return Math.max(0.12, Math.min(0.6, this.personality.retreatHp + this.diff.retreatSense));
  }

  update(sim: Simulation): void {
    const h = this.hero;
    const dt = sim.dt;
    const inp: InputCommand = emptyInput();
    inp.yaw = this.aim.yaw;
    inp.pitch = this.aim.pitch;
    this.perception.update(sim);
    if (!h.alive) {
      this.nav.clear();
      this.target = null;
      this.pending = null;
      this.goal = null;
      this.nextDecision = 0;
      if (sim.time >= this.nextShop) this.shop(sim);
      h.input = inp;
      this.publishDebug(sim);
      return;
    }
    // Damage tracking (for reactive dodging and re-planning).
    const lost = this.lastHp - h.hp;
    this.recentDamage = this.recentDamage * Math.exp(-dt * 1.5) + Math.max(0, lost);
    this.lastHp = h.hp;
    if (h.abilityPoints > 0 && sim.tick % 30 === h.id % 30) for (const slot of spendAbilityPoints(h)) h.actions.push({ type: 'upgradeAbility', slot });
    if (sim.time >= this.nextShop && (h.inShopRange || !h.alive)) this.shop(sim);
    if (sim.time >= this.nextDecision || (lost > h.maxHp * 0.12 && sim.time > this.nextDecision - this.diff.decisionInterval * 0.6)) this.decide(sim);

    if (sim.time >= this.nextTargetEval) {
      this.nextTargetEval = sim.time + 0.2 + this.rng.next() * 0.1;
      this.target = this.pickTarget(sim);
    } else if (this.target) this.refreshTarget(sim);

    this.planDestination(sim);
    if (sim.time >= this.nextAbilityEval && !this.pending) {
      this.nextAbilityEval = sim.time + 0.15;
      this.planAbility(sim);
    }

    // --- Movement.
    let buttons = 0;
    const engaging = this.target !== null && this.target.kind !== 'orb' && this.state !== 'retreat';
    const eye = heroEye(h, { x: 0, y: 0, z: 0 });
    if (this.dest) this.nav.setDestination(sim, h, this.dest);
    this.nav.step(sim, h, this.move);
    let mx = this.move.moveX;
    let mz = this.move.moveZ;
    if (engaging && this.target && !h.zip) {
      const cm = this.combatMove(sim);
      if (cm) {
        mx = cm.x;
        mz = cm.z;
      }
    }
    const haz = this.hazardEscape(sim);
    if (haz) {
      mx = haz.x;
      mz = haz.z;
    }
    if (this.move.jump) buttons |= BTN.JUMP;
    if (this.move.interact) buttons |= BTN.INTERACT;
    // Reactive dodging when under fire.
    if (engaging && sim.time > this.jumpCooldown && this.recentDamage > h.maxHp * 0.06 && this.rng.next() < this.diff.dodge * 0.08) {
      this.jumpCooldown = sim.time + 1.2;
      if (this.rng.next() < this.diff.movementTech && h.stamina >= 2) buttons |= BTN.DASH;
      else buttons |= BTN.JUMP;
    }
    // Travel tech: dash-jump when moving a long way out of combat.
    if (!engaging && this.state !== 'idle' && h.grounded && h.stamina >= h.stats.stamina && this.nav.remaining(h) > 40 && this.rng.next() < this.diff.movementTech * 0.02) buttons |= BTN.DASH;
    inp.moveX = mx;
    inp.moveZ = mz;

    // --- Aim & fire.
    let aimPoint: Vec3 | null = null;
    let aimKey = -1;
    let speed = 0;
    if (this.pending) {
      const pc = this.pending;
      aimPoint = pc.point;
      aimKey = 1000000 + pc.slot;
      if (pc.targetId >= 0) {
        const u = sim.units.get(pc.targetId);
        if (u && u.alive) aimPoint = { x: u.pos.x, y: u.centerY(), z: u.pos.z };
      }
    } else if (this.target) {
      const t = this.target;
      const ps = h.def.weapon.projectileSpeed * h.stats.bulletVelocityMul;
      aimPoint = this.aim.lead(eye, t.point, t.vel, ps);
      aimKey = t.id;
      speed = Math.hypot(t.vel.x, t.vel.z);
    }
    if (aimPoint) {
      let lookPoint = aimPoint;
      if (this.pending?.lob) {
        const dir = ballisticDir(eye, aimPoint, this.pending.lob.speed, this.pending.lob.gravity, this.pending.lob.bias);
        if (dir) lookPoint = { x: eye.x + dir.x * 10, y: eye.y + dir.y * 10, z: eye.z + dir.z * 10 };
      }
      this.aim.update(sim.time, dt, eye, lookPoint, aimKey, speed);
      if (this.pending && (this.pending.lob || this.pending.targetId < 0)) {
        // Lobs and ground casts: snap closer (the cast itself has no assist).
        this.aim.update(sim.time, dt, eye, lookPoint, aimKey, 0);
      }
    } else {
      const look = this.move.lookYaw ?? (Math.hypot(mx, mz) > 0.1 ? Math.atan2(mx, mz) : this.aim.yaw);
      this.aim.lookToward(dt, look, 0);
      this.aim.update(sim.time, dt, eye, null, -1, 0);
    }
    inp.yaw = this.aim.yaw;
    inp.pitch = this.aim.pitch;

    // Ability release.
    if (this.pending) {
      const pc = this.pending;
      const tol = pc.targetId >= 0 ? 0.09 : 0.16;
      const ready = !this.aim.reacting(sim.time) && this.aim.error < tol;
      if (ready || sim.time >= pc.deadline) {
        if (ready || pc.deadline - sim.time > -0.05) buttons |= ABILITY_BTNS[pc.slot - 1];
        this.actionLabel = `cast ${pc.label}`;
        this.pending = null;
      }
    } else if (this.target && !h.weapon.reloading) {
      const t = this.target;
      const dist = Math.hypot(t.point.x - eye.x, t.point.z - eye.z);
      const tol = Math.atan((t.radius + 0.2) / Math.max(1, dist)) + 0.01;
      const los = !sim.world.segmentBlocked(eye, t.point);
      const range = Math.min(h.def.weapon.range, h.def.weapon.falloffEnd * 1.3 + 10);
      if (los && dist <= range && this.aim.error < tol * (1.5 - this.diff.prediction * 0.4) && !this.aim.reacting(sim.time)) {
        if (h.def.weapon.fireMode === 'auto') buttons |= BTN.FIRE;
        else {
          // Semi/burst weapons need a fresh press per shot.
          this.fireToggle = !this.fireToggle;
          if (this.fireToggle && sim.time >= h.weapon.nextFire) buttons |= BTN.FIRE;
        }
        this.actionLabel = `shoot ${t.kind}`;
      }
      // Melee finishers & close-range swings.
      if (t.kind !== 'orb' && dist < 2.6) {
        const u = sim.units.get(t.id) as AnyUnit | undefined;
        const heavyDmg = BALANCE.melee.heavyDamage * h.stats.meleeDamageMul * (1 + (h.level - 1) * 0.04);
        if (u && u.kind === 'trooper' && u.hp < heavyDmg * 1.2 && this.rng.next() < this.diff.lastHit * 0.2) this.meleeHoldUntil = sim.time + 0.5;
        else if (u && u.kind === 'hero' && this.rng.next() < 0.03) this.meleeHoldUntil = sim.time + 0.05;
      }
    }
    if (sim.time < this.meleeHoldUntil) buttons |= BTN.MELEE;
    // Parry incoming heavy melee from adjacent enemy heroes.
    if (h.parryNext <= sim.time) {
      for (const e of sim.heroes) {
        if (e.team === h.team || !e.alive || e.meleeStart < 0) continue;
        if (distXZ(e.pos, h.pos) < 3.6 && this.rng.next() < this.diff.dodge * 0.25) {
          buttons |= BTN.PARRY;
          break;
        }
      }
    }
    // Reload when empty, or when low and nothing to shoot.
    const w = h.weapon;
    if (!w.reloading && (w.ammo === 0 || (!this.target && w.ammo < w.magazine * 0.4))) buttons |= BTN.RELOAD;

    buttons |= this.useItems(sim);
    inp.buttons = buttons;
    h.input = inp;
    this.team.intents.set(h.id, { goal: this.goal?.kind ?? 'idle', lane: this.goal?.lane ?? -1, pos: this.dest ?? h.pos, targetId: this.goal?.targetId ?? -1 });
    if ((sim.tick + h.id) % 10 === 0) this.publishDebug(sim);
  }

  // --- Strategy -------------------------------------------------------------------

  private decide(sim: Simulation): void {
    this.nextDecision = sim.time + this.diff.decisionInterval * (0.8 + this.rng.next() * 0.4);
    const next = chooseNextBuy(sim, this.hero, this.diff, () => this.rng.next());
    this.nextItemCost = next ? (sim.items.check(this.hero, next.buy, true).cost ?? Infinity) : Infinity;
    if (next && next.sell) this.nextItemCost = Math.max(0, this.nextItemCost - Math.round(ITEM_MAP[next.sell].cost * BALANCE.economy.sellRefund));
    this.goals = evaluateGoals({
      sim,
      hero: this.hero,
      team: this.team,
      perception: this.perception,
      personality: this.personality,
      diff: this.diff,
      current: this.goal,
      rnd: () => this.rng.next(),
      nextItemCost: this.nextItemCost,
      retreatHp: this.retreatHp,
    });
    const g = this.goals[0];
    const changed = !this.goal || this.goal.kind !== g.kind || this.goal.targetId !== g.targetId || this.goal.lane !== g.lane;
    this.goal = g;
    if (g.kind === 'retreat') this.retreatReason = g.reason;
    if (changed && g.callId !== undefined && g.reason.startsWith('player')) {
      // Acknowledge accepted commands occasionally.
      if (this.rng.next() < 0.3) sim.events.push({ t: 'botSay', unit: this.hero.id, team: this.hero.team, text: 'Copy that.' });
    }
  }

  private planDestination(sim: Simulation): void {
    const h = this.hero;
    const g = this.goal;
    if (!g) {
      this.dest = null;
      this.state = 'idle';
      return;
    }
    let dest: Vec3 = { ...g.pos };
    this.state = g.kind;
    switch (g.kind) {
      case 'farm':
      case 'push': {
        // Don't stand inside enemy tower range unless our troopers tank it.
        const s = this.enemyStructureCovering(sim, dest);
        if (s && !this.troopersTanking(sim, s)) {
          const dx = dest.x - s.pos.x;
          const dz = dest.z - s.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const safe = s.def.range + 4 + (1 - this.diff.towerSense) * -6;
          if (d < safe) {
            // Retreat toward our base along the lane.
            const base = sim.map.spawns[h.team0].pos;
            const bx = base.x - s.pos.x;
            const bz = base.z - s.pos.z;
            const bl = Math.hypot(bx, bz) || 1;
            dest = { x: s.pos.x + (bx / bl) * safe, y: 0, z: s.pos.z + (bz / bl) * safe };
            this.state = 'hold (tower)';
          }
        }
        break;
      }
      case 'defend': {
        const s = sim.units.get(g.targetId);
        if (s) dest = { x: s.pos.x, y: 0, z: s.pos.z };
        break;
      }
      case 'fight': {
        const a = sim.units.get(g.targetId);
        if (a && a.alive) dest = { ...a.pos };
        break;
      }
      case 'gank': {
        const c = this.perception.get(g.targetId);
        if (c) dest = { ...c.pos };
        break;
      }
      case 'boss': {
        const b = sim.units.get(g.targetId);
        if (b && b.alive) {
          const r = Math.min(h.def.ai.preferredRange, 16);
          const dx = h.pos.x - b.pos.x;
          const dz = h.pos.z - b.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          dest = { x: b.pos.x + (dx / d) * r, y: 0, z: b.pos.z + (dz / d) * r };
        }
        break;
      }
      case 'shop':
        if (h.inShopRange) this.shop(sim);
        break;
      default:
        break;
    }
    if (this.dest === null || distXZ(this.dest, dest) > 1.5 || Math.abs(this.dest.y - dest.y) > 1) this.dest = dest;
  }

  private enemyStructureCovering(sim: Simulation, pos: Vec3) {
    for (const s of sim.structures) {
      if (!s.alive || s.team === this.hero.team || s.def.range <= 0) continue;
      if (distXZ(s.pos, pos) < s.def.range + 3) return s;
    }
    return null;
  }

  private troopersTanking(sim: Simulation, s: { pos: Vec3; def: { range: number } }): boolean {
    let n = 0;
    for (const t of sim.troopers) if (t.alive && t.team === this.hero.team && distXZ(t.pos, s.pos) < s.def.range - 1) n++;
    return n >= 2;
  }

  // --- Targets ----------------------------------------------------------------------

  private refreshTarget(sim: Simulation): void {
    const t = this.target!;
    if (t.kind === 'orb') {
      const o = sim.orbs.find((x) => x.id === t.id);
      if (!o || !o.alive) this.target = null;
      else t.point = { ...o.pos };
      return;
    }
    const c = this.perception.get(t.id);
    const u = sim.units.get(t.id) as AnyUnit | undefined;
    if (!u || !u.alive) {
      this.target = null;
      return;
    }
    if (u.kind === 'structure') return;
    if (c && c.visible) {
      t.point = { x: u.pos.x, y: u.kind === 'hero' ? u.pos.y + u.height * 0.62 : u.centerY(), z: u.pos.z };
      t.vel = { ...u.vel };
    } else if (!c) this.target = null;
  }

  private pickTarget(sim: Simulation): CombatTarget | null {
    const h = this.hero;
    const eye = heroEye(h, { x: 0, y: 0, z: 0 });
    const g = this.goal?.kind ?? 'farm';
    const range = Math.min(h.def.weapon.range, Math.max(30, h.def.ai.preferredRange * 2.2));
    let best: CombatTarget | null = null;
    const consider = (ct: CombatTarget) => {
      if (!best || ct.score > best.score) best = ct;
    };
    const myShot = h.def.weapon.damage * h.def.weapon.pellets * h.stats.weaponDamageMul * 0.8;
    const retreating = g === 'retreat' || g === 'shop';
    for (const c of this.perception.contacts.values()) {
      if (!c.visible) continue;
      const u = sim.units.get(c.id) as AnyUnit | undefined;
      if (!u || !u.alive || u.team === h.team) continue;
      const d = Math.hypot(c.pos.x - h.pos.x, c.pos.z - h.pos.z);
      if (d > range + (u.kind === 'structure' ? u.radius : 0)) continue;
      const point = { x: u.pos.x, y: u.kind === 'hero' ? u.pos.y + u.height * 0.62 : u.kind === 'structure' ? u.pos.y + Math.min(4, u.height * 0.5) : u.centerY(), z: u.pos.z };
      if (u.kind !== 'structure' && sim.world.segmentBlocked(eye, point)) continue;
      let score = -d * 0.6;
      switch (u.kind) {
        case 'hero': {
          const underTower = this.enemyStructureCovering(sim, u.pos);
          score += 60 + (1 - c.hpFrac) * 45;
          if (this.team.focusTarget === u.id) score += 25 * this.diff.coordination;
          if (u.lastCombatTime > sim.time - 1.5 && sim.lastTargetOf(u.id) === h.id) score += 20;
          if (underTower && !this.troopersTanking(sim, underTower) && c.hpFrac > 0.25) score -= 45 * this.diff.towerSense;
          if (retreating && d > 16) score -= 50;
          if (u.flags & SF.INVULNERABLE) score -= 200;
          break;
        }
        case 'trooper': {
          score += 30;
          if (u.hp <= myShot * 1.15) score += 30 * this.diff.lastHit;
          if (g === 'farm' || g === 'push' || g === 'defend') score += 12;
          if (retreating) score -= 40;
          break;
        }
        case 'summon':
          score += 32;
          break;
        case 'structure':
          if (!u.vulnerable) continue;
          score += g === 'push' ? 48 : 18;
          if (u.backdoor) score -= 25;
          if (!this.troopersTanking(sim, u) && u.def.range > 0) score -= 30 * this.diff.towerSense;
          break;
        case 'neutral':
          score += g === 'jungle' ? 45 : u.targetId === h.id ? 35 : -30;
          if (u.hp <= myShot * 1.15) score += 10;
          break;
        case 'boss':
          score += g === 'boss' ? 55 : u.targetId === h.id ? 20 : -60;
          break;
      }
      consider({ id: u.id, kind: u.kind, point, vel: { ...u.vel }, radius: u.radius, score });
    }
    // Soul orbs: secure enemy orbs, deny our own (skill-gated).
    const anyHeroThreat = best !== null && (best as CombatTarget).kind === 'hero';
    if (!anyHeroThreat && this.rng.next() < this.diff.lastHit) {
      for (const o of sim.orbs) {
        if (!o.alive) continue;
        const d = distXZ(o.pos, h.pos);
        if (d > 30) continue;
        if (sim.world.segmentBlocked(eye, o.pos)) continue;
        const score = 70 - d;
        consider({ id: o.id, kind: 'orb', point: { ...o.pos }, vel: { x: 0, y: 1.2, z: 0 }, radius: o.radius, score });
      }
    }
    return best;
  }

  // --- Combat movement --------------------------------------------------------------

  private combatMove(sim: Simulation): { x: number; z: number } | null {
    const h = this.hero;
    const t = this.target!;
    if (t.kind === 'structure' || t.kind === 'orb') return null;
    const dx = t.point.x - h.pos.x;
    const dz = t.point.z - h.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    const pref = t.kind === 'hero' ? h.def.ai.preferredRange : Math.max(6, h.def.ai.preferredRange * 0.8);
    // Stay near the strategic anchor when farming.
    if ((this.goal?.kind === 'farm' || this.goal?.kind === 'push') && this.dest && distXZ(h.pos, this.dest) > 22) return null;
    let along = 0;
    if (d > pref + 3) along = 1;
    else if (d < pref - 3) along = -0.8;
    // Don't chase into enemy tower range.
    if (along > 0) {
      const ahead = { x: h.pos.x + nx * 3, y: 0, z: h.pos.z + nz * 3 };
      const s = this.enemyStructureCovering(sim, ahead);
      if (s && !this.troopersTanking(sim, s) && t.kind === 'hero' && this.diff.towerSense > this.rng.next() * 0.5) along = -0.3;
    }
    if (sim.time > this.strafeUntil) {
      this.strafeUntil = sim.time + 0.35 + this.rng.next() * (1.4 - this.diff.dodge);
      this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
      if (this.rng.next() > this.diff.dodge + 0.2) this.strafeDir = 0;
    }
    const strafe = t.kind === 'hero' ? this.strafeDir * (0.5 + this.diff.dodge * 0.5) : this.strafeDir * 0.3;
    let mx = nx * along + -nz * strafe;
    let mz = nz * along + nx * strafe;
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    // If the straight-line move hits a wall, fall back to the navigator.
    const probe = { x: h.pos.x + mx * 1.2, y: h.pos.y, z: h.pos.z + mz * 1.2 };
    if (sim.world.overlapsCylinder(probe.x, sim.world.groundHeight(probe.x, probe.z, h.pos.y + 0.6) + 0.05, probe.z, h.radius, h.height, 0.55)) return null;
    return { x: mx, z: mz };
  }

  /** Steps out of telegraphed AoEs and enemy damage zones. */
  private hazardEscape(sim: Simulation): { x: number; z: number } | null {
    const h = this.hero;
    if (this.rng.next() > this.diff.dodge + 0.25) return null;
    let ex = 0;
    let ez = 0;
    let any = false;
    for (const z of sim.hazards) {
      if (z.team === h.team) continue;
      const dx = h.pos.x - z.pos.x;
      const dz = h.pos.z - z.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < z.radius + 1) {
        any = true;
        ex += dx / (d || 1);
        ez += dz / (d || 1);
      }
    }
    for (const z of sim.zones) {
      if (z.team === h.team || !HAZARD_KINDS.has(z.visual)) continue;
      const dx = h.pos.x - z.pos.x;
      const dz = h.pos.z - z.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < z.radius + 0.8) {
        any = true;
        ex += dx / (d || 1);
        ez += dz / (d || 1);
      }
    }
    if (!any) return null;
    const l = Math.hypot(ex, ez) || 1;
    return { x: ex / l, z: ez / l };
  }

  // --- Abilities -------------------------------------------------------------------

  private abilityReady(sim: Simulation, slot: number): boolean {
    const h = this.hero;
    const st = h.abilities[slot - 1];
    if (st.level <= 0 || h.cast || h.flags & (SF.STUN | SF.SILENCE)) return false;
    const charges = abilityParam(st, 'charges');
    if (charges > 1) return st.charges > 0;
    return sim.time >= st.cooldownEnd;
  }

  private planAbility(sim: Simulation): void {
    const h = this.hero;
    if (h.zip) return;
    let best: { value: number; pc: PendingCast } | null = null;
    const eye = heroEye(h, { x: 0, y: 0, z: 0 });
    const heroTarget = this.target && this.target.kind === 'hero' ? (sim.units.get(this.target.id) as Hero | undefined) : undefined;
    const enemyHeroes = this.perception.enemyHeroes(0.5).filter((c) => c.visible);
    const g = this.goal?.kind;
    for (let slot = 1; slot <= 4; slot++) {
      if (!this.abilityReady(sim, slot)) continue;
      const st = h.abilities[slot - 1];
      const def = st.def;
      const ai = def.ai;
      const range = Math.max(abilityParam(st, 'range') * h.stats.rangeMul, ai.maxRange);
      const maxR = Math.min(range, ai.maxRange * h.stats.rangeMul + 2);
      let value = 0;
      let point: Vec3 | null = null;
      let targetId = -1;
      const heroInRange = (c: Contact | Hero | undefined, lo = ai.minRange ?? 0) => {
        if (!c) return false;
        const p = 'pos' in c ? c.pos : (c as Contact).pos;
        const d = distXZ(p, h.pos);
        return d <= maxR && d >= lo;
      };
      const ht = heroTarget ?? (enemyHeroes.length ? (sim.units.get(enemyHeroes[0].id) as Hero | undefined) : undefined);
      const htVisible = !!ht && ht.alive && !sim.world.segmentBlocked(eye, { x: ht.pos.x, y: ht.pos.y + 1.2, z: ht.pos.z });
      switch (ai.kind) {
        case 'damage':
        case 'cc':
        case 'zone':
        case 'summon': {
          if (ht && htVisible && heroInRange(ht)) {
            value = ai.kind === 'cc' ? 0.95 : 0.85;
            if (ht.hpFrac() < 0.5) value += 0.25;
            const hits = this.countEnemies(sim, ht.pos, ai.aoeRadius ?? 2, true);
            if ((ai.minTargets ?? 1) > 1 && ai.heroOnly && hits < (ai.minTargets ?? 1)) value = 0;
            point = this.abilityAim(ht, def, ai.aimGround ?? false);
            targetId = def.targeting === 'enemy' ? ht.id : -1;
          } else if (ai.farm && (g === 'farm' || g === 'push' || g === 'jungle' || g === 'defend') && !enemyHeroes.some((c) => distXZ(c.pos, h.pos) < 35)) {
            const cl = this.bestCluster(sim, maxR, ai.aoeRadius ?? 3);
            if (cl && cl.count >= Math.max(2, ai.minTargets ?? 2) && slot !== 4) {
              value = 0.35 + cl.count * 0.05;
              point = cl.pos;
              targetId = def.targeting === 'enemy' ? cl.id : -1;
            }
          }
          if (ai.kind === 'summon' && !point && this.target && slot !== 4) {
            value = 0.5;
            point = { ...h.pos };
          }
          break;
        }
        case 'engage':
          if (ht && htVisible && heroInRange(ht) && (g === 'fight' || g === 'gank' || g === 'defend' || (h.hpFrac() > 0.55 && ht.hpFrac() < 0.75)) && !this.enemyStructureCovering(sim, ht.pos)) {
            value = 0.9 + (1 - ht.hpFrac()) * 0.3;
            point = this.abilityAim(ht, def, ai.aimGround ?? false);
          }
          break;
        case 'escape': {
          const threatened = enemyHeroes.some((c) => distXZ(c.pos, h.pos) < 22);
          if ((g === 'retreat' || h.hpFrac() < (ai.selfHpBelow ?? 0.35)) && threatened) {
            value = 1.2;
            const home = sim.map.spawns[h.team0].pos;
            const wp = this.nav.path && this.nav.path[this.nav.idx] ? this.nav.path[this.nav.idx] : home;
            const dx = wp.x - h.pos.x;
            const dz = wp.z - h.pos.z;
            const dl = Math.hypot(dx, dz) || 1;
            point = { x: h.pos.x + (dx / dl) * 12, y: h.pos.y + 1.4, z: h.pos.z + (dz / dl) * 12 };
          }
          break;
        }
        case 'heal':
        case 'shield': {
          let bestAlly: Hero | null = null;
          let bestFrac = 1;
          for (const a of sim.heroes) {
            if (a.team !== h.team || !a.alive) continue;
            const d = distXZ(a.pos, h.pos);
            if (a.id !== h.id && (d > maxR || def.targeting === 'self')) continue;
            const thresh = a.id === h.id ? (ai.selfHpBelow ?? 0.4) : (ai.allyHpBelow ?? 0.5);
            const frac = a.hpFrac();
            if (frac < thresh && frac < bestFrac && (sim.time - a.lastDamagedAt < 4 || frac < 0.4)) {
              bestFrac = frac;
              bestAlly = a;
            }
          }
          if (bestAlly) {
            value = 1.0 + (1 - bestFrac);
            if (def.targeting === 'ally' && bestAlly.id !== h.id) {
              point = { x: bestAlly.pos.x, y: bestAlly.centerY(), z: bestAlly.pos.z };
              targetId = bestAlly.id;
            } else if (def.targeting === 'ally') {
              // Self-cast: aim away from allies so the assist falls back to self.
              point = { x: h.pos.x + Math.sin(this.aim.yaw) * 5, y: h.pos.y - 3, z: h.pos.z + Math.cos(this.aim.yaw) * 5 };
            } else point = { ...h.pos };
          }
          break;
        }
        case 'buff':
          if (this.target && (this.target.kind === 'hero' || this.target.kind === 'structure' || this.target.kind === 'boss')) {
            value = this.target.kind === 'hero' ? 0.75 : 0.45;
            point = { ...this.target.point };
          }
          break;
        case 'finisher':
          if (ht && htVisible && heroInRange(ht) && ht.hpFrac() < (ai.targetHpBelow ?? 0.4)) {
            value = 1.25;
            point = this.abilityAim(ht, def, false);
            targetId = ht.id;
          }
          break;
      }
      if (!point || value <= 0) continue;
      // Self-targeted AoE abilities need enemies around us.
      if (def.targeting === 'self' && (ai.kind === 'damage' || ai.kind === 'cc')) {
        const n = this.countEnemies(sim, h.pos, ai.aoeRadius ?? 6, !!ai.heroOnly);
        if (n < (ai.minTargets ?? 1)) continue;
      }
      if (slot === 4) value += 0.1;
      if (this.rng.next() > this.diff.abilityTiming) continue;
      if (!best || value > best.value) {
        const lobSpeed = def.id === 'cinder-napalm' ? 26 : def.id === 'gideon-mine' ? 22 : 0;
        best = {
          value,
          pc: {
            slot,
            point,
            targetId,
            deadline: sim.time + 0.45,
            lob: lobSpeed ? { speed: lobSpeed, gravity: def.id === 'cinder-napalm' ? 18 : 20, bias: def.id === 'cinder-napalm' ? 0.25 : 0.2 } : undefined,
            label: def.name,
          },
        };
      }
    }
    if (best) this.pending = best.pc;
  }

  private abilityAim(t: Hero, def: AbilityDef, ground: boolean): Vec3 {
    const h = this.hero;
    const eye = heroEye(h, { x: 0, y: 0, z: 0 });
    const speed = def.ai.projectileSpeed ?? 0;
    const base = ground ? { x: t.pos.x, y: t.pos.y + 0.05, z: t.pos.z } : { x: t.pos.x, y: t.pos.y + t.height * 0.6, z: t.pos.z };
    if (speed > 0) return this.aim.lead(eye, base, t.vel, speed);
    if (ground) {
      // Lead ground AoEs slightly by velocity.
      const lead = 0.35 * this.diff.prediction;
      return { x: base.x + t.vel.x * lead, y: base.y, z: base.z + t.vel.z * lead };
    }
    return base;
  }

  private countEnemies(sim: Simulation, pos: Vec3, r: number, heroesOnly: boolean): number {
    let n = 0;
    sim.forEachUnitNear(pos, r, (u) => {
      if (!u.alive || u.team === this.hero.team || u.kind === 'structure') return;
      if (heroesOnly && u.kind !== 'hero') return;
      if (distXZ(u.pos, pos) <= r + u.radius) n++;
    });
    return n;
  }

  private bestCluster(sim: Simulation, range: number, r: number): { pos: Vec3; count: number; id: number } | null {
    let best: { pos: Vec3; count: number; id: number } | null = null;
    const h = this.hero;
    for (const t of sim.troopers) {
      if (!t.alive || t.team === h.team) continue;
      if (distXZ(t.pos, h.pos) > range) continue;
      const c = this.countEnemies(sim, t.pos, r, false);
      if (!best || c > best.count) best = { pos: { x: t.pos.x, y: t.pos.y + 0.05, z: t.pos.z }, count: c, id: t.id };
    }
    for (const n of sim.neutrals) {
      if (!n.alive || distXZ(n.pos, h.pos) > range || n.kind === 'boss') continue;
      const c = this.countEnemies(sim, n.pos, r, false) + 1;
      if (!best || c > best.count) best = { pos: { x: n.pos.x, y: n.pos.y + 0.05, z: n.pos.z }, count: c, id: n.id };
    }
    return best;
  }

  // --- Items -----------------------------------------------------------------------

  private useItems(sim: Simulation): number {
    const h = this.hero;
    let buttons = 0;
    const actives = sim.items.actives(h);
    const enemiesNear = this.perception.enemyHeroes(1).filter((c) => c.visible && distXZ(c.pos, h.pos) < 20).length;
    actives.forEach((it, i) => {
      if (i > 3 || sim.time < it.cooldownEnd || !it.def.active) return;
      const a = it.def.active;
      let use = false;
      switch (a.kind) {
        case 'heal':
          use = h.hpFrac() < 0.5 && sim.time - h.lastDamagedAt > 1;
          break;
        case 'shield':
          use = h.hpFrac() < 0.45 && enemiesNear > 0;
          break;
        case 'cleanse':
          use = (h.flags & (SF.ROOT | SF.SILENCE | SF.DISARM)) !== 0 || h.statuses.some((s) => s.spec.debuff && (s.spec.dps ?? 0) > 20);
          break;
        case 'haste':
          use = (this.goal?.kind === 'retreat' && enemiesNear > 0) || (this.goal?.kind === 'gank' && !!this.target && this.target.kind === 'hero');
          break;
        case 'blink':
          use = this.goal?.kind === 'retreat' && enemiesNear > 0 && h.hpFrac() < 0.35;
          break;
        case 'untargetable':
          use = h.hpFrac() < 0.18 && enemiesNear > 0;
          break;
        case 'nova':
          use = this.countEnemies(sim, h.pos, a.radius, true) >= 1 || this.countEnemies(sim, h.pos, a.radius, false) >= 4;
          break;
      }
      if (use && this.rng.next() < this.diff.abilityTiming) buttons |= ITEM_BTNS[i];
    });
    return buttons;
  }

  private shop(sim: Simulation): void {
    this.nextShop = sim.time + 0.6;
    const h = this.hero;
    for (let k = 0; k < 3; k++) {
      const next = chooseNextBuy(sim, h, this.diff, () => this.rng.next());
      if (!next) break;
      if (next.sell) h.actions.push({ type: 'sell', itemId: next.sell });
      h.actions.push({ type: 'buy', itemId: next.buy });
      // One purchase per decision; the next happens after it is processed.
      break;
    }
  }

  // --- Debug -----------------------------------------------------------------------

  private publishDebug(sim: Simulation): void {
    const d = this.debug;
    d.goal = this.goal?.kind ?? 'none';
    d.reason = this.goal?.reason ?? '';
    d.utilities = this.goals.slice(0, 6).map((g) => ({ kind: g.kind, score: Math.round(g.score * 100) / 100, reason: g.reason }));
    d.state = this.state;
    d.targetId = this.target?.id ?? -1;
    d.targetKind = this.target?.kind ?? '';
    d.destination = this.dest;
    d.path = this.nav.path ? this.nav.path.slice(this.nav.idx).map((p) => ({ x: p.x, y: p.y, z: p.z })) : [];
    d.contacts = [...this.perception.contacts.values()].filter((c) => c.kind === 'hero').map((c) => ({ id: c.id, pos: { ...c.pos }, visible: c.visible, age: sim.time - c.lastSeen, kind: c.kind }));
    d.threat = this.perception.threatAt(this.hero.pos, 25).dps;
    d.action = this.actionLabel;
    d.retreatReason = this.retreatReason;
    const call = this.team.callsFor(this.hero.id)[0];
    d.intent = call ? `${call.kind} (${call.reason})` : '';
  }
}

/**
 * Launch direction (pre-bias) so that an ability that adds `bias` to the
 * aim's Y component before normalising lands on `to`.
 */
export function ballisticDir(from: Vec3, to: Vec3, v: number, g: number, bias: number): Vec3 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const x = Math.hypot(dx, dz);
  const y = to.y - from.y;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0 || x < 0.5) return null;
  const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * x));
  const D = { x: (dx / x) * Math.cos(theta), y: Math.sin(theta), z: (dz / x) * Math.cos(theta) };
  const db = bias * D.y;
  const k = db + Math.sqrt(db * db - bias * bias + 1);
  const d = { x: k * D.x, y: k * D.y - bias, z: k * D.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}
