# 002 – Asset loading and tile catalog

Status: done

## Goal
Load GLB models reliably and describe each track tile as data (footprint, connectors, surfaces). The generator and builder depend on this. See `PLAN.md` → Assets.

## Requirements
- `src/assets/loader.ts`: cached `loadModel(name)` using `GLTFLoader`. Returns a cloneable `THREE.Object3D` with the **root-node offset `(-0.35, -0.01, -0.65)` cancelled**, so a tile's footprint corner sits at its local origin. Apply `WORLD_SCALE` from config (default 4) consistently.
- Preload helper for a list of model names with progress callback (for a loading screen later).
- `src/assets/tiles.ts`: a `TileDef` catalog for at least: `roadStraight`, `roadStraightLong`, `roadCornerSmall`, `roadCornerLarge`, `roadCornerLarger`, `roadStartPositions` (start/finish), plus `grass` as filler. Each `TileDef` has:
  - `id`, `model`, `footprint` (w×d in cells)
  - `connectors`: entry/exit cell + edge direction in the tile's unrotated frame
  - `kind`: `straight | corner | start_finish | filler`
  - for corners, the turn direction when travelling entry→exit (`left`/`right`)
  - `centreline(t)`: a local-space parametric path from entry to exit (line or arc) used later for progress/sensors
- Helpers to rotate a TileDef by 0/90/180/270° (footprint, connectors, centreline) and to compute world transforms from `{cell, rotation}`.
- **Determine connector edges by inspecting the actual meshes.** Tile bounds are known (`x∈[0,w]`, `z∈[-d,0]`) but which edges the road enters/exits isn't. Verify visually.
- `src/assets/surfaces.ts`: `SurfaceType = 'road' | 'kerb' | 'grass' | 'sand' | 'wall'` and a map from GLB material names (`road`, `grey`, `grass`, `_defaultMat`, …) to SurfaceType. Document any material whose meaning is unclear.
- Debug page `?view=tiles`: lays out every catalogued tile on a grid with labels, orbit controls, and arrows showing entry/exit connectors and the centreline. This is how the reviewer and human will verify the catalog.
- **Missing models return 404** (follow-up from 001 review): in `vite.config.ts`'s `serveModels` plugin, any request under `/models/` that doesn't resolve to a file in `Models/` (missing file, traversal attempt, bad encoding) must end with HTTP 404 instead of falling through to the `index.html` fallback. This applies to `npm run dev` and `npm run preview` (the plugin currently only hooks `configureServer`; add `configurePreviewServer` too). `loadModel()` must reject with a clear error naming the model when the fetch fails, rather than a GLTF parse error.
- `WORLD_SCALE`: add `worldScale: number` (default 4) to `GameConfig` in `src/core/config.ts`. A URL override isn't required.
- Remove the non-existent `tools` entry from `tsconfig.json`'s `include` (001 review nit).

## Acceptance criteria
- [ ] `?view=tiles` shows all catalogued tiles snapped to a visible grid, with connector arrows and centrelines that line up with the painted road.
- [ ] Unit tests: rotation of footprints/connectors, connector matching between e.g. a straight and a corner.
- [ ] Two tiles placed edge-to-edge via the helpers line up with no gap or overlap in the viewer.
- [ ] `curl -i /models/doesNotExist.glb` returns 404 on both dev and preview; `/models/roadStraight.glb` still returns 200 with identical bytes.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` pass. The default page (no `?view=`) still shows the 001 falling-cube demo.

## Technical notes
Models are Kenney Racing Kit. `roadStart.glb` contains the overhead start gantry (taller bounding box); `roadStartPositions.glb` is the grid-marked start straight. Use whichever reads best as start/finish and record the choice.

- **Inspect meshes programmatically, then confirm visually.** Parse the GLBs in Node (e.g. a throwaway script with `@gltf-transform/core` or three's `GLTFLoader.parse` on the file buffer, outside `src/`) to get per-material vertex bounds: the `road` material's extents on each tile edge show where the road enters/exits. Then screenshot `?view=tiles` from above in headless Chromium (preinstalled; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; use `--use-gl=swiftshader --enable-unsafe-swiftshader`) and check that arrows and centrelines sit on the painted road. Record findings (e.g. corner arc radius and centre per corner tile) in the Implementation Notes.
- Direction convention: use grid directions `N | E | S | W` with N = −z, E = +x (three.js default view from above). Rotation is counter-clockwise about +y in 90° steps. Write this convention as a doc comment in `tiles.ts`.
- Keep the catalog, rotation and connector-matching code free of three.js where practical (plain `{x, z}` math) so it is unit-testable and usable by the pure-data generator in 003. Only `loader.ts` and the debug view need three.js.
- `OrbitControls` comes from `three/examples/jsm/controls/OrbitControls.js`; no new runtime deps should be needed. Labels can be CSS2D or simple sprites.
- Throwaway inspection/screenshot scripts must not be added to the repo.

## Out of scope
Track generation, physics colliders.

## Implementation Notes

### Summary
- `src/assets/loader.ts`: `loadModel(name, worldScale = config default 4)` fetches `/models/<name>.glb` (explicit HTTP check, so a missing model rejects with `Failed to load model "<name>" ... HTTP 404`, invalid data rejects with `Model "<name>" ... is not a valid GLB`), parses with `GLTFLoader.parseAsync`, caches the parsed model per name (failures are not cached) and returns a fresh clone per call. The root offset `(-0.35,-0.01,-0.65)` is cancelled (`ROOT_OFFSET`), so the model's SW corner is the origin, road surface at y=0. Uniform scale = `worldScale`. `preloadModels(names, onProgress(done,total,name))`.
- `src/assets/tiles.ts` (no three.js): `Dir`, `Rotation`, `TileDef`, `TILE_CATALOG` (roadStraight, roadStraightLong, roadCornerSmall, roadCornerLarge, roadCornerLarger, roadStartPositions, grass), `rotateTile`, `reverseTile`, `placedConnectors`, `placedCells`, `placedCentreline`, `connectorsMatch`, `placementToJoin` (finds the placement/rotation that joins a tile to a previous exit), `tileTransform` (model position + rotationY for `{cell, rotation}`). Conventions are in the file header comment.
- `src/assets/surfaces.ts`: `SurfaceType`, `MATERIAL_SURFACES`, `surfaceForMaterial` (unclear materials documented in the comment).
- `src/debug/tilesView.ts` + hook in `src/main.ts` (dynamic import, so the default page is untouched): `?view=tiles` (optional `cam=top|close|iso`). Shows the catalog, rotated corner copies, and a chain of tiles joined via `placementToJoin` (throws if connectors don't match). Magenta = footprint, green arrow = entry, red = exit, yellow = centreline.
- `vite.config.ts`: `/models/*` now 404s for missing files, traversal, bad encoding, directories; hooked in `configureServer` and `configurePreviewServer`. `config.ts`: `worldScale` (default 4). `tsconfig.json`: removed `tools`.
- Tests: `src/assets/tiles.test.ts` (rotation, connectors, matching, join for all tile/rotation/reversal pairs incl. no cell overlap and centreline continuity, tileTransform, surfaces).

Files: `src/assets/{loader,tiles,tiles.test,surfaces}.ts`, `src/debug/tilesView.ts`, `src/main.ts`, `src/core/config.ts`, `vite.config.ts`, `tsconfig.json`.

### Mesh-inspection findings
Parsed with `@gltf-transform/core` in `/tmp/inspect` (not in the repo). Per-material bounds are useless (each material's bbox covers the tile) so I used the vertices actually referenced by each primitive's indices, and looked at which edge vertices exist.
- Meshes (after cancelling the offset) span x in [0,w], z in [-d,0]; road at y=0.01, kerb top y=0.02, grass y=0.
- Road is 0.69 wide, centred in the cell (x 0.155..0.845); kerb (`grey`) covers 0.082..0.918; grass fills the cell.
- Straights (`roadStraight`, `Long`, `StartPositions`): road touches the z=0 (S) and z=-d (N) edges only.
- Corners: road touches the S edge (z=0) in the SW cell and the E edge (x=w) in the NE cell (z=-(w-0.5)). It is a quarter arc about the tile's SE corner (w,0 in model space) with radius n-0.5: 0.5 (Small), 1.5 (Large), 2.5 (Larger). Travelling S->E-edge means heading north then east = right turn. A left turn is the same tile travelled in reverse (`reverseTile`).
- `roadCornerLarger` uses `_defaultMat` (white) for the kerb in place of `grey`.
- Corner tiles' grass mesh is only a partial ground plane (the area on the inside/outside of the bend is not covered), so `grass` filler tiles (or a ground plane) are needed under the bends.
- Materials across all models: see `surfaces.ts` (`white`, `red`, `_defaultMat` are the unclear ones).
- Start/finish choice: `roadStartPositions` (keeps the 1x2 footprint, painted grid slots, nothing tall). `roadStart` has the gantry and a bbox that leaves the tile.
- Visual verification: screenshots in `/home/claude/shots/002/` show centrelines/arrows on the painted road for all tiles and four rotations, and the chain has no gaps/overlaps.

### Deviations
- Corner connectors are modelled unrotated as "entry S edge, exit E edge, right turn". Left corners are `reverseTile(def)` (same model, `id` suffixed `~rev`, `reversed: true`) rather than separate catalog entries; the spec only asked for `left`/`right` on the def.
- `TileDef.connectors` and `centreline` are `null` for the `grass` filler.
- Cells are tile-local "NW frame" (origin at the north-west corner of the footprint, z down) rather than the mesh's SW-origin frame; `tileTransform` bridges the two. A placement's `cell` is the NW corner cell of the *rotated* footprint. Documented in `tiles.ts`.
- `tileTransform` requires an unrotated def (throws otherwise) because rotation is expressed in the `Placement`.
- Extra helpers beyond the spec: `placementToJoin`, `placedCells`, `placedCentreline`, `reverseTile`, `TileDef.length/quarterTurns/reversed`.
- Debug page extras: `cam=` query param; a rotated-corners row and a joined chain.

### Known limitations
- `loadModel` returns clones that share geometry/materials (fine for static tiles; clone materials before per-instance tweaks).
- The debug view uses fixed default `worldScale`; no URL override.
- Surface mapping is per material name only; no per-triangle meaning (e.g. kerb vs road for `_defaultMat` outside corner tiles).
- Only the required tiles are catalogued (no sand/wall/border/bridge variants, pit lane, `roadStart` gantry).
- Overview camera is hard-coded to fit the current layout.

## Review (round 1)
Verdict: APPROVED

Checks run
- `npm run build`, `npm test` (33 passed), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all clean.
- dev and preview servers (both curled, then killed): `/models/doesNotExist.glb`, `/models/`, `/models/../package.json`, `%2e%2e/`, `..%2f`, `%2e%2e%2f%2e%2e%2fetc/passwd`, `..%5c`, `%ZZ`, `%00`, `//etc/passwd`, subdirectory: all 404 `text/plain` 9 bytes ("Not found"), no file contents leaked. `/models/roadStraight.glb` returns 200 `model/gltf-binary` and is `cmp`-identical to `Models/roadStraight.glb`. `/` still returns the app.
- Independent geometry check (throwaway scripts in `/tmp/review002`, own GLB parser, not using the worker's code or findings): for every road tile x {as-is, reversed} x {0,90,180,270}, placed at a non-origin cell, I transformed the actual `road`-material triangles with `tileTransform` (my own three.js `rotation.y` maths: x' = x cos + z sin, z' = -x sin + z cos) and checked that
  - the mesh bounding box equals the `placedCells` bbox (catches NW/SW frame and rotation off-by-ones, incl. 1x2 and 3x3),
  - 41 `placedCentreline` samples all lie inside road triangles,
  - the centreline endpoints coincide exactly with the midpoints of the connector edges, and those lie on road,
  - road touches the footprint perimeter on exactly the two connector edges and no others,
  - turn sign recomputed from entry/exit headings matches `turn` (right for base, left for `~rev`).
  All pass (0 failures). Sanity check: flipping the rotation sign in my script produced 144 failures, so the check is sensitive.
- Join check: for all catalog tiles (plus reversed corners) x 4 rotations x all successors (324 pairs), `placementToJoin` returns a placement where `connectorsMatch` holds, centrelines meet exactly, and no cells overlap. 0 failures.
- Screenshots in `/home/claude/shots/002-review/` (`top.png`, `close.png`, `iso.png`, `default.png`/`default2.png`): arrows and yellow centrelines sit on the painted road for all tiles, the @90 corners, the reversed (left) corners and the joined chain; no gaps or overlaps at the joins. No console errors. The default page still shows the falling cube.
- `loadModel` for a missing model: code path reads `Failed to load model "<name>" (/models/<name>.glb): HTTP 404` (explicit `res.ok` check before parsing, failures not cached). Not covered by an automated test (see non-blocking 1).
- Deviations (reverse-tile approach for left turns, null connectors for grass, NW-frame cells, extra helpers) are justified and, per my geometry check, correct. The reverse-tile approach is sound for 003: a `~rev` def is rotated and placed with the same `tileTransform` as its base model.

Issues
Blocking: none.

Non-blocking
1. No automated test for `loadModel`'s rejection (named error on 404 / invalid GLB) or for the `/models/` 404 middleware. Verified by code reading and curl only. A small vitest with a stubbed `fetch` would lock this in.
2. `/models/roadStraight.glb/` (trailing slash) is served with 200 because `path.resolve` strips the slash. Harmless, no traversal.
3. `tileTransform` throws for a rotated def and `placementToJoin` returns the first matching rotation without checking footprint shape; fine now, but 003 should always pass catalog (or `reverseTile` of catalog) defs and use `placedConnectors`/`placedCells` rather than rotating by hand.
4. In `?view=tiles` the labels for `roadStraightLong` and `roadCornerSmall~rev` overlap in the chain (cosmetic).
5. Build warns about a >500 kB main chunk (three + Rapier); pre-existing, not from this task.
