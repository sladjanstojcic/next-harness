# Working in next-harness

## What this repository is

A guarded Next.js template, with no product, authentication or database on `main`.
Use Node 24 and pnpm 12.4.2. Dependencies are pinned exactly. Harness code runs as
TypeScript directly through Node; it follows the same rules as application code.

## Architecture and why

```text
src/
  app/                       routes and Next special files; thin composition
  modules/<module>/
    index.ts                 client-safe named exports
    server.ts                server-only named exports
    actions/*-action.ts      public Server Actions, first statement "use server"
    components/              feature UI; one optional area subfolder
    server/                  internal queries and I/O; one optional area subfolder
    domain/                  pure rules with colocated tests; one optional area subfolder
    schemas.ts               Zod schemas
    types.ts                 module types
  shared/
    ui/                      generated shadcn primitives
    components/              composed shared UI; one optional area subfolder
    lib/                     cross-cutting infrastructure; flat
    hooks/                   generic React hooks; flat
tooling/harness/
  cli.ts                     hook, check, audit, blocks, legacy init, init, lock, unlock
  config.ts                  reads harness.config.ts; workspaces and their defaults
  core/                      guards, audit, gates, state, root layout, path classes
  shapes/                    a workspace's paths, names, content rules, size limits
  tools/                     a workspace's formatter, linter, type checker, tests
scripts/                     repository automation
e2e/                         Playwright browser tests
docs/                        review guidance
```

The closed shape prevents helper folders from becoming parallel architectures.
`tooling/harness/shapes/next-modules.ts` defines the folders, names and content
rules inside a workspace, and `shapes/limits.ts` its size limits.
`tooling/harness/core/root-layout.ts` defines what may sit at the repository root.
The pre-write guard and the audit read both; change that source of truth when a
rule must change.

- A project without `src/` keeps the same shape one level up: `app/`, `modules/<module>/`
  and `shared/{ui,components,lib,hooks}/` at the workspace top, with `proxy.ts` and
  `instrumentation*.ts` beside `app/`. That layout applies when the workspace has `app/`
  and no `src/app/`, as create-next-app without `--src-dir` and create-turbo write it;
  every other workspace, an empty one too, uses `src/`. It is read from git, not
  configured: a folder counts once git lists a file under it, tracked or untracked and
  not ignored, so an empty folder from `mkdir` changes nothing and every clone agrees.
  Without `src/`, `src` is not an approved entry, and with it the three folders at the
  top stay denied, so the Write tool cannot switch the layout; a shell command that
  moves or creates files under `app/` or `src/app/` can, and the full audit then reports
  the files left in the other layout. Rules, limits and messages
  are the same and name the layout's own paths; `@/` maps to the workspace top.
- Use kebab-case file and folder names in `src/`, `tooling/`, `scripts/` and `e2e/`.
  Next route segments are exceptions. Names in docs, public assets and tool config
  folders follow their tools' conventions, including SKILL.md and CODEOWNERS.
- Root config may include `.mcp.json`, `.npmrc`, `.nvmrc`, `.node-version`,
  `.editorconfig`, `.gitattributes`, `LICENSE` and `CHANGELOG.md`. Deployment files
  such as `vercel.json`, `Dockerfile` and `.vscode/` require a deliberate addition
  to `core/root-layout.ts`, or to `root.entries` in `harness.config.ts`, before use.
- Keep files at most 250 lines, including blanks and comments; pages at most 60.
- Keep folders at most 10 source files. Colocated `*.test.ts(x)` files do not count.
- Components, server and domain permit one level of area folders named after the
  area (`server/documents/`, `domain/pricing/`); generic names such as `utils/`,
  `helpers/`, `common/` or `misc/` are denied. Keep actions, shared lib and hooks flat.
  Split a module when responsibility warrants it and report why.
- Use TypeScript everywhere. A tool unable to read TS config needs an explicit
  `JS_EXCEPTIONS` entry in `core/root-layout.ts`, or `root.jsExceptions` in
  `harness.config.ts`.
- `shared/` must never depend on modules. Module dependencies must have no cycles.
  Domain code has no React or I/O dependencies and has a test beside each file.
- Generated `shared/ui/` and `shared/lib/utils.ts` are vendored and exempt from size
  limits. Use the shadcn CLI to generate primitives; put custom code in shared/components.
- `proxy.ts`, `instrumentation.ts` and `instrumentation-client.ts` may live beside app/.
  Keep other non-route code out of app/.

## Where code goes

- Need a route → put it in `src/app/`, composing module public APIs.
- Need feature UI → put it in `src/modules/<module>/components/`.
- Need a pure business rule → put it in the module's `domain/` with its test.
- Need a query or I/O → put it in the module's `server/`, with `import "server-only"`.
- Need a mutation callable from a client → put it in `actions/<name>-action.ts`,
  start with `"use server"`, and build it with `shared/lib/define-action.ts`.
- Need a cross-cutting helper → reuse or add it in `src/shared/lib/`.
- Need environment values → validate them in `src/shared/lib/env.ts` with Zod and
  declare their names in `.env.example`. The tool runner passes those shell/CI
  values and every `NEXT_PUBLIC_*` variable, plus its base allowlist in
  `tooling/harness/core/gates/run-tool.ts`; extend `.env.example` for product variables.
- Need user-facing errors → use `UserError` from `shared/lib/user-error.ts`.
- Need formatting or logging → reuse `shared/lib/format.ts` or `shared/lib/log.ts`.
- Need a generic hook or composed component → use `shared/hooks/` or `shared/components/`.
- Need automation → put it in `scripts/`; harness mechanics belong in `tooling/harness/`.

Tests sit beside their source. Keep unit tests deterministic: no real clock,
randomness or network. Browser smoke tests belong in e2e/.

## Three module public entry points

Other modules and routes import only through `index.ts`, `server.ts`, or
`actions/<name>-action.ts`. List exports by name; never use `export *`.

`index.ts` is client-safe: types, schemas and client components. It must not import
server code or actions. `server.ts` imports `server-only` and exposes queries and
server components. Client components cannot import it or a module's server/ files.

Import Server Actions directly from their `"use server"` action file, never through
index.ts. Next.js pulls a Client Component's imports into its client bundle, while
a dedicated `"use server"` file exposes callable Server Actions across that boundary.
Read the installed guides on server/client components and updating data before
changing these boundaries. SessionStart supplies a code index of public exports,
action files and shared/lib; reuse these before creating helpers.

## Workspaces and harness.config.ts

Without a `harness.config.ts` at the repository root, the whole repository is one
workspace: the `next-modules` shape, the `eslint-prettier` tools and Next type
generation. That file lets a repository with several apps or vendored kit code say
where each shape applies. It is locked like the rest of the harness.

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

- A workspace path is relative to the root; `./` and a trailing `/` are dropped, and a
  final `/*` means every non-hidden folder under it. A file belongs to the workspace
  with the longest matching path, and its shape sees the path inside that workspace.
  A file in no workspace gets only the root layout rules from `core/root-layout.ts`.
  In a configured workspace `next` defaults to false and `tools` follows the shape:
  `eslint-prettier` for next-modules and package, `oxc` for the Makerkit shapes, `none` for supabase.
- Each file has a path class. Vendored files are the shape's generated code, such as
  `src/shared/ui/`. Legacy files are listed in the legacy file. Owned files match an
  `owned` prefix, or every file when `owned` is absent. All other files are upstream.
- `upstream: "tooling/harness-upstream.json"` turns that around for a kit project: the
  file lists the kit's files, and every file not on it is owned, so a new folder is
  judged without being named anywhere. An `owned` prefix still claims a listed path.
  `node tooling/harness/cli.ts upstream sync <git ref>` writes the list from the tracked
  files that exist in that ref, such as the kit's `upstream/main`; repeat it after a kit
  update. Without a ref it lists every tracked file, once. The list is locked, and a
  missing or invalid list means every file is judged.
- Upstream files count neither towards a folder's size nor as a duplicate file name.
  Duplicate exports are compared inside one workspace: two apps are two programs.
- A file that starts a new folder under a `/*` workspace is checked against that
  workspace's shape before the folder exists.
- Harness rules (paths, names, sizes, content) judge owned files only. On legacy
  files, Done, CI and `pnpm run audit` report them as pre-existing without failing.
  Tool findings (types, lint, tests) on upstream and legacy files block in Done when
  the file is changed or affected. A lock breach, a growing or invalid legacy list,
  and a crashed tool always block.
- The legacy list is a ratchet: old code is tolerated, new and touched code is held to
  the rules. In CI a tool finding (format, lint, types, depcruise, knip, jscpd) on a
  legacy file passes only while that file equals its version at the merge base with
  the remote default branch (without a remote: at HEAD); on any other file, and
  without a file, it fails. A checkout with a remote but without that base commit, such
  as a shallow CI checkout, fails with `legacy-base-failed`: fetch the default branch
  (`fetch-depth: 0`). The old debt is printed once, as a count per step.
- `node tooling/harness/cli.ts legacy init` writes the legacy list once, from the
  files that have a harness finding or a tool finding today; it runs the tools, so
  install them first. Commit it; from then on it may only shrink.
  The list may sit at the root or under an approved folder such as `tooling/`.
- A config that fails to load denies every PreToolUse call with the loader's error;
  one that fails validation names the field. Other hook events allow and print it.
- Each workspace's tools run in its own folder, once per gate, and findings name
  git-root paths. A binary is looked up from the workspace folder up to the root. A
  missing type checker, linter or formatter is `<tool>-failed` on the workspace's
  `package.json`, with the install to run; a missing `vitest`
  skips the test step. `next build` and the browser smoke run only for a Next
  workspace at the root.
- A workspace with `test: "<package script>"` runs that script through the project's
  package manager instead of Vitest, in CI and in Done. Done runs the whole script, not
  only related tests; a non-zero exit is `test-failed` with the end of the output.
- depcruise and jscpd read `src/`, or `app/`, `modules/`, `shared/`, `proxy.ts` and
  `instrumentation*.ts` in a next-modules workspace without `src/`. With a config file, a workspace that has neither `src/` nor
  `app/` yet skips them (`skipped (no src/)`).

### Shapes, tool sets and the other config fields

- Shapes: `next-modules` (the layout above, at any workspace root), `package` (a shared
  package such as `packages/*` in a Turborepo, described below), `makerkit-app`
  (a Makerkit `apps/web`: `app/[locale]`, `_components/`, `_lib/server/`, `config/`,
  `lib/`), `makerkit-feature` (a package under `packages/features/*` with
  `components`, `hooks`, `schema`, `server/{actions,services,policies}`, `shared`) and
  `supabase` (`migrations/` named `<14 digits>_<name>.sql`, `schemas/NN-name.sql`,
  seeds, tests, templates). Denials in the Makerkit shapes say "(Makerkit layout)".
- A `package` is one module moved out of the app: `src/index.ts` (client-safe) and
  `src/server.ts` (server-only) are its public entries, beside `schemas.ts`, `types.ts`,
  `components/`, `server/`, `domain/` (one area subfolder each) and flat `hooks/`
  (`use-<name>.ts(x)`) and `lib/`. It holds no `actions/`, no `"use server"` and no
  `process.env`: Server Actions and environment values stay in the app, which calls the
  package's `server.ts` and passes values in. Its top level takes configuration only
  (`package.json`, `tsconfig.json`, tool configs, `.json`, `.md`) and no folder but `src/`.
  A relative import from `src/` stays inside `src/`, and `domain/` takes `.ts` only.
  Denials say "(package layout)". ESLint, Prettier, tsc, Vitest, depcruise, knip and
  jscpd run in the package folder. depcruise there forbids cycles, impure `domain/`,
  imports of `src/server/` internals from outside it, and `src/index.ts` reaching server
  code; knip reports an export of `src/index.ts` or `src/server.ts` that no workspace
  imports. A package without `src/` is config-only: no
  tool runs there and init writes nothing into it. JavaScript is denied everywhere in a
  package but for the tool config names; JavaScript that predates the harness, such as
  create-turbo's `packages/eslint-config/*.js`, goes on the legacy list or is converted.
- Tool sets: `eslint-prettier` (ESLint, Prettier, tsc and Vitest, as without a config),
  `oxc` (`oxlint -f json`, `oxfmt --list-different`, project `tsc`, Vitest) and `none`.
- `env: "local"` denies only `.env*.local` and allows the committed `.env`,
  `.env.development`, `.env.production` and `.env.test`. Without it every `.env*`
  but `.env.example` is denied.
- `analysis` lists which of `depcruise`, `knip` and `jscpd` run in Done and CI, in each
  next-modules and package workspace's folder: all three unless listed, never in the
  Makerkit and supabase shapes.
- An applied migration under a supabase workspace's `migrations/` cannot be edited,
  deleted or moved, by tool or by shell; add a new one with
  `supabase migration new <name>`. Applied means the branch's upstream or the remote
  default branch held it when the prompt arrived (those commits are pinned, so a push
  during the task changes nothing); without either, the tree the task started from.
  Restoring it is not an edit, and the agent's own unpushed migrations stay editable.
  In a repository without a remote, a migration committed in one prompt counts as
  applied from the next prompt on, though no database ran it. Applying
  schema changes to a linked project is the user's step: `supabase db push`, `supabase link`, `supabase migration up --linked`
  and a package runner starting the `supabase:deploy` script are denied in every project.
- `pnpm harness:split` creates or moves the local `harness` branch to a
  `git subtree split` of `tooling/harness/`. Another repository consumes it with
  `git subtree add --prefix=tooling/harness <repo> harness --squash`. Pushing the
  branch is the user's step. `tooling/harness/package.json` pins `typescript` and `zod`
  as `npm:` aliases and declares no peers, so a kit's `manypkg fix` leaves it alone.
  `presets/peers.json` lists the tools whose rules `presets/` holds, each with the
  template's version and the minimum the presets work with. Presets import no tool
  package: they load each one from the workspace that calls them.
- `init` writes the thin configs and prints one install line: only tools that are
  missing, at the template's version, or below the minimum. An installed tool at or
  above the minimum stays, also when newer. A project's own Prettier config is kept as
  it is. A kept ESLint config that exports a variable gets two lines that replace its
  `export default`; `base: false` is printed when the config, or a package it imports,
  brings typescript-eslint or `eslint-config-next`, and `next: true` is left out when
  it brings Next's plugin; for an imported package it also prints `toolsFrom`, so the
  preset loads the tools that package brings from there and init does not ask to
  install them. Where a workspace resolves TypeScript 7 or newer, the install line adds
  TypeScript 6 under the name `typescript`, whose JavaScript API typescript-eslint needs. A next-modules workspace whose tsconfig
  chain maps no `@/*` gets that alias on its source root. In a workspace without `src/`
  the thin ESLint config passes `layout: "app-root"`,
  `--starter` copies the helpers to `shared/lib/`, and the depcruise and jscpd scripts
  name the source paths that exist then, with `shared` when `--starter` creates it. A `test` script that does not run Vitest gets no `vitest.config.ts`; init
  prints the `test: "test"` line for `harness.config.ts` instead. The workspace's
  `tsconfig.json` excludes every tool config that imports a preset, so the project's
  type check never enters `tooling/harness/`; ESLint lints those files without types.

## Checks and when they run

- PreToolUse blocks disallowed paths, direct secret/lockfile/vendor edits, committed
  migrations, and named destructive or deploying shell operations. Denials explain
  where code belongs.
- PostToolUse on a file runs the fast gate: Prettier writes, syntax lint and the path
  and content audit of that file. Typed ESLint rules and duplicate-export detection run
  in Done and CI. After Bash, only the path and content audit runs on the files changed
  since the pre-command snapshot.
- On a fresh clone without `node_modules`, the hooks deny every tool call except the
  dependency install and say so; run `pnpm install --frozen-lockfile` first. Only a
  lone `pnpm` or `npm` `install`, `i` or `ci` passes, optionally after `cd <dir> &&`
  or `corepack`, with a short list of flags such as `--frozen-lockfile`. Package
  names, chained commands, pipes, redirects and substitutions are denied. When the
  missing module is one of the harness's own files, the denial names that file instead:
  an install does not bring it back, so the user restores or creates it. During a harness
  change, create a new file before any file imports it.
- Stop runs the Done gate on changes since the user prompt: Next type generation, types,
  lint, preset check, audit, imports, unused code, duplicates and related tests. Findings
  outside the blocking scope are reported separately; changed files and affected
  importers block. Scope alone does not prove when a finding was introduced.
- `pnpm check` runs the CI gate: format check, full typed lint, preset check, Next type generation,
  types, audit, depcruise, knip, jscpd, all unit tests, production build and browser
  smoke. Every step runs and all failures are reported. Pre-push and GitHub Actions
  call the same gate directly (`node tooling/harness/cli.ts check ci`), so a changed
  package script cannot weaken it. Run `pnpm run prepare` after installation to enable
  `.githooks/`; do not rely on an install rerun invoking lifecycle scripts.
- The harness is locked: `tooling/harness/`, the hook settings, `.githooks/`, `.github/`,
  the tool configs (`tsconfig.json`, `next.config.ts`, ESLint, Prettier, knip, Vitest,
  Playwright, dependency-cruiser, jscpd), `harness.config.ts`, its legacy list and the
  paths in its `locked` list cannot be edited, by tool or by shell, until the
  user runs `pnpm harness:unlock` in their own terminal (valid four hours; `pnpm
harness:lock` ends it). Running the unlock yourself is denied. One exception: in a
  workspace folder that no commit has ever held a file in, a new package or app, the workspace's own tool
  configs and `tsconfig.json` may be created and changed, by tool, by shell and by plain
  `node tooling/harness/cli.ts init`; they are locked from the commit that adds the
  workspace. The audit holds every next-modules and package `tsconfig.json` to
  `strict: true` with `noImplicitAny` and `strictNullChecks` left on, no `noCheck`, and
  sources to check (`tsconfig-strict`). When a harness rule is
  wrong, say so in the handoff instead of working around it.
- Every denial and block is logged under `.git/harness/blocks.jsonl`. `pnpm harness:blocks`
  lists them per rule with a false-block count; marking one false is the user's judgement
  (`pnpm harness:blocks --false <id> "why"`) and is denied to agents. Name a block you
  believe was wrong in your handoff, with its id.
- Task and shell snapshots are kept per agent session, and the Done gate takes a lock
  under `.git/harness/` so parallel agents in one checkout run it one at a time.
- The harness audit command is **`pnpm run audit`**. `pnpm audit` is pnpm's dependency
  vulnerability command and does not run this script.
- Run focused tests while iterating; run the full gate before handing off a branch.
  Review code against `docs/review-rubric.md` as well as automated checks.

Claude Code project hooks require accepting workspace trust. In Codex, trust the
project's `.codex/` configuration and review hooks via `/hooks`; edited hook
definitions require renewed trust. See the official [Claude Code hooks](https://code.claude.com/docs/en/hooks)
and [Codex hooks](https://developers.openai.com/codex/hooks) documentation.

Linked-worktree limitation observed with Codex CLI 0.166.0: project hooks in a
linked worktree were absent from `/hooks`, while the same configuration in a trusted
standalone clone loaded all seven hooks. Codex also loads user-level hooks from
`~/.codex/hooks.json`, in untrusted projects too, so `pnpm codex:hooks` installs the
same hooks there with a command that runs only when `.git` is a file (a linked
worktree) and steps aside everywhere else. Review them once in `/hooks`.

## Repair budget

Each user prompt permits two repair attempts. An identical repeated failure ends
repairs immediately. Each UserPromptSubmit starts a new budget. In the verified
Codex CLI 0.166.0 flow, Stop continuations do not emit UserPromptSubmit and keep
the current budget. When repairs end, report what still fails; never hide failures, weaken
checks, add inline disables, or claim an unrun check passed.

## Next.js documentation

Before writing Next.js code, read the relevant version-matched guide in
`node_modules/next/dist/docs/`. APIs and conventions may differ from remembered
versions. Heed deprecations. This instruction belongs to this repository;
`agentRules: false` disables Next's generated instruction block. Development browser
warnings and errors are forwarded to the terminal through `logging.browserToTerminal`.

## What linters cannot see

Do not add comments that narrate code, speculative options or abstractions, or mock
data in production paths. Ask before adding a dependency. Keep the diff within the
requested scope, preserve existing work, and explain limitations in the handoff.
