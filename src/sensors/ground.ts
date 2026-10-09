/**
 * Pure helpers of the ray sensor (no Rapier, no three.js): ray angles and ground
 * classification from the track layout.
 */
import { headingVector, type TrackLayout } from '../track/layout';
import type { SurfaceType } from '../assets/surfaces';
import type { SensorClass } from '../control/types';

/** The part of a `BuiltTrack` that ground classification needs. */
export interface GroundSource {
  readonly worldScale: number;
  /** Surface under the point `(x, z)` in metres; `null` where there is no ground. */
  surfaceAt(x: number, z: number): SurfaceType | null;
}

/**
 * Ray angles in degrees, ordered left to right (negative = left), evenly spread over
 * -fov/2 ... +fov/2. A single ray points straight ahead (0).
 */
export function rayAngles(fovDeg: number, rayCount: number): number[] {
  const n = Math.max(1, Math.floor(rayCount));
  if (n === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-fovDeg / 2 + (fovDeg * i) / (n - 1));
  return out;
}

/** Unit direction (x, z) of a ray at `angleDeg` (positive = right) from heading `heading`. */
export function rayDirection(heading: number, angleDeg: number): { x: number; z: number } {
  return headingVector(heading + (angleDeg * Math.PI) / 180);
}

/**
 * Class of the ground at `(x, z)` (metres): the surface for off-road ground, and for road
 * the piece under the point (curves relative to the racing direction, not the car's heading).
 */
export function classifyGround(
  layout: TrackLayout,
  track: GroundSource,
  x: number,
  z: number,
): SensorClass {
  const surface = track.surfaceAt(x, z);
  switch (surface) {
    case null:
      return 'void';
    case 'kerb':
    case 'grass':
    case 'sand':
    case 'wall':
      return surface;
    case 'road': {
      const S = track.worldScale;
      const info = layout.cellInfo({ x: Math.floor(x / S), z: Math.floor(z / S) });
      if (!info) return 'straight';
      if (info.kind === 'start_finish') return 'start_finish';
      if (info.kind === 'corner') return info.turn === 'left' ? 'left_curve' : 'right_curve';
      return 'straight';
    }
  }
}
