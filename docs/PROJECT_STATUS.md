# Project Status

_Last updated: 2026-10-28._

HEXLINE is playable end to end: full 6v6 matches against autonomous bots
(offline), practice and spectator modes, and online play through an
authoritative match server. Everything is original content; no files from
the reference game were available or used.

## Verification (latest run)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean |
| Unit, AI-scenario and network integration tests | `npm test` | 70 / 70 passing |
| Browser e2e, single player | `npm run e2e` | 23 / 23 checks |
| Browser e2e, online | `npm run e2e:online` | 11 / 11 checks |
| Production build | `npm run build` | builds; one 1.16 MB JS chunk (330 KB gzipped) |
| Production build in the browser | `E2E_URL=<preview url> npm run e2e` against `npm run preview` | 23 / 23 checks |

Browser tests ran in headless Chromium with software WebGL (SwiftShader).

### Autonomous bot matches (`npm run sim`, 60-minute cap)

Normal difficulty, seeds 1–6:

| Seed | Result |
| --- | --- |
| 1 | team 1 wins at 32.2 min |
| 2 | team 1 wins at 43.3 min |
| 3 | team 1 wins at 49.6 min |
| 4 | team 0 wins at 32.2 min |
| 5 | team 0 wins at 35.5 min |
| 6 | team 1 wins at 36.6 min |

Easy and Expert, seeds 7–9:

| Difficulty | Seed 7 | Seed 8 | Seed 9 |
| --- | --- | --- | --- |
| Easy | team 1, 50.7 min | team 0, 27.8 min | no winner at 60 min (both enemy Shrines down; only the Patron left) |
| Expert | team 0, 33.4 min | team 0, 45.5 min | team 1, 43.1 min |

Simulation cost: 0.41–0.66 ms per tick on average for 6v6 including AI;
the worst single tick was 50–125 ms (GC or contention on a shared 4-vCPU
container; not yet investigated further).

### Fixes made while measuring (this session)

- **Trooper lane following.** Stuck recovery skipped lane waypoints, which
  sent troopers straight through the city and created a strong side bias
  (team 0 lost 26 structures vs 11 in 12 lineup-swapped 18-minute runs; in
  troopers-only runs one lane piled up). Troopers now project onto their
  lane and side-step when stuck. Troopers-only matches are now even.
- **Shrine pushes.** Bots never chose to push weaponless Shrines (the push
  goal used weapon range), leaving the endgame to troopers (heroes dealt 10
  damage to the Patron in a 60-minute match). Fixed; all Normal seeds now
  finish.
- **Browser freeze** from an accelerated minimap canvas blocking on the GPU;
  **purchases not applying** while the shop was open; **shop layout** broken
  by a CSS class collision; four **settings that did nothing**
  (colour-blind, reduce shake, damage numbers, auto-level).

## Feature status

| Area | Status |
| --- | --- |
| Match flow (pregame → playing → end → results → rematch/menu) | Done |
| Map: three lanes, jungle, high ground, bases, mid-boss, ziplines | Done (one original map) |
| Heroes, weapons, ability framework | Done: 8 heroes, data-driven abilities with upgrades |
| Gunplay (falloff, headshots, recoil/spread, reload, projectiles) | Done |
| Movement (stamina, dash, dash-jump, slide, mantle, ziplines) | Done |
| Troopers, structures, objective chain, backdoor protection | Done |
| Souls economy, orbs, levels, items (36), shops, flex slots | Done |
| Bot AI (perception, strategy, team calls, tactics, aim, shopping, difficulty, pings) | Done; tuned for bot-vs-bot |
| AI inspector (F3) | Done |
| HUD, minimap with vision, menus, settings (persisted) | Done |
| Procedural audio | Done |
| Online play (authoritative server, snapshots, drop-in/out) | Done for LAN; no prediction or lag compensation |
| Tests: unit, scenario, integration, browser e2e, long autonomous runs | Done |
| Docs | Done (README + `docs/`) |

## Next steps (in priority order)

1. **Client-side prediction and reconciliation** for the local hero online
   (replay unacknowledged inputs through `updateHeroMovement`, using the
   `ack` sequence already sent in snapshots), then server-side lag
   compensation for hit registration.
2. **Snapshot bandwidth**: delta-encode against the last acknowledged
   snapshot and drop static fields (hero stats, status specs) from
   per-snapshot data. Currently about 95–120 KB/s per client.
3. **Pacing of close games**: the Walker and Base Guardian phases can stall
   for 10–20 minutes in even matches (Normal seed 3, Easy seed 9).
   Candidates: stronger late-game trooper scaling, or team push calls that
   don't require a 1.25× advantage once the enemy's lane structures are
   gone. Re-measure with seeds 1–9 at all difficulties.
4. **Investigate worst-case tick spikes** (50–125 ms) with a CPU profile of
   a headless run.
5. **Code-split** the client bundle (Three.js, UI, game) and measure load
   time.
6. **Real-GPU performance pass**: frame-time capture on a mid-range GPU per
   quality preset, then adjust presets and draw-call budgets.
7. **Browser coverage**: run the e2e suites in Firefox and WebKit via
   Playwright.
8. **Content**: more heroes and items, soul urn and breakable-crate
   mechanics, more neutral objectives.
9. **Deployment**: the build is static with relative paths, so it can be
   published to GitHub Pages (this repository is a Pages site) with a
   workflow that builds and uploads `dist/`. Not done yet, because it would
   replace the currently published site.
