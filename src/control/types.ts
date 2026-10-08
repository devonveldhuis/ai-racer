import type { SurfaceType } from '../assets/surfaces';
import type { CarInput, CarState } from '../car/types';

export type { CarInput };

/**
 * PLACEHOLDER observation. Task 009 adds the rays, `headingError`, `lateralOffset` and
 * `progress` (see PLAN.md, "Observation"). Plain and JSON-serialisable.
 */
export interface Observation {
  /** Simulation time in seconds. */
  t: number;
  car: {
    /** Last applied input. */
    accelerator: number;
    steering: number;
    /** m/s, forward. */
    speed: number;
    surface: SurfaceType | null;
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

export function buildObservation(t: number, car: CarState): Observation {
  return {
    t,
    car: {
      accelerator: car.input.accelerator,
      steering: car.input.steering,
      speed: car.speed,
      surface: car.surface,
    },
  };
}
