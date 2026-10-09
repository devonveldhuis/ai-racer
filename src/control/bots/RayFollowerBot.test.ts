import { describe, expect, it } from 'vitest';
import { blankObservation } from '../testObservation';
import type { Observation, RaySample, SensorClass } from '../types';
import { DEFAULT_RAY_FOLLOWER_PARAMS, RayFollowerBot, rayFollowerDecide } from './RayFollowerBot';

const DISTANCES = [5, 10, 20, 35];
const ANGLES = [-45, -33.75, -22.5, -11.25, 0, 11.25, 22.5, 33.75, 45];

/** Builds a cone where `classes(angle, distance)` says what each sample is. */
function cone(classes: (angleDeg: number, distance: number) => SensorClass): RaySample[] {
  return ANGLES.map((angleDeg) => ({
    angleDeg,
    samples: DISTANCES.map((distance) => ({ distance, class: classes(angleDeg, distance) })),
    obstacleDistance: null,
    obstacleClass: null,
  }));
}

function obsWith(rays: RaySample[], car: Partial<Observation['car']> = {}): Observation {
  const o = blankObservation(1);
  return { ...o, car: { ...o.car, speed: 10, ...car }, rays };
}

const straightRoad = () => cone((a, d) => (Math.abs(a) * d < 400 ? 'straight' : 'grass'));
const decide = (o: Observation) => rayFollowerDecide(o).input;

describe('rayFollowerDecide', () => {
  it('drives straight and flat out on a clear straight', () => {
    const i = decide(obsWith(straightRoad(), { speed: 10 }));
    expect(Math.abs(i.steering)).toBeLessThan(0.05);
    expect(i.accelerator).toBe(1);
  });

  it('steers toward the side where the road continues', () => {
    // Road bends left: the left rays stay on the road further.
    const left = cone((a, d) => (a <= 0 || d <= 5 ? 'left_curve' : 'grass'));
    const right = cone((a, d) => (a >= 0 || d <= 5 ? 'right_curve' : 'grass'));
    expect(decide(obsWith(left)).steering).toBeLessThan(-0.2);
    expect(decide(obsWith(right)).steering).toBeGreaterThan(0.2);
  });

  it('corrects heading error and lateral offset (positive = right of the road)', () => {
    expect(decide(obsWith(straightRoad(), { headingError: 0.3 })).steering).toBeLessThan(-0.1);
    expect(decide(obsWith(straightRoad(), { headingError: -0.3 })).steering).toBeGreaterThan(0.1);
    expect(decide(obsWith(straightRoad(), { lateralOffset: 0.8 })).steering).toBeLessThan(-0.1);
    expect(decide(obsWith(straightRoad(), { lateralOffset: -0.8 })).steering).toBeGreaterThan(0.1);
  });

  it('brakes for a curve that is close and not for one that is far', () => {
    const curveAt = (minDistance: number) =>
      cone((a, d) => (Math.abs(a) < 20 && d >= minDistance ? 'right_curve' : 'straight'));
    const fast = { speed: 20 };
    expect(decide(obsWith(curveAt(5), fast)).accelerator).toBeLessThan(0.5);
    expect(decide(obsWith(curveAt(35), { speed: 12 })).accelerator).toBeGreaterThan(0.5);
    expect(decide(obsWith(curveAt(35), fast)).accelerator).toBeLessThan(
      decide(obsWith(straightRoad(), fast)).accelerator,
    );
  });

  it('slows for off-road ahead and for close obstacles', () => {
    const offRoad = cone((a, d) => (a === 0 && d >= 10 ? 'grass' : 'straight'));
    expect(decide(obsWith(offRoad, { speed: 20 })).accelerator).toBeLessThan(0.5);
    const blocked = straightRoad();
    blocked[4] = { ...(blocked[4] as RaySample), obstacleDistance: 8, obstacleClass: 'obstacle' };
    expect(decide(obsWith(blocked, { speed: 15 })).accelerator).toBeLessThan(0.5);
  });

  it('copes with no rays and with an all off-road cone', () => {
    const none = decide(obsWith([]));
    expect(Number.isFinite(none.steering) && Number.isFinite(none.accelerator)).toBe(true);
    const lost = decide(
      obsWith(
        cone(() => 'grass'),
        { surface: 'grass', lateralOffset: 1.4 },
      ),
    );
    expect(lost.steering).toBeLessThan(0);
  });

  it('always returns in-range numbers', () => {
    for (const speed of [0, 5, 30]) {
      const i = decide(
        obsWith(
          cone(() => 'left_curve'),
          { speed, headingError: 3 },
        ),
      );
      expect(i.steering).toBeGreaterThanOrEqual(-1);
      expect(i.steering).toBeLessThanOrEqual(1);
      expect(i.accelerator).toBeGreaterThanOrEqual(0);
      expect(i.accelerator).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and keeps its state outside the function', () => {
    const o = obsWith(straightRoad(), { headingError: 0.2 });
    const a = rayFollowerDecide(o, { steering: 0.5 });
    expect(rayFollowerDecide(o, { steering: 0.5 })).toEqual(a);
    expect(a.state.steering).toBe(a.input.steering);
  });
});

describe('RayFollowerBot', () => {
  it('is a controller named "bot" that smooths across decisions and forgets on reset', () => {
    const bot = new RayFollowerBot();
    expect(bot.name).toBe('bot');
    const o = obsWith(straightRoad(), { headingError: -0.5 });
    const first = bot.decide(o).steering;
    const second = bot.decide(o).steering;
    expect(second).toBeGreaterThan(first);
    bot.reset();
    expect(bot.decide(o).steering).toBe(first);
  });

  it('uses the configured neutral for coasting', () => {
    const o = obsWith(straightRoad(), { speed: 22 });
    const a = new RayFollowerBot({ neutral: 0.4 }).decide(o).accelerator;
    expect(a).toBeCloseTo(0.4, 1);
    expect(DEFAULT_RAY_FOLLOWER_PARAMS.neutral).toBe(0.5);
  });
});
