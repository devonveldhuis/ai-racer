/** Hand-built loops for the sensor tests: a long run-up straight before the first corner. */
import { layoutFromPieces, type PieceSpec } from '../track/generator';
import type { TrackLayout } from '../track/layout';

const straight = (): PieceSpec => ({ tileId: 'roadStraight', reversed: false });
const corner = (reversed: boolean): PieceSpec => ({ tileId: 'roadCornerSmall', reversed });
const repeat = (n: number): PieceSpec[] => Array.from({ length: n }, straight);

/**
 * A rectangle: start piece (heading north), 6 straights, a corner, 2 straights, a corner,
 * 8 straights, a corner, 2 straights, a corner. Clockwise (right corners) or, with
 * `ccw`, counter-clockwise (left corners, i.e. reversed pieces). Piece 7 is the first corner.
 */
export function runUpLayout(ccw: boolean): TrackLayout {
  return layoutFromPieces(
    11,
    {},
    [
      ...repeat(6),
      corner(ccw),
      ...repeat(2),
      corner(ccw),
      ...repeat(8),
      corner(ccw),
      ...repeat(2),
      corner(ccw),
    ],
    0,
  );
}

/** Index of the first corner piece of `runUpLayout`. */
export const FIRST_CORNER = 7;
