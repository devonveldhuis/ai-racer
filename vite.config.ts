import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

const MODELS_DIR = path.resolve(import.meta.dirname, 'Models');
const MOUNT = '/models/';

/**
 * Serves the read-only `Models/` folder at `/models/...` in dev and preview,
 * and emits its files into `dist/models/` on build, without moving the folder.
 */
function serveModels(): Plugin {
  const notFound = (res: ServerResponse): void => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  };

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith(MOUNT)) return next();
    // Everything under /models/ is ours: never fall through to the SPA index.html.
    let rel: string;
    try {
      rel = decodeURIComponent(url.slice(MOUNT.length));
    } catch {
      return notFound(res);
    }
    const file = path.resolve(MODELS_DIR, rel);
    let body: Buffer;
    try {
      if (!file.startsWith(MODELS_DIR + path.sep) || !fs.statSync(file).isFile()) {
        return notFound(res);
      }
      body = fs.readFileSync(file);
    } catch {
      return notFound(res);
    }
    const type = file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', body.length);
    res.end(body);
  };

  return {
    name: 'serve-models',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      for (const name of fs.readdirSync(MODELS_DIR)) {
        const file = path.join(MODELS_DIR, name);
        if (!fs.statSync(file).isFile()) continue;
        this.emitFile({ type: 'asset', fileName: `models/${name}`, source: fs.readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [serveModels()],
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
