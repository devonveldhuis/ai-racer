/**
 * Track tile catalog. Plain `{x, z}` math only (no three.js) so it is unit-testable and
 * usable by the pure-data track generator.
 *
 * Conventions
 * - Grid directions `N | E | S | W` with N = -z and E = +x (three.js default, seen from above).
 * - Rotation is counter-clockwise (seen from above) about +y in 90 degree steps, which is
 *   +angle about +y in three.js. A quarter turn maps E -> N -> W -> S -> E.
 * - Global cell `(gx, gz)` covers x in [gx, gx+1], z in [gz, gz+1], in tile units (1 tile = 1
 *   unit; multiply by `worldScale` for metres).
 * - A `TileDef` lives in its own "NW frame": origin at the north-west corner of its footprint,
 *   cells `(cx, cz)` with `0 <= cx < w`, `0 <= cz < d`, and `x` right, `z` down (south).
 *   Placing a tile at `{cell, rotation}` puts the NW corner of its *rotated* footprint on
 *   the global cell `cell`.
 * - The loaded model has its origin at the south-west corner (mesh spans x in [0,w],
 *   z in [-d,0]); `tileTransform` accounts for this.
 * - Unrotated, every road tile is travelled northwards: entry on the S edge, exit on the N
 *   edge (straights) or on the E edge (corners, a right turn). Left turns are the same tile
 *   travelled backwards, see `reverseTile`.
 *
 * Mesh inspection (all Racing Kit road tiles): road is 0.69 wide, centred in the cell
 * (x 0.155..0.845 within a cell), kerbs 0.082..0.918. Corner tiles of size n x n carry an
 * arc of radius n-0.5 about the tile's SE corner, from the S edge of the SW cell to the E
 * edge of the NE cell.
 */

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;
export type TileKind = 'straight' | 'corner' | 'start_finish' | 'filler';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Connector {
  /** Cell the road crosses the edge in (tile NW frame, or global cells once placed). */
  cell: Vec2;
  /** Which edge of that cell the road crosses. Direction of travel is out of the tile for
   * exits and into the tile for entries. */
  edge: Dir;
}

export interface TileDef {
  id: string;
  /** GLB file name without extension. */
  model: string;
  footprint: { w: number; d: number };
  kind: TileKind;
  /** `null` for fillers. */
  connectors: { entry: Connector; exit: Connector } | null;
  /** Corners only: turn direction travelling entry -> exit. */
  turn?: 'left' | 'right';
  /** Quarter turns (CCW) applied to the catalog definition, 0..3. */
  quarterTurns: number;
  /** True if built by `reverseTile`: the model is the base tile, travelled backwards. */
  reversed: boolean;
  /** Centreline length in tile units (0 for fillers). */
  length: number;
  /** Point on the road centreline for t in [0,1], entry -> exit, in the tile's NW frame. */
  centreline: ((t: number) => Vec2) | null;
}

export interface Placement {
  cell: Vec2;
  rotation: Rotation;
}

export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export const DIR_VECTORS: Readonly<Record<Dir, Vec2>> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};

export function oppositeDir(d: Dir): Dir {
  return DIRS[(DIRS.indexOf(d) + 2) % 4] as Dir;
}

/** Rotate a direction by `quarters` CCW quarter turns (E -> N -> W -> S). */
export function rotateDir(d: Dir, quarters: number): Dir {
  const q = ((quarters % 4) + 4) % 4;
  return DIRS[(DIRS.indexOf(d) - q + 4) % 4] as Dir;
}

export function rotationToQuarters(r: Rotation): number {
  return r / 90;
}

export function quartersToRotation(q: number): Rotation {
  return ((((q % 4) + 4) % 4) * 90) as Rotation;
}

/** The cell next to `cell` in direction `dir`. */
export function neighbourCell(cell: Vec2, dir: Dir): Vec2 {
  const v = DIR_VECTORS[dir];
  return { x: cell.x + v.x, z: cell.z + v.z };
}

// One CCW quarter turn inside a w x d footprint (NW frame): (x, z) -> (z, w - x).
const turnPoint = (p: Vec2, w: number): Vec2 => ({ x: p.z, z: w - p.x });
const turnCell = (c: Vec2, w: number): Vec2 => ({ x: c.z, z: w - 1 - c.x });

/** Rotate a tile definition by `rotation` (CCW) about its footprint; returns a new def. */
export function rotateTile(def: TileDef, rotation: Rotation): TileDef {
  let out = def;
  for (let i = 0; i < rotationToQuarters(rotation); i++) out = rotateTileOnce(out);
  return out;
}

function rotateTileOnce(def: TileDef): TileDef {
  const { w, d } = def.footprint;
  const conn = def.connectors;
  const base = def.centreline;
  return {
    ...def,
    footprint: { w: d, d: w },
    quarterTurns: (def.quarterTurns + 1) % 4,
    connectors: conn && {
      entry: { cell: turnCell(conn.entry.cell, w), edge: rotateDir(conn.entry.edge, 1) },
      exit: { cell: turnCell(conn.exit.cell, w), edge: rotateDir(conn.exit.edge, 1) },
    },
    centreline: base && ((t) => turnPoint(base(t), w)),
  };
}

/**
 * The same tile travelled exit -> entry. Turns a right corner into a left corner using the
 * same model (`TileDef.reversed` is true; `tileTransform` is unaffected).
 */
export function reverseTile(def: TileDef): TileDef {
  const base = def.centreline;
  return {
    ...def,
    id: def.reversed ? def.id.replace(/~rev$/, '') : `${def.id}~rev`,
    reversed: !def.reversed,
    connectors: def.connectors && { entry: def.connectors.exit, exit: def.connectors.entry },
    turn: def.turn && (def.turn === 'left' ? 'right' : 'left'),
    centreline: base && ((t) => base(1 - t)),
  };
}

/** Connectors in global cell coordinates for a catalog def placed at `placement`. */
export function placedConnectors(
  def: TileDef,
  placement: Placement,
): { entry: Connector; exit: Connector } | null {
  const rotated = rotateTile(def, placement.rotation);
  if (!rotated.connectors) return null;
  const shift = (c: Connector): Connector => ({
    cell: { x: c.cell.x + placement.cell.x, z: c.cell.z + placement.cell.z },
    edge: c.edge,
  });
  return { entry: shift(rotated.connectors.entry), exit: shift(rotated.connectors.exit) };
}

/** Global cells covered by a catalog def placed at `placement`. */
export function placedCells(def: TileDef, placement: Placement): Vec2[] {
  const { w, d } = rotateTile(def, placement.rotation).footprint;
  const cells: Vec2[] = [];
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) cells.push({ x: placement.cell.x + x, z: placement.cell.z + z });
  return cells;
}

/**
 * True if a road leaving through `exit` (global coordinates) arrives exactly at `entry`:
 * entry is in the neighbouring cell and on the facing edge.
 */
export function connectorsMatch(exit: Connector, entry: Connector): boolean {
  const next = neighbourCell(exit.cell, exit.edge);
  return (
    next.x === entry.cell.x && next.z === entry.cell.z && entry.edge === oppositeDir(exit.edge)
  );
}

/**
 * Find the placement of `next` (any rotation) whose entry joins `exit` (global coordinates).
 * Returns `null` if `next` has no connectors or no rotation fits. `next` may be a reversed
 * def; its `model` rotation is still `placement.rotation` (see `tileTransform`).
 */
export function placementToJoin(exit: Connector, next: TileDef): Placement | null {
  if (!next.connectors) return null;
  const target = neighbourCell(exit.cell, exit.edge);
  for (const rotation of [0, 90, 180, 270] as const) {
    const r = rotateTile(next, rotation);
    const entry = r.connectors?.entry;
    if (!entry || entry.edge !== oppositeDir(exit.edge)) continue;
    return { cell: { x: target.x - entry.cell.x, z: target.z - entry.cell.z }, rotation };
  }
  return null;
}

/**
 * Where to put the loaded model (origin at its SW corner, see file header) so it renders
 * as `def` placed at `placement`. Units are tile units; multiply `x`/`z` by `worldScale`
 * for metres. `rotationY` is radians about +y (apply with `object.rotation.y`).
 */
export function tileTransform(
  def: TileDef,
  placement: Placement,
): { x: number; z: number; rotationY: number } {
  // The model origin is the SW corner = (0, d) in the unrotated NW frame. Rotate it along.
  let { w, d } = def.footprint;
  if (def.quarterTurns !== 0) {
    // `def` must be a catalog (unrotated) definition: model geometry is not rotated.
    throw new Error(`tileTransform needs an unrotated TileDef, got ${def.id}`);
  }
  let p: Vec2 = { x: 0, z: d };
  for (let i = 0; i < rotationToQuarters(placement.rotation); i++) {
    p = turnPoint(p, w);
    [w, d] = [d, w];
  }
  return {
    x: placement.cell.x + p.x,
    z: placement.cell.z + p.z,
    rotationY: (placement.rotation * Math.PI) / 180,
  };
}

/** World-space (tile units) centreline point of a placed tile, entry -> exit. */
export function placedCentreline(def: TileDef, placement: Placement, t: number): Vec2 | null {
  const r = rotateTile(def, placement.rotation);
  if (!r.centreline) return null;
  const p = r.centreline(t);
  return { x: p.x + placement.cell.x, z: p.z + placement.cell.z };
}

// ---------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------

/** Road half-width inside a cell: the centreline runs through the cell middle. */
const MID = 0.5;

function straight(id: string, model: string, d: number, kind: TileKind): TileDef {
  return {
    id,
    model,
    footprint: { w: 1, d },
    kind,
    connectors: {
      entry: { cell: { x: 0, z: d - 1 }, edge: 'S' },
      exit: { cell: { x: 0, z: 0 }, edge: 'N' },
    },
    quarterTurns: 0,
    reversed: false,
    length: d,
    centreline: (t) => ({ x: MID, z: d * (1 - t) }),
  };
}

/** n x n corner: quarter circle of radius n-0.5 about the SE corner (n, n), right turn. */
function corner(id: string, model: string, n: number): TileDef {
  const r = n - MID;
  return {
    id,
    model,
    footprint: { w: n, d: n },
    kind: 'corner',
    connectors: {
      entry: { cell: { x: 0, z: n - 1 }, edge: 'S' },
      exit: { cell: { x: n - 1, z: 0 }, edge: 'E' },
    },
    turn: 'right',
    quarterTurns: 0,
    reversed: false,
    length: (Math.PI / 2) * r,
    centreline: (t) => {
      const a = (Math.PI / 2) * t;
      return { x: n - r * Math.cos(a), z: n - r * Math.sin(a) };
    },
  };
}

/**
 * Start/finish: `roadStartPositions` (grid-marked straight) is used rather than `roadStart`
 * (overhead gantry): it keeps the 1x2 footprint exactly and has no tall geometry in the
 * way of cameras or sensors. The gantry can be added later as a prop.
 */
export const TILE_CATALOG: readonly TileDef[] = [
  straight('roadStraight', 'roadStraight', 1, 'straight'),
  straight('roadStraightLong', 'roadStraightLong', 2, 'straight'),
  corner('roadCornerSmall', 'roadCornerSmall', 1),
  corner('roadCornerLarge', 'roadCornerLarge', 2),
  corner('roadCornerLarger', 'roadCornerLarger', 3),
  straight('roadStartPositions', 'roadStartPositions', 2, 'start_finish'),
  {
    id: 'grass',
    model: 'grass',
    footprint: { w: 1, d: 1 },
    kind: 'filler',
    connectors: null,
    quarterTurns: 0,
    reversed: false,
    length: 0,
    centreline: null,
  },
];

export function getTile(id: string): TileDef {
  const t = TILE_CATALOG.find((d) => d.id === id);
  if (!t) throw new Error(`Unknown tile id: ${id}`);
  return t;
}
