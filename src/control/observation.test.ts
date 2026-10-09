import { describe, expect, it } from 'vitest';
import type { CarState } from '../car/types';
import {
  buildObservation,
  isObservation,
  type Observation,
  type RaySample,
  type RaceCounters,
} from './types';

const counters: RaceCounters = { checkpoint: 2, totalCheckpoints: 8, lap: 1, totalLaps: 3 };

function car(over: Partial<CarState> = {}): CarState {
  return {
    position: { x: 1, y: 0.2, z: 2 },
    heading: 0,
    speed: 20.123456,
    surface: 'kerb',
    wheelSurfaces: ['kerb', 'kerb', 'kerb', 'kerb'],
    input: { accelerator: 0.123456, steering: -0.98765 },
    steerAngle: 0,
    ...over,
  };
}

const rays: RaySample[] = [
  {
    angleDeg: -45.04,
    samples: [
      { distance: 5, class: 'straight' },
      { distance: 10.004, class: 'left_curve' },
    ],
    obstacleDistance: 7.12345,
    obstacleClass: 'wall',
  },
  {
    angleDeg: 45,
    samples: [{ distance: 5, class: 'void' }],
    obstacleDistance: null,
    obstacleClass: null,
  },
];

function real(): Observation {
  return buildObservation(
    12.34567,
    car(),
    { headingError: -0.1234567, lateralOffset: 0.55555 },
    counters,
    rays,
  );
}

describe('buildObservation', () => {
  it('rounds: distances 0.01, angles 0.1, speed 0.01, others 0.001', () => {
    const o = real();
    expect(o.t).toBe(12.346);
    expect(o.car).toEqual({
      accelerator: 0.123,
      steering: -0.988,
      speed: 20.12,
      surface: 'kerb',
      headingError: -0.123,
      lateralOffset: 0.556,
    });
    expect(o.rays[0]!.angleDeg).toBe(-45);
    expect(o.rays[0]!.samples[1]!.distance).toBe(10);
    expect(o.rays[0]!.obstacleDistance).toBe(7.12);
    expect(o.rays[1]!.obstacleDistance).toBeNull();
    expect(o.progress).toEqual(counters);
  });

  it("maps a missing surface to 'void' and missing progress to 0", () => {
    const o = buildObservation(0, car({ surface: null }), null, counters, []);
    expect(o.car.surface).toBe('void');
    expect(o.car.headingError).toBe(0);
    expect(o.car.lateralOffset).toBe(0);
    expect(isObservation(o)).toBe(true);
  });

  it('is plain JSON with only finite numbers (non-finite input becomes 0, no -0)', () => {
    const o = buildObservation(
      NaN,
      car({ speed: Infinity, input: { accelerator: -0, steering: 1e-9 } }),
      { headingError: NaN, lateralOffset: -0.0001 },
      counters,
      rays,
    );
    expect(o.t).toBe(0);
    expect(Object.is(o.car.accelerator, 0)).toBe(true);
    expect(Object.is(o.car.steering, 0)).toBe(true);
    expect(Object.is(o.car.lateralOffset, 0)).toBe(true);
    expect(o.car.speed).toBe(0);
    expect(isObservation(o)).toBe(true);
  });

  it('survives a JSON round trip unchanged', () => {
    const o = real();
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(JSON.stringify(JSON.parse(JSON.stringify(o)))).toBe(JSON.stringify(o));
    // No class instances: every object is a plain object or array.
    const plain = (v: unknown): boolean => {
      if (v === null || typeof v !== 'object') return true;
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype) return false;
      return Object.values(v).every(plain);
    };
    expect(plain(o)).toBe(true);
  });
});

describe('isObservation', () => {
  it('accepts a real observation, with and without rays', () => {
    expect(isObservation(real())).toBe(true);
    expect(isObservation(buildObservation(0, car(), null, counters, []))).toBe(true);
    expect(isObservation(JSON.parse(JSON.stringify(real())))).toBe(true);
  });

  it('rejects broken ones', () => {
    // Loosely typed on purpose: the cases below corrupt the shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clone = () => JSON.parse(JSON.stringify(real())) as Record<string, any>;
    expect(isObservation(null)).toBe(false);
    expect(isObservation(42)).toBe(false);
    expect(isObservation({})).toBe(false);

    let o = clone();
    delete o.progress;
    expect(isObservation(o)).toBe(false);

    o = clone();
    delete o.car.headingError;
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.t = NaN;
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.car.speed = Infinity;
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.rays[0].samples[0].class = 'tarmac';
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.rays[0].obstacleClass = 'rock';
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.rays[1].obstacleClass = 'wall'; // class without a distance
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.car.surface = null;
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.rays = 'none';
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.progress.lap = 1.5;
    expect(isObservation(o)).toBe(false);

    o = clone();
    o.rays[0].samples[0].distance = undefined;
    expect(isObservation(o)).toBe(false);
  });
});
