---
title: harness.config.ts
nav_order: 4
parent: Reference
---

# harness.config.ts

Without a `harness.config.ts` at the repository root, the whole repository is one workspace: the
`next-modules` shape, the `eslint-prettier` tools and Next type generation. The file says where each
shape applies, for a repository with several apps or with kit code. It is locked like the rest of the
harness.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [{ path: ".", shape: "next-modules", next: true }],
  owned: ["src/modules/billing/"],
  legacy: "tooling/harness-legacy.json",
  locked: ["supabase/migrations/"],
  root: { entries: ["supabase", "vercel.json"] },
});
```

## Workspaces

- A workspace path is relative to the root. `./` and a trailing `/` are dropped, and a final `/*` means
  every non-hidden folder under it.
- A file belongs to the workspace with the longest matching path, and its shape sees the path inside
  that workspace. A file in no workspace gets only the root layout rules.
- In a configured workspace `next` defaults to false. `tools` follows the shape: `eslint-prettier` for
  next-modules, package, electron-vite and vite-spa, `oxc` for the Makerkit shapes and e2e, `none` for
  supabase.
- A file that starts a new folder under a `/*` workspace is checked against that workspace's shape
  before the folder exists.
- Upstream files count neither towards a folder's size nor as a duplicate file name. Duplicate exports
  are compared inside one workspace: two apps are two programs.
- A config that fails to load denies every agent tool call with the loader's error. One that fails
  validation names the field. Other hook events allow the call and print the error.

## Owned, upstream and legacy files

Each file has a class; [the reference](reference.md#four-classes-of-file) has the table.

- **Owned.** A file that matches an `owned` prefix, or every file when `owned` is absent.
- **Upstream.** `upstream: "tooling/harness-upstream.json"` turns that around for a kit project. The
  file lists the kit's files, and every file not on it is owned, so a new folder is judged without
  being named anywhere. An `owned` prefix still claims a listed path.
  `node tooling/harness/cli.ts upstream sync <git ref>` writes the list from the tracked files that
  exist in that ref, such as the kit's `upstream/main`; repeat it after a kit update. Without a ref it
  lists every tracked file, once. The list is locked, and a missing or invalid list means every file is
  judged. The steps are on [the Makerkit page](makerkit.md).
- **Legacy.** The files on the list that `legacy` names.
- Harness rules (paths, names, sizes, content) judge owned files only. On legacy files Done, CI and
  `pnpm run audit` report them as pre-existing without failing. Tool findings (types, lint, tests) on
  upstream and legacy files block in Done when the file is changed or affected.
- A lock breach, a growing or invalid legacy list, and a crashed tool always block.

## The legacy list

The legacy list is a ratchet: old code is tolerated, new and touched code is held to the rules.

- In CI a tool finding (format, lint, types, depcruise, knip, jscpd) on a legacy file passes only while
  that file equals its version at the merge base with the remote default branch. Without a remote the
  base is HEAD. On any other file, and without a list, the finding fails.
- A checkout with a remote but without that base commit, such as a shallow CI checkout, fails with
  `legacy-base-failed`. Fetch the default branch (`fetch-depth: 0`).
- The old debt is printed once, as a count per step.
- `node tooling/harness/cli.ts legacy init` writes the list once, from the files that have a harness
  finding or a tool finding today. It runs the tools, so install them first. Commit it; from then on
  it may only shrink.
- `node tooling/harness/cli.ts legacy prune` shortens it to the files that still have a finding. It
  writes nothing while a tool cannot run. Both commands are the user's.
- The list may sit at the root or under an approved folder such as `tooling/`.

[The monorepo page](monorepo.md#the-legacy-list) shows the list on a real project.

## The other fields

- **`locked`** adds paths to the lock, such as a kit's own lint config.
- **`root.entries`** names what may sit at the repository root besides the defaults;
  **`root.jsExceptions`** names root files that may stay JavaScript. Both are described under
  [the root](gates.md#the-root-and-names).
- **`env: "local"`** denies only `.env*.local` and allows the committed `.env`, `.env.development`,
  `.env.production` and `.env.test`. Without it every `.env*` but `.env.example` is denied.
- **`analysis`** lists which of `depcruise`, `knip` and `jscpd` run in Done and CI, in each
  next-modules, package, electron-vite and vite-spa workspace's folder. All three run unless the field
  lists some; none runs in the Makerkit, supabase and e2e shapes.
- **`backendPackages`** adds package names to the list the `backend-package` rule knows; see
  [the reference](reference.md#shapes-and-backend-packages).
- **`tools`** picks the tool set: `eslint-prettier` (ESLint, Prettier, tsc and Vitest, as without a
  config), `oxc` (`oxlint -f json`, `oxfmt --list-different`, the project's `tsc`, Vitest) or `none`.
- **`test: "<package script>"`** runs that script through the project's package manager instead of
  Vitest, in CI and in Done. Done runs the whole script, not only related tests.
- **`next: true`** adds Next type generation, and at the root `next build` and the browser smoke test.

## How a workspace's tools run

- Each workspace's tools run in its own folder, once per gate, and findings name git-root paths.
- A binary is looked up from the workspace folder up to the root. A missing type checker, linter or
  formatter is `<tool>-failed` on the workspace's `package.json`, with the install to run. A missing
  `vitest` skips the test step.
- `next build` and the browser smoke test run only for a Next workspace at the root.
- A failing `test` script is `test-failed` with the end of its output. A failing Vitest run is
  `vitest-failed`, also with the end of its output, where the failed tests are named. A run cut off by
  the time limit starts with "Tool timed out".
- depcruise and jscpd read `src/`. In a next-modules workspace without `src/` they read `app/`,
  `modules/`, `shared/`, `backend/`, `proxy.ts` and `instrumentation*.ts`. With a config file, a
  workspace that has neither `src/` nor `app/` yet skips them (`skipped (no src/)`).
- The tool runner passes on the shell and CI values named in `.env.example`, every `NEXT_PUBLIC_*`
  variable, and its base allowlist in `tooling/harness/core/gates/run-tool.ts`. Extend `.env.example`
  for product variables.

## Shapes without a page of their own

**`supabase`.** The database folder: `migrations/` named `<14 digits>_<name>.sql`, `schemas/NN-name.sql`,
seeds, tests and templates. An applied migration under its `migrations/` cannot be edited, deleted or
moved, by tool or by shell; add a new one with `supabase migration new <name>`.

- Applied means the branch's upstream or the remote default branch held it when the prompt arrived.
  Those commits are pinned, so a push during the task changes nothing. Without either, it means the
  tree the task started from.
- Restoring a migration is not an edit, and the agent's own unpushed migrations stay editable.
- In a repository without a remote, a migration committed in one prompt counts as applied from the next
  prompt on, though no database ran it.
- Applying schema changes to a linked project is the user's step. `supabase db push`, `supabase link`,
  `supabase migration up --linked` and a package runner starting the `supabase:deploy` script are
  denied in every project.

**`e2e`.** A folder of Playwright tests beside the apps, such as `apps/e2e`: browser tests and tests
through the real API.

- Its top takes `package.json`, `playwright.config.ts`, `tsconfig.json`, `.gitignore`, the `.env`
  files, `README*.md`, `AGENTS.md`, `CLAUDE.md` and one folder, `tests/`.
- Directly in `tests/` sit only `<name>.spec.ts` and `<name>.setup.ts`. Everything else goes in a suite
  folder (`tests/checkout/`), which may hold two levels of area folders
  (`tests/access-api/matrix/calls/`).
- Names are kebab-case with one optional role before the extension (`account.po.ts`). `utils/`,
  `helpers/` and the like are denied. Files and folders keep the size limits, and a spec file counts
  towards its folder.
- The tool set is `oxc` or `none`; with `none` the line limit, a lint rule, is not checked. The type
  check needs the workspace's own `tsconfig.json`. The tests run in the gates only with
  `test: "<package script>"`.
- Its `*.spec.ts` and `*.setup.ts` files may use non-null assertions, as `*.test.ts` files may; helpers
  may not. Application tests do not belong in `tooling/`, where no shape judges them.

## Entries and the code index per shape

Knip starts from these entries, and the session-start code index lists these files' exports.

| Shape           | Knip entries                                                                                                                   | Code index                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `electron-vite` | `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx` | `src/shared/`, each renderer module's `index.ts`, the renderer's `shared/lib/` |
| `vite-spa`      | `index.html`, `src/main.tsx`, `vite.config.ts`                                                                                 | `src/backend/`, each module's `index.ts`, `shared/lib/`                        |
