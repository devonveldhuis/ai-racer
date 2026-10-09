/**
 * A ring buffer of controller decisions, for debugging and training data. When full, the
 * oldest entry is dropped. `toJSONL()` gives one JSON object per line, oldest first.
 */
import type { CarInput, Observation } from './types';

export interface DecisionEntry {
  /** Race time of the observation the decision was made on (`observation.t`). */
  t: number;
  observation: Observation;
  /** The input the host applied after validation and clamping (the held input on failure). */
  action: CarInput;
  /** Wall-clock milliseconds from `decide()` to its result. */
  latencyMs: number;
  /** Set when the decision failed (the previous input was kept). */
  error?: string;
}

export const DEFAULT_LOG_CAPACITY = 20_000;

export class DecisionLog {
  readonly capacity: number;
  private buf: DecisionEntry[] = [];
  /** Index of the oldest entry once the buffer is full. */
  private head = 0;

  constructor(capacity = DEFAULT_LOG_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  get size(): number {
    return this.buf.length;
  }

  push(entry: DecisionEntry): void {
    if (this.buf.length < this.capacity) {
      this.buf.push(entry);
    } else {
      this.buf[this.head] = entry;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** The entries, oldest first. */
  entries(): DecisionEntry[] {
    if (this.buf.length < this.capacity) return [...this.buf];
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  clear(): void {
    this.buf = [];
    this.head = 0;
  }

  /** One JSON object per line, each ending in a newline; empty string when the log is empty. */
  toJSONL(): string {
    let out = '';
    for (const e of this.entries()) out += JSON.stringify(e) + '\n';
    return out;
  }
}
