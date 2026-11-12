# A Turborepo or other monorepo

Write `harness.config.ts` at the repository root before running init. Each app is a workspace with its
own shape; folders outside every workspace get only the root layout rules.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: "apps/dashboard", shape: "next-modules", next: true, test: "test" },
    { path: "supabase", shape: "supabase" },
  ],
  legacy: "tooling/harness-legacy.json",
  root: { entries: ["apps", "supabase", "turbo.json", "renovate.json"] },
});
```

- `path: "apps/*"` makes every folder under `apps/` a workspace of that shape. An app that create-turbo
  wrote has `app/` at its top and no `src/`; it keeps that layout, with `modules/` and `shared/` beside
  `app/`.
- `{ path: "packages/*", shape: "package" }` puts the shared packages under the harness too; see below.
- `test: "test"` runs the app's own `test` package script instead of Vitest. Leave it out for a Vitest app.
- `legacy` names the file that lists old code. Leave it out for a monorepo with no old code.
- `root.entries` names what may sit at the repository root besides the defaults.

```sh
git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
# write harness.config.ts
node tooling/harness/cli.ts init    # first run adds tooling/harness to the workspace packages and stops
pnpm install
node tooling/harness/cli.ts init    # second run: writes the wiring, prints the next steps
```

For a fresh `create-turbo` project the whole config is two workspace entries and a legacy list:

```ts
export default defineHarness({
  workspaces: [
    { path: "apps/*", shape: "next-modules", next: true },
    { path: "packages/*", shape: "package" },
  ],
  legacy: "tooling/harness-legacy.json",
  root: { entries: ["apps", "packages", "turbo.json"] },
});
```

`init --starter` then prints eleven steps for it, and after them all 27 gate steps pass:

- **Steps 1 to 3.** Install the harness's tools in `apps/docs`, `apps/web` and `packages/ui`, one
  printed `pnpm add -D` line each. create-turbo ships TypeScript 7, so each line ends with the
  [TypeScript 6 alias](init.md#your-own-eslint-config). The config-only packages get no line.
- **Steps 4 and 5.** Install `zod` and `server-only` in each app, for the starter files.
- **Step 6.** Replace `export default …` in the three kept ESLint configs with the two printed lines.
- **Step 7.** Declare `NODE_ENV` in `globalEnv` of `turbo.json`.
- **Step 8.** Format each workspace once with the printed `prettier --write .` commands.
- **Step 9.** `node tooling/harness/cli.ts legacy init`, which lists what create-turbo wrote outside
  the shapes: each app's fonts, `page.module.css`, long `page.tsx` and `next.config.js`, the three
  `packages/eslint-config/*.js` and the three components directly in `packages/ui/src/`.
- **Step 10.** Commit.
- **Step 11.** `pnpm run check`.

An older Turborepo with one Next.js app and its own tools needed six steps and a legacy list of 710
files.

## The legacy list

`node tooling/harness/cli.ts legacy init` runs the tools once and lists every file
that has a finding today. From then on:

- an untouched old file passes, and its findings are printed as a count per step;
- a new file, and a file outside the list, is held to every rule;
- an agent that changes an old file must fix that file's old tool findings before its turn ends;
- the list may only shrink.

In GitHub Actions the checkout needs `fetch-depth: 0`, because CI compares each legacy file with the
default branch. Init prints the workflow steps with that line.

A project that had its own Prettier style and its own ESLint version keeps both. Init does not reformat
such an app and does not downgrade its tools.

## Shared packages

Without a workspace entry, code under `packages/` gets only the root layout rules.
The `package` shape gives each package the layout of one module of the app, so moving
`apps/<app>/src/modules/<m>/` to `packages/<m>/src/` is a folder move:

```text
packages/<name>/
  package.json          exports "." -> src/index.ts and "./server" -> src/server.ts
  tsconfig.json, README.md, tool configs
  src/
    index.ts            client-safe public entry, named exports only
    server.ts           server-only public entry
    schemas.ts, types.ts
    components/         UI; one optional area subfolder
    server/             queries and I/O; one optional area subfolder; "server-only"
    domain/             pure rules with a test beside each file; one optional area subfolder
    hooks/              flat; use-<name>.ts(x)
    lib/                flat helpers
```

- A package holds no `actions/` and no `"use server"`. A Server Action stays in the app's module and
  calls the package's `server.ts`.
- A package does not read `process.env`. The app reads it in `src/shared/lib/env.ts` and passes the value in.
- A relative import that leaves the package, or leaves `src/` from inside it, is `package-boundary`;
  import the other package by its name.
- The package's top level takes configuration only: the tool configs, `.json` and `.md` files, and no
  folder but `src/`. A package without `src/`, such as create-turbo's `typescript-config`, is
  config-only: no tool runs there and init writes nothing into it.
- The harness requires TypeScript, so JavaScript is denied everywhere in a package but for the tool
  config names. create-turbo's `packages/eslint-config/{base,next,react-internal}.js` predate the
  harness: `legacy init` puts them on the legacy list, or convert the package to TypeScript under
  `src/`. `root.jsExceptions` cannot name them, since it covers the repository root only. Name such a
  file in `locked` when agents should not edit it.
- `src/domain/` takes `.ts` files only.
- depcruise, knip and jscpd run in each package with `src/`, as in an app. dependency-cruiser uses a
  package preset: no cycles, a pure `src/domain/`, `src/server/` internals reached only through
  `src/server.ts`, and `src/index.ts` never reaching server code. Knip takes the files the package's
  `exports` point at as entries and reports one of their exports that no workspace imports.
- ESLint, Prettier, tsc and Vitest run in each package's folder. Init writes
  `harnessEslint({ root: import.meta.dirname, layout: "package" })` there, or prints that line for a
  config the package already has, as create-turbo's `packages/ui/eslint.config.mjs`. With that layout the
  preset allows adapter casts in `src/server/` and keeps `src/domain/` free of React, Next, Node
  built-ins and server code.
- create-turbo generates `packages/ui/src/button.tsx` directly in `src/`. Move such files to
  `src/components/` and export them from `src/index.ts`, or put them on the legacy list.
