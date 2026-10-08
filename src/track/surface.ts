/**
 * Analytic surface lookup for a `TrackLayout`. Pure math: no three.js, no Rapier.
 *
 * Approach: instead of reading the painted triangles, the surface under a point is derived
 * from the layout and the tile geometry measured in `src/assets/tiles.ts` (002):
 * - the road is 0.69 wide, centred on the centreline: lateral offset <= 0.345 is `road`;
 * - the kerb reaches 0.418 (0.082..0.918 inside a cell): offset <= 0.418 is `kerb`;
 * - everything else on the ground is `grass`.
 *
 * Lateral offset by piece:
 * - Straights (also `roadStartPositions`): distance from the cell's centre line along the
 *   piece axis (the x offset for N/S travel, the z offset for E/W travel).
 * - Corners of size n: the road is a quarter arc of radius n - 0.5 about the tile's SE
 *   corner (in the unrotated NW frame, i.e. (n, n)); that corner is turned with the piece's
 *   rotation. Offset = |distance to that centre - (n - 0.5)|. The whole quarter circle lies
 *   inside the piece's n x n footprint, so the formula is only applied to cells the piece
 *   covers (looked up first). Left corners (`reversed`) use the same geometry as the base tile.
 * - Empty cells inside bounds +/- margin are `grass`; outside that rectangle there is no
 *   ground and the result is `null` (also for NaN input).
 *
 * Boundary convention: cells are found with `Math.floor`, so a point exactly on a cell edge
 * belongs to the cell on the east / south side (the larger x / z). Offsets exactly at a
 * threshold (0.345, 0.418) resolve to the inner surface (road, kerb).
 *
 * The per-layout lookup table (cell -> piece, arc centres) is built once and cached in a
 * WeakMap, so the hot path is a typed-array read plus a little arithmetic, without allocation.
 */
import { rotationToQuarters } from '../assets/tiles';
import type { SurfaceType } from '../assets/surfaces';
import type { TrackLayout } from './layout';

/** Half the painted road width, grid units. */
export const ROAD_HALF_WIDTH = 0.345;
/** Half the width including the kerbs, grid units. */
export const KERB_HALF_WIDTH = 0.418;

const AXIS_X = 0; // road runs north/south: lateral offset is along x
const AXIS_Z = 1; // road runs east/west: lateral offset is along z
const AXIS_ARC = 2;

interface Lookup {
  minX: number;
  minZ: number;
  width: number;
  height: number;
  /** Piece index per cell of the bounds rectangle, -1 if empty. */
  cells: Int32Array;
  axis: Uint8Array;
  arcX: Float64Array;
  arcZ: Float64Array;
  arcR: Float64Array;
}

const lookups = new WeakMap<TrackLayout, Lookup>();

function buildLookup(layout: TrackLayout): Lookup {
  const { min, max } = layout.bounds;
  const width = max.x - min.x + 1;
  const height = max.z - min.z + 1;
  const cells = new Int32Array(width * height).fill(-1);
  for (let z = min.z; z <= max.z; z++) {
    for (let x = min.x; x <= max.x; x++) {
      const i = layout.pieceAt({ x, z });
      if (i !== null) cells[(z - min.z) * width + (x - min.x)] = i;
    }
  }
  const n = layout.pieces.length;
  const axis = new Uint8Array(n);
  const arcX = new Float64Array(n);
  const arcZ = new Float64Array(n);
  const arcR = new Float64Array(n);
  layout.pieces.forEach((piece, i) => {
    if (piece.kind === 'corner') {
      const size = piece.cells.length === 0 ? 1 : Math.round(Math.sqrt(piece.cells.length));
      // SE corner of the unrotated footprint, turned like the tile (one CCW quarter turn
      // maps (x, z) -> (z, size - x) inside a size x size footprint).
      let px = size;
      let pz = size;
      for (let q = 0; q < rotationToQuarters(piece.placement.rotation); q++) {
        [px, pz] = [pz, size - px];
      }
      axis[i] = AXIS_ARC;
      arcX[i] = piece.placement.cell.x + px;
      arcZ[i] = piece.placement.cell.z + pz;
      arcR[i] = size - 0.5;
    } else {
      axis[i] = piece.entryDir === 'N' || piece.entryDir === 'S' ? AXIS_X : AXIS_Z;
    }
  });
  return { minX: min.x, minZ: min.z, width, height, cells, axis, arcX, arcZ, arcR };
}

/**
 * Surface under the grid point `(x, z)` (grid units, `TrackLayout` frame), or `null` where
 * there is no ground: outside `layout.bounds` expanded by `margin` cells.
 */
export function surfaceAtGrid(
  layout: TrackLayout,
  x: number,
  z: number,
  margin: number,
): SurfaceType | null {
  let lk = lookups.get(layout);
  if (!lk) {
    lk = buildLookup(layout);
    lookups.set(layout, lk);
  }
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  // Negated comparisons so NaN falls into the `null` branch.
  if (
    !(gx >= lk.minX - margin && gx <= lk.minX + lk.width - 1 + margin) ||
    !(gz >= lk.minZ - margin && gz <= lk.minZ + lk.height - 1 + margin)
  ) {
    return null;
  }
  const cx = gx - lk.minX;
  const cz = gz - lk.minZ;
  if (cx < 0 || cx >= lk.width || cz < 0 || cz >= lk.height) return 'grass';
  const piece = lk.cells[cz * lk.width + cx] as number;
  if (piece < 0) return 'grass';

  const axis = lk.axis[piece] as number;
  let offset: number;
  if (axis === AXIS_X) {
    offset = Math.abs(x - gx - 0.5);
  } else if (axis === AXIS_Z) {
    offset = Math.abs(z - gz - 0.5);
  } else {
    const dx = x - (lk.arcX[piece] as number);
    const dz = z - (lk.arcZ[piece] as number);
    offset = Math.abs(Math.sqrt(dx * dx + dz * dz) - (lk.arcR[piece] as number));
  }
  if (offset <= ROAD_HALF_WIDTH) return 'road';
  if (offset <= KERB_HALF_WIDTH) return 'kerb';
  return 'grass';
}
