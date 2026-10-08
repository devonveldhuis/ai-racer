# 001 – Project scaffold

Status: ready

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
