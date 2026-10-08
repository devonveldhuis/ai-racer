import { describe, expect, it } from 'vitest';
import { generateTrack } from '../track/generator';
import { ROAD_HALF_WIDTH, trackProgress } from './progress';
import { rectLayout } from './testLayouts';

const S = 4;
const layout = rectLayout();
const pts = layout.centreline.points;
const n = pts.length;

/** Midpoint of centreline segment `i` in metres, its unit direction and heading. */
function seg(i: number) {
  const a = pts[i]!;
  const b = pts[(i + 1) % n]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const u = { x: dx / len, z: dz / len };
  return {
    mid: { x: ((a.x + b.x) / 2) * S, z: ((a.z + b.z) / 2) * S },
    u,
    heading: Math.atan2(u.x, -u.z),
  };
}

describe('trackProgress', () => {
  it('is zero offset and zero heading error on the centreline', () => {
    for (let i = 0; i < n; i += 3) {
      const s = seg(i);
      const p = trackProgress(layout, S, s.mid, s.heading);
      expect(p.lateralOffset).toBeCloseTo(0, 9);
      expect(p.headingError).toBeCloseTo(0, 9);
    }
  });

  it('gives -1 at the left road edge and +1 at the right one', () => {
    const s = seg(10);
    const edge = ROAD_HALF_WIDTH * S;
    // Right of the direction of travel is (-uz, ux) in the (x, z) frame.
    const right = { x: s.mid.x + -s.u.z * edge, z: s.mid.z + s.u.x * edge };
    const left = { x: s.mid.x - -s.u.z * edge, z: s.mid.z - s.u.x * edge };
    expect(trackProgress(layout, S, right, s.heading).lateralOffset).toBeCloseTo(1, 6);
    expect(trackProgress(layout, S, left, s.heading).lateralOffset).toBeCloseTo(-1, 6);
    const half = { x: s.mid.x + -s.u.z * edge * 0.5, z: s.mid.z + s.u.x * edge * 0.5 };
    expect(trackProgress(layout, S, half, s.heading).lateralOffset).toBeCloseTo(0.5, 6);
  });

  it('is negative to the left and positive to the right all the way round', () => {
    for (let i = 0; i < n; i += 2) {
      const s = seg(i);
      const left = { x: s.mid.x + s.u.z * 0.3, z: s.mid.z - s.u.x * 0.3 };
      const right = { x: s.mid.x - s.u.z * 0.3, z: s.mid.z + s.u.x * 0.3 };
      expect(trackProgress(layout, S, left, s.heading).lateralOffset).toBeLessThan(0);
      expect(trackProgress(layout, S, right, s.heading).lateralOffset).toBeGreaterThan(0);
    }
  });

  it('has a heading error that is positive when pointing right of the road', () => {
    const s = seg(10);
    expect(trackProgress(layout, S, s.mid, s.heading + 0.3).headingError).toBeCloseTo(0.3, 9);
    expect(trackProgress(layout, S, s.mid, s.heading - 0.3).headingError).toBeCloseTo(-0.3, 9);
    // Wrapped into (-PI, PI].
    const wrapped = trackProgress(layout, S, s.mid, s.heading + 3.5).headingError;
    expect(wrapped).toBeCloseTo(3.5 - 2 * Math.PI, 9);
    expect(Math.abs(wrapped)).toBeLessThanOrEqual(Math.PI);
  });

  it('has a monotonic distanceAlong over a lap', () => {
    let hint: number | undefined;
    let last = -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        const pos = { x: (a.x + (b.x - a.x) * t) * S, z: (a.z + (b.z - a.z) * t) * S };
        const p = trackProgress(layout, S, pos, 0, hint);
        hint = p.nearestIndex;
        expect(p.distanceAlong).toBeGreaterThanOrEqual(last - 1e-9);
        last = p.distanceAlong;
      }
    }
    expect(last).toBeGreaterThan(layout.centreline.totalLength * S * 0.95);
    expect(last).toBeLessThanOrEqual(layout.centreline.totalLength * S);
    // The first point of the loop is distance 0.
    expect(
      trackProgress(layout, S, { x: pts[0]!.x * S, z: pts[0]!.z * S }, 0).distanceAlong,
    ).toBeCloseTo(0, 9);
  });

  it('falls back to a global search after a jump', () => {
    const a = seg(5).mid;
    const b = seg(Math.floor(n / 2) + 3).mid;
    const pa = trackProgress(layout, S, a, 0);
    const jumped = trackProgress(layout, S, b, 0, pa.nearestIndex);
    const global = trackProgress(layout, S, b, 0);
    expect(jumped).toEqual(global);
    expect(Math.abs(jumped.nearestIndex - pa.nearestIndex)).toBeGreaterThan(30);
  });

  it('agrees with and without a hint near the previous position', () => {
    const a = seg(20).mid;
    const pa = trackProgress(layout, S, a, 0);
    const b = seg(23).mid;
    expect(trackProgress(layout, S, b, 0, pa.nearestIndex)).toEqual(trackProgress(layout, S, b, 0));
  });

  it('works on generated tracks (centreline gives zero error)', () => {
    for (const seed of [1, 2, 3]) {
      const l = generateTrack(seed);
      const q = l.centreline.points;
      for (let i = 0; i < q.length; i += 7) {
        const a = q[i]!;
        const b = q[(i + 1) % q.length]!;
        const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
        const mid = { x: ((a.x + b.x) / 2) * S, z: ((a.z + b.z) / 2) * S };
        const p = trackProgress(l, S, mid, heading);
        expect(Math.abs(p.lateralOffset)).toBeLessThan(1e-6);
        expect(Math.abs(p.headingError)).toBeLessThan(1e-6);
      }
    }
  });
});
