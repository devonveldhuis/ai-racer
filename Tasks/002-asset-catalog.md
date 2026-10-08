# 002 – Asset loading and tile catalog

Status: draft

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

## Acceptance criteria
- [ ] `?view=tiles` shows all catalogued tiles snapped to a visible grid, with connector arrows and centrelines that line up with the painted road.
- [ ] Unit tests: rotation of footprints/connectors, connector matching between e.g. a straight and a corner.
- [ ] Two tiles placed edge-to-edge via the helpers line up with no gap or overlap in the viewer.

## Technical notes
Models are Kenney Racing Kit. `roadStart.glb` contains the overhead start gantry (taller bounding box); `roadStartPositions.glb` is the grid-marked start straight. Use whichever reads best as start/finish and record the choice.

## Out of scope
Track generation, physics colliders.
