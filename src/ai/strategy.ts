import type { DifficultyProfile, Personality } from '../../data/ai';
import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { Hero, Structure } from '../gameplay/entities';
import type { LaneId } from '../world/mapTypes';
import type { Perception } from './perception';
import type { TeamCall, TeamCoordinator } from './team';
import { pointOnPath, type LaneState } from './worldModel';

export type GoalKind = 'farm' | 'push' | 'defend' | 'fight' | 'gank' | 'retreat' | 'shop' | 'jungle' | 'boss' | 'rejuv' | 'group' | 'attack' | 'idle';

export interface Goal {
  kind: GoalKind;
  pos: Vec3;
  lane: LaneId | -1;
  targetId: number;
  score: number;
  reason: string;
  callId?: number;
}

export interface StrategyContext {
  sim: Simulation;
  hero: Hero;
  team: TeamCoordinator;
  perception: Perception;
  personality: Personality;
  diff: DifficultyProfile;
  current: Goal | null;
  rnd: () => number;
  /** Cost of the next item the bot wants (Infinity if none). */
  nextItemCost: number;
  /** Retreat threshold after personality + difficulty adjustment. */
  retreatHp: number;
}

function laneHoldPoint(ls: LaneState, ourSideOffset: number): Vec3 {
  // Stand a little behind the clash point, on our side of the wave.
  const s = Math.max(10, ls.clash - ourSideOffset);
  return pointOnPath(ls.path, ls.cum, s);
}

function nearestShop(sim: Simulation, hero: Hero): Vec3 {
  let best = sim.map.spawns[hero.team0].pos;
  let bestD = distXZ(hero.pos, best) * 1.0;
  for (const s of sim.map.shops) {
    if (s.team !== hero.team) continue;
    const d = distXZ(hero.pos, s.pos);
    if (d < bestD) {
      bestD = d;
      best = s.pos;
    }
  }
  return best;
}

/** Danger estimate near a position: enemy hero DPS vs. allied presence. */
function localRisk(ctx: StrategyContext, pos: Vec3): number {
  const { perception, sim, hero } = ctx;
  const threat = perception.threatAt(pos, 26, 6);
  let allies = 0;
  for (const h of sim.heroes) if (h.team === hero.team && h.alive && h.id !== hero.id && distXZ(h.pos, pos) < 26) allies++;
  const myEhp = hero.hp * (1 + hero.bulletResist);
  const pressure = threat.dps / Math.max(80, myEhp / 6);
  return Math.max(0, pressure - allies * 0.35) + Math.max(0, threat.heroes - allies - 1) * 0.35;
}

/** Nearest own living structure on our side of the fight, else the fountain. */
function safeSpot(ctx: StrategyContext): Vec3 {
  const { sim, hero, perception } = ctx;
  const fountain = sim.map.spawns[hero.team0].pos;
  let best: Vec3 = fountain;
  let bestD = Infinity;
  for (const s of sim.structures) {
    if (!s.alive || s.team !== hero.team || s.def.range <= 0) continue;
    const d = distXZ(s.pos, hero.pos);
    if (d >= bestD) continue;
    // Skip structures that enemies are sitting on.
    if (perception.threatAt(s.pos, 25, 4).heroes > 0) continue;
    // The spot must be closer to our base than we are (don't run into the enemy).
    if (distXZ(s.pos, fountain) > distXZ(hero.pos, fountain) + 10) continue;
    bestD = d;
    const dx = fountain.x - s.pos.x;
    const dz = fountain.z - s.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    best = { x: s.pos.x + (dx / l) * 6, y: 0, z: s.pos.z + (dz / l) * 6 };
  }
  return best;
}

function travelPenalty(hero: Hero, pos: Vec3): number {
  return (distXZ(hero.pos, pos) / 100) * 0.22;
}

/** Enumerates candidate goals with utility scores. Highest wins. */
export function evaluateGoals(ctx: StrategyContext): Goal[] {
  const { sim, hero, team, perception, personality: P, diff } = ctx;
  const goals: Goal[] = [];
  const m = team.model;
  const myLane = team.laneOf.get(hero.id) ?? 1;
  const hp = hero.hpFrac();
  const calls = team.callsFor(hero.id);
  const add = (g: Omit<Goal, 'score'> & { base: number }) => {
    let score = g.base;
    if (ctx.current && ctx.current.kind === g.kind && ctx.current.lane === g.lane && ctx.current.targetId === g.targetId) score += P.commitment;
    score += ctx.rnd() * diff.decisionNoise - diff.decisionNoise / 2;
    goals.push({ kind: g.kind, pos: g.pos, lane: g.lane, targetId: g.targetId, reason: g.reason, score, callId: g.callId });
  };
  const othersOn = (kind: string, lane: number) => {
    let n = 0;
    for (const [id, it] of team.intents) if (id !== hero.id && it.goal === kind && it.lane === lane) n++;
    return n;
  };

  // --- Retreat / heal. Badly hurt heroes go to the fountain; moderately hurt
  // heroes fall back behind their own nearest structure and regenerate there.
  const inFountain = sim.inFountain(hero);
  const lowHp = hp < ctx.retreatHp;
  const localDanger = localRisk(ctx, hero.pos);
  const fountain = sim.map.spawns[hero.team0].pos;
  if (lowHp || (hp < 0.6 && localDanger > 1.2)) {
    const base = 0.9 + (ctx.retreatHp - hp) * 2.2 + Math.min(1, localDanger) * 0.4;
    const safe = hp < ctx.retreatHp * 0.6 || hero.souls >= ctx.nextItemCost ? fountain : safeSpot(ctx);
    add({ kind: 'retreat', pos: safe, lane: -1, targetId: -1, base, reason: lowHp ? `HP ${(hp * 100) | 0}% below ${(ctx.retreatHp * 100) | 0}%` : 'outmatched locally' });
  }
  if (inFountain && hp < 0.95) add({ kind: 'retreat', pos: fountain, lane: -1, targetId: -1, base: 1.4, reason: 'finish healing' });
  // Regenerating at a safe spot: stay until mostly healed if nothing is nearby.
  if (ctx.current?.kind === 'retreat' && !inFountain && hp < 0.8 && localDanger < 0.3 && sim.time - hero.lastDamagedAt > 3) {
    add({ kind: 'retreat', pos: ctx.current.pos, lane: -1, targetId: -1, base: 0.95 + (0.8 - hp), reason: 'regenerating behind cover' });
  }

  // --- Shop.
  if (hero.souls >= ctx.nextItemCost && ctx.nextItemCost < Infinity) {
    const shop = nearestShop(sim, hero);
    const surplus = hero.souls / ctx.nextItemCost;
    const base = 0.3 + Math.min(0.5, (surplus - 1) * 0.4) + (hp < 0.5 ? 0.25 : 0) + (hero.inShopRange ? 1.5 : 0) - travelPenalty(hero, shop) * 1.5;
    add({ kind: 'shop', pos: shop, lane: -1, targetId: -1, base, reason: `${hero.souls} souls for ${ctx.nextItemCost}` });
  }

  // --- Team calls (defend / push / boss / commands).
  for (const c of calls) {
    const follow = c.issuer === 'player' ? 0.75 + diff.coordination * 0.4 : 0.35 + diff.coordination * 0.6;
    const kindMap: Record<TeamCall['kind'], GoalKind> = { defend: 'defend', push: 'push', boss: 'boss', retreat: 'retreat', group: 'group', attack: 'attack', focus: 'fight', rejuv: 'rejuv' };
    const k = kindMap[c.kind];
    const w = k === 'defend' ? P.defend : k === 'push' ? P.push : k === 'boss' ? P.objective : k === 'retreat' ? 1.1 : 1;
    const base = (0.7 + c.priority * 0.1) * w * follow - travelPenalty(hero, c.pos) * 0.6 - (k !== 'retreat' && k !== 'defend' ? localRisk(ctx, c.pos) * 0.35 : 0);
    add({ kind: k, pos: c.pos, lane: c.lane, targetId: c.targetId, base, reason: `${c.issuer} call: ${c.reason}`, callId: c.id });
  }

  // --- Lane farming / pushing.
  for (const ls of m.lanes) {
    const isMine = ls.lane === myLane;
    const crowd = othersOn('farm', ls.lane);
    const wave = ls.enemyTroopers > 0 ? 1 : 0.55;
    const hold = laneHoldPoint(ls, 6);
    let base = (isMine ? 0.62 : 0.3) * P.farm * wave - crowd * (isMine ? 0.08 : 0.18) - travelPenalty(hero, hold) - localRisk(ctx, hold) * 0.45;
    // A lane with enemy troopers pushing into our structure needs someone.
    if (ls.ourOuterStructure && ls.enemyTroopers > 0 && ls.enemyFront < ls.length * 0.45 && crowd === 0) base += 0.15;
    add({ kind: 'farm', pos: hold, lane: ls.lane, targetId: -1, base, reason: `${isMine ? 'assigned' : 'other'} lane (${ls.enemyTroopers} enemy troopers)` });

    const s: Structure | null = ls.nextEnemyStructure;
    if (s && s.vulnerable && ls.ourFront > 0) {
      const front = pointOnPath(ls.path, ls.cum, ls.ourFront);
      // The wave counts as "at" a structure once it is close enough to strip its
      // backdoor protection. (Shrines have no weapon, so their range is 0.)
      const waveAtTower = distXZ(front, s.pos) < Math.max(s.def.range + 6, BALANCE.structures.backdoorRadius);
      if (waveAtTower) {
        const pushBase = 0.5 * P.push + (m.advantage - 1) * 0.25 + (isMine ? 0.12 : 0) - travelPenalty(hero, s.pos) - localRisk(ctx, s.pos) * 0.5 - othersOn('push', ls.lane) * 0.05;
        add({ kind: 'push', pos: s.pos, lane: ls.lane, targetId: s.id, base: pushBase, reason: `wave at ${s.def.name}` });
      }
    }
  }

  // --- Defend own structures under attack (even without a call).
  for (const t of m.threats) {
    const d = distXZ(hero.pos, t.s.pos);
    if (d > 110) continue;
    const base = 0.42 * P.defend + t.urgency * 0.12 - travelPenalty(hero, t.s.pos) - othersOn('defend', t.s.placement.lane) * 0.12;
    add({ kind: 'defend', pos: t.s.pos, lane: t.s.placement.lane as LaneId | -1, targetId: t.s.id, base, reason: `${t.s.def.name} threatened by ${t.enemyHeroes} heroes` });
  }

  // --- Join allied fights / ganks.
  for (const ally of sim.heroes) {
    if (ally.team !== hero.team || ally.id === hero.id || !ally.alive) continue;
    if (sim.time - ally.lastCombatTime > 2.5) continue;
    const d = distXZ(hero.pos, ally.pos);
    if (d > 75) continue;
    const enemiesThere = perception.threatAt(ally.pos, 25, 3).heroes;
    if (!enemiesThere) continue;
    let alliesThere = 1;
    for (const h of sim.heroes) if (h.team === hero.team && h.alive && h.id !== ally.id && h.id !== hero.id && distXZ(h.pos, ally.pos) < 25) alliesThere++;
    const odds = (alliesThere + 1) / (enemiesThere + 0.5);
    const humanBonus = ally.isBot ? 0 : 0.18;
    const base = (0.5 * P.fight + (P.support - 1) * 0.25) * Math.min(1.5, odds) + humanBonus - travelPenalty(hero, ally.pos) * 1.2 - (hp < 0.5 ? 0.3 : 0);
    add({ kind: 'fight', pos: { ...ally.pos }, lane: -1, targetId: ally.id, base, reason: `ally ${ally.playerName} fighting ${enemiesThere}` });
  }
  for (const c of perception.enemyHeroes(5)) {
    const d = distXZ(hero.pos, c.pos);
    if (d > 80) continue;
    // Isolated target: no other known enemy heroes close to it.
    let friends = 0;
    for (const o of perception.enemyHeroes(5)) if (o.id !== c.id && distXZ(o.pos, c.pos) < 20) friends++;
    let allies = 0;
    for (const h of sim.heroes) if (h.team === hero.team && h.alive && h.id !== hero.id && distXZ(h.pos, c.pos) < 30) allies++;
    const killChance = Math.max(0, Math.min(1.2, (hero.hp / Math.max(1, c.hp)) * 0.5 + (1 - c.hpFrac) * 0.6 + allies * 0.25 - friends * 0.45));
    const nearEnemyTower = sim.structures.some((s) => s.alive && s.team !== hero.team && s.def.range > 0 && distXZ(s.pos, c.pos) < s.def.range + 2);
    const base = 0.42 * P.gank * killChance - travelPenalty(hero, c.pos) * 1.3 - (nearEnemyTower ? 0.5 * diff.towerSense : 0) - (hp < 0.45 ? 0.4 : 0) + (team.focusTarget === c.id ? 0.1 : 0);
    add({ kind: 'gank', pos: { ...c.pos }, lane: -1, targetId: c.id, base, reason: `${friends ? 'grouped' : 'isolated'} enemy (${(c.hpFrac * 100) | 0}% hp)` });
  }

  // --- Jungle camps.
  for (const camp of sim.camps) {
    if (!camp.unitIds.length) continue;
    const alive = camp.unitIds.some((id) => sim.units.get(id)?.alive);
    if (!alive) continue;
    const d = distXZ(hero.pos, camp.def.pos);
    if (d > 90) continue;
    const worth = camp.def.tier * 0.12;
    const tooWeak = camp.def.tier === 3 && hero.level < 5;
    const base = (0.28 + worth) * P.jungle - travelPenalty(hero, camp.def.pos) * 1.2 - othersOn('jungle', -1) * 0.1 - (tooWeak ? 0.4 : 0) - localRisk(ctx, camp.def.pos) * 0.4 - (hp < 0.55 ? 0.25 : 0);
    add({ kind: 'jungle', pos: camp.def.pos, lane: -1, targetId: camp.unitIds[0], base, reason: `T${camp.def.tier} camp` });
  }

  // --- Boss steal / rejuvenator.
  const boss = sim.boss.unitId >= 0 ? sim.units.get(sim.boss.unitId) : undefined;
  if (boss && boss.alive && boss.hp / boss.maxHp < 0.25 && distXZ(hero.pos, boss.pos) < 45) add({ kind: 'boss', pos: { ...boss.pos }, lane: -1, targetId: boss.id, base: 0.8 * P.objective, reason: 'boss nearly dead' });
  for (const pk of sim.pickups) if (pk.alive && distXZ(hero.pos, pk.pos) < 70) add({ kind: 'rejuv', pos: pk.pos, lane: -1, targetId: -1, base: 1.15 - travelPenalty(hero, pk.pos), reason: 'rejuvenator up' });

  if (!goals.length) add({ kind: 'farm', pos: laneHoldPoint(m.lanes[myLane], 6), lane: myLane, targetId: -1, base: 0.1, reason: 'default' });
  goals.sort((a, b) => b.score - a.score);
  return goals;
}
