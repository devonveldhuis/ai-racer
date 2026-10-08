/**
 * Where a car is relative to the track centreline. Pure maths (no three.js / Rapier).
 * Positions are in metres, centreline data in grid units (multiplied by `worldScale`).
 */
import type { TrackLayout } from '../track/layout';

/** Half the road width in grid cells (the road is 0.69 cells wide). */
export const ROAD_HALF_WIDTH = 0.345;

/** Points searched either side of the hint, and the distance (cells) beyond which the local
 * result is distrusted and a global search is done instead. */
const WINDOW = 20;
const FALLBACK_DISTANCE = 1.5;

export interface TrackProgress {
  /** Distance along the centreline from the start of the loop (the start piece's entry), m. */
  distanceAlong: number;
  /** Car heading minus the centreline direction, in (-PI, PI]; positive = pointing right of the road. */
  headingError: number;
  /** -1 = left road edge, 0 = centre, +1 = right road edge (can exceed 1 off the road). */
  lateralOffset: number;
  /** Index of the nearest centreline point. */
  nearestIndex: number;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

interface Projection {
  /** Segment start index; the segment runs to `(i + 1) % n`. */
  i: number;
  /** 0..1 along the segment. */
  t: number;
  /** Squared distance to the projected point. */
  d2: number;
}

export function trackProgress(
  layout: TrackLayout,
  worldScale: number,
  position: { x: number; z: number },
  heading: number,
  hint?: number,
): TrackProgress {
  const cl = layout.centreline;
  const pts = cl.points;
  const n = pts.length;
  const px = position.x / worldScale;
  const pz = position.z / worldScale;

  const dist2 = (i: number) => {
    const p = pts[i] as { x: number; z: number };
    return (p.x - px) ** 2 + (p.z - pz) ** 2;
  };

  let nearest = -1;
  let best = Infinity;
  if (hint !== undefined && Number.isInteger(hint) && hint >= 0 && hint < n) {
    let bestK = 0;
    for (let k = -WINDOW; k <= WINDOW; k++) {
      const i = (((hint + k) % n) + n) % n;
      const d = dist2(i);
      if (d < best) {
        best = d;
        nearest = i;
        bestK = k;
      }
    }
    // A minimum at the edge of the window means the true nearest point may lie beyond it.
    if (Math.abs(bestK) === WINDOW || best > FALLBACK_DISTANCE * FALLBACK_DISTANCE) nearest = -1;
  }
  if (nearest < 0) {
    best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = dist2(i);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
  }

  // Project onto the two segments that meet at the nearest point; keep the closer one.
  const project = (i: number): Projection => {
    const a = pts[i] as { x: number; z: number };
    const b = pts[(i + 1) % n] as { x: number; z: number };
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2)) : 0;
    const qx = a.x + t * dx;
    const qz = a.z + t * dz;
    return { i, t, d2: (px - qx) ** 2 + (pz - qz) ** 2 };
  };
  const prev = project((nearest - 1 + n) % n);
  const next = project(nearest);
  const seg = prev.d2 < next.d2 ? prev : next;

  const a = pts[seg.i] as { x: number; z: number };
  const b = pts[(seg.i + 1) % n] as { x: number; z: number };
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 0 ? dx / len : 0;
  const uz = len > 0 ? dz / len : -1;
  const qx = a.x + seg.t * dx;
  const qz = a.z + seg.t * dz;
  // Right of the direction of travel in the (x, z) frame (N = -z, E = +x) is (-uz, ux).
  const lateral = (px - qx) * -uz + (pz - qz) * ux;
  const segLength = seg.i === n - 1 ? cl.totalLength - (cl.distance[n - 1] as number) : len;
  const along = (cl.distance[seg.i] as number) + seg.t * segLength;

  return {
    distanceAlong: along * worldScale,
    headingError: wrapAngle(heading - Math.atan2(ux, -uz)),
    lateralOffset: lateral / ROAD_HALF_WIDTH,
    nearestIndex: nearest,
  };
}
