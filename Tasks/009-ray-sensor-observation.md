# 009 – Ray-cone sensor and Observation

Status: draft

## Goal
Give drivers a structured view of the world ahead: a configurable cone of rays, each sampling what's under it and detecting walls/obstacles, assembled into the full `Observation`. See `PLAN.md` → Observation.

## Requirements
- `src/sensors/RayConeSensor.ts` with config: `fovDeg` (default 90 ⇒ −45°..+45°), `rayCount` (default 9, ordered left→right), `sampleDistances` (metres, default `[5,10,20,35]`), `maxRange`, `heightOffset`.
- For each ray:
  - **Ground samples** at each distance: classify the point using the layout (`cellInfo`) and `surfaceAt`:
    - on road of a straight/long-straight → `straight`; corner → `left_curve`/`right_curve` **relative to the racing direction**; start/finish piece → `start_finish`
    - kerb → `kerb`; grass → `grass`; sand → `sand`; outside the built world → `void`
  - **Obstacle cast**: horizontal Rapier raycast from the car along the ray direction up to `maxRange`, excluding the car's own collider; return first hit distance and class (`wall` or `obstacle`). If a ground sample lies beyond the obstacle hit, still report its ground class (the AI gets both).
- `buildObservation(car, race, sensor) → Observation` exactly matching the `Observation` / `RaySample` / `SensorClass` types in `PLAN.md` (update `src/control/types.ts`). All numbers finite, rounded to sensible precision; JSON-serialisable.
- ControllerHost now passes the real Observation to controllers.
- Sensor sampling happens only when a decision is due (not every frame), but the debug overlay may sample every frame.
- Debug overlay (`F1` / `?debug=1`): draw rays in 3D, sample points coloured by class, obstacle hits marked; a side panel listing the current Observation as compact text/JSON.
- Performance: full sense with defaults must take < 1 ms on a normal laptop.

## Acceptance criteria
- [ ] Driving into a left-hand corner, the forward samples switch to `left_curve` before the car reaches it, and walls on the outside of corners appear as `wall` hits.
- [ ] Changing sensor config via `GameConfig` (e.g. `fovDeg=120`, `rayCount=15`) works without code changes.
- [ ] Unit tests: ray angle generation, classification against a hand-built small layout, Observation schema validity (e.g. a runtime validator or type-guard test), JSON round-trip.

## Out of scope
Any AI/bot logic (010).
