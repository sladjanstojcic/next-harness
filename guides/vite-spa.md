## Architecture and why

The app runs wholly in the browser and has no server of its own. The layout is closed: these are the only folders code
may sit in, so there is one answer to "where does this go?". Denials end with "(Vite layout)".

```text
index.html, vite.config.ts, components.json, tsconfig.json, .env.example
public/                 static files
e2e/                    browser tests
src/
  main.tsx, *.d.ts, *.css   the entry mounts the router
  assets/               images, fonts and CSS; no code
  app/
    router.tsx          the whole route tree (createBrowserRouter)
    page.tsx, layout.tsx, error.tsx, not-found.tsx
    <segment>/, [param]/, (group)/   one folder per route: those four files and nested routes
  modules/<module>/
    index.ts, types.ts, schemas.ts
    components/         feature UI; one optional area subfolder
    domain/             pure .ts, a test beside each file; one optional area subfolder
    data/               calls to the backend; .ts, one optional area subfolder
    hooks/              flat, use-<name>.ts(x)
  backend/              optional and flat .ts: the backend client and its generated types
  shared/
    ui/                 generated shadcn primitives
    components/         composed shared UI; one optional area subfolder
    lib/                cross-cutting helpers; flat
    hooks/              generic React hooks; flat
```

- A module has one public entry, `index.ts`, which may export data functions. It has no `server.ts`, `server/` or
  `actions/`: the app has no server, so calls to the backend go in the module's `data/`.
- `src/backend/` is imported only from a module's `data/`, and with `import type` in a module and in `src/app/`. It
  imports no module, route or React.
- `src/shared/` imports no module, route or backend. `domain/` imports no React, and from the backend only its types.
  A module is used from outside only through its `index.ts`. No Node built-in under `src/`, and no cycles.
- Area subfolders are named after their area (`domain/pricing/`, `data/drafts/`). `utils`, `helpers`, `common`,
  `misc`, `shared`, `lib`, `core`, `base`, `stuff`, `other` and `general` are denied as area names. To go deeper,
  split a new module.
- Names are kebab-case in `src/`, `e2e/`, `tooling/` and `scripts/`; files in `src/assets/` keep the names they ship
  with. `[param]` and `(group)` folders belong only in `src/app/`; Next's `@slot` and intercepting folders do not
  exist here.
- Vendored, exempt from size limits, and denied to direct edits: `src/shared/ui/`, `src/shared/lib/utils.ts` and the
  generated types in `src/backend/` (`*.types.ts`, `*-types.ts`). Regenerate them through their CLI.
- `vite.config.ts` and every `tsconfig*.json` are locked with the harness; `index.html` stays open.

## Where code goes

- Need a route → add it to `src/app/router.tsx` and give it a folder in `src/app/` with `page.tsx`. A page past 60
  lines moves its UI into `src/modules/<module>/components/`, imported through `index.ts`.
- Need feature UI → put it in `src/modules/<module>/components/`. `"use client"`, `"use server"` and `server-only`
  belong to Next and are reported here.
- Need a pure business rule → put it in the module's `domain/` as `.ts`, with `<name>.test.ts` beside it.
- Need a call to the backend → put it in the module's `data/` as `.ts`, using the client from `src/backend/`, and
  export it from the module's `index.ts`.
- Need a database or backend client → put it in `src/backend/`: flat `.ts` files, the client and the types the
  backend's CLI generates. An import of a backend package such as `pocketbase` or `@supabase/supabase-js` anywhere
  else is `backend-package`, unless it is `import type`.
- Need a hook for one module → put it in the module's `hooks/` as `use-<name>.ts(x)`. A generic hook goes in
  `src/shared/hooks/`.
- Need a cross-cutting helper or a composed component → put it in `src/shared/lib/` or `src/shared/components/`.
- Need environment values → read `import.meta.env` only in `src/shared/lib/env.ts`, validate it with Zod there, and
  import its typed `env` elsewhere (`env-access`). Declare the names in `.env.example`. `process.env` under `src/` is
  reported. Every `VITE_*` value is public in the built bundle: a service key never gets that prefix.
- Need logging → console output belongs in `src/shared/lib/log.ts`. Show the user a message written for them, and keep
  raw error details in that file.
- Need a form control, table or dialog → use the shadcn component in `src/shared/ui/`, or add it with `pnpm dlx shadcn
add <name>`, and customise it in `src/shared/components/`. With `components.json`, lint reports a raw `button`,
  `input`, `select`, `textarea`, `label`, `table` or `dialog` elsewhere.
- Need images, fonts or CSS → put them in `src/assets/`, or in `public/` when served as they are.
- Need a browser test → put it in `e2e/`. Need automation → put it in `scripts/`.
