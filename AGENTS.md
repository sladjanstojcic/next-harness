# Working in next-harness

## What this repository is

A guarded Next.js template, with no product, authentication or database on `main`. Use Node 24 and pnpm 12.4.2.
Dependencies are pinned exactly. The harness in `tooling/harness/` runs as TypeScript directly through Node and follows
the same rules as application code.

`next.config.ts` sets `agentRules: false`, so Next writes no instruction block of its own and the Next.js rule below is
this repository's. It also forwards development browser warnings and errors to the terminal
(`logging.browserToTerminal`).

<!-- harness:start — written by `node tooling/harness/cli.ts init`; edit outside this block -->

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

## Checks and the lock

The rules above are enforced; a denial or a finding says where the code goes instead.

- Before a write, the hooks deny a path or name the layout does not take, `.env` files other than `.env.example` (with
  `env: "local"` in `harness.config.ts`, only the `.env*.local` files), `pnpm-lock.yaml` (edit `package.json` and run
  `pnpm install`), vendored files, applied migrations and named destructive or deploying shell commands.
- After a write, the file is formatted, its syntax linted and its path and content audited. After a shell command, the
  files it changed are audited.
- At the end of a turn the Done gate runs types, lint, the audit, import rules, unused code, duplicates and related
  tests on what changed since the prompt. A finding on a changed file or one that imports it blocks.
- Size limits: a file at most 250 lines, counting blanks and comments; a route's `page.tsx` at most 60; a folder at
  most 10 source files, not counting tests beside their source. Vendored, generated files are exempt.
- Run the full gate, the one CI and the pre-push hook run, with `pnpm check`.
- `pnpm run audit` runs the harness audit alone; `pnpm audit` is pnpm's vulnerability check.
- `pnpm exec vitest run <path>` runs one test file; run it in its workspace's folder.
- Tests sit beside their source as `<name>.test.ts(x)`. Keep unit tests deterministic: no real clock, randomness or
  network.
- On a fresh clone the hooks deny every call until `pnpm install --frozen-lockfile` has run.
- The harness is locked: `tooling/harness/`, the hook settings, `.githooks/`, `.github/`, the tool configs,
  `harness.config.ts`, its legacy list and the paths in its `locked` list.
- Only the user opens the lock: `pnpm harness:unlock`, run in their own terminal. Running it yourself is denied.
- When a rule or a block looks wrong, say so in the handoff with the block's id from `pnpm harness:blocks`; do not
  work around it.

## Repair budget

Each user prompt permits two repair attempts at the Done gate. An identical repeated failure ends repairs at once.
When repairs end, report what still fails. Never hide a failure, weaken a check, add an inline disable or claim that
an unrun check passed.

## What linters cannot see

- No comments that narrate code, no speculative options or abstractions, no mock data in production paths.
- Ask before adding a dependency.
- Keep the diff within the requested scope, preserve existing work, and explain limitations in the handoff.

Full rules: <https://sladjanstojcic.github.io/next-harness/>

<!-- harness:end -->

## Developing the harness

- A rule lives once, in code, and the guards, the audit and the block above read it there. A workspace's folders, names
  and content rules are in its shape's file in `tooling/harness/shapes/` (`next-modules.ts`, or the `electron/`,
  `makerkit/` and `vite/` folders), its size limits in `shapes/limits.ts`, and the root layout in
  `core/root-layout.ts`. Change that source when a rule must change.
- The block between the harness markers is generated from `tooling/harness/guides/`: one guide per shape, plus
  `common.md`. Edit the guide, never the block, then run `node tooling/harness/cli.ts init`; the audit rule
  `agents-block` fails while the block differs. A guide states only what the code does, within its limit: `common.md`
  45 lines, the app shapes 90, the others 40. A fact without room goes on a docs page.
- Harness work needs the user's `pnpm harness:unlock`. The hooks load the harness on every tool call, so create a new
  file before anything imports it, and add an import together with its first use.
- Test the harness with `pnpm vitest run tooling/harness`. `tooling/harness/testing/` builds disposable git
  repositories of each kind of project and runs the acceptance tests on them. Review a change against
  `docs/review-rubric.md` as well as the automated checks.
- `harness.config.ts` at the root says which shape applies to which folder. This repository has none, so it is one
  `next-modules` workspace. The fields are in [docs/configuration.md](docs/configuration.md); the file classes, the
  lock and the block log in [docs/reference.md](docs/reference.md); the gates in [docs/gates.md](docs/gates.md).
- The shapes, each with its page:
  - `next-modules`: a Next.js app, with or without `src/` ([docs/next-app.md](docs/next-app.md)).
  - `package`: one module moved out to a shared package ([docs/packages.md](docs/packages.md)).
  - `electron-vite`: an Electron app built with electron-vite ([docs/electron.md](docs/electron.md)).
  - `vite-spa`: a single-page React app built with Vite ([docs/vite.md](docs/vite.md)).
  - `makerkit-app` and `makerkit-feature`: a Makerkit app and its feature packages ([docs/makerkit.md](docs/makerkit.md)).
  - `supabase` and `e2e`: the database folder and a folder of Playwright tests
    ([docs/configuration.md](docs/configuration.md#shapes-without-a-page-of-their-own)).
- `pnpm harness:split` creates or moves the local `harness` branch to a `git subtree split` of `tooling/harness/`.
  Another repository consumes it with `git subtree add --prefix=tooling/harness <repo> harness --squash`. Pushing the
  branch is the user's step.
- `tooling/harness/package.json` pins `typescript` and `zod` as `npm:` aliases and declares no peers, so a kit's
  `manypkg fix` leaves it alone. `presets/peers.json` lists the tools whose rules `presets/` holds, each with the
  template's version and the minimum the presets work with. Presets import no tool package: they load each one from
  the workspace that calls them.
- Validate a change to a shape or to init on a real project of that kind, from a fresh scaffold (create-next-app,
  create-turbo, create-vite, the electron-vite scaffold). [docs/limitations.md](docs/limitations.md) records what was
  run and what was not.

## Documentation

GitHub Pages builds the site at <https://sladjanstojcic.github.io/next-harness/> from `docs/` on `main`, with Jekyll
and the Just the Docs theme set in `docs/_config.yml`. There is no build step in this repository and no dependency for
it.

- Every page starts with front matter: `title`, `nav_order`, and `parent` for a page under "Adopt it" or "Reference".
  A page without a title is missing from the sidebar.
- Link to another page by its file name (`init.md#your-own-eslint-config`), so the link works on GitHub and on the
  site. Link to a file outside `docs/` by its GitHub address.
- Write plain Markdown: no callout syntax, no Mermaid, text drawings for diagrams.
- A message shown on a page is copied from the harness's output, and a numbered step is one that was run. When a
  change alters what init prints or what a rule says, change the page in the same commit; `README.md` holds the short
  version of the same commands.
- Keep a page at most 250 lines; split it as `packages.md` was split from `monorepo.md`.
