/**
 * A generic remote driver: POSTs `{ "observation": <Observation> }` as JSON to a URL and reads
 * the action from the JSON response. Any failure (network error, timeout, non-2xx status,
 * invalid body) rejects, so the `ControllerHost` keeps the last input and counts an error.
 * See docs/AI_API.md for the protocol.
 */
import { DiscreteActionAdapter } from './DiscreteActionAdapter';
import type { CarController, CarInput, Observation } from './types';

export const DEFAULT_REMOTE_TIMEOUT_MS = 2000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type RemoteErrorKind = 'timeout' | 'network' | 'http' | 'invalid_json' | 'invalid_response';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;
  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

export interface RemoteControllerOptions {
  url: string;
  /** Request timeout in milliseconds. Default 2000. */
  timeoutMs?: number;
  /** Default: the global `fetch`. */
  fetch?: FetchFn;
  adapter?: DiscreteActionAdapter;
  /** Coast value for the default discrete throttle buckets (`car.neutral`). Default 0.5. */
  neutral?: number;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export class RemoteController implements CarController {
  readonly name = 'remote';
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly adapter: DiscreteActionAdapter;
  private readonly warned = new Set<RemoteErrorKind>();

  constructor(opts: RemoteControllerOptions) {
    this.url = opts.url;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.adapter = opts.adapter ?? new DiscreteActionAdapter({ neutral: opts.neutral });
  }

  decide(obs: Observation): Promise<CarInput> {
    return this.request(obs).catch((e: unknown) => {
      const err = e instanceof RemoteError ? e : new RemoteError('network', errorText(e));
      this.warnOnce(err);
      throw err;
    });
  }

  private async request(obs: Observation): Promise<CarInput> {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The timeout also races the request, in case a `fetch` ignores the abort signal.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new RemoteError('timeout', `no response within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    const call = async (): Promise<unknown> => {
      let res: Response;
      try {
        res = await this.fetchFn(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ observation: obs }),
          signal: ac.signal,
        });
      } catch (e) {
        throw new RemoteError('network', errorText(e));
      }
      if (!res.ok) throw new RemoteError('http', `HTTP ${res.status}`);
      try {
        return await res.json();
      } catch (e) {
        throw new RemoteError('invalid_json', errorText(e));
      }
    };
    const pending = call();
    // If the timeout wins, the late result of `call()` must not become an unhandled rejection.
    pending.catch(() => undefined);
    try {
      const body = await Promise.race([pending, timeout]);
      return this.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(body: unknown): CarInput {
    if (!isObj(body)) throw new RemoteError('invalid_response', 'response is not a JSON object');
    if ('accelerator' in body || 'steering' in body) {
      if (!isNum(body.accelerator) || !isNum(body.steering)) {
        throw new RemoteError(
          'invalid_response',
          '"accelerator" and "steering" must both be finite numbers',
        );
      }
      return { accelerator: body.accelerator, steering: body.steering };
    }
    if ('steering_choice' in body || 'throttle_choice' in body) {
      try {
        return this.adapter.toInput({
          steering_choice: body.steering_choice as string,
          throttle_choice: body.throttle_choice as string,
        });
      } catch (e) {
        throw new RemoteError('invalid_response', errorText(e));
      }
    }
    throw new RemoteError(
      'invalid_response',
      'expected { accelerator, steering } or { steering_choice, throttle_choice }',
    );
  }

  private warnOnce(err: RemoteError): void {
    if (this.warned.has(err.kind)) return;
    this.warned.add(err.kind);
    console.warn(`Remote controller (${this.url}): ${err.kind}: ${err.message}`);
  }
}

/** The error's message, with its cause (Node's `fetch failed` hides the reason there). */
function errorText(e: unknown): string {
  if (typeof e !== 'object' || e === null) return String(e);
  const { message, cause } = e as { message?: unknown; cause?: { message?: unknown } };
  const detail = typeof cause?.message === 'string' ? ` (${cause.message})` : '';
  return `${typeof message === 'string' ? message : String(e)}${detail}`;
}
