# 010 – AI bridge: scripted bot, remote adapter, discrete actions

Status: in-review

## Goal
Prove the AI-facing API end-to-end without Jev. Build a scripted bot that drives using only the `Observation`, and a generic async remote-controller adapter (plus a local mock AI server) that Phase 2 (Jev) will build on. This completes Phase 1. See `PLAN.md` → Phase 1 and Phase 2.

## Context (after 009)
- `src/control/types.ts`: the full `Observation` / `RaySample` / `SensorClass` per PLAN, `buildObservation`, `isObservation`, and `CarController` (`name`, `decide(obs) → CarInput | Promise<CarInput>`, `reset?`, `dispose?`).
- `src/control/ControllerHost.ts`: decides on sim time at `decisionHz`, with one decision in flight, hold-last-input, validation and clamping, error counting, `enabled`, `reset()`, latency stats, and timing modes `realtime` / `lockstep` (**already selectable with `?mode=realtime|lockstep`** from 006, so no new `?timing=` switch is needed).
- `src/control/registry.ts`: `createController(kind, deps)`. `bot` and `remote` currently fall back to keyboard with a warning. `config.decisionHz` has keyboard 60 and others 10.
- The sensor (`src/sensors/`) and race exist. There are **no walls or obstacles** in the game, so `obstacleDistance` is always `null` today. Tracks have a 60–80 m main straight (011), and the car tops out at about 30 m/s.
- `src/car/drive.test.ts` has a test-only pure-pursuit driver that uses the layout directly. The bot must **not** do that.

### Carried-over review notes to fix in this task
- **006 review:** a thenable whose `then` throws synchronously would escape `ControllerHost.step`. Harden the host so a decision that throws synchronously, returns a rejecting promise, or returns a broken thenable counts as an error and keeps the last input.
- **009 review, item 1:** the doc comment on `Observation.t` wrongly says "(not the simulation time)". Change it to: race time in sim seconds since GO, **excluding** reset penalties, while the HUD's displayed time includes them.
- **009 review, item 3:** `formatObservation` (the debug panel) is display-only. The remote protocol must send the real Observation JSON.

## Requirements

### RayFollowerBot (`src/control/bots/RayFollowerBot.ts`)
- A rule-based `CarController` that uses **only** the `Observation`: no imports of the car, track, race or sensor internals. Put the pure decision logic in a function, e.g. `rayFollowerDecide(obs, state, params) → { input, state }`, so the mock server can reuse it unchanged.
- Behaviour, as guidance; tune it:
  - steer toward the rays whose near samples are road classes (`straight`, `left_curve`, `right_curve`, `start_finish`)
  - add a correction from `headingError` and `lateralOffset` to stay centred
  - slow down when the samples ahead show curves (more so the nearer they are and the more of the cone they fill), when obstacles are close, or when the near samples are off-road
  - full throttle when the forward cone shows a long straight
- `?controller=bot` selects it through the registry, at `decisionHz` 10 (the existing default for non-keyboard controllers).

### DiscreteActionAdapter (`src/control/DiscreteActionAdapter.ts`)
- This matches how a System One model answers: named choices, not floats.
- Steering buckets, configurable with these defaults: `hard_left −1, left −0.6, slight_left −0.25, straight 0, slight_right 0.25, right 0.6, hard_right 1`.
- Throttle buckets, configurable with these defaults: `brake 0, coast <neutral>, half 0.75, full 1`, where `coast` uses `config.car.neutral`.
- `toInput({ steering_choice, throttle_choice }) → CarInput`. An unknown choice throws a descriptive error.
- The inverse, `fromInput(input) → { steering_choice, throttle_choice }` (the nearest bucket), for logging and training data.

### RemoteController (`src/control/RemoteController.ts`)
- A generic `CarController` that `POST`s `{ "observation": <Observation> }` as JSON (`Content-Type: application/json`) to a configurable URL.
- It accepts either `{ accelerator, steering }` (numbers) or `{ steering_choice, throttle_choice }` (via the adapter). Validate the response; anything else is an error.
- Timeout via `AbortController` (configurable, default 2000 ms). A timeout, network error, non-2xx status or invalid body → reject, so the host keeps the last input and counts the failure. Log at most one warning per distinct error kind, not one per decision.
- `?controller=remote&url=...` selects it. A missing or invalid URL → a warning and fallback to keyboard. Add `url` (and an optional `timeoutMs`) to the config URL parsing, with validation (http/https only).
- `fetch` is injectable, for tests.

### Mock AI server (`tools/mock-ai-server.ts`, `npm run mock-ai`)
- A tiny Node HTTP server (port configurable, default 8787) implementing the remote protocol. It uses the **same** `rayFollowerDecide` logic, keeping per-connection state minimal: stateless, or keyed by a client id if needed. It validates the request with `isObservation` and returns 400 on a bad body.
- Options: `--port`, `--latency <ms>` (artificial delay), `--choices` (answer with `steering_choice` / `throttle_choice` via `fromInput`, to exercise the adapter path).
- CORS enabled for the dev server origin, including the `OPTIONS` preflight.
- Run it with Node 22's built-in TypeScript type stripping if workable. Otherwise use the lightest option, and record the choice. Avoid adding heavy dependencies; if one is truly needed, keep it a devDependency and record why. The script must not be part of the browser bundle.

### Decision log
- An optional ring buffer in or beside `ControllerHost`: `{ t, observation, action (CarInput), latencyMs, error? }`. Capacity is configurable (default 20 000), and recording is on by default for non-keyboard controllers.
- A **"Download decision log (JSONL)"** button on the finish screen (and `L` key as a shortcut) saves `decisions-<seed>-<controller>.jsonl`, one JSON object per line. It is only shown when the log is non-empty.

### Docs (`docs/AI_API.md`)
- The Observation schema with field meanings, units and conventions (heading, left/right, ray order, sensor classes, `t` semantics), the action formats (continuous and discrete buckets), the timing modes (realtime vs lockstep, and when to use which), the remote protocol with an example request and response (and the error behaviour), how to run the mock server, and the decision log format.

## Acceptance criteria
- [ ] **Bot success rate:** a headless test using the real pipeline (Rapier car + `buildTrack` with a stub `loadModel` + sensor + `Race` + `ControllerHost`, bot at 10 Hz, realtime with sync decisions) runs 1-lap races on 20 seeds. At least **16/20 finish** within a generous time limit. Report the success rate, the lap times compared with the pure-pursuit driver on the same seeds, and the resets. The bot may be slow. Keep the test runtime reasonable (report it); running a subset in the default `npm test` and the full 20 behind an env flag is acceptable if needed.
- [ ] `?controller=bot` drives in the browser (verify with frame stepping).
- [ ] With `npm run mock-ai` and `?controller=remote&url=http://localhost:8787` the car drives in the browser.
  - With `--latency 300` and `?mode=lockstep`, it still completes a lap.
  - With `?mode=realtime` it visibly struggles more: report the lap times or the off-track time for both.
  - `--choices` also drives.

  If the browser can't reach the server from your tooling, do the equivalent headless test against the real server process using Node `fetch`, and record it.
- [ ] Unit tests:
  - the DiscreteActionAdapter mapping in both directions, including nearest-bucket ties and unknown choices
  - RemoteController with a mocked `fetch`: success with both response formats, timeout, non-2xx, invalid JSON, invalid fields, and warning deduplication
  - the hardened ControllerHost: a sync throw, a rejecting promise, a thenable whose `then` throws
  - the decision log: ring capacity, and JSONL with every line parsing back to the stored entry
  - the URL/config parsing for `url` and `timeoutMs`
- [ ] The decision log downloads as valid JSONL. Verify in the browser or headlessly that it parses line by line and each `observation` passes `isObservation`.
- [ ] `docs/AI_API.md` exists and matches the code.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass. Make sure `tools/` is type-checked and linted, or explicitly excluded with a reason.

## Out of scope
Jev or any real model integration, API keys and proxies (Phase 2), Score/probability resolution policies (Phase 2), walls and obstacles, race, physics and generator changes. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- **Hardened `ControllerHost`** (`src/control/ControllerHost.ts`): a sync throw (also from the observation factory), a rejecting promise, a thenable whose `then` throws, and a `then` getter that throws all count as one error and keep the last input. Async results are adopted through `Promise.resolve(...)`, so a broken `then` becomes a rejection. New optional `log` option records every decision.
- **`Observation.t` doc comment** fixed (race time in sim seconds since GO, excluding reset penalties).
- **`RayFollowerBot`** (`src/control/bots/RayFollowerBot.ts`): pure `rayFollowerDecide(obs, state, params) -> { input, state }` plus a `RayFollowerBot` class. Only `import type` from `../types`, so Node can run it. Steers toward the rays with the longest runs of road samples (weight = run length squared), minus heading-error and lateral-offset terms, low-pass smoothed. Target speed is the tightest of: max speed 22 m/s; a curve / off-road sample ahead on the centre rays (it must be able to brake to 8 m/s at the near end of the sample interval, planning with 4 m/s2); obstacles (always `null` today). Off-road surface caps speed at the corner speed.
- **`DiscreteActionAdapter`** (`src/control/DiscreteActionAdapter.ts`), **`RemoteController`** (`src/control/RemoteController.ts`, injectable `fetch`, `AbortController` plus a racing timeout promise, error kinds `timeout | network | http | invalid_json | invalid_response`, one warning per kind), **`DecisionLog`** (`src/control/DecisionLog.ts`).
- **Registry** (`src/control/registry.ts`): `bot` and `remote` now build the real controllers; a remote without a valid URL warns and falls back to keyboard.
- **Config** (`src/core/config.ts`): `?url=` (http/https only, via `parseHttpUrl`) and `?timeoutMs=` (1 to 600000) in `remote: { url, timeoutMs }`; `decisionLogCapacity` (20 000).
- **Game / HUD**: a decision log for non-keyboard controllers; finish-screen button "Download decision log (JSONL)" (only when the log is non-empty) and the `L` key; file `decisions-<seed>-<controller>.jsonl`. Debug hooks `__game.decisionLogText()` / `__game.downloadLog()`. Files: `src/game/Game.ts`, `src/game/gameKeys.ts`, `src/ui/Hud.ts`, `src/ui/styles.ts` (buttons wrap).
- **Mock AI server** `tools/mock-ai-server.ts`, `npm run mock-ai`. Docs in `docs/AI_API.md`.
- **Tests added**: `DiscreteActionAdapter.test.ts`, `RemoteController.test.ts`, `DecisionLog.test.ts`, host hardening and log tests in `ControllerHost.test.ts`, `registry.test.ts`, `config.test.ts` (url / timeoutMs), `gameKeys.test.ts` (L), `bots/RayFollowerBot.test.ts`, `bots/RayFollowerBot.integration.test.ts` (20 seeds, plus the real mock server in lockstep, both answer formats), `tools/mock-ai-server.test.ts`.
- **Config files**: `tsconfig.json` now includes `tools` and sets `allowImportingTsExtensions` (needed for the explicit `.ts` imports Node's type stripping requires; `noEmit` is already on); `eslint.config.js` lints `tools/**/*.ts` with Node globals; `vitest.config.ts` also includes `tools/**/*.test.ts`; `package.json` has the `mock-ai` script. `tools/` is therefore type-checked and linted (not excluded).

### How the mock server runs
`npm run mock-ai -- [--port 8787] [--latency <ms>] [--choices]` runs `node tools/mock-ai-server.ts` using Node 22's built-in type stripping (Node 22.23 here; no new dependency). It listens on 127.0.0.1 and ::1 only, and is stateless (the server uses the bot with `smoothing: 0`). Run from a test with `startMockServer({ port: 0, ... })`.

### Results
- **Bot success rate (headless, real pipeline, 10 Hz, realtime, sync):** **20/20** finished on seeds 1 to 20, 0 resets and 0.0 s off-track on all; also 60/60 when checked on seeds 1 to 60 (`BOT_SEEDS=60`). Lap times (s), bot vs the test-only pure-pursuit driver (which reads the layout): s1 32.9 / 36.3, s2 21.9 / 24.6, s3 32.6 / 33.9, s4 38.0 / 36.9, s5 29.0 / 31.2, s6 23.5 / 27.6, s7 30.0 / 31.5, s8 42.3 / 48.1, s9 39.6 / 44.9, s10 35.6 / 40.8, s11 23.2 / 27.4, s12 33.8 / 38.7, s13 34.0 / 36.9, s14 50.3 / 50.5, s15 36.2 / 41.1, s16 36.2 / 40.0, s17 29.3 / 34.9, s18 37.7 / 40.8, s19 24.2 / 27.1, s20 37.0 / 43.9. The bot is faster than the pursuit driver on 19 of 20 seeds (the pursuit driver is conservative). `BOT_REPORT=1` prints this table.
- **Browser, `?controller=bot&seed=3`** (frame stepping): finished in 32.58 s, 0 resets, 0 off-track, 356 decisions, 0 errors. The finish screen shows the button; the log has 356 lines, every line parses and every `observation` passes `isObservation` (checked in the page with `isObservation`), and the downloaded blob equals `decisionLogText()` with the filename `decisions-3-bot.jsonl`.
- **Remote via the browser** (seed 3; mock server on separate ports; sim stepped from the wall clock at 60 Hz through `__game.stepFrames`):
  - 0 ms, realtime: 32.83 s, 0 off-track, 0 errors, mean latency 4.9 ms.
  - `--choices`, 0 ms: 33.00 s, 0 off-track (the log's `action` values are bucket values such as 0.25).
  - `--latency 300`, **lockstep**: 32.83 s, 0 off-track, 0 resets (identical to the 0 ms time; it took 143.5 s of wall clock for 359 decisions).
  - `--latency 300`, **realtime**: did not finish. After 130 s of sim time the car was still on lap 1 (checkpoint 2 of 12), with **90.8 s off-track** of 129.6 s; 332 decisions made, 995 skipped (about 3 Hz effective). Compare 32.83 s and 0 s off-track at 0 ms.
  - All of this ran through CORS from `localhost:5251` to `localhost:878x` without problems.
- **`npm test`**: 35 files, 359 tests, about 15.5 s total (the 20-seed bot test about 3 s; the two real-server lockstep laps about 1 s each).
- Checks: `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass.

### Deviations
- `RayFollowerBot` has no steering of its own beyond what the spec lists, but it does **not** use `start_finish` / curve classes as a steering prior, only for speed. No spec requirement is missed.
- The mock server is **stateless** and runs the bot with `smoothing: 0` instead of keeping per-connection state (spec allowed stateless). Its laps match the in-browser bot closely (32.83 s vs 32.58 s on seed 3), but they are not identical to the local bot.
- `tsconfig.json` got `allowImportingTsExtensions` and `tools` in `include`; `vitest.config.ts` includes `tools/**/*.test.ts` (the spec asks for `tools/` to be type-checked and linted; the config changes were needed to do it).
- `startMockServer` also exports `createHandler`, returning `{ port, close }`, so tests can start it on port 0.
- The off-road speed limit in the bot looks only at the centre ray (a road a few metres wide always shows grass on the +-11 degree rays at 35 m, which slowed the bot on straights); this was tuned from measured lap times.
- The help line in the HUD now ends with "L decision log" (the key does nothing for the keyboard controller, where there is no log).
- `GameConfig` gained `remote` and `decisionLogCapacity`; `ControllerDeps.config` takes `remote` as optional so existing callers and tests still compile.
- No new dependencies.

### Known limitations / follow-ups
- Obstacle handling in the bot is untested in a game (there are no obstacles); its unit test covers it only synthetically.
- The bot's corner speed (8 m/s) is one value for all corners; small and large corners are not distinguished.
- The remote controller does not send a client or session id, so a server cannot keep per-run state; add one in Phase 2 if needed.
- A custom thenable that never calls back leaves a decision in flight forever (lockstep would wait); the remote controller always times out, so this only matters for custom controllers.
- The decision log keeps full observations: at the default 20 000 entries it can reach tens of MB in memory for a long session.
- Browser runs used frame stepping; the real `requestAnimationFrame` loop was not exercised here.
