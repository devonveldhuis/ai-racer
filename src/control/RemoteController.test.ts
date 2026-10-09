import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteController, RemoteError, type FetchFn } from './RemoteController';
import { isObservation } from './types';
import { blankObservation } from './testObservation';

const obs = blankObservation(1.5);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
}

function make(fetchFn: FetchFn, timeoutMs?: number) {
  return new RemoteController({ url: 'http://localhost:8787/', fetch: fetchFn, timeoutMs });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RemoteController', () => {
  it('POSTs the observation as JSON and reads { accelerator, steering }', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => jsonResponse({ accelerator: 0.8, steering: -0.2 }));
    const input = await make(fetchFn).decide(obs);
    expect(input).toEqual({ accelerator: 0.8, steering: -0.2 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const sent = JSON.parse(init.body as string);
    expect(Object.keys(sent)).toEqual(['observation']);
    expect(isObservation(sent.observation)).toBe(true);
    expect(sent.observation).toEqual(obs);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads { steering_choice, throttle_choice } through the adapter', async () => {
    const c = make(async () =>
      jsonResponse({ steering_choice: 'hard_right', throttle_choice: 'half' }),
    );
    expect(await c.decide(obs)).toEqual({ accelerator: 0.75, steering: 1 });
  });

  const failures: Array<[string, string, () => Promise<Response>]> = [
    [
      'http',
      'HTTP 500',
      async () => jsonResponse({ accelerator: 1, steering: 0 }, { status: 500 }),
    ],
    ['http', 'HTTP 404', async () => jsonResponse('nope', { status: 404 })],
    ['invalid_json', '', async () => jsonResponse('{not json')],
    ['invalid_response', 'not a JSON object', async () => jsonResponse([1, 2])],
    ['invalid_response', 'not a JSON object', async () => jsonResponse('null')],
    [
      'invalid_response',
      'finite numbers',
      async () => jsonResponse({ accelerator: '1', steering: 0 }),
    ],
    ['invalid_response', 'finite numbers', async () => jsonResponse({ accelerator: 1 })],
    [
      'invalid_response',
      'finite numbers',
      async () => jsonResponse({ accelerator: null, steering: 0 }),
    ],
    ['invalid_response', 'expected', async () => jsonResponse({ hello: 'world' })],
    [
      'invalid_response',
      'Unknown steering_choice',
      async () => jsonResponse({ steering_choice: 'up', throttle_choice: 'full' }),
    ],
    ['invalid_response', 'throttle_choice', async () => jsonResponse({ steering_choice: 'left' })],
    [
      'network',
      'connection refused',
      async () => Promise.reject(new TypeError('connection refused')),
    ],
  ];
  for (const [kind, text, respond] of failures) {
    it(`rejects with ${kind}: ${text || 'bad body'}`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const err = await make(respond)
        .decide(obs)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(RemoteError);
      expect((err as RemoteError).kind).toBe(kind);
      expect((err as RemoteError).message).toContain(text);
    });
  }

  it('times out and aborts the request', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const c = make(
      (_url, init) =>
        new Promise<Response>(() => {
          signal = init?.signal ?? undefined;
        }),
      500,
    );
    const p = c.decide(obs).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const err = (await p) as RemoteError;
    expect(err).toBeInstanceOf(RemoteError);
    expect(err.kind).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('times out even when fetch ignores the abort signal and answers late', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = make(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(jsonResponse({ accelerator: 1, steering: 0 })), 5000),
        ),
      1000,
    );
    const p = c.decide(obs).then(
      () => 'ok',
      (e: RemoteError) => e.kind,
    );
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBe('timeout');
    await vi.advanceTimersByTimeAsync(5000); // the late answer causes no unhandled rejection
  });

  it('defaults the timeout to 2000 ms', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new RemoteController({ url: 'http://x/', fetch: () => new Promise(() => {}) });
    const p = c.decide(obs).then(
      () => 'ok',
      (e: RemoteError) => e.kind,
    );
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBe('timeout');
  });

  it('warns once per error kind, not once per decision', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let mode: 'http' | 'json' = 'http';
    const c = make(async () =>
      mode === 'http' ? jsonResponse('x', { status: 503 }) : jsonResponse('{bad'),
    );
    for (let i = 0; i < 5; i++) await c.decide(obs).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    mode = 'json';
    for (let i = 0; i < 5; i++) await c.decide(obs).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(2);
    mode = 'http';
    await c.decide(obs).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('still succeeds after failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const c = make(async () =>
      n++ === 0 ? jsonResponse('', { status: 500 }) : jsonResponse({ accelerator: 1, steering: 1 }),
    );
    await expect(c.decide(obs)).rejects.toBeInstanceOf(RemoteError);
    await expect(c.decide(obs)).resolves.toEqual({ accelerator: 1, steering: 1 });
  });
});
