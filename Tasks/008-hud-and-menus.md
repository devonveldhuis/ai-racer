# 008 – HUD and menus

Status: done

## Goal
Make the game readable and pleasant to play: a loading screen, a countdown overlay, a live race HUD, pause and finish screens, a help line, a minimap and grass dust. It replaces the plain text overlay from 007.

## Decisions (from the human, 2026-10-08)
- **Style: clean arcade.** Semi-transparent dark panels (e.g. `rgba(10,12,16,.6)`) with rounded corners and one accent colour. Numbers use a bold monospace or tabular-nums font, so digits don't jitter. It must be readable over both grass and sky. Use system fonts only (`ui-monospace`, `system-ui`); there are no external font or CDN requests.
- **Extras: a minimap and grass dust.** No results-history list.

## Context (after 007)
- `src/game/Game.ts` (`runGame(config) → { dispose }`) runs per-round sessions. `N`/`Enter` rebuild through `rebuild(seed)`. There is a plain-text `hud` div in `#ui` (`hudText`) and a `?debug=1` panel.
- `src/race/Race.ts`: states `loading | generating | countdown | racing | finished | paused`. A typed `EventBus` emits `stateChanged`, `countdownTick` (3, 2, 1, 0 = GO), `checkpoint`, `lap`, `finished` (`RaceResult`) and `reset` (reason, penalty). The race also exposes the time, lap, checkpoint, resets, off-track time and progress.
- `src/race/results.ts`: an in-memory results list (`RaceResult` has seed, controller, laps, totalTime, lapTimes, resets, offTrackTime and timestamp).
- `CarPhysics.getState()`: speed (m/s), surface, wheelSurfaces, input. `ControllerHost`: input, enabled, stats.
- `src/assets/loader.ts` `preloadModels(names, onProgress)`.
- `index.html`: `#ui` is a fixed, `pointer-events:none` overlay.

## Requirements

### Structure
- `src/ui/` modules, plain DOM and CSS with no framework: e.g. `Hud.ts` (owns the overlay root and sub-components), `format.ts` (pure formatters), `Minimap.ts`, and `styles.ts` or a CSS string injected once.
- The HUD is driven by **race events** (state changes, countdown, finish, resets) plus a **per-frame snapshot**: `hud.update(snapshot)` with time, speed, surface, input, lap, checkpoint, best time, controller name and car pose.
- `Hud.dispose()` removes all DOM and listeners. It lives across sessions (it isn't rebuilt on `N`/`Enter`), but it **rebinds** to each new session's race events and minimap layout. The bindings from the old session must be released (no stale listeners).

### Screens and elements
- **Loading screen**: shown on the first load while models load. It has a progress bar using `preloadModels` progress, done/total. Preload every model the game needs before the first session. During later `N`/`Enter` rebuilds, show a small "Generating track…" toast instead of the full screen.
- **Countdown**: big centred 3 / 2 / 1 / GO!, with a short scale/fade animation per tick (CSS). GO! fades out after about 0.7 s.
- **Race HUD** (live):
  - top-left: current race time (`m:ss.mmm`), best time on this seed (from the results list, or `—`), checkpoint `k/n`, lap `l/L`
  - bottom-centre or bottom-right: speed in km/h (big number) and the current surface (a small label coloured by surface)
  - bottom-left: two small bars, accelerator (0…1, with a tick at neutral and the brake side tinted differently from the throttle side) and steering (−1…+1, centred), plus the controller name. These are useful when an AI is driving.
  - A brief "+2.0 s" penalty flash on `reset` events.
- **Paused overlay**: a dimmed screen with "Paused — Esc to resume".
- **Finish screen**:
  - total time (big), lap times, resets, off-track time and seed
  - a "New best!" badge when it beats the previous best on this seed
  - two buttons: *Restart (Enter)* and *New track (N)*. They must be clickable (`pointer-events: auto` on the panel only) and call the same actions as the keys.
- **Help line**: a small line along the bottom: `W/S throttle·brake  A/D steer  R reset  Enter restart  N new  Esc pause  C camera  H help`. `H` toggles it, and it's visible by default. Don't bind `F1`: it's reserved for the sensor overlay in 009.
- **Minimap** (top-right, about 180–220 px):
  - a 2D canvas, north-up, scaled to `layout.bounds`
  - the track drawn once per session into an offscreen canvas as a thick centreline stroke, with the start/finish line marked
  - each frame: the car as a dot with a heading tick, plus the **next checkpoint** highlighted
  - redrawn only when the car moves more than about a pixel, or at most at render rate
- Keep the existing `?debug=1` panel working, but move it so that it doesn't overlap the new HUD.

### Grass dust
- When a wheel's surface is `grass` (or `sand`) and the speed is above about 2 m/s, emit small dust puffs at that wheel. Use a pooled `THREE.Points` or `InstancedMesh` with a fixed capacity (e.g. 256): no allocation per frame, and particles fade and rise over about 0.6–1 s.
- The emission rate scales with speed. It is purely visual and uses render-time `dt` (not physics). The pool belongs to the session, and its geometry and material are disposed with it.

### Performance
- Throttle DOM writes: only set `textContent` or style when the value changed, and format numbers at most about 20 Hz (the time display may update every frame if it's cheap). Use `transform: scaleX()` for the bars. Don't use layout-thrashing reads in the frame loop.

### Also fix (007 review, non-blocking 3)
- If `buildSession` fails partway (e.g. a model load error), free the parts already built (the track, car physics and view), so a failed `N` doesn't leak. Show an error toast and keep the game usable: pressing `N` again retries.

## Acceptance criteria
- [ ] Every element above appears at the right moment and updates live: loading → countdown → race HUD → (pause) → finish → restart/new track, repeated several times without duplicated elements or stale listeners.
- [ ] Readable with no overlap at 1280×720 and at 2560×1440. Check both, using the browser's viewport resizing, and describe the result. If you can save screenshots, put them in `/tmp/claude-1000/shots/008/`.
- [ ] The finish-screen buttons work by mouse, and `H` toggles the help line.
- [ ] The minimap shows the track, the car dot moving correctly (north-up, with the right handedness) and the next checkpoint.
- [ ] Dust appears on grass and not on road; the particle pool doesn't grow.
- [ ] Unit tests (node, no DOM needed for most):
  - formatters: time `m:ss.mmm` incl. 0, > 10 min and rounding; km/h; signed penalty
  - the "set only on change" helper (fake element objects)
  - minimap world → pixel mapping (north-up, aspect preserved, the car inside the map for every centreline point)
  - the best-time lookup per seed
  - dust pool reuse (capacity never exceeded, and dead particles recycled)
  - the partial `buildSession` failure cleanup, if it is testable without WebGL; otherwise explain why not.
- [ ] No noticeable frame-rate cost: report draw calls and frame time with and without the HUD and dust, from the debug panel or `renderer.info`.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Out of scope
The sensor debug overlay and `F1` (009), bots and AI (010), race rule changes, car physics, the track generator, and sound. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- `src/ui/format.ts`: `formatTime` (`m:ss.mmm`, minutes uncapped, ms rounding carries), `formatKmh`, `formatPenalty`.
- `src/ui/setOnChange.ts`: `onChange`, `textSetter`, `styleSetter`, `scaleXSetter` (write only when the value changed; scale rounded to 2 decimals).
- `src/ui/minimapMapping.ts`: pure world -> pixel mapping (north-up, uniform scale, centred, padding). `src/ui/Minimap.ts`: 440 px canvas (CSS 170-260 px), the track and start/finish line drawn once per layout into an offscreen canvas; per frame only the car dot + heading tick and the next checkpoint (accent), skipped when the car moved < 1 px, turned < 0.05 rad and the checkpoint is unchanged.
- `src/ui/styles.ts`: CSS string, injected once as `<style id="ar-hud-style">`, removed on dispose. Clean-arcade panels, mono tabular digits, sizes in `em` from `clamp(13px, 2vmin, 28px)` so the HUD scales between 720p and 1440p. System fonts only.
- `src/ui/Hud.ts`: owns all overlay DOM (loading screen, toast, countdown, penalty flash, race HUD, minimap, pause, finish screen with two buttons, help line). Screens are switched by `data-state` (the race state) on the root. `bind({race, layout, worldScale, seed, controller})` releases the previous binding first (`unbind`), subscribes to `stateChanged`, `countdownTick`, `reset`, `finished`, and syncs with the race's current state (it is already counting down when bound). `update(snapshot, nowMs)` is per frame: clock, bars (`scaleX`) and minimap every frame; speed/surface/lap/checkpoint at 20 Hz; all through change-only setters. Countdown/penalty animations use the Web Animations API (no forced reflow). Finish buttons: `mousedown` default prevented and `tabindex=-1`, so Enter/Space don't re-click them.
- `src/fx/DustPool.ts` (pure, typed arrays, ring/oldest recycling) and `src/fx/Dust.ts` (one `THREE.Points` with a small `ShaderMaterial`, per-particle age/colour attributes, soft fade, size attenuation; wheels positioned from heading/`wheelX`/axle config; emits for `grass`/`sand` wheels above 2 m/s, rate scales with speed up to 45/s/wheel; capacity 256; lifetime 0.6-1.0 s; only emits while `racing`; uses render `dt`). Owned and disposed by the session.
- `src/game/DisposeStack.ts` (+ test): cleanup stack used by `buildSession`; on failure everything built so far is freed (newest first), on success `release()` becomes `session.dispose`.
- `src/game/Game.ts`: plain-text hud removed; `Hud` created once; `ensureModels()` preloads every `TILE_CATALOG` model + the car model (34 total) behind the loading screen before the first session (retry on N if it fails); later rebuilds show a "Generating track…" toast; build failure logs, shows an error toast and leaves the game usable (N/Enter retries). `?debug=1` panel moved to the bottom-left above the controls (class `ar-debug`), now also shows draw calls and dust count. `window.__game` additionally exposes `hud`, `renderer`, `dust`.
- `src/game/gameKeys.ts`: `H` -> `toggleHelp` (test updated). `src/race/results.ts`: `bestTimeForSeed(seed, exclude?, list?)` (+ `results.test.ts`).
- Tests added: `format`, `setOnChange`, `minimapMapping` (north-up, aspect, centreline/checkpoints inside the map for 5 seeds, heading step direction), `bestTimeForSeed`, `DustPool` (capacity, recycling), `DisposeStack` (incl. a simulated partial build failure).

### Deviations
- `HudSnapshot` has no `bestTime` field: the Hud looks the best time up itself (`bestTimeForSeed`) on bind and when a race finishes. It needs the same lookup for "New best!", so one place owns it.
- "New best!" is shown only when a previous result exists on that seed and the new time beats it (the first finish on a seed gets no badge).
- Added `H` as a game key in `gameKeys.ts` (spec requires the key; the key table lives there) and a required `toggleHelp` handler, so the existing key test was updated.
- The partial-`buildSession` failure itself isn't unit-tested (needs WebGL/Rapier + models). The mechanism (`DisposeStack`, including a simulated failing async build) is tested. I could not provoke a real failure in the browser either (all models are cached after preload), so that path is verified by the unit test and code reading only.
- The first build failing after a successful preload shows the error toast; a failing preload keeps the loading screen up with the error text and "press N to retry".
- Debug panel text wraps (`pre-wrap`, max 40 em) and uses 10 px+ type to keep it clear of the centred finish/pause panels.

### Known limitations
- Dust particles are world-space puffs only; no ground-height lookup (y fixed at 0.04 m), fine on this flat track. Dust colour is not lit by the scene.
- `Hud` DOM behaviour (unbind/bind subscriptions, buttons) is verified in the browser, not in unit tests (no DOM test environment in the repo). `subscriptionCount` is exposed for that.
- The minimap hides while there's no session; the HUD panels are hidden during `generating`/`loading`.
- Screenshots: the browser tool returns images only inline; I copied them to `/tmp/claude-1000/shots/008/` (`1280-countdown`, `1280-racing-grass`, `1280-dust`, `1280-paused`, `1280-finish`, `1280-finish-newbest`, `2560-loading`, `2560-racing`; screenshots are 800 px wide downscales of the viewport). The final CSS tweak to the debug panel offset (scaled with the viewport) was not re-screenshotted at 2560.

### Performance (1280x720, dev server, seed 3, car driving on grass, 240 frames each, `gl.finish()` after every frame)
- Median render+step time: full HUD+dust 1.0-1.2 ms; no dust draw 1.2 ms; HUD hidden 1.1 ms; both off 1.2 ms. All within noise (p90 1.6-2.0 ms).
- Draw calls: 93 with dust, 92 without (dust is one extra draw call); the HUD adds none. Triangles 6174. Dust pool peaked at ~140 live of 256 and never grew; geometries/textures counts stayed flat (31/3) over 8 `N` rebuilds, with exactly 1 `.ar-hud`, 1 minimap canvas and 4 race subscriptions after each.

### Verified in the browser
- 1280x720 and 2560x1440: loading screen with progress bar, countdown 3/GO, race HUD (clock, best, checkpoint, lap, speed + surface label, accelerator/steering bars, controller name, help line, minimap with car and next checkpoint), pause overlay, finish screen, penalty flash text (`+2.0 s` after R). No overlaps in normal mode at either size; the `?debug=1` panel no longer overlaps (checked at 1280x720).
- Restart button by real mouse click, Enter, N, H (toggles the help line); repeated restarts leave one HUD, one `<style>` and 4 subscriptions. "New best!" badge shown via a synthetic finished event with a lower time. Dust on grass, none on the road (0 live puffs over 30 road frames at 20 m/s).
- Minimap: car dot outside the loop while on grass, on the start straight at the start; heading tick follows the driving direction (north-up, east right).
- The browser pane doesn't run rAF reliably; I drove frames via `__game.stepFrames` with short sleeps (dust uses wall-clock render `dt`).

### Checks
`npm run build`, `npm test` (25 files, 261 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass.

## Review (round 1)
Verdict: APPROVED

### Checks
- `npm run build`, `npm test` (25 files, 261 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.
- Scope: only `Game.ts`, `gameKeys(.test).ts`, `results.ts`, the task file and new `src/ui`, `src/fx`, `DisposeStack`, `results.test.ts` changed. No race-rule, physics, generator, `Models/`, PLAN/AGENTS or other task changes. No `http` strings, CDN or font requests in `src/ui` or `src/fx`; system fonts only.
- Deviations (best-time lookup in the HUD, no "New best!" on a first finish, `H` in `gameKeys`, DisposeStack-only test scope): justified and acceptable. A real `buildSession` failure can't be tested without WebGL/Rapier/models.
- HUD lifecycle (code read): `bind()` calls `unbind()` first and releases all four subscriptions; `rebuild` also unbinds before disposing the old session, and `Race.dispose()` clears its bus. `dispose()` removes the root DOM, minimap canvas, toast timer and the injected `<style>`. Finish buttons call the same actions as the keys; `mousedown` is prevented and `tabindex=-1` so Enter/Space can't double-fire; `rebuild` is guarded by `building`. `pointer-events` is auto only on `.ar-finish`, `.ar-btn` and the loading screen (intentional blocker); `#ui` stays none.
- DisposeStack / `buildSession`: each resource is registered right after creation and freed newest first (dust, chase, controller, view, car, track, race), once each; a failing cleanup doesn't stop the rest. After a failed rebuild the session is null, the HUD is unbound, an error toast shows, and N/Enter retry (`building` reset in `finally`). A failed preload keeps the loading screen with the error and N retries.
- Minimap: mapping is north-up (x right, z down), uniform scale, centred. Heading tick `(sin h, -cos h)` matches the `layout.ts` convention. The next checkpoint is `race.checkpointsPassed` (the per-lap `next` index into the same `layout.checkpoints`), so it is correct after a reset (unchanged) and on the last lap; past the last index nothing is drawn. Start/finish = last checkpoint.
- Dust: fixed-capacity typed arrays, ring recycling, one `THREE.Points`, geometry/material disposed with the session, render `dt`, wheel offsets/sides match `CarPhysics` (index 0 = front-left, +z forward). Emits only while racing.
- Performance: change-only DOM setters, slow fields at 20 Hz, bars via `scaleX`, no layout reads in the frame loop.
- Visual: I measured element rects in the browser with `?debug=1&seed=3` (own port, stopped afterwards). At 2560x1440 the debug panel (y 786-1095, x 12-828) clears the bottom-left controls (top 1166) and the top-left panel; at 1280x720 it is y 386-547 vs controls at 579 and top-left ending at 120. No overlaps at either size; the debug panel stays left of the centred finish/pause panels. Worker screenshots are readable (the 2560 one predates the debug offset fix, covered by my measurements).

### Blocking issues
None.

### Non-blocking
1. In `buildSession`, `cleanup.release()` runs inside the `Session` literal, before `race.events.on`, `applyReset` and `startCountdown`. If one of those threw, the catch's `disposeAll()` would find an empty stack and leak everything. Unlikely, but safer to call `release()` as the last step.
2. Small per-frame garbage: the `car` literal passed to `dust.update` in `Game.ts`, and the `j` closure per spawned particle in `Dust.emitFrom`. The pool itself doesn't allocate.
3. `Dust.update` sets `needsUpdate` on all three attributes every frame even when no particle is alive; skip when `aliveCount === 0`.
4. Hud DOM behaviour (rebind, buttons) is browser-verified only; acceptable as the repo has no DOM test environment.
