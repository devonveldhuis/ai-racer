import { pieceDef, type TrackLayout } from './layout';

/** A maximal run of consecutive non-corner pieces (straights and the start piece). */
export interface StraightRun {
  /** Index of the first piece of the run (in driving order; the run may wrap past the end). */
  startPiece: number;
  /** Number of pieces in the run. */
  pieceCount: number;
  /** Length of the run along the centreline, in cells (grid units). */
  cells: number;
  /** True if the run includes the start/finish piece. */
  containsStart: boolean;
}

/**
 * The straight runs of a layout: maximal chains of consecutive non-corner pieces, counted
 * along the centreline from the exit of the corner before to the entry of the corner after.
 * The loop is cyclic, so a run may wrap around the end of the piece list. Runs are sorted by
 * `startPiece`.
 */
export function straightRuns(layout: TrackLayout): StraightRun[] {
  const { pieces } = layout;
  const n = pieces.length;
  const firstCorner = pieces.findIndex((p) => p.kind === 'corner');
  if (firstCorner < 0) {
    const cells = pieces.reduce((s, p) => s + pieceDef(p).length, 0);
    return [{ startPiece: 0, pieceCount: n, cells, containsStart: true }];
  }
  const runs: StraightRun[] = [];
  // Walk once around the loop starting right after a corner so no run is split.
  let cur: StraightRun | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (firstCorner + k) % n;
    const p = pieces[i];
    if (!p || p.kind === 'corner') {
      if (cur) runs.push(cur);
      cur = null;
      continue;
    }
    cur ??= { startPiece: i, pieceCount: 0, cells: 0, containsStart: false };
    cur.pieceCount++;
    cur.cells += pieceDef(p).length;
    if (p.kind === 'start_finish') cur.containsStart = true;
  }
  return runs.sort((a, b) => a.startPiece - b.startPiece);
}

/** Cell lengths of the straight runs, longest first. */
export function straightRunLengths(layout: TrackLayout): number[] {
  return straightRuns(layout)
    .map((r) => r.cells)
    .sort((a, b) => b - a);
}

/** The run containing the start/finish piece (the "main straight"). */
export function mainStraight(layout: TrackLayout): StraightRun {
  const run = straightRuns(layout).find((r) => r.containsStart);
  if (!run) throw new Error('layout has no straight run containing the start piece');
  return run;
}
