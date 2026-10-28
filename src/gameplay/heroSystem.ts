import { BALANCE } from '../../data/balance';
import type { Simulation } from '../core/simulation';
import { ABILITY_BTNS, BTN, ITEM_BTNS } from '../core/input';
import { dirFromYawPitch } from '../core/math';
import { tryCastAbility, updateAbilityCharges, updateCasting, upgradeAbility } from './abilities';
import { updateMelee, updateWeapon } from './combat';
import type { Hero } from './entities';
import { pressed, tryAttachZipline, updateHeroMovement, updateStamina } from './movement';
import { applyHeroStats, deriveHeroStats } from './stats';
import { SF } from './types';

const C = BALANCE.combat;

export function updateHero(sim: Simulation, hero: Hero, dt: number): void {
  if (!hero.alive) {
    hero.prevButtons = hero.input.buttons;
    if (sim.phase !== 'ended' && sim.time >= hero.respawnAt) sim.respawnHero(hero);
    return;
  }
  applyHeroStats(hero, deriveHeroStats(hero, sim.teamBuffMods(hero.team0)));

  const inp = hero.input;
  const stunned = (hero.flags & SF.STUN) !== 0;
  if (!stunned) {
    hero.yaw = inp.yaw;
    hero.pitch = inp.pitch;
  }
  dirFromYawPitch(hero.aimDir, hero.yaw, hero.pitch);

  // Discrete actions (shop, ability points, pings).
  if (hero.actions.length) {
    const acts = hero.actions;
    hero.actions = [];
    for (const a of acts) {
      if (a.type === 'buy') sim.items.buy(hero, a.itemId);
      else if (a.type === 'sell') sim.items.sell(hero, a.itemId);
      else if (a.type === 'upgradeAbility') {
        if (upgradeAbility(hero, a.slot)) sim.events.push({ t: 'cast', unit: hero.id, ability: 'upgrade', slot: a.slot, pos: { ...hero.pos }, dir: { x: 0, y: 1, z: 0 } });
      } else if (a.type === 'ping') sim.addPing(hero, a.kind, a.x, a.z, a.targetId, a.lane);
    }
    // Purchases take effect immediately.
    if (acts.some((a) => a.type === 'buy' || a.type === 'sell')) applyHeroStats(hero, deriveHeroStats(hero, sim.teamBuffMods(hero.team0)));
  }

  const disarmed = (hero.flags & SF.DISARM) !== 0;
  const parrying = sim.time < hero.parryUntil;

  if (!stunned && !hero.zip && pressed(hero, BTN.INTERACT)) tryAttachZipline(sim, hero);
  // Jumping while airborne near a zipline also grabs it (reference behaviour).
  if (!stunned && !hero.zip && !hero.grounded && pressed(hero, BTN.JUMP) && hero.airJumps >= 1) tryAttachZipline(sim, hero);

  updateAbilityCharges(sim, hero);
  if (!stunned && !parrying) {
    for (let i = 0; i < 4; i++) {
      if (pressed(hero, ABILITY_BTNS[i])) {
        const fail = tryCastAbility(sim, hero, i + 1);
        if (fail && !hero.isBot) sim.events.push({ t: 'announce', text: failText(fail), team: -1, kind: 'warning', unit: hero.id });
      }
    }
    for (let i = 0; i < 4; i++) if (pressed(hero, ITEM_BTNS[i])) sim.items.activate(hero, i);
  }
  updateCasting(sim, hero, dt);

  const casting = hero.cast !== null;
  updateMelee(sim, hero, !stunned && !casting && !disarmed && !hero.zip);
  const swinging = hero.meleeSwingAt >= 0 || hero.meleeStart >= 0;
  updateWeapon(sim, hero, dt, !stunned && !disarmed && !parrying && !casting && !swinging);

  let moveMul = 1;
  if (hero.cast) moveMul = hero.abilities[hero.cast.slot - 1].def.castMoveMul ?? (hero.cast.phase === 'channel' ? 0.35 : 0.5);
  else if (parrying) moveMul = 0.6;
  updateHeroMovement(sim, hero, dt, moveMul);
  updateStamina(sim, hero, dt);

  // Regeneration.
  let regen = hero.stats.hpRegen;
  if (sim.time - hero.lastDamagedAt > C.outOfCombatRegenDelay) regen += hero.maxHp * C.outOfCombatRegenPct;
  hero.inFountain = sim.inFountain(hero);
  if (hero.inFountain) regen += hero.maxHp * C.fountainHealPct;
  if (regen > 0 && hero.hp < hero.maxHp && !(hero.flags & SF.NO_HEAL)) hero.hp = Math.min(hero.maxHp, hero.hp + regen * dt);
  if (hero.inFountain) {
    // Fountain also refills ammo and stamina over time.
    if (hero.weapon.ammo < hero.weapon.magazine && !hero.weapon.reloading && sim.tick % 30 === 0) hero.weapon.ammo = hero.weapon.magazine;
  }
  hero.inShopRange = sim.inShopRange(hero);
  hero.prevButtons = inp.buttons;
}

function failText(f: string): string {
  switch (f) {
    case 'locked':
      return 'Ability locked — spend an ability point';
    case 'cooldown':
      return 'Ability on cooldown';
    case 'silenced':
      return 'Cannot cast right now';
    case 'noTarget':
      return 'No valid target';
    case 'busy':
      return 'Already casting';
    default:
      return 'Cannot cast';
  }
}
