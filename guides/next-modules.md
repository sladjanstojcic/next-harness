## Architecture and why

The layout is closed: these are the only folders code may sit in, so there is one answer to "where does this go?".
Without it every helper folder becomes a second architecture beside the first.

```text
src/
  app/                  routes and Next special files only; each page.tsx thin
  modules/<module>/     one feature
    index.ts            client-safe public entry: types, schemas, client components
    server.ts           server-only public entry: queries, server components
    schemas.ts          Zod schemas
    types.ts            the module's types
    actions/            flat: <name>-action.ts, one public Server Action file each
    components/         feature UI; one optional area subfolder
    server/             queries and I/O; one optional area subfolder
    domain/             pure rules, a test beside each file; one optional area subfolder
  backend/              optional and flat: the backend client and its generated types
  shared/
    ui/                 generated shadcn primitives
    components/         composed shared UI; one optional area subfolder
    lib/                cross-cutting helpers; flat
    hooks/              generic React hooks; flat
  proxy.ts, instrumentation.ts, instrumentation-client.ts
e2e/                    Playwright browser tests
public/                 static files
```

- Another module or a route imports a module only through `index.ts`, `server.ts` or `actions/<name>-action.ts`. List
  exports by name; never use `export *`.
- `index.ts` must not import server code or actions. `server.ts` imports `server-only`. A client component cannot
  import `server.ts` or a module's `server/` files.
- Import a Server Action directly from its `"use server"` file, never through `index.ts`: Next pulls a client
  component's imports into its client bundle, while a `"use server"` file exposes callable actions across that
  boundary.
- `shared/` never imports a module. Modules import each other without cycles. `domain/` has no React and no I/O.
- `src/backend/` is imported from a module's `server/`; `shared/` and `domain/` do not import it, and it imports only
  `src/shared/lib/`.
- Area subfolders are named after their area (`server/documents/`, `domain/pricing/`). `utils`, `helpers`, `common`,
  `misc`, `shared`, `lib`, `core`, `base`, `stuff`, `other` and `general` are denied as area names. To go deeper,
  split a new module.
- Names are kebab-case in `src/`, `tooling/`, `scripts/` and `e2e/`. Route segments (`[id]`, `(group)`, `@slot`)
  belong only in `src/app/`.
- Vendored, exempt from size limits, and denied to direct edits: `src/shared/ui/`, `src/shared/lib/utils.ts` and the
  generated types in `src/backend/` (`*.types.ts`, `*-types.ts`). Regenerate them through their CLI.
- Before writing Next.js code, read the relevant version-matched guide in `node_modules/next/dist/docs/`; APIs and
  conventions may differ from remembered versions. Read the installed guides on server and client components and on
  updating data before changing the module boundaries.

## Where code goes

- Need a route → put it in `src/app/`, composing module public APIs. A `page.tsx` past 60 lines moves its UI into
  `src/modules/<module>/components/`. Other non-route code stays out of `src/app/`.
- Need feature UI → put it in `src/modules/<module>/components/`. `"use client"` belongs there, in shared
  `components/`, `ui/` or `hooks/`, or in an app `error.tsx` or `global-error.tsx`.
- Need a pure business rule → put it in the module's `domain/`, with `<name>.test.ts` beside it.
- Need a query or I/O → put it in the module's `server/`, with `import "server-only"`, and expose it through
  `server.ts`.
- Need a database or backend client → put it in `src/backend/`: flat `.ts` files, the client and the types the
  backend's CLI generates. An import of a backend package such as `pg` or `@supabase/supabase-js` anywhere else is
  `backend-package`, unless it is `import type`.
- Need a mutation callable from a client → put it in `actions/<name>-action.ts`, with `"use server"` as its first
  statement, and build it with `defineAction` from `src/shared/lib/define-action.ts`.
- Need a cross-cutting helper → reuse or add it in `src/shared/lib/`.
- Need environment values → read and validate them in `src/shared/lib/env.ts` with Zod, import its typed `env`
  elsewhere, and declare the names in `.env.example`.
- Need user-facing errors → use `UserError` from `src/shared/lib/user-error.ts`; keep raw error details in
  `src/shared/lib/log.ts`, the one file where console output is allowed.
- Need formatting → reuse `src/shared/lib/format.ts`.
- Need a generic hook or a composed component → use `src/shared/hooks/` or `src/shared/components/`.
- Need a form control, table or dialog → use the shadcn component in `src/shared/ui/`, and customise it in
  `src/shared/components/`.
- Need a shadcn component that is missing → add it with `pnpm dlx shadcn add <name>`.
- With `components.json`, lint reports a raw `button`, `input`, `select`, `textarea`, `label`, `table` or `dialog`
  outside `src/shared/ui/`.
- Need a browser test → put it in `e2e/`. Need automation → put it in `scripts/`.
