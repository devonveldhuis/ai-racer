# 010 – AI bridge: scripted bot, remote adapter, discrete actions

Status: draft

## Goal
Prove the AI-facing API end-to-end without Jev: a scripted bot that drives using only the `Observation`, and a generic async remote-controller adapter that Phase 2 (Jev) will build on. See `PLAN.md` → Phase 2.

## Requirements
- `src/control/bots/RayFollowerBot.ts`: a simple rule-based controller using **only** the `Observation` (no direct access to the car or track). It should steer toward the rays whose near samples are road, slow down when samples ahead show curves or walls close by, and correct based on `lateralOffset`/`headingError`. Selected with `?controller=bot`.
- `src/control/DiscreteActionAdapter.ts`: maps named choices to `CarInput`, matching how a System One model answers (choices, not floats):
  - steering buckets (configurable): `hard_left, left, slight_left, straight, slight_right, right, hard_right` → values
  - throttle buckets: `brake, coast, half, full` → accelerator values
  - plus the inverse (nearest bucket for a given value) for logging/training data.
- `src/control/RemoteController.ts`: generic `CarController` that POSTs the Observation (JSON) to a configurable URL and expects either `{accelerator, steering}` or `{steering_choice, throttle_choice}` (via the adapter). Timeout (configurable), error → hold last input and count failure. Selected with `?controller=remote&url=...`.
- `tools/mock-ai-server.ts` (Node, run with `npm run mock-ai`): tiny HTTP server implementing the remote protocol using the same RayFollowerBot logic, with optional artificial latency (`--latency 200`) to exercise realtime vs lockstep. CORS enabled for the dev server.
- `?timing=lockstep|realtime` switch exposed (from 006).
- Decision log: optional ring buffer of `{t, observation, action, latencyMs}` that can be downloaded as JSONL from the finish screen. This is the seed for training/evaluation data.
- `docs/AI_API.md`: documents the Observation schema, action formats, timing modes, and the remote protocol with an example request/response.

## Acceptance criteria
- [ ] `?controller=bot` completes a lap on most seeds (state the success rate over e.g. 20 seeds in the implementation notes); it may be slow.
- [ ] `npm run mock-ai` + `?controller=remote&url=http://localhost:PORT` drives the car; with `--latency 300` the car still drives in lockstep mode and visibly struggles more in realtime mode.
- [ ] Unit tests for DiscreteActionAdapter mapping (both directions) and RemoteController timeout/error handling (mocked fetch).
- [ ] Decision log downloads as valid JSONL.

## Out of scope
Jev SDK/API integration and API keys (Phase 2).
