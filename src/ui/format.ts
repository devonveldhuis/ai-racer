/** Pure formatters for the HUD. */

/** Seconds as `m:ss.mmm` (minutes are not capped: 10 min 5 s is `10:05.000`). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalS = (totalMs - ms) / 1000;
  const s = totalS % 60;
  const m = (totalS - s) / 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Speed in m/s as a whole number of km/h (absolute value: reversing shows a positive number). */
export function formatKmh(metresPerSecond: number): string {
  if (!Number.isFinite(metresPerSecond)) return '0';
  return String(Math.round(Math.abs(metresPerSecond) * 3.6));
}

/** A time penalty, signed: `+2.0 s`. */
export function formatPenalty(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${Math.abs(seconds).toFixed(1)} s`;
}
