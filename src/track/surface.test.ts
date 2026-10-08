import { describe, expect, it } from 'vitest';
import {
  getTile,
  placedCells,
  placedCentreline,
  rotateDir,
  rotateTile,
  type Placement,
  type Rotation,
} from '../assets/tiles';
import { generateTrack, layoutFromPieces, type PieceSpec } from './generator';
import {
  cellKey,
  DEFAULT_TRACK_OPTIONS,
  pieceDef,
  TrackLayout,
  type TrackLayoutData,
  type TrackPiece,
} from './layout';
import { surfaceAtGrid } from './surface';

/** A layout holding one isolated piece (not a loop): enough for surface lookups. */
function singlePiece(tileId: string, placement: Placement, reversed = false): TrackLayout {
  const def = getTile(tileId);
  const cells = placedCells(def, placement);
  const q = placement.rotation / 90;
  const piece: TrackPiece = {
    index: 0,
    tileId,
    placement,
    reversed,
    entryDir: rotateDir('N', q),
    exitDir: rotateDir('N', q),
    cells,
    kind: def.kind,
    turn: null,
  };
  const xs = cells.map((c) => c.x);
  const zs = cells.map((c) => c.z);
  return new TrackLayout({
    seed: 0,
    options: DEFAULT_TRACK_OPTIONS,
    attempts: 1,
    pieces: [piece],
    occupancy: new Map(cells.map((c) => [cellKey(c), 0])),
    bounds: {
      min: { x: Math.min(...xs), z: Math.min(...zs) },
      max: { x: Math.max(...xs), z: Math.max(...zs) },
    },
  } as unknown as TrackLayoutData);
}

const M = 3;

describe('surfaceAtGrid: straights', () => {
  // roadStraightLong at cell (10, 20), rotation 0: x in [10,11], z in [20,22], road along z.
  const north = singlePiece('roadStraightLong', { cell: { x: 10, z: 20 }, rotation: 0 });
  it('classifies by distance from the centre line (north/south piece)', () => {
    expect(surfaceAtGrid(north, 10.5, 20.5, M)).toBe('road');
    expect(surfaceAtGrid(north, 10.5 + 0.3, 21.5, M)).toBe('road');
    expect(surfaceAtGrid(north, 10.5 - 0.344, 21.5, M)).toBe('road');
    expect(surfaceAtGrid(north, 10.5 + 0.346, 21.5, M)).toBe('kerb');
    expect(surfaceAtGrid(north, 10.5 - 0.4, 20.2, M)).toBe('kerb');
    expect(surfaceAtGrid(north, 10.5 + 0.419, 21.5, M)).toBe('grass');
    expect(surfaceAtGrid(north, 10.05, 21.9, M)).toBe('grass');
  });

  it('classifies a rotated piece by the z offset (east/west piece)', () => {
    // Rotated 90: footprint 2 wide, 1 deep at cell (10, 20): x in [10,12], z in [20,21].
    const east = singlePiece('roadStraightLong', { cell: { x: 10, z: 20 }, rotation: 90 });
    expect(surfaceAtGrid(east, 11.5, 20.5, M)).toBe('road');
    expect(surfaceAtGrid(east, 10.2, 20.5 - 0.34, M)).toBe('road');
    expect(surfaceAtGrid(east, 10.2, 20.5 + 0.38, M)).toBe('kerb');
    expect(surfaceAtGrid(east, 11.5, 20.5 + 0.45, M)).toBe('grass');
    // A point that would be road for a north/south piece is grass here.
    expect(surfaceAtGrid(east, 10.5, 20.97, M)).toBe('grass');
  });

  it('works for the start piece and a rotated start piece', () => {
    const start = singlePiece('roadStartPositions', { cell: { x: 0, z: 0 }, rotation: 180 });
    expect(surfaceAtGrid(start, 0.5, 0.5, M)).toBe('road');
    expect(surfaceAtGrid(start, 0.5, 1.9, M)).toBe('road');
    expect(surfaceAtGrid(start, 0.5 + 0.38, 1.0, M)).toBe('kerb');
    expect(surfaceAtGrid(start, 0.5 - 0.45, 1.0, M)).toBe('grass');
  });

  it('is grass on empty cells inside the margin and null outside it', () => {
    // bounds: cells x=10, z=20..21.
    expect(surfaceAtGrid(north, 10.5, 19.5, M)).toBe('grass');
    expect(surfaceAtGrid(north, 7.0, 17.0, M)).toBe('grass'); // cell (7, 17): exactly margin away
    expect(surfaceAtGrid(north, 13.9, 24.9, M)).toBe('grass'); // cell (13, 24)
    expect(surfaceAtGrid(north, 6.9, 20.5, M)).toBeNull(); // cell (6, 20)
    expect(surfaceAtGrid(north, 14.0, 20.5, M)).toBeNull(); // cell (14, 20)
    expect(surfaceAtGrid(north, 10.5, 25.0, M)).toBeNull(); // cell (10, 25)
    expect(surfaceAtGrid(north, 10.5, 16.9, M)).toBeNull(); // cell (10, 16)
    expect(surfaceAtGrid(north, Number.NaN, 20.5, M)).toBeNull();
  });

  it('puts points on a cell edge in the east/south cell', () => {
    // x = 11.0 is the edge between cell 10 (road) and cell 11 (empty): east cell wins.
    expect(surfaceAtGrid(north, 11.0, 20.5, M)).toBe('grass');
    // z = 20.0 between empty cell 19 and the piece: south cell (the piece) wins.
    expect(surfaceAtGrid(north, 10.5, 20.0, M)).toBe('road');
  });
});

describe('surfaceAtGrid: corners', () => {
  // Arc centre = the SE corner of the unrotated footprint turned CCW with the piece, worked
  // out by hand for a piece of size n at cell (10, 20):
  //   rotation 0   -> SE corner (10+n, 20+n)   the interior lies towards (-1, -1)
  //   rotation 90  -> NE corner (10+n, 20)     (-1, +1)
  //   rotation 180 -> NW corner (10, 20)       (+1, +1)
  //   rotation 270 -> SW corner (10, 20+n)     (+1, -1)
  const cases: {
    rotation: Rotation;
    centre: (n: number) => [number, number];
    dir: [number, number];
  }[] = [
    { rotation: 0, centre: (n) => [10 + n, 20 + n], dir: [-1, -1] },
    { rotation: 90, centre: (n) => [10 + n, 20], dir: [-1, 1] },
    { rotation: 180, centre: () => [10, 20], dir: [1, 1] },
    { rotation: 270, centre: (n) => [10, 20 + n], dir: [1, -1] },
  ];
  const sizes: [string, number][] = [
    ['roadCornerSmall', 1],
    ['roadCornerLarge', 2],
    ['roadCornerLarger', 3],
  ];

  for (const [tileId, n] of sizes) {
    for (const reversed of [false, true]) {
      for (const c of cases) {
        it(`${tileId}${reversed ? ' (left)' : ''} rotation ${c.rotation}`, () => {
          const layout = singlePiece(
            tileId,
            { cell: { x: 10, z: 20 }, rotation: c.rotation },
            reversed,
          );
          const [cx, cz] = c.centre(n);
          const k = Math.SQRT1_2;
          // Point at distance `d` from the arc centre, 45 degrees into the footprint.
          const at = (d: number) =>
            surfaceAtGrid(layout, cx + c.dir[0] * d * k, cz + c.dir[1] * d * k, M);
          const r = n - 0.5;
          expect(at(r)).toBe('road');
          expect(at(r + 0.3)).toBe('road');
          expect(at(r - 0.3)).toBe('road');
          expect(at(r + 0.38)).toBe('kerb');
          expect(at(r - 0.38)).toBe('kerb');
          expect(at(r + 0.45)).toBe('grass'); // outside of the bend (within the footprint)
          expect(at(r - 0.45)).toBe('grass'); // inside of the bend
          expect(at(0.05)).toBe('grass'); // right next to the arc centre
        });
      }
    }
  }

  it('is grass in footprint cells away from the arc and for the cell next to the corner', () => {
    // Larger corner, rotation 0: arc centre (13, 23), r = 2.5. The NW cell (10, 20) lies at
    // distance ~ 3.5 .. 4.9 from the centre: grass. The far corner of the cell touches r = 4.2.
    const l = singlePiece('roadCornerLarger', { cell: { x: 10, z: 20 }, rotation: 0 });
    expect(surfaceAtGrid(l, 10.2, 20.2, M)).toBe('grass');
    // Centre of the SW cell's road at the S edge: arc starts at (10.5, 23).
    expect(surfaceAtGrid(l, 10.5, 22.99, M)).toBe('road');
    // Centre of the NE cell's road at the E edge: arc ends at (13, 20.5).
    expect(surfaceAtGrid(l, 12.99, 20.5, M)).toBe('road');
    // Bend interior (middle cell next to the centre).
    expect(surfaceAtGrid(l, 12.5, 22.5, M)).toBe('grass');
  });
});

describe('surfaceAtGrid: layouts', () => {
  const straight: PieceSpec = { tileId: 'roadStraight', reversed: false };
  const right: PieceSpec = { tileId: 'roadCornerSmall', reversed: false };
  const loop = layoutFromPieces(1, {}, [
    right,
    straight,
    right,
    straight,
    straight,
    straight,
    right,
    straight,
    right,
    straight,
  ]);

  it('start piece in a real loop: road on the centre line, kerb and grass to the side', () => {
    expect(surfaceAtGrid(loop, 0.5, 0.5, M)).toBe('road');
    expect(surfaceAtGrid(loop, 0.5, 1.5, M)).toBe('road');
    expect(surfaceAtGrid(loop, 0.5 + 0.38, 1.5, M)).toBe('kerb');
    expect(surfaceAtGrid(loop, 0.5 - 0.44, 1.5, M)).toBe('grass');
  });

  it('first small right corner (hand computed): arc about (1, 0), radius 0.5', () => {
    // The corner sits at cell (0, -1); the arc runs from (0.5, 0) to (1, -0.5).
    const k = Math.SQRT1_2;
    const at = (d: number) => surfaceAtGrid(loop, 1 - d * k, -d * k, M);
    expect(at(0.5)).toBe('road');
    expect(at(0.2)).toBe('road');
    expect(at(0.12)).toBe('kerb');
    expect(at(0.05)).toBe('grass'); // inside of the bend
    expect(at(0.95)).toBe('grass'); // outside of the bend
  });

  it('every tile/rotation/turn: centre line is road, lateral offsets give kerb and grass', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const l = generateTrack(seed);
      for (const piece of l.pieces) {
        seen.add(`${piece.tileId}/${piece.placement.rotation}/${piece.reversed}`);
        const def = rotateTile(pieceDef(piece), piece.placement.rotation);
        for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const f = (u: number) => placedCentreline(pieceDef(piece), piece.placement, u)!;
          const p = f(t);
          const a = f(t - 0.001);
          const b = f(t + 0.001);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          const at = (o: number) => surfaceAtGrid(l, p.x + nx * o, p.z + nz * o, M);
          expect(at(0), `${def.id} t=${t}`).toBe('road');
          for (const sign of [-1, 1]) {
            expect(at(sign * 0.3)).toBe('road');
            expect(at(sign * 0.38)).toBe('kerb');
            expect(at(sign * 0.45)).toBe('grass');
          }
        }
      }
    }
    // Every straight/corner variant was covered, including both turn directions.
    for (const id of ['roadCornerSmall', 'roadCornerLarge', 'roadCornerLarger']) {
      for (const rot of [0, 90, 180, 270]) {
        for (const rev of [false, true]) expect(seen.has(`${id}/${rot}/${rev}`)).toBe(true);
      }
    }
  });
});

describe('property: centreline and checkpoints over 50 seeds', () => {
  it('every centreline point is road; every checkpoint end point is not road', () => {
    for (let seed = 0; seed < 50; seed++) {
      const l = generateTrack(seed);
      for (const p of l.centreline.points) {
        expect(surfaceAtGrid(l, p.x, p.z, M), `seed ${seed} centreline`).toBe('road');
      }
      for (const cp of l.checkpoints) {
        expect(surfaceAtGrid(l, cp.a.x, cp.a.z, M), `seed ${seed} cp ${cp.index} a`).not.toBe(
          'road',
        );
        expect(surfaceAtGrid(l, cp.b.x, cp.b.z, M), `seed ${seed} cp ${cp.index} b`).not.toBe(
          'road',
        );
      }
    }
  });
});
