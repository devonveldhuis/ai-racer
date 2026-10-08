import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './events';

interface Ev {
  a: number;
  b: string;
}

describe('EventBus', () => {
  it('delivers payloads to subscribers in order', () => {
    const bus = new EventBus<Ev>();
    const seen: string[] = [];
    bus.on('a', (n) => seen.push(`1:${n}`));
    bus.on('a', (n) => seen.push(`2:${n}`));
    bus.on('b', (s) => seen.push(s));
    bus.emit('a', 5);
    expect(seen).toEqual(['1:5', '2:5']);
  });

  it('unsubscribes via the returned function', () => {
    const bus = new EventBus<Ev>();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    bus.emit('a', 1);
    off();
    bus.emit('a', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows unsubscribing during emit, and clearing', () => {
    const bus = new EventBus<Ev>();
    const fn = vi.fn();
    const off = bus.on('a', () => off());
    bus.on('a', fn);
    bus.emit('a', 1);
    bus.emit('a', 2);
    expect(fn).toHaveBeenCalledTimes(2);
    bus.clear('a');
    bus.emit('a', 3);
    expect(fn).toHaveBeenCalledTimes(2);
    bus.on('b', fn);
    bus.clear();
    bus.emit('b', 'x');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
