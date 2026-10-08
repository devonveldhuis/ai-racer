# 011 – Longer straights in generated tracks

Status: done

## Goal
Let the car (≈30 m/s top speed after 005's rework) actually build up speed. Every generated track gets one long main straight, and medium straights become more common, so speed and braking points matter. This extends the 003 generator; see `PLAN.md` → Track generation.

## Decisions (from the human, 2026-10-08)
- **Every track has a main straight of ~60–80 m** (15–20 cells at `worldScale` 4, where the car reaches about 22–25 m/s from a corner exit), plus more medium-length straights than today.
- **Tracks may grow overall** to fit this. The number of corners per track should stay roughly the same as today; the extra length comes from straights.

## Background (measured during 005's round-2 review, 200 seeds, current generator)
- The longest straight run per track is 11.8 m minimum, 19.8 m median, 35.5 m at p90, and 51.4 m at most.
- Full throttle from a corner exit at 8 m/s reaches about 15 m/s after 20 m, 19 m/s after 40 m, 21 m/s after 51 m and 22 m/s after 60 m.
- Tracks are 130–300 m long, with a mean of 25.6 pieces (start included) and about 55 % corners.

## Requirements
- **Main straight:** the start/finish piece sits on a straight run of `mainStraightCells` cells, drawn per track from `[minCells, maxCells]` (new option, default **[15, 20]**). The run is counted along the centreline from the exit of the corner before it to the entry of the corner after it, with the start piece included. Placing the start/finish on the main straight is the classic layout and the recommended approach, for example by seeding the search with the straight run already placed around the start piece. The worker may choose another approach if it reliably closes.
- **Medium straights:** bias the generator so that straight runs elsewhere are longer than today. One option is "straight-run" macro candidates of 2–8 cells; another is a weight that rewards continuing straight. Target: the median length of the **second**-longest straight run is ≥ 8 cells (32 m) over 500 seeds. Report the distribution.
- **Piece budget:** retune `minPieces`/`maxPieces` (or count straights differently) so that the mean corner count per track stays within ±20 % of today's. Measure today's mean first and report both. The number of corner pieces in a track also has a lower bound, so no track ends up as just a rectangle: a configurable `minCorners`, default 6.
- All existing generator invariants still hold: closed loop, no overlap, clearance 1, exactly one start piece preceded by a straight, determinism, and a clear error after `maxAttempts`.
- Use the 002/003 helpers (`placementToJoin`, `placedCells`, …). There is no hand-rolled rotation.

## Acceptance criteria
- [ ] Over 500 seeds with default options:
  - 0 failures and 0 `validateLayout` errors
  - every track has a main straight run of 15–20 cells that contains the start piece
  - the median second-longest straight run is ≥ 8 cells
  - the mean corner count is within ±20 % of the pre-change mean
  - every track has ≥ `minCorners` corners
- [ ] Generation time: median < 50 ms, and report p95 and max. The existing timing test still passes.
- [ ] New unit tests for the main-straight and min-corner guarantees and for the straight-run measurement helper. Existing 003 tests are updated only where they encoded the old defaults (e.g. the piece-count range). Record each such change.
- [ ] Downstream tests keep passing without being weakened:
  - the 004 surface and builder tests
  - the 005 drivability test (pure pursuit, 5 seeds including a small corner, ≥ 80 % on road, no flips, lap limit formula unchanged)

  If seeds 1–5 no longer contain a small corner, pick other seeds with a small corner the way the test already does, and record it.
- [ ] Add a headless check in the 005 drive tests: on at least 3 seeds, the pure-pursuit driver reaches **≥ 20 m/s** on the main straight. If the driver brakes too early to show this, a full-throttle run along the main straight from its entry is fine. Report the peak speeds.
- [ ] Notes include ASCII renders of 3 seeds and the distribution of the longest and second-longest straight runs, the corner count and the track length in metres.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` pass.

## Technical notes
- Code: `src/track/generator.ts`, `src/track/layout.ts` (options and defaults), and `src/track/validate.ts` (add the new invariants). Export a pure helper such as `straightRuns(layout)` that returns the runs (start piece index, cell length, and whether it contains the start), for the tests and stats.
- The DFS uses a small per-attempt node budget and a manhattan "pressure" toward the closing cell. A long fixed straight makes closing harder, so the budget and pressure may need retuning. 003's review saw rare failures at large piece counts, so keep an eye on attempt counts.
- **Concurrency:** task 007 (race state) is being implemented at the same time in a separate worktree. It owns `src/race/`, `src/game/Game.ts`, `src/core/` and config. Don't touch those. 007 doesn't edit `src/track/`. Don't change the `TrackLayout` data format (checkpoints, centreline, startPose) that 007 consumes. Adding new fields or options is fine.

## Out of scope
Car physics tuning, the builder, the camera and controls, bigger margins or scenery, and new tile types. Don't change `Models/`, `AGENTS.md`, `PLAN.md` or other task files.

<!-- Sections below are appended during the workflow -->

## Implementation Notes

Worktree: `/home/devon/Projects/ai-racer/.claude/worktrees/agent-ab2eaf8364ca5c8b4`, branch `worktree-agent-ab2eaf8364ca5c8b4` (based on `cee11ad`). Not committed.

### Files touched
- `src/track/straights.ts` (new): `straightRuns(layout)` (maximal non-corner chains, cyclic, with `startPiece`, `pieceCount`, `cells`, `containsStart`), `straightRunLengths(layout)` (longest first), `mainStraight(layout)`.
- `src/track/generator.ts`: new search structure (below), option resolution and validation.
- `src/track/layout.ts`: new options `mainStraightCells` (default [15, 20]), `minCorners` (6), `straightRunCells` (default [2, 9]); new defaults `minPieces` 30 (was 16), `maxPieces` 60 (was 40).
- `src/track/validate.ts`: new invariants (corners >= `minCorners`; start piece on a straight run of `mainStraightCells`).
- `src/track/generator.test.ts`, `src/car/drive.test.ts`: tests (see below).
- `TrackLayout` data (checkpoints, centreline, startPose, pieces) is unchanged.

### Algorithm changes
1. **Main straight is pre-placed.** Per attempt, draw M in `mainStraightCells`; rest = M - 2 (start piece is 2 cells). Split the rest into `post` (after the start, 30-70 % of rest) and `pre` (>= 1 cell, before the start, so the piece before the start is a straight). Both are filled with random straight tiles (1- and 2-cell). The post run is placed with `placementToJoin` from the start's exit; the pre run is built forwards from a virtual exit `pre + 1` cells behind the start entry and checked to end exactly at the start entry (`connectorsMatch`). They are put in the occupancy map up front (pre pieces get index `100000 + i`).
2. **DFS only connects the end of the post run to the start of the pre run.** The first searched piece must be a corner (so the main run is exactly M), and the closing piece must be a corner whose exit matches the pre run's entry (so the run before it also ends at a corner). Closing needs piece count in [minPieces, maxPieces] and corners >= `minCorners`. Steering target is the pre run's entry; the `aim` pressure counts the pre pieces.
3. **Medium straights = straight runs.** After a corner the search chooses either another corner or a straight that starts a run of r cells (r uniform in `straightRunCells` = [2, 9], so the straight family has the same total weight as before). The run is then completed with straights only (random 1-/2-cell tiles fitting the remaining length) and must be followed by a corner. When a run starts, the whole line of r cells is checked to be free (and clear), so a run cannot dead-end halfway; steering and the reach-prune use the head position after the full run.
4. Node budget is now `3 * maxPieces` per attempt (was a fixed 60, which is too small for ~45 pieces). `maxAttempts` default unchanged (200).

### Statistics (500 seeds, seeds 1-500, default options)
Baseline = pre-change generator on the same seeds.

| metric | baseline | new |
|---|---|---|
| failures / validateLayout errors | 0 / 0 | 0 / 0 |
| corners, mean (min / p10 / med / p90 / max) | 14.2 (4 / 10 / 14 / 20 / 28) | 13.5 (6 / 8 / 12 / 20 / 30) |
| pieces, mean (min / max) | 25.6 (16 / 40) | 43.0 (30 / 60) |
| track length m, mean (min / med / p90 / max) | 205 (96 / 203 / 278 / 358) | 296 (183 / 284 / 388 / 492) |
| longest run, cells (min / med / p90 / max) | 5.7 mean (3 / 5 / 9 / 16) | 17.6 mean (15 / 18 / 20 / 20) |
| main straight (contains start), cells | 4.4 mean (3 - 16) | 15-20 for all 500 |
| second-longest run, cells (min / p10 / med / p90 / max) | 3.7 mean (1 / 2 / 4 / 5 / 10) | 8.3 mean (3 / 7 / 9 / 9 / 9) |
| attempts (mean / p95 / max) | 7.9 / 23 / 49 | 5.9 / 17 / 47 |
| generation ms (median / p95 / max) | 4.1 / 16.8 / 43.5 | 12.8 / 57.5 / 159 |

Mean corners: 13.5 vs 14.2 (-5 %, inside the +-20 % band). Min corners 6 (>= `minCorners`). Longest-run histogram (cells:count): 15:65 16:84 17:97 18:79 19:77 20:98. Second-longest: 3:1 4:4 5:11 6:26 7:36 8:124 9:298 (median 9, p10 7; 86 % are >= 8). Timing was measured in a single vitest run on a loaded dev machine (the median is well under the 50 ms limit; the existing timing test passes).

### ASCII renders (cell = 4 m; `S` = start line, driving direction arrows)
Seed 1: 43 pieces, 16 corners, 311 m, runs 19,7,6,5,3
```
RRRR:.....................
R::RR.....................
^.::R........:RRRR:...RRRR
^...v........RR::RR...R::R
^...v........R::::R.::L..v
^...v.......:L....L::LL..v
^...L>>>>>>>LL....LLLL:..v
R:.......................v
RRL......................v
..R<<<<<<<<<<<<S<<<<<<L..v
......................R::R
......................RRRR
```
Seed 2: 31 pieces, 10 corners, 216 m, runs 19,8,5
```
RRRR:.
R::RR.
^.::R.
^...v.
^...v.
^...v.
^...v.
^...v.
^..:R.
S.LRR.
^.v...
^.v...
^.v...
^.v...
^.v...
^.v...
^.v...
^.v...
^.L:..
^.LLRR
^...:R
RL.::R
.R::RR
.RRRR:
```
Seed 3: 45 pieces, 12 corners, 319 m, runs 17,9,9,8,5,2
```
...........:LLLL...
...........LL::L...
...........L::.^...
..........:R...^...
L<<<<<<<<<RR...R:..
v..............RRLL
v................:L
v.................^
v.................^
v.................^
v.................^
v.................^
v.................^
v.................^
L::...............^
LL:...............^
:LL>>>>>>>>RR:....^
...........:RR....^
...........::R....S
.............v....^
.............v....^
.............v....^
.............v....^
.............v....^
.............L::.RL
.............LL::L.
.............:LLLL.
```

### Tests
- `generator.test.ts` new `straight runs` describe: run measurement on a hand-made loop (wrap-around run through the start, `startPiece`/`pieceCount`) and with long-straight tiles; main straight 15-20 cells containing the start for all 500 default seeds; main length drawn from a custom range; median second-longest >= 8; mean corners within +-20 % of 14.2 and every track >= 6 corners; custom `minCorners`; `validateLayout` flags a short main straight / too few corners; bad option rejection.
- Changed existing 003 tests (only where they encoded old defaults): (a) the default 500-seed test's piece-count bounds 16-40 -> 30-60; (b) `respects custom options` now also passes `mainStraightCells: [3, 4]` and `minCorners: 4` (its 10-14 piece budget cannot hold a 15-20 cell main straight); (c) the two hand-checked-layout `validateLayout` filters now also ignore the `corners` / `main straight` errors, like they already ignored `piece count` (hand-made rectangles have 4 corners and a 3-cell main straight).
- `drive.test.ts`: the five lap tests are unchanged and pass with seeds 1-5 (all five still contain a small corner). Pure-pursuit tops on the first lap: 16.2, 19.2, 15.4, 15.4, 16.5 m/s. New describe `speed on the main straight` (seeds 1, 2, 3): the driver does 2 laps; on the second lap the main-straight pieces are driven at full throttle from the straight's entry (corner exit speed carried over), steering by the same pure pursuit; asserts peak speed on the main straight >= 20 m/s, no out-of-bounds, finished, no flip. Peaks: **22.4, 21.0, 21.6 m/s** (main straights 19, 19, 17 cells). Without the full-throttle override the pure-pursuit driver peaked at 19.1, 19.1, 18.1 m/s (it lifts early for the corner after the straight), which is why the override is used (allowed by the spec).

### Deviations
- `minPieces`/`maxPieces` defaults changed to 30/60 (spec asked to retune); chosen by measuring: 28/56 gave 12.5 mean corners, 30/60 gave 13.5, 30/70 gave 14.7 but with tails up to 36 corners and 560 m tracks.
- The pre-main-straight approach is also pre-placed (not only the post part), so the piece before the start is always a straight and the main run is exact. Both the first and the closing searched piece are corners.
- `maxPieces` budget now includes the main straight pieces (~10 of the 30-60). The reported `pieces` count thus grew a lot while corners stayed the same.
- The pure-pursuit speed check uses a full-throttle override on the main straight in lap 2 (spec's fallback), because the driver alone peaks at 18-19 m/s.
- Second-longest runs saturate at the `straightRunCells` max (9): 60 % of tracks have a second-longest of exactly 9 cells; non-main runs never exceed 9, so the main straight is always the longest. Could be varied by a different run-length distribution if more variety is wanted.
- `straightRunCells` option and `NODE_BUDGET_PER_PIECE` are additions beyond the spec's options (adding options is allowed).

### Known limitations / follow-ups
- Tracks are bigger (mean 296 m, up to 492 m); the lap-time limit formula in the drive test is unchanged.
- Generation p95 ~58 ms, max ~160 ms on a loaded machine; attempts max 47 of 200. No failures in 500 seeds, but custom narrow budgets (small `maxPieces` with the default main straight) fail with the clear "no valid loop" error.
- The main straight's pre/post split is 30-70 % of the remaining cells; the race start (rear slot of the start piece) therefore has 2-14 cells of straight in front of it before the finish line piece ends.

### Checks
`npm run build`, `npm test` (14 files, 178 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .` all pass in the worktree.

## Review (round 1)
Verdict: APPROVED

### Checks run (worktree `agent-ab2eaf8364ca5c8b4`)
- `npm run build`, `npm test` (14 files, 178 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check .`: all pass.
- Scope: changes only in `src/track/{generator,layout,validate}.ts`, new `src/track/straights.ts`, `src/track/generator.test.ts`, `src/car/drive.test.ts`. No Models/PLAN/AGENTS/other task edits; `TrackLayout` data format unchanged (only new options added).
- Independent checker (own code, centreline-based run detection, not `validateLayout`/`straightRuns`), seeds 500-1499 (1000 seeds): 0 failures; 0 invariant violations (closed centreline with no gaps, exit/entry dirs match, no overlap, manhattan clearance 1 between non-consecutive pieces, exactly one start preceded by a straight, determinism across two generations).
  - Main straight (contains start, measured in centreline length): min/p10/med/p90/max = 15/15/18/20/20 cells. All within [15, 20].
  - Corners: min 6, median 12, p90 20, max 34, mean 13.3 vs baseline 14.2 (-6 %, inside +-20 %).
  - Second-longest run: min 4, p10 7, median 9, p90 9, max 9 (acceptance >= 8 met; saturated at the 9-cell cap).
  - Track length (cells): 42-124, median 70 (about 280 m); attempts median 4, p90 13, max 41 of 200.
  - Generation time (my machine, two runs, ms): median 10.6-12.5, p95 47-69, max 123-217 (includes JIT warm-up/GC and the doubled generation load). Median is well under 50 ms.
- Downstream: 004 surface/builder tests and the 005 lap tests pass; the five lap tests and the lap-limit formula are unchanged in the diff (the diff only adds an optional `laps`/`fullThrottleOnMain` parameter and a `mainStraightPeak` field). New speed test (seeds 1-3) asserts peak on the main straight >= 20 m/s (worker: 22.4 / 21.0 / 21.6), and also checks no out-of-bounds, finished, no flip. Meaningful: it needs the real car carrying corner-exit speed, though the full-throttle override is by-spec fallback.
- ASCII renders (500, 501, 502, 777 plus the worker's): clean circuits with a long main straight, no spirals or odd overlaps.

### Deviations judgement
- minPieces/maxPieces 30/60: justified (measured), corner mean stays in band.
- 003 test changes (piece-count bounds, custom-options test using `mainStraightCells [3,4]`/`minCorners 4`, ignoring new errors in hand-made layout checks): only encode new defaults; acceptable.
- `straightRunCells` option, 9-cell cap, node budget per piece: acceptable additions.
- Full-throttle override in the speed test: allowed by the spec, documented.
- Existing timing test asserts the median only, so it is not at risk of flakiness; p95 ~50-70 ms and rare max ~120-220 ms is acceptable for the "new track" action (one-off, one frame hitch at worst).

### Issues
Blocking: none.
Non-blocking:
1. Second-longest run saturates at 9 (about 60 % of tracks), so the "medium straight" variety is low; the main straight is always strictly longest.
2. About 20 % of tracks are elongated (bounding-box aspect ratio > 3, max 5), and 18 % have only 6-8 corners (long rounded-rectangle shapes, e.g. seeds 500, 502). Not degenerate, but less varied than before; consider a wider `straightRunCells` distribution or a higher default `minCorners` later.
3. Generation max can reach 120-220 ms on a busy machine; consider a spinner/deferral if it ever becomes noticeable.
