import type { ControllerKind, GameConfig } from '../core/config';
import { RayFollowerBot } from './bots/RayFollowerBot';
import { KeyboardController, type KeySource } from './KeyboardController';
import { RemoteController, type FetchFn } from './RemoteController';
import type { CarController } from './types';

export interface ControllerDeps {
  config: Pick<GameConfig, 'keyboard' | 'car'> & Partial<Pick<GameConfig, 'remote'>>;
  /** Key source for the keyboard controller (default: window events). */
  keys?: KeySource;
  /** `fetch` for the remote controller (default: the global one). */
  fetch?: FetchFn;
}

/** Builds the controller for `kind`. Unknown kinds and a remote without a URL fall back to keyboard. */
export function createController(
  kind: ControllerKind | string,
  deps: ControllerDeps,
): CarController {
  if (kind === 'bot') return new RayFollowerBot({ neutral: deps.config.car.neutral });
  if (kind === 'remote') {
    const remote = deps.config.remote;
    if (remote?.url) {
      return new RemoteController({
        url: remote.url,
        timeoutMs: remote.timeoutMs,
        fetch: deps.fetch,
        neutral: deps.config.car.neutral,
      });
    }
    console.warn(
      'Controller "remote" needs ?url=http(s)://... (a valid http or https URL); falling back to keyboard.',
    );
  } else if (kind !== 'keyboard') {
    console.warn(`Controller "${kind}" is not available; falling back to keyboard.`);
  }
  return new KeyboardController(deps.config.keyboard, deps.config.car.neutral, deps.keys);
}
