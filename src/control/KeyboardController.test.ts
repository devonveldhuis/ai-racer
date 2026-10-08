import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { KeyboardController, WindowKeySource, type KeySource } from './KeyboardController';
import type { Observation } from './types';

const cfg = DEFAULT_CONFIG.keyboard;
const N = DEFAULT_CONFIG.car.neutral;

function fakeKeys() {
  const down = new Set<string>();
  const src: KeySource = { isDown: (k) => down.has(k), dispose: vi.fn() };
  return { down, src };
}
const obs = (t: number): Observation => ({
  t,
  car: { accelerator: 0, steering: 0, speed: 0, surface: 'road' },
});

/** Advances the controller over `seconds` in `steps` equal steps, starting at `t0`. */
function advance(c: KeyboardController, t0: number, seconds: number, steps: number) {
  let out = c.decide(obs(t0));
  for (let i = 1; i <= steps; i++) out = c.decide(obs(t0 + (seconds * i) / steps));
  return out;
}

describe('KeyboardController', () => {
  it('starts neutral', () => {
    const { src } = fakeKeys();
    expect(new KeyboardController(cfg, N, src).decide(obs(0))).toEqual({
      accelerator: N,
      steering: 0,
    });
  });

  it('ramps the accelerator to 1 at the configured rate, then holds', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('w');
    const half = (1 - N) / cfg.accelRate / 2;
    expect(advance(c, 0, half, 6).accelerator).toBeCloseTo(N + (1 - N) / 2, 6);
    expect(advance(c, half, 5, 10).accelerator).toBe(1);
  });

  it('ramps down to 0 on brake and returns to neutral when released', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('arrowdown');
    expect(advance(c, 0, 2, 20).accelerator).toBe(0);
    down.clear();
    expect(advance(c, 2, 0.05, 3).accelerator).toBeGreaterThan(0);
    expect(advance(c, 2.05, 3, 30).accelerator).toBe(N);
  });

  it('returns a held throttle to neutral when released', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('w');
    advance(c, 0, 2, 20);
    down.clear();
    expect(advance(c, 2, 3, 30).accelerator).toBe(N);
  });

  it('gives neutral when both pedals are held', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('w');
    advance(c, 0, 2, 20);
    down.add('s');
    expect(advance(c, 2, 3, 30).accelerator).toBe(N);
  });

  it('ramps the steering both ways and centres faster than it turns', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('d');
    expect(advance(c, 0, 1 / cfg.steerRate / 2, 5).steering).toBeCloseTo(0.5, 6);
    expect(advance(c, 0.2, 2, 20).steering).toBe(1);
    down.clear();
    const t = 1 / cfg.steerReturnRate / 2;
    expect(advance(c, 2.2, t, 5).steering).toBeCloseTo(0.5, 6);
    expect(advance(c, 2.2 + t, 2, 20).steering).toBe(0);
    down.add('arrowleft');
    expect(advance(c, 4.5, 2, 20).steering).toBe(-1);
    expect(cfg.steerReturnRate).toBeGreaterThan(cfg.steerRate);
  });

  it('centres the steering when both steer keys are held', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('a');
    advance(c, 0, 2, 20);
    down.add('d');
    expect(advance(c, 2, 2, 20).steering).toBe(0);
  });

  it('does not depend on the timestep', () => {
    const run = (steps: number) => {
      const { down, src } = fakeKeys();
      const c = new KeyboardController(cfg, N, src);
      down.add('w');
      down.add('d');
      return advance(c, 0, 0.1, steps);
    };
    const a = run(60);
    const b = run(6);
    expect(a.accelerator).toBeCloseTo(b.accelerator, 9);
    expect(a.steering).toBeCloseTo(b.steering, 9);
    expect(a.accelerator).toBeGreaterThan(N);
    expect(a.accelerator).toBeLessThan(1);
  });

  it('reset() returns to neutral and dispose() disposes the key source', () => {
    const { down, src } = fakeKeys();
    const c = new KeyboardController(cfg, N, src);
    down.add('w');
    down.add('d');
    advance(c, 0, 2, 20);
    c.reset();
    expect(c.decide(obs(5))).toEqual({ accelerator: N, steering: 0 });
    c.dispose();
    expect(src.dispose).toHaveBeenCalled();
  });
});

describe('WindowKeySource', () => {
  function fakeWindow() {
    const handlers = new Map<string, Set<(e: unknown) => void>>();
    const win = {
      addEventListener: (t: string, h: (e: unknown) => void) => {
        if (!handlers.has(t)) handlers.set(t, new Set());
        handlers.get(t)!.add(h);
      },
      removeEventListener: (t: string, h: (e: unknown) => void) => handlers.get(t)?.delete(h),
    } as unknown as Window;
    const fire = (t: string, e: object = {}) => handlers.get(t)?.forEach((h) => h(e));
    const count = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);
    return { win, fire, count };
  }
  const key = (k: string, extra: object = {}) => ({ key: k, preventDefault: () => {}, ...extra });

  it('tracks keys, ignores repeats and modified keys, clears on blur', () => {
    const { win, fire } = fakeWindow();
    const src = new WindowKeySource(win);
    fire('keydown', key('W'));
    expect(src.isDown('w')).toBe(true);
    fire('keyup', key('W'));
    expect(src.isDown('w')).toBe(false);
    fire('keydown', key('a', { repeat: true }));
    fire('keydown', key('s', { ctrlKey: true }));
    fire('keydown', key('d', { metaKey: true }));
    expect(src.isDown('a') || src.isDown('s') || src.isDown('d')).toBe(false);
    fire('keydown', key('ArrowUp'));
    expect(src.isDown('arrowup')).toBe(true);
    fire('blur');
    expect(src.isDown('arrowup')).toBe(false);
  });

  it('dispose() removes the listeners', () => {
    const { win, fire, count } = fakeWindow();
    const src = new WindowKeySource(win);
    expect(count()).toBe(3);
    src.dispose();
    expect(count()).toBe(0);
    fire('keydown', key('w'));
    expect(src.isDown('w')).toBe(false);
  });
});
