# Architecture

## Overview

```
 ┌───────────── browser client (src/game, src/ui, src/rendering, src/audio) ─────────────┐
 │                                                                                        │
 │  InputManager ──► GameSession ──(InputCommand per tick)──► Simulation (src/core)       │
 │  (keys/mouse,      │   fixed 60 Hz accumulator                │  ▲                      │
 │   pointer lock)    │   render interpolation (alpha)           │  │ controllers hook     │
 │                    │                                          │  │ (BotManager, src/ai) │
 │                    ▼                                          ▼  │                      │
 │  GameRenderer (Three.js) ◄── reads entity state + SimEvents ──┘  │                      │
 │  React UI (HUD, shop, menus) ◄── polls state at 8–15 Hz          │                      │
 │  AudioManager (WebAudio) ◄── SimEvents                           │                      │
 └────────────────────────────────────────────────────────────────────────────────────────┘
                     ▲ snapshots / events            │ InputCommand + PlayerAction
                     │                               ▼
 ┌──────────── server/ (Node, optional) ─────────────────────────────────────────────────┐
 │  Same Simulation + BotManager, authoritative; WebSocket transport (src/network)         │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

The single most important boundary: **`src/core`, `src/world`,
`src/gameplay` and `src/ai` never import Three.js, React or the DOM.** The
whole game runs headless in Node, which is what makes the test suite, the
autonomous match runner (`npm run sim`) and the authoritative server possible.

## The simulation (`src/core/simulation.ts`)

- Fixed timestep: 60 Hz (`BALANCE.tickRate`). Each `step()` runs systems in a
  fixed order:
  1. copy positions to `prevPos` (for render interpolation), rebuild the
     spatial grid;
  2. **controllers** (the bot manager) write `hero.input` for bot heroes;
  3. status effects (expiry, damage/heal over time);
  4. heroes (`gameplay/heroSystem.ts`): actions → abilities → melee →
     weapon → movement → regeneration;
  5. troopers, summons, neutral camps, neutrals, structures;
  6. projectiles (swept collision vs. world, units, soul orbs);
  7. orbs, zones, pickups, scheduled timers;
  8. waves, passive income, fountain defence (while playing);
  9. team vision (5 Hz), corpse cleanup.
- Deterministic for a given seed and input stream: all randomness goes through
  seeded `Rng` instances (simulation RNG plus one per bot brain).
- `sim.events` is a queue of `SimEvent`s (shots, damage, deaths, casts, VFX
  hints, announcements…). Presentation, audio, HUD feeds and the network layer
  consume them; gameplay never depends on anyone listening.
- Entities are plain classes in `gameplay/entities.ts` (`Hero`, `Trooper`,
  `Structure`, `Neutral`, `Summon`, `Projectile`, `SoulOrb`, `Zone`). Units are
  indexed by stable numeric ids in `sim.units`.
- Damage has exactly one entry point (`gameplay/damage.ts → dealDamage`) which
  enforces team rules, invulnerability, structure gating, backdoor
  protection, resistances, shields, lifesteal, attribution and death.

## The input contract (`src/core/input.ts`)

```ts
interface InputCommand { moveX; moveZ; yaw; pitch; buttons }  // per tick
type PlayerAction = buy | sell | upgradeAbility | ping          // discrete
```

Every hero — human, bot, or remote client — is driven only through this
structure. Bots therefore cannot do anything a player can't (no direct
position writes, no hidden shortcuts), and a server can validate inputs
(`sanitizeInput`) instead of trusting client state.

Aiming: the simulation's aim ray starts at the hero's eye. The client converts
the third-person crosshair into an eye-relative yaw/pitch each tick
(`GameSession.sampleLocalInput`), so third-person parallax never breaks
hit-registration and bots/servers use exactly the same rule.

## World (`src/world`)

- `collision.ts`: static AABB boxes and ramps (wedges) in a uniform 8 m grid.
  Cylinder push-out with step-up, ground/ceiling queries, ray casts (slab test
  for boxes, convex planes for ramps, Amanatides-Woo grid traversal).
- `cityBuilder.ts`: turns explicit open areas (streets, plazas, bases) and
  fixed-height overrides into building lots, then greedily merges equal cells
  into large boxes. The map (`data/maps/city.ts`) is mirrored across z = 0 so
  both teams get identical geometry.
- `nav.ts`: layered 2 m navigation grid built *from the collision world*
  (multiple walkable surfaces per cell: street, ramp, rooftop, bridge) with
  walk/jump/drop/zipline edges, A* with a binary heap and string-pulling.

Collision geometry is the same data the renderer draws, so collision always
matches what is visible.

## Client loop (`src/game/session.ts`)

`requestAnimationFrame` drives an accumulator: input is sampled and the
simulation stepped in fixed 1/60 s increments (max 6 per frame to avoid a
spiral of death), then the renderer draws with `alpha = acc / dt` to
interpolate between the last two ticks. Mouse look updates the camera every
frame (not every tick) for responsiveness. Pausing simply stops stepping.

## Rendering (`src/rendering`)

- `renderer.ts`: scene, lights (moon directional with camera-following shadow
  frustum, hemisphere, camera fill light), fog, sky shader, optional bloom
  (`UnrealBloomPass`), quality presets (resolution scale, shadows, effects
  density, view distance, post-processing, frame cap).
- `worldView.ts`: buildings merged per facade style with storey-based UVs,
  procedural textures (`textures.ts`), instanced lamps, ziplines, shops,
  skyline; static props baked into a few meshes (`bake.ts`).
- `characters.ts`: procedural humanoid rigs (joint hierarchy, distinct
  proportions/headwear/coats/weapons per hero) with a procedural animator
  (locomotion, aim pitch, recoil, reload, cast, melee, airborne, crouch,
  slide, zipline, stun, hit flash, death). Static parts per joint are baked
  into vertex-coloured meshes to cut draw calls.
- `trooperView.ts`: all troopers drawn with ~9 InstancedMeshes plus instanced
  health bars.
- `effects.ts`: GPU point particles, instanced beams/tracers and glow
  billboards, pooled ground decals for telegraphs/zones, event-driven ability
  VFX.
- `camera.ts`: over-the-shoulder camera with world-collision boom, zoom FOV,
  visual recoil, shake, free-camera debug mode.

## UI (`src/ui`)

React renders menus and HUD panels, which poll live simulation state at
8–15 Hz (`useTicker`); nothing in the 60 Hz loop goes through React state.
Truly per-frame feedback (hitmarkers, floating damage numbers) is plain DOM
managed by `hud/Feedback.ts`.

## AI integration

`BotManager` (`src/ai/botManager.ts`) registers itself as a simulation
controller. Each tick it updates both `TeamCoordinator`s and every
`BotBrain`, which write `hero.input` / `hero.actions`. See
[`AI_DESIGN.md`](AI_DESIGN.md).

## Networking

Server-authoritative, implemented in `server/` and `src/network/`:

- **Server** (`server/matchServer.ts`): runs the same `Simulation` +
  `BotManager` at 60 Hz. Every hero starts as a bot; a joining client takes
  over a bot hero (`BotManager.detach`) and it returns to the AI on
  disconnect (`attach`). Matches restart automatically after they end. The
  same HTTP port can serve the production build, with path-traversal
  protection.
- **Protocol** (`src/network/protocol.ts`): versioned JSON text frames over
  WebSocket with per-message deflate. Client → server: `hello`, `input`
  (one `InputCommand` per client tick with a sequence number), `action`
  (`PlayerAction`), `ping`. Server → client: `welcome` (match config, hero
  ids, the client's hero), `snapshot` (20 Hz, with the last input sequence
  applied), `pong`, `error`. Inputs pass through `sanitizeInput` and actions
  through `sanitizeAction`; the server queues inputs per client and skips
  ahead (keeping button taps) if a client falls behind.
- **Snapshots** (`src/network/snapshot.ts`): encoded once per viewing team.
  Enemy heroes' and summons' positions and combat state, enemy traps and
  the action events of hidden enemies are withheld unless that team can see
  them, so the server does not leak fog-of-war information about heroes.
- **Client** (`src/network/client.ts` + `GameSession` remote mode): builds a
  mirror `Simulation` from the welcome's config (same entity ids as the
  server), never steps it, and applies snapshots to it, so the renderer, HUD
  and minimap work unchanged. Rendering interpolates between the last two
  snapshots and extrapolates projectiles between them. There is no
  client-side prediction yet.

Tests: `tests/integration/network.test.ts` (real server and sockets) and
`tests/e2e/run-online-e2e.mjs` (browser joins from the menu). Limits are in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

## Performance budget

Measured headless on the 4-vCPU development container (6v6 with full trooper
waves): ~0.4–0.6 ms per simulation tick including AI (≈3% of a 16.7 ms
frame). Rendering budget targets ≤ ~400 draw calls in typical lane views;
troopers are instanced, character joints and static props are baked, and
effects are pooled. A developer overlay (F3) reports FPS, frame time,
simulation/AI/projectile timings, draw calls, triangles, entity counts and JS
heap.
