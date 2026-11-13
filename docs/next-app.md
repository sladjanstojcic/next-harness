---
title: An existing Next.js project
nav_order: 2
parent: Adopt it
---

# An existing Next.js project

For a single app at the repository root, such as `create-next-app` output, with or without a `src/`
folder. No config file is needed: the whole repository is one `next-modules` workspace.

The steps below were run on a fresh create-next-app 16 project, once with `src/` and once without.
Both reached a passing check in twelve steps, with two files edited by hand.

## Before you start

- The project is a git repository with at least one commit and a clean working tree.
- You have Node 24 and pnpm.

Starting from nothing? Create the app first. Either layout works:

```sh
pnpm create next-app@latest my-app --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --yes
pnpm create next-app@latest my-app --ts --eslint --tailwind --app --no-src-dir --import-alias "@/*" --use-pnpm --yes
```

create-next-app makes the repository and the first commit itself. Then `cd my-app`.

## With or without src/

Without `--src-dir`, create-next-app puts `app/` at the root, and Next.js ignores `src/app/` while it
exists. The harness then keeps the same shape one level up: routes in `app/`, features in
`modules/<module>/`, shared code in `shared/`. It reads this from git: `app/` holds a file git lists and
`src/app/` holds none. Nothing is configured, and an empty folder does not switch the layout.

A folder counts once git lists a file under it, tracked or untracked and not ignored, so an empty
folder from `mkdir` changes nothing and every clone agrees. Every other workspace, an empty one too,
uses `src/`. Without `src/`, a `src` folder is denied; with it, `app/`, `modules/`, `shared/` and
`backend/` at the top stay denied. So the Write tool cannot switch the layout. A shell command that moves
or creates files under `app/` or `src/app/` can, and the full audit then reports the files left in the
other layout. The `@/` alias maps to the workspace top.

Every message then names your paths, without the `src/` prefix. Read the other pages of this site the
same way.

## 1. Add the harness folder

```sh
git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
```

You should see `Added dir 'tooling/harness'` and two new commits.

## 2. Run init for the first time

```sh
node tooling/harness/cli.ts init --starter
```

It adds `tooling/harness` to `pnpm-workspace.yaml`, tells you to install, and stops:

```text
updated pnpm-workspace.yaml: packages tooling/harness
The harness's own dependencies (zod) are not installed. Next steps:
  1. pnpm install
  2. node tooling/harness/cli.ts init --starter
```

## 3. Install

```sh
pnpm install
```

This install may end with `Issues with peer dependencies found`. That is an unmet `@types/node` peer;
step 5 installs the version that settles it.

## 4. Run init again

```sh
node tooling/harness/cli.ts init --starter
```

This run writes the wiring and prints what it did, one line per file: the hooks for Claude Code and
Codex, the pre-push hook, the package scripts, and a config for Prettier, Vitest, knip, Playwright and
dependency-cruiser. `--starter` also copies the `shared/lib/` helpers that the content rules point at,
under `src/` or beside `app/`, and `e2e/smoke.test.ts`.

It also sets git's `core.hooksPath`, writes `.prettierignore`, adds two entries to `.gitignore`, and
adds `allowImportingTsExtensions` and an `exclude` list to `tsconfig.json`.
[What init writes](init.md) explains each.

A tool config you already had is kept. For `eslint.config.mjs` init prints the three lines to add; you
use them in step 7.

It writes the harness's rules for the agent into `AGENTS.md`, between two marker lines, below the text
create-next-app put there, and prints `updated AGENTS.md: harness rules appended, your text kept`. It
creates `CLAUDE.md` with the line `@AGENTS.md`, so Claude Code reads the same rules.

It then prints the steps for a CI job. They are optional for now: add them to `.github/workflows/`
when the project has a remote.

Last, it prints eleven numbered steps. They are steps 5 to 12 here; step 8 holds four of them.

## 5. Install the harness's tools

Run the `pnpm add -D` line init printed. It names exact versions, so copy it from your terminal, not
from this page. Init installs nothing itself.

pnpm may warn that `eslint@9` is deprecated, and it runs the new `prepare` script. Both are expected.

## 6. Install the packages the starter files import

```sh
pnpm add zod@4.6.7 server-only@0.0.1
```

Use the versions init printed if they differ.

## 7. Add the harness's rules to your ESLint config

Open `eslint.config.mjs` and make the change init printed: one import at the top, and two lines in
place of `export default eslintConfig;`. On create-next-app the file ends up like this:

```js
import { harnessEslint } from "./tooling/harness/presets/eslint.ts";
import { defineConfig, globalIgnores } from "eslint/config";
// ... your config, unchanged ...
const harnessConfig = [...[eslintConfig].flat(), ...harnessEslint({ root: import.meta.dirname, base: false })];
export default harnessConfig;
```

Without `src/`, init adds `layout: "app-root"` to the options. Copy the line from your terminal, not
from this page.

Your config stays where it is and keeps its rules. See
[your own ESLint config](init.md#your-own-eslint-config) for what the options mean.

## 8. Set up shadcn

The lint rule asks for shadcn's components in place of a raw `button` or `input`, so shadcn comes
before the first commit. Init prints four steps for it and runs none. With `src/` they read:

```text
  4. Set up shadcn, whose components the lint rule then asks for (init does not run it): pnpm dlx shadcn@latest init -t next -b base -p nova
  5. Delete the two files shadcn init wrote where the layout takes no code: rm src/components/ui/button.tsx src/lib/utils.ts
  6. Point shadcn at src/shared/, by setting "aliases" in components.json to: { "components": "@/shared/components", "utils": "@/shared/lib/utils", "ui": "@/shared/ui", "lib": "@/shared/lib", "hooks": "@/shared/hooks" }
  7. Add the first component and the cn helper there: pnpm dlx shadcn@latest add button utils
```

Without `src/`, the paths lose the prefix: `rm components/ui/button.tsx lib/utils.ts`, and `shared/`.
`-b base` picks Base UI and `-p nova` the preset this template uses, so shadcn asks nothing. The last
step writes `src/shared/ui/button.tsx` and `src/shared/lib/utils.ts`. The empty folders the deleted
files leave behind do no harm, since git does not list an empty folder.

## 9. Format once

```sh
pnpm exec prettier --write .
```

This puts the app's own files in the preset's style, once. On a fresh scaffold it rewrote five files,
among them `utils.ts` as shadcn wrote it.

Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning about `prettier.config.ts` and suggests adding
`"type": "module"` to `package.json`. The warning is harmless. Do not change the module type for it.

Vitest prints a warning of its own about `vitest.config.ts` when you run `pnpm test`
(`unsupported by configLoader: 'native'`), suggesting a `.mjs` extension or `"type": "module"`. Do
neither.

## 10. Install the browser for the smoke test

```sh
pnpm exec playwright install chromium
```

It prints nothing when that browser is already downloaded.

## 11. Commit

```sh
git add -A && git commit -m "Add the harness"
```

## 12. Run the full check

```sh
pnpm run check
```

On the fresh scaffold all twelve steps passed on the first run, in under a minute. After pnpm's echo
of the command it prints:

```text
prettier: passed
eslint: passed
eslint-preset: passed
typegen: passed
tsc: passed
audit: passed
depcruise: passed
knip: passed
jscpd: passed
vitest: passed
build: passed
playwright: passed
```

## The backend client

A connection to a database or hosted backend lives in `src/backend/`, or `backend/` beside `app/`
without `src/`. The folder is optional and flat: the client, its test, and the types the backend's CLI
generates, named `*.types.ts` or `*-types.ts`. Those are vendored: the Write tool does not edit them,
so regenerate them through the shell. `shared/` and `domain/` do not import the folder, and it imports
only `shared/lib/`.

Without `src/`, a `backend/` folder at the top is always this folder. A project that approved
`backend` in `root.entries` for something else, such as a separate service, now gets path, name and
size findings there. Move that service to another folder name.

An import of a backend package such as `@supabase/supabase-js` or `pg` anywhere else is reported as
`backend-package`, unless the import is `import type`:

```text
src/modules/billing/server/load-invoices.ts:1 backend-package — Import a backend package only in src/backend/, which holds the one client; elsewhere import that client, or the package's types with "import type".
```

An existing project that imports one elsewhere gets these findings in step 12; the legacy list holds
them as for any other rule. [The reference](reference.md#shapes-and-backend-packages) has the list of
packages and how to extend it.

## A project with code in it

A real project has code that does not fit the shape yet. It shows up in step 12. Move it, or give the
project a legacy list as [a monorepo](monorepo.md#the-legacy-list) does: old files are then tolerated
and new ones are held to the rules.

## After the check passes

- **AGENTS.md.** Write your project's own rules outside the marker lines; init rewrites only the part
  between them. [What init writes](init.md#agentsmd-and-claudemd) has the details.
- **Without `src/`.** The `depcruise` and `jscpd` package scripts list only the folders that exist
  today (`app shared`). Add `modules` to both when you create it, as in `depcruise app modules shared ...`.
  `pnpm run check` finds the folders itself on every run, and it covers files you have not committed
  yet. For what goes inside a module, see
  [What this one checks](what-it-checks.md).
- **Let the agent in.** See [Adopt it](adopt.md#let-the-agent-in).
