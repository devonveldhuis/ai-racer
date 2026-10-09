/**
 * A tiny local AI server for the remote controller protocol (docs/AI_API.md).
 *
 *   npm run mock-ai -- [--port 8787] [--latency <ms>] [--choices]
 *
 * POST a JSON body `{ "observation": <Observation> }` to any path and get an action back,
 * decided by the same `rayFollowerDecide` as the in-browser bot. Stateless. With `--choices`
 * the answer is `{ steering_choice, throttle_choice }` (via `DiscreteActionAdapter.fromInput`),
 * otherwise `{ accelerator, steering }`. Bad bodies get a 400. It listens on localhost only
 * and answers CORS requests from localhost origins (the Vite dev server).
 *
 * Run by Node 22's built-in TypeScript type stripping, so the shared modules are imported
 * with explicit `.ts` extensions and have only type imports of their own.
 */
import http from 'node:http';
import { parseArgs } from 'node:util';
import {
  DEFAULT_RAY_FOLLOWER_PARAMS,
  INITIAL_RAY_FOLLOWER_STATE,
  rayFollowerDecide,
} from '../src/control/bots/RayFollowerBot.ts';
import { DiscreteActionAdapter } from '../src/control/DiscreteActionAdapter.ts';
import { isObservation } from '../src/control/types.ts';

export interface MockServerOptions {
  port: number;
  /** Artificial delay before every answer (ms). */
  latencyMs: number;
  /** Answer with named choices instead of numbers. */
  choices: boolean;
}

const MAX_BODY_BYTES = 1_000_000;
/** Stateless: no steering smoothing across requests. */
const PARAMS = { ...DEFAULT_RAY_FOLLOWER_PARAMS, smoothing: 0 };
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHandler(opts: Pick<MockServerOptions, 'latencyMs' | 'choices'>) {
  const adapter = new DiscreteActionAdapter();
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && LOCAL_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      send(405, { error: 'POST { "observation": ... } to this URL' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (e) {
      send(400, { error: `invalid JSON body: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const observation = (parsed as { observation?: unknown } | null)?.observation;
    if (!isObservation(observation)) {
      send(400, { error: 'body must be { "observation": <Observation> }' });
      return;
    }
    const { input } = rayFollowerDecide(observation, INITIAL_RAY_FOLLOWER_STATE, PARAMS);
    const answer = opts.choices ? adapter.fromInput(input) : input;
    if (opts.latencyMs > 0) await new Promise((r) => setTimeout(r, opts.latencyMs));
    send(200, answer);
  };
}

export interface RunningMockServer {
  /** The port actually bound (useful with port 0). */
  port: number;
  close(): Promise<void>;
}

/** Starts the server on 127.0.0.1 and (when available) ::1. */
export async function startMockServer(opts: MockServerOptions): Promise<RunningMockServer> {
  const handler = createHandler(opts);
  const servers: http.Server[] = [];
  let port = opts.port;
  for (const host of ['127.0.0.1', '::1']) {
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
      servers.push(server);
      port = (server.address() as { port: number }).port;
    } catch (e) {
      // IPv6 may be unavailable; IPv4 is required.
      if (host === '127.0.0.1') throw e;
    }
  }
  return {
    port,
    close: async () => {
      await Promise.all(
        servers.map((s) => {
          s.closeAllConnections();
          return new Promise<void>((resolve) => s.close(() => resolve()));
        }),
      );
    },
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8787' },
      latency: { type: 'string', default: '0' },
      choices: { type: 'boolean', default: false },
    },
  });
  const port = Number(values.port);
  const latencyMs = Number(values.latency);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !(latencyMs >= 0)) {
    console.error('Usage: npm run mock-ai -- [--port <0-65535>] [--latency <ms>] [--choices]');
    process.exit(2);
  }
  startMockServer({ port, latencyMs, choices: Boolean(values.choices) }).then(
    () => {
      console.log(
        `mock AI server on http://localhost:${port}  latency ${latencyMs} ms  ${values.choices ? 'discrete choices' : 'continuous'}`,
      );
    },
    (e: unknown) => {
      console.error(`Could not start the server: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
