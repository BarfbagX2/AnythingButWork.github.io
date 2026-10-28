import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { distXZ, type Vec3 } from '../core/math';
import type { Hero, Neutral, SoulOrb, Structure, Trooper } from './entities';
import type { TeamId } from '../world/mapTypes';

const E = BALANCE.economy;

export type SoulSource = 'trooper' | 'hero' | 'structure' | 'neutral' | 'orb' | 'passive' | 'boss' | 'urn';

/** Souls are both currency and experience (reference mechanic). */
export function grantSouls(sim: Simulation, hero: Hero, amount: number, source: SoulSource, pos?: Vec3): void {
  if (amount <= 0 || !Number.isFinite(amount)) return;
  const a = Math.round(amount);
  hero.souls += a;
  hero.netWorth += a;
  hero.match.soulsEarned += a;
  if (source !== 'passive') sim.events.push({ t: 'souls', hero: hero.id, amount: a, pos: pos ?? { ...hero.pos }, source });
  checkLevelUp(sim, hero);
}

export function levelForSouls(souls: number): number {
  const L = BALANCE.levels;
  let lvl = 1;
  for (let i = 1; i < L.length; i++) if (souls >= L[i]) lvl = i + 1;
  return lvl;
}

export function checkLevelUp(sim: Simulation, hero: Hero): void {
  const target = levelForSouls(hero.netWorth);
  while (hero.level < target) {
    hero.level++;
    hero.abilityPoints += BALANCE.abilityPointsAtLevel[hero.level - 1] ?? 1;
    sim.events.push({ t: 'level', unit: hero.id, level: hero.level });
  }
}

export function trooperValue(sim: Simulation, t: Trooper): number {
  const minutes = Math.max(0, sim.matchTime / 60);
  return t.def.souls * (1 + E.trooperSoulGrowthPerMinute * minutes);
}

function heroesNear(sim: Simulation, team: TeamId, pos: Vec3, range: number, exclude = -1): Hero[] {
  return sim.heroes.filter((h) => h.alive && h.team === team && h.id !== exclude && distXZ(h.pos, pos) <= range);
}

export function onTrooperKilled(sim: Simulation, t: Trooper, killerId: number, melee: boolean): void {
  const value = trooperValue(sim, t);
  const killer = sim.units.get(killerId);
  const enemyTeam = (1 - (t.team as number)) as TeamId;
  if (killer && killer.kind === 'hero' && killer.team !== t.team) {
    killer.match.lastHits++;
    if (melee) grantSouls(sim, killer, value, 'trooper', t.pos);
    else {
      grantSouls(sim, killer, value * (1 - E.orbFraction), 'trooper', t.pos);
      sim.spawnOrb(t.team as TeamId, value * E.orbFraction, t.pos, killer.id);
    }
    for (const h of heroesNear(sim, killer.team as TeamId, t.pos, E.shareRange, killer.id)) grantSouls(sim, h, value * E.shareFraction * 0.6, 'trooper', t.pos);
  } else {
    // Troopers killed by troopers/structures still pay nearby lane heroes.
    const near = heroesNear(sim, enemyTeam, t.pos, E.shareRange);
    for (const h of near) grantSouls(sim, h, value * E.shareFraction, 'trooper', t.pos);
  }
}

export function claimOrb(sim: Simulation, orb: SoulOrb, shooterId: number): void {
  if (!orb.alive) return;
  const shooter = sim.units.get(shooterId);
  if (!shooter || shooter.kind !== 'hero') return;
  orb.alive = false;
  const denied = shooter.team === orb.victimTeam;
  if (denied) shooter.match.denies++;
  else {
    shooter.match.orbsSecured++;
    grantSouls(sim, shooter, orb.value, 'orb', orb.pos);
  }
  sim.events.push({ t: 'orbTaken', orb: orb.id, hero: shooter.id, denied });
}

export function updateOrbs(sim: Simulation, dt: number): void {
  for (const o of sim.orbs) {
    if (!o.alive) continue;
    o.pos.y += E.orbRiseSpeed * dt * Math.max(0, 1 - (sim.time - o.spawnTime) / E.orbLifetime);
    if (sim.time >= o.expireTime) {
      // Unclaimed orbs go to the killer at a reduced value.
      o.alive = false;
      const k = sim.units.get(o.killerId);
      if (k && k.kind === 'hero' && k.alive) grantSouls(sim, k, o.value * 0.4, 'orb', o.pos);
    }
  }
}

export function respawnTime(sim: Simulation, hero: Hero): number {
  const R = BALANCE.respawn;
  let t = R.base + R.perLevel * (hero.level - 1) + R.perMinute * Math.max(0, sim.matchTime / 60);
  if (sim.teams[hero.team0].rejuvenatorUntil > sim.time) t *= R.rejuvenatorMul;
  return Math.min(R.max, t);
}

export function onHeroKilled(sim: Simulation, victim: Hero, killerId: number): void {
  victim.match.deaths++;
  victim.respawnAt = sim.time + respawnTime(sim, victim);
  const killer = sim.units.get(killerId);
  const killerHero = killer && killer.kind === 'hero' && killer.team !== victim.team ? killer : null;
  const enemyTeam = (1 - victim.team0) as TeamId;
  const assists: Hero[] = [];
  for (const [id, time] of victim.attackers) {
    if (sim.time - time > BALANCE.combat.assistWindow) continue;
    if (killerHero && id === killerHero.id) continue;
    const h = sim.units.get(id);
    if (h && h.kind === 'hero' && h.team === enemyTeam) assists.push(h);
  }
  const bounty = E.heroKillBase + victim.netWorth * E.heroKillNetWorthFraction + Math.min(5, victim.killStreak) * E.heroKillStreakBonus;
  if (killerHero) {
    killerHero.match.kills++;
    killerHero.killStreak++;
    const killerShare = assists.length ? 1 - E.assistFraction : 1;
    grantSouls(sim, killerHero, bounty * killerShare, 'hero', victim.pos);
    sim.items.onKill(killerHero, victim);
  }
  if (assists.length) {
    const share = (bounty * (killerHero ? E.assistFraction : 1)) / assists.length;
    for (const a of assists) {
      a.match.assists++;
      grantSouls(sim, a, share, 'hero', victim.pos);
    }
  }
  if (!killerHero && assists.length === 0) {
    // Executed by troopers/structures: nearby enemies split the bounty.
    const near = heroesNear(sim, enemyTeam, victim.pos, 35);
    for (const h of near) grantSouls(sim, h, (bounty * 0.6) / near.length, 'hero', victim.pos);
  }
  victim.killStreak = 0;
  sim.teams[enemyTeam].kills++;
  sim.events.push({ t: 'heroKill', killer: killerHero ? killerHero.id : killerId, victim: victim.id, assists: assists.map((a) => a.id), bounty: Math.round(bounty) });
}

export function onStructureDestroyed(sim: Simulation, s: Structure, killerId: number): void {
  const enemyTeam = (1 - (s.team as number)) as TeamId;
  for (const h of sim.heroes) if (h.team === enemyTeam) grantSouls(sim, h, s.def.teamSouls, 'structure', s.pos);
  const team = sim.teams[enemyTeam];
  team.structuresDestroyed++;
  if (s.def.flexSlot && team.flexSlots < BALANCE.items.flexSlotsMax) {
    team.flexSlots++;
    sim.announce(`${enemyTeam === 0 ? 'Amber' : 'Azure'} unlocked a flex item slot`, enemyTeam, 'info');
  }
  const killer = sim.units.get(killerId);
  void killer;
}

export function onNeutralKilled(sim: Simulation, n: Neutral, killerId: number): void {
  const killer = sim.units.get(killerId);
  if (!killer || killer.kind !== 'hero') return;
  const minutes = Math.max(0, sim.matchTime / 60);
  const value = n.def.souls * (1 + 0.04 * minutes);
  grantSouls(sim, killer, value, 'neutral', n.pos);
  for (const h of heroesNear(sim, killer.team as TeamId, n.pos, 20, killer.id)) grantSouls(sim, h, value * 0.3, 'neutral', n.pos);
}

export function passiveIncome(sim: Simulation): void {
  // Granted in 5 s chunks so rounding never loses fractional souls.
  if (sim.matchTime < 0 || sim.tick % (sim.tickRate * 5) !== 0) return;
  for (const h of sim.heroes) grantSouls(sim, h, E.passiveSoulsPerSecond * 5, 'passive');
}
