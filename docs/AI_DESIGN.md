# AI Design

Bots are full players. They drive their hero only through the same
`InputCommand` + `PlayerAction` contract as a human or a network client
(`hero.input` / `hero.actions`), so they cannot teleport, read hidden state
through the controls, or use abilities a player couldn't. Difficulty changes
**how well they perceive, aim and decide**, never their health or damage
(tested in `tests/unit/ai.test.ts`).

```
BotManager (src/ai/botManager.ts)       registered as a Simulation controller
 ├─ TeamCoordinator × 2 (team.ts)       lanes, calls, focus targets, pings
 └─ BotBrain per bot hero (brain.ts)
     ├─ Perception (perception.ts)      what this bot knows (contacts + memory)
     ├─ Strategy  (strategy.ts)         utility-scored goals with hysteresis
     ├─ Navigator (navigator.ts)        layered nav-grid paths (world/nav.ts)
     ├─ Tactics   (brain.ts)            targets, movement in fights, abilities, items
     ├─ AimController (aim.ts)          human-like aim: reaction, turn rate, error
     └─ Shopping  (shopping.ts)         builds and ability points
```

## Perception: no omniscience

`Perception` keeps a `Contact` per enemy with the position, velocity and
health **as last observed**. A bot learns about an enemy when it:

- sees it: inside its field of view (difficulty: 110°–180°), within view
  range, with a clear line of sight through the collision world;
- hears it: an enemy hero that fired within the last 0.6 s inside 32 m;
- is told by team vision: the unit is visible to the bot's team (allied
  troopers and structures see too, per the shared vision system).

Memory expires (heroes 8 s, other units 1.5 s), dead heroes are forgotten at
once (the kill feed announces deaths), and stealthed units are only noticed
up close. Perception updates at a difficulty-dependent interval (0.08–0.3 s).
A test checks that bots do not know where never-seen enemies are.

## Team model and coordination (`worldModel.ts`, `team.ts`)

Each team builds a `TeamModel` from what it knows: lane fronts (troopers
projected onto lane paths), structure states and threats, alive counts, and
visible enemy heroes. The `TeamCoordinator`:

- assigns lanes, filling them round-robin so each lane gets a durable and
  a ranged hero, and honouring explicit lane choices (a human's included);
- issues **calls** (`defend`, `push`, `boss`, `rejuv`, `retreat`, `group`,
  `attack`, `focus`) with a priority, an expiry and assigned heroes. For
  example, it calls a defence when an allied structure is under hero attack,
  pushes when it has a clear advantage, takes the mid-boss when enough
  allies are alive and no threats are near, and retreats when outnumbered
  by three or more;
- picks a focus target in fights;
- answers **human pings**: a player's ping becomes a call assigned to the
  nearest bots (all bots for group, retreat and focus). A bot declines, and
  says why in team chat (`botSay`), when it is below 25% health or when an
  attack/push order looks suicidal (visible enemies there outnumber allies
  by a wide margin while it is hurt). The difficulty's `coordination` value
  sets how reliably calls are followed.

## Strategy: utility goals (`strategy.ts`)

Every `decisionInterval` (0.5–1.5 s) each bot scores candidate goals:
`farm`, `push`, `defend`, `fight`, `gank`, `retreat`, `shop`, `jungle`,
`boss`, `rejuv`, `group`, `attack`. Scores combine:

- the situation: health, local danger (known enemies vs. allies nearby),
  lane state, souls vs. the next item's price, travel distance, calls;
- the bot's **personality** weights (`data/ai.ts`: aggressive, defensive,
  farmer, roamer, supportive, objective-focused), which bias but never
  replace the shared logic;
- **hysteresis**: the current goal gets a commitment bonus so bots don't
  dither;
- **noise** scaled by difficulty (`decisionNoise`), so weaker bots make
  plausibly worse choices rather than random ones.

Retreating is graded: badly hurt bots go to the fountain; moderately hurt
bots fall back to a safe spot behind their own structures and regenerate,
then return to lane.

## Navigation (`world/nav.ts`, `navigator.ts`)

A layered 2 m grid is built from the collision world (streets, ramps,
rooftops, the bridge), with walk, jump, drop and team-owned zipline edges.
A* with a binary heap plus string pulling gives smooth paths (typical query
1–3.5 ms). The navigator re-paths on goal changes and when progress stalls,
and turns path edges into inputs: walk, jump and double jump at jump edges,
interact at zipline boarding points.

## Tactics (`brain.ts`)

- **Target selection** scores visible enemies by threat, health, distance,
  focus calls, last-hit value and structure danger. Bots avoid diving under
  enemy structures unless their troopers are tanking or the kill is worth it
  (`towerSense`).
- **Fighting movement**: strafing (`dodge`), keeping preferred range per
  weapon, planted stance for precision weapons, escaping telegraphed hazards
  (structure stomps and salvos), movement tech (dash-jumps, slides) at higher
  difficulty.
- **Economy in lane**: last-hitting and shooting soul orbs to secure or deny
  (`lastHit`), melee finishers.
- **Melee and parry**: heavy melee to finish troopers (melee last hits pay
  the full value with no orb), parry against heavy melee from adjacent enemy
  heroes.
- **Abilities**: every ability carries an `ai` hint (`damage`, `cc`,
  `escape`, `engage`, `heal`, `shield`, `buff`, `summon`, `zone`,
  `finisher`) with ranges and conditions (minimum targets, health
  thresholds). The brain picks casts from those hints, aims ground-targeted
  and lobbed abilities with a ballistic solution, and uses item actives
  (heal, shield, cleanse, blink, haste, nova, untargetable).

## Aiming (`aim.ts`)

The `AimController` produces input yaw/pitch like a human hand:

1. **Reaction delay** before tracking a newly seen target (0.18–0.6 s).
2. **Limited turn rate** with a critically damped spring toward the ideal
   direction, plus a velocity feed-forward based on the target's angular
   velocity *as perceived with a lag*, so tracking stays behind fast
   direction changes.
3. **Correlated aim error**: an Ornstein–Uhlenbeck process in metres at the
   target, normalised so its standard deviation equals the difficulty's
   `aimError`, scaled up with target speed and range and briefly after
   flicks. Misses look like tracking errors, not jitter.
4. **Lead** for projectiles from an intercept solution scaled by
   `prediction`.
5. **Trigger discipline from perceived error**: bots fire when their *own
   noisy estimate* says they are on target, so aim noise produces real
   misses instead of the bot waiting for the noise to line up.

Measured with `npx tsx tools/aim-calibration.ts` (bot standing still,
firing at a target strafing left and right, hits per shot):

| Hero (weapon) | Range | Easy | Normal | Hard | Expert |
| --- | --- | --- | --- | --- | --- |
| Tessa (burst carbine) | 12 m | 16% | 27% | 32% | 73% |
| Tessa | 25 m | 11% | 20% | 35% | 42% |
| Tessa | 40 m | 4% | 12% | 22% | 35% |
| Vesper (lever rifle) | 12 m | 11% | 20% | 59% | 63% |
| Vesper | 25 m | 9% | 19% | 30% | 44% |
| Vesper | 40 m | 2% | 11% | 22% | 48% |
| Cinder (SMG) | 12 m | 25% | 35% | 53% | 69% |
| Cinder | 25 m | 16% | 29% | 31% | 45% |
| Cinder | 40 m | – | – | – | – |

"–": the bot holds fire; 40 m is beyond the SMG's useful range. These are
single seeded runs (about 40 s of fire each), so neighbouring cells can be
noisy; the trend by difficulty is the point. Hit rates are lower against a
moving player who also dodges and uses cover.

## Shopping and ability points (`shopping.ts`)

Bots plan builds from item tags and their hero's role, adapt to the enemy
team (spirit vs. bullet resistance, anti-heal against healers), respect slot
limits and component upgrades, and buy through the same `buy` actions the
shop UI sends. `shopping` skill makes weaker bots' builds sloppier. Ability
points unlock every ability first (the ultimate as soon as it is allowed),
then buy upgrades in the hero's skill order.

## Difficulty

`data/ai.ts → DIFFICULTY` (Easy / Normal / Hard / Expert): reaction, aim
error, turn rate, prediction, decision interval and noise, coordination,
ability timing, last-hit and dodge skill, retreat sense, perception rate,
field of view, structure awareness, shopping and movement tech. Team-level
coordination is the average of the team's bots.

## Debugging

- **F3** in game opens the developer overlay with the **AI inspector**
  (PgUp/PgDn to switch bot): goal and reason, the full list of scored
  goals, state and action, current target and threat, team intent, known
  enemy heroes with memory age, team calls and focus target; the bot's
  path is drawn in the world.
- `npx tsx tools/diagnose.ts` summarises where bots spend their time and who
  damages what over a whole match.
- `npm run sim` plays complete matches headless (see `TESTING.md`).

## Known gaps

See [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md): bots don't use voice or
deliberate baits, high-ground and rooftop play is basic, and match pacing is
tuned against bot-vs-bot play, not human play.
