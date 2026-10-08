# 003 – Procedural track generator

Status: draft

## Goal
`generateTrack(seed, options) → TrackLayout`: a pure, deterministic, unit-tested function producing a valid closed-loop track from the tile catalog. See `PLAN.md` → Track generation.

## Requirements
- No three.js scene or Rapier imports (pure data + math). It may use the `TileDef` catalog and rotation helpers from 002.
- Options: `minPieces`, `maxPieces`, allowed tile ids, weights per tile kind, max attempts.
- Output `TrackLayout`:
  - `seed`, `pieces[]` in driving order: `{ tileId, cell, rotation, entryDir, exitDir, index }`
  - `occupancy`: cell → piece index lookup (multi-cell tiles fill all their cells)
  - `bounds` of the grid
  - `centreline`: dense polyline in world space (points + cumulative distance + tangent), closed
  - `checkpoints[]`: line segments across the road at piece boundaries (about every 3–5 pieces, configurable), the last one being start/finish
  - `startPose`: position + heading for the car on the start piece
  - `cellInfo(cell)`: piece kind and, for corners, turn direction **relative to driving direction**
- Exactly one start/finish piece, on a straight section.
- Must close the loop exactly, with no overlapping cells and no corner sequences that create 1-cell-wide U-turns the car can't drive. Clearance of at least one empty cell between non-adjacent track parts is preferred.
- If an attempt fails, retry with the next RNG state; throw a clear error after `maxAttempts`.
- Same seed + options ⇒ identical layout.

## Acceptance criteria
- [ ] Unit tests: determinism; for 500 random seeds every layout is closed, non-overlapping, connector-consistent (each exit matches the next entry), has one start piece and sensible length within options.
- [ ] Generation of a typical track takes under 50 ms.
- [ ] A small debug function renders a layout to ASCII (used in tests/logs) to aid review.

## Out of scope
Rendering, colliders, scenery placement.
