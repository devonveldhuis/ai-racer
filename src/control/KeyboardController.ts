import type { KeyboardConfig } from '../core/config';
import type { CarController, CarInput, Observation } from './types';

/** Source of pressed keys, by normalised name (`w`, `arrowup`, ...). Injectable for tests. */
export interface KeySource {
  isDown(key: string): boolean;
  dispose(): void;
}

const THROTTLE = ['w', 'arrowup'];
const BRAKE = ['s', 'arrowdown'];
const LEFT = ['a', 'arrowleft'];
const RIGHT = ['d', 'arrowright'];

/** Tracks keydown/keyup on `target`, clears on blur, ignores repeats and modified keys. */
export class WindowKeySource implements KeySource {
  private readonly down = new Set<string>();
  private readonly target: Window;
  private readonly onDown = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    this.down.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent) => {
    this.down.delete(e.key.toLowerCase());
  };
  private readonly onBlur = () => this.down.clear();

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(key: string): boolean {
    return this.down.has(key);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.down.clear();
  }
}

function moveToward(value: number, target: number, maxDelta: number): number {
  const d = target - value;
  return Math.abs(d) <= maxDelta ? target : value + Math.sign(d) * maxDelta;
}

/**
 * W/Up throttle, S/Down brake, A/Left and D/Right steer, as smooth analogue values. The ramps
 * use the sim time between `decide()` calls (`obs.t`), so they do not depend on the frame rate.
 */
export class KeyboardController implements CarController {
  readonly name = 'keyboard';
  private readonly keys: KeySource;
  private readonly cfg: KeyboardConfig;
  private readonly neutral: number;
  private accelerator: number;
  private steering = 0;
  private lastT: number | null = null;

  constructor(cfg: KeyboardConfig, neutral: number, keys: KeySource = new WindowKeySource()) {
    this.cfg = cfg;
    this.neutral = neutral;
    this.accelerator = neutral;
    this.keys = keys;
  }

  decide(obs: Observation): CarInput {
    const dt = this.lastT === null ? 0 : Math.max(0, obs.t - this.lastT);
    this.lastT = obs.t;
    const any = (names: string[]) => names.some((k) => this.keys.isDown(k));
    const throttle = any(THROTTLE);
    const brake = any(BRAKE);
    const left = any(LEFT);
    const right = any(RIGHT);
    const c = this.cfg;

    if (throttle !== brake) {
      this.accelerator = throttle
        ? moveToward(this.accelerator, 1, c.accelRate * dt)
        : moveToward(this.accelerator, 0, c.brakeRate * dt);
    } else {
      this.accelerator = moveToward(this.accelerator, this.neutral, c.accelReturnRate * dt);
    }

    if (left !== right) {
      this.steering = moveToward(this.steering, right ? 1 : -1, c.steerRate * dt);
    } else {
      this.steering = moveToward(this.steering, 0, c.steerReturnRate * dt);
    }
    return { accelerator: this.accelerator, steering: this.steering };
  }

  reset(): void {
    this.accelerator = this.neutral;
    this.steering = 0;
    this.lastT = null;
  }

  dispose(): void {
    this.keys.dispose();
  }
}
