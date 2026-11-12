---
title: Shared packages
nav_order: 4
parent: Adopt it
---

# Shared packages

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

## A new package

Run on the same project after adoption: a package `packages/pricing` with one pure function, used
from `apps/web`.

1. Create `packages/pricing/` with three files. Only these are needed; every other entry of the layout
   above is where that kind of file goes when the package has one.

   ```json
   {
     "name": "@repo/pricing",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "exports": { ".": "./src/index.ts" },
     "devDependencies": { "@repo/typescript-config": "workspace:*", "typescript": "7.0.2" }
   }
   ```

   `tsconfig.json` extends `@repo/typescript-config/base.json` and includes `src`. `src/index.ts` lists
   the exports by name.

2. Put the function in `src/domain/` with its test beside it. With create-turbo's `base.json`, which
   sets `NodeNext`, write relative imports with the extension:
   `export { priceWithTax } from "./domain/price-with-tax.ts";`. Without it the type check fails with
   `TS2835`.
3. `node tooling/harness/cli.ts init`. It writes the package's tool configs and scripts and prints an
   install line for it. A new package folder is not locked until the commit that adds it, so an agent
   can do this step too.
4. Run the printed `pnpm add -D` line from the repository root, in brackets so the `cd` does not
   stick: `(cd packages/pricing && pnpm add -D ...)`. It names the versions the presets are
   tested with, which can differ from the versions the other workspaces already have.
5. Add the package to the app that uses it: `(cd apps/web && pnpm add @repo/pricing --workspace)`.
6. Import it in the app: `import { priceWithTax } from "@repo/pricing";`.
7. Format the new package, commit, and run `pnpm run check`. The printed format step names every
   workspace, and the printed commit message still says "Add the harness"; use your own.

The check then has 35 lines, eight of them for `packages/pricing`.
