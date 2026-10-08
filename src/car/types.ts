import type { SurfaceType } from '../assets/surfaces';

/** What a driver (human, bot or model) tells the car. See PLAN.md, "Car control API". */
export interface CarInput {
  /** 0 ... 1: below the neutral point brakes (0 = full brake), above it drives (1 = full throttle). */
  accelerator: number;
  /** -1 ... +1: -1 = full left, +1 = full right. */
  steering: number;
}

export interface CarPose {
  /** Metres. */
  position: { x: number; z: number };
  /** Radians, the `layout.ts` convention (N = 0, clockwise seen from above). */
  heading: number;
}

export interface CarState {
  position: { x: number; y: number; z: number };
  /** Radians, the `layout.ts` convention. */
  heading: number;
  /** m/s, signed, along the car's forward direction. */
  speed: number;
  /** Surface under the chassis centre, `null` where there is no ground. */
  surface: SurfaceType | null;
  /** Surface under each wheel: front left, front right, rear left, rear right. */
  wheelSurfaces: (SurfaceType | null)[];
  /** Last applied input (after clamping). */
  input: CarInput;
  /** Current front wheel steering angle (rad), positive = right. */
  steerAngle: number;
}
