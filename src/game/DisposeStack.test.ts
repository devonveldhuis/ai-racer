import { describe, expect, it, vi } from 'vitest';
import { DisposeStack } from './DisposeStack';

describe('DisposeStack', () => {
  it('runs cleanups newest first and only once', () => {
    const order: string[] = [];
    const s = new DisposeStack();
    s.add(1, () => order.push('a'));
    s.add(2, () => order.push('b'));
    s.add(3, () => order.push('c'));
    s.disposeAll();
    s.disposeAll();
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('returns the added value', () => {
    const o = {};
    expect(new DisposeStack().add(o, () => {})).toBe(o);
  });

  it('keeps going when one cleanup throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    const s = new DisposeStack();
    s.add(0, ok);
    s.add(0, () => {
      throw new Error('boom');
    });
    s.disposeAll();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('frees a partially built session when a later step fails', async () => {
    const freed: string[] = [];
    const build = async () => {
      const cleanup = new DisposeStack();
      try {
        cleanup.add('track', () => freed.push('track'));
        cleanup.add('car', () => freed.push('car'));
        await Promise.reject(new Error('model failed')); // the view fails to load
        return cleanup.release();
      } catch (e) {
        cleanup.disposeAll();
        throw e;
      }
    };
    await expect(build()).rejects.toThrow('model failed');
    expect(freed).toEqual(['car', 'track']);
  });

  it('release() hands the cleanups over without running them', () => {
    const fn = vi.fn();
    const s = new DisposeStack();
    s.add(0, fn);
    const dispose = s.release();
    s.disposeAll();
    expect(fn).not.toHaveBeenCalled();
    dispose();
    dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
