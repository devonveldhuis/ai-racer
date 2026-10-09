/**
 * Maps named choices ("hard_left", "full") to a `CarInput` and back. This is how a fast,
 * "System One" model answers: words, not floats. Self-contained (no runtime imports), so the
 * Node mock server can use it.
 */
import type { CarInput } from './types';

export interface DiscreteAction {
  steering_choice: string;
  throttle_choice: string;
}

export const DEFAULT_STEERING_BUCKETS: Readonly<Record<string, number>> = {
  hard_left: -1,
  left: -0.6,
  slight_left: -0.25,
  straight: 0,
  slight_right: 0.25,
  right: 0.6,
  hard_right: 1,
};

/** Throttle buckets for a given neutral (coast) accelerator value. */
export function defaultThrottleBuckets(neutral = 0.5): Record<string, number> {
  return { brake: 0, coast: neutral, half: 0.75, full: 1 };
}

export interface DiscreteActionAdapterOptions {
  steering?: Record<string, number>;
  throttle?: Record<string, number>;
  /** The coast value of the default throttle buckets (`car.neutral`). Default 0.5. */
  neutral?: number;
}

/** The name of the bucket nearest `value`; a tie goes to the bucket nearest `rest`. */
function nearest(buckets: Record<string, number>, value: number, rest: number): string {
  let best = '';
  let bestD = Infinity;
  let bestR = Infinity;
  for (const [name, v] of Object.entries(buckets)) {
    const d = Math.abs(v - value);
    const r = Math.abs(v - rest);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && r < bestR)) {
      best = name;
      bestD = d;
      bestR = r;
    }
  }
  return best;
}

export class DiscreteActionAdapter {
  readonly steering: Readonly<Record<string, number>>;
  readonly throttle: Readonly<Record<string, number>>;
  private readonly neutral: number;

  constructor(opts: DiscreteActionAdapterOptions = {}) {
    this.neutral = opts.neutral ?? 0.5;
    this.steering = { ...(opts.steering ?? DEFAULT_STEERING_BUCKETS) };
    this.throttle = { ...(opts.throttle ?? defaultThrottleBuckets(this.neutral)) };
    if (Object.keys(this.steering).length === 0 || Object.keys(this.throttle).length === 0) {
      throw new Error('DiscreteActionAdapter needs at least one steering and one throttle bucket');
    }
  }

  /** Throws a descriptive error for an unknown choice. */
  toInput(action: DiscreteAction): CarInput {
    const s = lookup(this.steering, action.steering_choice, 'steering_choice');
    const a = lookup(this.throttle, action.throttle_choice, 'throttle_choice');
    return { accelerator: a, steering: s };
  }

  /** The nearest buckets to `input`, for logging and training data. */
  fromInput(input: CarInput): DiscreteAction {
    return {
      steering_choice: nearest(this.steering, input.steering, 0),
      throttle_choice: nearest(this.throttle, input.accelerator, this.neutral),
    };
  }
}

function lookup(buckets: Readonly<Record<string, number>>, choice: unknown, field: string): number {
  if (typeof choice === 'string' && Object.prototype.hasOwnProperty.call(buckets, choice)) {
    return buckets[choice] as number;
  }
  throw new Error(
    `Unknown ${field} ${JSON.stringify(choice)}; expected one of: ${Object.keys(buckets).join(', ')}`,
  );
}
