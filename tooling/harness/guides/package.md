## Architecture and why

A package is one module of the app, moved out to be shared, so it keeps a module's closed layout. Denials end with
"(package layout)".

```text
package.json, tsconfig.json, README.md
src/
  index.ts              client-safe public entry, named exports only
  server.ts             server-only public entry
  schemas.ts, types.ts
  components/           UI; one optional area subfolder
  server/               queries and I/O, with "server-only"; one optional area subfolder
  domain/               pure .ts rules, a test beside each file; one optional area subfolder
  hooks/                flat, use-<name>.ts(x)
  lib/                  flat helpers
```

- The top level takes configuration only (`package.json`, `tsconfig.json`, tool configs, `.json` and `.md` files) and
  no folder but `src/`. No JavaScript but the tool configs that cannot be TypeScript.
- A package holds no `actions/`, no `"use server"` and no `process.env`.
- A relative import stays inside `src/`; import another package by its name (`package-boundary`).
- `src/index.ts` never reaches server code, `src/server/` is reached only through `src/server.ts`, and `domain/` stays
  pure. No cycles. An export of `src/index.ts` or `src/server.ts` that no workspace imports is reported.
- Area subfolders are named after their area; generic names such as `utils` or `helpers` are denied.

## Where code goes

- Need a Server Action → put it in the app's module, `modules/<module>/actions/<name>-action.ts`, calling this
  package's `server.ts`.
- Need environment values → read them in the app's `shared/lib/env.ts` and pass the value in.
- Need a query, I/O or a backend package such as `pg` → put it in `src/server/`, the one place a backend package may
  be imported, and expose it through `src/server.ts`.
- Need UI → put it in `src/components/`; `"use client"` belongs there or in `src/hooks/`. Client files take server
  data as props from the app.
- Need a pure rule → put it in `src/domain/` as `.ts`, with `<name>.test.ts` beside it.
- Need an error → throw a typed error and let the app turn it into user-facing text.
- Need more depth → split a second package.
