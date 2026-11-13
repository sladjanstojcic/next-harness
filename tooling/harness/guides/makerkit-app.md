## Architecture and why

A Makerkit app, such as `apps/web`. The kit's own files, listed in the harness's upstream list, are not judged by
these rules; every file you add is, so new code follows the kit's layout and the kit stays mergeable. The layout is
closed: there is one answer to "where does this go?". Denials end with "(Makerkit layout)".

```text
app/                    routes: Next special files, AGENTS.md and CLAUDE.md only
  <segment>/            a route folder: kebab-case, [param], [...slug] or (group)
    page.tsx, layout.tsx, loading.tsx, error.tsx
    _components/        route-local UI; one optional area subfolder
    _lib/               route-local TypeScript helpers; flat
      server/           server code and the route's server-actions.ts; flat
      schema/<name>.schema.ts   Zod schemas; flat
components/             app-wide React components; one optional area subfolder
config/<name>.config.ts   app configuration and its environment schema; one optional area subfolder
lib/                    TypeScript helpers; one optional area subfolder
  server/               server code; one optional area subfolder
i18n/                   TypeScript such as request.ts
  messages/<locale>/<namespace>.json   translations
styles/<name>.css       CSS; one optional area subfolder
content/<collection>/<name>.mdoc   Markdoc; one optional section subfolder
public/                 static files
supabase/               the database folder
```

- The only private folders in `app/` are `_components/` and `_lib/`; other code in a route folder is denied.
- A client component may not import `_lib/server/` or `lib/server/`; it calls a Server Action instead.
- A feature package is imported through its `package.json` exports (`@kit/<name>/<export>`), never by a relative path
  out of the app.
- Area subfolders are named after their area (`billing/`, `members/`). `utils`, `helpers`, `common`, `misc`, `shared`,
  `lib`, `core`, `base`, `stuff`, `other` and `general` are denied as area names. Deeper code moves into a feature
  package under `packages/features/`.
- Names are kebab-case. Tests sit beside their source as `<name>.test.ts(x)`; a `__tests__/` folder is denied.
- Lint-disable and `@ts-` comments are reported in your code: fix the code they would silence.
- The aliases are the kit's: `~/config/`, `~/components/`, `~/lib/`, and `~/` for `app/`.

## Where code goes

- Need a route → put it in a folder under `app/`. A `page.tsx` past 60 lines moves its UI into the route's
  `_components/`.
- Need UI for one route → put it in the route's `_components/`; UI used across the app goes in `components/`. `"use
client"` belongs there, or in an app `error.tsx` or `global-error.tsx`.
- Need a Server Action → put it in the route's `_lib/server/server-actions.ts` (or `<name>-server-actions.ts`), with
  `"use server"` first, and build each action with `authActionClient`, `publicActionClient`, `captchaActionClient` or
  `adminActionClient`.
- Need a query or other server code for one route → put it in the route's `_lib/server/`, with `import "server-only"`.
  Server code used across routes goes in `lib/server/`.
- Need a Zod schema for one route → put it in the route's `_lib/schema/<name>.schema.ts`.
- Need a helper → put it in the route's `_lib/`, or in `lib/` when routes share it.
- Need environment values → read them through a Zod schema in `config/<name>.config.ts` and import the typed config
  elsewhere. `NEXT_PUBLIC_*` reads stay allowed everywhere.
- Need an error the user sees → log the driver error and throw an i18n key instead of raw error text.
- Need translations → put them in `i18n/messages/<locale>/<namespace>.json`.
- Need styles → put CSS in `styles/`. Need docs or blog content → put `.mdoc` files in `content/<collection>/`.
- Need a feature larger than one route → make a feature package under `packages/features/`.
