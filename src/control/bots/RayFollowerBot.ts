/**
 * A rule-based driver that uses only the `Observation` (no layout, car or sensor internals).
 * It steers toward the rays whose near samples stay on the road, keeps itself centred with
 * `headingError` and `lateralOffset`, and picks a target speed from how far away the next
 * curve, off-road patch or obstacle is (it must be able to brake to the corner speed before
 * reaching it). The decision is the pure function `rayFollowerDecide`; the Node mock AI
 * server (`tools/mock-ai-server.ts`) uses it unchanged, so this file has only type imports.
 */
import type { CarController, CarInput, Observation, RaySample, SensorClass } from '../types';

export interface RayFollowerParams {
  /** Accelerator value that means "coast" (`car.neutral`). */
  neutral: number;
  /** Speed (m/s) on a clear straight. */
  maxSpeed: number;
  /** Speed (m/s) to have reached when entering a curve. */
  cornerSpeed: number;
  /** Deceleration (m/s2) the bot plans its braking with (less than the car can do). */
  brakeDecel: number;
  /** Steering of 1 per this many degrees of desired heading change toward the best rays. */
  fullSteerDeg: number;
  /** Steering per radian of heading error, and per unit of lateral offset. */
  headingGain: number;
  offsetGain: number;
  /** Fraction of the previous steering kept (0 = none). */
  smoothing: number;
}

export const DEFAULT_RAY_FOLLOWER_PARAMS: Readonly<RayFollowerParams> = {
  neutral: 0.5,
  maxSpeed: 22,
  cornerSpeed: 8,
  brakeDecel: 4,
  fullSteerDeg: 30,
  headingGain: 1.2,
  offsetGain: 0.35,
  smoothing: 0.3,
};

export interface RayFollowerState {
  /** Steering of the last decision. */
  steering: number;
}

export const INITIAL_RAY_FOLLOWER_STATE: Readonly<RayFollowerState> = { steering: 0 };

const ROAD: ReadonlySet<SensorClass> = new Set([
  'straight',
  'left_curve',
  'right_curve',
  'start_finish',
]);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Distance to the end of the unbroken run of road samples on a ray (0 if the first is not road). */
function roadRun(ray: RaySample): number {
  let run = 0;
  for (const s of ray.samples) {
    if (!ROAD.has(s.class) && s.class !== 'kerb') break;
    run = s.distance;
  }
  // The whole ray is road: count it as a little longer than the last sample.
  const last = ray.samples[ray.samples.length - 1];
  return last && run === last.distance ? run + 10 : run;
}

/** Distance at which a speed limit applies so that `target` m/s can be reached by braking. */
function allowedSpeed(distance: number, target: number, decel: number): number {
  return Math.sqrt(target * target + 2 * decel * Math.max(0, distance));
}

export function rayFollowerDecide(
  obs: Observation,
  state: RayFollowerState = INITIAL_RAY_FOLLOWER_STATE,
  params: Readonly<RayFollowerParams> = DEFAULT_RAY_FOLLOWER_PARAMS,
): { input: CarInput; state: RayFollowerState } {
  const p = params;
  const { car, rays } = obs;

  // Steering toward the rays with the longest runs of road.
  let wSum = 0;
  let aSum = 0;
  for (const ray of rays) {
    const run = roadRun(ray);
    const w = run * run;
    wSum += w;
    aSum += w * ray.angleDeg;
  }
  const targetDeg = wSum > 0 ? aSum / wSum : 0;
  let steer = targetDeg / p.fullSteerDeg;
  steer -= p.headingGain * car.headingError + p.offsetGain * car.lateralOffset;
  steer = p.smoothing * state.steering + (1 - p.smoothing) * steer;
  steer = clamp(steer, -1, 1);

  // Target speed: the tightest of the limits set by what lies ahead.
  let target = p.maxSpeed;
  let previous = 0;
  const first = rays[0];
  const distances = first ? first.samples.map((s) => s.distance) : [];
  for (let j = 0; j < distances.length; j++) {
    const d = distances[j] as number;
    let curve = false;
    let offRoad = false;
    for (const ray of rays) {
      if (Math.abs(ray.angleDeg) > 30) continue;
      const c = ray.samples[j]?.class;
      if (c === 'left_curve' || c === 'right_curve') curve = true;
      if (c === 'grass' || c === 'sand' || c === 'void' || c === 'wall') {
        if (Math.abs(ray.angleDeg) <= 1) offRoad = true;
      }
    }
    // The feature is somewhere between the previous sample and this one: assume the near end.
    if (curve) target = Math.min(target, allowedSpeed(previous, p.cornerSpeed, p.brakeDecel));
    if (offRoad) target = Math.min(target, allowedSpeed(previous, p.cornerSpeed, p.brakeDecel));
    previous = d;
  }
  for (const ray of rays) {
    if (ray.obstacleDistance !== null && Math.abs(ray.angleDeg) <= 20) {
      target = Math.min(target, allowedSpeed(ray.obstacleDistance - 4, 0, p.brakeDecel));
    }
  }
  if (car.surface === 'grass' || car.surface === 'sand' || car.surface === 'void') {
    target = Math.min(target, p.cornerSpeed);
  }

  const err = target - car.speed;
  const n = p.neutral;
  const accelerator = err > 0 ? n + Math.min(1 - n, err * (1 - n)) : Math.max(0, n + err * 0.5 * n);
  return { input: { accelerator, steering: steer }, state: { steering: steer } };
}

export class RayFollowerBot implements CarController {
  readonly name = 'bot';
  private readonly params: RayFollowerParams;
  private state: RayFollowerState = { ...INITIAL_RAY_FOLLOWER_STATE };

  constructor(params: Partial<RayFollowerParams> = {}) {
    this.params = { ...DEFAULT_RAY_FOLLOWER_PARAMS, ...params };
  }

  decide(obs: Observation): CarInput {
    const r = rayFollowerDecide(obs, this.state, this.params);
    this.state = r.state;
    return r.input;
  }

  reset(): void {
    this.state = { ...INITIAL_RAY_FOLLOWER_STATE };
  }
}
