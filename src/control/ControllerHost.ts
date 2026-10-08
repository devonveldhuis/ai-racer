/**
 * Drives a `CarController` from the fixed simulation step. Time is simulation time: call
 * `step(simTime, obsFactory)` once per physics step before `car.update`, then apply `input`.
 * A decision is due every `1 / decisionHz` seconds of sim time (the first at t = 0).
 *
 * - Sync results apply in the same step; async ones in the first step after they resolve.
 * - At most one decision is in flight; due decisions are skipped (and counted) meanwhile.
 * - Results are validated and clamped; bad fields, errors and rejections keep the last input.
 * - `enabled = false` still lets the controller decide, but the car gets the hold input.
 * - `lockstep`: `blocking` is true while a decision is pending; the loop must not advance.
 */
import { sanitizeInput } from '../car/control';
import type { ControlMode } from '../core/config';
import type { CarInput, CarController, Observation } from './types';

export interface ControllerHostOptions {
  decisionHz: number;
  mode?: ControlMode;
  /** Accelerator value that means "coast" (`car.neutral`). Default 0.5. */
  neutral?: number;
  /** Wall-clock milliseconds, for latency stats. Default `performance.now`. */
  now?: () => number;
  /** Number of latency samples kept. Default 120. */
  statsWindow?: number;
}

export interface HostStats {
  /** `decide()` calls made. */
  decisions: number;
  /** Due decisions skipped because one was still in flight. */
  skipped: number;
  /** Thrown errors, rejections and unusable results. */
  errors: number;
  /** Wall-clock ms over the rolling window (0 when empty). */
  latencyMean: number;
  latencyP95: number;
}

/** Full brake: holds the car on the line. */
export const HOLD_INPUT: Readonly<CarInput> = { accelerator: 0, steering: 0 };

const EPS = 1e-9;

function isThenable(v: unknown): v is PromiseLike<CarInput> {
  return (
    typeof v === 'object' && v !== null && typeof (v as PromiseLike<unknown>).then === 'function'
  );
}

export class ControllerHost {
  enabled = true;
  private readonly controller: CarController;
  private readonly period: number;
  private readonly mode: ControlMode;
  private readonly neutral: number;
  private readonly now: () => number;
  private readonly window: number;
  private current: CarInput;
  private nextIndex = 0;
  private inFlight = false;
  private epoch = 0;
  private ready: { value: unknown } | null = null;
  private decisions = 0;
  private skipped = 0;
  private errors = 0;
  private warned = false;
  private latencies: number[] = [];

  constructor(controller: CarController, opts: ControllerHostOptions) {
    this.controller = controller;
    this.period = 1 / opts.decisionHz;
    this.mode = opts.mode ?? 'realtime';
    this.neutral = opts.neutral ?? 0.5;
    this.now = opts.now ?? (() => performance.now());
    this.window = opts.statsWindow ?? 120;
    this.current = { accelerator: this.neutral, steering: 0 };
  }

  /** True while the game must not advance the sim (lockstep with a decision pending). */
  get blocking(): boolean {
    return this.mode === 'lockstep' && this.inFlight;
  }

  /** The input to give the car: the last valid decision, or the hold input while disabled. */
  get input(): CarInput {
    return this.enabled ? { ...this.current } : { ...HOLD_INPUT };
  }

  step(simTime: number, obsFactory: () => Observation): void {
    if (this.ready) {
      const r = this.ready;
      this.ready = null;
      this.accept(r.value);
    }
    if (simTime + EPS < this.nextIndex * this.period) return;
    // Next due time is the next multiple of the period after now (never a backlog).
    this.nextIndex = Math.floor((simTime + EPS) / this.period) + 1;
    if (this.inFlight) {
      this.skipped++;
      return;
    }
    this.decisions++;
    const start = this.now();
    let result: CarInput | Promise<CarInput>;
    try {
      result = this.controller.decide(obsFactory());
    } catch (e) {
      this.fail(e);
      return;
    }
    if (isThenable(result)) {
      this.inFlight = true;
      const epoch = this.epoch;
      result.then(
        (value) => {
          if (epoch !== this.epoch) return;
          this.inFlight = false;
          this.sample(start);
          this.ready = { value };
        },
        (e: unknown) => {
          if (epoch !== this.epoch) return;
          this.inFlight = false;
          this.sample(start);
          this.fail(e);
        },
      );
    } else {
      this.sample(start);
      this.accept(result);
    }
  }

  /** Drops any in-flight decision, returns to the neutral input and resets the controller. */
  reset(): void {
    this.epoch++;
    this.inFlight = false;
    this.ready = null;
    this.nextIndex = 0;
    this.current = { accelerator: this.neutral, steering: 0 };
    this.controller.reset?.();
  }

  stats(): HostStats {
    const l = this.latencies;
    let mean = 0;
    let p95 = 0;
    if (l.length > 0) {
      mean = l.reduce((a, b) => a + b, 0) / l.length;
      const sorted = [...l].sort((a, b) => a - b);
      p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
    }
    return {
      decisions: this.decisions,
      skipped: this.skipped,
      errors: this.errors,
      latencyMean: mean,
      latencyP95: p95,
    };
  }

  private sample(start: number): void {
    this.latencies.push(this.now() - start);
    if (this.latencies.length > this.window) this.latencies.shift();
  }

  private accept(value: unknown): void {
    if (typeof value !== 'object' || value === null) {
      this.fail(new Error('decide() returned no input object'));
      return;
    }
    this.current = sanitizeInput(this.current, value as Partial<CarInput>);
  }

  private fail(e: unknown): void {
    this.errors++;
    if (!this.warned) {
      this.warned = true;
      console.warn(`Controller "${this.controller.name}" failed; keeping the previous input.`, e);
    }
  }
}
