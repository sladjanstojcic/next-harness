## Architecture and why

The service is a long-running Node process that runs its TypeScript source directly: no UI, no build step. The layout
is closed: these are the only folders code may sit in, so there is one answer to "where does this go?". Denials end
with "(Node layout)".

```text
package.json            "type": "module", "imports": { "#/*": "./src/*" }
tsconfig.json           nodenext, noEmit, no paths; locked
Dockerfile, Dockerfile.dockerignore, .env.example
src/
  main.ts               the entry: builds the app, listens, handles signals
  worker.ts             optional second entry, such as a queue consumer
  app/
    app.ts              createApp(): middleware, error handler, one mount per module's routes
  modules/<module>/
    index.ts            the public entry
    routes.ts           the module's HTTP routes
    types.ts, schemas.ts
    domain/             pure .ts, a test beside each file; one optional area subfolder
    data/               I/O: backend and model calls, rendering, files; one optional area subfolder
  backend/              flat .ts: the backend clients, model providers and their generated types
  shared/
    lib/                cross-cutting helpers, env.ts and log.ts; flat
```

- A module has no `components/`, `hooks/`, `server/` or `actions/`: a service renders no UI, and its I/O goes in
  `data/`. No `.tsx` anywhere.
- `src/app/` holds `app.ts` and its test only. Each module mounts its own `routes.ts` in `app.ts`, one line each.
  `app.ts` and each `routes.ts` stay at most 80 lines (`thin-route`); logic moves into the module.
- `src/backend/` is imported only from a module's `data/`, and with `import type` anywhere. It imports no module and
  nothing from `src/app/`. `src/shared/` imports no module, app or backend. A module is used from outside only through
  its `index.ts`. No React, no cycles.
- No Node built-in in `src/app/`, in a module's `routes.ts`, `index.ts`, `types.ts` or `schemas.ts`, or in `domain/`.
  File, process and network work goes in `data/` or `src/backend/`; `main.ts`, `worker.ts` and `src/shared/lib/`
  may use built-ins too.
- Area subfolders are named after their area (`data/render/`). `utils`, `helpers`, `common`, `misc`, `shared`, `lib`,
  `core`, `base`, `stuff`, `other` and `general` are denied as area names.
- Names are kebab-case in `src/`, `tooling/` and `scripts/`.
- Vendored and denied to direct edits: the generated types in `src/backend/` (`*.types.ts`, `*-types.ts`).
  Regenerate them through their CLI.

## Where code goes

- Need an endpoint → add it to the module's `routes.ts`: parse the input with the module's schema, call the module,
  answer. A new module's routes get one `app.route(...)` line in `src/app/app.ts`.
- Need a pure business rule → put it in the module's `domain/` as `.ts`, with `<name>.test.ts` beside it.
- Need I/O → put it in the module's `data/`: backend queries, model calls, rendering, files.
- Need a database, backend or model client → put it in `src/backend/`, created with values from `env`. An import of a
  backend package such as `@supabase/supabase-js` anywhere else is `backend-package`, unless it is `import type`.
- Need code from another workspace → import it by its package name, never by a relative path (`package-boundary`).
- Need an import inside the service → write `#/<path>.ts` or a relative path, always with `.ts`: Node runs the source
  and resolves the path as written (`node-import`). `@/` is reported: Node applies no tsconfig paths.
- Need environment values → read `process.env` only in `src/shared/lib/env.ts`, validate it with Zod there, and import
  its typed `env` elsewhere (`env-access`). Declare the names in `.env.example`.
- Need logging → console output belongs in `src/shared/lib/log.ts`. Answer a client with a message written for it,
  and keep raw error details in that file.
- Need a test → `<name>.test.ts` beside its source, deterministic, run by the gates. A test that needs a running
  backend is `<name>.int.test.ts`: the gates leave it out, and the project runs it with a config of its own, such
  as `vitest.int.config.ts`.
- Need automation → put it in `scripts/` at the repository root.
- `tsconfig.json` and every `tsconfig*.json` are locked with the harness; the `Dockerfile` stays open.
