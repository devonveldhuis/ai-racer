/** A minimal valid observation for tests that only care about `t` (no rays). */
import type { Observation } from './types';

export function blankObservation(t: number): Observation {
  return {
    t,
    car: {
      accelerator: 0.5,
      steering: 0,
      speed: 0,
      surface: 'road',
      headingError: 0,
      lateralOffset: 0,
    },
    rays: [],
    progress: { checkpoint: 0, totalCheckpoints: 4, lap: 1, totalLaps: 1 },
  };
}
