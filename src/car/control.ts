import type { CarConfig } from '../core/config';
import type { CarInput } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Clamps a new input into range. A non-finite component (NaN, +/-Infinity) keeps the
 * previous value.
 */
export function sanitizeInput(prev: CarInput, next: Partial<CarInput>): CarInput {
  const a = next.accelerator;
  const s = next.steering;
  return {
    accelerator: typeof a === 'number' && Number.isFinite(a) ? clamp(a, 0, 1) : prev.accelerator,
    steering: typeof s === 'number' && Number.isFinite(s) ? clamp(s, -1, 1) : prev.steering,
  };
}

export interface PedalForces {
  /** Total engine force (N), 0 when braking or coasting. */
  engine: number;
  /** Total brake force (N), 0 when driving or coasting. */
  brake: number;
}

/**
 * Pedal mapping: below `neutral` the brake grows linearly to `maxBrakeForce` at 0; above it
 * the engine grows linearly to `maxEngineForce` at 1; at `neutral` the car coasts.
 */
export function mapPedals(
  accelerator: number,
  cfg: Pick<CarConfig, 'neutral' | 'maxEngineForce' | 'maxBrakeForce'>,
): PedalForces {
  const a = clamp(accelerator, 0, 1);
  const n = clamp(cfg.neutral, 0, 1);
  if (a < n) return { engine: 0, brake: ((n - a) / n) * cfg.maxBrakeForce };
  if (a > n) return { engine: ((a - n) / (1 - n)) * cfg.maxEngineForce, brake: 0 };
  return { engine: 0, brake: 0 };
}

/** Largest steering angle (rad) at `speed` (m/s): linear blend from low to high speed value. */
export function maxSteerAngle(
  speed: number,
  cfg: Pick<CarConfig, 'steerAngleLow' | 'steerAngleHigh' | 'steerFalloffSpeed'>,
): number {
  const t = cfg.steerFalloffSpeed > 0 ? clamp(Math.abs(speed) / cfg.steerFalloffSpeed, 0, 1) : 1;
  return cfg.steerAngleLow + (cfg.steerAngleHigh - cfg.steerAngleLow) * t;
}

/** Wheel angle the input asks for at this speed. */
export function targetSteerAngle(
  steering: number,
  speed: number,
  cfg: Pick<CarConfig, 'steerAngleLow' | 'steerAngleHigh' | 'steerFalloffSpeed'>,
): number {
  return clamp(steering, -1, 1) * maxSteerAngle(speed, cfg);
}

/** Moves `current` towards `target` by at most `rate * dt` (rad). */
export function stepSteerAngle(current: number, target: number, rate: number, dt: number): number {
  const maxStep = Math.max(0, rate) * dt;
  return current + clamp(target - current, -maxStep, maxStep);
}

/**
 * Ackermann geometry: the wheel angles (rad, positive = right) of the front left and front
 * right wheels for a centre ("bicycle model") steering angle `delta`, so that both wheels
 * roll about the same turning centre. The inner wheel turns more than the outer one.
 * `wheelBase` and `halfTrack` in metres.
 */
export function ackermannAngles(
  delta: number,
  wheelBase: number,
  halfTrack: number,
): { left: number; right: number } {
  const t = Math.tan(delta);
  // Right turn (delta > 0): the right wheel is on the inside. Denominators stay positive for
  // any realistic lock (halfTrack * |tan| < wheelBase); clamp so extremes cannot flip sign.
  const inner = wheelBase - halfTrack * t > 1e-3 ? wheelBase - halfTrack * t : 1e-3;
  const outer = wheelBase + halfTrack * t > 1e-3 ? wheelBase + halfTrack * t : 1e-3;
  return {
    left: Math.atan((wheelBase * t) / outer),
    right: Math.atan((wheelBase * t) / inner),
  };
}
