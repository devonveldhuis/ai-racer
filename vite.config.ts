import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

const MODELS_DIR = path.resolve(import.meta.dirname, 'Models');
const MOUNT = '/models/';

/**
 * Serves the read-only `Models/` folder at `/models/...` in dev and preview,
 * and emits its files into `dist/models/` on build, without moving the folder.
 */
function serveModels(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith(MOUNT)) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(url.slice(MOUNT.length));
    } catch {
      return next();
    }
    const file = path.resolve(MODELS_DIR, rel);
    if (
      !file.startsWith(MODELS_DIR + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      return next();
    }
    const type = file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
    const body = fs.readFileSync(file);
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
