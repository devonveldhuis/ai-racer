/**
 * Drives a `CarController` from the fixed simulation step. Time is simulation time: call
 * `step(simTime, obsFactory)` once per physics step before `car.update`, then apply `input`.
 * A decision is due every `1 / decisionHz` seconds of sim time (the first at t = 0).
 *
 * - Sync results apply in the same step; async ones in the first step after they resolve.
 * - At most one decision is in flight; due decisions are skipped (and counted) meanwhile.
 * - Results are validated and clamped; bad fields, errors and rejections keep the last input.
 *   A decision that throws, rejects or returns a broken thenable counts as one error.
 * - `enabled = false` still lets the controller decide, but the car gets the hold input.
 * - `lockstep`: `blocking` is true while a decision is pending; the loop must not advance.
 */
import { sanitizeInput } from '../car/control';
import type { ControlMode } from '../core/config';
import type { DecisionLog } from './DecisionLog';
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
  /** Records every decision (and failure) when set. */
  log?: DecisionLog;
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

/** Whether `v` has a `then` function. Reading a hostile getter may throw: that counts as no. */
function isThenable(v: unknown): v is PromiseLike<CarInput> {
  if (typeof v !== 'object' || v === null) return false;
  try {
    return typeof (v as PromiseLike<unknown>).then === 'function';
  } catch {
    return false;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class ControllerHost {
  enabled = true;
  private readonly controller: CarController;
  private readonly period: number;
  private readonly mode: ControlMode;
  private readonly neutral: number;
  private readonly now: () => number;
  private readonly window: number;
  private readonly log: DecisionLog | undefined;
  private current: CarInput;
  private nextIndex = 0;
  private inFlight = false;
  private epoch = 0;
  private ready: { value: unknown; obs: Observation; latency: number } | null = null;
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
    this.log = opts.log;
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
      this.accept(r.value, r.obs, r.latency);
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
    let obs: Observation;
    let result: unknown;
    try {
      obs = obsFactory();
      result = this.controller.decide(obs);
    } catch (e) {
      this.fail(e, undefined, this.now() - start);
      return;
    }
    if (isThenable(result)) {
      this.inFlight = true;
      const epoch = this.epoch;
      // `Promise.resolve` adopts the thenable in a microtask, so a `then` that throws becomes
      // a rejection instead of escaping this call.
      Promise.resolve(result).then(
        (value) => {
          if (epoch !== this.epoch) return;
          this.inFlight = false;
          const latency = this.now() - start;
          this.sample(latency);
          this.ready = { value, obs, latency };
        },
        (e: unknown) => {
          if (epoch !== this.epoch) return;
          this.inFlight = false;
          const latency = this.now() - start;
          this.sample(latency);
          this.fail(e, obs, latency);
        },
      );
    } else {
      const latency = this.now() - start;
      this.sample(latency);
      this.accept(result, obs, latency);
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

  private sample(latency: number): void {
    this.latencies.push(latency);
    if (this.latencies.length > this.window) this.latencies.shift();
  }

  private accept(value: unknown, obs: Observation, latency: number): void {
    if (typeof value !== 'object' || value === null) {
      this.fail(new Error('decide() returned no input object'), obs, latency);
      return;
    }
    this.current = sanitizeInput(this.current, value as Partial<CarInput>);
    this.log?.push({ t: obs.t, observation: obs, action: { ...this.current }, latencyMs: latency });
  }

  private fail(e: unknown, obs: Observation | undefined, latency: number): void {
    this.errors++;
    if (obs) {
      this.log?.push({
        t: obs.t,
        observation: obs,
        action: { ...this.current },
        latencyMs: latency,
        error: errorText(e),
      });
    }
    if (!this.warned) {
      this.warned = true;
      console.warn(`Controller "${this.controller.name}" failed; keeping the previous input.`, e);
    }
  }
}
