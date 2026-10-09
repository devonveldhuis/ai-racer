import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { createController } from './registry';

const keys = { isDown: () => false, dispose: () => {} };
const remote = (url: string | null) => ({
  config: { ...DEFAULT_CONFIG, remote: { url, timeoutMs: 1500 } },
  keys,
});

describe('createController', () => {
  it('creates the keyboard controller', () => {
    expect(createController('keyboard', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
  });

  it('creates the ray-follower bot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createController('bot', { config: DEFAULT_CONFIG, keys }).name).toBe('bot');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('creates the remote controller when a url is set, and passes fetch through', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ accelerator: 1, steering: 0 })),
    );
    const c = createController('remote', { ...remote('http://localhost:8787'), fetch: fetchFn });
    expect(c.name).toBe('remote');
    await c.decide({
      t: 0,
      car: {
        accelerator: 0.5,
        steering: 0,
        speed: 0,
        surface: 'road',
        headingError: 0,
        lateralOffset: 0,
      },
      rays: [],
      progress: { checkpoint: 0, totalCheckpoints: 4, lap: 1, totalLaps: 1 },
    });
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:8787', expect.anything());
  });

  it('warns and falls back to keyboard for a remote without a url', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createController('remote', remote(null)).name).toBe('keyboard');
    expect(createController('remote', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('warns and falls back to keyboard for unknown kinds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createController('nope', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
