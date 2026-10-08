# 004 – Track builder: scene, colliders and surfaces

Status: done

## Goal
Turn a `TrackLayout` (003) into a rendered three.js track plus Rapier ground colliders, and give the rest of the game a way to ask which surface lies under any point, so that a car (005) can drive on it. See `PLAN.md` → Physics.

## Decisions (from the human, 2026-10-08)
- **No barriers or walls for now.** Don't place `barrierWall`/`fence*` props and don't create wall colliders. (Barriers may come back later as a separate task to make tracks more interesting.)
- **Out of bounds = falling only.** There is no perimeter fence: the grass margin around the track simply ends, and a car that drives off the edge falls. `isOutOfBounds(pos)` is true only when `pos.y` is below a threshold. It is not based on distance from the track.

## Requirements

### Surface lookup (pure, no three.js / Rapier)
- `src/track/surface.ts`: `surfaceAtGrid(layout, x, z, margin): SurfaceType | null` in **grid units** (same frame as `TrackLayout`).
  - Returns `'road'`, `'kerb'` or `'grass'` for points on the ground, and `null` for points with no ground under them (outside `bounds` expanded by `margin` cells).
  - It is computed analytically from the layout and the tile geometry (not by per-triangle material lookup). Use the measurements recorded in `src/assets/tiles.ts` (002):
    - Road is 0.69 wide, centred on the centreline: |lateral offset| ≤ 0.345 → `road`.
    - Kerb extends to 0.418 (0.082..0.918 within a cell): 0.345 < |offset| ≤ 0.418 → `kerb`.
    - Anything else on the ground → `grass`.
  - Straights (incl. `roadStartPositions`): the offset is the distance from the cell's centre line along the piece axis.
  - Corners of size n: the road is a quarter arc of radius n − 0.5 about the tile's SE corner in model space (transform it with the piece placement). The offset is `|distance to arc centre − (n − 0.5)|`. This is only valid inside the piece's own cells, so look up the piece with `layout.pieceAt(cell)` first. Reversed (left) corners use the same geometry as the base tile.
  - Empty cells inside the margin → `grass`.
  - Boundary convention: a point exactly on a cell edge may resolve to either neighbour. Document which one.
- Write the approach as a doc comment at the top of the file.

### Builder (`src/track/builder.ts`)
- `buildTrack(layout, scene, world, options?) → Promise<BuiltTrack>`. `options` includes `worldScale`, `margin` and `outOfBoundsY` (defaults from `GameConfig`), plus an injectable `loadModel` (defaults to `src/assets/loader.ts`), so tests can pass stub models.
- `BuiltTrack` (all public coordinates in **metres**, i.e. grid × `worldScale`):
  - `layout`, `worldScale`
  - `root: THREE.Group` holding everything the builder added to the scene
  - `surfaceAt(x, z): SurfaceType | null`: metres wrapper around `surfaceAtGrid`
  - `isOutOfBounds(pos: {x, y, z}): boolean`: `pos.y < outOfBoundsY` (default −5 m)
  - `colliderKind(handle: number): 'ground' | 'safetyFloor' | undefined`: a side map keyed by Rapier collider handle
  - `dispose()`: removes `root` from the scene and every collider and body it created from the world. It disposes only the geometries and materials that the builder itself created (debug lines, generated planes). It must **not** dispose geometry or materials shared through the `loadModel` cache.
- **Tile meshes**: one model per piece, positioned with `tileTransform(getTile(piece.tileId), piece.placement)` × `worldScale` and `rotation.y = rotationY`. Use the unreversed tile; reversed pieces render with the same model.
- **Grass**: fill every empty cell within `bounds` ± `margin` (default **3** cells) with `grass.glb`. The corner tiles' own grass mesh is partial (002 finding), so make sure there are no visible holes under or around bends. For example, also put grass under corner cells, slightly below y=0 to avoid z-fighting. Prefer `THREE.InstancedMesh` (or merged geometry) for grass to keep draw calls low. Report the draw-call count for a typical track in the notes.
- **Ground collider**: a single fixed cuboid covering the whole `bounds` ± `margin` rectangle, with its top face at y = 0. Avoid per-tile colliders: one box means no seams for wheel raycasts. Its kind is `'ground'`. The surface type is given by `surfaceAt`, not by the collider.
- **Safety floor**: a large fixed cuboid well below the track (e.g. top at −30 m, extending 100 m beyond the ground on every side) so a falling body never falls forever. Its kind is `'safetyFloor'`.
- **Lighting and sky**: hemisphere light + directional light with shadows enabled, with the shadow camera fitted to the track extent (so the car's shadow works in 005), a sky-coloured background and optional light fog. These are added under `root`, so `dispose()` removes them too.

### Config
- Add to `GameConfig`/`DEFAULT_CONFIG`: `trackMargin` (cells, default 3) and `outOfBoundsY` (metres, default −5). URL overrides aren't needed.

### Debug view `?view=track&seed=N`
- Wire it like `?view=tiles` (dynamic import in `src/main.ts`; the default page stays untouched).
- `RAPIER.init()`, generate a layout with `generateTrack(seed)`, build it, and use `OrbitControls` framing the whole track.
- Debug overlays (in grid → metre space, slightly above the road): the centreline as a yellow line, checkpoints as magenta segments with the start/finish line in a distinct colour, and an arrow at `startPose`.
- Key `S` toggles a **surface overlay**: a dense grid of small points (e.g. every 0.1 cell) coloured by `surfaceAt` (road / kerb / grass / null). This is the visual proof that `surfaceAt` matches the painted road.
- Keys `N` / `P` go to the next / previous seed by calling `dispose()` then `buildTrack()`, and update the URL with `history.replaceState`.
- A small text panel shows the seed, piece count, `renderer.info.render.calls`, `renderer.info.memory.geometries`, and `world.colliders.len()` / `world.bodies.len()`, so leaks are visible by eye.

## Acceptance criteria
- [ ] `?view=track&seed=N` renders the generated track; changing the seed changes the track; the same seed gives the same track. No console errors.
- [ ] The debug overlay shows the centreline following the painted road, and checkpoints spanning the road. The surface overlay matches the painted road, kerbs and grass on straights and on all three corner sizes, both left and right (verified by screenshots; describe what you checked in the notes).
- [ ] Unit tests for `surfaceAtGrid` with hand-computed points on straight, start and corner tiles (small/large/larger, left and right, several rotations): road centre, just inside/outside the road edge, kerb, grass beyond the kerb, the inside of a bend, an empty cell inside the margin (grass), and outside the margin (`null`).
- [ ] Property test: for 50 seeds, every `layout.centreline` point is `road`, and every checkpoint end point `a`/`b` is not `road`.
- [ ] Leak test (vitest, real Rapier via `@dimforge/rapier3d-compat`, stub `loadModel`): build + dispose 20 different seeds on one scene and world. After each dispose, `scene.children.length`, `world.colliders.len()` and `world.bodies.len()` are back to their starting values. Also verify manually in the debug view (press `N` 20 times, counts stay flat) and report the numbers.
- [ ] `isOutOfBounds` tests: above/below the threshold.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Technical notes
- Frame and conventions: read the header comments of `src/assets/tiles.ts` and `src/track/layout.ts`. Grid x/z multiplied by `worldScale` gives metres in three.js world x/z (N = −z). Use `pieceDef`, `tileTransform`, `getTile`, `layout.pieceAt`, `layout.bounds`, and don't re-derive rotation by hand. If you find a bug in a 002/003 helper, a minimal fix is allowed; record it as a deviation and cover it with a test.
- The loader (`src/assets/loader.ts`) returns clones that share geometry and materials. Hence the rule above: don't dispose them in `dispose()`.
- `@dimforge/rapier3d-compat` embeds its WASM, so `await RAPIER.init()` works in vitest under Node.
- 005 will call `surfaceAt` once per wheel per physics step, so keep it O(1): a map lookup plus a little math, no allocation in the hot path if practical.
- Visual verification: use the browser preview and take screenshots (top-down and close-up of each corner size). Store them outside the repo and list what you checked.

## Out of scope
Car, race logic, obstacles, barriers/walls/fences, scenery props (trees, stands), sand tiles. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

### Summary
- `src/track/surface.ts`: `surfaceAtGrid(layout, x, z, margin)`, analytic as specified (straight: offset to the cell centre line along the piece axis; corner: `|dist to arc centre - (n-0.5)|`, arc centre = SE corner of the unrotated footprint turned CCW with the piece rotation). A per-layout lookup table (typed arrays: cell -> piece, axis, arc centre/radius) is built once and cached in a `WeakMap`, so the hot path has no allocation and no string keys. Boundary convention (documented in the file header): `Math.floor`, so a point exactly on a cell edge belongs to the east/south cell; offsets exactly at 0.345 / 0.418 resolve to the inner surface. NaN gives `null`.
- `src/track/builder.ts`: `buildTrack(layout, scene, world, options?)` and `BuiltTrack` as specified. One model per piece (unreversed tile, `tileTransform` x `worldScale`); grass is one `THREE.InstancedMesh` per mesh of `grass.glb` (one) covering every empty cell in bounds +/- margin, plus an underlay cell below every corner footprint cell at y = -0.02 m; one fixed `ground` cuboid (top at y = 0, bounds +/- margin) and one fixed `safetyFloor` cuboid (top at -30 m, 100 m beyond the ground on every side), both parentless colliders; hemisphere + directional light (4096 shadow map, ortho shadow camera fitted to the track radius), sky background and light fog. `dispose()` is idempotent: removes `root`, removes colliders/bodies, disposes lights and the `InstancedMesh` (instance buffer only), restores the scene's previous `background`/`fog`. It never disposes loader geometry/materials. All models are loaded before anything is added to the scene/world, so a load failure leaves nothing behind.
- `src/debug/trackView.ts` + hook in `src/main.ts` (`?view=track&seed=N`, dynamic import): orbit camera framing the track, yellow centreline, magenta checkpoints (start/finish white), green arrow at `startPose`, `S` surface overlay (points every 0.1 cell: road cyan, kerb orange, grass green, no ground red; rendered over bounds +/- (margin+1) cells), `N`/`P` seed change with `history.replaceState`, text panel with seed, pieces, draw calls, geometries, colliders, bodies, scene children. Extra params for verification: `cam=close&focus=<pieceIndex>`, `surface=1`; `window.__trackView` exposes `next/prev/toggleSurface/stats` for scripted checks.
- `src/core/config.ts`: `trackMargin` (3) and `outOfBoundsY` (-5).
- Tests: `src/track/surface.test.ts` (34 tests: straights N/S and E/W, start piece rotated, empty cell inside margin, outside margin, NaN, edge convention; all three corner sizes x left/right x 4 rotations with hand-computed arc centres: road centre, +/-0.3 road, +/-0.38 kerb, +/-0.45 grass, inside of the bend, arc ends; a hand-built closed loop; a sweep over 60 seeds checking road/kerb/grass offsets perpendicular to the centreline of every piece and that every tile/rotation/turn combination was covered; the property test over 50 seeds: every centreline point is `road`, every checkpoint end point `a`/`b` is not `road`), `src/track/builder.test.ts` (leak test with real Rapier and a stub `loadModel`: 20 seeds on one scene/world, scene children / colliders / bodies back to the starting values after each dispose, shared geometry/material never disposed, background/fog restored; collider kinds and ray casts against the ground/safety floor; metre `surfaceAt`; `isOutOfBounds` above/at/below the threshold and default).

Files: `src/track/{surface,surface.test,builder,builder.test}.ts`, `src/debug/trackView.ts`, `src/main.ts`, `src/core/config.ts`.

### Deviations
- None to the spec's behaviour. Small choices: the ground and safety floor are parentless fixed colliders (no rigid bodies), so `bodies` stays 0 (the builder still removes any bodies it would create); the grass underlay is applied under all corner footprint cells (not only the road cells), which is simply the cheapest way to avoid holes; `dispose()` also restores `scene.background`/`scene.fog` because the builder sets them on the scene (the spec says only `root`).
- No 002/003 helper needed a fix.

### Known limitations
- Tile models are not merged: each piece is its own clone with one mesh per material. Draw calls: for seed 3 (25 pieces) the pane reports 86 calls with the whole track in view and all debug overlays visible (about 10 of those are overlay lines/points/arrow, grass is a single instanced call, the rest are the tile meshes at roughly 3 per tile); seeds 5 and 8 gave 67 to 100 depending on the overlay. Close-ups drop to 13 to 22. The sun casts no shadows yet (nothing has `castShadow`; the shadow camera is set up for the car in 005); tile meshes receive shadows.
- Faint thin lines are visible in the grass at the border of corner footprints (the corner tile's own grass mesh next to the filler/underlay grass); cosmetic.
- The surface overlay is a point cloud, so at close zoom it is sparse (0.1 cell spacing); it is dense enough to see which band each dot falls in.
- `geometries` in the panel counts geometries uploaded to the GPU, i.e. cached model geometries (grow to a ceiling as new tile types get used) plus the debug overlay lines; it is flat across identical seeds, see the numbers below.

### Check results
- `npm run build`, `npm test` (98 passed, 7 files), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all clean.
- Leak check in the debug view (browser pane, real renderer/Rapier): pressed `N` 20 times then `P` 20 times, repeated for 3 cycles (60 seeds forward and back, ending on seed 3 every time). After each cycle: geometries 30, textures 3, colliders 2, bodies 0, scene children 3 (root, debug overlay, surface overlay), draw calls 87: identical every cycle. The URL follows the seed (`history.replaceState`). No console errors (only the Vite connect messages).
- Screenshots (headless Chrome with SwiftShader, plus the browser pane), stored in `/tmp/claude-1000/shots/004/`: `top_seed_3.png`, `top_seed_3_surface_1.png`, `top8_surf.png`, `top5_surf.png` (whole track), and `close3_p{0,1,2,3,4,6}_{paint,surf}.png`, `close8_p11_{paint,surf}.png` (close-ups, `paint` without and `surf` with the surface overlay). Pieces shown: seed 3 piece 0 (start straight), 1 (larger right), 2 (large right), 3 (large left), 4 (small right), 6 (larger left); seed 8 piece 11 (small left). What I checked: the yellow centreline runs along the middle of the painted road in all of them; checkpoint segments span the road with the white finish line at the start piece and the green arrow on the start pose pointing along the road; the surface dots are blue on the asphalt, orange along the white kerb bands (on both sides, inside and outside of every bend) and green on the grass; red dots only appear outside the margin ring (the ground edge); no holes in the grass under or around bends, and the same seed gives the same track.
- The surface-overlay verification of the small and large corner sizes at the rendered level is by close-up screenshots as listed; the numerical check for all 12 size/turn/rotation combinations is in the unit tests.

## Review (round 1)
Verdict: APPROVED

### Checks run
- `npm run build`, `npm test` (98 passed), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass. `git status`: `Models/`, `PLAN.md`, other task files untouched; changes limited to `src/core/config.ts`, `src/main.ts`, `src/track/{surface,builder}(+tests).ts`, `src/debug/trackView.ts`, this task file.
- Independent `surfaceAtGrid` verification (script in /tmp/claude-1000/review004, not in repo): parsed the real GLBs (triangle positions, material colour: dark = road, white = kerb, green = grass), transformed with `tileTransform` x placement rotation, picked the top-most triangle at random points over every piece's footprint for seeds 1..60, and compared with `surfaceAtGrid`. Covered all 36 tile x rotation x reversed combinations seen (straight, straightLong, start, small/large/larger corners, left and right, 4 rotations). Points within 0.01 of a material boundary were skipped (172k skipped, 393,199 compared). Mismatches: 543, all on `roadStartPositions`, all "got road, GLB says white": the white painted grid boxes/lines on the asphalt, not kerb. Straights and corners (all sizes, both turns, all rotations): 0 mismatches.
- `dispose()`: removes root, both colliders, bodies (none), disposes the lights and the InstancedMesh instance buffer only, restores background/fog, idempotent via a flag. Shared loader geometry/materials are not touched (the test asserts this). The leak test checks scene children / `colliders.len()` / `bodies.len()` after each of 20 disposes with real Rapier, so forgetting a collider or the root would fail it.
- Units/frames: public API in metres (`x / S` into `surfaceAtGrid`), ground box top at y = 0 (centre -0.5, half 0.5), extent = bounds +/- margin cells, safety floor top -30 m, +100 m each side. `isOutOfBounds` is `pos.y < outOfBoundsY` only, as decided. No barriers/walls.
- Performance: `surfaceAtGrid` is O(1): typed-array lookup cached in a WeakMap, no allocation in the hot path.
- Browser: ran `npm run dev`, loaded `?view=track&seed=11&surface=1`: track renders, surface overlay matches the road (blue road, orange kerb edges, green grass, red only outside the ground edge), panel shows counts, no console errors. Worker's screenshots in /tmp/claude-1000/shots/004/ are consistent.

### Issues
- Blocking: none.
- Non-blocking: (1) `surfaceAtGrid` reports `road` on the start piece's white painted markings (correct for driving). (2) Corner size is derived from `Math.sqrt(piece.cells.length)`; fine for the current catalog but would break for a non-square corner; `getTile(...).footprint` would be sturdier. (3) Nothing sets `castShadow` yet (documented, for 005). (4) Draw calls 80-100 with overlays; tile meshes not merged (documented, acceptable).
