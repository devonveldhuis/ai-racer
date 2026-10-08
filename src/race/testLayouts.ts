/**
 * Hand-built layouts and path helpers for the race tests. They do not depend on the track
 * generator's seed shapes (only on `layoutFromPieces`).
 */
import { layoutFromPieces, type PieceSpec } from '../track/generator';
import type { TrackLayout } from '../track/layout';

const straight = (): PieceSpec => ({ tileId: 'roadStraight', reversed: false });
const right = (): PieceSpec => ({ tileId: 'roadCornerSmall', reversed: false });
const repeat = (spec: () => PieceSpec, n: number): PieceSpec[] =>
  Array.from({ length: n }, () => spec());

/**
 * A clockwise rectangle, 4 x 6 cells, 15 pieces, start piece heading north at the origin.
 * Checkpoints (4 of them, the last is the finish line) sit on pieces 4, 8, 12 and 0.
 */
export function rectLayout(): TrackLayout {
  return layoutFromPieces(
    7,
    {},
    [
      straight(),
      right(),
      ...repeat(straight, 2),
      right(),
      ...repeat(straight, 4),
      right(),
      ...repeat(straight, 2),
      right(),
      straight(),
    ],
    0,
  );
}

/** Points on the way round the loop, in metres: midpoints of the centreline segments, so a
 * path never lands exactly on a checkpoint line. Starts at the segment nearest `from`. */
export function pathAround(
  layout: TrackLayout,
  worldScale: number,
  from: { x: number; z: number },
  count = 1,
): { x: number; z: number }[] {
  const pts = layout.centreline.points;
  const n = pts.length;
  const mids = pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    return { x: ((p.x + q.x) / 2) * worldScale, z: ((p.z + q.z) / 2) * worldScale };
  });
  let k0 = 0;
  let best = Infinity;
  mids.forEach((m, i) => {
    const d = Math.hypot(m.x - from.x, m.z - from.z);
    if (d < best) {
      best = d;
      k0 = i;
    }
  });
  // Start one point past the nearest mid-point, so the path never runs back over the start.
  const out: { x: number; z: number }[] = [];
  for (let k = 1; k <= n * count + 2; k++) out.push(mids[(k0 + k) % n]!);
  return out;
}

/** Linear interpolation of a path into steps of at most `maxStep` metres. */
export function densify(
  path: { x: number; z: number }[],
  maxStep: number,
): { x: number; z: number }[] {
  const out = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxStep));
    for (let s = 1; s <= steps; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    }
  }
  return out;
}
