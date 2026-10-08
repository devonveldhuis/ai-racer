import { describe, expect, it } from 'vitest';
import { bestTimeForSeed, type RaceResult } from './results';

const r = (seed: number, totalTime: number): RaceResult => ({
  seed,
  controller: 'keyboard',
  laps: 1,
  totalTime,
  lapTimes: [totalTime],
  resets: 0,
  offTrackTime: 0,
  timestamp: '2026-01-01T00:00:00.000Z',
});

describe('bestTimeForSeed', () => {
  it('returns null without results for the seed', () => {
    expect(bestTimeForSeed(1, undefined, [])).toBeNull();
    expect(bestTimeForSeed(1, undefined, [r(2, 30)])).toBeNull();
  });
  it('returns the lowest time of that seed only', () => {
    const list = [r(1, 50), r(2, 20), r(1, 40.5), r(1, 45)];
    expect(bestTimeForSeed(1, undefined, list)).toBe(40.5);
    expect(bestTimeForSeed(2, undefined, list)).toBe(20);
  });
  it('can leave one result out to get the previous best', () => {
    const latest = r(1, 38);
    const list = [r(1, 50), r(1, 40), latest];
    expect(bestTimeForSeed(1, undefined, list)).toBe(38);
    expect(bestTimeForSeed(1, latest, list)).toBe(40);
    expect(bestTimeForSeed(1, list[0], [list[0] as RaceResult])).toBeNull();
  });
});
