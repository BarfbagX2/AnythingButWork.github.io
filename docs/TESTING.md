# Testing

Everything below runs in the development container without a GPU. Browser
tests use headless Chromium with SwiftShader (software WebGL), which renders
at only a few frames per second, so browser waits are measured in
*simulation* time.

## Commands

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over `src`, `data`, `server`, `tests`, `tools`. |
| `npm test` | Vitest: unit, AI-scenario and network integration tests (headless, ~4 s). |
| `npm run e2e` | Browser end-to-end test of the real single-player flow (starts Vite on :5174, or set `E2E_URL`). |
| `npm run e2e:online` | Browser end-to-end test of online play against a real match server (:8799). |
| `npm run sim -- --seed N [--minutes 60] [--difficulty normal] [--size 6] [--quiet]` | Full autonomous bot-vs-bot match, headless; prints the objective timeline, K/D, items and tick timings. |
| `npx tsx tools/aim-calibration.ts` | Bot hit rates against a strafing target by difficulty and range. |
| `npx tsx tools/diagnose.ts` | Where bots spend their time (goal histogram, damage by source → target type) for a seed. |
| `npm run build` | Typecheck + production build. |

The e2e scripts need Playwright with Chromium available
(`npm i -D playwright && npx playwright install chromium` on a fresh machine).
Their screenshots go to `tests/e2e/output/` (git-ignored).

## Test suites

### Unit and scenario tests (`tests/unit`, Vitest)

Small purpose-built arenas (`tests/helpers.ts`) keep each test fast and
focused.

- `combat.test.ts`: bullet vs. spirit resistances, friendly fire and
  invulnerability, shields, kills (respawn timer, souls, assists), bullet
  lifesteal, ammo/fire rate/reload, semi-automatic fire, auto-reload,
  projectiles hitting targets and being blocked by walls, headshots, damage
  falloff, light melee and parry.
- `abilities.test.ts`: locked abilities and unlocking with ability points,
  ultimate level requirement, cooldowns, upgrades changing parameters, AoE
  hitting enemies but not allies, projectile abilities (Hex Bolt silences),
  stuns interrupting channels, dashes respecting walls, summons, damage over
  time, slows without stacking, roots.
- `movement.test.ts`: walking and wall collision, jump/double jump and
  stamina, dash stamina and regeneration, mantling, ramps, ziplines (and
  being knocked off), and identical movement however ticks are grouped.
- `economy.test.ts`: levels and ability points from souls, passive income,
  last hits and soul orbs (secure and deny), melee last hits, shop range and
  cost checks, item stats not stacking across respawns, component upgrades,
  category and flex slots, selling and item actives.
- `objectives.test.ts`: structure prerequisites, backdoor protection,
  structure targeting (troopers first, then heroes attacking allied heroes),
  Patron phases and match end, team rewards and flex slots, wave schedule,
  troopers advancing and fighting (cap, no permanent sticking), pregame →
  playing, and fountain defence.
- `ai.test.ts`: engaging an enemy that appears, retreating at low health,
  defending a structure, buying items, spending ability points, answering a
  human's group-up ping, navigating around obstacles, recovering after death,
  not knowing about enemies it has never seen, joining a mid-boss call,
  expert bots out-aiming easy bots on a strafing target, and identical bot
  stats across difficulties.

### Network integration (`tests/integration/network.test.ts`)

Starts a real `MatchServer` on a free port and connects real WebSocket
clients: hero takeover on join, client input moving the server's hero and the
client mirror converging, hidden enemy heroes withheld from snapshots,
legal vs. malformed actions, protocol-version rejection, handing the hero
back to the AI on disconnect, and option defaults.

### Browser end-to-end

`tests/e2e/run-e2e.mjs` (23 checks) drives the real input path: main menu,
match start, pointer lock, WASD, mouse look, jump, shooting, reload, Alt+3
ability upgrade, casting a targeted ability, shop open/buy/close, death,
respawn, pause/resume, scoreboard, victory, results, rematch, quit, and no
uncaught page errors.

`tests/e2e/run-online-e2e.mjs` (11 checks) starts a match server with
`--wait-for 1`, joins from the Online menu, verifies the hero is taken over
and snapshots arrive, opens the shop, round-trips an ability upgrade through
the server, walks, quits, and checks the server handed the hero back to the
AI.

### Autonomous matches (regression and balance)

`npm run sim` plays complete 6v6 matches with no human input. It is the main
regression check for the AI and for match pacing: a change that makes bots
stall, never push, or never finish shows up as `no winner after N min`.
Current results are recorded in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Writing new tests

- Prefer the arena helpers and `place()` for deterministic setups; pass
  `pregame: 0` and disable waves, neutrals and structures unless the test
  needs them.
- Drive heroes only through `hero.input` / `hero.actions` (the same contract
  bots and network clients use).
- AI tests should assert outcomes (the bot fought, retreated, bought), not
  internal goal names, so refactors don't break them needlessly.
