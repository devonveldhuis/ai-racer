import { describe, expect, it } from 'vitest';
import { surfaceAtGrid } from '../track/surface';
import type { TrackLayout } from '../track/layout';
import { classifyGround, rayAngles, rayDirection, type GroundSource } from './ground';
import { FIRST_CORNER, runUpLayout } from './testLayouts';

const S = 4;
const MARGIN = 3;

function groundOf(layout: TrackLayout): GroundSource {
  return {
    worldScale: S,
    surfaceAt: (x, z) => surfaceAtGrid(layout, x / S, z / S, MARGIN),
  };
}

/** Centreline point (metres) in the middle of piece `i`'s points. */
function middleOf(layout: TrackLayout, i: number): { x: number; z: number } {
  const idx = layout.centreline.pieceIndex.map((p, k) => (p === i ? k : -1)).filter((k) => k >= 0);
  const p = layout.centreline.points[idx[Math.floor(idx.length / 2)] as number]!;
  return { x: p.x * S, z: p.z * S };
}

describe('rayAngles', () => {
  it('spreads rays evenly, left (negative) to right', () => {
    const a = rayAngles(90, 9);
    expect(a).toHaveLength(9);
    expect(a[0]).toBe(-45);
    expect(a[4]).toBe(0);
    expect(a[8]).toBe(45);
    for (let i = 1; i < a.length; i++) expect(a[i]! - a[i - 1]!).toBeCloseTo(11.25, 9);
  });

  it('is symmetric about 0', () => {
    for (const [fov, n] of [
      [90, 9],
      [120, 15],
      [60, 4],
      [180, 2],
    ] as const) {
      const a = rayAngles(fov, n);
      expect(a).toHaveLength(n);
      for (let i = 0; i < n; i++) expect(a[i]).toBeCloseTo(-a[n - 1 - i]!, 9);
      expect(a[0]).toBeCloseTo(-fov / 2, 9);
    }
  });

  it('gives a single ray at 0 degrees for rayCount 1', () => {
    expect(rayAngles(90, 1)).toEqual([0]);
    expect(rayAngles(360, 1)).toEqual([0]);
  });

  it('points positive angles to the right (clockwise from above)', () => {
    const north = rayDirection(0, 0);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.z).toBeCloseTo(-1, 9);
    const right = rayDirection(0, 90);
    expect(right.x).toBeCloseTo(1, 9); // east
    expect(right.z).toBeCloseTo(0, 9);
    const left = rayDirection(Math.PI / 2, -90); // heading east, 90 degrees left = north
    expect(left.z).toBeCloseTo(-1, 9);
  });
});

describe('classifyGround', () => {
  for (const ccw of [false, true]) {
    const name = ccw ? 'counter-clockwise (reversed corner pieces)' : 'clockwise';
    it(`classifies pieces of a ${name} loop relative to the racing direction`, () => {
      const layout = runUpLayout(ccw);
      const ground = groundOf(layout);
      expect(layout.pieces.some((p) => p.reversed)).toBe(ccw);
      let corners = 0;
      layout.pieces.forEach((piece, i) => {
        const p = middleOf(layout, i);
        const c = classifyGround(layout, ground, p.x, p.z);
        if (piece.kind === 'start_finish') expect(c).toBe('start_finish');
        else if (piece.kind === 'straight') expect(c).toBe('straight');
        else {
          corners++;
          expect(c).toBe(ccw ? 'left_curve' : 'right_curve');
        }
      });
      expect(corners).toBe(4);
    });
  }

  it('classifies kerb, grass and void by the surface', () => {
    const layout = runUpLayout(false);
    const ground = groundOf(layout);
    expect(layout.pieces[3]!.kind).toBe('straight'); // heading north
    const c = middleOf(layout, 3);
    expect(classifyGround(layout, ground, c.x, c.z)).toBe('straight');
    expect(classifyGround(layout, ground, c.x + 0.38 * S, c.z)).toBe('kerb');
    expect(classifyGround(layout, ground, c.x + 0.6 * S, c.z)).toBe('grass');
    expect(classifyGround(layout, ground, c.x - 0.6 * S, c.z)).toBe('grass');
    expect(classifyGround(layout, ground, c.x + 100 * S, c.z)).toBe('void');
    expect(classifyGround(layout, ground, NaN, 0)).toBe('void');
  });

  it('passes sand and wall surfaces through', () => {
    const layout = runUpLayout(false);
    const stub: GroundSource = { worldScale: S, surfaceAt: () => 'sand' };
    expect(classifyGround(layout, stub, 0, 0)).toBe('sand');
    expect(classifyGround(layout, { ...stub, surfaceAt: () => 'wall' }, 0, 0)).toBe('wall');
  });

  it('has the first corner at the expected piece', () => {
    expect(runUpLayout(false).pieces[FIRST_CORNER]!.kind).toBe('corner');
  });
});
