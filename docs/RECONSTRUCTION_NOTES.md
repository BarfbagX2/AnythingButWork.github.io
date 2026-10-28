# Reconstruction Notes

This file separates what is known about the reference game from what this
project invents. It is updated whenever a system is implemented or retuned.

Evidence categories (from the project brief):

- **A — Directly available:** read from local files. *Nothing qualifies:
  no local game files exist (see `LOCAL_ASSET_AUDIT.md`).*
- **B — Indirectly observable:** stated in public documentation (community
  wiki, press coverage of public patch notes).
- **C — Reconstructable:** implemented from B plus established design
  practice; numbers are our own.
- **D — Unknown:** cannot be established; replaced by original design.

## Naming and IP policy

The project is an original game ("HEXLINE") that recreates the *structure* of
a lane-based hero shooter. Hero names, hero designs, team names, art, audio,
and map geometry are original. Generic functional terms (troopers, guardian,
walker, shrine, patron, souls, zipline) are used because they describe the
mechanics plainly.

| Reference concept | HEXLINE implementation |
| --- | --- |
| The Amber Hand / The Sapphire Flame | Amber Covenant / Azure Lodge (amber vs. blue team colours kept for readability) |
| Heroes (Abrams, Haze, …) | Original roster in `data/heroes/` |
| Lanes York/Greenwich/Broadway/Park | West (yellow), Mid (green), East (purple) |

## Verified mechanics (Category B) and how they are implemented

| # | Mechanic (public source) | Status in HEXLINE |
| --- | --- | --- |
| B1 | Objective: destroy the enemy Patron | Implemented as final objective |
| B2 | Per-lane chain: Guardian → Walker → Base Guardian; then 2 Shrines; Patron invulnerable until both Shrines fall | Implemented; gating rules in `src/gameplay/structures.ts` |
| B3 | Patron has two phases (upright, then a weakened phase) | Implemented as two health phases |
| B4 | Since the Feb 2025 rework: 3 lanes, middle lane shorter, 6 players per team in duo lanes | Implemented: 3 lanes, mid shorter, 6v6 default with duo lane assignments |
| B5 | Trooper waves spawn every ~30 s per lane per team; mixed ranged + support units | Implemented (30 s interval; composition is ours) |
| B6 | Last-hitting a trooper spawns a soul orb that can be secured by shooting it; melee last hits grant souls directly | Implemented |
| B7 | Souls are both currency and experience | Implemented (levels derived from total souls earned) |
| B8 | Items in three categories: Weapon, Vitality, Spirit; tiered pricing, Tier 1 = 800, Tier 2 = 1,600 souls (current wiki) | Implemented with tiers 800 / 1,600 / 3,200 / 6,400. Tiers 3–4 are **C** (doubling pattern assumed, not verified) |
| B9 | Flex slots unlocked by map objectives | Implemented; exact unlock triggers are **C** |
| B10 | Stamina-based movement: double jump, dash, air dash cost 1 stamina; dash-jump; dash-slide | Implemented (dash-jump cost 2) |
| B11 | Parry: brief state that absorbs one melee attack and stuns the attacker; ~4 s cooldown | Implemented |
| B12 | Light and heavy melee | Implemented |
| B13 | Ziplines run from each base along the lanes; being shot while riding knocks you off | Implemented |
| B14 | Mid-boss drops the Rejuvenator: faster respawns, stronger troopers; can be stolen | Implemented (pickup by touch; buff values are **C**) |
| B15 | Structures have backdoor protection when no enemy troopers are near (widely documented MOBA behaviour; exact numbers unknown) | Implemented as damage reduction + regeneration; numbers **C** |
| B16 | Soul Urn delivered across the map for a soul bounty | Not implemented yet (see KNOWN_LIMITATIONS) |

## Unknowns replaced by original design (Category D → our values)

All of the following live in `data/balance.ts` or the hero/item data files and
are tuned by playtesting and autonomous simulation, not copied:

- Hero health, speeds, weapon damage/fire rate/spread/falloff.
- Ability effects, cooldowns, and upgrade paths (all heroes are original).
- Trooper and structure health/damage, aggro rules.
- Soul reward formulas, level curve, ability-point schedule.
- Respawn time curve.
- Map geometry and scale (original city layout preserving tactical roles:
  lanes, jungle alleys, high ground, bridges, mid-boss plaza, bases).

## Implementation decisions

- Simulation runs at a fixed 60 Hz, independent of rendering, and has no
  dependency on Three.js, React, or the DOM so it runs headless in Node for
  tests, autonomous matches, and the multiplayer server.
- Player and bots drive heroes through the same `InputCommand` structure, so
  bots cannot take actions the player cannot.
- Aim ray originates at the hero's eye; the client converts the camera
  crosshair point into an eye-relative aim so third-person aiming is
  consistent between player, bots, and server.

## Differences from the reference game (known)

See `docs/KNOWN_LIMITATIONS.md` for the maintained list.
