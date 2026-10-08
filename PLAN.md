# PLAN.md — AI Racer

## Vision

AI Racer is a browser racing game built for AI drivers. Each race uses a new procedurally generated track. A car has to get around it as fast as possible. A human can drive with the keyboard (for fun and debugging), but the main driver will be a fast "System One" decision model such as **TypeSafe AI's Jev**. The model reads a compact, structured description of what's ahead of the car and picks steering and throttle.

The game is a test bench: same API for humans, scripted bots and AI models, reproducible tracks via seeds, and clear telemetry on how each driver performs.

## Core gameplay loop

1. **Generate**: build a new closed-loop track from the tiles in `Models/`, using a seed.
2. **Countdown**: the car waits on the start line. The screen shows 3 – 2 – 1 – GO, and inputs are ignored until GO.
3. **Race**: the timer starts at GO. The car must pass every checkpoint in order and cross the finish line.
4. **Finish**: show the lap/total time and offer *Restart same track* or *New track*.

Going off the road is allowed but slow, because grass and sand have much higher friction and drag. Walls and barriers are solid. Later phases add obstacles and road hazards.

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Tooling | Node + Vite (dev server and build); Vitest for unit tests; ESLint + Prettier |
| Rendering | three.js (`GLTFLoader` for `Models/*.glb`) |
| Physics | Rapier (`@dimforge/rapier3d-compat`, WASM), using its `DynamicRayCastVehicleController` for the car |
| Runtime | Browser only for the MVP. Physics and logic are kept separate from rendering so a headless Node runner is possible later. |

## Architecture

```
src/
  main.ts                 bootstrap, wires everything together
  core/                   game loop (fixed physics step), seeded RNG, config, event bus
  assets/                 GLB loading, tile catalog (footprints, connectors, surfaces)
  track/                  generator (pure data) + builder (three.js meshes + Rapier colliders)
  car/                    car physics, CarInput, surface friction handling
  sensors/                ray-cone sensor → Observation
  control/                CarController interface, ControllerHost, keyboard, bots, remote/AI adapters
  race/                   race state machine, checkpoints, timing
  ui/                     HUD, countdown, finish screen, debug overlays
  camera/                 chase camera
```

Key principles:

- **Fixed-timestep simulation** (60 Hz physics), with rendering interpolated separately. AI decision rate is independent of both.
- **Track generation is pure data.** `generateTrack(seed, options) → TrackLayout` doesn't touch three.js or Rapier, so it can be unit-tested.
- **One control interface for every driver.** Keyboard, scripted bot and Jev all implement the same `CarController`.
- **Everything configurable lives in one typed config** (sensor cone, decision rate, surface friction, laps, world scale), and can be overridden by URL query parameters (e.g. `?seed=1234&controller=keyboard`).

## Assets (`Models/`)

These are Kenney-style "Racing Kit" GLB building blocks. Facts confirmed by inspection:

- Tiles sit on a **1-unit grid**: `roadStraight` and `roadCornerSmall` are 1×1, `roadStraightLong` and `roadStartPositions` are 1×2, `roadCornerLarge` is 2×2, and `roadCornerLarger` is 3×3. Meshes span `x∈[0,w]`, `z∈[-d,0]`.
- Every GLB has a root node translated by `(-0.35, -0.01, -0.65)`. This is an export artefact, and the loader must cancel it so tiles snap to the grid.
- Each tile's surfaces use named materials: `road`, `grass`, `grey` (kerbs and edges), plus `_defaultMat` on some. Material names are how we tell road from off-road.
- Cars (`raceCar{Red,Green,Orange,White}.glb`) are about 0.55 wide and 1.35 long in model units, with four separate wheel nodes (`wheelFrontLeft`, …) that can be spun and steered.
- Props (`barrierWall`, `fence*`, `pylon`, `grandStand*`, `tree*`, `flag*`, `overhead*`, …) provide walls, scenery and future obstacles.
- A global `WORLD_SCALE` (starting suggestion: 4, which makes a tile about 4 m and a car about 2.2 m wide) converts model units into physics metres so Rapier behaves realistically.
- Assets are read-only; we never edit files in `Models/`.

## Car control API

```ts
interface CarInput {
  accelerator: number; // 0 … 1   (0 = full brake, 1 = full throttle; see "pedal mapping")
  steering: number;    // -1 … +1 (-1 = full left, +1 = full right)
}

interface CarController {
  readonly name: string;
  /** Called at the controller's decision rate. May be async (remote AI). */
  decide(obs: Observation): CarInput | Promise<CarInput>;
  reset?(): void;
}
```

**Pedal mapping (MVP default, configurable):** `accelerator` is one axis. Values below a neutral point (default 0.5) brake, and the brake gets stronger toward 0. Values above it apply throttle, stronger toward 1. A value at the neutral point lets the car coast. Reverse isn't in the MVP; a stuck car uses *reset to last checkpoint*.

The **ControllerHost** calls `decide()` at a configurable rate (e.g. 10 Hz), clamps and validates the result, and holds the last input until a new decision arrives. If a decision is late, the car keeps the previous input. There are two timing modes:

- **Real-time**: the simulation keeps running while the controller thinks, so latency is part of the challenge.
- **Lockstep**: the simulation pauses until the decision arrives. This is for evaluating slow or remote models fairly, and later for training.

## Observation (what an AI sees)

```ts
interface Observation {
  t: number;                 // race time, seconds
  car: {
    accelerator: number;     // last applied input
    steering: number;
    speed: number;           // m/s, forward
    surface: SurfaceType;    // what the car is on now
    headingError: number;    // radians vs track direction at nearest centreline point (-π..π)
    lateralOffset: number;   // signed, normalised: -1 left road edge … +1 right edge
  };
  rays: RaySample[];         // ordered left → right
  progress: { checkpoint: number; totalCheckpoints: number; lap: number; totalLaps: number };
}

interface RaySample {
  angleDeg: number;          // relative to car heading, negative = left
  samples: Array<{ distance: number; class: SensorClass }>; // ground samples along the ray
  obstacleDistance: number | null; // first wall/obstacle hit along the ray, if any
  obstacleClass: SensorClass | null;
}

type SensorClass =
  | "straight" | "left_curve" | "right_curve" | "start_finish"
  | "kerb" | "grass" | "sand" | "wall" | "obstacle" | "void";
```

**Ray cone (configurable):** `fovDeg` (default 90, i.e. −45° … +45°), `rayCount` N (default 9), `sampleDistances` along each ray (default `[5, 10, 20, 35]` m), and `maxRange`. Ground classification comes from the track layout: the cell under a sample point gives its tile type, with curves expressed **relative to the racing direction**. The tile's surface mask (or the material under the point) separates road, kerb and grass. Walls and obstacles come from a horizontal Rapier raycast along each ray.

The observation is plain, JSON-serialisable data, so it can be sent to a remote model unchanged.

## Physics

- Ground: one collider per tile (or merged trimesh). Each surface carries a `SurfaceType` tag, and the car looks up `{ frictionSlip, rollingDrag }` per wheel from a table in config. Road grips well; kerbs are slightly lower; grass and sand are much higher drag and lower grip.
- Walls and barriers are fixed colliders built from the barrier/fence models (simple box colliders, not mesh colliders).
- Out-of-bounds (falling off the world, or too far from the track) automatically resets the car to the last checkpoint.
- **Later:** obstacles (pylons, barriers) as dynamic or fixed bodies, and hazards such as oil (low friction zone), bumps (`roadBump`) and sand traps.

## Track generation

- The generator takes a seeded RNG plus options: target length, min and max cell count, and allowed tile set.
- It builds a **closed loop on a grid** with no self-overlap. The MVP set is straight, long straight, small/large/larger corners, and start/finish. A suggested method is a random walk with backtracking, or perturbing a rectangle loop, with the result validated by an exact grid-occupancy check.
- Output is a `TrackLayout`: ordered pieces `{ tileId, cell, rotation, entryDir, exitDir }`, an occupancy map, a sampled **centreline polyline** (used for progress, heading error and lateral offset), and **checkpoints** (one per N pieces plus the finish line).
- Grass fills the area around the track, and barriers are placed along the outside of corners. Scenery is optional.

## Race rules

- States: `loading → generating → countdown → racing → finished` (and `paused`).
- Laps are configurable (default 1). Checkpoints must be crossed in order, and the finish only counts once all checkpoints are passed.
- Controls: `R` resets to the last checkpoint (with a time penalty, default 2 s), `N` makes a new track, `Enter` restarts the same track, `Esc` pauses, and `F1` toggles the sensor debug overlay.
- Results include total time, lap times, seed, controller name, off-track time and reset count. They are logged to the console and kept in memory, ready for later telemetry export.

## Phases

### Phase 1 — MVP (keyboard-playable, AI-ready)

A browser game started with `npm run dev`: random track, countdown, race, timer and finish screen, driven by keyboard. It also has the full `CarController` / `Observation` API, the ray sensor with a debug view, and a built-in scripted bot that drives using only the `Observation`, which proves an AI can drive.

Task breakdown (see `Tasks/`):

| # | Task | Depends on |
|---|------|-----------|
| 001 | Project scaffold (Vite, TS, three, Rapier, Vitest, lint) | — |
| 002 | Asset loading and tile catalog (+ tile viewer) | 001 |
| 003 | Procedural track generator (pure data) | 002 |
| 004 | Track builder: scene + physics colliders + surfaces | 003 |
| 005 | Car physics and `CarInput` | 004 |
| 006 | Controller interface, ControllerHost, keyboard controller, chase camera | 005 |
| 007 | Race state machine: countdown, checkpoints, timing, resets | 006 |
| 008 | HUD and menus | 007 |
| 009 | Ray-cone sensor and `Observation` (+ debug overlay) | 007 |
| 010 | AI bridge: scripted bot, remote-controller adapter, lockstep mode | 009 |

### Phase 2 — Jev integration

- `JevController implements CarController`: sends the `Observation` as Jev's `state`, plus two questions in one request to `POST https://api.typesafe.ai/v1/systemone`. Jev evaluates questions in parallel, so asking two costs about the same latency as one.
- **Primary approach: [Score](https://docs.typesafe.ai/primitives/score) questions → continuous inputs.** A Score question rates the state against 2–10 *ordered* levels. The answer's `score` is the probability-weighted mean of the level indices, so it can land between levels. Dividing by `levels - 1` gives a 0–1 value, which maps naturally onto our axes:
  - **Steering**: 7 levels from "road bends sharply left very close ahead → steer hard left" through "road is straight and the car is centred → hold straight" to "… → steer hard right". `steering = 2 · score/6 − 1`.
  - **Accelerator**: 5 levels from "wall or sharp bend imminent → brake hard" to "long clear straight ahead → full throttle". `accelerator = score/4`.
  - Levels must describe *situations*, not degrees: Jev's docs show bare-number levels perform poorly. Use `{what, examples}` objects where neighbouring levels get confused.
- **Using `probabilities` and `confidence` too.** The weighted mean has one trap for driving: a split answer ("50 % hard left, 50 % hard right") averages to "straight", which can drive the car into the obstacle between two good options. The adapter therefore applies a **resolution policy** to each answer:
  - `mean`: use the normalised score directly. This is the default when `confidence` is high.
  - `argmax`: use the most likely level. This is the default when the distribution is multi-modal or `confidence` is low.
  - Optional smoothing: blend with the previous input, weighted by `confidence`.
  - Thresholds are configurable, and every answer is logged with its full distribution for tuning.
- **Choice fallback.** A [Choice](https://docs.typesafe.ai/primitives/choice) question over named buckets (`hard_left … hard_right`, `brake … full`) stays supported for comparison runs.
- Latency: the vendor reports about 70–500 ms end to end. So the controller must be fully async and should support both real-time and lockstep modes.
- API key handling: a dev-only local proxy (small Node server), so the key never ships to the browser.
- Telemetry and comparison runs: the same seed with keyboard, bot and Jev drivers, plus an exportable results log.

### Phase 3 — Later ideas

- Obstacles and road hazards; multiple cars and AI opponents; a ghost car of your best run.
- Ramps and bridges (elevation), split roads.
- Headless Node simulation for fast batch evaluation and training.

## Open questions (for the human)

1. **Pedal mapping:** is "0 = brake, 0.5 = coast, 1 = full throttle" OK, or should 0 mean "no throttle" with a separate brake input?
2. **Sensor classes:** is the `SensorClass` list above the right vocabulary for Jev, or do you want something coarser or finer?
3. **Laps:** single lap per race for the MVP, or multiple?
4. **Elevation:** keep MVP tracks flat (no ramps or bridges)? Assumed yes.
