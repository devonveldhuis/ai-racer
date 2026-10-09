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

  it('parses laps and ignores invalid values', () => {
    expect(parseUrlOverrides('?laps=3').race).toEqual({ ...DEFAULT_CONFIG.race, laps: 3 });
    expect(parseUrlOverrides('?laps=0').race.laps).toBe(DEFAULT_CONFIG.race.laps);
    expect(parseUrlOverrides('?laps=x').race.laps).toBe(DEFAULT_CONFIG.race.laps);
    expect(parseUrlOverrides('?laps=2.5').race.laps).toBe(DEFAULT_CONFIG.race.laps);
  });

  it('leaves unrelated config fields untouched', () => {
    const c = parseUrlOverrides('?seed=9');
    expect(c.physicsHz).toBe(60);
    expect(c.maxSubSteps).toBe(DEFAULT_CONFIG.maxSubSteps);
  });

  it('parses fov and rays, ignoring invalid values', () => {
    const c = parseUrlOverrides('?fov=120&rays=15');
    expect(c.sensor.fovDeg).toBe(120);
    expect(c.sensor.rayCount).toBe(15);
    expect(c.sensor.sampleDistances).toEqual([5, 10, 20, 35]);
    expect(DEFAULT_CONFIG.sensor).toMatchObject({ fovDeg: 90, rayCount: 9, maxRange: 40 });
    for (const q of [
      '?fov=0',
      '?fov=abc',
      '?fov=361',
      '?fov=-5',
      '?rays=0',
      '?rays=2.5',
      '?rays=500',
      '?rays=x',
    ]) {
      const bad = parseUrlOverrides(q);
      expect(bad.sensor.fovDeg).toBe(90);
      expect(bad.sensor.rayCount).toBe(9);
    }
    expect(parseUrlOverrides('?rays=1').sensor.rayCount).toBe(1);
  });

  it('parses url and timeoutMs for the remote controller', () => {
    const c = parseUrlOverrides('?controller=remote&url=http://localhost:8787&timeoutMs=500');
    expect(c.controller).toBe('remote');
    expect(c.remote).toEqual({ url: 'http://localhost:8787', timeoutMs: 500 });
    expect(parseUrlOverrides('?url=https%3A%2F%2Fexample.com%2Fdrive%3Fx%3D1').remote.url).toBe(
      'https://example.com/drive?x=1',
    );
    expect(parseUrlOverrides('?url=%20http://127.0.0.1:9/%20').remote.url).toBe(
      'http://127.0.0.1:9/',
    );
  });

  it('defaults the remote to no url and a 2000 ms timeout', () => {
    expect(parseUrlOverrides('').remote).toEqual({ url: null, timeoutMs: 2000 });
  });

  it('ignores invalid and non-http(s) urls', () => {
    for (const bad of [
      '',
      'localhost:8787',
      'ftp://x/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(parseUrlOverrides(`?url=${encodeURIComponent(bad)}`).remote.url).toBeNull();
    }
  });

  it('ignores invalid timeoutMs', () => {
    for (const bad of ['0', '-5', '1.5', 'abc', '', '600001']) {
      expect(parseUrlOverrides(`?timeoutMs=${bad}`).remote.timeoutMs).toBe(2000);
    }
    expect(parseUrlOverrides('?timeoutMs=600000').remote.timeoutMs).toBe(600000);
  });
});
