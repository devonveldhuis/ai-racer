import { placedCentreline, type TileDef } from '../assets/tiles';
import { cellKey, pieceDef, type TrackLayout } from './layout';

const ARROWS = { N: '^', E: '>', S: 'v', W: '<' } as const;

/**
 * Render a layout as ASCII, one character per cell, north (-z) up, east (+x) right.
 *
 * - `^ > v <` straight road, pointing in the driving direction
 * - `S` the start line cell (first cell of the start piece), followed by an arrow cell
 * - `L` / `R` corner cells the road passes through (left / right turn, driving direction)
 * - `:` rest of a corner's footprint (the inside and outside of the bend, not road)
 * - `.` empty
 */
export function trackToAscii(layout: TrackLayout): string {
  const { min, max } = layout.bounds;
  const grid = new Map<string, string>();
  for (const piece of layout.pieces) {
    const def: TileDef = pieceDef(piece);
    if (piece.kind === 'corner') {
      for (const c of piece.cells) grid.set(cellKey(c), ':');
      const mark = piece.turn === 'left' ? 'L' : 'R';
      for (let k = 1; k < 40; k++) {
        // Strictly inside (0, 1): the end points lie on cell edges.
        const p = placedCentreline(def, piece.placement, k / 40);
        if (p) grid.set(cellKey({ x: Math.floor(p.x), z: Math.floor(p.z) }), mark);
      }
    } else {
      // Cells in driving order: the one the road enters first comes first.
      const sorted = [...piece.cells].sort((a, b) =>
        piece.entryDir === 'N'
          ? b.z - a.z
          : piece.entryDir === 'S'
            ? a.z - b.z
            : piece.entryDir === 'E'
              ? a.x - b.x
              : b.x - a.x,
      );
      sorted.forEach((c, i) => {
        grid.set(
          cellKey(c),
          piece.kind === 'start_finish' && i === 0 ? 'S' : ARROWS[piece.entryDir],
        );
      });
    }
  }
  const lines: string[] = [];
  for (let z = min.z; z <= max.z; z++) {
    let line = '';
    for (let x = min.x; x <= max.x; x++) line += grid.get(cellKey({ x, z })) ?? '.';
    lines.push(line);
  }
  return lines.join('\n');
}
