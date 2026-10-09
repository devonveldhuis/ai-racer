import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankObservation } from '../src/control/testObservation';
import { startMockServer, type RunningMockServer } from './mock-ai-server';

const obs = blankObservation(3);
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

let plain: RunningMockServer;
let choices: RunningMockServer;
let slow: RunningMockServer;
beforeAll(async () => {
  plain = await startMockServer({ port: 0, latencyMs: 0, choices: false });
  choices = await startMockServer({ port: 0, latencyMs: 0, choices: true });
  slow = await startMockServer({ port: 0, latencyMs: 150, choices: false });
});
afterAll(async () => {
  await Promise.all([plain.close(), choices.close(), slow.close()]);
});

const url = (s: RunningMockServer) => `http://127.0.0.1:${s.port}/`;

describe('mock AI server', () => {
  it('answers a valid observation with numbers', async () => {
    const res = await post(url(plain), { observation: obs });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { accelerator: number; steering: number };
    expect(typeof body.accelerator).toBe('number');
    expect(typeof body.steering).toBe('number');
  });

  it('answers with named choices under --choices', async () => {
    const body = (await (await post(url(choices), { observation: obs })).json()) as Record<
      string,
      string
    >;
    expect(Object.keys(body).sort()).toEqual(['steering_choice', 'throttle_choice']);
    expect(body.steering_choice).toBe('straight');
  });

  it('returns 400 for bad bodies', async () => {
    for (const bad of ['not json', '{}', { observation: { t: 1 } }, { obs }, 'null', '[]']) {
      const res = await post(url(plain), bad);
      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string');
    }
  });

  it('rejects other methods', async () => {
    expect((await fetch(url(plain))).status).toBe(405);
  });

  it('answers the CORS preflight for local origins only', async () => {
    const pre = (origin: string) =>
      fetch(url(plain), {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
    const ok = await pre('http://localhost:5173');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Content-Type');
    const no = await pre('https://evil.example');
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
    // Actual responses carry the header too.
    const res = await post(url(plain), { observation: obs }, { Origin: 'http://localhost:5173' });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('delays its answers by --latency', async () => {
    const t0 = performance.now();
    await post(url(slow), { observation: obs });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
  });
});
