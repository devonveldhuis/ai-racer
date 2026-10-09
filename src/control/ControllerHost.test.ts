import { describe, expect, it, vi } from 'vitest';
import { GameLoop } from '../core/loop';
import { ControllerHost, HOLD_INPUT } from './ControllerHost';
import { blankObservation } from './testObservation';
import type { CarController, CarInput } from './types';

const DT = 1 / 60;
const obs = blankObservation;

/** Steps the host `n` times at 60 Hz from `t0`; returns the final sim time. */
function run(host: ControllerHost, n: number, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    host.step(t, () => obs(t));
    t += DT;
  }
  return t;
}

function make(
  decide: CarController['decide'],
  opts: Partial<ConstructorParameters<typeof ControllerHost>[1]> = {},
) {
  const controller: CarController = { name: 'test', decide, reset: vi.fn() };
  const host = new ControllerHost(controller, { decisionHz: 10, ...opts });
  return { host, controller };
}

function deferred() {
  let resolve!: (v: CarInput) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<CarInput>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ControllerHost', () => {
  it('decides at the decision rate in sim time, the first at t = 0', () => {
    const decide = vi.fn((): CarInput => ({ accelerator: 1, steering: 0 }));
    const { host } = make(decide);
    run(host, 1);
    expect(decide).toHaveBeenCalledTimes(1);
    run(host, 59, DT);
    expect(decide).toHaveBeenCalledTimes(10);
    run(host, 60, 1);
    expect(host.stats().decisions).toBe(20);
  });

  it('starts neutral and applies a sync result in the same step', () => {
    const { host } = make(() => ({ accelerator: 0.9, steering: -0.3 }), { neutral: 0.5 });
    expect(host.input).toEqual({ accelerator: 0.5, steering: 0 });
    host.step(0, () => obs(0));
    expect(host.input).toEqual({ accelerator: 0.9, steering: -0.3 });
  });

  it('applies an async result in the first step after it resolves, holding meanwhile', async () => {
    const d = deferred();
    const { host } = make(() => d.promise);
    host.step(0, () => obs(0));
    host.step(DT, () => obs(DT));
    expect(host.input).toEqual({ accelerator: 0.5, steering: 0 });
    d.resolve({ accelerator: 1, steering: 1 });
    await Promise.resolve();
    expect(host.input).toEqual({ accelerator: 0.5, steering: 0 });
    host.step(2 * DT, () => obs(2 * DT));
    expect(host.input).toEqual({ accelerator: 1, steering: 1 });
  });

  it('never has two decisions in flight and counts skipped ones', async () => {
    const pending = [deferred(), deferred()];
    let i = 0;
    const decide = vi.fn(() => pending[i++]!.promise);
    const { host } = make(decide);
    run(host, 31); // t = 0 ... 0.5 are due: 1 call, 5 skipped
    expect(decide).toHaveBeenCalledTimes(1);
    expect(host.stats().skipped).toBe(5);
    pending[0]!.resolve({ accelerator: 1, steering: 0 });
    await Promise.resolve();
    run(host, 6, 31 * DT); // next due at t = 0.6 -> new decision
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it('clamps and ignores bad fields', () => {
    let next: unknown = { accelerator: 5, steering: -9 };
    const { host } = make(() => next as CarInput, { decisionHz: 60 });
    host.step(0, () => obs(0));
    expect(host.input).toEqual({ accelerator: 1, steering: -1 });
    next = { accelerator: Number.NaN, steering: 0.25 };
    host.step(DT, () => obs(DT));
    expect(host.input).toEqual({ accelerator: 1, steering: 0.25 });
    next = { steering: Infinity };
    host.step(2 * DT, () => obs(2 * DT));
    expect(host.input).toEqual({ accelerator: 1, steering: 0.25 });
    next = { accelerator: -3 };
    host.step(3 * DT, () => obs(3 * DT));
    expect(host.input).toEqual({ accelerator: 0, steering: 0.25 });
  });

  it('keeps the input on a thrown error or rejection, counts them, warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let mode = 0;
    const { host } = make(
      () => {
        if (mode === 0) return { accelerator: 0.8, steering: 0.1 };
        if (mode === 1) throw new Error('boom');
        return Promise.reject(new Error('nope'));
      },
      { decisionHz: 60 },
    );
    host.step(0, () => obs(0));
    mode = 1;
    host.step(DT, () => obs(DT));
    mode = 2;
    host.step(2 * DT, () => obs(2 * DT));
    await Promise.resolve();
    await Promise.resolve();
    host.step(3 * DT, () => obs(3 * DT));
    expect(host.input).toEqual({ accelerator: 0.8, steering: 0.1 });
    expect(host.stats().errors).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives the hold input while disabled but still lets the controller decide', () => {
    const decide = vi.fn((): CarInput => ({ accelerator: 1, steering: 1 }));
    const { host } = make(decide, { decisionHz: 60 });
    host.enabled = false;
    run(host, 3);
    expect(decide).toHaveBeenCalledTimes(3);
    expect(host.input).toEqual(HOLD_INPUT);
    host.enabled = true;
    expect(host.input).toEqual({ accelerator: 1, steering: 1 });
  });

  it('reset() ignores a stale in-flight result and resets the controller', async () => {
    const d = deferred();
    const { host, controller } = make(() => d.promise);
    host.step(0, () => obs(0));
    host.reset();
    expect(controller.reset).toHaveBeenCalled();
    d.resolve({ accelerator: 1, steering: 1 });
    await Promise.resolve();
    expect(host.blocking).toBe(false);
    host.step(DT, () => obs(DT)); // new decision is due immediately after a reset
    expect(host.input).toEqual({ accelerator: 0.5, steering: 0 });
  });

  it('is blocking in lockstep while a decision is pending, and GameLoop stops updating', async () => {
    const d = deferred();
    const { host } = make(() => d.promise, { mode: 'lockstep' });
    let t = 0;
    let updates = 0;
    const loop = new GameLoop({
      hz: 60,
      shouldUpdate: () => !host.blocking,
      update: (dt) => {
        host.step(t, () => obs(t));
        t += dt;
        updates++;
      },
      render: () => {},
    });
    expect(loop.advance(5 * DT)).toBe(1); // first step starts the decision, then blocked
    expect(host.blocking).toBe(true);
    expect(loop.advance(10)).toBe(0);
    expect(updates).toBe(1);
    d.resolve({ accelerator: 1, steering: 0 });
    await Promise.resolve();
    expect(host.blocking).toBe(false);
    // No backlog from the blocked time: one frame advances only its own time.
    expect(loop.advance(DT)).toBe(1);
    expect(host.input.accelerator).toBe(1);
  });

  it('is never blocking in realtime', () => {
    const { host } = make(() => deferred().promise);
    host.step(0, () => obs(0));
    expect(host.blocking).toBe(false);
  });

  it('reports latency mean and p95 from the injected clock', () => {
    let clock = 0;
    const latencies = [10, 20, 30, 40];
    let i = 0;
    const { host } = make(
      () => {
        clock += latencies[i++]!;
        return { accelerator: 0.5, steering: 0 };
      },
      { decisionHz: 60, now: () => clock },
    );
    run(host, 4);
    const s = host.stats();
    expect(s.latencyMean).toBeCloseTo(25, 6);
    expect(s.latencyP95).toBe(40);
  });

  it('bounds the latency window', () => {
    let clock = 0;
    const { host } = make(
      () => {
        clock += 1;
        return { accelerator: 0.5, steering: 0 };
      },
      { decisionHz: 60, now: () => clock, statsWindow: 3 },
    );
    run(host, 10);
    expect(host.stats().decisions).toBe(10);
    expect(host.stats().latencyMean).toBe(1);
  });

  it('calls the observation factory lazily: only when a decision is made', () => {
    const d = deferred();
    const decide = vi.fn((): Promise<CarInput> => d.promise);
    const { host } = make(decide, { decisionHz: 10 });
    const factory = vi.fn((t: number) => obs(t));
    let t = 0;
    for (let i = 0; i < 120; i++) {
      host.step(t, () => factory(t));
      t += DT;
    }
    // 120 steps = 2 s = 20 due decisions; the first is in flight for the rest, so the 19
    // skipped ones never build an observation.
    expect(decide).toHaveBeenCalledTimes(1);
    expect(host.stats().skipped).toBe(19);
    expect(factory).toHaveBeenCalledTimes(1);

    const sync = vi.fn((): CarInput => ({ accelerator: 0.5, steering: 0 }));
    const second = make(sync, { decisionHz: 10 });
    const factory2 = vi.fn((tt: number) => obs(tt));
    t = 0;
    for (let i = 0; i < 120; i++) {
      second.host.step(t, () => factory2(t));
      t += DT;
    }
    expect(factory2).toHaveBeenCalledTimes(20);
    expect(sync).toHaveBeenCalledTimes(20);
  });
});
