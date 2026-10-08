# 004 – Track builder: scene, colliders and surfaces

Status: draft

## Goal
Turn a `TrackLayout` into a rendered three.js track and Rapier colliders tagged with surface types, so a car can drive on it. See `PLAN.md` → Physics.

## Requirements
- `buildTrack(layout, scene, world) → BuiltTrack` and `BuiltTrack.dispose()` (removes meshes/colliders so a new track can be generated without reloading).
- Place tile models per piece. Fill a margin of grass tiles around the track bounds.
- Ground colliders: flat colliders per tile (cuboid is fine for flat tiles) **plus** a way to know the surface under any world point: `surfaceAt(x, z): SurfaceType`. Recommended: derive from the layout + tile geometry (road width/kerb width in tile-local coords) rather than per-triangle material lookup. Document the approach.
- Barriers: place `barrierWall`/`fence*` props along the outside edge of corners (and optionally all track edges) with simple cuboid colliders tagged `wall`.
- A large invisible ground plane well below the track as a safety floor, and a `isOutOfBounds(pos)` helper.
- Rapier colliders store their surface type in `userData` or a side map keyed by collider handle.
- Lighting and sky that make the track readable (hemisphere + directional light with shadows on the car later).
- `?view=track&seed=N`: free orbit camera over a generated track, showing checkpoints and centreline as debug lines.

## Acceptance criteria
- [ ] `?view=track&seed=N` renders the generated track; changing the seed changes the track; same seed gives the same track.
- [ ] Debug overlay shows the centreline following the painted road and checkpoints spanning the road.
- [ ] Unit tests for `surfaceAt` on representative points of straight and corner tiles.
- [ ] Generating 20 tracks in a row via dispose/build doesn't leak meshes or colliders (counts stay flat).

## Out of scope
Car, race logic, obstacles.
