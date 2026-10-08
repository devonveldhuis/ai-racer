# 003 – Procedural track generator

Status: done

## Goal
`generateTrack(seed, options) → TrackLayout`: a pure, deterministic, unit-tested function producing a valid closed-loop track from the tile catalog. See `PLAN.md` → Track generation.

## Requirements
- No three.js scene or Rapier imports (pure data + math). It uses the `TileDef` catalog and helpers from 002 (`src/assets/tiles.ts`).
- Options (`TrackOptions`, all optional, with exported `DEFAULT_TRACK_OPTIONS`):
  - `minPieces` (default 16), `maxPieces` (default 40), counted in pieces, not cells
  - `allowedTiles`: tile ids (default: all road tiles in the catalog)
  - `kindWeights` / per-tile weights to bias the mix of straights vs. corner sizes
  - `checkpointEvery`: pieces between checkpoints (default 4)
  - `clearance`: minimum empty cells between non-consecutive pieces (default 1, see below)
  - `maxAttempts` (default 200)
- Output `TrackLayout`:
  - `seed`, `options` (resolved)
  - `pieces[]` in driving order: `{ index, tileId, placement /* {cell, rotation} */, reversed, entryDir, exitDir, cells }`. `tileId` is the base catalog id (e.g. `roadCornerLarge`), with `reversed: true` for left-turning corners so the builder (004) can load the model and call `tileTransform` with the unreversed def.
  - `occupancy`: cell → piece index lookup (multi-cell tiles fill all their cells), e.g. `Map<string, number>` keyed `"x,z"` plus a `pieceAt(cell)` helper
  - `bounds` of the occupied grid (min/max cell)
  - `centreline`: dense closed polyline: `points`, cumulative `distance`, unit `tangent`, and the `pieceIndex` per point, plus `totalLength`. Built from `placedCentreline`.
  - `checkpoints[]`: segments across the road at piece boundaries, every `checkpointEvery` pieces, each `{ index, pieceIndex, a, b, position, normal /* driving direction */ }`. The segment spans the full cell width across the road. The **last checkpoint is the start/finish line**, at the start piece's start line.
  - `startPose`: `{ position, heading }` on the start piece's centreline facing the driving direction, placed on the painted grid slots (worker's choice of slot; record it)
  - `cellInfo(cell)`: `{ pieceIndex, kind, turn }` where `turn` is `'left' | 'right' | null` **relative to the driving direction**, or `null` for empty cells
- **Units and frame:** everything is in grid units (1 = one cell), in the same x/z frame and `Dir` convention as `tiles.ts`. The builder multiplies by `worldScale`. Headings are radians, using a convention written as a doc comment and consistent with `DIR_VECTORS`.
- Exactly one start/finish piece (`roadStartPositions`). It is a straight, and the piece directly before it must also be a straight, so the car doesn't cross the line coming out of a corner.
- Must close the loop exactly: the last piece's exit connector matches the first piece's entry (`connectorsMatch`), with no overlapping cells.
- **Clearance (hard rule):** with `clearance: 1`, no cell of a piece may be 4-adjacent (share an edge) with a cell of any piece that is not its immediate predecessor or successor in the loop. This rules out back-to-back U-turns where the road runs alongside itself, and it keeps a grass gap between parallel sections.
- If an attempt fails, retry with the next RNG state; throw a clear error after `maxAttempts`, naming the seed and options.
- Same seed + options ⇒ identical layout (deep-equal). Use `src/core/rng.ts`.
- `trackToAscii(layout)`: renders a layout to ASCII (one character per cell, distinct marks for straights, corners, start, and the driving direction where practical). Used in tests/logs and the Implementation Notes.

## Acceptance criteria
- [ ] Unit tests: determinism; for 500 seeds (with default options) every layout is closed, non-overlapping, connector-consistent (each exit matches the next entry, including the wrap-around), satisfies the clearance rule, has exactly one start piece preceded by a straight, and has a piece count within `[minPieces, maxPieces]`.
- [ ] Tests for `centreline` (closed, monotonic distance, unit tangents, continuous across pieces with no jumps > a small epsilon), `checkpoints` (ordered, last one at start/finish, each crosses the centreline), `cellInfo` (left/right relative to driving direction on a hand-checked layout), and `startPose` (on the start piece, facing the driving direction).
- [ ] Generation of a typical track takes under 50 ms (median over the test seeds; report median and max in the Implementation Notes). Generation never fails for any of the 500 test seeds with default options.
- [ ] Implementation Notes include ASCII renders of at least 3 seeds, the corner-size mix, and the piece-count spread across the 500 seeds.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Technical notes
- Code lives in `src/track/` (e.g. `generator.ts`, `layout.ts` for types, `ascii.ts`, tests alongside).
- **Use the 002 helpers rather than hand-rolled rotation** (002 review note): chain pieces with `placementToJoin(prevExit, def)` where `def` is a catalog tile or `reverseTile(catalogTile)`, and use `placedConnectors` / `placedCells` / `placedCentreline`. Don't pass an already-rotated def to `tileTransform`. If a helper is missing or wrong, a minimal fix in `tiles.ts` is allowed but must be recorded as a deviation and covered by tests.
- Suggested approach (worker's choice): random walk with backtracking that must return to the start connector, or start from a rectangle loop and apply random local perturbations (bump outs, swapping long straights for corner pairs), validating occupancy + clearance after each change. Pick whatever reliably closes within the time budget; describe the algorithm in the notes.
- Corner radii are 0.5 / 1.5 / 2.5 cells (Small/Large/Larger). The generator should produce a mix, not mostly small corners.
- Keep it fully deterministic: no `Math.random`, no iteration over unordered structures whose order could change.

## Out of scope
Rendering, colliders, scenery and barrier placement, a 3D debug view (004 will build the track in the scene). Don't change `Models/`, AGENTS.md, PLAN.md or other task files.

## Implementation Notes

### Summary
`generateTrack(seed, options) -> TrackLayout` in `src/track/`, pure data and math (imports only `src/assets/tiles.ts` and `src/core/rng.ts`). It chains pieces exclusively with the 002 helpers (`placementToJoin`, `reverseTile`, `placedCells`, `placedConnectors`, `placedCentreline`, `connectorsMatch`); there is no hand-rolled rotation. Left corners are `reverseTile(base)` pieces stored as `tileId` = base id with `reversed: true`, with the placement of the *unreversed* tile, so 004 can call `tileTransform(getTile(tileId), placement)` directly.

Files (all new):
- `src/track/layout.ts`: types (`TrackOptions`, `ResolvedTrackOptions`, `TrackPiece`, `Centreline`, `Checkpoint`, `StartPose`, `CellInfo`), `DEFAULT_TRACK_OPTIONS`, `TrackLayout` class, `cellKey`, `dirHeading`/`headingVector`, `pieceDef(piece)` (catalog def or its reverse, for 004). The frame and heading convention is a doc comment at the top of the file.
- `src/track/generator.ts`: `generateTrack`, `resolveTrackOptions`, `layoutFromPieces(seed, options, specs, startRotation)` (builds a layout from an explicit piece list; the generator's own output goes through the same code; used for hand-checked test layouts).
- `src/track/ascii.ts`: `trackToAscii`.
- `src/track/validate.ts`: `validateLayout(layout)` returns a list of invariant violations (count range, overlaps, one start at index 0 preceded by a straight, exit/entry match incl. wrap-around, clearance). It recomputes everything from the pieces and does not trust `occupancy`.
- `src/track/generator.test.ts`: 26 tests.

Layout notes: `TrackLayout` is a class with plain data fields plus `pieceAt(cell)` (returns the piece index or `null`) and `cellInfo(cell)` on the prototype, so two layouts compare deep-equal (`toEqual`) and are not polluted by closures. Extra fields beyond the spec: `attempts` (search attempts used), and per piece `kind` and `turn` (relative to the driving direction). `entryDir`/`exitDir` are the direction of travel when entering/leaving the piece. Headings: radians clockwise from north (`N=0, E=PI/2, S=PI, W=-PI/2`), direction vector `(sin h, -cos h)` in (x, z); for three.js use `rotation.y = -heading` for a model facing -z.

### Algorithm
Randomised depth-first search with backtracking on the cell grid ("random walk that must return to the start").
1. Piece 0 is `roadStartPositions` at cell (0,0) with a random rotation; the cell where the last piece's exit must land is the neighbour of its entry connector.
2. Each step builds candidates (every allowed straight, and every corner as right and as `reverseTile` left), places each with `placementToJoin` and rejects it if: it overlaps an occupied cell; any of its cells is within `clearance` (manhattan, so 1 = no shared edge) of a piece other than its predecessor (or the start piece, only for the closing piece); it would exceed `maxPieces`; or the head can no longer reach the closing cell in the remaining pieces (a manhattan lower bound).
3. A candidate whose exit `connectorsMatch`es the start entry closes the loop. It must be a straight (this enforces "the piece before the start is a straight") and the total must be in `[minPieces, maxPieces]`.
4. Surviving candidates are drawn by weight without replacement (`tileWeights` x `kindWeights`; defaults: straight 1.2, long 1.2, small 0.5, large 1, larger 1). The weights are multiplied by `exp(-pressure * 1.5 * (dist_after - dist_before))` where dist is the manhattan distance of the road head to the closing cell and `pressure = min(1, count/aim)^2`. `aim` is a piece count drawn uniformly from `[minPieces, maxPieces]` at the start of each attempt: this spreads the piece counts instead of always running to `maxPieces`.
5. An attempt has a budget of 60 expanded nodes; when exhausted the search is abandoned and the next attempt continues with the same RNG stream (so the whole thing stays deterministic). After `maxAttempts` the function throws an error naming the seed and the resolved options.
6. The layout is then assembled: occupancy, bounds, a dense closed centreline (sample spacing <= 0.2 cells, tangents from the tile curves), checkpoints and the start pose.

Checkpoints: at the start (entry edge) of pieces `every, 2*every, ...` below the piece count, then the start/finish line at the start of piece 0 as the last one. Each is the full cell width across the road (`a` on the driver's left, `b` on the right), `normal` is the unit driving direction. `startPose`: on the centreline of the start piece, 0.75 cells past the line (the rear painted grid slot along the track), heading along the piece.

### ASCII renders
Legend: `^ > v <` straight (driving direction), `S` start line cell then an arrow, `L`/`R` corner cells the road passes through, `:` rest of a corner's footprint, `.` empty.

Seed 1 (16 pieces):
```
....:LL<<LL:
....LL:..:LL
....L::..::L
...:R......^
:LLRR......S
LL:........^
L::.R>>>>>>L
L:.:L.......
LL>LL.......
```
Seed 7 (18 pieces):
```
..LLLL......
..L::L......
..v..R:.....
.LR..RR<<LL:
.v.......:LL
LR.......::L
v........::L
v........:LL
L>>>>S>>>LL:
```
Seed 42 (31 pieces):
```
.........L<L
.........v.^
.........S.^
.........v.^
.......::R.^
.......:RR.^
.....LLRR:.^
.....L:...RL
.....v...:L.
.....v.RRLL.
....:R.R:...
LL<<RR.^....
L:.....R:...
L::....RRL..
LL:......^..
:LLRR....^..
...:R....^..
....v....^..
....v....^..
....L::::L..
....LL::LL..
....:LLLL:..
```

### Stats over seeds 0..499 (default options)
- 0 failures, 0 validation errors. Mean 7.9 attempts per track (max 49 of 200).
- Pieces per track (start piece included): count -> number of seeds: 16:31, 17:26, 18:24, 19:25, 20:31, 21:21, 22:30, 23:28, 24:22, 25:25, 26:28, 27:22, 28:21, 29:29, 30:17, 31:14, 32:22, 33:13, 34:9, 35:11, 36:14, 37:11, 38:9, 39:9, 40:8 (mean 25.6).
- Piece mix over all 12806 pieces: start 500; roadStraight 2850; roadStraightLong 2382; corners 7074. Corner sizes: small 2039 (28.8%), large 2747 (38.8%), larger 2288 (32.3%). Turns: left 3469 / right 3605.
- Timing (`generateTrack` only, run in vite-node outside the repo): median 6.0 ms, p95 24 ms, max 67 ms. The test file asserts median < 50 ms; `npm test` takes about 8 s wall time overall (mostly per-file startup); the `src/track` tests, including generating the 500 layouts, take about 1.5 s.

Commands: `npm run build`, `npm test` (59 passed), `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass.

### Deviations
- Start pose is exactly on the centreline (as the spec says) rather than offset into a painted slot. Inspection of `roadStartPositions.glb` shows four slots (two per lane, lateral about +-0.18 from the centre, along-track at 0.25/0.75/1.25/1.75 cells from the north end); I used the along-track position of the rear right slot (0.75 cells past the entry line) with zero lateral offset. 004/race code can offset the cars laterally for a grid.
- `TrackLayout` is a class (data fields + prototype methods) instead of an object literal with closures, so layouts remain deep-equal as required by the determinism test.
- Extra, unrequested exports: `layoutFromPieces`, `resolveTrackOptions`, `validateLayout`, `pieceDef`, `cellKey`, `dirHeading`, `headingVector`, plus `attempts`, `kind` and `turn` on the layout/pieces.
- `clearance` is generalised as "manhattan distance <= clearance is forbidden"; `clearance: 1` is the specified rule (no shared edge; diagonal contact is allowed, as in the spec's wording).
- Tile weights are per tile id (corner left/right equally likely); `kindWeights` only has `straight` and `corner`.
- The start tile is always `roadStartPositions` (the first `start_finish` in the catalog); listing it in `allowedTiles` is ignored, listing a non-road tile throws.
- `tiles.ts` was not modified.

### Known limitations
- Track extent is not bounded, only the piece count; a track of 40 pieces can be tens of cells wide. No option for target total length or bounding box.
- Generation is DFS with a small per-attempt node budget, so unusual option sets (tiny `maxPieces`, only large corners, `clearance >= 2`) may exhaust `maxAttempts` and throw; the error names the seed and options. `minPieces: 5, maxPieces: 5` is an example (no loop that small exists).
- Checkpoints sit at piece starts, so the spacing in distance varies with the pieces used; the last interval to the finish line can be shorter than `checkpointEvery` pieces.
- The `centreline` tangent at the join of two pieces is computed from the tile curves (C1), while `distance` is the polyline length, which underestimates arc length by up to about 1%.
- Heading/frame conversion to three.js (`rotation.y = -heading`) is documented but not exercised until 004.

## Review (round 1)
Verdict: APPROVED

Checks run: `npm run build`, `npm test` (59 passed), `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass. Only `Tasks/003-track-generator.md` is modified (the coordinator's spec rewrite plus the notes); `src/track/` is new; `tiles.ts` is untouched, as the notes say.

Independent checker (throwaway vitest in `/tmp/review003`, written separately from `validateLayout`; it derives turn, entry and exit from centreline tangents rather than the stored fields). It covers:
- count range, exactly one start piece at index 0, and a straight before it
- overlaps, and `occupancy` against the pieces
- clearance with my own manhattan neighbour scan, including the wrap-around pairs
- determinism, by comparing two runs as JSON
- centreline: jump size, monotonic distance, unit tangents, tangent against polyline direction, `totalLength`, points inside their piece's cells, piece-to-piece gaps
- checkpoints: expected pieces, last one at the start line, at the piece start, width 1, perpendicular, `a` left and `b` right, and a real polyline intersection at the position
- `startPose`: heading, on the centreline, inside the start cells
- `cellInfo` left/right against the cross product of the entry and exit tangents, on every cell of every piece
- `entryDir`/`exitDir` against the tangents
- builder reconstruction: `tileTransform(getTile(tileId), placement)` with the model-local road (entry at (0.5,0), exit at (0.5,-d) or (w,-(w-0.5)), swapped when `reversed`) matches the centreline start and end points, the model footprint equals the piece's cells, and the corner arc midpoint matches

Results, with no violations of any kind:

| Option set | Seeds | Failures |
|---|---|---|
| default | 500-2499 (2000) | 0 |
| min 8 / max 14 | 500 | 0 |
| min 40 / max 60 | 200 | 1 (seed 524) |
| `checkpointEvery: 3` | 300 | 0 |
| `clearance: 0` | 200 | 0 |
| `clearance: 2` | 100 | 0 |
| no small corners | 200 | 0 |
| corner-heavy kind weights | 200 | 0 |
| min 20 = max 20 | 200 | 0 |

- Max centreline jump is 0.200 cells everywhere.
- The ASCII tracks I printed (seeds 3, 600, 1234, plus the worker's) read as sensible drivable loops: clearance gaps, direction arrows consistent, start line on a straight.

Timing (default options, 2000 seeds, `generateTrack` only, in vitest): median 6.3 ms, p95 27.9 ms, max 101.7 ms. The "typical under 50 ms" criterion is met. The worst case of about 100 ms is a one-off cost at "new track" time, so it is acceptable, but a loading or generating state should not assume it is instant.
- Larger option sets are slower: min 40 / max 60 has median 27 ms and max 208 ms.
- `clearance: 2` has median 12 ms and max 66 ms.

Determinism hazards: no `Math.random` / `Date.now` in non-test code. The only Map iteration in the sources is in the tests. Candidate order follows `allowedTiles` array order and the single seeded `Rng` stream. Floating-point use is limited to weights, which are consumed by the same deterministic stream (no cross-platform issue beyond `exp`, which is acceptable here). Two runs were deep-equal for all seeds.

Deviations: all acceptable.
- The start pose is exactly on the centreline at 0.375 of the 2-cell piece (0.75 cells past the line); the notes record the slot choice.
- `TrackLayout` is a class so layouts stay deep-equal.
- Extra exports are harmless.
- The generalised `clearance` is fine.

Issues:
- Non-blocking: with the extreme non-default option set `minPieces: 40, maxPieces: 60`, seed 524 exhausted `maxAttempts` (200) and threw. The error is the clear one the spec asks for, and default options never fail (0 of 2500 seeds), so this is not a spec violation. Consider recording it as a known limitation, or a larger per-attempt `NODE_BUDGET`, or an adaptive budget, if long tracks matter later.
- Non-blocking: the unit test `generates a typical track in well under 50 ms (median)` is wall-clock and could be flaky on a loaded CI machine. A looser bound or a larger sample would make it more robust.
- Non-blocking: heading conversion (`rotation.y = -heading`) is only documented, not exercised until 004 (as the notes already say). I verified the `tileTransform` + `reversed` reconstruction numerically, so the 004 builder contract holds.
