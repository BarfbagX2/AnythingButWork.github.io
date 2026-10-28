# Gameplay Systems

All numbers live in `data/` (`balance.ts`, `units.ts`, `items.ts`,
`heroes/*.ts`). Values marked [B] follow public documentation of the
reference game; everything else is our own tuning (see
`RECONSTRUCTION_NOTES.md`). This document describes *rules*; consult the data
files for current numbers.

## Match flow

`pregame` (heroes in base, shop open, abilities can be unlocked) →
`playing` (trooper waves start, camps at 1:30, mid-boss at 8:00) → `ended`
(the losing Patron's second phase is destroyed) → results → rematch or menu.
Pausing stops the simulation entirely in single-player.

## Map: Hexline Ward

Original night-city map, mirrored across the centre line for fairness.

- **Three lanes** [B]: West and East are U-shaped streets; Mid is a straight,
  shorter avenue. Lane troopers walk their lane's polyline.
- **Jungle**: alleys, two cross streets per half, plazas with neutral camps
  (tier 1 near each base, tier 2 mid-way, a tier-3 camp on the centre line).
- **High ground**: mid-lane rooftops reached by ramps and joined by a bridge
  over the lane; low perches beside the side lanes (double-jump + mantle).
- **Mid-boss plaza** on the centre line between Mid and East.
- **Bases**: fountain (fast heal, ammo refill, shop; hurts enemies), two
  Shrines and the Patron; base gates are guarded by Base Guardians.
- **Ziplines** [B]: one per lane per team from the base gate to the lane's
  forward Guardian; team-owned.

## Objectives [B structure]

Per lane: **Guardian → Walker → Base Guardian**, then **two Shrines** (either
Base Guardian down makes them vulnerable), then the **Patron** (both Shrines
down). Rules:

- A structure is invulnerable until its prerequisites are destroyed (shown by
  a shield bubble and `INVULNERABLE` plate).
- **Backdoor protection**: with no enemy troopers within 26 m a structure
  takes reduced damage and slowly regenerates (only after 10 s without
  damage).
- Targeting: troopers/summons first; switches to an enemy hero that damages an
  allied hero in range (classic tower aggro).
- Walkers stomp (telegraphed AoE + knockback) and fire artillery salvos at
  hero positions (telegraphed, dodgeable). The Patron also fires salvos.
- Patron phase 1 → phase 2 (weakened, lower) → destroyed = victory [B].
- Destroying structures pays every hero on the destroying team; Walkers, Base
  Guardians and Shrines unlock team **flex slots** [B].

## Troopers [B: 30 s waves]

Each lane gets a wave per team every 30 s: three riflemen and a medic, plus a
melee heavy every third wave after 7 minutes, plus two armoured Vanguards once
the enemy Base Guardian in that lane falls. Troopers prefer enemy troopers,
then structures, then heroes (or a hero that attacked an allied hero),
side-step to regain line of sight, separate from each other, and recover if
stuck. Health and damage grow slowly with match time.

## Souls economy [B: souls are currency and XP]

- Passive income every 5 s.
- **Last hit** on a trooper: part of its value immediately, the rest drops as
  a **soul orb** that must be shot to secure [B]; the trooper's allies can
  shoot it to **deny**. Melee last hits pay in full immediately [B].
  Unclaimed orbs pay the killer a reduced amount. Nearby allied heroes get a
  share; troopers killed by troopers/structures pay nearby enemy heroes.
- Hero kills: bounty scaled by the victim's net worth and streak, split with
  assisters (damage within 10 s).
- Neutrals pay the killer (allies nearby get a share); the mid-boss pays the
  killing team and drops the **Rejuvenator** [B] (faster respawns, stronger
  troopers for 3 minutes; any hero can claim it).
- **Levels** come from total souls earned; levels grant growth (health,
  weapon damage, spirit power) and **ability points**.

## Heroes

Eight original heroes (`data/heroes/`), each with a distinct weapon and four
abilities (the fourth is an ultimate, unlockable at level 6):

| Hero | Role | Weapon | Kit |
| --- | --- | --- | --- |
| Rook Hale | Bruiser / initiator | Pump shotgun | Shoulder Charge, Blood Siphon, Bulwark, Earthbreaker (leap slam) |
| Vesper Lune | Marksman | Lever rifle | Piercing Lance, Grapnel, Flare Trap, Deadeye (channelled execute) |
| Cinder Vale | Area damage | Ember SMG | Napalm Flask, Flame Dash, Combustion, Inferno Nova |
| Mortis Grey | Summoner | Hand cannon (splash) | Raise Thralls, Grave Chill, Bone Ward, Soul Harvest (tether) |
| Seraphine Ash | Support | Auto rifle | Mending Light, Aegis, Radiant Pulse, Sanctuary |
| Kestrel Voss | Assassin | Twin revolvers | Shadow Step, Hex Bolt (silence), Veil (stealth), Death Mark |
| Tessa Arc | Crowd control | Burst carbine | Chain Lightning, Static Field, Overcharge, Singularity |
| Gideon Brass | Defensive specialist | Rivet pistol | Deploy Sentry, Magnetic Mine, Overclock Repair, Lockdown |

Abilities: unlock for 1 AP; three upgrade tiers costing 1/2/5 AP [B-like],
each tier changing named parameters. Damage scales with **spirit power**;
durations, ranges and cooldowns scale with item stats.

### Ability framework (`src/gameplay/abilities.ts`)

An ability is data (`params`, `upgrades`, targeting, AI hints, colour) plus a
small `cast` function composed from shared helpers on `AbilityContext`:
`projectile`, `aoe`, `damage`, `heal`, `status`, `stun`, `slow`, `zone`,
`dash`, `leap`, `knockback`, `pull`, `summon`, `delay`, `vfx`. Optional
`channelTick` / `channelEnd` implement channels; stuns and silences interrupt
them (windups are refunded, channels end early). Multi-charge abilities
(Flare Trap, Deploy Sentry) recharge one at a time. All hero data is
validated at load (`data/heroes/index.ts`).

## Combat

- **Weapons**: auto / semi / burst fire modes, pellets, magazines, reload,
  spread with bloom and recovery, moving/airborne spread penalty, crouch
  bonus, damage falloff, splash, headshots (head hit sphere) with per-weapon
  multipliers, projectile travel time and gravity.
- **Hit detection**: swept segments against the world grid, unit capsules and
  head spheres; walls block; each projectile hits a unit once; piercing
  projectiles continue.
- **Damage types**: bullet, spirit, melee (uses bullet resist), pure.
  Resistances stack multiplicatively; shields absorb first.
- **Melee** [B]: tap for light, hold for heavy (lunge + knockback); **parry**
  [B] negates a melee hit and stuns the attacker.
- **Statuses**: stun, root, silence, disarm, invisible, revealed,
  invulnerable, unstoppable, no-heal, slows/buffs via stat mods, DoT/HoT,
  shields. Stats are re-derived from scratch every tick, so nothing can
  stack permanently.

## Movement [B: stamina rules]

Acceleration-based ground movement, momentum-preserving air control,
out-of-combat sprint bonus, **stamina** (default 3, regenerates): double jump
and dash cost 1, dash-jump costs 2 total, dash-slide grants a brief
infinite-ammo window. **Mantling** onto ledges up to ~1.35 m above the feet.
Ziplines: attach under a team cable, ride at 17 m/s, look back to reverse,
jump/crouch to drop; enemy hero damage knocks riders off with a brief stun [B].

## Items

36 original items in Weapon / Vitality / Spirit categories [B] and four tiers
priced 800 / 1,600 / 3,200 / 6,400 [B for tiers 1–2]. Three slots per
category plus team flex slots. Some items upgrade from a component (its cost
is credited). Passives include headshot bonus damage, close/long-range
damage, lifesteal, slows, spirit burn, anti-heal, emergency shields and
low-health regeneration; actives include heals, shields, blink, cleanse,
haste, a spirit nova and untargetability. Shops are in each base and in each
team's jungle; dead heroes can shop anywhere.

## Vision

Each team sees what its units see: heroes 34 m with line of sight (buildings
block), troopers 20 m, structures 30 m; stealthed units only within 5 m.
Structures are always visible. The minimap and the bots' knowledge both use
these rules.
