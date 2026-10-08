import { describe, expect, it } from 'vitest';
import { DustPool } from './DustPool';

const spawn = (p: DustPool, life = 1, x = 0) => p.spawn(x, 0, 0, 0, 1, 0, life, 1, 1, 1);

describe('DustPool', () => {
  it('starts empty with fixed-size arrays', () => {
    const p = new DustPool(8);
    expect(p.aliveCount).toBe(0);
    expect(p.positions.length).toBe(24);
    expect(p.age.length).toBe(8);
  });

  it('never exceeds its capacity and recycles the oldest slot when full', () => {
    const p = new DustPool(4);
    const buffers = [p.positions, p.age, p.colors];
    for (let i = 0; i < 100; i++) spawn(p, 10, i);
    expect(p.aliveCount).toBe(4);
    expect(p.positions.length).toBe(12);
    expect([p.positions, p.age, p.colors]).toEqual(buffers);
    // The last four spawns (x = 96..99) are the ones alive.
    const xs = [0, 1, 2, 3].map((i) => p.positions[i * 3]).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(xs).toEqual([96, 97, 98, 99]);
  });

  it('recycles dead particles before overwriting live ones', () => {
    const p = new DustPool(3);
    const a = spawn(p, 0.1, 1);
    spawn(p, 10, 2);
    spawn(p, 10, 3);
    expect(p.aliveCount).toBe(3);
    p.update(0.2); // a dies
    expect(p.aliveCount).toBe(2);
    expect(p.age[a]).toBe(1);
    const reused = spawn(p, 10, 4);
    expect(reused).toBe(a);
    expect(p.aliveCount).toBe(3);
  });

  it('ages particles, lifts them and kills them at the end of their life', () => {
    const p = new DustPool(2);
    const i = p.spawn(0, 0, 0, 0, 2, 0, 1, 1, 1, 1);
    p.update(0.5);
    expect(p.age[i]).toBeCloseTo(0.5);
    expect(p.positions[i * 3 + 1]).toBeGreaterThan(0.9);
    p.update(0.6);
    expect(p.age[i]).toBe(1);
    expect(p.aliveCount).toBe(0);
    p.update(1); // dead particles stay dead and the count stays right
    expect(p.aliveCount).toBe(0);
  });
});
