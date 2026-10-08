# AI Racer

Browser racing game built for AI drivers (TypeScript, Vite, three.js, Rapier). See `PLAN.md` for the design and `AGENTS.md` for the development workflow.

## Setup

Requires Node 20+ (developed on Node 22).

```sh
npm install
npm run dev        # dev server at http://localhost:5173
```

URL overrides: `?seed=1234&controller=keyboard&debug=1`.

## Scripts

| Command             | What it does                     |
| ------------------- | -------------------------------- |
| `npm run dev`       | Vite dev server                  |
| `npm run build`     | Typecheck, then production build |
| `npm run preview`   | Serve the production build       |
| `npm test`          | Vitest unit tests                |
| `npm run lint`      | ESLint                           |
| `npm run format`    | Prettier (write)                 |
| `npm run typecheck` | `tsc --noEmit`                   |

## Models

`Models/*.glb` is served read-only at `/models/<name>.glb` (dev, preview and build) by a small plugin in `vite.config.ts`; the folder is never moved or modified.
