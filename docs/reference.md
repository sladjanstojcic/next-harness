---
title: Reference
nav_order: 6
---

# Reference

## Four classes of file

Not every file in an adopted project is yours to fix, so each file has a class:

| Class    | Which files                                                       | Harness rules (paths, names, sizes, content) | Tool findings (types, lint, tests) |
| -------- | ----------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| owned    | every file by default; with an upstream list, the files not on it | block                                        | block                              |
| legacy   | on the legacy list                                                | reported as pre-existing                     | block once the file is touched     |
| upstream | on the upstream list: kit code                                    | not applied                                  | block when the file is changed     |
| vendored | generated code, such as `src/shared/ui/`                          | not applied                                  | direct edits are denied            |

## The lock

An agent that can edit the harness can switch it off, so it cannot. Locked: `tooling/harness/`,
`.claude/settings.json`, `.codex/`, `.githooks/`, `.github/`, `tsconfig.json`, `next.config.ts`,
`eslint.config.ts`, `prettier.config.ts`, `.prettierignore`, `knip.config.ts`, `vitest.config.ts`,
`playwright.config.ts`, `.dependency-cruiser.json`, `.jscpd.json` and `harness.config.ts` (creating it
too), the tool configs init writes in each eslint-prettier workspace, plus the legacy list and `locked`
paths that config names. Edits by tool are denied, edits
by shell are reported and block Done, and the unlock command is denied to agents.

A new workspace is the exception, so that an agent can add a package or an app without you. While no
commit has ever held a file in its folder, its own tool configs and `tsconfig.json` may be created and changed, also by
running `node tooling/harness/cli.ts init`. From the commit that adds the workspace they are locked like
the rest. Two checks keep such a workspace honest: the preset check for its ESLint config, and the audit
rule `tsconfig-strict`, which holds every next-modules and package `tsconfig.json` to `strict: true`
with `noImplicitAny` and `strictNullChecks` left on and no `noCheck`, read with the files it extends.
A `tsconfig.json` that names no files to check (`"files": []` and no `include`) is reported too, since
the harness's `tsc` step reads that file.

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
cli.ts              hook <claude|codex> · check <fast|done|ci> · audit · blocks · legacy init · legacy prune · upstream sync · init · lock · unlock
config.ts           defineHarness, loading harness.config.ts, workspaces and the longest-path match
package.json        the harness's own pins (typescript for the compiler API, zod), so the folder works as a subtree
shapes/
  next-modules.ts   the next-modules shape: folders, names, content rules, vendored files
  package.ts        a shared package: one module's layout under src/, configuration at its top
  electron/         an electron-vite app: paths, the content profile and the rules only Electron has
    makerkit/         a Makerkit apps/web with its content rules, and a Makerkit feature package
  e2e.ts            a folder of Playwright tests beside the apps: tests/<suite>/ and its names
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
  package-usage.ts  what other workspaces import from a package, for knip's unused public exports
  root-layout.ts    what may sit at the repository root, and JS_EXCEPTIONS
  path-check.ts     one path check: the root layout, then the file's workspace shape
  classes.ts        owned, upstream, legacy and vendored files, and what each one blocks
  legacy.ts         the shrink-only legacy list, `legacy init` and `legacy prune`
  upstream.ts       the list of kit files and `upstream sync`
  lock.ts           what is locked, and the four-hour unlock
  telemetry.ts      the block log and the false-block marker
  code-index.ts     the public-export index handed over at session start
  hooks/            event parsing for both clients, guards, responses, apply_patch paths
  audit/            path rules, content rules, duplicate exports, the tsconfig check
  gates/            fast, done and ci gates, the tool runner, the repair budget
  state/            tree snapshots, per-session state files and the gate lock under .git/harness/
testing/            disposable git repositories (template, Makerkit, dashboard, create-turbo and Electron fixtures), the
                    decision corpus, the acceptance tests on those miniatures, the lint-config and
                    server-only tests
```

Every file obeys the same rules as application code.

## What is pinned

Next 16.4.5 · React 19.3.1 · TypeScript 6.0.3 (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) ·
Tailwind 4.3.4 · shadcn 4.23.0 · ESLint 9.39.5 with typescript-eslint 8.72.1 and eslint-plugin-react-hooks 7.1.1 · Prettier 3.9.10 ·
Vitest 5.1.0 · Playwright 1.64.1 · knip 6.44.1 · dependency-cruiser 18.7.2 · jscpd 5.4.2 · zod 4.6.7.
Exact versions, no ranges; every config file is TypeScript.

## Branches

- `base`: plain `create-next-app` plus `shadcn init`, the reference point.
- `main`: `base` plus the harness. No database, authentication or product code.
- `harness`: only the contents of `tooling/harness/`, made by `pnpm harness:split`. Other projects pull
  this branch with `git subtree`.
- `db/*` (planned, no plan written yet): one commit each on `main` for Supabase, Prisma + SQLite and
  PocketBase wiring with their guardrails.
