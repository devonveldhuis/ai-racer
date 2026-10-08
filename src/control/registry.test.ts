import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { createController } from './registry';

const keys = { isDown: () => false, dispose: () => {} };

describe('createController', () => {
  it('creates the keyboard controller', () => {
    expect(createController('keyboard', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
  });

  it('warns and falls back to keyboard for unimplemented kinds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createController('bot', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
    expect(createController('nope', { config: DEFAULT_CONFIG, keys }).name).toBe('keyboard');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
