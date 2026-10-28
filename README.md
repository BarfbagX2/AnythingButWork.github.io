# HEXLINE

A browser-native 3D lane-based hero shooter (MOBA) with complete 6v6 matches
against autonomous bot teammates and opponents, offline or on a LAN server.

HEXLINE recreates the *structure* of a hero-shooter MOBA in the style of
Valve's Deadlock — three lanes, trooper waves, Guardian → Walker → Base
Guardian → Shrines → two-phase Patron, a souls economy, stamina movement,
ziplines, a mid-boss — using **original** heroes, art, audio and map. No
proprietary assets are used or required (see
[`docs/LOCAL_ASSET_AUDIT.md`](docs/LOCAL_ASSET_AUDIT.md)). Not affiliated with
or endorsed by Valve.

## Quick start

Requirements: Node.js 20+ and a WebGL2-capable browser.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build (fully static, relative paths — host it anywhere):

```bash
npm run build        # typecheck + build into dist/
npm run preview      # serve dist/ locally
```

## How to play

Pick **Play — 6v6 bot match**, choose a hero, and click *Enter the city*.
Click the game view to capture the mouse.

| Action | Default key |
| --- | --- |
| Move | W A S D |
| Aim / shoot / zoom | Mouse / LMB / RMB |
| Jump, double jump (1 stamina) | Space |
| Dash (1 stamina; dash + jump = dash-jump) | Left Shift |
| Crouch / slide (dash + crouch = dash-slide) | Left Ctrl |
| Reload | R |
| Melee (hold for heavy) / Parry | Q / F |
| Abilities 1–4 | 1 2 3 4 |
| Upgrade ability | hold Left Alt + 1–4 |
| Item actives | Z X C V |
| Ride zipline | E (under a team zipline) |
| Shop / scoreboard | B / Tab (hold) |
| Contextual ping / team commands | G / T |
| Pause | Esc |
| Developer overlay + AI inspector | F3 (PgUp/PgDn to switch bot) |

Jump into a ledge to **mantle** onto it. Last-hit troopers for souls and shoot
the **soul orb** they drop to secure the rest (or deny the enemy's).
Destroying Walkers, Base Guardians and Shrines unlocks **flex item slots**.
The match ends when a Patron's second phase is destroyed.

Other modes: **Practice range** (20,000 souls, easy bots) and **Watch bots
play** (all-bot spectator mode; `[`/`]` switch hero, `+`/`-` game speed, F8
free camera).

All keys are rebindable and settings persist locally (Settings → Controls).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck (`tsc`) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit, integration and AI scenario tests (Vitest) |
| `npm run e2e` | Browser end-to-end test of the player flow (Playwright) |
| `npm run e2e:online` | Browser end-to-end test of joining a match server |
| `npm run sim -- --minutes 40 --seed 3` | Headless autonomous 6v6 match with a timeline and stats |
| `npm run server` | Authoritative WebSocket match server (see [Multiplayer](#multiplayer)) |

## Project layout

```
src/core/       simulation, fixed-step clock, input contract, events, math, RNG
src/world/      collision world, city builder, nav grid, map types
src/gameplay/   heroes, movement, weapons, abilities, statuses, troopers,
                structures, neutrals, economy, items, vision, waves
src/ai/         perception, aim, navigator, strategy, brain, team coordinator
src/rendering/  Three.js renderer, camera, procedural characters/textures, effects
src/ui/         React menus, HUD, minimap, shop, scoreboard, settings, debug
src/audio/      procedural WebAudio sound
src/game/       client session loop, input manager, settings, match setup
src/network/    multiplayer protocol and client
server/         authoritative Node match server
data/           heroes, items, units, balance, AI profiles, map
tests/          unit / integration / AI tests, browser e2e
tools/          headless match runner and diagnostics
docs/           architecture, systems, AI, assets, testing, limitations, status
```

Documentation: [Architecture](docs/ARCHITECTURE.md) ·
[Gameplay systems](docs/GAMEPLAY_SYSTEMS.md) · [AI design](docs/AI_DESIGN.md) ·
[Asset pipeline](docs/ASSET_PIPELINE.md) · [Testing](docs/TESTING.md) ·
[Known limitations](docs/KNOWN_LIMITATIONS.md) ·
[Reconstruction notes](docs/RECONSTRUCTION_NOTES.md) ·
[Project status](docs/PROJECT_STATUS.md)

## Multiplayer

Online play uses an authoritative match server: the server runs the same
simulation and bots, clients only send inputs and render the server's
snapshots.

```bash
npm run build                 # optional: lets the server host the game too
npm run server                # ws://<host>:8787 (and http://<host>:8787/ if built)
npm run server -- --port 9000 --team-size 4 --difficulty hard --wait-for 2
```

Players choose **Online — join a server** in the main menu and enter the
server address. Every empty hero slot is played by a bot: you take over a
bot's hero when you join and the bot takes it back when you leave. The
server restarts a new match after each one ends. `--wait-for N` holds the
match until N players have joined.

Online play is meant for a LAN or a trusted group: there is no client-side
prediction, no lag compensation and no authentication yet (see
[Known limitations](docs/KNOWN_LIMITATIONS.md)). Protocol and design:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#networking).

## Pre-existing repository contents

The `routes/` directory predates this project (Express route stubs for an
unrelated chat application) and is left untouched; it is not used by the game.
