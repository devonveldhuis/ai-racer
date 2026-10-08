import { describe, expect, it, vi } from 'vitest';
import { installGameKeys, type GameKeyHandlers, type KeyTarget } from './gameKeys';
import { KeyboardController, WindowKeySource } from '../control/KeyboardController';
import { DEFAULT_CONFIG } from '../core/config';

type Listener = (e: KeyboardEvent) => void;

/** A fake window that records its listeners. */
function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  const target = {
    addEventListener: vi.fn((type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    }),
  };
  const count = () => [...listeners.values()].reduce((a, s) => a + s.size, 0);
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => {
    const e = { key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra };
    listeners.get('keydown')?.forEach((fn) => fn(e as KeyboardEvent));
  };
  return { target: target as unknown as KeyTarget & Window, count, press, raw: target };
}

function handlers(): GameKeyHandlers {
  return {
    reset: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    newTrack: vi.fn(),
    cycleCamera: vi.fn(),
  };
}

describe('installGameKeys', () => {
  it('maps R, Esc, Enter, N and C to the handlers', () => {
    const f = fakeTarget();
    const h = handlers();
    installGameKeys(h, f.target);
    f.press('r');
    f.press('R');
    f.press('Escape');
    f.press('Enter');
    f.press('n');
    f.press('c');
    f.press('x');
    expect(h.reset).toHaveBeenCalledTimes(2);
    expect(h.pause).toHaveBeenCalledTimes(1);
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.newTrack).toHaveBeenCalledTimes(1);
    expect(h.cycleCamera).toHaveBeenCalledTimes(1);
  });

  it('ignores repeats and modified keys', () => {
    const f = fakeTarget();
    const h = handlers();
    installGameKeys(h, f.target);
    f.press('n', { repeat: true });
    f.press('n', { ctrlKey: true });
    f.press('n', { metaKey: true });
    expect(h.newTrack).not.toHaveBeenCalled();
  });

  it('removes its listener when disposed, however often it was installed', () => {
    const f = fakeTarget();
    const h = handlers();
    // A rebuild loop: install and dispose ten times; nothing may accumulate.
    for (let i = 0; i < 10; i++) {
      const off = installGameKeys(h, f.target);
      expect(f.count()).toBe(1);
      off();
      expect(f.count()).toBe(0);
    }
    f.press('n');
    expect(h.newTrack).not.toHaveBeenCalled();
  });
});

describe('controller teardown', () => {
  it('KeyboardController.dispose removes the window key listeners', () => {
    const f = fakeTarget();
    const ctrl = new KeyboardController(
      DEFAULT_CONFIG.keyboard,
      DEFAULT_CONFIG.car.neutral,
      new WindowKeySource(f.target),
    );
    expect(f.count()).toBe(3);
    ctrl.dispose();
    expect(f.count()).toBe(0);
    expect(f.raw.removeEventListener).toHaveBeenCalledTimes(3);
  });
});
