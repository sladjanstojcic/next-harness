---
title: Known limitations
nav_order: 1
parent: Reference
---

# Known limitations

- It was tried on real projects of each kind: `create-next-app` with and without `src/`, a fresh
  `create-turbo` project, an older Turborepo with 710 legacy files, a Makerkit app and two Electron apps. In the agent
  sessions there, 61 denials or blocks were recorded and 4 were false; those four rules were fixed. That
  is a first measurement, not a track record; keep reading the block log, and say so rather than work
  around a wrong block. Every one of those sessions was Claude Code. The Codex hooks are covered by unit
  tests only.
- The `electron-vite` shape was also run on two real projects, an app already laid out this way and the
  official electron-vite scaffold: init's six printed steps, then all ten gate steps passed, with the real
  `electron-vite build`. The first needed no legacy list, the scaffold one of 11 files; both runs predate `preload-bundle` and
  `ui-stack`, which add the scaffold's `electron.vite.config.ts` and `package.json` as a twelfth and thirteenth. In an agent session
  there, nine forbidden attempts were all stopped and none was false. Nothing was opened in a window on
  Windows or macOS, and packaging was not run. In this repository's own tests the build is a stub, since
  Electron is not installed here.
- The `vite-spa` shape was run on a fresh create-vite 9.3.4 project: init's fourteen printed steps, the
  template's `App.tsx` replaced by routes, then all ten gate steps passed, with the real `vite build`.
  It was run again with shadcn, a PocketBase client in `src/backend/` and a module with `data/`; the
  types file was written by hand, and no PocketBase server ran. No agent session has worked there yet.
  A third run added a `vitest.int.config.ts` and two `*.int.test.ts` files: `vitest run` left them
  out, the `test:int` script ran both, and all ten gate steps passed. In a `node-service` the same
  config file is covered by this repository's lint test only, not by a run.
- The `pocketbase` shape was run twice on a fresh create-next-app 16 project: an entry, the module it
  requires and a migration, built with `tsc` and served until the route answered, then the full check
  passed. The first run, on Linux x86-64 with the `oxc` tool set, failed three steps on its first pass:
  oxfmt and oxlint judged the vendored declarations, and the root knip reported the folder. The second,
  on macOS arm64 with ESLint and Prettier, failed one: the folder's ESLint judged the gitignored
  `dist/` and `pb_data/`. Each was fixed before the next pass. Not run: tests with a `test` script,
  `shared/`, an agent session, PocketBase on Windows, ESLint and Prettier on Linux, and the `oxc`
  tool set again since the default changed.
- Init's printed shadcn steps were run as printed on create-next-app with and without `src/`, the
  electron-vite scaffold, create-vite, and a create-vite app at `apps/web` of a pnpm workspace. The
  Tailwind steps for a Next.js app without Tailwind were run as printed on create-next-app made with
  `--no-tailwind` and on create-turbo's two apps; both then passed the full check. On create-next-app
  that needed one more change, not printed: the template's `src/app/page.module.css` fails the layout
  with or without Tailwind, and the run replaced the page. Init prints these steps only before the
  commit that adds the harness, or for a workspace folder no commit has held yet. Not run: Next.js
  with a Prettier config of its own, and a nested Electron workspace. The steps pick Base UI; with
  Radix, knip reports `radix-ui` as unused until app code imports a component, since the knip preset
  knows only `@base-ui/react`.
- The jscpd step of the full check now gets only the folders a workspace has. Before, a workspace
  below the root with `src/`, such as a create-vite app at `apps/web`, failed it with
  `Error: path does not exist: tooling`; the fix is covered by a unit test, not by a new real run.
- jscpd writes its report to `node_modules/.cache/jscpd` in every workspace that is not a Next app.
  Before, a package or another non-Next workspace kept the preset's `.next/jscpd/`, and in a monorepo
  without Next the audit reported `packages/<name>/.next/jscpd/jscpd-report.json` as `unknown-root`.
  Run on a pnpm monorepo with a `node-service` and a `package` workspace: both reports landed in the
  cache.
- The `node-service` shape was run on a pnpm monorepo: a Hono service in `apps/api` beside a package
  whose `exports` point at its `.ts` source. Init's five printed steps, then all seventeen gate steps
  passed; the service answered `/health` under Node 24.19.0 and in a Docker image built from the
  repository root. No Supabase, AI SDK or Fabric code ran, no agent session has worked there, and
  `turbo prune` and Coolify were not tried. In a container, the root `prepare` script init adds
  (`git config core.hooksPath .githooks`) fails without git, so the image installs with
  `--ignore-scripts`.

- By reading the step, not from a run: the Electron shadcn step leaves its empty `vite.config.ts`
  behind when `shadcn init` fails, and replaces a `vite.config.ts` that already exists.
- The `AGENTS.md` block was run on create-vite projects, and written on create-next-app and
  create-turbo: a fresh one, one with its own 30-line `AGENTS.md` and a `CLAUDE.md` without the import, a changed guide, a file past 32 KiB and a stray
  marker. No agent session has read the block on a real project yet. Init checks only the root
  `CLAUDE.md`; a `.claude/CLAUDE.md` is not looked at.
- `backend-package` knows the built-in list and `backendPackages`. A backend package on neither is not
  seen until it is added to `backendPackages`.
- `env-access` follows `import.meta.env`, `import.meta["env"]` and `const { env } = import.meta`. It
  does not follow `import.meta` kept in a variable (`const m = import.meta; m.env`).
- Every `VITE_*` value is public in the built bundle. The harness does not judge which names go in
  `.env.example`; a service key never gets that prefix.
- Where two workspaces cover the same folder, as `apps/*` and `apps/web` do, a tool config there is
  locked when either workspace's shape locks it, not only the shape of the workspace the folder
  belongs to.
- `electron-security` does not follow a shorthand property (`{ sandbox }`), and it reports the same key
  in another library's options in `src/main/`. Of `shell.openExternal` it follows `const { openExternal } = shell`
  and nothing further: not an alias (`const open = shell.openExternal`), not `shell` under another name or written as `shell["openExternal"]`, while any object named `shell` counts as Electron's,
  not a destructuring from `electron` itself. A constant as the address is reported, though it may hold
  a literal. `ipc-channel` does not see a literal passed through a
  generic bridge such as `window.api.invoke("…")`.
- `ui-stack` checks presence only: a `components.json` at an app's top. A bare `components.json` clears
  it without the setup; it reads neither what `components.json` says nor whether Tailwind is installed
  or wired into the CSS and the bundler. Tailwind is set up by init's steps and not checked: a
  `package.json` entry would show that the package is listed, not that it is used, and shadcn cannot be
  set up without Tailwind. Updating an adopted project to a version with the rule fails its next push
  until each app has the setup, or until the user adds the app's `package.json` to a committed legacy list
  ([Update the harness](adopt.md#update-the-harness)). It ran on this repository and in its tests; no
  adopted project has run it yet.
- `preload-bundle` reads the config's text and evaluates nothing. A config built by a function, kept in a
  variable or spread from elsewhere is reported as not visible until the setting is written literally,
  and `externalizeDepsPlugin` imported under another name is not seen. Only the literal `false` passes:
  an options object such as `{ exclude: ["zod"] }` is reported though it bundles that package, since the
  next package would be left out again. A package named in `rollupOptions.external` beside the setting is
  not seen. A config without a `preload` section builds no preload script and passes. It checks the
  setting, not the built file, and nothing here opens a window. `build.externalizeDeps` exists from electron-vite 5.0.0;
  an older version does not know it, so upgrade or put the config on the legacy list.
- In an Electron project knip prints configuration hints for entries its electron-vite plugin also
  finds; they do not fail the step.
- The legacy rule is per file. Touching an old file makes all of its old lint, format and type findings
  block, which can turn a one-line change into a larger one.
- The full lint step has a 120 s limit. On a loaded machine a large app reached it, though the lint
  alone took 33 s.
- With `tools: "none"` on the `e2e` shape the paths, names and folder size are still judged, but the
  250-line limit is not, because that limit is a lint rule. The Playwright tests themselves run in the
  gates only when the workspace names a `test` script, and they need whatever the tests need: a
  running app or database.
- The `e2e` shape on ESLint and Prettier was not run on a real project or in an agent session. It ran
  in a scratch monorepo: a copy of the harness and an `apps/e2e` folder with a Playwright scaffold's
  config and spec, then the real `init` and `check ci`.
  - Without a `tsconfig.json`, the scaffold's own state, ESLint failed on each spec: "was not found by
    the project service".
  - With a `tsconfig.json` that has no `include`, `tsc` failed with TS5097 in `eslint.config.ts`,
    `tooling/harness/config.ts` and the presets, because the compiler follows the config's import
    into the harness.
  - With `"include": ["tests", "playwright.config.ts"]`, lint, format and the preset check passed.
  - Init now prints a step for the first two cases. That step was tested on fixtures, not rerun there.
- The `pocketbase` guards match the binary's name. A project script that wraps it, such as a
  `db:reset` script running `pocketbase migrate down`, is not covered.
- `pb-shared-pure` follows identifiers. A PocketBase global reached through `globalThis.$app` in
  `shared/` is not reported.
- The harness does not add a `pocketbase` workspace to the root `tsconfig.json` `exclude`. Until you
  do, the app's `tsc` also checks the folder, with the app's settings and the ignored
  `pb_data/types.d.ts`; in the run it passed only through `skipLibCheck`.
- Init keeps a `pocketbase` folder out of the root's format check only when the root app uses
  `tools: "eslint-prettier"`. With a root app on `tools: "oxc"`, the root's oxfmt and oxlint also judge
  the folder, its vendored `types/pocketbase-*.d.ts` included. This was not run on a real project.
- `pb-boundary` judges relative specifiers only. An alias or a package name that maps to a
  `pocketbase` workspace, such as a `paths` entry in the app's `tsconfig.json`, is not judged.
- The test step has a twenty-minute limit. In this template most of that time is the harness's own
  tests: about four minutes alone, and close to eleven on a machine that was busy with other agents,
  which passed the earlier ten-minute limit. Past the limit the message starts with "Tool timed out".
- The numbered steps in the guides were run by agents on one Linux server, each on a fresh scaffold. The
  Electron app's window was never opened there, and the browser for the smoke test was already
  downloaded. The Makerkit guide has not been run this way.
- The shadcn rule sees only the seven listed elements. A hand-made layout built from `div` and `nav` passes
  lint; the session-start text and your plan are what hold it. An element made through
  `React.createElement` , a tag kept in a variable or a namespaced tag such as `<motion.button>` is not seen either.
- Content rules are mostly regular expressions; the duplicate check is the only syntax-tree rule.
- The fast gate was measured at about 1.6 s per edit on the empty template, not on a large project.
- The `oxc` tool set, the default only for the Makerkit shapes, runs oxlint without `--type-aware`,
  because oxlint-tsgolint is not installed where it was measured. Type-aware rules such as
  `no-floating-promises` do not run there. oxlint's default rules also miss `any`; a project enables
  the rules it wants in its locked `.oxlintrc.json`.
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
- A new workspace's tool configs are open until its first commit. Within that window an agent can also
  set compiler options the `tsconfig-strict` rule does not read, and a Vitest or Prettier config of its
  own; the ESLint preset check and `strict` are what is enforced.
- `tsconfig-strict` is skipped for a tsconfig whose `extends` cannot be resolved, as before an install;
  `tsc` reports that case itself.
- In a `package` workspace knip runs inside the package and reports every unused export of its entry
  files; the gate then takes out the names another workspace imports from the package. It matches by
  name, so an unused internal export that shares its name with a used public one is not reported, and
  `pnpm knip` run by hand in the package also lists public exports that other workspaces do use. A
  package's server components may import `src/server/` only through `src/server.ts`.
- A kept ESLint config that takes its base rules from another package is recognised only after an
  install, when that package sits in `node_modules`: if ESLint reports a plugin defined twice, add
  `base: false` to the printed line.
- In a monorepo the knip preset names a tool's config and script binary when the workspace's
  `package.json` does not list the tool and a folder above installs it, as create-turbo does with
  Prettier. The same holds for any binary a workspace script runs from a folder above, such as
  `turbo`. Vitest must be listed in the workspace itself, as init's install line does, or knip calls
  the test files unused. In a workspace with `.tsx` files where no file imports React, the preset does
  not report `react` and `@types/react` as unused: JSX with the automatic runtime needs them and
  imports nothing.
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
