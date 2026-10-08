/** Finished-race results: logged to the console and kept in memory (for later export). */

export interface RaceResult {
  seed: number;
  /** Controller name (`keyboard`, ...). */
  controller: string;
  laps: number;
  /** Race time in seconds of simulation time, including reset penalties. */
  totalTime: number;
  /** Per-lap times (seconds); they add up to `totalTime`. */
  lapTimes: number[];
  resets: number;
  /** Seconds on grass, sand or off the ground. */
  offTrackTime: number;
  /** ISO 8601 wall-clock time the race finished. */
  timestamp: string;
}

const results: RaceResult[] = [];

/** Stores `result` and logs it as one line plus the object. */
export function recordResult(result: RaceResult): void {
  results.push(result);
  console.info(
    `Race finished: seed ${result.seed}, ${result.controller}, ${result.totalTime.toFixed(2)} s, ` +
      `${result.laps} lap(s), ${result.resets} reset(s), ${result.offTrackTime.toFixed(1)} s off track`,
    result,
  );
}

export function getResults(): readonly RaceResult[] {
  return results;
}

export function clearResults(): void {
  results.length = 0;
}

/**
 * The lowest `totalTime` on `seed`, or `null` if there is none. `exclude` leaves one result out
 * (the one just finished, to get the previous best); `list` defaults to the in-memory results.
 */
export function bestTimeForSeed(
  seed: number,
  exclude?: RaceResult,
  list: readonly RaceResult[] = results,
): number | null {
  let best: number | null = null;
  for (const r of list) {
    if (r.seed !== seed || r === exclude) continue;
    if (best === null || r.totalTime < best) best = r.totalTime;
  }
  return best;
}
