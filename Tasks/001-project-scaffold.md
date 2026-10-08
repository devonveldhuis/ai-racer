# 001 – Project scaffold

Status: done

## Goal
Set up the TypeScript/Vite browser project so later tasks have a working dev server, build, tests and lint. See `PLAN.md` → Tech stack.

## Requirements
- `package.json` with scripts: `dev`, `build`, `preview`, `test` (Vitest), `lint` (ESLint), `format` (Prettier), `typecheck` (`tsc --noEmit`).
- TypeScript `strict: true`. ES modules.
- Dependencies: `three`, `@types/three`, `@dimforge/rapier3d-compat`. Dev: `vite`, `typescript`, `vitest`, `eslint` (+ typescript-eslint), `prettier`.
- `index.html` with a full-window canvas and a `#ui` overlay root for HTML HUD elements.
- `src/main.ts` that: initialises Rapier (`await RAPIER.init()`), creates a three.js renderer/scene/camera, a ground plane, a light, and a falling Rapier box rendered as a cube. This proves both libraries work together.
- `src/core/loop.ts`: fixed-timestep game loop (60 Hz physics, accumulator pattern, max substeps to avoid the spiral of death) with `update(dt)` and `render(alpha)` callbacks.
- `src/core/rng.ts`: seeded PRNG (e.g. mulberry32) with `next()`, `range(a,b)`, `int(a,b)`, `pick(arr)`. Unit-test determinism.
- `src/core/config.ts`: typed `GameConfig` object with defaults, plus `parseUrlOverrides()` that reads query params (`seed`, `controller`, `debug`) into it. Unit-tested.
- The existing `Models/` folder must be served to the browser at `/models/...` **without moving or modifying it** (e.g. Vite `publicDir` pointed elsewhere and a small alias/static-copy plugin, or `server.fs.allow` + an import-glob, worker's choice).
- `.gitignore` (node_modules, dist, coverage, .env*).
- A short `README.md`: how to install, run, test.

## Acceptance criteria
- [ ] `npm install && npm run dev` opens a page showing a cube falling onto a plane under Rapier physics.
- [ ] `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` all pass.
- [ ] Fetching `/models/roadStraight.glb` from the dev server and the production build returns the file.
- [ ] RNG and config override tests exist and pass.

## Out of scope
Game logic, track loading, cars. Don't create git commits (coordinator does that).

## Implementation Notes

Built the Vite + TypeScript (strict) scaffold. `npm run dev` shows a red cube (Rapier dynamic body, interpolated via the fixed-step loop) falling onto a ground plane; verified with headless Chromium (canvas and `#ui` present, cube moves between screenshots, no console errors on dev or preview, only SwiftShader GPU-stall warnings).

Results: `npm run build`, `npm test` (17 tests, 3 files), `npm run lint`, `npm run typecheck` all pass. `/models/roadStraight.glb` returns 200 (`model/gltf-binary`) from both `npm run dev` and `npm run preview`, byte-identical to `Models/roadStraight.glb` (checked with `cmp`).

Files touched (all new): `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `index.html`, `README.md`, `src/main.ts`, `src/core/loop.ts`, `src/core/loop.test.ts`, `src/core/rng.ts`, `src/core/rng.test.ts`, `src/core/config.ts`, `src/core/config.test.ts`. `Models/`, other tasks, AGENTS.md and PLAN.md untouched; no commits.

Design notes: `Models/` is served by an in-repo Vite plugin (`serveModels`): dev middleware for `/models/*` (path-traversal guarded) and `generateBundle` emitting the files to `dist/models/` so `preview` serves them; `publicDir` is disabled. `Rng` is a class (`new Rng(seed)`, plus `createRng`). `GameLoop.advance(elapsed)` is separated from the rAF driver so it is unit-testable.

### Deviations

- Added dev deps beyond the list: `@types/node` (for `vite.config.ts`), `@eslint/js` and `globals` (ESLint flat config).
- `npm run build` runs `tsc --noEmit && vite build` (Vite alone does not typecheck).
- `GameConfig` also includes `physicsHz` and `maxSubSteps` beyond `seed`/`controller`/`debug`; `controller` is typed `'keyboard' | 'bot' | 'remote'` (placeholder set). Invalid query values are ignored (defaults kept).
- `tsconfig` adds `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (stricter than required).
- `build.chunkSizeWarningLimit` raised to 6000 kB because Rapier's inlined WASM makes the bundle about 4.8 MB.
- Latest majors were installed (three 0.186, vite 8, vitest 5, eslint 10, typescript 6).

### Known limitations

- Rapier WASM is inlined in the JS bundle (compat build); no code splitting yet.
- Unknown `/models/...` paths fall through to Vite's SPA fallback (200 with index.html) rather than 404 in dev.
- `GameLoop.start()` (rAF) is not unit-tested; only `advance()` is.
- Dev server also exposes project files such as `/package.json` (default Vite behaviour).

## Review (round 1)
Verdict: APPROVED

Verified by running: `npm run build`, `npm test` (17 passed), `npm run lint`, `npm run typecheck` and `prettier --check .` all pass. `/models/roadStraight.glb` returns 200 `model/gltf-binary` and is byte-identical to `Models/roadStraight.glb` (`cmp`) on both `npm run dev` and `npm run preview`. Headless Chromium (SwiftShader): the red cube is visible and moves between screenshots 1.5 s apart, with no page or console errors. `Models/` is untouched, no commits were made, and the scope is clean. All deviations are justified and acceptable.

Path handling in `serveModels`: the `path.resolve` plus `startsWith(MODELS_DIR + sep)` guard is sound. Encoded and raw `..` forms are rejected by the plugin and fall through via `next()`. On dev, `/models/../package.json` and `/models/%2e%2e/package.json` return `package.json`, but that is Vite's own default root file serving (the worker's noted limitation), not a flaw in the plugin. `/models/..%2fpackage.json` returns the SPA HTML. Preview never exposes project files.

Unknown or missing `/models/...` paths return 200 with the index.html SPA fallback (dev and preview) rather than 404. This is acceptable for the scaffold.

Issues (none blocking):
- Non-blocking: A missing model returns 200 text/html, so a GLTFLoader failure would show up as an obscure parse error instead of a 404. Consider making the middleware respond 404 for unmatched `/models/*` (in `configureServer`, and possibly `configurePreviewServer`). Revisit when asset loading lands.
- Non-blocking: The middleware uses sync `readFileSync` and sets no caching headers. Fine for dev.
- Non-blocking: `tsconfig.json` `include` lists a nonexistent `tools` dir. Harmless; remove it or add the dir when needed.
- Non-blocking: `serveModels` only emits top-level files from `Models/` (no subdirectories). This matches the current flat layout; note it if subfolders are ever added.
- Non-blocking: The `main.ts` resize handler and loop are never cleaned up, and `main().catch` only logs to the console. Fine for a demo scaffold.
