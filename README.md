<div align="center">

# Next Harness

**A guarded Next.js template for code that agents write.**

Clone it, and your Claude Code or Codex agent is told where code belongs, stopped before it writes a file in the wrong place, checked after every edit, and gated before it ends its turn.

The same harness [installs into](#install-it) an existing Next.js project, a Turborepo and a Makerkit project.

[![Check](https://github.com/sladjanstojcic/next-harness/actions/workflows/check.yml/badge.svg)](https://github.com/sladjanstojcic/next-harness/actions/workflows/check.yml)
[![Node](https://img.shields.io/badge/node-24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-12.4.2-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![Next.js](https://img.shields.io/badge/Next.js-16.4.5-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3%20strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hooks](https://img.shields.io/badge/hooks-Claude%20Code%20%C2%B7%20Codex-6E56CF?style=flat-square)](#let-the-agent-in)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Install it](#install-it) · [Agent instructions](AGENTS.md) · [Review rubric](docs/review-rubric.md)

</div>

---

```text
 agent writes a file              agent runs a command              agent says "done"
        │                                │                                │
   PreToolUse ── guard ──▶          PreToolUse ── snapshot             Stop
   "src/utils/x.ts? no:             PostToolUse ── audit what            │
    put it in a module"             the command changed             Done gate: types, lint,
        │                                │                          audit, boundaries, dead
   PostToolUse ── fast gate              │                          code, copies, related tests
   prettier · lint · audit               │                          ─ blocks, with the fix ─
        └────────────────────────────────┴────────────────────────────────┘
                              pre-push and CI: the same gate, in full
```

## Why

Agents write good code and bad shape. A `utils/` folder appears in every module. Files grow past a
thousand lines. The same function is copied under three names. `any` and `as never` quiet the type
checker. Review catches some of it, late.

This template moves the rules in front of the write. Every rule lives in one place, every denial says
where the code belongs, and the agent cannot edit the rules.

## What it enforces

**One shape.** Routes in `src/app/`, features in `src/modules/<module>/`, cross-cutting code in
`src/shared/`. Nothing else under `src/`, and nothing new at the repository root without a deliberate
entry. [`tooling/harness/shapes/next-modules.ts`](tooling/harness/shapes/next-modules.ts) defines the
shape inside a workspace; [`tooling/harness/core/root-layout.ts`](tooling/harness/core/root-layout.ts)
defines the repository root. An optional `harness.config.ts` adds workspaces, root entries and path
classes; AGENTS.md describes every field. With it, a monorepo can give each folder its own shape:
`next-modules` (below), `package` for a shared package, `makerkit-app` and `makerkit-feature` for a Makerkit app and its feature
packages, and `supabase` for append-only migrations. Each workspace also gets a tool set:
`eslint-prettier`, `oxc` (oxlint and oxfmt) or `none`.

**Four classes of file.** Not every file in an adopted project is yours to fix, so each file has a class:

| Class    | Which files                                                       | Harness rules (paths, names, sizes, content) | Tool findings (types, lint, tests) |
| -------- | ----------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| owned    | every file by default; with an upstream list, the files not on it | block                                        | block                              |
| legacy   | on the legacy list                                                | reported as pre-existing                     | block once the file is touched     |
| upstream | on the upstream list: kit code                                    | not applied                                  | block when the file is changed     |
| vendored | generated code, such as `src/shared/ui/`                          | not applied                                  | direct edits are denied            |

The shape below is `next-modules`, the one this template uses.

```text
src/
  app/                       routes and Next special files only; pages stay thin (≤ 60 lines)
  modules/<module>/
    index.ts                 client-safe public API: types, schemas, client components
    server.ts                server-only public API: queries, server components
    actions/<name>-action.ts Server Actions, first statement "use server"
    components/              feature UI; one optional area subfolder
    server/                  internal queries and I/O; one optional area subfolder
    domain/                  pure rules, no React or I/O, a test beside every file
    schemas.ts · types.ts
  shared/
    ui/                      shadcn primitives, generated by the shadcn CLI, never hand-edited
    components/ · lib/ · hooks/   composed UI, cross-cutting infrastructure, generic hooks
```

**Limits.** 250 lines per file, 60 per page, 10 source files per folder, one level of area
subfolders. Generic names such as `utils`, `helpers`, `common` and `misc` are denied as folder names.

**Boundaries.** A module is used only through `index.ts`, `server.ts` or an action file. `shared/`
never imports a module. No cycles. dependency-cruiser checks it.

**No copies, no workarounds.** Duplicate exports, jscpd and knip catch copies and dead code. No `any`,
no `as never`, no narrowing `as` outside a module's `server/`, no computed `import()` or `require()`,
no inline disables, no `@ts-ignore`.

## How it works

The harness is a small TypeScript CLI that both agent clients call from their hooks. Node 24 runs it
directly, with no build step.

| Moment                      | What runs                                                                                                                                                            | Takes    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Session start               | A code index of every module's public exports, so the agent reuses before it writes                                                                                  | one read |
| User prompt                 | A snapshot of the working tree; Done judges only what this turn changed                                                                                              | ms       |
| Before a write              | Guards: structure, secrets (`.env*`), the lockfile, vendored UI, applied migrations, the harness lock                                                                | ms       |
| Before a command            | Guards: force push, `rm` outside the checkout, destructive Prisma and Supabase migrations, Supabase deploys to a linked project, the unlock and false-block commands | ms       |
| After a write               | Fast gate: Prettier writes, syntax-level lint, path and content audit of that file                                                                                   | ≈ 1–2 s  |
| After a command             | Path and content audit of whatever the command created or changed, plus the lock                                                                                     | ≈ 1 s    |
| Stop                        | Done gate: `next typegen`, `tsc`, typed ESLint on changed files, full audit, dependency-cruiser, knip, jscpd, `vitest related`                                       | seconds  |
| Pre-push and GitHub Actions | The full gate: format check, typed lint, typegen, types, audit, boundaries, dead code, copies, all tests, `next build`, Chromium smoke                               | minutes  |

When the Done gate fails, the agent's turn does not end: it gets the findings and fixes them. Changed
files and their importers block; older problems elsewhere are reported, not blamed on this turn.

**Repair budget.** Two attempts per user prompt. A failure identical to the previous one ends repairs
at once. After that the agent must report what still fails instead of hiding it. Hooks time out after
90 s (after a change) and 300 s (at Stop).

Every message says where the code belongs:

```text
src-shape: Put routes in src/app/, feature code in src/modules/<module>/, and cross-cutting
utilities in src/shared/lib/.
```

## Install it

The harness is one folder, `tooling/harness/`, with the same hook wiring in every project. What differs
between projects is one file at the repository root, `harness.config.ts`, which says which folder has
which shape.

| Your project                | How the harness arrives                | `harness.config.ts`                        | Linter and formatter                              |
| --------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| New Next.js project         | clone this template                    | not needed                                 | ESLint and Prettier, ours                         |
| Existing Next.js project    | `git subtree add`, then `init`         | not needed                                 | ESLint and Prettier, ours added                   |
| Turborepo or other monorepo | `git subtree add`, config, then `init` | one workspace per app, plus a legacy list  | each app's own, ours added                        |
| Makerkit project            | `git subtree add`, config, then `init` | the kit's folders, plus your `owned` paths | the kit's oxlint and oxfmt, ours as a second pass |

All four need Node 24. The commands below are shown for pnpm; init prints each command in the project's
own package manager, and npm and yarn use `workspaces` in `package.json` instead of `pnpm-workspace.yaml`.

### A new Next.js project

Clone the template. Everything is already wired.

```sh
git clone https://github.com/sladjanstojcic/next-harness.git my-product && cd my-product
pnpm install --frozen-lockfile      # the only command the hooks allow before dependencies exist
pnpm run prepare                     # enables .githooks/pre-push
pnpm rename --name my-product --port 3100 --title "My Product"
pnpm exec playwright install chromium
pnpm dev
```

`rename` sets the package name, the dev port, the layout title and description, and this heading.
`.env.example` documents the starting environment; no secrets are needed. This template pins pnpm 12.4.2.

### An existing Next.js project

For a single app at the repository root, such as `create-next-app` output, with or without a `src/`
folder. No config file is needed: the whole repository is one `next-modules` workspace.

Without `--src-dir`, create-next-app puts `app/` at the root, and Next.js ignores `src/app/` while it
exists. The harness then keeps the same shape one level up: routes in `app/`, features in
`modules/<module>/`, shared code in `shared/`. It reads this from git: `app/` holds a file git lists and
`src/app/` holds none. Nothing is configured, and an empty folder does not switch the layout.

```sh
git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
node tooling/harness/cli.ts init --starter   # first run: lists tooling/harness as a workspace package, then stops
pnpm install
node tooling/harness/cli.ts init --starter   # second run: writes the wiring, prints the next steps
```

Then do the printed steps in order. On a real `create-next-app` project there were seven:

1. Install the harness's tools with the printed `pnpm add -D` line. Init installs nothing itself.
2. Install `zod` and `server-only`, which the starter files import.
3. Add the two printed lines to each config the project already had. Your `eslint.config.mjs` stays where
   it is and imports the harness's rules; see [your own ESLint config](#your-own-eslint-config).
4. `pnpm exec prettier --write .`, once, to format the app in the preset's style.
5. `pnpm exec playwright install chromium`, for the smoke test.
6. `git add -A && git commit -m "Add the harness"`.
7. `pnpm run check`, the full gate.

`--starter` copies the `shared/lib/` helpers that the content rules point at, under `src/` or beside
`app/`, and `e2e/smoke.test.ts`.
Code that does not fit the shape yet shows up in step 7. Move it, or give the project a legacy list as
the monorepo section below does.

### A Turborepo or other monorepo

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

The printed steps on a real Turborepo with one Next.js app were six: install the tools in the app's
folder, add the two printed lines to the app's `eslint.config.mjs`, format that one file, write the
legacy list, commit, run `pnpm run check`.

**The legacy list.** `node tooling/harness/cli.ts legacy init` runs the tools once and lists every file
that has a finding today. In that project it listed 710 files. From then on:

- an untouched old file passes, and its findings are printed as a count per step;
- a new file, and a file outside the list, is held to every rule;
- an agent that changes an old file must fix that file's old tool findings before its turn ends;
- the list may only shrink.

In GitHub Actions the checkout needs `fetch-depth: 0`, because CI compares each legacy file with the
default branch. Init prints the workflow steps with that line.

A project that had its own Prettier style and its own ESLint version keeps both. Init does not reformat
such an app and does not downgrade its tools.

**Shared packages.** Without a workspace entry, code under `packages/` gets only the root layout rules.
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
- ESLint, Prettier, tsc and Vitest run in each package's folder. Init writes
  `harnessEslint({ root: import.meta.dirname, layout: "package" })` there, or prints that line for a
  config the package already has, as create-turbo's `packages/ui/eslint.config.mjs`. With that layout the
  preset allows adapter casts in `src/server/` and keeps `src/domain/` free of React, Next, Node
  built-ins and server code.
- create-turbo generates `packages/ui/src/button.tsx` directly in `src/`. Move such files to
  `src/components/` and export them from `src/index.ts`, or put them on the legacy list.

### A Makerkit project

The kit's code stays the kit's. A file, `tooling/harness-upstream.json`, lists the kit's files. Every file
that is not on it is yours and gets the harness rules, so a new feature package or route is judged without
being named anywhere. The kit's `.oxlintrc.json`, `turbo.json` and other files are not edited by init, and
your kit updates merge as before.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: "apps/web", shape: "makerkit-app", next: true },
    { path: "packages/features/*", shape: "makerkit-feature" },
    { path: "apps/web/supabase", shape: "supabase" },
  ],
  upstream: "tooling/harness-upstream.json",
  legacy: "tooling/harness-legacy.json",
  env: "local",
  locked: [".oxlintrc.json", ".oxfmtrc.jsonc", "turbo.json", "tooling/typescript/base.json", "apps/web/next.config.mjs"],
});
```

- `upstream` names the list of kit files. Write it with
  `node tooling/harness/cli.ts upstream sync <git ref>`, where the ref is the kit's own branch, such as
  `upstream/main`, or the kit commit you last merged. It lists the tracked files that also exist in that
  ref. Run it again after each kit update, so the kit's new files join the list. The list is locked; an agent cannot add its own files.
- Without a ref the command lists every tracked file, and only while no list exists. Use that for a fresh
  kit clone that holds no code of yours yet.
- `owned` is optional here. A prefix in it claims a kit path you have taken over, so the rules apply there.
  Without an `upstream` list, `owned` works the old way: only the listed prefixes are yours.
- `legacy` is for a project that already holds your own code with findings; see the monorepo section.
- `env: "local"` denies only `.env*.local`. The kit commits `.env`, `.env.development` and
  `.env.production`, and they stay writable.
- `locked` adds the kit's own configs to the lock, so an agent cannot loosen the kit's lint either.

The commands are the same as for a monorepo, plus the list: subtree add, config, init, install, init
again, `upstream sync`, then `legacy init` when the config names a legacy list. On a real
Makerkit app the list held 1454 kit files of 1691 tracked, the 62 files outside it and outside the
harness were the project's own, and the full gate took 9 seconds. Tracked folders of your own at the
repository root, such as a notes folder, need a line in `root.entries`.

What an agent meets in a Makerkit project:

- **In your paths:** the Makerkit layout (`_components/`, `_lib/server/`, `server/actions/`, `schema/`),
  size limits, no inline disables, package boundaries, and the harness's oxlint rules on top of the kit's.
- **In kit files:** no harness rule. An edit is allowed; a new file in a kit folder is yours and is judged.
  The kit's files do not count towards that folder's size limit. The kit's own type check, lint and tests still
  block when the changed file fails them.
- **In `supabase/`:** a migration that is already on the remote branch cannot be edited, deleted or moved.
  A new migration is allowed. `supabase db push`, `supabase link` and the `supabase:deploy` script are
  denied; applying a schema to a linked project is your step.

The kit's `pnpm format:fix` and `manypkg fix` leave `tooling/harness/` alone: init lists it in
`.prettierignore` and `.eslintignore`, and the harness's `package.json` declares no peers.

### Let the agent in

The same in every project, because init writes the wiring this template ships with.

- **Claude Code:** accept the workspace trust dialog. `.claude/settings.json` wires SessionStart,
  UserPromptSubmit, PreToolUse and PostToolUse (Bash, Edit, Write, NotebookEdit) and Stop.
- **Codex:** trust the project's `.codex/` configuration and review the hooks in `/hooks`;
  `.codex/config.toml` turns the hooks feature on. In a linked git worktree Codex skips project hooks
  (observed with Codex CLI 0.166.0). Run `pnpm codex:hooks` once, or `node tooling/harness/cli.ts init --codex-user` in an adopting
  project: it installs the
  same hooks in `~/.codex/hooks.json` with a command that fires only inside a linked worktree, so nothing
  runs twice in a normal clone.

[AGENTS.md](AGENTS.md) is what the agent reads in this template (Claude Code through `CLAUDE.md`): the
shape, where each kind of code goes, the checks, and the things linters cannot see. Init does not write
an `AGENTS.md` into an adopting project. Copy the sections that apply into yours: the layout of your
shape, "Checks and when they run" and "Repair budget". Without them the agent still learns each rule from
the denial that states it, one block at a time.

### Update the harness

In the repository that develops the harness, `pnpm harness:split` moves the local `harness` branch to a
subtree split of `tooling/harness/`; `git push origin harness` publishes it. In a project that uses it:

```sh
git subtree pull --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
node tooling/harness/cli.ts init    # adds wiring the new version needs; keeps what is already there
```

When the new version changed the hook wiring itself, init says so and stops; repeat it with `--force`.

Run both in your own terminal, since `tooling/harness/` is locked for agents. `harness.config.ts` and the
legacy list sit outside that folder, so a pull never overwrites them. If `git subtree` fails with
"working tree has modifications" although `git status` is clean, run `git update-index --refresh` and
repeat it.

## Daily use

```sh
pnpm check                 # the full gate; what pre-push and CI run
pnpm run audit             # the harness audit alone (pnpm audit is pnpm's vulnerability scanner)
pnpm harness:blocks        # the block log
pnpm harness:unlock        # open the harness for four hours; pnpm harness:lock closes it
```

Init adds these scripts to an adopting project. This template also has:

```sh
pnpm codex:hooks           # user-level Codex hooks for linked worktrees
pnpm vitest run <file>     # focused unit tests
pnpm harness:split         # point the local harness branch at a subtree split of tooling/harness/
pnpm rename --name <pkg> --port <n> --title "<title>"
```

Smoke uses `127.0.0.1:3210`; set `SMOKE_PORT` when that port is taken. The gate forces CI mode, so
the browser test starts its own production server.

A working day with agents looks like this. You give the agent a task. It is stopped before a write in
the wrong place and told where the code belongs. When it says it is done, the Done gate runs and sends
it back with the findings, at most twice. You push, and the pre-push hook runs the full gate. Now and
then you read `pnpm harness:blocks`; a rule that mostly blocks good code is a bug in the harness.

## What init writes

`node tooling/harness/cli.ts init [--starter] [--codex-user] [--force]` is safe to run again. It keeps
other keys and hooks, refuses changed harness wiring unless `--force` is given, and never replaces a
config the project already has.

**Wiring, in every project.** `.claude/settings.json` hooks, `.codex/hooks.json`, `.codex/config.toml`,
`.githooks/pre-push`, `core.hooksPath` and the package scripts. It adds
`"prepare": "git config core.hooksPath .githooks"` to the root `package.json`, so a fresh clone gets the
pre-push hook on install; when a `prepare` script exists, it prints that command to add. It prints the CI
steps to add.

**Ignore files.** The root `.gitignore` gets `tooling/harness/node_modules/`, since create-next-app
ignores only `/node_modules`; the audit reports any committed `node_modules` file as
`tracked-node-modules`. The root `.prettierignore`, which Prettier and oxfmt read, gets `tooling/harness`
and `harness.config.ts`, and so does `.eslintignore`, which oxlint reads, when a workspace uses oxc. A
project's `prettier --write .`, `oxfmt` or `oxlint --fix` then leaves the locked harness alone.

**Tool configs, in each eslint-prettier workspace.** Thin `eslint.config.ts`, `prettier.config.ts`,
`vitest.config.ts`, `knip.config.ts` and `.dependency-cruiser.json` files over `tooling/harness/presets/`,
the missing tool scripts, and `.prettierignore` entries (`pnpm-lock.yaml`, `src/shared/ui`, `.next`). It
sets `allowImportingTsExtensions` in `tsconfig.json` and excludes `tooling/harness` and the thin configs
from the project's type check. A next-modules workspace whose tsconfig, with the files it extends, maps
no `@/*` gets `"@/*": ["./src/*"]` (or `["./*"]` without `src/`), since the starter files and the
content rules use that alias. Where a `baseUrl` other than the tsconfig's folder is in force, or a file
it extends sets other `paths`, init prints the alias to add by hand instead. A root Next workspace also gets `playwright.config.ts`, which runs only
`e2e/**/*.test.ts`; the CI browser step reports `playwright: skipped` until such a file exists. A `test`
script that does not run Vitest gets no `vitest.config.ts`; init prints the `test: "test"` line for
`harness.config.ts` instead. In a workspace without `src/`, the ESLint config passes
`layout: "app-root"`, the ignore entry is `shared/ui`, and depcruise and jscpd read `app/`, `modules/`
and `shared/`.

**Tools.** Init prints one install line: only tools that are missing, or below the minimum the presets
work with. An installed tool at or above the minimum stays, also when newer. The presets import no tool
package; they load each tool from the workspace that calls them.

### Your own ESLint config

A project's own ESLint, Prettier, Vitest, Knip or Playwright config is never replaced, even with
`--force`. The file stays where it is, init prints the two lines that add the preset to it, and the file
is locked like init's own:

```js
import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";

export default defineConfig([...nextVitals, ...nextTs, ...harnessEslint({ root: import.meta.dirname, base: false })]);
```

A config that exports a variable has no array to add a spread to. Init then prints the line that
replaces its `export default`, which works for an array and for a single config object:

```js
export default [...[nextJsConfig].flat(), ...harnessEslint({ root: import.meta.dirname, base: false })];
```

`base: false` is what init prints for a config that already brings `eslint-config-next`,
`@next/eslint-plugin-next` or `typescript-eslint`, as create-next-app's does. A config that imports a
package which depends on one of them counts too, as create-turbo's apps do through
`@repo/eslint-config`; init reads that package's `package.json` from the workspace's `node_modules`,
and counts its devDependencies only when it is a workspace package.
For such a config init also prints `toolsFrom: "@repo/eslint-config"`. A tool the workspace does not
install itself, such as `typescript-eslint`, is then loaded from that package, and init does not ask to
install it: a second copy at the template's version could refuse the project's TypeScript. A copy the
workspace does install still wins. The preset then adds only
the harness's rule blocks, since ESLint refuses a plugin defined twice. A project's own Prettier config
is kept as it is, with its style.

### The preset check

The lock is what protects a project's lint config. The second line is a check, in CI and in Done when a
tool config, the workspace's `package.json` or `harness.config.ts` changed, that the preset is still
active. One Node process asks the workspace's own ESLint for the config of one freshly named path in
every folder and extension the shape allows code in. Every rule the preset sets on that path must hold as
an error with the harness's options. Otherwise a `preset-missing` finding names the rule and the path.
Two gaps no probe closes: the config file is code and can read the check's arguments, and a rule turned
off only for `.mts` or `.cts` files goes unseen while the shape denies those extensions.

## The lock

An agent that can edit the harness can switch it off, so it cannot. Locked: `tooling/harness/`,
`.claude/settings.json`, `.codex/`, `.githooks/`, `.github/`, `tsconfig.json`, `next.config.ts`,
`eslint.config.ts`, `prettier.config.ts`, `.prettierignore`, `knip.config.ts`, `vitest.config.ts`,
`playwright.config.ts`, `.dependency-cruiser.json`, `.jscpd.json` and `harness.config.ts` (creating it
too), the tool configs init writes in each eslint-prettier workspace, plus the legacy list and `locked`
paths that config names. Edits by tool are denied, edits
by shell are reported and block Done, and the unlock command is denied to agents.

```sh
pnpm harness:unlock   # you, in your own terminal: four hours to change the harness with the agent
pnpm harness:lock     # when the change is done
```

`package.json` stays open, because dependency edits belong there. Pre-push and CI call the harness
directly rather than through a package script, so changing a script cannot weaken the gate.

## Measuring the harness

A rule that blocks good code is worse than no rule, so every denial and block is appended to
`.git/harness/blocks.jsonl` with its rules, files, session and client.

```sh
pnpm harness:blocks                          # blocks per rule, false-block count, the last twenty
pnpm harness:blocks --false 1a2b3c "why"     # you, not the agent: mark a block that was wrong
```

After the first real project the table says which rules earn their place. Agents may list blocks;
marking one false is denied to them.

## Parallel agents

Several agents in one checkout (worktrees, a reviewer beside an implementer) keep separate task and
shell snapshots per session. The Done gate takes a lock, so only one agent runs type generation and
incremental `tsc` at a time. A dead, corrupt or abandoned lock is removed; a live one is awaited for
up to five minutes.

## Inside `tooling/harness/`

```text
cli.ts              hook <claude|codex> · check <fast|done|ci> · audit · blocks · legacy init · upstream sync · init · lock · unlock
config.ts           defineHarness, loading harness.config.ts, workspaces and the longest-path match
package.json        the harness's own pins (typescript for the compiler API, zod), so the folder works as a subtree
shapes/
  next-modules.ts   the next-modules shape: folders, names, content rules, vendored files
  package.ts        a shared package: one module's layout under src/, configuration at its top
  makerkit-app.ts   a Makerkit apps/web; its content rules sit in makerkit-app-content.ts
  makerkit-feature.ts a Makerkit feature package and its package.json exports
  supabase.ts       a Supabase folder: migration, schema, seed and test names
  limits.ts         file, folder and page size limits
  shape.ts          the contract every shape implements
presets/            the rule sets the tool configs import: ESLint, Prettier, Vitest, Knip, Playwright,
                    depcruise, jscpd; starter/ holds the src/shared/lib/ helpers and the e2e smoke test
                    as text for `init --starter`
tools/
  tool-set.ts       the contract every tool set implements, and binary lookup per workspace
  eslint-prettier.ts the eslint-prettier tool set: format, lint, type check and test steps
  oxc.ts            the oxc tool set: oxlint JSON findings, oxfmt --list-different
  typescript.ts     Next type generation, tsc steps and the compiler API
  vitest.ts         related and full test runs
  analysis.ts       depcruise, knip, jscpd, build and browser smoke steps
  eslint-preset.ts  the preset presence check
core/
  root-layout.ts    what may sit at the repository root, and JS_EXCEPTIONS
  path-check.ts     one path check: the root layout, then the file's workspace shape
  classes.ts        owned, upstream, legacy and vendored files, and what each one blocks
  legacy.ts         the shrink-only legacy list and `legacy init`
  upstream.ts       the list of kit files and `upstream sync`
  lock.ts           what is locked, and the four-hour unlock
  telemetry.ts      the block log and the false-block marker
  code-index.ts     the public-export index handed over at session start
  hooks/            event parsing for both clients, guards, responses, apply_patch paths
  audit/            path rules, content rules, duplicate exports
  gates/            fast, done and ci gates, the tool runner, the repair budget
  state/            tree snapshots, per-session state files and the gate lock under .git/harness/
testing/            disposable git repositories (template, Makerkit and Plint miniatures), the decision corpus,
                    the Makerkit and Plint acceptance tests, the lint-config and server-only tests
```

Every file obeys the same rules as application code.

## What is pinned

Next 16.4.5 · React 19.3.1 · TypeScript 6.0.3 (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) ·
Tailwind 4.3.4 · shadcn 4.23.0 · ESLint 9.39.5 with typescript-eslint 8.72.1 · Prettier 3.9.10 ·
Vitest 5.1.0 · Playwright 1.64.1 · knip 6.44.1 · dependency-cruiser 18.7.2 · jscpd 5.4.2 · zod 4.6.7.
Exact versions, no ranges; every config file is TypeScript.

## Branches

- `base`: plain `create-next-app` plus `shadcn init`, the reference point.
- `main`: `base` plus the harness. No database, authentication or product code.
- `harness`: only the contents of `tooling/harness/`, made by `pnpm harness:split`. Other projects pull
  this branch with `git subtree`.
- `db/*` (planned, no plan written yet): one commit each on `main` for Supabase, Prisma + SQLite and
  PocketBase wiring with their guardrails.

## Known limitations

- It was tried in agent sessions on three real projects: a `create-next-app` project, a Makerkit app and
  a Turborepo with 710 legacy files. Of 29 blocks, 4 were false, and those four rules were fixed. That
  is a first measurement, not a track record; keep reading the block log, and say so rather than work
  around a wrong block. Every one of those sessions was Claude Code. The Codex hooks are covered by unit
  tests only.
- The legacy rule is per file. Touching an old file makes all of its old lint, format and type findings
  block, which can turn a one-line change into a larger one.
- The full lint step has a 120 s limit. On a loaded machine a large app reached it, though the lint
  alone took 33 s.
- Content rules are mostly regular expressions; the duplicate check is the only syntax-tree rule.
- The fast gate was measured at about 1.6 s per edit on the empty template, not on a large project.
- The `oxc` tool set runs oxlint without `--type-aware`, because oxlint-tsgolint is not installed
  where it was measured. Type-aware rules such as `no-floating-promises` do not run there. oxlint's
  default rules also miss `any`; a project enables the rules it wants in its locked `.oxlintrc.json`.
- The legacy list in CI: CI has no `legacy-append` check, so once a longer list is committed (which
  needs the user's unlock) CI tolerates harness-rule findings on the newly listed file; tool findings
  there still fail. On the default branch itself CI compares with HEAD, so a legacy file changed by a
  direct push is judged by the pre-push gate, not after the push. A new test file in an adopted app's
  own `tests/` folder fails the audit (`unknown-root`, `folder-size`); the list covers the old ones only.
- Shell guards match the command's text. A command built through a variable
  (`SB=supabase; $SB db push`) passes them. Text that merely quotes a guarded command, such as an
  `echo` or a script holding it, is denied; mark such a block false.
- The harness keeps its task and shell state in `.git/harness`. A command that names that folder,
  even to read it, is denied (`harness-state`), and file tools cannot write under `.git/`. That guard
  ignores prose: a quoted string with whitespace, unless it follows an interpreter's `-c`, `-e` or
  `--eval` or holds a command substitution (so the heredoc form `git commit -m "$(cat <<'EOF' …)"` is
  still denied). The Supabase, Prisma and force-push guards keep matching quoted text, because the
  program that receives a quoted string can execute it (`ssh`, `hc run`, `xargs`). A shell can still
  reach the state folder indirectly (`cd .git; cd harness`, a symlink, a variable, a script), and a
  command can feed the hook a forged prompt event, which re-pins the applied migrations. Pre-push and
  CI run the full gate, but CI does not check migrations, so for migrations the hooks are the only
  check. A Stop whose task file is gone uses the copy the last shell command took; with no copy either,
  it judges every path that differs from HEAD plus the commits since the upstream. A clean tree with
  no such commits passes, and the next task starts fresh.
- After a shell command, the lock check reports a locked file only while it differs from HEAD. A
  locked file edited and committed in the same command therefore passes. The migration check compares
  with the applied version (upstream, remote default branch, else the task's start) and catches that case, but CI does not check migrations, and
  `cli.ts check done` run by hand compares with HEAD.
- Without `src/`, the `depcruise` and `jscpd` package scripts init writes name the source paths that
  exist at that moment, and `shared` with `--starter`, because both tools fail on a missing path. Add
  `modules` to them once it exists; the gates work out the paths themselves on every run. A new app
  under `apps/*` is judged with `src/` until git lists a file under its `app/` folder.
- The layout follows the files git lists under `app/` and `src/app/`. The Write tool cannot switch it,
  but a shell command that moves or creates files there can (`git mv src/app app`). The full audit then
  reports every file left in the other layout.
- In a project with `src/`, a root-level `modules/` or `shared/` folder is possible only through
  `root.entries` or the legacy list. dependency-cruiser then applies its rules to imports of it, Vitest
  runs test files in it, and knip takes `shared/lib/` helpers there as entries.
- A `package` workspace runs no depcruise, knip or jscpd. Import cycles, unused exports and duplicated
  code inside a package are therefore not checked, and domain purity there is a lint rule only. A
  package's server components may import `src/server/`; only files with `"use client"` are stopped. A
  kept ESLint config that takes its base rules from another package is recognised only after an
  install, when that package sits in `node_modules`: if ESLint reports a plugin defined twice, add
  `base: false` to the printed line.
- In a monorepo the knip preset names a tool's config and script binary when the workspace's
  `package.json` does not list the tool and a folder above installs it, as create-turbo does with
  Prettier. Vitest must be listed in the workspace itself, as init's install line does, or knip calls
  the test files unused.
- Inside a workspace, denials name paths relative to that workspace: `src/shared/lib/`, not
  `apps/dashboard/src/shared/lib/`. A stray top-level file in a Makerkit app or feature package still gets the
  next-modules advice that application code belongs in `src/`.
- `pnpm install` inside a subtree copy of `tooling/harness/` writes its own `pnpm-lock.yaml`. Whether a
  consumer commits it is not decided yet.
- A cloned project keeps the harness version it was cloned with until the harness ships as a package.
- The user-level Codex hook relies on Codex skipping project hooks in linked worktrees. If a later
  Codex loads them there, remove the user-level entries to avoid a double run.
- Unit tests spawn git and the real tools; on a heavily loaded machine they can exceed their 30 s
  budget.

## Further reading

Texts about harnesses and coding agents that were read in full and agree with how this template works.
Where one of them pulls in a different direction, the line says so.

- **[Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)** (Anthropic docs).
  Keep `CLAUDE.md` short and limited to what the agent cannot learn from the code; "if you keep adding
  emphasis to a `CLAUDE.md` line and Claude still misses it, that's a sign the line belongs in a hook";
  use `command` hooks for rules with zero exceptions, a `PreToolUse` hook to block edits, a `Stop` hook
  that runs the type check and blocks with exit code 2, and `deny` rules for secrets. That is this
  template's division between `AGENTS.md` and the harness. One limit to know: Claude Code ends the turn
  after eight consecutive Stop blocks with no tool call between them; the repair budget here stops at two.
- **[Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)**
  by Birgitta Böckeler (martinfowler.com, 2 April 2026; the
  [February memo](https://www.martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html)
  came first). A harness is guides that steer the agent before it acts and sensors that observe after;
  each is computational (tests, linters, type checkers, structural analysis) or inferential (instructions,
  AI review). "Computational sensors are cheap and fast enough to run on every change", module boundaries
  belong in a pre-commit or agent hook, and linter messages should carry the self-correction. Here the
  guard is the guide, the fast and Done gates are the sensors, and every message says where the code
  belongs. The article asks how to tell a quiet sensor from a missing one; the block log is this
  template's answer. It also treats agent-written rules as normal; here they need the unlock.
- **[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)**
  (Anthropic, 26 November 2025). Agents "mark features as done prematurely" and must self-verify; "it is
  unacceptable to remove or edit tests"; work on one feature at a time and leave the environment clean.
  Here the Done gate replaces the agent's own word, and `AGENTS.md` forbids weakening a check. The post
  is about autonomous multi-session work, broader than one turn in a repository.
- **[Harness design for long-running apps](https://www.anthropic.com/research/harness-design-long-running-apps)**
  (Anthropic, 24 March 2026). Separate the agent doing the work from the one judging it, because agents
  "skew positive when grading their own work"; use hard thresholds; "every component in a harness
  encodes an assumption about what the model can't do on its own", so prefer the simplest solution. The
  gates here are that separate judge, and the block log tests the assumption rule by rule. The post
  argues that an always-on evaluator becomes overhead for tasks within the model's reach; this template
  keeps the gates and measures false blocks instead.
- **[AGENTS.md](https://agents.md/)** (the convention). "A README for agents": setup commands, code style,
  testing instructions; the nearest file wins; it complements the human README. `AGENTS.md` here follows
  it, and `CLAUDE.md` points at it because Claude Code is not on that site's list of readers.

## References

The harness was built against these documents, at the versions pinned above.

- Claude Code hooks: [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
- Codex hooks, including user-level hooks: [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks)
- Next.js, where code runs and how it crosses the client boundary: [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [`next.config.ts`](https://nextjs.org/docs/app/api-reference/config/next-config-js); React [Server Functions](https://react.dev/reference/rsc/server-functions)
- Node 24 running TypeScript directly: [Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- ESLint flat configuration: [Configuration files](https://eslint.org/docs/latest/use/configure/configuration-files); typescript-eslint [typed linting](https://typescript-eslint.io/getting-started/typed-linting/) and [`no-unsafe-type-assertion`](https://typescript-eslint.io/rules/no-unsafe-type-assertion/)
- Import boundaries, dead code and copies: [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [knip](https://knip.dev), [jscpd](https://github.com/kucherenko/jscpd)
- Tests and formatting: [Vitest](https://vitest.dev), [Playwright](https://playwright.dev), [Prettier](https://prettier.io)
- Generated UI: [shadcn CLI](https://ui.shadcn.com/docs/cli)
- Git, for the tree snapshots and the worktree case: [racy-git](https://git-scm.com/docs/racy-git), [git worktree](https://git-scm.com/docs/git-worktree)
- The predecessor this template was ported from: [`@plintcloud/next-harness`](https://www.npmjs.com/package/@plintcloud/next-harness) 0.2.2

## License

[MIT](./LICENSE)
