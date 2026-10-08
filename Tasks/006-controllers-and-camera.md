# 006 – Controller interface, keyboard controller, chase camera

Status: done

## Goal
Introduce the `CarController` abstraction and `ControllerHost`, so every driver (keyboard, bot, AI) drives through the same path. Add a keyboard controller with smooth analogue inputs and a proper chase camera, and make the default page a drivable game scene that replaces the temporary 005 harness. See `PLAN.md` → Car control API.

## Context (what exists after 005)
- `src/car/types.ts`: `CarInput`, `CarPose`, `CarState`.
- `src/car/CarPhysics.ts`: `setInput`, `update(dt)` (call it before `world.step()`), `getState()`, `resetTo(pose)`, `dispose()`.
- `src/car/CarView.ts`: `capture()` after `world.step()`, `snap()` after a reset, `render(alpha)`, and `root` (the interpolated transform).
- `src/track/builder.ts`: `buildTrack`, `BuiltTrack.isOutOfBounds`, `layout.startPose` (grid units, × `worldScale`).
- `src/core/loop.ts`: `GameLoop` (fixed step, `advance(elapsed)`).
- `src/debug/driveView.ts`: the temporary `?view=drive` harness with raw keys and a fixed follow camera.

## Requirements

### Types (`src/control/types.ts`)
- Re-export `CarInput` from `src/car/types.ts`; don't duplicate it.
- `CarController` per PLAN: `name`, `decide(obs) → CarInput | Promise<CarInput>`, optional `reset()`, plus optional `dispose()` (for controllers that attach listeners).
- A placeholder `Observation`: `{ t: number; car: { accelerator, steering, speed, surface } }`, plain and JSON-serialisable. Task 009 adds the rays, `headingError`, `lateralOffset` and `progress`, so mark it clearly as a placeholder.
- `buildObservation(t, carState)` (a pure helper) builds it.

### ControllerHost (`src/control/ControllerHost.ts`)
- It is driven by **simulation time**, not wall-clock time: `host.step(simTime, obsFactory)` is called once per fixed physics step, before `car.update`. A decision is due every `1 / decisionHz` seconds of sim time; the first one is at t = 0. This keeps it deterministic and testable without fake timers.
- Calls `controller.decide(obs)`. It handles sync results (applied in the same step) and async `Promise` results (applied in the first step after they resolve). There is **never more than one decision in flight**: while one is pending, due decisions are skipped, and the skips are counted.
- It holds the last valid input until a new one arrives. It validates and clamps each field: `accelerator` to [0, 1], `steering` to [−1, 1]. A NaN, non-finite or missing field keeps the previous value. A rejected promise or a thrown error keeps the previous input, counts an error and logs a single `console.warn`, so it doesn't spam every step.
- `enabled` flag (for the race system in 007): while disabled, the host still lets the controller decide, so it keeps its state warm, but the car gets the **hold input** `{ accelerator: 0, steering: 0 }` (full brake, which holds the car on the line). The initial input before the first decision is neutral (`accelerator: config neutral`, `steering: 0`).
- Timing modes:
  - **`realtime`**: the sim keeps running while a decision is pending.
  - **`lockstep`**: while a decision is pending, `host.blocking` is true and the game must not advance the sim. Make `GameLoop` support this with a `shouldUpdate?: () => boolean` option (or similar). While it returns false, no update steps run, rendering continues, and the accumulator doesn't build up a backlog.
- Stats: decision count, skipped count, error count, and latency mean and p95 (measured in wall-clock ms via an injectable `now()`, default `performance.now`), over a bounded rolling window. They are exposed as `host.stats()`.
- `reset()`: drops any in-flight decision (its result is ignored when it arrives), resets the input to neutral and calls `controller.reset?.()`.
- Config in `GameConfig`: `controlMode` (`'realtime' | 'lockstep'`, default realtime) and per-controller `decisionHz` (keyboard default **60**, so it decides every physics step for responsiveness; default for other controllers 10).

### KeyboardController (`src/control/KeyboardController.ts`)
- W/↑ throttle, S/↓ brake, A/← steer left, D/→ steer right. It produces smooth analogue values with configurable ramp rates (units per second):
  - `accelerator` ramps toward 1 (throttle), toward 0 (brake), or back to neutral when no pedal key is held. Both pedal keys held → neutral.
  - `steering` ramps toward ±1 while a key is held and returns to 0 faster (a separate `steerReturnRate`) when released. Both keys held → returns to 0.
- The ramps use the elapsed time between `decide()` calls, taken from `obs.t`, so they don't depend on frame rate.
- Key state comes from an injectable source. The default attaches `keydown`/`keyup` on `window` and clears on `blur`, so tests can drive a fake key state. `dispose()` removes the listeners. Ignore key repeat and keys pressed with a modifier (Ctrl/Meta/Alt).
- Default ramp rates: tune for a responsive feel and record them. As a starting point, the accelerator goes from neutral to full in about 0.25 s, the steering from 0 to full in about 0.3 s, and the steering returns from full to 0 in about 0.15 s.

### Registry
- `src/control/registry.ts`: `createController(kind, deps)` for `ControllerKind` (`keyboard` now). Unknown or unimplemented kinds (`bot`, `remote`) log a warning and fall back to keyboard. `?controller=keyboard` is the default (config already parses it).

### ChaseCamera (`src/camera/ChaseCamera.ts`)
- It follows behind and above the car's **interpolated** transform (`CarView.root`), looks at a point slightly ahead of the car, and uses frame-rate-independent exponential smoothing (`1 − exp(−stiffness·dt)`). Distance, height, look-ahead and stiffness are configurable and tuned for the half-size car. It must not jitter at 60 Hz physics with any render rate.
- `C` cycles the modes **chase → top-down** (high above the car, north-up, following its position) **→ free orbit** (`OrbitControls` targeting the car, mouse-driven) **→ chase**.
- `snap()` jumps instantly with no smoothing; call it after a reset.

### Game scene (default page)
- Replace the falling-cube demo in `src/main.ts` with the game scene. Put it in its own module (e.g. `src/game/Game.ts`); keep `main.ts` thin. It contains:
  - `RAPIER.init()`, then `generateTrack(config.seed)`, `buildTrack`, the car at `startPose` × `worldScale`, the controller from the registry, the ControllerHost, the chase camera and a `GameLoop`.
  - A fixed step: `host.step` → `car.update` → `world.step` → `view.capture`. If `isOutOfBounds` → `car.resetTo(start)`, `host.reset()`, `view.snap()`, `camera.snap()`.
  - `R` resets to the start. The checkpoint-based reset and race logic come in 007.
  - With `?debug=1`, a small text panel shows speed, surface, current input, the controller name and the host stats.
- Remove the `?view=drive` harness (`src/debug/driveView.ts` and its hook). Keep `?view=tiles` and `?view=track`.

## Acceptance criteria
- [ ] Default page: you drive the car with the keyboard around a generated track with the chase camera; the input feels smooth and responsive; `C` cycles the camera modes; `R` and driving off the edge reset to the start. No console errors. Verify in the browser and report what you checked (and save screenshots to disk if your tooling allows it; if not, say so).
- [ ] ControllerHost unit tests (plain objects, no Rapier needed; the sim time is passed in):
  - the decision rate (e.g. 10 Hz at 60 Hz stepping → 10 decisions per simulated second)
  - a sync result is applied the same step
  - an async result is applied after it resolves, holding the last input meanwhile
  - never two decisions in flight, with the skip count
  - clamping and NaN/missing-field handling
  - a rejected or thrown decision keeps the input and counts an error
  - `enabled = false` → the hold input
  - `reset()` ignores a stale in-flight result
  - lockstep → `blocking` while pending, and a `GameLoop` with `shouldUpdate` runs no updates and builds up no backlog
  - latency stats with an injected `now()`
- [ ] KeyboardController unit tests with a fake key source: the ramp rates, return to neutral and centre, both keys held, independence from the timestep (the same result for 60 small steps or 6 large ones covering the same time, within tolerance), and `dispose()` removes the listeners.
- [ ] ChaseCamera unit test: converges to the expected offset behind a stationary car and is independent of the frame rate (the same position after 1 s at 30 vs 144 fps, within tolerance).
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Out of scope
Ray sensors and the full `Observation` (009), the race state machine, countdown and checkpoint resets (007), the HUD and menus (008), bots and remote AI (010). Don't change the car physics tuning, the track generator or the builder. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- `src/control/types.ts`: re-exports `CarInput`; `CarController` (`name`, `decide`, optional `reset`, `dispose`); placeholder `Observation` (marked for task 009); `buildObservation(t, carState)`.
- `src/control/ControllerHost.ts`: sim-time driven host as specified (due times are `index * period`, so no drift or backlog; sync and async results; one decision in flight with a skip count; clamping through the existing `sanitizeInput`; a single `console.warn` on the first failure; `enabled` with `HOLD_INPUT`; realtime and lockstep (`blocking`); `reset()` uses an epoch counter so stale promises are ignored; `stats()` has decisions (= `decide()` calls made), skipped, errors, and wall-clock latency mean and p95 over a rolling window of 120 via an injectable `now`).
- `src/control/KeyboardController.ts`: `KeyboardController` plus `WindowKeySource` (keydown/keyup/blur on `window`, ignores repeats and Ctrl/Meta/Alt, `dispose()` removes the listeners) behind an injectable `KeySource`. Ramps use `obs.t` deltas (the first call has dt 0).
- `src/control/registry.ts`: `createController(kind, deps)`; any kind other than `keyboard` warns and falls back to keyboard.
- `src/camera/ChaseCamera.ts`: chase / top-down (north-up, `camera.up` = -z, blended smoothly) / orbit (`OrbitControls`, created lazily, carried along with the car), `cycle()`, `setMode()`, `snap()`, `update(frameDt)`. It follows `CarView.root` (interpolated) with `1 - exp(-stiffness*dt)` smoothing of the position, look point and up vector.
- `src/game/Game.ts` (`runGame(config)`): scene, track, car, controller, host, camera, `GameLoop` (`shouldUpdate: !host.blocking`). Fixed step: `host.step` -> `car.setInput(host.input)` -> `car.update` -> `world.step` -> `view.capture`; out of bounds or `R` -> `car.resetTo`, `host.reset()`, `view.snap()`, `chase.snap()`. `C` cycles the camera. `?debug=1` shows a panel (speed, surface, input, controller, mode, camera, host stats). `window.__game` exposes `car/view/track/host/chase/reset/state()/stepFrames()` for scripted checks.
- `src/core/loop.ts`: `shouldUpdate` option. While it is false no update runs, elapsed time is not banked, and whole pending steps are dropped (the fractional alpha is kept so the render does not jump).
- `src/core/config.ts`: `ControlMode`, `controlMode`, `decisionHz` (keyboard 60, bot/remote 10), `keyboard` ramp rates, `camera` tuning, and the URL param `?mode=realtime|lockstep`.
- `src/main.ts` is now thin; `src/debug/driveView.ts` and the `?view=drive` hook are removed (`tiles` and `track` kept). `driveView.ts` shows as a staged deletion (`git rm`).
- Tests: `ControllerHost.test.ts` (12), `KeyboardController.test.ts` (11, incl. `WindowKeySource`), `registry.test.ts` (2), `ChaseCamera.test.ts` (4). Total 166 tests (137 before).

### Tuned values
- Keyboard (units/s): `accelRate` 2.4 (neutral to full in about 0.21 s), `brakeRate` 4 (neutral to 0 in 0.125 s), `accelReturnRate` 4, `steerRate` 3.3 (0 to full in 0.3 s), `steerReturnRate` 6.7 (full to 0 in 0.15 s).
- Camera: distance 7 m, height 3.2 m, look-ahead 3 m (the look point is also 0.5 m above the car), stiffness 6 /s, top-down height 45 m, fov 60.

### Deviations
- Added the `?mode=realtime|lockstep` URL param (not in the spec) so lockstep can be used at all; invalid values are ignored.
- `ControlMode` lives in `core/config.ts` (next to `ControllerKind`); `ControllerHost.ts` imports it from there.
- `KeyboardConfig` and `ChaseCameraConfig` are new nested `GameConfig` fields (`keyboard`, `camera`), so the tuning lives in config like the car tuning does.
- Pedal ramps are a little faster than the "about 0.25 s" starting point (0.21 s up, 0.125 s for brake), chosen by arithmetic and scripted checks, not by playing with a real keyboard (see limitations).
- The Game looks up the decision rate by `controller.name`, so a fallback to keyboard uses the keyboard's 60 Hz.
- `ChaseCamera` takes an optional `domElement`; without it orbit mode has no controls (only for tests).

### Known limitations
- The Browser pane does not run `requestAnimationFrame` (0 frames in 500 ms), so the checks were driven by `__game.stepFrames()` with injected `KeyboardEvent`s on `window`. I could not judge the real-time feel with a physical keyboard or frame pacing at a real display rate; frame-rate independence is covered by unit tests instead.
- Screenshots could not be saved to disk (the browser tool only returns images to me), so `/tmp/claude-1000/shots/006/` is empty. I did look at screenshots of the chase, top-down and orbit views.
- Lockstep blocking is only exercised by unit tests (the keyboard is sync, so it never blocks).

### Verification
- `npm run build`, `npm test` (166 pass), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.
- Browser (own dev server on port 5201, stopped afterwards; `?debug=1`, seed 1): injected W: accelerator 0.7 after 0.1 s, 1.0 by about 0.2 s, 8.5 m/s after 1.6 s on the road; D: steering 0.55 after 0.15 s, 1.0 by 0.3 s, back to 0 within 0.2 s of release; S: accelerator 0. `R` resets to the start pose with speed 0 and the host input back to neutral; driving off the ground edge resets automatically (the reset counter increments); `C` cycles chase -> topdown -> orbit -> chase; top-down is north-up and centred on the car; orbit follows the car. Host stats: 0 skipped, 0 errors, latency about 0.01 ms. Console: only the Vite debug messages, no errors or warnings.

## Review (round 1)
Verdict: **APPROVED**

### Checks
- `npm run build`, `npm test` (166 pass), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.
- Scope: only config.ts, loop.ts, main.ts, the new control/camera/game modules, the staged removal of `driveView.ts`, and this task file changed. Models, PLAN.md, other task files, physics, generator and builder are untouched.
- Deviations: the `?mode=` param is needed to reach lockstep at all, so it is justified. The config placement (`keyboard`, `camera`, `ControlMode` in `core/config.ts`) matches how the car tuning is kept. Choosing the decision rate by `controller.name` is correct (the keyboard fallback gets 60 Hz). The optional `domElement` is harmless. The ramp values are within the spec's "about" ranges.
- ControllerHost: I ran my own throwaway script (outside the repo) and got these results.
  - Decision count and times: 10 Hz at 60 Hz gives exactly 1000 decisions in 100 s, first at t=0 and then 0.1, 0.2. 7 Hz gives 70 in 10 s, 25 Hz gives 250, 60 Hz gives 36000 in 600 s (no float drift). 120 Hz at 60 Hz gives one decision per step.
  - A promise that resolves after `reset()` is ignored, `blocking` is cleared by `reset()`, and a new decision proceeds independently.
  - A synchronous throw gives 10 errors but only 1 `console.warn`, and the input is held.
  - `enabled=false` gives the hold input.
  - The code reads correctly for clamping and NaN handling (via `sanitizeInput`), the bounded latency window, and a null result counting as an error.
- GameLoop: with `shouldUpdate` false for 100 frames, unblocking then runs exactly one step for 1/60 s, so there is no backlog. Behaviour without the option is unchanged.
- KeyboardController: `obs.t` deltas are used, with dt=0 on the first call and for a backwards t (`max(0, ...)`). `reset()` clears `lastT`. Repeats and Ctrl/Meta/Alt keys are ignored, blur clears the key state, and `dispose()` removes the listeners.
- ChaseCamera: smoothing is `1-exp(-k*dt)`, `snap()` is unsmoothed, orbit controls are disposed in `dispose()`.
- Game: fixed-step order is host.step -> setInput -> car.update -> world.step -> capture. The reset path covers car, host, view and camera. `?view=drive` is gone; `tiles` and `track` are intact.
- Browser: not re-run. I relied on the worker's report (the pane has no rAF) and the code review.

### Non-blocking issues
1. `Game.ts` has no dispose or teardown: its window `keydown` and `resize` listeners are never removed, and `chase.dispose()` and `controller.dispose()` are never called. This is fine for a one-shot page but should be added when menus (008) can restart the game.
2. `ControllerHost.step` does not guard against a thenable whose `then` throws synchronously (it would throw out of `step`). Very unlikely; can be hardened in 010.
3. The ramp feel was never tested with a physical keyboard. The human should judge it in final approval.
4. The R/C handler in `Game.ts` is separate from `WindowKeySource`. Acceptable.
