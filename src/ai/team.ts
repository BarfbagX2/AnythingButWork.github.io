import type { Ping, Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { Hero } from '../gameplay/entities';
import type { LaneId, TeamId } from '../world/mapTypes';
import { buildTeamModel, pointOnPath, type TeamModel } from './worldModel';

export type CallKind = 'defend' | 'push' | 'boss' | 'retreat' | 'group' | 'attack' | 'focus' | 'rejuv';

/** A team-wide intent signal ("simulated voice comms"). */
export interface TeamCall {
  id: number;
  kind: CallKind;
  pos: Vec3;
  lane: LaneId | -1;
  targetId: number;
  until: number;
  priority: number;
  /** Heroes asked to respond. */
  assigned: number[];
  issuer: 'ai' | 'player';
  issuerId: number;
  reason: string;
}

/** What each bot is currently doing, published for coordination. */
export interface Intent {
  goal: string;
  lane: number;
  pos: Vec3;
  targetId: number;
}

let callIds = 1;

/**
 * Shared tactical layer for one team: lane assignments, threat sharing,
 * strategic calls (defend/push/boss/retreat), focus targets, and translating
 * the human player's pings into calls the bots can accept or decline.
 */
export class TeamCoordinator {
  model: TeamModel;
  calls: TeamCall[] = [];
  focusTarget = -1;
  laneOf = new Map<number, LaneId>();
  intents = new Map<number, Intent>();
  private nextUpdate = 0;
  private processedPings = 0;
  /** Messages for the HUD / debug ("Rook: defending West Guardian"). */
  log: { time: number; text: string }[] = [];

  constructor(
    readonly team: TeamId,
    private readonly sim: Simulation,
    private readonly coordination: number,
  ) {
    this.model = buildTeamModel(sim, team);
    this.assignLanes();
  }

  private heroes(): Hero[] {
    return this.sim.heroes.filter((h) => h.team === this.team);
  }

  /** Duo lanes for 6-player teams; frontliners paired with ranged/support. */
  assignLanes(): void {
    const hs = this.heroes();
    const explicit = new Map<number, LaneId>();
    for (const h of hs) {
      const slot = this.sim.config.slots.find((s) => s.name === h.playerName && s.team === h.team);
      if (slot?.lane !== undefined) explicit.set(h.id, slot.lane);
    }
    const order: LaneId[] = [1, 0, 2];
    const tough = (h: Hero) => (['Bruiser', 'Initiator', 'Specialist'].includes(h.def.role) ? 0 : h.def.role === 'Support' ? 2 : 1);
    const sorted = [...hs].sort((a, b) => tough(a) - tough(b));
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (const [id, l] of explicit) {
      this.laneOf.set(id, l);
      counts[l]++;
    }
    let i = 0;
    for (const h of sorted) {
      if (this.laneOf.has(h.id)) continue;
      // Fill lanes round-robin so each gets a tough and a ranged hero.
      let lane = order[i % 3];
      for (let k = 0; k < 3 && counts[lane] >= Math.ceil(hs.length / 3); k++) lane = order[(i + k + 1) % 3];
      this.laneOf.set(h.id, lane);
      counts[lane]++;
      i++;
    }
  }

  say(text: string): void {
    this.log.push({ time: this.sim.time, text });
    if (this.log.length > 30) this.log.shift();
  }

  callsFor(heroId: number): TeamCall[] {
    return this.calls.filter((c) => c.assigned.includes(heroId) || c.assigned.length === 0);
  }

  update(): void {
    const sim = this.sim;
    this.calls = this.calls.filter((c) => c.until > sim.time);
    this.processPings();
    if (sim.time < this.nextUpdate) return;
    this.nextUpdate = sim.time + 1;
    this.model = buildTeamModel(sim, this.team);
    const m = this.model;
    const bots = this.heroes().filter((h) => h.isBot && h.alive);
    const assignNearest = (pos: Vec3, n: number, exclude: number[] = []) =>
      bots
        .filter((b) => !exclude.includes(b.id))
        .sort((a, b) => distXZ(a.pos, pos) - distXZ(b.pos, pos))
        .slice(0, n)
        .map((b) => b.id);

    // Defend threatened structures (most urgent first).
    const aiCalls = this.calls.filter((c) => c.issuer === 'ai');
    for (const t of m.threats.slice(0, 2)) {
      if (t.urgency < 0.7) continue;
      if (aiCalls.some((c) => c.kind === 'defend' && c.targetId === t.s.id)) continue;
      const n = Math.min(bots.length, Math.max(1, t.enemyHeroes + (t.s.def.type === 'shrine' || t.s.def.type === 'patron' ? 3 : 1)));
      const call = this.addCall('defend', t.s.pos, t.s.placement.lane as LaneId | -1, t.s.id, 10, 5 + t.urgency, assignNearest(t.s.pos, n), 'ai', -1, `defend ${t.s.def.name}`);
      this.say(`Team: defend the ${t.s.def.name}${t.s.placement.lane >= 0 ? ` (${this.sim.map.lanes[t.s.placement.lane].name})` : ''}!`);
      void call;
    }

    // Push when ahead and a lane wave is at an enemy structure.
    const pushing = this.calls.some((c) => c.kind === 'push');
    if (!pushing && m.advantage >= 1.25 && sim.matchTime > 120 && sim.rng.next() < 0.5 + this.coordination * 0.5) {
      let best: { lane: LaneId; score: number; pos: Vec3 } | null = null;
      for (const ls of m.lanes) {
        const s = ls.nextEnemyStructure;
        if (!s || !s.vulnerable) continue;
        const sPos = s.pos;
        const frontPos = pointOnPath(ls.path, ls.cum, Math.max(0, ls.ourFront));
        const nearWave = ls.ourFront > 0 && distXZ(frontPos, sPos) < 45;
        const score = (nearWave ? 2 : 0.6) + (s.def.type === 'shrine' || s.def.type === 'patron' ? 2 : 0) - ls.enemyHeroesSeen * 0.5;
        if (!best || score > best.score) best = { lane: ls.lane, score, pos: { ...sPos } };
      }
      if (best && best.score > 1) {
        const n = Math.min(bots.length, m.aliveAllies >= 5 ? 4 : 3);
        this.addCall('push', best.pos, best.lane, -1, 35, 4, assignNearest(best.pos, n), 'ai', -1, 'push advantage');
        this.say(`Team: we're ahead — push ${this.sim.map.lanes[best.lane].name}!`);
      }
    }

    // Mid-boss when the team is healthy and the enemy is weakened.
    const boss = sim.boss.unitId >= 0 ? sim.units.get(sim.boss.unitId) : undefined;
    if (boss && boss.alive && !this.calls.some((c) => c.kind === 'boss') && m.aliveAllies >= 4 && m.aliveAllies >= m.aliveEnemies + (this.coordination > 0.8 ? 0 : 1) && m.threats.length === 0) {
      const n = Math.min(bots.length, 5);
      this.addCall('boss', { ...boss.pos }, -1, boss.id, 45, 4.5, assignNearest(boss.pos, n), 'ai', -1, 'take boss');
      this.say('Team: group up and take the Hollow King!');
    }
    // Rejuvenator on the ground: nearest bot goes.
    for (const pk of sim.pickups) {
      if (!pk.alive || this.calls.some((c) => c.kind === 'rejuv')) continue;
      this.addCall('rejuv', { ...pk.pos }, -1, -1, 30, 6, assignNearest(pk.pos, 2), 'ai', -1, 'grab rejuvenator');
    }

    // Retreat when the team is badly outnumbered.
    if (m.aliveEnemies - m.aliveAllies >= 3 && !this.calls.some((c) => c.kind === 'retreat')) {
      const sp = sim.map.spawns[this.team].pos;
      this.addCall('retreat', { ...sp }, -1, -1, 6, 7, [], 'ai', -1, 'outnumbered');
      this.say('Team: we are outnumbered — fall back!');
    }

    // Focus fire: the most vulnerable visible enemy hero near our heroes.
    let bestF = -1;
    let bestScore = -Infinity;
    for (const e of sim.heroes) {
      if (e.team === this.team || !e.alive || !e.visibleTo[this.team]) continue;
      const near = this.heroes().filter((h) => h.alive && distXZ(h.pos, e.pos) < 35).length;
      if (!near) continue;
      const score = (1 - e.hpFrac()) * 2 + near * 0.4 - e.level * 0.03;
      if (score > bestScore) {
        bestScore = score;
        bestF = e.id;
      }
    }
    this.focusTarget = bestF;
  }

  private addCall(kind: CallKind, pos: Vec3, lane: LaneId | -1, targetId: number, duration: number, priority: number, assigned: number[], issuer: 'ai' | 'player', issuerId: number, reason: string): TeamCall {
    const c: TeamCall = { id: callIds++, kind, pos: { ...pos }, lane, targetId, until: this.sim.time + duration, priority, assigned, issuer, issuerId, reason };
    this.calls.push(c);
    return c;
  }

  /** Converts the human player's pings into calls; bots acknowledge or decline. */
  private processPings(): void {
    const pings = this.sim.teams[this.team].pings;
    const fresh = pings.filter((p) => p.time > this.processedPings);
    if (!fresh.length) return;
    this.processedPings = Math.max(...fresh.map((p) => p.time));
    for (const p of fresh) {
      const from = this.sim.units.get(p.from) as Hero | undefined;
      if (!from || from.isBot) continue;
      this.handlePlayerPing(p, from);
    }
  }

  private handlePlayerPing(p: Ping, from: Hero): void {
    const sim = this.sim;
    const bots = this.heroes().filter((h) => h.isBot && h.alive);
    const near = (n: number) => bots.sort((a, b) => distXZ(a.pos, p.pos) - distXZ(b.pos, p.pos)).slice(0, n);
    let kind: CallKind;
    let n = 2;
    let duration = 25;
    switch (p.kind) {
      case 'attack':
      case 'push':
        kind = p.kind === 'push' ? 'push' : 'attack';
        n = 3;
        break;
      case 'defend':
        kind = 'defend';
        n = 3;
        break;
      case 'group':
        kind = 'group';
        n = bots.length;
        duration = 20;
        break;
      case 'retreat':
      case 'danger':
        kind = 'retreat';
        n = bots.length;
        duration = 6;
        break;
      case 'focus':
        kind = 'focus';
        n = bots.length;
        duration = 10;
        break;
      default:
        return;
    }
    const assigned = near(n);
    // Bots decline orders that look suicidal (enemy heavy area while we're thin).
    const accepted: Hero[] = [];
    for (const b of assigned) {
      let enemies = 0;
      for (const e of sim.heroes) if (e.team !== this.team && e.alive && e.visibleTo[this.team] && distXZ(e.pos, p.pos) < 25) enemies++;
      let allies = 0;
      for (const a of this.heroes()) if (a.alive && distXZ(a.pos, p.pos) < 40) allies++;
      const suicidal = (kind === 'attack' || kind === 'push') && enemies >= allies + 2 + assigned.length && b.hpFrac() < 0.6;
      const lowHp = b.hpFrac() < 0.25 && kind !== 'retreat';
      if (suicidal || lowHp) {
        sim.events.push({ t: 'botSay', unit: b.id, team: this.team, text: lowHp ? "I'm too hurt — healing first." : "Too dangerous, let's wait for the team." });
      } else accepted.push(b);
    }
    if (!accepted.length && kind !== 'retreat') return;
    if (kind === 'focus') {
      this.focusTarget = p.targetId;
    }
    this.calls = this.calls.filter((c) => !(c.issuer === 'player' && c.kind === kind));
    this.addCall(kind, p.pos, (p.lane as LaneId | -1) ?? -1, p.targetId, duration, 9, accepted.map((b) => b.id), 'player', from.id, `player ${p.kind}`);
    const lines: Record<CallKind, string> = {
      attack: 'On my way!',
      push: 'Pushing with you.',
      defend: 'Coming to defend.',
      group: 'Grouping up.',
      retreat: 'Falling back.',
      focus: 'Focusing that target.',
      boss: 'Heading to the boss.',
      rejuv: 'Getting it.',
    };
    for (const b of accepted.slice(0, 2)) sim.events.push({ t: 'botSay', unit: b.id, team: this.team, text: lines[kind] });
  }
}
