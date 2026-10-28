# Asset Pipeline

## Policy

HEXLINE ships **no proprietary assets**. No file from the reference game was
available in the development environment (see
[`LOCAL_ASSET_AUDIT.md`](LOCAL_ASSET_AUDIT.md)), and none would be
redistributed if it were. Every model, texture, sound and piece of music is
generated procedurally at runtime from code in this repository. The build
(`dist/`) contains only JavaScript, CSS and an HTML shell; there is no
`public/` folder and no runtime asset fetching (verified by searching the
source for `fetch(`, `TextureLoader`, `GLTFLoader`, `new Audio(` and media
file extensions).

Names of heroes, items, factions, structures and the map are original. Generic
genre terms (lane, trooper, guardian, shrine, soul, zipline) are used as
plain descriptions; see [`RECONSTRUCTION_NOTES.md`](RECONSTRUCTION_NOTES.md).

## Textures (`src/rendering/textures.ts`)

Canvas 2D drawings uploaded as `THREE.CanvasTexture`s, seeded through the
project's deterministic `Rng` so they look the same every run:

| Generator | Used for |
| --- | --- |
| `makeFacade(style, seed)` | Building walls: storeys, window grids with random lit windows (separate emissive map), trims, signage blocks. Several facade styles. |
| `makeAsphalt`, `makeConcrete`, `makeRoof` | Streets, plazas, rooftops (noise, cracks, stains, tar seams). |
| `makeLaneLine(color)` | Lane markings. |
| `makeRadial`, `makeRing` | Glows, particles, telegraph and zone decals. |
| `makeSkyGradient` | Sky dome fallback (the sky itself is a small shader). |

Canvases are CPU-backed (`willReadFrequently`) because Chrome otherwise stalls
on a GPU readback when uploading an accelerated canvas (see the fix notes in
the git history). The texture-quality setting picks the resolution.

## Geometry and characters

- **City** (`src/world/cityBuilder.ts`, `src/rendering/worldView.ts`): the
  collision boxes *are* the buildings, so visuals always match collision.
  Boxes are merged per facade style into a few large meshes with
  storey-based UVs; lamps are instanced; props are baked (`bake.ts`).
- **Heroes** (`src/rendering/characters.ts`): procedural rigs built from
  primitive meshes on a joint hierarchy. Each hero definition
  (`data/heroes/*.ts`, `model` block) sets proportions, palette, headwear,
  coat and weapon shape. Static parts per joint are baked into
  vertex-coloured meshes to keep draw calls low. Animation is procedural
  (`Animator`): locomotion cycles, aim pitch, recoil, reload, cast, melee,
  airborne, crouch/slide, zipline, stun, hit flash and death.
- **Troopers** (`src/rendering/trooperView.ts`): ~9 instanced meshes shared
  by every trooper, plus instanced health bars.
- **Structures, creatures, summons** (`src/rendering/unitViews.ts`): built
  from primitives per type, with a fresnel shield shader for invulnerable
  structures.
- **Effects** (`src/rendering/effects.ts`): GPU point particles, instanced
  beams/tracers and glow billboards, and pooled ground decals. A warm-up
  pass compiles every effect, summon and creature shader when the match
  loads.

## Audio (`src/audio/audio.ts`)

WebAudio synthesis only: oscillators, filtered noise bursts and envelopes for
gunshots (per weapon style), impacts and hitmarkers, abilities, movement,
reloads, explosions, UI cues and announcements. Positional sounds use a
`PannerNode` relative to the camera. Music is a generative ambient loop
built from the same primitives. Volumes per bus (master, music, effects, UI,
voice) are user settings.

## Adding or changing assets

- New hero look: edit the `model` block of its definition; no art files.
- New building style: add a `FacadeStyle` in `textures.ts` and reference it
  from the map's lot generation.
- New effect: handle a new `vfx` kind in `effects.ts` and emit it from an
  ability via `ctx.vfx(...)`.
- If real art is ever added, it must be original or properly licensed, and
  should go through Vite's asset handling (import or `public/`), with this
  document updated to list its source and licence.
