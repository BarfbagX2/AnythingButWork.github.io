# Local Asset Audit

Audit date: 2026-10-28. Performed at the start of the project, before any
architecture work, using non-destructive, read-only inspection.

## 1. Environment summary

| Item | Finding |
| --- | --- |
| Host | Managed cloud container (Linux 6.18, x86_64), 4 vCPU, 15 GiB RAM, no swap |
| GPU | None. No `nvidia-smi`, no PCI VGA device. |
| WebGL | Headless Chromium (Playwright build 1243) exposes WebGL2 through ANGLE + SwiftShader (software Vulkan). `MAX_TEXTURE_SIZE` 8192. Rendering works, but frame rates in this container are not representative of real hardware. |
| Disk | ~31 GB writable allowance |
| Node.js | v22.22.0 (also 20, 21 available under `/opt`) |
| Package managers | npm 10.9.4, pnpm 10.28, yarn 1.22 |
| Python | 3.13 |
| Media tools | `ffmpeg`, ImageMagick `convert` |
| 3D tools | None (no Blender, no glTF-Transform, no Source 2 Viewer / ValveResourceFormat, no Noesis) |
| Browser automation | Playwright (global), Chromium + headless shell |
| Network | npm registry reachable through the session proxy; general HTTPS allowed via proxy |

## 2. Directories inspected

| Path | Result |
| --- | --- |
| `/home/user/AnythingButWork.github.io` (repository) | `README.md` (3 lines, describes an unrelated group-chat app), `routes/auth.js`, `routes/user.js` (Express route stubs for that chat app). Nothing game-related. |
| `/mnt/user-data/{uploads,working,outputs}` | Empty |
| `/mnt/attach` | Empty |
| `/home/*`, `/root`, `/srv`, `/media` | Shell/tool configuration only |
| `/opt` | Language runtimes, SDKs, Playwright browsers |
| Whole root filesystem (`find / -xdev`) | Searched for `*.vpk`, `*.vmdl*`, `*.vtex*`, `*.vsnd*`, `*.vmap*`, `gameinfo.gi`, `libraryfolders.vdf`, `steamapps`, `*deadlock*`, `*citadel*` (Deadlock's internal codename). **Zero matches.** |

No inaccessible directories were encountered; no access controls were bypassed.

## 3. Relevant files discovered

**None.** There is no Deadlock installation, no Steam library, no exported
assets, no reference captures, and no user-provided documentation in this
environment.

## 4. Tools available

General-purpose only: Node.js, Python, ffmpeg, ImageMagick, Chromium. No tool
capable of reading Source 2 compiled resources was present, and none was
needed because there were no such files.

## 5. Formats successfully inspected

Not applicable — no game resource files exist locally.

## 6. Potentially reusable assets

None. Every model, texture, sound, map, and UI element in this project is
original and generated procedurally in code (see `docs/ASSET_PIPELINE.md`).
This also avoids any redistribution of proprietary Valve assets.

## 7. Data that can inform gameplay reconstruction

Because there is no local evidence, gameplay reconstruction is based on
**public documentation** (community wiki and press coverage of public patch
notes) plus general MOBA / hero-shooter design practice. Every value derived
this way is recorded in `docs/RECONSTRUCTION_NOTES.md` with its evidence
category. Sources consulted:

- deadlock.wiki "Mechanics" page revisions (match structure, objective chain,
  trooper waves, soul orbs, movement/stamina, parry, Soul Urn, Rejuvenator).
- deadlock.wiki "Item" page (item categories, Tier 1 = 800 and Tier 2 = 1,600
  souls, flex slots, investment bonuses).
- Press coverage of the 26 Feb 2025 map rework (four lanes reduced to three,
  shorter middle lane, duo lanes for 6-player teams, mid-boss relocated).

## 8. Missing or inaccessible information (Category D)

- Exact hero, weapon, and ability numbers (damage, fire rates, cooldowns).
- Map geometry, scale, and exact structure placement.
- Trooper / structure / Patron health and damage values.
- Soul reward formulas, level thresholds, respawn curves.
- AI behaviour of Valve's own bots.
- Any audio, model, texture, or animation asset.

## 9. Technical constraints

- Software-only WebGL in this container: visual verification is possible via
  screenshots, but performance profiling must rely on simulation timings and
  draw-call / entity counts rather than raw FPS.
- No 3D authoring tools, so characters and environments are built
  procedurally (Three.js primitives + generated canvas textures + procedural
  animation).
- The repository is a GitHub Pages-style repo; the production build must be
  fully static (relative asset paths). The optional multiplayer server is a
  separate Node process.

## 10. Recommended next steps (taken)

1. Treat the project as an original game that recreates the reference game's
   *gameplay structure* (3-lane 6v6 hero-shooter MOBA with troopers,
   Guardians → Walkers → Base Guardians → Shrines → Patron, souls economy,
   stamina movement, ziplines, mid-boss) with original names and art.
2. Build a headless, deterministic simulation first so AI and full matches
   can be tested in Node without a browser.
3. Keep all tunable numbers in `data/` and label them as approximations.
4. If real Deadlock files are later supplied (e.g. a user-provided install
   path), re-run this audit; only documented, legitimate parsers should be
   used, and proprietary assets must not be committed to the repository.
