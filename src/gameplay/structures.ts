import { BALANCE } from '../../data/balance';
import { PATRON_PHASE2 } from '../../data/units';
import type { Simulation } from '../core/simulation';
import { distXZ } from '../core/math';
import type { AnyUnit, Structure } from './entities';
import { SF } from './types';

const S = BALANCE.structures;

/** A structure is vulnerable once its prerequisite structures are destroyed. */
export function refreshVulnerability(sim: Simulation): void {
  for (const s of sim.structures) {
    if (!s.alive) continue;
    const req = s.placement.requires;
    let ok: boolean;
    if (req.length === 0) ok = true;
    else if (s.placement.requiresAny) ok = req.some((id) => sim.structureDestroyed(id));
    else ok = req.every((id) => sim.structureDestroyed(id));
    if (ok && !s.vulnerable) {
      s.vulnerable = true;
      if (req.length > 0) {
        sim.events.push({ t: 'structure', id: s.id, key: s.key, state: 'vulnerable' });
        if (s.def.type === 'patron') sim.announce(`The ${teamName(s.team)} Patron is exposed!`, -1, 'objective');
      }
    }
  }
}

function teamName(team: number): string {
  return team === 0 ? 'Amber' : 'Azure';
}

function acquire(sim: Simulation, s: Structure): AnyUnit | null {
  const range = s.def.range;
  if (s.aggroHero >= 0 && sim.time < s.aggroUntil) {
    const h = sim.units.get(s.aggroHero) as AnyUnit | undefined;
    if (h && h.alive && distXZ(h.pos, s.pos) <= range + h.radius && !(h.flags & SF.INVISIBLE)) return h;
  }
  let bestMinion: AnyUnit | null = null;
  let bestMinionD = Infinity;
  let bestHero: AnyUnit | null = null;
  let bestHeroD = Infinity;
  sim.forEachUnitNear(s.pos, range + 2, (u) => {
    if (!u.alive || u.team === s.team || u.team === 2) return;
    if (u.kind === 'structure') return;
    const d = distXZ(u.pos, s.pos) - u.radius;
    if (d > range) return;
    if (u.kind === 'hero') {
      if (u.flags & SF.INVISIBLE) return;
      if (d < bestHeroD) {
        bestHeroD = d;
        bestHero = u;
      }
    } else if (d < bestMinionD) {
      bestMinionD = d;
      bestMinion = u;
    }
  });
  // Troopers first (classic lane-tower behaviour), heroes when no troopers.
  return bestMinion ?? bestHero;
}

export function updateStructures(sim: Simulation, dt: number): void {
  for (const s of sim.structures) {
    if (!s.alive) continue;
    s.attackAnim = Math.max(0, s.attackAnim - dt);
    // Backdoor protection: active while no enemy troopers are nearby.
    if ((sim.tick + s.id) % 15 === 0) {
      let enemyTroopers = false;
      sim.forEachUnitNear(s.pos, S.backdoorRadius, (u) => {
        if (!enemyTroopers && u.alive && (u.kind === 'trooper' || u.kind === 'summon') && u.team !== s.team && distXZ(u.pos, s.pos) <= S.backdoorRadius) enemyTroopers = true;
      });
      s.backdoor = !enemyTroopers;
    }
    // Regenerate only while protected and left alone for a while.
    if (s.backdoor && s.hp < s.maxHp && sim.time - s.lastDamagedAt > 10) {
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * s.def.backdoorRegenPct * dt);
    }
    if (s.def.range <= 0) continue;
    if (sim.phase !== 'playing') continue;

    if (sim.time >= s.nextRetarget) {
      s.nextRetarget = sim.time + 0.25;
      const t = acquire(sim, s);
      s.targetId = t ? t.id : -1;
    }
    const target = s.targetId >= 0 ? (sim.units.get(s.targetId) as AnyUnit | undefined) : undefined;
    const eye = { x: s.pos.x, y: s.pos.y + s.height * 0.85, z: s.pos.z };
    if (target && target.alive && sim.time >= s.nextAttack) {
      const tc = { x: target.pos.x, y: target.centerY(), z: target.pos.z };
      if (!sim.world.segmentBlocked(eye, tc)) {
        s.nextAttack = sim.time + s.def.attackInterval;
        s.attackAnim = 0.3;
        const phaseMul = s.def.type === 'patron' && s.phase === 2 ? PATRON_PHASE2.damageMul : 1;
        const heroMul = target.kind === 'hero' ? s.def.heroDamageMul : (s.def.trooperDamageMul ?? 0.55);
        let dmg = s.def.damage * phaseMul * heroMul;
        if (target.kind === 'hero' && target.inFountain) dmg *= BALANCE.combat.fountainProtection;
        sim.dealDamage(target, { sourceId: s.id, amount: dmg, type: 'spirit', pos: tc });
        sim.events.push({ t: 'vfx', kind: 'beam', pos: eye, to: tc, radius: 0.25, color: s.team === 0 ? '#ffb347' : '#5ab4ff', duration: 0.18, unit: s.id });
      }
    }

    // Walker stomp: telegraphed AoE around its feet when heroes crowd it.
    const st = s.def.stomp;
    if (st && sim.time >= s.nextStomp) {
      let heroNear = false;
      sim.forEachUnitNear(s.pos, st.radius, (u) => {
        if (u.kind === 'hero' && u.alive && u.team !== s.team && distXZ(u.pos, s.pos) < st.radius) heroNear = true;
      });
      if (heroNear) {
        s.nextStomp = sim.time + st.interval;
        const pos = { ...s.pos };
        sim.events.push({ t: 'vfx', kind: 'warn', pos, radius: st.radius, color: '#ff5533', duration: 0.7 });
        sim.addHazard(pos, st.radius, 0.75, s.team);
        sim.schedule(0.7, () => {
          if (!s.alive) return;
          sim.forEachUnitNear(pos, st.radius + 1, (u) => {
            if (!u.alive || u.team === s.team || u.kind === 'structure') return;
            if (distXZ(u.pos, pos) > st.radius + u.radius) return;
            sim.dealDamage(u, { sourceId: s.id, amount: st.damage, type: 'spirit' });
            if (u.kind === 'hero') sim.knockbackUnit(u, u.pos.x - pos.x, u.pos.z - pos.z, 9, 4);
          });
          sim.events.push({ t: 'vfx', kind: 'shockwave', pos, radius: st.radius, color: '#ff8844', duration: 0.5 });
        });
      }
    }

    // Artillery salvo at enemy heroes in range (dodgeable).
    const sv = s.def.salvo;
    if (sv && sim.time >= s.nextSalvo) {
      const heroes: AnyUnit[] = [];
      sim.forEachUnitNear(s.pos, sv.range, (u) => {
        if (u.kind === 'hero' && u.alive && u.team !== s.team && distXZ(u.pos, s.pos) <= sv.range && !(u.flags & SF.INVISIBLE)) heroes.push(u);
      });
      if (heroes.length) {
        s.nextSalvo = sim.time + sv.interval;
        for (const h of heroes.slice(0, 3)) {
          const pos = { x: h.pos.x + h.vel.x * 0.3, y: h.pos.y, z: h.pos.z + h.vel.z * 0.3 };
          sim.events.push({ t: 'vfx', kind: 'warn', pos, radius: sv.radius, color: '#ff3322', duration: sv.delay });
          sim.addHazard(pos, sv.radius, sv.delay + 0.05, s.team);
          sim.events.push({ t: 'vfx', kind: 'mortar', pos: { x: s.pos.x, y: s.pos.y + s.height, z: s.pos.z }, to: pos, radius: 0.4, color: '#ff7744', duration: sv.delay });
          sim.schedule(sv.delay, () => {
            if (!s.alive) return;
            sim.forEachUnitNear(pos, sv.radius + 1, (u) => {
              if (!u.alive || u.team === s.team || u.kind === 'structure') return;
              if (distXZ(u.pos, pos) > sv.radius + u.radius) return;
              sim.dealDamage(u, { sourceId: s.id, amount: sv.damage, type: 'spirit' });
            });
            sim.events.push({ t: 'vfx', kind: 'blast', pos, radius: sv.radius, color: '#ff6633', duration: 0.4 });
          });
        }
      }
    }
  }
}

/** Handles a structure reaching zero health. Returns true if it truly died. */
export function structureDowned(sim: Simulation, s: Structure): boolean {
  if (s.def.type === 'patron' && s.phase === 1) {
    s.phase = 2;
    s.maxHp = PATRON_PHASE2.maxHp;
    s.hp = s.maxHp;
    s.height = PATRON_PHASE2.height;
    s.alive = true;
    sim.events.push({ t: 'structure', id: s.id, key: s.key, state: 'phase2' });
    sim.announce(`The ${teamName(s.team)} Patron is weakened!`, -1, 'objective');
    return false;
  }
  return true;
}
