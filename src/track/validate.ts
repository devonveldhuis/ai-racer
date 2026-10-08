import { connectorsMatch, placedConnectors } from '../assets/tiles';
import { cellKey, pieceDef, type TrackLayout, type TrackPiece } from './layout';
import { straightRuns } from './straights';

/**
 * Independent check of every layout invariant. Returns a list of problems (empty = valid).
 * Does not trust `layout.occupancy`: ownership, adjacency and connectors are recomputed
 * from the pieces.
 */
export function validateLayout(layout: TrackLayout): string[] {
  const errors: string[] = [];
  const { pieces, options } = layout;
  const n = pieces.length;
  if (n < options.minPieces || n > options.maxPieces)
    errors.push(`piece count ${n} outside [${options.minPieces}, ${options.maxPieces}]`);

  const corners = pieces.filter((p) => p.kind === 'corner').length;
  if (corners < options.minCorners)
    errors.push(`only ${corners} corners, expected at least ${options.minCorners}`);
  const [mainLo, mainHi] = options.mainStraightCells;
  const main = straightRuns(layout).find((r) => r.containsStart);
  if (!main) errors.push('start piece is not on a straight run');
  else if (main.cells < mainLo || main.cells > mainHi)
    errors.push(`main straight is ${main.cells} cells, expected [${mainLo}, ${mainHi}]`);

  const owner = new Map<string, number>();
  for (const p of pieces)
    for (const c of p.cells) {
      const k = cellKey(c);
      if (owner.has(k)) errors.push(`cell ${k} used by pieces ${owner.get(k)} and ${p.index}`);
      owner.set(k, p.index);
    }

  const starts = pieces.filter((p) => p.kind === 'start_finish');
  if (starts.length !== 1 || starts[0]?.index !== 0)
    errors.push(`expected exactly one start piece at index 0, got ${starts.length}`);
  const last = pieces[n - 1];
  if (!last || last.kind !== 'straight') errors.push('piece before the start is not a straight');

  for (let i = 0; i < n; i++) {
    const a = pieces[i] as TrackPiece;
    const b = pieces[(i + 1) % n] as TrackPiece;
    const ca = placedConnectors(pieceDef(a), a.placement);
    const cb = placedConnectors(pieceDef(b), b.placement);
    if (!ca || !cb || !connectorsMatch(ca.exit, cb.entry))
      errors.push(`exit of piece ${i} does not match entry of piece ${(i + 1) % n}`);
  }

  const d = options.clearance;
  for (const p of pieces) {
    for (const c of p.cells) {
      for (let dx = -d; dx <= d; dx++) {
        const rest = d - Math.abs(dx);
        for (let dz = -rest; dz <= rest; dz++) {
          const q = owner.get(cellKey({ x: c.x + dx, z: c.z + dz }));
          if (q === undefined || q === p.index) continue;
          const consecutive = (q - p.index + n) % n === 1 || (p.index - q + n) % n === 1;
          if (!consecutive)
            errors.push(`pieces ${p.index} and ${q} are closer than clearance ${d}`);
        }
      }
    }
  }
  return errors;
}
