/**
 * World -> minimap pixel mapping (pure). North-up: world x (east) grows to the right and world
 * z (south, `layout.ts` frame) grows downwards, which is how a canvas already works, so no flip
 * is needed and handedness is preserved. The aspect ratio is kept (uniform scale), the track
 * is centred, and `padding` pixels are left free around it.
 */
import type { Bounds } from '../track/layout';

export interface MinimapMapping {
  /** Pixels per metre. */
  scale: number;
  /** Metres -> pixels. */
  toPixel(x: number, z: number, out?: { x: number; y: number }): { x: number; y: number };
}

/**
 * @param bounds inclusive cell ranges of the layout
 * @param worldScale metres per cell
 * @param width canvas width in pixels
 * @param height canvas height in pixels
 */
export function createMinimapMapping(
  bounds: Bounds,
  worldScale: number,
  width: number,
  height: number,
  padding = 8,
): MinimapMapping {
  const x0 = bounds.min.x * worldScale;
  const z0 = bounds.min.z * worldScale;
  const w = (bounds.max.x + 1 - bounds.min.x) * worldScale;
  const h = (bounds.max.z + 1 - bounds.min.z) * worldScale;
  const scale = Math.min((width - 2 * padding) / w, (height - 2 * padding) / h);
  const offX = (width - w * scale) / 2;
  const offY = (height - h * scale) / 2;
  return {
    scale,
    toPixel(x, z, out = { x: 0, y: 0 }) {
      out.x = offX + (x - x0) * scale;
      out.y = offY + (z - z0) * scale;
      return out;
    },
  };
}
