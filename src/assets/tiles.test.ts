import { describe, expect, it } from 'vitest';
import {
  TILE_CATALOG,
  connectorsMatch,
  getTile,
  placedCells,
  placedCentreline,
  placedConnectors,
  placementToJoin,
  reverseTile,
  rotateDir,
  rotateTile,
  tileTransform,
  type Placement,
} from './tiles';
import { surfaceForMaterial } from './surfaces';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('rotateDir', () => {
  it('turns counter-clockwise: E -> N -> W -> S -> E', () => {
    expect(rotateDir('E', 1)).toBe('N');
    expect(rotateDir('N', 1)).toBe('W');
    expect(rotateDir('W', 1)).toBe('S');
    expect(rotateDir('S', 1)).toBe('E');
    expect(rotateDir('S', 4)).toBe('S');
    expect(rotateDir('S', -1)).toBe('W');
  });
});

describe('rotateTile', () => {
  it('swaps footprint for non-square tiles', () => {
    const long = getTile('roadStraightLong');
    expect(rotateTile(long, 0).footprint).toEqual({ w: 1, d: 2 });
    expect(rotateTile(long, 90).footprint).toEqual({ w: 2, d: 1 });
    expect(rotateTile(long, 180).footprint).toEqual({ w: 1, d: 2 });
    expect(rotateTile(long, 270).footprint).toEqual({ w: 2, d: 1 });
  });

  it('rotates straight connectors', () => {
    const r = rotateTile(getTile('roadStraightLong'), 90);
    expect(r.connectors?.entry.edge).toBe('E');
    expect(r.connectors?.exit.edge).toBe('W');
    expect(r.connectors?.entry.cell).toEqual({ x: 1, z: 0 });
    expect(r.connectors?.exit.cell).toEqual({ x: 0, z: 0 });
  });

  it('rotates corner connectors and keeps them inside the footprint', () => {
    const c = getTile('roadCornerLarge');
    // Unrotated: enter S edge of SW cell, leave E edge of NE cell.
    expect(c.connectors?.entry).toEqual({ cell: { x: 0, z: 1 }, edge: 'S' });
    expect(c.connectors?.exit).toEqual({ cell: { x: 1, z: 0 }, edge: 'E' });
    const r90 = rotateTile(c, 90);
    expect(r90.connectors?.entry).toEqual({ cell: { x: 1, z: 1 }, edge: 'E' });
    expect(r90.connectors?.exit).toEqual({ cell: { x: 0, z: 0 }, edge: 'N' });
    for (const rot of [0, 90, 180, 270] as const) {
      const r = rotateTile(c, rot);
      for (const k of [r.connectors!.entry, r.connectors!.exit]) {
        expect(k.cell.x).toBeGreaterThanOrEqual(0);
        expect(k.cell.x).toBeLessThan(r.footprint.w);
        expect(k.cell.z).toBeGreaterThanOrEqual(0);
        expect(k.cell.z).toBeLessThan(r.footprint.d);
      }
    }
  });

  it('four quarter turns are the identity', () => {
    for (const def of TILE_CATALOG) {
      const r = rotateTile(rotateTile(def, 90), 270);
      expect(r.footprint).toEqual(def.footprint);
      expect(r.connectors).toEqual(def.connectors);
      expect(r.quarterTurns).toBe(0);
    }
  });

  it('rotates the centreline with the connectors', () => {
    for (const def of TILE_CATALOG.filter((d) => d.centreline)) {
      for (const rot of [0, 90, 180, 270] as const) {
        const r = rotateTile(def, rot);
        const start = r.centreline!(0);
        const end = r.centreline!(1);
        const e = r.connectors!.entry;
        const x = r.connectors!.exit;
        // Endpoint lies on the connector's edge midpoint.
        const mid = (c: typeof e) => {
          const v = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[c.edge];
          return { x: c.cell.x + 0.5 + v[0]! * 0.5, z: c.cell.z + 0.5 + v[1]! * 0.5 };
        };
        close(start.x, mid(e).x);
        close(start.z, mid(e).z);
        close(end.x, mid(x).x);
        close(end.z, mid(x).z);
      }
    }
  });
});

describe('catalog', () => {
  it('has the required tiles with the measured footprints', () => {
    const fp = (id: string) => getTile(id).footprint;
    expect(fp('roadStraight')).toEqual({ w: 1, d: 1 });
    expect(fp('roadStraightLong')).toEqual({ w: 1, d: 2 });
    expect(fp('roadCornerSmall')).toEqual({ w: 1, d: 1 });
    expect(fp('roadCornerLarge')).toEqual({ w: 2, d: 2 });
    expect(fp('roadCornerLarger')).toEqual({ w: 3, d: 3 });
    expect(fp('roadStartPositions')).toEqual({ w: 1, d: 2 });
    expect(getTile('roadStartPositions').kind).toBe('start_finish');
    expect(getTile('grass').kind).toBe('filler');
    expect(getTile('grass').connectors).toBeNull();
  });

  it('corner centrelines are quarter arcs of radius n-0.5 about the SE corner', () => {
    for (const [id, n] of [
      ['roadCornerSmall', 1],
      ['roadCornerLarge', 2],
      ['roadCornerLarger', 3],
    ] as const) {
      const c = getTile(id);
      for (const t of [0, 0.25, 0.5, 0.9, 1]) {
        const p = c.centreline!(t);
        close(Math.hypot(p.x - n, p.z - n), n - 0.5);
      }
      close(c.length, (Math.PI / 2) * (n - 0.5));
      expect(c.turn).toBe('right');
    }
  });

  it('reverse flips turn and swaps connectors', () => {
    const c = getTile('roadCornerLarge');
    const l = reverseTile(c);
    expect(l.turn).toBe('left');
    expect(l.connectors?.entry).toEqual(c.connectors?.exit);
    expect(l.centreline!(0)).toEqual(c.centreline!(1));
    expect(reverseTile(l).id).toBe(c.id);
  });
});

describe('connector matching', () => {
  it('matches facing connectors in neighbouring cells only', () => {
    expect(
      connectorsMatch({ cell: { x: 0, z: 0 }, edge: 'N' }, { cell: { x: 0, z: -1 }, edge: 'S' }),
    ).toBe(true);
    expect(
      connectorsMatch({ cell: { x: 0, z: 0 }, edge: 'N' }, { cell: { x: 0, z: 1 }, edge: 'S' }),
    ).toBe(false);
    expect(
      connectorsMatch({ cell: { x: 0, z: 0 }, edge: 'N' }, { cell: { x: 0, z: -1 }, edge: 'N' }),
    ).toBe(false);
    expect(
      connectorsMatch({ cell: { x: 0, z: 0 }, edge: 'E' }, { cell: { x: 1, z: 0 }, edge: 'W' }),
    ).toBe(true);
  });

  it('joins a corner after a straight (north, then turning east)', () => {
    const straight = getTile('roadStraight');
    const sp: Placement = { cell: { x: 5, z: 5 }, rotation: 0 };
    const exit = placedConnectors(straight, sp)!.exit;
    expect(exit).toEqual({ cell: { x: 5, z: 5 }, edge: 'N' });

    const corner = getTile('roadCornerLarge');
    const cp = placementToJoin(exit, corner)!;
    expect(cp.rotation).toBe(0);
    // Entry is the S edge of the SW cell, so the corner's SW cell sits directly north.
    expect(cp.cell).toEqual({ x: 5, z: 3 });
    const cc = placedConnectors(corner, cp)!;
    expect(connectorsMatch(exit, cc.entry)).toBe(true);
    expect(cc.exit).toEqual({ cell: { x: 6, z: 3 }, edge: 'E' });
    // Continuous centreline across the joint (tile units).
    const a = placedCentreline(straight, sp, 1)!;
    const b = placedCentreline(corner, cp, 0)!;
    close(a.x, b.x);
    close(a.z, b.z);
  });

  it('joins tiles in every heading, with no cell overlap and a continuous centreline', () => {
    const defs = TILE_CATALOG.filter((d) => d.connectors).flatMap((d) => [d, reverseTile(d)]);
    for (const a of defs) {
      for (const b of defs) {
        for (const rot of [0, 90, 180, 270] as const) {
          const pa: Placement = { cell: { x: 10, z: 10 }, rotation: rot };
          const exit = placedConnectors(a, pa)!.exit;
          const pb = placementToJoin(exit, b)!;
          expect(pb).not.toBeNull();
          expect(connectorsMatch(exit, placedConnectors(b, pb)!.entry)).toBe(true);
          const ca = placedCells(a, pa).map((c) => `${c.x},${c.z}`);
          const cb = placedCells(b, pb).map((c) => `${c.x},${c.z}`);
          expect(cb.filter((k) => ca.includes(k))).toEqual([]);
          const p = placedCentreline(a, pa, 1)!;
          const q = placedCentreline(b, pb, 0)!;
          close(p.x, q.x);
          close(p.z, q.z);
        }
      }
    }
  });

  it('returns null for fillers', () => {
    expect(placementToJoin({ cell: { x: 0, z: 0 }, edge: 'N' }, getTile('grass'))).toBeNull();
  });
});

describe('tileTransform', () => {
  it('places the SW-origin model so its rotated footprint starts at the cell', () => {
    const long = getTile('roadStraightLong'); // model x in [0,1], z in [-2,0]
    const corners = (rot: 0 | 90 | 180 | 270) => {
      const t = tileTransform(long, { cell: { x: 3, z: 4 }, rotation: rot });
      const c = Math.cos(t.rotationY);
      const s = Math.sin(t.rotationY);
      // three.js rotation about +y: x' = x cos + z sin, z' = -x sin + z cos
      const pts = [
        [0, 0],
        [1, 0],
        [0, -2],
        [1, -2],
      ].map(([x, z]) => ({
        x: t.x + x! * c + z! * s,
        z: t.z - x! * s + z! * c,
      }));
      return {
        minX: Math.min(...pts.map((p) => p.x)),
        maxX: Math.max(...pts.map((p) => p.x)),
        minZ: Math.min(...pts.map((p) => p.z)),
        maxZ: Math.max(...pts.map((p) => p.z)),
      };
    };
    for (const rot of [0, 90, 180, 270] as const) {
      const b = corners(rot);
      const fp = rotateTile(long, rot).footprint;
      close(b.minX, 3);
      close(b.minZ, 4);
      close(b.maxX, 3 + fp.w);
      close(b.maxZ, 4 + fp.d);
    }
  });

  it('refuses rotated defs', () => {
    expect(() =>
      tileTransform(rotateTile(getTile('roadStraight'), 90), { cell: { x: 0, z: 0 }, rotation: 0 }),
    ).toThrow();
  });
});

describe('surfaceForMaterial', () => {
  it('maps known materials and ignores unknown ones', () => {
    expect(surfaceForMaterial('road')).toBe('road');
    expect(surfaceForMaterial('grey')).toBe('kerb');
    expect(surfaceForMaterial('grass')).toBe('grass');
    expect(surfaceForMaterial('sand')).toBe('sand');
    expect(surfaceForMaterial('wall')).toBe('wall');
    expect(surfaceForMaterial('_defaultMat')).toBe('kerb');
    expect(surfaceForMaterial('carTire')).toBeUndefined();
    expect(surfaceForMaterial('toString')).toBeUndefined();
  });
});
