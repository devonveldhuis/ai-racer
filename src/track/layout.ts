/**
 * Track layout types and the `TrackLayout` container. Pure data and math (no three.js).
 *
 * Frame and units: everything is in grid units (1 = one cell), in the x/z frame of
 * `src/assets/tiles.ts` (N = -z, E = +x, z grows towards the south; multiply by `worldScale`
 * for metres). Global cell `(gx, gz)` covers x in [gx, gx+1], z in [gz, gz+1].
 *
 * Heading convention: a heading is an angle in radians measured clockwise seen from above,
 * starting at north: `N = 0`, `E = PI/2`, `S = PI`, `W = -PI/2`. The direction vector of a
 * heading `h` is `(sin h, -cos h)` in (x, z), which is consistent with `DIR_VECTORS`.
 * To turn a three.js object whose model faces -z so that it points along heading `h`, set
 * `object.rotation.y = -h` (three.js rotation about +y is counter-clockwise from above).
 */
import {
  DIR_VECTORS,
  getTile,
  reverseTile,
  type Dir,
  type Placement,
  type TileDef,
  type TileKind,
  type Vec2,
} from '../assets/tiles';

export type TurnDir = 'left' | 'right';

export interface TrackOptions {
  /** Minimum number of pieces in the loop, start piece included. Default 30. */
  minPieces?: number;
  /** Maximum number of pieces in the loop, start piece included. Default 60. */
  maxPieces?: number;
  /** Catalog tile ids the loop may use (straights and corners). Default: all of them. The
   * start/finish tile is always used exactly once and need not be listed. */
  allowedTiles?: readonly string[];
  /** Multipliers per tile kind, applied on top of `tileWeights`. */
  kindWeights?: Partial<Record<'straight' | 'corner', number>>;
  /** Selection weight per tile id (default 1 for ids not listed). Corners are weighted per
   * tile, not per turn direction: left and right are equally likely. */
  tileWeights?: Readonly<Record<string, number>>;
  /** Pieces between checkpoints. Default 4. */
  checkpointEvery?: number;
  /** Cells with a manhattan distance of at most `clearance` between non-consecutive pieces
   * are forbidden (1 = no shared edge, i.e. at least one empty cell between parallel road
   * sections). 0 only forbids overlaps. Default 1. */
  clearance?: number;
  /** Search attempts before giving up with an error. Default 200. */
  maxAttempts?: number;
  /** Length range, in cells, of the main straight: the straight run containing the start
   * piece (counted along the centreline from the exit of the corner before it to the entry of
   * the corner after it). Drawn per track. Both ends are integers >= 3 (the start piece is 2
   * cells plus at least one cell of approach). Default [15, 20]. */
  mainStraightCells?: readonly [number, number];
  /** Minimum number of corner pieces in the loop. Default 6. */
  minCorners?: number;
  /** Length range, in cells, of the other straight runs the generator starts after a corner
   * (a run is a chain of straight pieces between two corners). Default [2, 9]. */
  straightRunCells?: readonly [number, number];
}

export interface ResolvedTrackOptions {
  minPieces: number;
  maxPieces: number;
  allowedTiles: string[];
  kindWeights: Record<'straight' | 'corner', number>;
  tileWeights: Record<string, number>;
  checkpointEvery: number;
  clearance: number;
  maxAttempts: number;
  mainStraightCells: [number, number];
  minCorners: number;
  straightRunCells: [number, number];
}

export const DEFAULT_TRACK_OPTIONS: Readonly<ResolvedTrackOptions> = {
  minPieces: 30,
  maxPieces: 60,
  allowedTiles: [
    'roadStraight',
    'roadStraightLong',
    'roadCornerSmall',
    'roadCornerLarge',
    'roadCornerLarger',
  ],
  kindWeights: { straight: 1, corner: 1 },
  tileWeights: {
    roadStraight: 1.2,
    roadStraightLong: 1.2,
    roadCornerSmall: 0.5,
    roadCornerLarge: 1,
    roadCornerLarger: 1,
  },
  checkpointEvery: 4,
  clearance: 1,
  maxAttempts: 200,
  mainStraightCells: [15, 20],
  minCorners: 6,
  straightRunCells: [2, 9],
};

export interface TrackPiece {
  index: number;
  /** Base catalog id (e.g. `roadCornerLarge`), also for left-turning corners. */
  tileId: string;
  /** Placement of the *unreversed* catalog tile; feed it to `tileTransform(getTile(tileId), …)`. */
  placement: Placement;
  /** True for left-turning corners (the base tile travelled backwards, see `reverseTile`). */
  reversed: boolean;
  /** Direction of travel when entering the piece / leaving the piece. */
  entryDir: Dir;
  exitDir: Dir;
  /** All global cells the piece covers. */
  cells: Vec2[];
  kind: TileKind;
  /** Relative to the driving direction; `null` for straights and the start piece. */
  turn: TurnDir | null;
}

export interface Centreline {
  /** Closed polyline: the segment from the last point back to the first is implied. */
  points: Vec2[];
  /** Cumulative arc length at each point (`distance[0] = 0`). */
  distance: number[];
  /** Unit direction of travel at each point. */
  tangent: Vec2[];
  /** Index of the piece each point belongs to. */
  pieceIndex: number[];
  /** Length of the whole loop, including the closing segment. */
  totalLength: number;
}

export interface Checkpoint {
  /** Order of crossing (0-based); the last one is the start/finish line. */
  index: number;
  /** The piece whose start (entry edge) the checkpoint sits on. */
  pieceIndex: number;
  /** Segment end points, `a` on the driver's left and `b` on the right. */
  a: Vec2;
  b: Vec2;
  /** Midpoint of the segment, on the centreline. */
  position: Vec2;
  /** Unit driving direction. */
  normal: Vec2;
}

export interface StartPose {
  position: Vec2;
  /** See the heading convention in the file header. */
  heading: number;
}

export interface CellInfo {
  pieceIndex: number;
  kind: TileKind;
  turn: TurnDir | null;
}

export interface Bounds {
  /** Inclusive cell ranges. */
  min: Vec2;
  max: Vec2;
}

export function cellKey(c: Vec2): string {
  return `${c.x},${c.z}`;
}

export function dirHeading(d: Dir): number {
  const v = DIR_VECTORS[d];
  return Math.atan2(v.x, -v.z);
}

export function headingVector(h: number): Vec2 {
  return { x: Math.sin(h), z: -Math.cos(h) };
}

/** The catalog definition a piece was built from (`reverseTile` applied for left corners). */
export function pieceDef(piece: Pick<TrackPiece, 'tileId' | 'reversed'>): TileDef {
  const base = getTile(piece.tileId);
  return piece.reversed ? reverseTile(base) : base;
}

export interface TrackLayoutData {
  seed: number;
  options: ResolvedTrackOptions;
  /** Search attempts used (1 = first try). */
  attempts: number;
  pieces: TrackPiece[];
  occupancy: Map<string, number>;
  bounds: Bounds;
  centreline: Centreline;
  checkpoints: Checkpoint[];
  startPose: StartPose;
}

/**
 * A generated track. Plain data fields plus two lookups defined on the prototype, so two
 * layouts compare deep-equal (`toEqual`) when their data is equal.
 */
export class TrackLayout implements TrackLayoutData {
  readonly seed: number;
  readonly options: ResolvedTrackOptions;
  readonly attempts: number;
  readonly pieces: TrackPiece[];
  /** Cell key `"x,z"` (see `cellKey`) -> piece index; multi-cell tiles fill all their cells. */
  readonly occupancy: Map<string, number>;
  readonly bounds: Bounds;
  readonly centreline: Centreline;
  readonly checkpoints: Checkpoint[];
  readonly startPose: StartPose;

  constructor(data: TrackLayoutData) {
    this.seed = data.seed;
    this.options = data.options;
    this.attempts = data.attempts;
    this.pieces = data.pieces;
    this.occupancy = data.occupancy;
    this.bounds = data.bounds;
    this.centreline = data.centreline;
    this.checkpoints = data.checkpoints;
    this.startPose = data.startPose;
  }

  /** Index of the piece covering `cell`, or `null` for an empty cell. */
  pieceAt(cell: Vec2): number | null {
    return this.occupancy.get(cellKey(cell)) ?? null;
  }

  /** Piece kind and turn (relative to the driving direction) of a cell; `null` if empty. */
  cellInfo(cell: Vec2): CellInfo | null {
    const i = this.pieceAt(cell);
    if (i === null) return null;
    const p = this.pieces[i] as TrackPiece;
    return { pieceIndex: i, kind: p.kind, turn: p.turn };
  }
}
