import { describe, expect, it } from 'vitest';
import { GameLoop } from './loop';

function make(maxSubSteps = 5) {
  const log = { updates: 0, alphas: [] as number[] };
  const loop = new GameLoop({
    hz: 60,
    maxSubSteps,
    update: () => log.updates++,
    render: (a) => log.alphas.push(a),
  });
  return { loop, log };
}

describe('GameLoop', () => {
  it('runs the right number of fixed steps and renders once per advance', () => {
    const { loop, log } = make();
    expect(loop.advance(1 / 60)).toBe(1);
    expect(loop.advance(3 / 60 + 0.001)).toBe(3);
    expect(log.updates).toBe(4);
    expect(log.alphas).toHaveLength(2);
  });

  it('passes a fractional alpha and carries remainder', () => {
    const { loop, log } = make();
    loop.advance(1.5 / 60);
    expect(log.alphas[0]).toBeCloseTo(0.5, 5);
    loop.advance(0.5 / 60);
    expect(log.updates).toBe(2);
  });

  it('caps substeps and drops the backlog', () => {
    const { loop, log } = make(5);
    expect(loop.advance(10)).toBe(5);
    expect(log.alphas[0]).toBeGreaterThanOrEqual(0);
    expect(log.alphas[0]).toBeLessThan(1);
    expect(loop.advance(0)).toBe(0);
  });

  it('ignores negative elapsed time', () => {
    const { loop } = make();
    expect(loop.advance(-1)).toBe(0);
  });
});
