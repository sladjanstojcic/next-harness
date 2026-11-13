## Architecture and why

A Makerkit feature package under `packages/features/`. The kit's own files are not judged; every file you add follows
this closed layout. Denials end with "(Makerkit layout)".

```text
package.json, tsconfig.json, README.md, vitest.config.ts
src/
  types.ts, shared.ts
  components/           React components; up to two area subfolders
  hooks/                flat, use-<name>.ts(x)
  schema/<name>.schema.ts   Zod schemas; flat
  server/
    api.ts, <name>-server-actions.ts, <name>.service.ts   the files directly in server/
    actions/<name>-server-actions.ts   Server Actions; flat
    services/<name>.service.ts   one optional area subfolder
    policies/, orchestration/   flat TypeScript
  shared/               client-safe TypeScript without React, a test beside each file; one optional area subfolder
```

- The package is used through its `package.json` exports (`@kit/<name>/<export>`), not an index file; a relative
  import out of the package is denied.
- A client component may not import `src/server/` code other than the Server Action files.
- Area subfolders are named after their area (`members/`, `invitations/`); generic names such as `utils` are denied.
  Tests sit beside their source; a `__tests__/` folder is denied. Lint-disable and `@ts-` comments are reported.

## Where code goes

- Need a Server Action → put it in `src/server/actions/<name>-server-actions.ts`, with `"use server"` first, and build
  each action with `authActionClient`, `publicActionClient`, `captchaActionClient` or `adminActionClient`.
- Need server logic → put it in `src/server/services/`, `policies/` or `orchestration/`, with `import "server-only"`.
- Need UI → put it in `src/components/`; `"use client"` belongs there or in `src/hooks/`.
- Need a Zod schema → put it in `src/schema/<name>.schema.ts`. Need client-safe logic → put it in `src/shared/`.
- Need environment values → read them in the app's `config/<name>.config.ts` and pass typed values in.
  `NEXT_PUBLIC_*` reads stay allowed in the package.
- Need an error the user sees → log the driver error and throw an i18n key instead of raw error text.
- Need a route → it belongs in the app's `app/`. Need more depth → split the feature into a second package.
