# 005 – Car physics and CarInput

Status: done

## Goal
A drivable car built on Rapier's `DynamicRayCastVehicleController`, controlled only through `CarInput`, with grip and drag that depend on the surface, on the tracks built by 004. See `PLAN.md` → Car control API, Physics.

## Decisions (from the human, 2026-10-08)
- **Handling: arcade and forgiving.** High grip, low centre of mass and strong roll resistance, so the car never flips in normal driving, and it brakes hard. Skill should come from the racing line and the braking points, not from catching slides.
- **Top speed on road ≈ 15 m/s (55 km/h)** at full throttle on a long straight. On grass it should be roughly a third of that.
- **No barriers exist** (004 decision), so there is no wall-collision criterion. Out of bounds means falling only: `BuiltTrack.isOutOfBounds`.

## Requirements

### Physics / visuals split
Keep the simulation free of three.js, so tests and a later headless runner don't need a renderer or GLBs:
- `src/car/CarPhysics.ts` (Rapier only, no three.js imports): the chassis rigid body, the cuboid collider and the vehicle controller with 4 wheels. Its dimensions come from config constants, not from the GLB. It is constructed with `(world, config, surfaceAt: (x, z) => SurfaceType | null)`.
- `src/car/CarView.ts` (three.js): loads `raceCar<Colour>.glb` (colour from config, default `Red`) via `loadModel`. It syncs the chassis transform and each wheel node (`wheelFrontLeft`, …) from `CarPhysics`: spin from `wheelRotation`, steer from `wheelSteering`. It interpolates between physics steps with the game loop's `alpha`. The car casts shadows. It has a `dispose()` that doesn't dispose loader-shared geometry or materials.

### Model facts (measured by the coordinator; verify them)
- In `raceCarRed.glb` the front wheels are at **+z** (0.328) and the rear ones at −z (−0.473), so **the car model faces +z**. That is the opposite of the "faces −z" note in `layout.ts`, so derive the three.js rotation from the heading convention accordingly (probably `rotation.y = π − heading`) and test it.
- In model units: wheel radius ≈ 0.141, wheel x ≈ ±0.205, wheelbase ≈ 0.80, body ≈ 0.55 wide × 1.35 long × 0.33 tall. With `worldScale` 4 that is a 0.56 m wheel radius, a 3.2 m wheelbase, and a car about 2.2 m wide and 5.4 m long. The road is 2.76 m wide.
- The loader cancels the kit's root offset, which leaves the car off-centre (it's the same offset as for tiles). Re-centre the visual so its origin matches the chassis body origin. Measure this; don't guess it.

### Input and pedal mapping (pure functions, unit-tested)
- `CarInput` type (`accelerator` 0…1, `steering` −1…+1, −1 = full left) in `src/car/types.ts` (006 will re-export or move it).
- `setInput(input)`: clamps `accelerator` to [0, 1] and `steering` to [−1, 1]. NaN or non-finite values keep the previous value.
- Pedal mapping per PLAN: below `neutral` (default 0.5) → brake force proportional to the distance below neutral, reaching `maxBrakeForce` at 0. Above it → engine force proportional, reaching `maxEngineForce` at 1. At neutral → coast (no engine force, no brake). Export the pure function (e.g. `mapPedals`).
- Steering: the target angle is `steering × maxSteerAngle(speed)`, where the maximum angle shrinks with speed (a configurable curve, e.g. a linear blend from `maxSteerAngleLow` at 0 m/s to `maxSteerAngleHigh` at `steerFalloffSpeed`). The actual wheel angle moves toward the target at no more than `steerRate` rad/s, so it doesn't snap. Export the pure functions.
- Small corners have a centreline radius of only 2 m against a 3.2 m wheelbase. The low-speed steering lock must be large enough that the car can get through a small corner at low speed: arcade values like 0.8–1.0 rad are fine. Tune this and record the value.

### Surfaces
- Each physics step, look up `surfaceAt` under each wheel's contact point (or its hard point if it isn't in contact). Apply `frictionSlip` per wheel from a `surfaces` table in config, and apply extra rolling or linear drag from the same table. Missing ground (`null`) → the wheel gets no special handling; it's simply in the air.
- Config table (starting values, tune them): `road`, `kerb` slightly lower grip than road, `grass` much more drag and lower grip, `sand` worse than grass (unused for now), `wall` unused.
- Target: on grass, full throttle tops out at about ⅓ of the road top speed.

### Arcade stability
- Lower the centre of mass (e.g. `setAdditionalMassProperties` or a collider offset), use fairly stiff suspension, and apply angular damping and/or an anti-roll measure, so the car doesn't flip in normal driving: full steering lock at top speed and kerb strikes included. Record the approach.

### API
- `update(dt)`: applies the current input, steering rate limiting, surface friction and drag, then `updateVehicle(dt)`. It is called from the fixed-step update before `world.step()`.
- `getState()`: `{ position: {x, y, z} (m), heading (radians, the layout.ts convention), speed (m/s, signed, forward), surface (under the chassis centre), wheelSurfaces, input (last applied CarInput) }`.
- `resetTo(pose: { position: {x, z} (m), heading })`: teleports the car upright, slightly above the ground, with zero linear and angular velocity, steering centred and the input set to neutral. Note: `layout.startPose` is in grid units, so the caller multiplies by `worldScale`.
- `dispose()`: removes the body, collider and vehicle controller from the world.

### Config
- All tuning values go in `GameConfig` as a nested `car` object (dimensions, mass, suspension, engine and brake forces, steering curve and rate, neutral, colour) plus a `surfaces` table. URL overrides aren't needed. Don't mutate `DEFAULT_CONFIG` (note that `parseUrlOverrides` makes a shallow copy).

### Dev harness `?view=drive&seed=N` (temporary, replaced in 006)
- Wired like the other debug views (dynamic import in `main.ts`). It shows the track from `buildTrack`, with the car at `layout.startPose` × `worldScale`.
- A fixed-follow camera behind the car (simple; the real chase camera comes in 006).
- **Raw** arrow keys (or WASD) map to `CarInput`: up → accelerator 1, down → 0, neither → neutral (0.5); left → steering −1, right → +1. Holding both up and down → neutral.
- `R` resets to the start pose. `isOutOfBounds` → automatic reset to the start pose.
- A text panel shows speed in m/s and km/h, the surface under each wheel, the current input and the steering angle.

## Acceptance criteria
- [ ] Unit tests (pure): input clamping incl. NaN; pedal mapping at 0, below neutral, neutral, above neutral, 1, and for a non-default `neutral`; the steering-angle-versus-speed curve; the steering rate limit.
- [ ] Headless physics tests (vitest, real Rapier, no GLB, stub `surfaceAt` on a flat ground cuboid):
  - From standstill at full throttle on `road`, the speed after 10 s is 15 ± 2 m/s.
  - On `grass` it is ≤ 40 % of the road value.
  - Braking with accelerator 0 from top speed stops the car in less than 3 s.
  - Coasting slows the car down.
  - Full steering lock at top speed for 10 s keeps the car upright (chassis up-vector y > 0.7 throughout).
  - `resetTo` gives zero velocity and the requested heading, and `getState().heading` round-trips the pose heading for all four cardinal directions.
- [ ] **Drivability test** (headless, real `buildTrack` with a stub `loadModel` and real `surfaceAt`): a simple test-only pure-pursuit driver (it steers toward a centreline point ahead and slows down for curvature) completes a full lap on 5 different seeds, at least one of them containing a small corner. It finishes each lap within a generous time limit, never flips, and is on `road`/`kerb` for at least 80 % of the steps. Report the lap times and the off-road fraction. This driver lives in the test file only, because the real scripted bot is a later task.
- [ ] Dev harness: the car accelerates, brakes and steers, can drive a lap of a generated track, grass clearly slows it, and driving off the ground edge resets it. Verify in the browser with screenshots, and describe what you checked.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Technical notes
- Rapier API: `world.createVehicleController(chassisBody)` → `addWheel(connectionCs, directionCs, axleCs, suspensionRestLength, radius)`, `setWheelSteering`, `setWheelEngineForce`, `setWheelBrake`, `setWheelFrictionSlip`, `setWheelSideFrictionStiffness`, `wheelIsInContact`, `wheelContactPoint`, `wheelRotation`, `currentVehicleSpeed`, `updateVehicle(dt)`. See `node_modules/@dimforge/rapier3d-compat/dist/control/ray_cast_vehicle_controller.d.ts`. Use rear-wheel or all-wheel drive (your choice), steer the front wheels, and brake all four.
- The vehicle's wheel rays must hit the 004 `ground` collider. Exclude the chassis's own collider from them (the controller does this for its own chassis; check).
- `src/track/builder.ts` (`buildTrack`, `BuiltTrack.surfaceAt` in metres, `isOutOfBounds`, injectable `loadModel`) and `src/track/layout.ts` (heading convention) are the integration points. Don't change their behaviour; a minimal fix is allowed only if you find a bug, recorded as a deviation and covered by a test.
- Fixed timestep: use `config.physicsHz` and `GameLoop` like `main.ts` does.

## Out of scope
The controller interface and `ControllerHost`, the chase camera and keyboard ramping (006), race logic, checkpoints, the HUD, AI, barriers. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- `src/car/types.ts`: `CarInput`, `CarPose`, `CarState` (state also carries `steerAngle`, positive = right).
- `src/car/control.ts` (pure): `sanitizeInput` (clamp, non-finite keeps the previous value), `mapPedals`, `maxSteerAngle` / `targetSteerAngle` (linear blend `steerAngleLow` -> `steerAngleHigh` over `steerFalloffSpeed`), `stepSteerAngle` (rate limit), `ackermannAngles`.
- `src/car/CarPhysics.ts` (Rapier only): dynamic chassis body + cuboid collider (density 0, mass and inertia set through `setAdditionalMassProperties`, centre of mass at `comY` = -0.3 m), `DynamicRayCastVehicleController` with 4 wheels (FL, FR, RL, RR), all-wheel drive, all four brake, front wheels steer. `update(dt)`, `setInput`, `getState`, `resetTo`, `dispose`, plus `upY()`, `getWheelState(i)` for rendering and tests.
- `src/car/CarView.ts` (three.js): loads `raceCar<Colour>.glb` through `loadModel` (injectable), casts shadows, syncs chassis (interpolated with `alpha` via `capture()` after each step / `render(alpha)`; `snap()` after a teleport), wheel spin/steer/suspension height; `dispose()` only detaches (shared geometry/materials untouched).
- `src/core/config.ts`: `CarConfig`, `SurfaceParams`, nested `car` and `surfaces` in `GameConfig`/`DEFAULT_CONFIG` (not mutated anywhere).
- `src/debug/driveView.ts` + hook in `src/main.ts` (`?view=drive&seed=N`): as specified; the panel shows speed (m/s, km/h), surface under the chassis and each wheel, input, wheel angle, reset count. `window.__drive` exposes `car/view/track/state()/reset()` for scripted checks.
- Tests: `src/car/control.test.ts` (pure), `src/car/CarPhysics.test.ts` (headless Rapier, flat ground cuboid, stub `surfaceAt`), `src/car/drive.test.ts` (real `generateTrack` + `buildTrack` with a stub `loadModel`, real `surfaceAt`, test-only pure-pursuit driver; `LAP_REPORT=1` prints lap stats).

Files: `src/car/{types,control,control.test,CarPhysics,CarPhysics.test,CarView,drive.test}.ts`, `src/debug/driveView.ts`, `src/main.ts`, `src/core/config.ts`.

### Model facts (verified by parsing the GLB with the loader's offset cancelled)
- The car faces +z (front wheels z +0.328, rear -0.473, left wheels at +x), so body yaw = `PI - heading`; it round-trips for N/E/S/W (tested) and the car drives along the heading (tested).
- After the loader's root-offset cancel the model is already centred in x (-0.364..+0.364); z spans -0.686..0.66. Wheel axle height 0.1175, mid-wheelbase z = -0.0725. The body origin of `CarPhysics` is the mid-wheelbase point at axle height, so `CarView` shifts the model by `-(0, 0.1175, -0.0725) * 4` m. Wheel node origins sit on the inner face of each tyre (x 0.205, tyre centre 0.285): `CarView` re-pivots each wheel node to the tyre centre, so physics `wheelX` is 1.14 m (0.285 x 4), not 0.205 x 4.
- Wheel radius 0.141 x 4 = 0.564 m, wheelbase 0.80 x 4 = 3.2 m (front axle +1.6, rear -1.6 from the body origin).

### Tuning (`DEFAULT_CONFIG.car` / `.surfaces`)
mass 1000 kg; chassis cuboid half extents (1.1, 0.5, 2.7) centred 0.45 m above the body origin; COM 0.3 m below the body origin (about 0.26 m above the ground); inertia x1.5 of a solid box; angular damping 2; suspension rest 0.3 / travel 0.25 / stiffness 30 / compression 4 / relaxation 6 / max force 30000; side friction stiffness 1; anti-roll 6000 N m/rad; `maxEngineForce` 6500 N, faded linearly to 0 at `engineTopSpeed` 19.5 m/s; `maxBrakeForce` 120 (Rapier brake units, about 0.09 m/s2 per unit); neutral 0.5; steering lock 0.9 rad at 0 m/s blending to 0.2 rad at 15 m/s; steer rate 4 rad/s; reset height 0.4 m. Surfaces (frictionSlip / drag in 1/s): road 3 / 0.1, kerb 2.6 / 0.12, grass 1.5 / 1.0, sand 1.0 / 1.6, wall 1.0 / 1.0.

Stability approach: low COM, boosted inertia, angular damping, a restoring torque about the forward axis proportional to the lean angle (anti-roll), a wide track and stiff suspension, plus Ackermann steering (parallel steering scrubbed speed badly: a full-throttle full-lock circle fell from 14.5 to 4 m/s; now it settles at about 12 m/s).

### Measured numbers (headless)
- Road, full throttle from rest: 2 s 7.8, 5 s 13.1, 10 s 14.8, 15 s 15.0 m/s (target 15 +/- 2 at 10 s).
- Grass: 10 s 4.9 m/s = 33 % of road (limit 40 %).
- Brake from 15.0 m/s with accelerator 0: stops in 1.87 s (limit 3 s), no nose-over (min up-y 1.00).
- Coasting at neutral from 15.0 m/s: 9.1 m/s after 5 s.
- Full steering lock at top speed for 10 s, either side: min chassis up-y 1.00 (requirement > 0.7), ending at about 12 m/s. A 0.15 m high ridge at speed: no flip.
- Low-speed full-lock circle (3 m/s): about 7 m diameter; the pure-pursuit driver gets through the small corners.
- Pure-pursuit laps (seeds 1..5, all of which contain a `roadCornerSmall`; the driver limits itself to about 11 m/s2 lateral and 3.5 m/s minimum corner speed). Lap time / road+kerb fraction (chassis centre) / peak speed / min up-y: seed 1: 20.0 s / 94.1 % / 9.0 / 1.00; seed 2: 24.9 s / 93.5 % / 10.1 / 1.00; seed 3: 31.7 s / 92.6 % / 8.7 / 1.00; seed 4: 24.4 s / 92.8 % / 7.9 / 1.00; seed 5: 21.4 s / 91.3 % / 8.5 / 1.00. Off-road fraction 6 to 9 %, no flips, no falls. Lap limit in the test: length / 3 m/s + 30 s.
- `npm test`: 136 tests in about 5.6 s wall clock (the car tests take under 1 s).

### Deviations
- The spec says "wheel x about 0.205"; that is the wheel node origin (inner tyre face). The tyre centre is 0.285 (x4 = 1.14 m), which physics and the re-pivoted visual wheels use.
- Added `engineTopSpeed` (engine force fades to zero towards that speed) instead of relying on linear drag alone for the top speed: with only drag the car decelerated by 5 m/s2 when lifting off at top speed. `drag` is small on road (0.1/s) and large on grass (1.0/s), which also gives the grass target (33 %).
- Added Ackermann steering (`ackermannAngles`) and an anti-roll torque; neither is in the spec, both serve "arcade stability" and low-speed small-corner steering. `steerAngleLow/High` are the centre ("bicycle") angles; per-wheel angles differ.
- `maxBrakeForce` is in Rapier brake units (not N; the engine force is in N). Documented in config.
- `CarState` has an extra `steerAngle` field (the harness panel needs it); `CarPhysics` has extra `upY()`, `getWheelState()`, `getInput()`, `body`, `collider`, `vehicle`.
- `CarView.capture()` is called after `world.step()` (one capture per fixed step).
- The harness `R` key also increments the "resets" counter shown in the panel (it counts every reset, manual or automatic).
- No screenshots were saved to disk: the browser pane's screenshots are not written to files, and I did not use the headless Chrome. `/tmp/claude-1000/shots/005/` is empty.
- No changes to `builder.ts`, `layout.ts` or anything else outside the files listed above.

### Known limitations
- All-wheel drive, so there is no oversteer to play with; there is no reverse (accelerator 0 only brakes, as in the plan).
- The harness camera is a plain fixed follow camera (no smoothing).
- Wheel spin direction and left/right wheel meshes were checked by eye in the browser (and the steering sign numerically), not by an automatic test.
- Rapier brake units are not N; if later tasks want physical units a scale factor is needed.
- A wheel steered about its tyre centre means the visual tyre pivots in place; the inner/outer difference (Ackermann) is visible on the front wheels only.

### What the browser check showed (`npm run dev`, browser pane, `?view=drive&seed=3`)
- On load the red car sits on the start grid on the road, facing the driving direction (down the start straight towards the first bend), with the camera behind it. The panel showed 0 km/h, surface road on all four wheels, input accel 0.50 (neutral) steer 0.00. The wheels are at the four corners under the body, and the front wheels visibly turn when steering. No console errors.
- Injected `ArrowUp`: the car accelerates (about 7 m/s after 1.3 s on the start straight). `ArrowRight` and `ArrowLeft` steer: the panel's wheel angle changes (rate limited, smaller lock at speed) and the heading increases for right (clockwise).
- Leaving the road: the panel switched the wheels to `grass` one by one and the speed settled near 5 m/s while the same throttle on the road reached 7.5 m/s and rising (matching headless numbers: 14.8 vs 4.9 m/s).
- Driving straight over the grass to the ground edge: when the car fell below the ground, the reset counter incremented and the car was back on the start pose at 0 m/s. `R` resets too. The car never tipped.
- Not checked in the browser: a full lap by hand (the headless drivability test covers laps). The dev server I started is stopped (the one on port 5173 belongs to the user and was left alone).

## Review (round 1)
Verdict: APPROVED

### Checks run
- `npm run build`, `npm test` (10 files, 136 tests, ~5.5 s), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass. `dist/` is gitignored.
- Own headless script (real Rapier, flat ground and real `buildTrack` with stub `loadModel`; in /tmp, outside the repo):
  - Road full throttle: 14.78 m/s at 10 s, 14.98 at 15 s. Grass: 4.91 m/s (33 %). Brake from top speed: stops in 1.87 s.
  - Full lock at top speed for 10 s, both directions: min up-y 1.00, ends at about 11.7 m/s.
  - Laps with my own pure-pursuit driver, seeds 11 / 42 / 7 / 99 (all have a small corner): all finished, 32.3 / 37.4 / 20.9 / 46.9 s, off-road fraction 0.4-0.5 %, min up-y 1.00, no out-of-bounds.
  - Kerb strike: 20 combinations of lateral offset and entry angle (up to 1.2 rad) at full throttle across road/kerb/grass on seed 11: min up-y 1.00, max body y 0.49 m, max |vy| 0.23 m/s. No flip or launch. (The 004 ground is flat, so kerb is a grip/drag change only. The worker's 0.15 m ridge test covers a physical step.)
  - Heading: `getState().heading` round-trips 0, pi/2, pi, -pi/2, 1 rad. The car resets to heading pi/2 and drives to +x (east). `atan2(f.x, -f.z)` matches the layout.ts convention.
- Visual math: yaw `PI - heading` maps the model's +z to (sin h, 0, -cos h) = the heading direction. The left wheels are at +x in the chassis frame (matches the model). Steering sign: positive (right) gives `rotation.y = -steering` in three.js, so the front moves to -x = the car's right. Checked numerically that `wheelRotation` increases when driving forward and that the right wheel is the inner one on a right turn (0.87 vs 0.57 rad), so `rotation.x = rotation` spins the tyres forward.
- Pure functions: NaN/Infinity keep the previous value; pedal mapping is safe for `neutral` 0 and 1 (no division by zero in a reachable branch); the non-default neutral, the steer curve and the rate limit are tested.
- Surface lookup uses `wheelContactPoint` (in contact) or `wheelHardPoint` (in the air) in world metres and passes (x, z) to `surfaceAt`; a `null` result skips the grip/drag change (the previous friction is kept; the wheel is simply in the air). `getState().surface` uses the chassis centre.
- `CarPhysics.dispose()` is idempotent and removes the controller, collider and body (verified: body count 1 -> 0, collider count 2 -> 1, the remaining one is my ground). `CarView.dispose()` only detaches the model and does not dispose geometry or materials.
- Scope: changes are limited to `config.ts` (additive), `main.ts` (drive hook), `src/car/*`, `src/debug/driveView.ts` and this task file. `Models/`, PLAN.md, other tasks, `builder.ts` and `layout.ts` are untouched. No ControllerHost, chase camera or race logic. `DEFAULT_CONFIG` is not mutated.
- Tests are deterministic (fixed dt, no wall-clock assertions). The car tests run in under 1 s.
- Not done: no browser check of `?view=drive&seed=3` by me. I relied on the worker's description and on the code read-through of `driveView.ts` (it matches the spec: raw keys, R reset, auto reset on out-of-bounds, panel contents).

### Deviations
All four are justified and acceptable: wheel x 1.14 m (the tyre centre, versus the 0.205 node origin on the inner tyre face; the visual wheel is re-pivoted to match), `engineTopSpeed` power fade (gives a stable top speed and no hard decel when lifting off), anti-roll torque, and Ackermann steering. Rapier brake units are documented. The extra `CarState.steerAngle` field and the extra accessors are harmless.

### Issues
- Blocking: none.
- Non-blocking:
  1. The acceptance criterion asks for screenshots of the browser check. The worker saved none and only described it. The human should look at `?view=drive&seed=3` at the final approval.
  2. In `drive.test.ts` the lap time limit (length / 3 m/s + 30 s) is generous. That is fine for a smoke test, but it would not catch a large drop in pace.
  3. `CarView` re-pivot code and wheel spin/steer directions have no automated test (the worker noted this). I verified the math by hand and numerically (see above).

## Rework (round 1)
Human change request at final approval (2026-10-08), not a review rejection: **make the car half its current size and double the top speed.** All other decisions stand (arcade handling, no barriers, falling-only out of bounds). Keep the existing structure, files and passing behaviour. Only retune and resize.

### Car size: half the size
- The track is unchanged (`worldScale` stays 4). Only the car shrinks.
- Add `car.modelScale` (metres per GLB unit for the car model, default **2**, i.e. `worldScale / 2`). `CarView` must load and scale the car with `car.modelScale`, not `worldScale`. That includes the re-centring and the wheel re-pivot offsets, which are currently derived from the 4× scale.
- Halve every physics length in `car` config: `halfExtents`, `colliderY`, `comY`, `wheelX`, `frontAxleZ`/`rearAxleZ`, `wheelRadius`, `connectionY`, the suspension `restLength`/`maxTravel`, and `resetHeight`. That gives about a 1.1 m wide, 2.7 m long car with a 1.6 m wheelbase and 0.28 m wheel radius. The visual wheels must still line up with the physics wheels (the tyres sit on the ground, not floating or sunk), so verify this.
- Retune mass, inertia, suspension stiffness and force, anti-roll and brake for the smaller car (e.g. a lighter mass; the worker's choice). Keep it arcade-stable. Record the final values.
- The steering lock can probably drop now that the wheelbase is 1.6 m (small corners have a 2 m centreline radius). Tune it so small corners are drivable at low speed and the car is stable at high speed.

### Top speed: doubled
- Road top speed target: **30 ± 3 m/s** (≈ 108 km/h) at full throttle. Measure it after enough time to reach it, at most 15 s, and update the test.
- Grass keeps the same ratio: full throttle on grass ≤ **40 %** of road top speed (≈ ⅓ ideally).
- Braking with accelerator 0 from top speed: stops in **< 4 s**.
- Full steering lock at top speed for 10 s: stays upright (up-vector y > 0.7). Kerb strikes at speed must not flip or launch the car.
- Coasting still slows the car down gradually (it doesn't brake hard on lift-off).

### Tests
- Update `CarPhysics.test.ts` to the new targets.
- The drivability test (pure-pursuit, 5 seeds with at least one small corner, ≥ 80 % on road or kerb, no flips) must still pass. The test driver should now use the higher top speed on straights.
- **Tighten its lap time limit** (round-1 review, non-blocking 2), so that a large drop in pace fails: e.g. a limit derived from the measured times plus ~50 % headroom. Report the lap times, off-road fraction and peak speeds.
- Visual check in the dev harness `?view=drive&seed=3` on your own port (not 5173). Check that the car is visibly half the size, the wheels touch the road, it reaches about 30 m/s on the longest straight, and grass slows it. Save screenshots to disk if your tooling allows it (e.g. headless Chrome to /tmp/claude-1000/shots/005/). Otherwise say so.

Append `## Implementation Notes (round 2)` with the new tuning values, the measured numbers and any new deviations; don't rewrite round 1's notes.

## Implementation Notes (round 2)

### What changed
- `src/core/config.ts`: new `car.modelScale` (2), all car lengths halved, retuned values below; comment updated.
- `src/car/CarView.ts`: loads and scales the car with `car.modelScale` (re-centring and wheel re-pivot offsets follow the scale automatically; `create` now needs only `{ car }`). `CarPhysics.ts` unchanged.
- `src/car/CarPhysics.test.ts`: new targets (30 +/- 3 m/s after 15 s, grass <= 40 %, brake < 4 s, full lock upright, rest height, reset height) and a kerb-strike test at top speed (ridge 0.15 m high, square and yawed 0.5 rad, asserts up-y > 0.7 and body y < 1.5 m so no launch).
- `src/car/drive.test.ts`: driver limits speed to 30 m/s on straights, lateral acceleration 13 m/s2 (const `LATERAL_ACCEL`, was 11, the lighter car corners harder), lap limit tightened to `length / 5.5 m/s + 2 s`.

### Tuning (`DEFAULT_CONFIG.car` / `.surfaces`)
modelScale 2; mass 400 kg; halfExtents (0.55, 0.25, 1.35), colliderY 0.225, comY -0.15 (inertia x1.5, angular damping 2 as before); wheelX 0.57, axles +/-0.8 (wheelbase 1.6), wheelRadius 0.282, connectionY 0.15; suspension rest 0.15 / travel 0.125 / stiffness 60 / compression 5.7 / relaxation 8.5 / max force 12000; antiRoll 600; maxEngineForce 2800 N faded to 0 at engineTopSpeed 42; maxBrakeForce 60; steering lock 0.8 rad at 0 m/s to 0.1 rad at 30 m/s (falloff speed 30), rate 4 rad/s; resetHeight 0.2. Surfaces drag (1/s): road 0.05, kerb 0.07, grass 0.6 (grip unchanged: road 3, kerb 2.6, grass 1.5).

### Measured (headless, flat ground)
- Road full throttle: 2 s 10.4, 5 s 20.9, 10 s 28.5, 15 s 31.0 m/s (test: 30 +/- 3 at 15 s).
- Grass at 15 s: about 9 m/s (about 30 % of road; at 10 s 9.2 m/s); limit 40 %.
- Brake from top speed (accelerator 0): stops in 3.2 s (limit 4 s), min up-y 1.00.
- Coasting from 31 m/s at neutral: 28.1 m/s after 2 s (gradual, no hard braking).
- Full lock at top speed, 10 s, both sides: min up-y 1.00 (needs > 0.7); the car scrubs down to about 7.6 m/s.
- Kerb strike (0.15 m ridge at top speed, square and yawed): passes (no flip, no launch); the kerb surface itself is only a grip/drag change as the ground is flat.
- Rest height of the body origin 0.247 m (wheel radius 0.282, sag from the suspension).
- Pure-pursuit laps, seeds 1-5 (all contain a small corner), lap time / road+kerb fraction / peak speed / min up-y: s1 17.2 s / 96.2 % / 11.3 / 1.00; s2 21.4 s / 93.7 % / 11.3 / 1.00; s3 26.8 s / 86.8 % / 11.2 / 1.00; s4 20.4 s / 93.8 % / 10.9 / 1.00; s5 17.7 s / 88.3 % / 11.3 / 1.00. Off-road 4 to 13 %, no flips, no falls. New limits: length/5.5 + 2 = 25.6, 35.0, 41.6, 31.8, 29.8 s (about 1.5 x the measured times). Round 1 limit was length/3 + 30.
  Peak lap speeds are only about 11 m/s because the generated tracks are small (130-220 m, short straights): the driver is corner limited. The car itself reaches 30 m/s on a long enough straight (flat-ground tests); no generated track has one, so that was not seen in the browser. Raising `LATERAL_ACCEL` to 16 or higher gave faster laps but dropped the road fraction towards 80 % or below (82 % at 16, 75 % at 22), so 13 was kept.
- `npm run build`, `npm test` (137 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.

### Visual check (`?view=drive&seed=3`, own dev server on port 5199, stopped afterwards)
- Measured from the live scene: car 1.46 m wide (with tyres) x 2.7 m long, wheel diameter 0.564 m, lowest wheel vertex at y = 0.000 (tyres sit exactly on the road), wheel centres at x +/-0.57 from the body, z +/-0.8 from the origin: visuals match the physics wheels. In the screenshot the car is clearly narrower than the road (about half its width).
- Driven with injected ArrowUp: accelerates to about 10 m/s over the start straight, switches to `grass` when it leaves the road and the speed decays; driving over the ground edge resets the car (reset counter increments, back on the start pose at 0 m/s). No console errors.
- Screenshots: not saved to disk. Headless Chrome (swiftshader) produced a blank 3.7 KB PNG (deleted, not a usable picture); the browser pane's screenshots cannot be written to files. 30 m/s in the browser was not observed (see above).

### Deviations
- Added `LATERAL_ACCEL` const in the drive test (11 -> 13) so the driver uses the lighter car's grip; the lap-time limit is a formula (length / 5.5 + 2) instead of per-seed constants.
- The kerb strike test is a 0.15 m ridge collider on flat ground (the track ground has no height), same approach as round 1, now at top speed and with a yawed variant.
- `CarView.create` takes `Pick<GameConfig, 'car'>` (no `worldScale`).

## Review (round 2)
Verdict: APPROVED

### Checks
- `npm run build`, `npm test` (137 tests, about 6 s), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass. Tests are deterministic (fixed dt, no wall-clock assertions; `LAP_REPORT` only gates logging).
- Rework items: `car.modelScale` = 2 and used by `CarView` (load scale, model offset, suspension offset division); all physics lengths halved; mass, suspension, brake, steering retuned and recorded; top speed, grass ratio, braking, lock, coasting all within the targets; tests updated; lap limit tightened (`length/5.5 + 2`, about 1.5x measured); visual check done (screenshots not saved, disclosed). Scope clean: `CarPhysics.ts` untouched, no `Models/`/other task files changed. Deviations (LATERAL_ACCEL 13, formula limit, ridge-collider kerb test, `CarView.create` signature) are justified.
- Independent headless runs (own script, real Rapier, flat ground), road: 5 s 20.9, 10 s 28.5, 15 s 31.0 m/s (in 30 +/- 3). Grass at 15 s: 9.2 m/s (30 %, limit 40 %). Brake from top speed: 3.17 s, min up-y 1.00. Coast from 31.0: 29.5, 28.1, 26.7, 25.4, 24.2 m/s at 1..5 s (gradual). Full lock both ways for 15 s at top speed: min up-y 1.00, max body y 0.25 (no hop). Brake plus full lock, and alternating +/-1 steering flicks every 0.25 s at top speed: min up-y 1.00.
- Off-road at 30 m/s (road strip, grass, ground ending at |x| = 12): leaving at yaw 0.3, 0.8, 1.05 and 90 degrees, the car stays at y 0.25 with zero upward velocity until it drops off the edge (no launch, no flip). A slow, shallow-angle edge exit (about 9 m/s) hops to y 0.56 (vy 2.3) at the lip; harmless.
- Laps with my own seeds (worker's driver copy, seeds not in 1-5): s11 27.3 s / 96.4 % road / min up 1.00; s42 29.4 s / 88.3 %; s7 16.8 s / 90.1 %; s99 36.7 s / 84.5 %; s123 27.7 s / 92.7 %. All finish, no flips, no falls, peak 11.2 to 11.6 m/s. (I reused the worker's pure-pursuit driver rather than writing a second one.)
- CarView with the real `raceCarRed.glb` (GLTFLoader in node, same root-offset handling as the loader), car at a non-trivial pose: all four visual wheel centres match the physics wheel centres (hard point minus suspension length) to within 1 mm; wheel bbox min y = 0.000 (tyres touch the ground), radius 0.282 equals `wheelRadius`; whole car 2.62 x 0.76 x 2.77 m including rotation. The re-centring (`MODEL_ORIGIN * modelScale`), the re-pivot (`dx / node.scale.x`) and the per-frame offset (`/ scale`) are consistent with `loadModel(name, modelScale)`.
- Lap-time limit: it is not flaky (deterministic). It catches a pace drop in the driver/car cornering (limit equals an average of 5.5 m/s against about 8 m/s measured). It does NOT catch an engine force drop: with `maxEngineForce` halved, seeds 1-5 still finish (18.8, 23.1, 29.2, 22.4, 19.5 s versus limits 25.6 to 41.6 s), because laps are corner-limited at about 11 m/s. Engine pace is covered by the 30 +/- 3 m/s physics test instead.

### Straight-length numbers (200 seeds, longest straight run on the centreline, metres)
Max 51.4 (seed 35), p90 35.5, median 19.8, min 11.8. Reachable speed from a corner exit at 8 m/s with full throttle: 15.4 m/s after the median 19.8 m, 19.2 after 40 m, 20.7 after the longest 51.4 m, 21.7 after 60 m. So the worker's statement is partly right: the car can never get near 30 m/s on a generated track (30 m/s needs about 150+ m from a standstill; 15 s at full throttle), but the capability on the longest straights is about 20 m/s, not 11. The 11 m/s peaks are the test driver's corner-speed limit (curvature look-ahead with `LATERAL_ACCEL` 13 and a 3.5 m/s floor) plus braking before the next corner, not a physics limit. Tracks are small (130-300 m); if 30 m/s is to matter in play, the generator needs longer straights (a design decision for the human).

### Issues
- Non-blocking 1: the drive test does not exercise speeds above about 11 m/s and is insensitive to engine force (see above). Acceptable because the flat-ground tests cover top speed, braking, lock and the kerb strike at 30 m/s.
- Non-blocking 2: `CarPhysics.test.ts` kerb strike uses a ridge on flat ground, not a real kerb tile; no real-track high-speed run exists (follow-up when tracks allow it).
- Non-blocking 3: the "30 m/s seen in the browser" and saved screenshots were not done (tooling limit, disclosed; the 30 m/s is shown headlessly and the wheel/size geometry independently verified above).
