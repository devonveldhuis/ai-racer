import type { SurfaceType } from '../assets/surfaces';
import type { CarInput, CarState } from '../car/types';

export type { CarInput };

/** What a ray sample (or an obstacle hit) is. See PLAN.md, "Observation". */
export type SensorClass =
  | 'straight'
  | 'left_curve'
  | 'right_curve'
  | 'start_finish'
  | 'kerb'
  | 'grass'
  | 'sand'
  | 'wall'
  | 'obstacle'
  | 'void';

export const SENSOR_CLASSES: readonly SensorClass[] = [
  'straight',
  'left_curve',
  'right_curve',
  'start_finish',
  'kerb',
  'grass',
  'sand',
  'wall',
  'obstacle',
  'void',
];

/** Surface under the car; `'void'` means there is no ground under it. */
export type CarSurface = SurfaceType | 'void';
const CAR_SURFACES: readonly CarSurface[] = ['road', 'kerb', 'grass', 'sand', 'wall', 'void'];

export interface RaySample {
  /** Relative to the car's heading, in degrees; negative = left. */
  angleDeg: number;
  /** Ground classes at the configured sample distances (metres, increasing). */
  samples: Array<{ distance: number; class: SensorClass }>;
  /** Distance (m) to the first wall/obstacle along the ray; `null` if there is none in range. */
  obstacleDistance: number | null;
  obstacleClass: SensorClass | null;
}

/**
 * What a driver sees at a decision. Plain JSON: no class instances, no `undefined`, no
 * non-finite numbers. Distances are rounded to 0.01 m, angles to 0.1 degree, speed to 0.01
 * m/s and everything else to 0.001.
 */
export interface Observation {
  /** Race time in seconds: 0 until GO, frozen while paused (not the simulation time). */
  t: number;
  car: {
    /** Last applied input. */
    accelerator: number;
    steering: number;
    /** m/s, forward. */
    speed: number;
    /** What the car is on; `'void'` where there is no ground under it. */
    surface: CarSurface;
    /** Radians vs the track direction at the nearest centreline point, in (-PI, PI];
     * positive = pointing right of the road. 0 if unavailable. */
    headingError: number;
    /** -1 = left road edge ... +1 = right road edge (beyond that off the road). 0 if unavailable. */
    lateralOffset: number;
  };
  /** Ordered left to right. */
  rays: RaySample[];
  progress: {
    /** Index of the next checkpoint to cross (0-based; the last one is the finish line). */
    checkpoint: number;
    totalCheckpoints: number;
    /** Current lap, 1-based. */
    lap: number;
    totalLaps: number;
  };
}

export interface CarController {
  readonly name: string;
  /** Called at the controller's decision rate. May be async (remote AI). */
  decide(obs: Observation): CarInput | Promise<CarInput>;
  reset?(): void;
  /** Releases listeners and other resources. */
  dispose?(): void;
}

export interface ObservationProgress {
  headingError: number;
  lateralOffset: number;
}

export interface RaceCounters {
  checkpoint: number;
  totalCheckpoints: number;
  lap: number;
  totalLaps: number;
}

/** Rounds to a multiple of `1 / k`; non-finite input becomes 0 (and -0 becomes 0). */
function round(x: number, k: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(x * k) / k;
  return r === 0 ? 0 : r;
}

/** Assembles the observation (pure). `progress` is `null` when the race has none yet. */
export function buildObservation(
  raceTime: number,
  car: CarState,
  progress: ObservationProgress | null,
  counters: RaceCounters,
  rays: readonly RaySample[],
): Observation {
  return {
    t: round(raceTime, 1000),
    car: {
      accelerator: round(car.input.accelerator, 1000),
      steering: round(car.input.steering, 1000),
      speed: round(car.speed, 100),
      surface: car.surface ?? 'void',
      headingError: round(progress?.headingError ?? 0, 1000),
      lateralOffset: round(progress?.lateralOffset ?? 0, 1000),
    },
    rays: rays.map((r) => ({
      angleDeg: round(r.angleDeg, 10),
      samples: r.samples.map((s) => ({ distance: round(s.distance, 100), class: s.class })),
      obstacleDistance: r.obstacleDistance === null ? null : round(r.obstacleDistance, 100),
      obstacleClass: r.obstacleClass,
    })),
    progress: {
      checkpoint: counters.checkpoint,
      totalCheckpoints: counters.totalCheckpoints,
      lap: counters.lap,
      totalLaps: counters.totalLaps,
    },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isClass = (x: unknown): x is SensorClass =>
  typeof x === 'string' && (SENSOR_CLASSES as readonly string[]).includes(x);

function isRaySample(x: unknown): x is RaySample {
  if (!isObj(x) || !isNum(x.angleDeg) || !Array.isArray(x.samples)) return false;
  for (const s of x.samples as unknown[]) {
    if (!isObj(s) || !isNum(s.distance) || !isClass(s.class)) return false;
  }
  if (x.obstacleDistance === null || x.obstacleClass === null) {
    return x.obstacleDistance === null && x.obstacleClass === null;
  }
  return isNum(x.obstacleDistance) && isClass(x.obstacleClass);
}

/** Runtime check that `x` has the exact shape of an `Observation` (used by tests and the bridge). */
export function isObservation(x: unknown): x is Observation {
  if (!isObj(x) || !isNum(x.t)) return false;
  const c = x.car;
  if (
    !isObj(c) ||
    !isNum(c.accelerator) ||
    !isNum(c.steering) ||
    !isNum(c.speed) ||
    !isNum(c.headingError) ||
    !isNum(c.lateralOffset) ||
    !(CAR_SURFACES as readonly unknown[]).includes(c.surface)
  ) {
    return false;
  }
  if (!Array.isArray(x.rays) || !(x.rays as unknown[]).every(isRaySample)) return false;
  const p = x.progress;
  return (
    isObj(p) &&
    isInt(p.checkpoint) &&
    isInt(p.totalCheckpoints) &&
    isInt(p.lap) &&
    isInt(p.totalLaps)
  );
}
