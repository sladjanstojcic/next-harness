---
title: A monorepo
nav_order: 3
parent: Adopt it
---

# A Turborepo or other monorepo

A monorepo gets one file, `harness.config.ts`, that says which folder has which shape. Each app is a
workspace with its own shape; folders outside every workspace get only the root layout rules.

The steps below were run on a fresh create-turbo project: two Next.js apps and three packages. It
reached a passing check in the eleven steps below, which are thirteen commands, one
file written and four edited by hand.

## Before you start

- The repository has at least one commit and a clean working tree.
- You have Node 24 and pnpm.

Starting from nothing? Create the monorepo first, then `cd my-repo`:

```sh
pnpm dlx create-turbo@latest my-repo --package-manager pnpm --example basic
```

create-turbo makes the repository and the first commit itself. It also pins its own pnpm version, so
pnpm may report a different version inside the project.

## 1. Add the harness folder

```sh
git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
```

Do this before writing the config, because the config imports from that folder.

## 2. Write harness.config.ts

At the repository root. For a fresh create-turbo project this is the whole file:

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: "apps/*", shape: "next-modules", next: true },
    { path: "packages/*", shape: "package" },
  ],
  legacy: "tooling/harness-legacy.json",
  root: { entries: ["apps", "packages", "turbo.json"] },
});
```

An older monorepo names its workspaces one by one:

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
- `{ path: "packages/*", shape: "package" }` puts the shared packages under the harness too; see
  [Shared packages](packages.md).
- `test: "test"` runs the app's own `test` package script instead of Vitest. Leave it out for a Vitest app.
- `{ path: "apps/e2e", shape: "e2e", tools: "none" }` puts a folder of Playwright tests under the
  harness: `tests/<suite>/` with kebab-case names and at most two levels of area folders. Its lint and
  type check run only with the `oxc` tool set, which is the default for this shape; there is no
  ESLint preset for it yet.
- `legacy` names the file that lists old code. Leave it out for a monorepo with no old code.
- `root.entries` names what may sit at the repository root besides the defaults.

## 3. Run init, install, run init again

```sh
node tooling/harness/cli.ts init             # adds tooling/harness to the workspace packages and stops
pnpm install
node tooling/harness/cli.ts init --starter   # writes the wiring, prints the next steps
```

The first run prints `node tooling/harness/cli.ts init` as its own next step. Add `--starter` to it, as
shown here, if you want the `shared/lib/` helpers in each app. With it init
prints eleven steps for a create-turbo project. Without it init prints eight and writes no starter
files; running it again with `--starter` later is safe.

Init also prints the steps for a CI job. They are optional for the local check; add them when the
repository has GitHub Actions.

The eleven printed steps are steps 4 to 11 here. Run each printed line from the repository root. A
line for one workspace comes in brackets, `(cd apps/docs && ...)`, so the shell is back at the root
afterwards.

## 4. Install the harness's tools in each workspace

Three printed lines, one each for `apps/docs`, `apps/web` and `packages/ui`. Copy them from your
terminal; they name exact versions.

create-turbo ships TypeScript 7, so each line ends with the
[TypeScript 6 alias](init.md#your-own-eslint-config). The config-only packages get no line.

## 5. Install the packages the starter files import

Two printed lines, one per app:

```sh
(cd apps/docs && pnpm add zod@4.6.7 server-only@0.0.1)
(cd apps/web && pnpm add zod@4.6.7 server-only@0.0.1)
```

## 6. Add the harness's rules to the three ESLint configs

Init names the files and prints the lines for each. In `apps/docs/eslint.config.js` and
`apps/web/eslint.config.js` the `export default nextJsConfig;` becomes:

```js
import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";
import { nextJsConfig } from "@repo/eslint-config/next-js";

const harnessConfig = [...[nextJsConfig].flat(), ...harnessEslint({ root: import.meta.dirname, layout: "app-root", toolsFrom: "@repo/eslint-config" })];
export default harnessConfig;
```

`packages/ui/eslint.config.mjs` gets the same change with its own `config` variable and
`layout: "package"`. Keep or delete the `@type` comment, which now sits above the `const harnessConfig`
line; the check does not read it. Paste what init
printed for your project, not this example.

## 7. Declare NODE_ENV in turbo.json

The starter `shared/lib/env.ts` reads `NODE_ENV`, and Turborepo's lint rule reports a variable that
`turbo.json` does not list. create-turbo's file has no such key yet. Add it at the top level, beside
`"tasks"`:

```json
"globalEnv": ["NODE_ENV"],
```

## 8. Format each workspace once

```sh
(cd apps/docs && pnpm exec prettier --write .); (cd apps/web && pnpm exec prettier --write .); (cd packages/ui && pnpm exec prettier --write .)
```

Prettier prints a `MODULE_TYPELESS_PACKAGE_JSON` warning for `packages/ui`. It is harmless; do not
add `"type": "module"` for it.

## 9. Write the legacy list

```sh
node tooling/harness/cli.ts legacy init
```

It lists the 17 files create-turbo wrote outside the shapes: each app's fonts, `page.module.css`, long
`page.tsx` and `next.config.js`, the three `packages/eslint-config/*.js`, the three components directly
in `packages/ui/src/`, and `packages/ui/package.json` for two dependencies knip finds unused.

## 10. Commit

```sh
git add -A && git commit -m "Add the harness"
```

## 11. Run the full check

```sh
pnpm run check
```

Every tool runs once per workspace, so the output has 27 lines for this project, each ending in
`passed`. Below them, under "Pre-existing in legacy
files (not blocking)", the old findings are printed as a count per tool, followed by the first few in
full.

An older Turborepo with one Next.js app and its own tools needed six printed steps and a legacy list
of 710 files.

## The legacy list

`node tooling/harness/cli.ts legacy init` runs the tools once and lists every file
that has a finding today. From then on:

- an untouched old file passes, and its findings are printed as a count per step;
- a new file, and a file outside the list, is held to every rule;
- an agent that changes an old file must fix that file's old tool findings before its turn ends;
- the list may only shrink.

To shorten it, run `node tooling/harness/cli.ts legacy prune` in your own terminal. It runs the same
tools again and takes every file that has no finding left off the list: fixed, moved or deleted. It
writes nothing while a tool cannot run. Commit the shorter list.

In GitHub Actions the checkout needs `fetch-depth: 0`, because CI compares each legacy file with the
default branch. Init prints the workflow steps with that line.

A project that had its own Prettier style and its own ESLint version keeps both. Init does not reformat
such an app and does not downgrade its tools.

## Shared packages

The `package` shape, and the steps for adding a new package after adoption, are on their own page:
[Shared packages](packages.md).
