import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import {
  ackermannAngles,
  mapPedals,
  maxSteerAngle,
  sanitizeInput,
  stepSteerAngle,
  targetSteerAngle,
} from './control';

const car = DEFAULT_CONFIG.car;
const pedals = { neutral: 0.5, maxEngineForce: 1000, maxBrakeForce: 200 };

describe('sanitizeInput', () => {
  const prev = { accelerator: 0.7, steering: -0.3 };
  it('passes valid values through', () => {
    expect(sanitizeInput(prev, { accelerator: 0.2, steering: 0.4 })).toEqual({
      accelerator: 0.2,
      steering: 0.4,
    });
  });
  it('clamps out-of-range values', () => {
    expect(sanitizeInput(prev, { accelerator: 5, steering: -5 })).toEqual({
      accelerator: 1,
      steering: -1,
    });
    expect(sanitizeInput(prev, { accelerator: -2, steering: 2 })).toEqual({
      accelerator: 0,
      steering: 1,
    });
  });
  it('keeps the previous value for NaN and infinities', () => {
    expect(sanitizeInput(prev, { accelerator: NaN, steering: NaN })).toEqual(prev);
    expect(sanitizeInput(prev, { accelerator: Infinity, steering: -Infinity })).toEqual(prev);
  });
  it('handles one component at a time and missing fields', () => {
    expect(sanitizeInput(prev, { accelerator: NaN, steering: 0.5 })).toEqual({
      accelerator: 0.7,
      steering: 0.5,
    });
    expect(sanitizeInput(prev, {})).toEqual(prev);
  });
});

describe('mapPedals', () => {
  it('full brake at 0', () => {
    expect(mapPedals(0, pedals)).toEqual({ engine: 0, brake: 200 });
  });
  it('brake proportional below neutral', () => {
    expect(mapPedals(0.25, pedals)).toEqual({ engine: 0, brake: 100 });
  });
  it('coasts at neutral', () => {
    expect(mapPedals(0.5, pedals)).toEqual({ engine: 0, brake: 0 });
  });
  it('engine proportional above neutral', () => {
    expect(mapPedals(0.75, pedals)).toEqual({ engine: 500, brake: 0 });
  });
  it('full engine at 1', () => {
    expect(mapPedals(1, pedals)).toEqual({ engine: 1000, brake: 0 });
  });
  it('honours a non-default neutral', () => {
    const p = { ...pedals, neutral: 0.2 };
    expect(mapPedals(0.2, p)).toEqual({ engine: 0, brake: 0 });
    expect(mapPedals(0.1, p).brake).toBeCloseTo(100);
    expect(mapPedals(0, p).brake).toBeCloseTo(200);
    expect(mapPedals(0.6, p).engine).toBeCloseTo(500);
    expect(mapPedals(1, p).engine).toBeCloseTo(1000);
    expect(mapPedals(0.5, { ...pedals, neutral: 0.8 }).brake).toBeCloseTo(75);
  });
});

describe('steering curve', () => {
  const cfg = { steerAngleLow: 1, steerAngleHigh: 0.2, steerFalloffSpeed: 20 };
  it('is the low-speed angle at standstill and the high-speed angle from the falloff speed', () => {
    expect(maxSteerAngle(0, cfg)).toBeCloseTo(1);
    expect(maxSteerAngle(20, cfg)).toBeCloseTo(0.2);
    expect(maxSteerAngle(50, cfg)).toBeCloseTo(0.2);
  });
  it('blends linearly and uses the absolute speed', () => {
    expect(maxSteerAngle(10, cfg)).toBeCloseTo(0.6);
    expect(maxSteerAngle(-10, cfg)).toBeCloseTo(0.6);
  });
  it('never grows with speed for the default config', () => {
    let prev = Infinity;
    for (let v = 0; v <= 30; v += 1) {
      const a = maxSteerAngle(v, car);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });
  it('scales the target with the input and keeps the sign', () => {
    expect(targetSteerAngle(-1, 0, cfg)).toBeCloseTo(-1);
    expect(targetSteerAngle(0.5, 10, cfg)).toBeCloseTo(0.3);
    expect(targetSteerAngle(3, 20, cfg)).toBeCloseTo(0.2);
  });
});

describe('stepSteerAngle', () => {
  it('moves at most rate * dt towards the target', () => {
    expect(stepSteerAngle(0, 1, 2, 0.1)).toBeCloseTo(0.2);
    expect(stepSteerAngle(0, -1, 2, 0.1)).toBeCloseTo(-0.2);
    expect(stepSteerAngle(0.5, 0, 2, 0.1)).toBeCloseTo(0.3);
  });
  it('lands exactly on a close target', () => {
    expect(stepSteerAngle(0.1, 0.15, 2, 0.1)).toBeCloseTo(0.15);
  });
  it('takes angle / rate seconds from lock to lock', () => {
    let a = -1;
    let t = 0;
    while (a < 1 - 1e-9 && t < 10) {
      a = stepSteerAngle(a, 1, 4, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(0.5, 1);
  });
});

describe('ackermannAngles', () => {
  it('is zero when going straight and symmetric for left and right', () => {
    expect(ackermannAngles(0, 3.2, 1.1)).toEqual({ left: 0, right: 0 });
    const r = ackermannAngles(0.5, 3.2, 1.1);
    const l = ackermannAngles(-0.5, 3.2, 1.1);
    expect(l.left).toBeCloseTo(-r.right);
    expect(l.right).toBeCloseTo(-r.left);
  });
  it('turns the inner wheel more, and both wheels share one turning centre', () => {
    const wb = 3.2;
    const t = 1.1;
    const a = ackermannAngles(0.6, wb, t);
    expect(a.right).toBeGreaterThan(0.6); // right turn: the right wheel is inside
    expect(a.left).toBeLessThan(0.6);
    // Turning centre on the rear axle line: lateral distance = wb / tan(angle) for each wheel.
    const rIn = wb / Math.tan(a.right);
    const rOut = wb / Math.tan(a.left);
    expect(rOut - rIn).toBeCloseTo(2 * t);
    expect((rIn + rOut) / 2).toBeCloseTo(wb / Math.tan(0.6));
  });
});
