# 007 – Race state machine, checkpoints and timing

Status: draft

## Goal
Implement the full race flow: generate → countdown → race → finish, with checkpoints, laps, timing and resets. See `PLAN.md` → Core gameplay loop, Race rules.

## Requirements
- `src/race/Race.ts` state machine: `loading → generating → countdown → racing → finished`, plus `paused`. Emits events (`stateChanged`, `countdownTick`, `checkpoint`, `lap`, `finished`, `reset`) on a typed event bus.
- Countdown 3-2-1-GO (duration configurable). Car sits on `startPose`; ControllerHost is disabled until GO.
- Timer starts at GO and uses **simulation time** (not wall clock), so lockstep mode gives fair times.
- Checkpoint detection by segment crossing of the car's position between physics steps, in order only; finish counts only after all checkpoints of the lap. Configurable `laps` (default 1).
- Progress tracking along the centreline: `distanceAlong`, `headingError`, `lateralOffset`, exposed for the HUD and the Observation (009).
- Reset: `R` (or `controller`-requested reset) puts the car on the last checkpoint pose with zero velocity, adds a configurable penalty (default 2 s), increments reset count. Automatic reset when `isOutOfBounds` or the car is flipped for more than 2 s.
- Keys: `N` new track (new random seed), `Enter` restart same seed, `Esc` pause/resume.
- `RaceResult`: seed, controller name, total time, lap times, resets, off-track time, timestamp. Logged to console and kept in an in-memory results list.
- The seed in use is reflected in the URL (`history.replaceState`) so a track can be shared or reproduced.

## Acceptance criteria
- [ ] Full loop playable from the default URL: new track, countdown, race, finish, restart / new track work repeatedly.
- [ ] Cutting a corner across grass still requires passing all checkpoints; skipping one doesn't finish the race.
- [ ] Unit tests for the state machine transitions, checkpoint ordering, lap counting and penalty timing (with a fake car position feed).

## Out of scope
Visual HUD (008). Minimal console/debug text is fine for verifying.
