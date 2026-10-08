# 005 – Car physics and CarInput

Status: draft

## Goal
A drivable car using Rapier's `DynamicRayCastVehicleController`, controlled only through `CarInput`, with surface-dependent grip/drag. See `PLAN.md` → Car control API, Physics.

## Requirements
- `src/car/Car.ts`: creates the chassis rigid body + 4 wheels from `raceCarRed.glb` (car colour configurable), syncs wheel meshes (spin + steer angle) from the vehicle controller.
- `setInput(input: CarInput)`: clamps `accelerator` to [0,1] and `steering` to [-1,1]. Pedal mapping per PLAN: below `neutral` (default 0.5) → brake proportional to distance from neutral; above → engine force proportional; at neutral → coast. Configurable `neutral`, `maxEngineForce`, `maxBrakeForce`, `maxSteerAngle`, and steering speed (rate limit so the wheels don't snap).
- Steering angle reduces with speed (configurable curve) to keep the car controllable.
- Per-wheel surface lookup via `surfaceAt` from 004 → apply `frictionSlip` per wheel and extra rolling/linear drag from a `surfaces` config table. Off-road must feel clearly slower.
- `getState()`: position, heading, forward speed (m/s), current surface under the car, last applied input.
- `resetTo(pose)`: teleports the car with zero velocity.
- Temporary dev harness (`?view=drive&seed=N`): track + car + a fixed-follow camera + **raw** arrow-key input to tune handling. Task 006 replaces this with the real controller system.
- All tuning values in `GameConfig`.

## Acceptance criteria
- [ ] On the dev harness the car accelerates, brakes, steers, and can complete a lap of a generated track at a reasonable speed without flipping in normal driving.
- [ ] Driving onto grass noticeably reduces speed and grip; returning to road restores it.
- [ ] Hitting a barrier stops/deflects the car; it does not pass through.
- [ ] Unit tests for input clamping and pedal mapping.

## Out of scope
Race logic, HUD, AI.
