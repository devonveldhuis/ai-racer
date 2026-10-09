# 009 – Ray-cone sensor and Observation

Status: done

## Goal
Give drivers a structured view of the world ahead: a configurable cone of rays, each one sampling the ground under it and detecting obstacles, assembled into the full `Observation` that every controller receives. See `PLAN.md` → Observation.

## Context (after 008)
- `src/control/types.ts` has a **placeholder** `Observation` (`t`, `car.{accelerator, steering, speed, surface}`) and `buildObservation(t, carState)`. `Game.ts` calls `host.step(simTime, () => buildObservation(...))` every fixed step.
- `src/race/progress.ts` `trackProgress(...)` gives `distanceAlong`, `headingError` and `lateralOffset` (−1 left edge … +1 right edge). The `Race` exposes `progress`, the checkpoint/lap counters and the race time.
- `TrackLayout.cellInfo(cell)` → `{ pieceIndex, kind, turn }`, with `turn` relative to the driving direction (grid units, see the `layout.ts` header). `BuiltTrack.surfaceAt(x, z)` (metres) → `road | kerb | grass | sand | wall | null`.
- **There are no walls or barriers** (human decision in 004). The only colliders are the ground, the safety floor and the car. The obstacle cast is still required, so that obstacles and barriers can be added later without API changes, but in the game today it always reports `null`.
- 008 review, non-blocking 1: in `Game.ts` `buildSession`, `cleanup.release()` is called inside the `Session` literal **before** `applyReset`, `startCountdown` and the `finished` subscription. If one of those threw, the parts already built would leak. **Fix this here:** call `release()` last.

## Requirements

### Types (`src/control/types.ts`)
- Replace the placeholder with the full `Observation`, `RaySample` and `SensorClass` exactly as in `PLAN.md` → Observation, with these field meanings:
  - `t`: **race time** in seconds (0 until GO, frozen while paused), not the sim time.
  - `car.surface`: typed `SurfaceType | 'void'`. Map a `null` surface (no ground under the car) to `'void'`, and document it.
  - `car.headingError` / `car.lateralOffset`: from the race progress (0 if unavailable).
  - `progress`: `{ checkpoint (next expected index), totalCheckpoints, lap (1-based current lap), totalLaps }`.
- `buildObservation(...)` is a pure function that takes the race time, car state, progress, race counters and the sensor's rays. It rounds numbers to sensible precision: distances 0.01 m, angles 0.1°, speed 0.01, offsets and inputs 0.001. Every number is finite. The result is plain JSON with no class instances, `undefined` or `NaN`.
- `isObservation(x): x is Observation`: a runtime validator, used in tests and later by the remote bridge (010).

### Sensor (`src/sensors/RayConeSensor.ts`)
- Config in `GameConfig.sensor`: `fovDeg` (default 90 ⇒ −45°…+45°), `rayCount` (default 9, ordered **left → right**, negative angles on the left), `sampleDistances` (metres, default `[5, 10, 20, 35]`), `maxRange` (default 40 m), `heightOffset` (default 0.5 m above the car's position for the obstacle cast). With `rayCount: 1` there is a single ray at 0°.
  - Add URL overrides `?fov=` and `?rays=`, so the acceptance check needs no code edit. Use `parseUrlOverrides`, validate the values, and ignore invalid ones.
- Ray directions come from the car's heading using the `layout.ts` heading convention. A positive `angleDeg` is to the right.
- **Ground sample** at each distance: the world point is `car position + d · direction`, and it is classified by `classifyGround(layout, builtTrack, x, z)` (a pure helper, testable without Rapier):
  - `surfaceAt` → `null` ⇒ `void`; `kerb` ⇒ `kerb`; `grass` ⇒ `grass`; `sand` ⇒ `sand`; `wall` ⇒ `wall`
  - `road` ⇒ by the piece under the point (`cellInfo`): a straight ⇒ `straight`; a corner ⇒ `left_curve`/`right_curve` from `turn` (**relative to the racing direction**, not to the car's heading); the start/finish piece ⇒ `start_finish`
- **Obstacle cast**: a horizontal Rapier `castRay` from the car position at `heightOffset`, along the ray direction, up to `maxRange`. It **excludes** the car's own body/collider and also the `ground` and `safetyFloor` colliders (use `BuiltTrack.colliderKind`). The first hit gives `obstacleDistance`, and `obstacleClass` is `wall` if the hit collider is tagged wall in a side map, otherwise `obstacle`. With no hit, both are `null`. Ground samples beyond an obstacle are still reported.
- `sense(carState) → RaySample[]`. It is allocation-light: reuse the direction vectors and the ray object, though the returned JSON objects may be new.

### Wiring
- The sensor is part of each game session and is disposed with it.
- **Sense only when a decision is due.** `ControllerHost.step` must call its observation factory lazily, only on steps where a decision is actually requested. Verify this, and add a test if it's missing. The debug overlay may sense every rendered frame on its own.
- Controllers now receive the full Observation. The keyboard controller ignores the new fields.

### Debug overlay (`F1`, and on by default with `?debug=1`)
- `F1` toggles it; call `preventDefault` to stop the browser's help.
- 3D: a line per ray from the car to `maxRange`, a small sphere or point at each ground sample coloured by `SensorClass` (one fixed palette, documented), and a marker at any obstacle hit. Use pooled objects so nothing is allocated per frame, and dispose them with the session.
- A side panel with the current Observation as compact JSON (rays one per line). It updates at most about 10 Hz, sits on the right side under the minimap, and must not overlap the 008 HUD at 1280×720 or 2560×1440.

## Acceptance criteria
- [ ] Driving toward a left-hand corner (relative to the racing direction), the forward ray samples switch to `left_curve` **before** the car reaches it, and likewise `right_curve` for right corners. Verify with a headless test on a hand-built layout (`layoutFromPieces`) with a car pose on the preceding straight, and in the browser with the overlay.
- [ ] Obstacle cast: in a headless test, a test-only fixed cuboid placed ahead of the car and tagged as a wall in the side map is reported as `wall` at the correct distance (±0.05 m). An untagged cuboid is reported as `obstacle`. The car's own collider and the ground are never reported. In the real game, obstacles are always `null`.
- [ ] `?fov=120&rays=15` changes the cone without code changes: there are 15 rays from −60° to +60°, visible in the overlay and in the JSON.
- [ ] Unit tests:
  - ray angle generation (count, order, symmetry, `rayCount: 1`)
  - `classifyGround` on a hand-built layout: straight, start/finish, left and right corners incl. **reversed** pieces, kerb, grass, void
  - `isObservation` accepts a real observation and rejects broken ones (a missing field, NaN, a wrong class string)
  - JSON round-trip equality
  - the lazy observation factory in `ControllerHost`
  - `buildSession` releases cleanup last: test it if feasible without WebGL, otherwise explain why not
- [ ] Performance: a full `sense()` with the defaults takes < 1 ms (median over 1000 calls in a headless benchmark on a real built track; report the median and p95). Don't add a wall-clock assertion that could be flaky in CI; report the number instead, or assert something very loose like < 5 ms.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Out of scope
Bot and AI logic, and the remote bridge (010). Adding walls, barriers or obstacles to the track. Changes to race rules, physics or the generator. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- `src/control/types.ts`: full `Observation`, `RaySample`, `SensorClass` (+ `SENSOR_CLASSES`), `CarSurface` (`SurfaceType | 'void'`), pure `buildObservation(raceTime, car, progress, counters, rays)` with the specified rounding (non-finite numbers and `-0` become `0`), and the runtime validator `isObservation`.
- `src/sensors/ground.ts`: `rayAngles`, `rayDirection`, `classifyGround` (pure). `src/sensors/RayConeSensor.ts`: the sensor (reused ray object and direction vector, predicate created once; excludes the car body and the `ground` / `safetyFloor` colliders; `wallColliders` side map; `dispose()`). `src/sensors/palette.ts` (colours), `src/sensors/format.ts` (panel text).
- `src/debug/SensorOverlay.ts`: pooled `LineSegments` + two `Points` (ground samples, obstacle hits) with fixed-size dynamic buffers, plus the DOM panel (legend and compact JSON). CSS added to `src/ui/styles.ts` (`.ar-sensor`).
- `src/core/config.ts`: `SensorConfig` / `GameConfig.sensor` (defaults as specified) and `?fov=` (1..360) / `?rays=` (integer 1..101) overrides; invalid values are ignored.
- `src/game/Game.ts`: sensor and overlay are part of the `Session` and disposed with it. The observation is built lazily inside the `host.step` factory (full observation with race counters). The overlay senses every rendered frame itself and updates its text at most every 100 ms. `F1` toggles it (`gameKeys.ts` calls `preventDefault`, also on key repeat), on at start with `?debug=1`. **`buildSession` fix:** `cleanup.release()` is now called last (after `applyReset`, `startCountdown` and the `finished` subscription); `Session.dispose` delegates to a variable that is set at the end. `window.__game` gained `sensor`, `overlay` and `observe()`.
- Tests: `src/sensors/{ground,RayConeSensor,format}.test.ts`, `src/control/observation.test.ts`, lazy-factory test in `ControllerHost.test.ts`, F1 in `gameKeys.test.ts`, fov/rays in `config.test.ts`. Test helpers: `src/sensors/testLayouts.ts`, `src/control/testObservation.ts` (a blank valid observation; existing tests that built the old placeholder now use it).

### Deviations
- `t` is `race.raceTime` (simulation time since GO, without reset penalties), not `race.time`. The spec says "race time, 0 until GO, frozen while paused"; this matches it, and penalties are not elapsed time.
- `progress` (headingError / lateralOffset) comes from `race.progress`, which is computed in `race.step` after the decision, so the values are from the previous fixed step (1/60 s old). Not worth changing the race code (out of scope).
- `buildSession` release-order test: **not added.** `buildSession` is a closure inside `runGame`, which needs a `WebGLRenderer` and a canvas; extracting it would be a refactor beyond this task. Covered by the existing `DisposeStack` tests and the code change itself; verified in the browser (rebuilding twice leaves collider, body and scene object counts unchanged, one panel).
- The panel's rays are printed in a display-only compact form (`"samples":[["straight",5],...]`, `"obstacle":["wall",11.75]|null`) to keep lines short; the real observation JSON keeps the `RaySample` shape. Documented in `format.ts`.
- `rayCount` upper bound for `?rays=` is 101 and `?fov=` is limited to 1..360 (the spec said only "validate").
- Panel layout: no new HUD element in `Hud.ts`; the panel is a separate fixed element positioned with CSS from the same `clamp()` values as the HUD (under the minimap, above the speed readout).

### Known limitations
- The game has no walls or obstacles, so `obstacleDistance` is always `null` in play (covered by the headless test with test-only cuboids).
- The overlay uses the physics pose (not the interpolated render pose), so markers can lag the car mesh by up to one physics step.
- The F1 hint is not in the HUD help line (kept unchanged to avoid touching HUD tests/layout).
- Rays can see `void` beyond the grass margin; kerb/grass samples on the road edge depend on `surfaceAt` thresholds.

### sense() timing
`sense()` with the defaults (9 rays x 4 samples + 9 casts) on a real built track (`generateTrack(7)`, stub model loader), 1000 timed calls after 100 warm-up calls, three runs: median 0.015 to 0.016 ms, p95 0.029 to 0.031 ms (requirement: < 1 ms median). The test asserts only median < 5 ms and logs the numbers.

### Overlay palette (fixed, `src/sensors/palette.ts`)
straight white `#ffffff`, left_curve sky blue `#38bdf8`, right_curve orange `#fb923c`, start_finish yellow `#facc15`, kerb red `#ef4444`, grass magenta `#d946ef`, sand brown `#92400e`, wall dark slate `#1e293b`, obstacle hot red `#ff2d55`, void black `#000000`. The panel has a legend with the same colours. Ray lines are white (55 % opacity), ground samples are 9 px points, obstacle hits 16 px points; all drawn without depth test.

### Browser verification (own dev server on port 5241, stopped afterwards; frames driven with `__game.stepFrames`)
- Default `?seed=3&debug=1` (800x600 pane): overlay and panel visible, 9 rays from -45 to +45, JSON matches `__game.observe()`. Without `debug=1` the overlay starts hidden; `F1` toggles it and `defaultPrevented` is true.
- Left corner ahead: car placed 14 m before a left corner (seed 3, piece 8) heading along the track: the left-of-centre ray reads `straight, grass, left_curve, grass` (the 20 m sample is on the corner), the forward ray `straight, straight, grass, grass`. With the car 8 m before a large left corner the forward ray reads `left_curve, left_curve, grass, grass`. Right corners are covered by the headless tests (clockwise and counter-clockwise loops).
- `?seed=3&debug=1&fov=120&rays=15`: 15 rays, first -60, last +60, in the overlay and in `observe()`.
- Layout (bounding boxes from `getBoundingClientRect`): at 1280x720 the panel is at x 579..1266, y 193..477 (15 rays); minimap ends at y 184, the speed readout starts at y 603, the top-left block ends at x 183 and the bottom-left controls start at y 579: no overlap. At 2560x1440 the panel is at y 290..782, minimap ends at 273, the speed readout starts at 1215: no overlap.
- Rebuilding sessions (`rebuild` x2) leaves colliders (3), bodies (1) and scene objects (302) unchanged and exactly one panel in the DOM. No console errors.
- Screenshots saved in `/tmp/claude-1000/shots/009/`: `overlay-default-800x600.jpg`, `overlay-left-curve-ahead.jpg`, `overlay-fov120-rays15-1280x720.jpg`, `overlay-fov120-rays15-2560x1440.jpg` (the pane scales screenshots down to 800 px wide).

### Checks
`npm run build`, `npm test` (29 files, 292 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.

## Review (round 1)
Verdict: **APPROVED**

### Checks run
- `npm run build`, `npm test` (29 files, 292 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.
- Scope: changed files are only the sensor, overlay, config, types, Game/gameKeys, styles, tests and this task file. No changes to `Models/`, `PLAN.md`, `AGENTS.md`, other tasks, race/physics/generator code (the `race.integration.test.ts` edit only swaps the removed placeholder `buildObservation` for `blankObservation`). No walls or obstacles added to the game.
- Types: `Observation`, `RaySample` and `SensorClass` match PLAN.md field for field (names, left-to-right order, negative = left). `headingError` doc ("positive = right of the road") matches `progress.ts` (`heading - tangent`). `isObservation` rejects NaN/Infinity, wrong class strings, bad surface, non-integer progress counters, mismatched null obstacle pair. `buildObservation` rounds as specified, maps `-0` and non-finite to 0, and `surface` null to `'void'`.
- `classifyGround` independently verified with a throwaway script (`/tmp/claude-1000/review009/verify.test.ts`, outside the repo): 60 generated seeds x 4000 random points over the bounds + 3 cell margin = 240 000 points; expected class derived from my own occupancy lookup, `surfaceAtGrid`, and the corner turn from the sign of cross(entryDir, exitDir) (so reversed corners are covered), plus the start piece. **0 mismatches** (counts: straight 11 271, left_curve 4 172, right_curve 4 219, start_finish 593, kerb 4 343, grass 215 402). `void` is not exercised by that sweep (margin set equal to the track's); it is covered in the worker's unit test.
- Ray maths: heading pi/2 with 0 deg gives +x; +90 deg gives +z, which is the car's right when facing +x; 9 rays at 90 deg give -45 ... +45 in 11.25 steps; `rays=15, fov=120` gives 15 rays; `rayCount: 1` gives `[0]`.
- Obstacle cast: code excludes the own body (`filterExcludeRigidBody`) and any collider for which `colliderKind` is defined (ground, safetyFloor) through the predicate; horizontal ray from `y + heightOffset`, so the distance is the horizontal time of impact; wall vs obstacle is tagged via `wallColliders`. Tests cover wall, obstacle, beyond maxRange, own body and the built track.
- Lazy observation: `host.step(simTime, () => ...)` builds the observation and senses only inside the factory; the new `ControllerHost` test asserts the factory runs 1 time (in-flight async) and 20 times (sync) over 120 steps. In-game the overlay senses per rendered frame only while visible.
- Overlay: fixed-size pooled `LineSegments` and `Points` buffers updated in place; geometries, materials and the panel disposed with the session; F1 calls `preventDefault` (also on key repeat) and toggles only when not repeating; panel text throttled to 100 ms; panel CSS is placed under the minimap and above the speed readout. Screenshots at 800x450/600 look fine and the worker's bounding-box numbers at 1280x720 and 2560x1440 show no overlap.
- `buildSession`: `cleanup.release()` is now the last statement before `return s`, after `applyReset`, `startCountdown` and the `finished` subscription; `Session.dispose` delegates to `disposeSession` (no-op until set), and the `catch` still calls `disposeAll()`. Correct.
- Config: `?fov=` (1..360) and `?rays=` (1..101) are validated and invalid values ignored; tests added.

### Deviations judged
- `t = race.raceTime` (excludes reset penalties; HUD shows `race.time`, which includes them): acceptable and consistent (the AI's clock is elapsed driving time; the penalty is an accounting item the AI can compute from the reset count). The types doc says "not the simulation time", which is misleading since `raceTime` *is* simulation time since GO. See non-blocking 1.
- Heading/lateral lag of one step: acceptable, documented, deterministic.
- No `buildSession` release-order test: acceptable (closure needs WebGL; code reviewed directly).
- Compact panel format and F1 not in the help line: acceptable, documented.

### Blocking issues
None.

### Non-blocking
1. `Observation.t` doc comment in `src/control/types.ts` should say explicitly "elapsed time since GO, excluding reset penalties (the HUD time includes them)". Currently "(not the simulation time)" is inaccurate.
2. `rayDirection` returns a new `{x, z}` per ray, and `sense()` allocates new sample arrays, in `sense()` and again in `SensorOverlay.update` each frame. The spec asked for "allocation-light: reuse the direction vectors"; the cost is tiny (median 0.015 ms) and the 3D buffers are pooled, but a reusable scratch vector would match the spec better. Follow-up, not required.
3. `rayDirection` has float noise (`6e-17`) on cardinal headings; harmless.
4. The panel's rays are shown in a display-only form that differs from the real JSON; documented in `format.ts`. Fine, but note for the bridge (010) that it must not reuse `formatObservation`.
