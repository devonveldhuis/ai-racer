import type { ControllerKind, GameConfig } from '../core/config';
import { KeyboardController, type KeySource } from './KeyboardController';
import type { CarController } from './types';

export interface ControllerDeps {
  config: Pick<GameConfig, 'keyboard' | 'car'>;
  /** Key source for the keyboard controller (default: window events). */
  keys?: KeySource;
}

/** Builds the controller for `kind`. Unknown or unimplemented kinds fall back to keyboard. */
export function createController(
  kind: ControllerKind | string,
  deps: ControllerDeps,
): CarController {
  if (kind !== 'keyboard') {
    console.warn(`Controller "${kind}" is not available; falling back to keyboard.`);
  }
  return new KeyboardController(deps.config.keyboard, deps.config.car.neutral, deps.keys);
}
