import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseUrlOverrides } from './config';

describe('parseUrlOverrides', () => {
  it('returns defaults for an empty query', () => {
    expect(parseUrlOverrides('')).toEqual(DEFAULT_CONFIG);
    expect(parseUrlOverrides('?')).toEqual(DEFAULT_CONFIG);
  });

  it('does not mutate the defaults', () => {
    parseUrlOverrides('?seed=5&debug=1');
    expect(DEFAULT_CONFIG.seed).toBe(1);
    expect(DEFAULT_CONFIG.debug).toBe(false);
  });

  it('parses seed, controller and debug', () => {
    const c = parseUrlOverrides('?seed=1234&controller=bot&debug=1');
    expect(c.seed).toBe(1234);
    expect(c.controller).toBe('bot');
    expect(c.debug).toBe(true);
  });

  it('accepts URLSearchParams and bare debug flag', () => {
    const c = parseUrlOverrides(new URLSearchParams('debug&seed=-7'));
    expect(c.debug).toBe(true);
    expect(c.seed).toBe(-7);
  });

  it('parses debug=false/0', () => {
    expect(parseUrlOverrides('?debug=false', { ...DEFAULT_CONFIG, debug: true }).debug).toBe(false);
    expect(parseUrlOverrides('?debug=0', { ...DEFAULT_CONFIG, debug: true }).debug).toBe(false);
  });

  it('ignores invalid values', () => {
    const c = parseUrlOverrides('?seed=abc&controller=nope&debug=maybe');
    expect(c).toEqual(DEFAULT_CONFIG);
    expect(parseUrlOverrides('?seed=1.5').seed).toBe(DEFAULT_CONFIG.seed);
  });

  it('leaves unrelated config fields untouched', () => {
    const c = parseUrlOverrides('?seed=9');
    expect(c.physicsHz).toBe(60);
    expect(c.maxSubSteps).toBe(DEFAULT_CONFIG.maxSubSteps);
  });
});
