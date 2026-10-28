# Known Limitations

An honest list of what HEXLINE does not do, or does only partly. Numbers
come from measurements in the development container unless stated.

## Fidelity to the reference game

- **No original game data.** No files from the reference game were present
  (see `LOCAL_ASSET_AUDIT.md`), so nothing was extracted or reverse
  engineered. Rules marked [B] in `GAMEPLAY_SYSTEMS.md` follow public
  documentation; every number (health, damage, costs, timings) is our own
  tuning unless marked, and is not claimed to match the original.
- **Original content, smaller scope.** One original map with three lanes, 8
  original heroes and 36 original items. The reference game has many more
  heroes and items, a denser vertical map, and systems we have not built
  (for example soul urn deliveries, breakable crates and the full set of
  neutral objectives).
- **Art and animation are procedural.** Characters are primitive-based rigs
  with procedural animation, with no skinned meshes, facial animation or
  ragdolls. The city is box architecture with procedural textures. It reads
  clearly but is not AAA-quality art.
- **Audio is synthesised.** No voice lines or recorded sound; music is a
  generative ambient loop.

## Online play

- **No client-side prediction.** Your own movement and shots are applied
  when the server processes them, so input latency is the round trip plus
  up to one snapshot interval (50 ms) plus interpolation. That is fine on a
  LAN and noticeable over the internet.
- **No lag compensation.** The server resolves hits against current
  positions, so at high ping you must lead targets by your latency.
- **Bandwidth.** Full JSON snapshots at 20 Hz measured 24–28 KB raw and
  about 5–6 KB deflated in a 6v6 bot match, about 95–120 KB/s per client.
  Delta snapshots and a binary encoding would cut this substantially.
- **Visibility filtering covers heroes, summons, traps and their action
  events.** Troopers and neutrals are always sent, so a modified client
  could see them through walls (low value, but not hidden).
- **No accounts, matchmaking, authentication or encryption.** Anyone who can
  reach the port can join, and transport is plain `ws://` unless you put
  the server behind a TLS proxy. Intended for LAN or trusted groups.
- **Reconnecting** takes whichever free bot hero is available; it does not
  restore your previous hero, items or souls.
- **Pausing** is not available online (the pause menu only stops your
  input).

## AI

- Bots are tuned and tested in bot-vs-bot play. Against humans they do not
  bait, fake retreats, read audio cues beyond gunfire, or adapt to an
  individual player's habits over a match.
- Rooftop, high-ground and zipline play is basic: bots path over rooftops
  and ride ziplines, but don't deliberately seek height advantage.
- **Match pacing.** Across seeds 1–6 at Normal, every bot match finishes,
  four of six in 32–37 minutes; close games run longer (43 and 50 minutes in
  that set). Pacing has not been tuned for human players.
- Aim accuracy is calibrated against a strafing target (see
  `AI_DESIGN.md`), not against real players.

## Platform and performance

- **Only tested in Chromium**: desktop Chrome/Chromium via Playwright in
  headless mode. Firefox and Safari are untested. Mobile and touch are not
  supported (the game needs a mouse and pointer lock).
- **Rendering performance has not been measured on a real GPU.** The
  development container only has software WebGL (SwiftShader), where the
  game renders at a few frames per second; that environment was used to
  verify correctness, not frame rate. Simulation cost is measured: about
  0.4–0.6 ms per tick for a 6v6 bot match including AI.
- One JavaScript bundle of about 1.1 MB (330 KB gzipped); there's no code
  splitting yet.
- Shaders are pre-compiled at load to avoid first-use hitches; on slow GPUs
  the first frame of a match can still take a moment.

## Testing

- Browser tests drive mouse look with synthetic `mousemove` events, because
  headless Chromium does not deliver real relative motion under pointer
  lock. Keyboard, clicks and pointer lock itself are real.
- The browser tests run against software WebGL, so they verify behaviour,
  not visual quality or frame rate.

## Accessibility

Available: rebindable keys, mouse sensitivity and invert Y, field of view,
HUD scale, colour-blind palette (blue/orange instead of green/red
ally/enemy colours), reduced camera shake, damage-number toggle, automatic
ability levelling, per-bus volume. Not available: subtitles or visual
indicators for all sounds, remappable mouse buttons, controller support,
or a high-contrast UI theme.
