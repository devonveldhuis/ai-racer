import { describe, expect, it } from 'vitest';
import { connectorsMatch, placedConnectors, type Vec2 } from '../assets/tiles';
import { trackToAscii } from './ascii';
import { generateTrack, layoutFromPieces, type PieceSpec } from './generator';
import { cellKey, DEFAULT_TRACK_OPTIONS, dirHeading, headingVector, pieceDef } from './layout';
import { validateLayout } from './validate';

const SEEDS = Array.from({ length: 500 }, (_, i) => i);

// Generated once and shared by the tests below.
const timings: number[] = [];
const layouts = SEEDS.map((seed) => {
  const t0 = performance.now();
  const layout = generateTrack(seed);
  timings.push(performance.now() - t0);
  return layout;
});

const straight = (): PieceSpec => ({ tileId: 'roadStraight', reversed: false });
const smallRight = (): PieceSpec => ({ tileId: 'roadCornerSmall', reversed: false });
const smallLeft = (): PieceSpec => ({ tileId: 'roadCornerSmall', reversed: true });

/** Clockwise (right-turning) rectangle, start piece heading north at the origin. */
const CLOCKWISE: PieceSpec[] = [
  smallRight(),
  straight(),
  smallRight(),
  straight(),
  straight(),
  straight(),
  smallRight(),
  straight(),
  smallRight(),
  straight(),
];
/** The mirror image: all corners are left turns. */
const ANTI_CLOCKWISE: PieceSpec[] = CLOCKWISE.map((s) =>
  s.tileId === 'roadCornerSmall' ? smallLeft() : s,
);

describe('generateTrack', () => {
  it('is deterministic for the same seed and options', () => {
    expect(generateTrack(1234)).toEqual(generateTrack(1234));
    const opts = { minPieces: 20, maxPieces: 30, clearance: 1 };
    expect(generateTrack(77, opts)).toEqual(generateTrack(77, opts));
  });

  it('gives different tracks for different seeds', () => {
    const shapes = new Set(layouts.slice(0, 50).map((l) => trackToAscii(l)));
    expect(shapes.size).toBeGreaterThan(45);
  });

  it('resolves the options onto the layout', () => {
    const l = generateTrack(5);
    expect(l.seed).toBe(5);
    expect(l.options).toEqual(DEFAULT_TRACK_OPTIONS);
    expect(generateTrack(5, { minPieces: 12 }).options.minPieces).toBe(12);
  });

  it('produces valid loops for 500 seeds with default options', () => {
    expect(layouts).toHaveLength(500);
    for (const l of layouts) {
      expect(validateLayout(l), `seed ${l.seed}`).toEqual([]);
      const n = l.pieces.length;
      expect(n).toBeGreaterThanOrEqual(16);
      expect(n).toBeLessThanOrEqual(40);
      expect(l.pieces.filter((p) => p.kind === 'start_finish')).toHaveLength(1);
      expect(l.pieces[0]?.tileId).toBe('roadStartPositions');
      expect(l.pieces[n - 1]?.kind).toBe('straight');
    }
  });

  it('chains every exit to the next entry, including the wrap-around', () => {
    for (const l of layouts) {
      const n = l.pieces.length;
      l.pieces.forEach((a, i) => {
        const b = l.pieces[(i + 1) % n]!;
        const ca = placedConnectors(pieceDef(a), a.placement)!;
        const cb = placedConnectors(pieceDef(b), b.placement)!;
        expect(connectorsMatch(ca.exit, cb.entry), `seed ${l.seed} piece ${i}`).toBe(true);
        expect(a.exitDir).toBe(b.entryDir);
      });
    }
  });

  it('has an occupancy map that matches the pieces, with no overlaps', () => {
    for (const l of layouts.slice(0, 100)) {
      const total = l.pieces.reduce((s, p) => s + p.cells.length, 0);
      expect(l.occupancy.size).toBe(total);
      for (const p of l.pieces)
        for (const c of p.cells) {
          expect(l.occupancy.get(cellKey(c))).toBe(p.index);
          expect(l.pieceAt(c)).toBe(p.index);
        }
      expect(l.pieceAt({ x: 9999, z: 9999 })).toBeNull();
      for (const c of l.occupancy.keys()) {
        const [x, z] = c.split(',').map(Number) as [number, number];
        expect(x).toBeGreaterThanOrEqual(l.bounds.min.x);
        expect(x).toBeLessThanOrEqual(l.bounds.max.x);
        expect(z).toBeGreaterThanOrEqual(l.bounds.min.z);
        expect(z).toBeLessThanOrEqual(l.bounds.max.z);
      }
    }
  });

  it('keeps clearance: no non-consecutive pieces share an edge', () => {
    for (const l of layouts) {
      for (const p of l.pieces)
        for (const c of p.cells)
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const q = l.pieceAt({ x: c.x + dx, z: c.z + dz });
            if (q === null || q === p.index) continue;
            const d = Math.abs(q - p.index);
            expect(d === 1 || d === l.pieces.length - 1, `seed ${l.seed}: ${p.index}/${q}`).toBe(
              true,
            );
          }
    }
  });

  it('mixes corner sizes and both turn directions', () => {
    const count: Record<string, number> = {};
    let lefts = 0;
    let rights = 0;
    for (const l of layouts)
      for (const p of l.pieces) {
        if (p.kind !== 'corner') continue;
        count[p.tileId] = (count[p.tileId] ?? 0) + 1;
        if (p.turn === 'left') lefts++;
        else rights++;
      }
    const total = Object.values(count).reduce((a, b) => a + b, 0);
    for (const id of ['roadCornerSmall', 'roadCornerLarge', 'roadCornerLarger'])
      expect((count[id] ?? 0) / total).toBeGreaterThan(0.2);
    expect(Math.abs(lefts - rights) / total).toBeLessThan(0.1);
  });

  it('generates a typical track in well under 50 ms (median)', () => {
    const sorted = [...timings].sort((a, b) => a - b);
    expect(sorted[sorted.length >> 1]).toBeLessThan(50);
  });

  it('respects custom options', () => {
    const l = generateTrack(3, {
      minPieces: 10,
      maxPieces: 14,
      allowedTiles: ['roadStraight', 'roadCornerLarge'],
      checkpointEvery: 3,
      clearance: 1,
    });
    expect(validateLayout(l)).toEqual([]);
    expect(l.pieces.length).toBeGreaterThanOrEqual(10);
    expect(l.pieces.length).toBeLessThanOrEqual(14);
    for (const p of l.pieces)
      expect(['roadStartPositions', 'roadStraight', 'roadCornerLarge']).toContain(p.tileId);
    expect(l.checkpoints.map((c) => c.pieceIndex).slice(0, 2)).toEqual([3, 6]);
    const noCorners = generateTrack(4, { kindWeights: { corner: 0.2 } });
    expect(validateLayout(noCorners)).toEqual([]);
  });

  it('weights bias the mix', () => {
    const share = (w: Record<string, number>): number => {
      let big = 0;
      let corners = 0;
      for (let s = 0; s < 40; s++)
        for (const p of generateTrack(s, { tileWeights: w }).pieces)
          if (p.kind === 'corner') {
            corners++;
            if (p.tileId === 'roadCornerLarger') big++;
          }
      return big / corners;
    };
    expect(share({ roadCornerLarger: 6 })).toBeGreaterThan(share({ roadCornerLarger: 0.2 }) + 0.2);
  });

  it('throws a clear error naming the seed and options when it cannot close', () => {
    expect(() => generateTrack(99, { minPieces: 5, maxPieces: 5, maxAttempts: 3 })).toThrow(
      /seed 99.*3 attempts.*"maxAttempts":3/s,
    );
  });

  it('rejects bad options', () => {
    expect(() => generateTrack(1, { allowedTiles: ['roadCornerSmall'] })).toThrow(/straight/);
    expect(() => generateTrack(1, { allowedTiles: ['grass', 'roadStraight'] })).toThrow(
      /not a road tile/,
    );
    expect(() => generateTrack(1, { allowedTiles: ['nope'] })).toThrow(/Unknown tile/);
    expect(() => generateTrack(1, { minPieces: 20, maxPieces: 10 })).toThrow(/maxPieces/);
    expect(() => generateTrack(1, { checkpointEvery: 0 })).toThrow(/checkpointEvery/);
  });
});

describe('centreline', () => {
  it('is a closed, evenly sampled polyline with unit tangents', () => {
    for (const l of layouts.slice(0, 100)) {
      const { points, distance, tangent, pieceIndex, totalLength } = l.centreline;
      const n = points.length;
      expect(distance).toHaveLength(n);
      expect(tangent).toHaveLength(n);
      expect(pieceIndex).toHaveLength(n);
      expect(distance[0]).toBe(0);
      for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const step = Math.hypot(b.x - a.x, b.z - a.z);
        expect(step, `seed ${l.seed} point ${i}`).toBeGreaterThan(0.05);
        expect(step).toBeLessThanOrEqual(0.2 + 1e-9); // no jumps, including the closing step
        if (i > 0) expect(distance[i]!).toBeGreaterThan(distance[i - 1]!);
        const t = tangent[i]!;
        expect(Math.hypot(t.x, t.z)).toBeCloseTo(1, 9);
        const u = tangent[(i + 1) % n]!;
        expect(t.x * u.x + t.z * u.z).toBeGreaterThan(0.9);
        expect((b.x - a.x) * t.x + (b.z - a.z) * t.z).toBeGreaterThan(0);
        const pi = pieceIndex[i]!;
        expect(pi === 0 || pi >= pieceIndex[i - 1]!).toBe(true);
      }
      const expectedLength = l.pieces.reduce((s, p) => s + pieceDef(p).length, 0);
      expect(totalLength).toBeLessThanOrEqual(expectedLength + 1e-9);
      expect(totalLength).toBeGreaterThan(expectedLength * 0.99);
      expect(totalLength).toBeGreaterThan(distance[n - 1]!);
    }
  });

  it('lies inside the cells of the piece it belongs to', () => {
    for (const l of layouts.slice(0, 100)) {
      l.centreline.points.forEach((p, i) => {
        // Nudge along the tangent: piece boundaries lie exactly on cell edges.
        const q = l.centreline.tangent[i]!;
        const cell = { x: Math.floor(p.x + q.x * 1e-6), z: Math.floor(p.z + q.z * 1e-6) };
        expect(l.pieceAt(cell), `seed ${l.seed} point ${i}`).toBe(l.centreline.pieceIndex[i]);
      });
    }
  });

  it('starts with the start piece, heading along its direction', () => {
    for (const l of layouts.slice(0, 50)) {
      expect(l.centreline.pieceIndex[0]).toBe(0);
      const h = headingVector(dirHeading(l.pieces[0]!.entryDir));
      expect(l.centreline.tangent[1]!.x).toBeCloseTo(h.x, 9);
      expect(l.centreline.tangent[1]!.z).toBeCloseTo(h.z, 9);
    }
  });
});

function segmentsIntersect(p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean {
  const cross = (a: Vec2, b: Vec2, c: Vec2): number =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = cross(p, q, r);
  const d2 = cross(p, q, s);
  const d3 = cross(r, s, p);
  const d4 = cross(r, s, q);
  const e = 1e-9;
  return (
    ((d1 > e && d2 < -e) || (d1 < -e && d2 > e) || Math.abs(d1) <= e || Math.abs(d2) <= e) &&
    ((d3 > e && d4 < -e) || (d3 < -e && d4 > e) || Math.abs(d3) <= e || Math.abs(d4) <= e)
  );
}

describe('checkpoints', () => {
  it('are ordered, every N pieces, ending at the start/finish line', () => {
    for (const l of layouts.slice(0, 100)) {
      const every = l.options.checkpointEvery;
      const cps = l.checkpoints;
      cps.forEach((c, i) => expect(c.index).toBe(i));
      const last = cps[cps.length - 1]!;
      expect(last.pieceIndex).toBe(0);
      expect(last.position).toEqual(l.centreline.points[0]);
      const interior = cps.slice(0, -1).map((c) => c.pieceIndex);
      expect(interior).toEqual(
        Array.from({ length: Math.ceil(l.pieces.length / every) - 1 }, (_, i) => (i + 1) * every),
      );
      // Distances along the centreline increase up to the finish line (distance 0).
      let prev = -1;
      for (const c of interior) {
        const k = l.centreline.pieceIndex.indexOf(c);
        expect(l.centreline.distance[k]!).toBeGreaterThan(prev);
        prev = l.centreline.distance[k]!;
      }
    }
  });

  it('span the road across the centreline, perpendicular to the driving direction', () => {
    for (const l of layouts.slice(0, 100)) {
      const { points, tangent } = l.centreline;
      for (const c of l.checkpoints) {
        expect(Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z)).toBeCloseTo(1, 9);
        expect(Math.hypot(c.normal.x, c.normal.z)).toBeCloseTo(1, 9);
        expect((c.b.x - c.a.x) * c.normal.x + (c.b.z - c.a.z) * c.normal.z).toBeCloseTo(0, 9);
        expect(c.position.x).toBeCloseTo((c.a.x + c.b.x) / 2, 9);
        expect(c.position.z).toBeCloseTo((c.a.z + c.b.z) / 2, 9);
        // `b` is on the driver's right.
        expect((c.b.x - c.a.x) * -c.normal.z + (c.b.z - c.a.z) * c.normal.x).toBeGreaterThan(0);
        const k = l.centreline.pieceIndex.indexOf(c.pieceIndex);
        expect(points[k]!.x).toBeCloseTo(c.position.x, 9);
        expect(points[k]!.z).toBeCloseTo(c.position.z, 9);
        expect(tangent[k]!.x).toBeCloseTo(c.normal.x, 3);
        expect(tangent[k]!.z).toBeCloseTo(c.normal.z, 3);
        let hits = 0;
        for (let i = 0; i < points.length; i++)
          if (segmentsIntersect(c.a, c.b, points[i]!, points[(i + 1) % points.length]!)) hits++;
        expect(hits, `seed ${l.seed} checkpoint ${c.index}`).toBeGreaterThanOrEqual(1);
        expect(hits).toBeLessThanOrEqual(2); // the sample point itself, seen from two segments
      }
    }
  });
});

describe('startPose', () => {
  it('is on the start piece centreline, facing the driving direction', () => {
    for (const l of layouts.slice(0, 100)) {
      const { position, heading } = l.startPose;
      expect(l.pieceAt({ x: Math.floor(position.x), z: Math.floor(position.z) })).toBe(0);
      const v = headingVector(heading);
      const t0 = l.centreline.tangent[0]!;
      expect(v.x).toBeCloseTo(t0.x, 9);
      expect(v.z).toBeCloseTo(t0.z, 9);
      // Lateral distance to the start piece centreline is zero.
      const pts = l.centreline.points.filter((_, i) => l.centreline.pieceIndex[i] === 0);
      const a = pts[0]!;
      const along = (position.x - a.x) * v.x + (position.z - a.z) * v.z;
      const lateral = (position.x - a.x) * -v.z + (position.z - a.z) * v.x;
      expect(lateral).toBeCloseTo(0, 9);
      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(2);
    }
  });

  it('is at the rear painted slot of a north-facing start piece', () => {
    const l = layoutFromPieces(0, {}, CLOCKWISE, 0);
    expect(l.startPose.position.x).toBeCloseTo(0.5, 9);
    expect(l.startPose.position.z).toBeCloseTo(1.25, 9);
    expect(l.startPose.heading).toBe(0);
  });
});

describe('hand-checked layouts', () => {
  it('clockwise loop: right corners, checkpoint positions, ascii', () => {
    const l = layoutFromPieces(0, {}, CLOCKWISE, 0);
    expect(l.pieces).toHaveLength(11);
    expect(l.bounds).toEqual({ min: { x: 0, z: -1 }, max: { x: 2, z: 3 } });
    expect(l.pieces.map((p) => p.entryDir)).toEqual([
      'N',
      'N',
      'E',
      'E',
      'S',
      'S',
      'S',
      'S',
      'W',
      'W',
      'N',
    ]);
    expect(l.cellInfo({ x: 0, z: -1 })).toEqual({ pieceIndex: 1, kind: 'corner', turn: 'right' });
    expect(l.cellInfo({ x: 2, z: -1 })).toEqual({ pieceIndex: 3, kind: 'corner', turn: 'right' });
    expect(l.cellInfo({ x: 2, z: 3 })).toEqual({ pieceIndex: 7, kind: 'corner', turn: 'right' });
    expect(l.cellInfo({ x: 1, z: -1 })).toEqual({ pieceIndex: 2, kind: 'straight', turn: null });
    expect(l.cellInfo({ x: 0, z: 1 })).toEqual({
      pieceIndex: 0,
      kind: 'start_finish',
      turn: null,
    });
    expect(l.cellInfo({ x: 1, z: 1 })).toBeNull(); // inside the loop
    expect(l.cellInfo({ x: 5, z: 5 })).toBeNull();
    expect(l.checkpoints.map((c) => c.pieceIndex)).toEqual([4, 8, 0]);
    expect(l.checkpoints[0]!.position).toEqual({ x: 2.5, z: 0 });
    expect(l.checkpoints[0]!.normal).toEqual({ x: 0, z: 1 });
    expect(l.checkpoints[2]!.position).toEqual({ x: 0.5, z: 2 });
    expect(l.checkpoints[2]!.normal).toEqual({ x: 0, z: -1 });
    expect(trackToAscii(l)).toBe('R>R\n^.v\nS.v\n^.v\nR<R');
    expect(validateLayout(l).filter((e) => !e.includes('piece count'))).toEqual([]);
  });

  it('anti-clockwise loop: left corners relative to the driving direction', () => {
    const l = layoutFromPieces(0, {}, ANTI_CLOCKWISE, 0);
    expect(l.bounds).toEqual({ min: { x: -2, z: -1 }, max: { x: 0, z: 3 } });
    for (const [x, z] of [
      [0, -1],
      [-2, -1],
      [-2, 3],
      [0, 3],
    ] as const)
      expect(l.cellInfo({ x, z })).toMatchObject({ kind: 'corner', turn: 'left' });
    expect(l.cellInfo({ x: -1, z: -1 })).toMatchObject({ kind: 'straight', turn: null });
    expect(l.pieces[1]?.reversed).toBe(true);
    expect(l.pieces[1]?.tileId).toBe('roadCornerSmall');
    expect(trackToAscii(l)).toBe('L<L\nv.^\nv.S\nv.^\nL>L');
  });

  it('turn is relative to the driving direction for a rotated start', () => {
    // Same clockwise loop with the start piece facing east: still right turns.
    const l = layoutFromPieces(0, {}, CLOCKWISE, 270);
    expect(l.pieces[0]?.entryDir).toBe('E');
    expect(l.startPose.heading).toBeCloseTo(Math.PI / 2, 9);
    const turns = new Set(l.pieces.filter((p) => p.kind === 'corner').map((p) => p.turn));
    expect([...turns]).toEqual(['right']);
    expect(validateLayout(l).filter((e) => !e.includes('piece count'))).toEqual([]);
  });

  it('multi-cell corners report their turn on every cell of the footprint', () => {
    const l = generateTrack(11, { allowedTiles: ['roadStraight', 'roadCornerLarger'] });
    const corners = l.pieces.filter((p) => p.kind === 'corner');
    expect(corners.length).toBeGreaterThan(0);
    for (const p of corners) {
      expect(p.cells).toHaveLength(9);
      for (const c of p.cells)
        expect(l.cellInfo(c)).toEqual({ pieceIndex: p.index, kind: 'corner', turn: p.turn });
    }
  });

  it('refuses pieces that do not close or that overlap', () => {
    expect(() => layoutFromPieces(0, {}, [smallRight(), straight()])).toThrow(/closed|overlap/);
    expect(() =>
      layoutFromPieces(0, {}, [
        smallRight(),
        smallRight(),
        smallRight(),
        smallRight(),
        smallRight(),
      ]),
    ).toThrow();
  });
});

describe('headings', () => {
  it('are consistent with DIR_VECTORS', () => {
    expect(dirHeading('N')).toBe(0);
    expect(dirHeading('E')).toBeCloseTo(Math.PI / 2, 12);
    expect(dirHeading('S')).toBeCloseTo(Math.PI, 12);
    expect(dirHeading('W')).toBeCloseTo(-Math.PI / 2, 12);
    const v = headingVector(dirHeading('E'));
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });
});
