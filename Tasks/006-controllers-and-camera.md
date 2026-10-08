# 006 – Controller interface, keyboard controller, chase camera

Status: draft

## Goal
Introduce the `CarController` abstraction and `ControllerHost` so every driver (keyboard, bot, AI) drives through the same path. Add a proper chase camera. See `PLAN.md` → Car control API.

## Requirements
- `src/control/types.ts`: `CarInput`, `CarController`, and a placeholder `Observation` type (minimal for now: `t` and `car` fields. Task 009 fills in rays/progress).
- `src/control/ControllerHost.ts`:
  - Calls `controller.decide(obs)` at `decisionHz` (config, default 20 for keyboard, 10 for AI).
  - Handles sync and async (`Promise`) results; never more than one decision in flight; holds last input until a new one arrives; validates and clamps (NaN → hold previous).
  - Records per-decision latency stats (mean/p95) for later telemetry.
  - Timing modes `realtime` and `lockstep` (lockstep: the game loop doesn't advance the sim while a decision is pending). Implement both now; keyboard uses realtime.
  - Inputs are only forwarded to the car when the race allows it (a `enabled` flag the race system will toggle).
- `src/control/KeyboardController.ts`: W/↑ throttle, S/↓ brake, A/←, D/→ steer. Produces smooth analogue values (configurable ramp up/down rates) rather than instant ±1; no keys = coast (accelerator at neutral), steering returns to centre.
- Controller selected by `?controller=keyboard` (default) through a small registry so 010 can add more.
- `src/camera/ChaseCamera.ts`: smooth follow behind and above the car, looks slightly ahead, with configurable distance/height/stiffness; `C` cycles chase / top-down / free-orbit (debug).
- Replace the dev harness from 005 with this system.

## Acceptance criteria
- [ ] Driving with the keyboard feels smooth and responsive with the chase camera.
- [ ] Unit tests for ControllerHost: decision rate, async hold-last-input, never two in flight, clamping/NaN handling, lockstep pausing (use a fake clock).
- [ ] Unit tests for KeyboardController ramping using simulated key state.

## Out of scope
Ray sensors, race states, HUD.
