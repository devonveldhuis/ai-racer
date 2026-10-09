import { describe, expect, it } from 'vitest';
import { DiscreteActionAdapter } from './DiscreteActionAdapter';

describe('DiscreteActionAdapter', () => {
  const a = new DiscreteActionAdapter();

  it('maps every default bucket to its value', () => {
    const steer = {
      hard_left: -1,
      left: -0.6,
      slight_left: -0.25,
      straight: 0,
      slight_right: 0.25,
      right: 0.6,
      hard_right: 1,
    };
    for (const [name, v] of Object.entries(steer)) {
      expect(a.toInput({ steering_choice: name, throttle_choice: 'coast' }).steering).toBe(v);
    }
    const thr = { brake: 0, coast: 0.5, half: 0.75, full: 1 };
    for (const [name, v] of Object.entries(thr)) {
      expect(a.toInput({ steering_choice: 'straight', throttle_choice: name }).accelerator).toBe(v);
    }
  });

  it('uses the configured neutral for coast', () => {
    const b = new DiscreteActionAdapter({ neutral: 0.4 });
    expect(b.toInput({ steering_choice: 'straight', throttle_choice: 'coast' }).accelerator).toBe(
      0.4,
    );
  });

  it('accepts custom buckets', () => {
    const b = new DiscreteActionAdapter({
      steering: { l: -1, r: 1 },
      throttle: { go: 1, stop: 0 },
    });
    expect(b.toInput({ steering_choice: 'r', throttle_choice: 'stop' })).toEqual({
      accelerator: 0,
      steering: 1,
    });
    expect(() => b.toInput({ steering_choice: 'left', throttle_choice: 'go' })).toThrow(/left/);
  });

  it('throws a descriptive error for unknown choices', () => {
    expect(() => a.toInput({ steering_choice: 'sideways', throttle_choice: 'full' })).toThrow(
      /steering_choice "sideways".*hard_left/,
    );
    expect(() => a.toInput({ steering_choice: 'left', throttle_choice: 'warp' })).toThrow(
      /throttle_choice "warp".*brake, coast, half, full/,
    );
    // Inherited object keys are not choices.
    expect(() => a.toInput({ steering_choice: 'toString', throttle_choice: 'full' })).toThrow();
    expect(() =>
      a.toInput({ steering_choice: 5 as unknown as string, throttle_choice: 'full' }),
    ).toThrow(/steering_choice 5/);
  });

  it('rejects empty bucket sets', () => {
    expect(() => new DiscreteActionAdapter({ steering: {} })).toThrow();
  });

  it('round-trips every bucket through fromInput', () => {
    for (const s of Object.keys(a.steering)) {
      for (const t of Object.keys(a.throttle)) {
        const choice = { steering_choice: s, throttle_choice: t };
        expect(a.fromInput(a.toInput(choice))).toEqual(choice);
      }
    }
  });

  it('picks the nearest bucket', () => {
    expect(a.fromInput({ accelerator: 0.9, steering: 0.45 })).toEqual({
      steering_choice: 'right',
      throttle_choice: 'full',
    });
    expect(a.fromInput({ accelerator: 0.1, steering: -0.9 })).toEqual({
      steering_choice: 'hard_left',
      throttle_choice: 'brake',
    });
    expect(a.fromInput({ accelerator: 0.6, steering: 0.1 })).toEqual({
      steering_choice: 'straight',
      throttle_choice: 'coast',
    });
  });

  it('breaks ties toward straight and coast', () => {
    // 0.125 is exactly between straight and slight_right; 0.425 between slight_right and right.
    expect(a.fromInput({ accelerator: 0.5, steering: 0.125 }).steering_choice).toBe('straight');
    expect(a.fromInput({ accelerator: 0.5, steering: -0.125 }).steering_choice).toBe('straight');
    expect(a.fromInput({ accelerator: 0.5, steering: 0.425 }).steering_choice).toBe('slight_right');
    expect(a.fromInput({ accelerator: 0.5, steering: -0.8 }).steering_choice).toBe('left');
    // 0.25 between brake and coast; 0.625 between coast and half; 0.875 between half and full.
    expect(a.fromInput({ accelerator: 0.25, steering: 0 }).throttle_choice).toBe('coast');
    expect(a.fromInput({ accelerator: 0.625, steering: 0 }).throttle_choice).toBe('coast');
    expect(a.fromInput({ accelerator: 0.875, steering: 0 }).throttle_choice).toBe('half');
  });
});
