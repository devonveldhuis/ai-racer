# 007 – Race state machine, checkpoints and timing

Status: done

## Goal
Implement the full race flow on the default page: generate → countdown → race → finish, with checkpoints, laps, timing and resets. See `PLAN.md` → Core gameplay loop, Race rules.

## Context (after 006)
- `src/game/Game.ts` (`runGame(config)`) runs a free-drive scene: a track, `CarPhysics` + `CarView`, a `ControllerHost` (with the `enabled` flag and `reset()`), a `ChaseCamera` (`snap()`) and a `GameLoop`. The fixed step is `host.step → car.update → world.step → view.capture`, and `R`/out-of-bounds reset to the start.
- `TrackLayout` (`src/track/layout.ts`) has `checkpoints[]` (`a`/`b` with `a` on the driver's left, `position`, `normal` = the driving direction; the **last** one is the start/finish line), `centreline` (`points`, `distance`, `tangent`, `pieceIndex`, `totalLength`) and `startPose`, all in **grid units**. Multiply by `worldScale` for metres. The heading convention is in the header of `layout.ts`.
- `buildTrack` / `BuiltTrack.dispose()` (004), `CarPhysics.resetTo/dispose`, `CarView.dispose` (005).
- 006 review, non-blocking: `Game.ts` has no teardown. Its window listeners are never removed, and `controller.dispose()`/`chase.dispose()` are never called. **This task must fix that**, because `N`/`Enter` rebuild the race.

## Concurrency note
Task 011 (longer straights) is being implemented **at the same time in a separate worktree**. It changes the track generator (`src/track/generator.ts`, `layout.ts`, `validate.ts`), so the shape of every seed changes. Therefore:
- **Don't edit anything in `src/track/`.** Put progress tracking in `src/race/`.
- **Race tests must not depend on the shape of a seed.** Build test layouts by hand with `layoutFromPieces` (`src/track/generator.ts`) or construct them directly. Assertions that hold for any generated track are fine (e.g. "for seeds 1–10, crossing every checkpoint in order finishes the race").

## Requirements

### Event bus
- `src/core/events.ts`: a small typed event emitter (`on` returns an unsubscribe function; `emit`; `clear`). No dependencies.

### Race state machine (`src/race/Race.ts`, no three.js / Rapier)
- States: `loading → generating → countdown → racing → finished`, plus `paused` (reachable from `countdown` and `racing`; resuming returns to the previous state).
- Events: `stateChanged`, `countdownTick` (3, 2, 1, 0 = GO), `checkpoint` (index, split time), `lap` (lap number, lap time), `finished` (`RaceResult`), `reset` (reason: `'manual' | 'outOfBounds' | 'flipped'`, penalty).
- Pure logic, driven by `race.step(dt, carSample)` once per fixed physics step, where `carSample = { position (m), heading, upY, surface }`. It returns or exposes the actions the game should perform (e.g. "reset car to pose X", "enable/disable controller"), so it is unit-testable with a fake car feed.
- **Countdown:** 3-2-1-GO. The duration per tick is configurable (default 1 s). During the countdown the car sits on `startPose` and the ControllerHost is disabled, so the car gets the hold input. It is enabled at GO.
- **Timing:** the race time starts at GO and uses **simulation time** (the sum of `dt`), never the wall clock, so lockstep gives fair times. Pause freezes it.

### Checkpoints and laps
- Detection uses **segment–segment intersection** between the car's position in the previous and current step and the checkpoint segment (in metres), crossed in the driving direction (dot product with `normal` > 0). Only the **next expected** checkpoint counts. Crossing others, or crossing backwards, does nothing.
- The last checkpoint (start/finish) completes a lap only after all earlier checkpoints of that lap. `laps` is configurable (default 1). After the final lap → `finished`.
- Leaving the start: the car starts behind the line (`startPose` is 0.75 cells past the entry line, i.e. *after* the start/finish checkpoint), so the first lap's checkpoints begin at index 0. Make sure the initial position never counts as a lap.

### Progress (`src/race/progress.ts`, pure)
- `trackProgress(layout, worldScale, position, heading, hint?)` → `{ distanceAlong (m), headingError (rad, −π..π, relative to the centreline tangent), lateralOffset (normalised: −1 = left road edge, +1 = right road edge, using the road half-width 0.345 cells), nearestIndex }`. Use a local search around the previous `nearestIndex` (`hint`) for O(1) typical cost, with a global fallback when the car has jumped (e.g. after a reset). The race exposes it every step for the HUD (008) and the Observation (009).

### Resets
- `R` (and a `requestReset()` API for controllers later): the car goes to the **last passed checkpoint's pose**, with zero velocity, heading along `normal`, centred on the road. Before the first checkpoint it goes to `startPose`. Add a configurable penalty (default 2 s) to the race time and increment the reset count. Also call `host.reset()`, `view.snap()` and `camera.snap()`.
- Automatic reset when `isOutOfBounds` (reason `outOfBounds`) or when the car is flipped (`upY < 0.3`) for more than 2 s (reason `flipped`). Both use the same penalty (configurable).
- **Off-track time:** sim time while the racing car's `surface` is `grass`, `sand` or `null`.

### Results
- `RaceResult`: `{ seed, controller, laps, totalTime, lapTimes, resets, offTrackTime, timestamp (ISO, wall clock is fine here) }`. Log it to the console as one line plus the object, and push it to an in-memory results list exported from `src/race/results.ts`.

### Game integration (`src/game/Game.ts`)
- The default URL plays the full loop: generate track (seed from config) → countdown → race → finished. While `finished`, the car is held (host disabled). Show minimal text in the existing debug/text element, e.g. "Finished 32.41 s — Enter: restart, N: new track". The real HUD is 008.
- Keys:
  - `N`: new track with a new random seed (`Math.random` is fine for picking it)
  - `Enter`: restart the same seed
  - `Esc`: pause/resume
  - `R`: reset to the last checkpoint

  `N`/`Enter` tear down and rebuild the track, car, host and controller without a page reload. The seed in use goes into the URL with `history.replaceState`.
- **Teardown:** `runGame` returns or keeps a handle with `dispose()`. A rebuild must not leak: no duplicate listeners, no extra colliders, meshes or bodies. Verify by doing 10 × `N` in the browser and checking the collider/body/scene counts (the existing `?debug=1` panel) stay flat.
- `?debug=1` panel: add the race state, race time, checkpoint `k/n`, lap, resets, off-track time and the progress values.

### Config
- `race`: `{ laps: 1, countdownStepSeconds: 1, resetPenaltySeconds: 2, flipResetSeconds: 2 }` in `GameConfig`. Add a `?laps=N` URL override.

## Acceptance criteria
- [ ] The full loop is playable from the default URL. Countdown → race → finish → `Enter` (same track) and `N` (new track) work repeatedly. `Esc` pauses and freezes the timer. Verify in the browser, driving with injected keys or `stepFrames` as in 006, and report what you checked.
- [ ] Cutting a corner across grass still requires passing all checkpoints. Skipping one doesn't finish the race: there is a unit test for this.
- [ ] Unit tests (fake car feed, hand-built layouts):
  - state transitions incl. pause/resume
  - the countdown ticks and the controller being enabled only at GO
  - checkpoint ordering
  - backwards crossing ignored
  - lap counting with `laps: 2`
  - the start position not counting as a lap
  - penalty and reset count
  - the reset pose at the last checkpoint
  - the flip auto-reset after 2 s
  - off-track time accumulation
  - timing in sim time (independent of wall clock)
- [ ] Unit tests for `trackProgress`: on the centreline → offset 0, heading error 0; on the road edges → ±1 (left negative); heading error sign; monotonic `distanceAlong` along a lap; the global fallback after a jump.
- [ ] Integration test (headless, real Rapier, `buildTrack` with a stub `loadModel`, hand-built or generated layout): a scripted feed (or the pure-pursuit pattern from `src/car/drive.test.ts`) completes a 1-lap race and produces a `RaceResult` with plausible values.
- [ ] 10 × rebuild leaves the collider/body/scene counts flat (browser), and `dispose()` removes the window listeners (unit test with a fake window or spies).
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Out of scope
The visual HUD and menus (008), ray sensors and the full Observation (009), bots and AI (010), anything in `src/track/` (011 owns it concurrently), and car physics tuning. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

Worktree: `/home/devon/Projects/ai-racer/.claude/worktrees/agent-a602523d837d00f05`, branch `worktree-agent-a602523d837d00f05` (based on `cee11ad`, uncommitted).

### Summary
- `src/core/events.ts` (+ test): typed `EventBus` (`on` returns an unsubscribe, `emit`, `clear`).
- `src/race/Race.ts`: pure state machine (`loading -> generating -> countdown -> racing -> finished`, `paused`). `step(dt, CarSample)` returns `{ resetTo, controllerEnabled }` and the same facts are emitted as events (`stateChanged`, `countdownTick`, `checkpoint`, `lap`, `finished`, `reset`). Segment-segment checkpoint detection in the driving direction, only the next expected checkpoint, laps, penalties, flip and out-of-bounds auto resets, off-track time, sim-time only. Exports `startPoseMetres`, `checkpointPose`, `crossesCheckpoint`.
- `src/race/progress.ts`: `trackProgress` (local search around the hint, global fallback when the minimum is at the window edge or > 1.5 cells away). `ROAD_HALF_WIDTH = 0.345`. Heading error sign: positive = pointing right of the road.
- `src/race/results.ts`: `RaceResult`, `recordResult` (console line + object, in-memory list), `getResults`, `clearResults`.
- `src/race/testLayouts.ts`: hand-built 15-piece rectangle (`layoutFromPieces`) and path helpers for tests.
- `src/core/config.ts`: `RaceConfig` / `race` defaults, `?laps=N`.
- `src/game/gameKeys.ts`: key handling (R, C, Esc, Enter, N) with a returned remover, so teardown is unit-testable.
- `src/game/Game.ts`: rewritten around a `Session` (track, car, view, controller, host, chase, race). `runGame` returns `{ dispose() }`. `N`/`Enter` dispose the session and rebuild on the same renderer/scene/world. The seed goes into the URL via `history.replaceState`. HUD text element in `#ui` (countdown, time/lap/checkpoint, paused, finished text). `?debug=1` panel shows race state, time (+penalties), lap, checkpoint k/n, resets, off-track time, progress values and collider/body/object/geometry/texture counts. `window.__game` (getters) has `race`, `rebuild`, `counts`, `stepFrames`, etc.
- Tests: `Race.test.ts` (37), `progress.test.ts` (8), `race.integration.test.ts` (1, real Rapier + stub `loadModel`), `events.test.ts` (3), `gameKeys.test.ts` (4), `config.test.ts` (+1).

### Deviations
- `CarSample` has an extra optional `outOfBounds` field (the game passes `track.isOutOfBounds`), so out-of-bounds resets go through `step` like the others.
- `Race` does not push to the results list; `Game.ts` calls `recordResult` on the `finished` event (keeps `Race` free of module state). `Race.result` also exposes the result.
- Race time: `time` = sim time since GO + penalties; split, lap and total times use `time`. The `controllerEnabled` flag is already true in the `step` that reaches GO (the game applies it to the next step).
- The state machine has `beginGenerating()` and `startCountdown()` entry points (`Race` is created after `generateTrack`, so `loading` is only the initial state). Reset requests outside `racing` (countdown, paused, finished) are ignored.
- The "dispose removes window listeners" unit test covers `installGameKeys` and `KeyboardController.dispose` with a fake window. `Game.ts` itself needs WebGL, so it is not unit-tested.
- The finished/countdown text lives in a new element in `#ui` (the `?debug=1` panel is debug only).

### Known limitations / follow-ups
- A `dispose()` during an in-flight rebuild is guarded (the build error is swallowed and the new session is disposed), but this path is not tested.
- `N`/`Enter` pressed while a rebuild is in flight are ignored.
- The `Game.ts` update loop does a global `trackProgress` search only when needed; no performance concern seen.
- I did not touch `src/track/`. Tests use `layoutFromPieces` plus generic assertions on `generateTrack` seeds 1-10 (centreline mid-point path finishes; skipping one checkpoint does not).

### Checks
- `npm test`: 19 files, 220 tests pass. `npm run build`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass.
- Integration test (rectangle layout, scripted pure-pursuit via `ControllerHost`): car held during the countdown (< 0.5 m movement), events `tick3..tick0, cp0..cp3, lap`, 0 resets, plausible time.

### Browser verification (own dev server on port 5211, stopped afterwards; driven through `__game.stepFrames` in chunks of 5 frames because `GameLoop` caps sub-steps)
- Default loop on seed 3: countdown 3 -> 2 -> GO, race timer starts at 0, `Esc` pauses and freezes the time (paused text shown), `Esc` resumes. An injected pure-pursuit driver (patched `car.update`) finished the 1-lap race: 36.75 s, 0 resets, 0.2 s off track, HUD "Finished 36.75 s — Enter: restart, N: new track", result logged. (A first, faster driver cut cp5 on seed 3 and looped for 4000 s without finishing, which also shows that a skipped checkpoint blocks the finish.)
- `Enter` restarts the same seed (countdown again), `R` resets (resets 1, time +2 s, car back at the start pose), `N` picks a new seed and updates the URL.
- Rebuild leak check: 10 x `N` gives colliders 3, bodies 1, geometries 30, textures 1 every time (scene object count differs only because each seed has a different number of pieces). 10 x `Enter` (same seed) gives identical counts: colliders 3, bodies 1, scene objects 123, geometries 30, textures 1. No console errors.

## Review (round 1)
Verdict: APPROVED

### Checks
- `npm run build`, `npm test` (19 files, 220 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass in the 007 worktree.
- Scope clean: only `src/core/{events,config}*`, `src/game/{Game,gameKeys}*` and `src/race/` touched. Nothing in `src/track/`, `Models/`, `PLAN.md`, `AGENTS.md` or other task files.
- All acceptance criteria covered by tests or the documented browser run (10 x N and 10 x Enter flat counts, Esc freezes the timer, skipped checkpoint blocks the finish, `dispose()` removes the key and controller listeners via a fake window).
- Deviations are justified: `outOfBounds` on `CarSample` (routes the reset through `step`), results recorded by `Game` (keeps `Race` free of module state), `controllerEnabled` true in the step reaching GO (the game applies it on the next step), `beginGenerating`/`startCountdown`, resets ignored outside `racing`, listener test scope.
- My own throwaway adversarial tests (deleted afterwards), all pass:
  - A crossing exactly at the segment endpoint (t = 1) counts once and the next step from the line does not count again; backwards crossing ignored; back-then-forward and oscillation across a checkpoint count exactly once.
  - Reset to start: no lap, next expected checkpoint stays 0, penalty applied exactly once (also when a manual request and `outOfBounds` coincide in one step: one reset).
  - Pause during the countdown freezes it and resumes into `countdown`. The flip timer resets when the car is upright again (100 steps flipped, 1 upright, 100 flipped gives no reset; a further 30 gives exactly one).
  - `trackProgress`: for seeds 1-30, every centreline point, walked twice round with a hint (so the seam is crossed), returns the right `nearestIndex`, ~0 offset, ~0 heading error. Heading error stays in (-PI, PI] for offsets around +-PI and 7 rad. In 102,625 random (hint, target) jumps across 30 seeds there were 0 wrong locks versus the global search.
- Code reading: lateral sign is right-positive in the layout frame (left negative, correct). Penalty is added only in `doReset`. Off-track time and the flip timer accumulate only in `stepRacing`. All timing is the sum of `dt`. `Game.ts` update order is `host.step -> car.update -> world.step -> view.capture -> race.step`, then reset/enable is applied for the next step. Teardown: session dispose covers `race`, `chase`, `controller`, `view`, `car` and `track`. `runGame().dispose()` stops the loop and removes keys, resize listener, HUD and panel, and frees the renderer and world. The in-flight build is guarded.

### Merge test with 011
Both branches are uncommitted working trees, so in a throwaway clone at `cee11ad` (under `/tmp/claude-1000/review007/m`) I overlaid the changed files of 011 and then 007. The file sets are disjoint (no overlap). Result: `npm test` 19 files, 232 tests pass; typecheck, lint and prettier pass. No conflicts.

### Issues
Blocking: none.

Non-blocking:
1. `Race.doReset` leaves `_progress.nearestIndex` as the next-step hint after a teleport. The global fallback in `trackProgress` handles it (0 wrong locks in my test), so this is only a note.
2. A single step that crosses two consecutive checkpoints would register only the first. Unreachable at physics speeds and step sizes; no action needed.
3. If `buildSession` fails partway (non-dispose error), already-built parts of that session are not freed. Rare; follow-up at most.
4. The in-flight rebuild guard and `Game.ts` as a whole are not unit-tested (needs WebGL); accepted, as the spec allows browser verification.
