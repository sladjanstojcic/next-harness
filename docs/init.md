---
title: What init writes
nav_order: 7
parent: Adopt it
---

# What init writes

`node tooling/harness/cli.ts init [--starter] [--codex-user] [--force]` is safe to run again. It keeps
other keys and hooks, refuses changed harness wiring unless `--force` is given, and never replaces a
config the project already has. A package script of your own under a harness name, such as `check` or
`audit`, also stays: init prints the harness's line for it, and `--force` writes it. The pre-push hook
and CI call the gate directly, so your script changes nothing there.

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
from the project's type check, so ESLint lints those configs without types. A next-modules workspace
whose tsconfig, with the files it extends, maps no `@/*` gets `"@/*": ["./src/*"]` (or `["./*"]`
without `src/`), since the starter files and the content rules use that alias. Where a `baseUrl`
other than the tsconfig's folder is in force, or a file it extends sets other `paths`, init prints the
alias to add by hand instead. A root Next workspace also gets `playwright.config.ts`, which runs only
`e2e/**/*.test.ts`; the CI browser step reports `playwright: skipped` until such a file exists. A `test`
script that does not run Vitest gets no `vitest.config.ts`; init prints the `test: "test"` line for
`harness.config.ts` instead. In a workspace without `src/`, the ESLint config passes
`layout: "app-root"`, the ignore entry is `shared/ui`, and depcruise and jscpd read `app/`, `modules/`
and `shared/`.

**Agent rules.** `AGENTS.md` gets the harness's rules for the agent, and `CLAUDE.md` the line that
brings them to Claude Code; see [below](#agentsmd-and-claudemd).

**Tools.** Init prints one install line: only tools that are missing, or below the minimum the presets
work with. An installed tool at or above the minimum stays, also when newer. The presets import no tool
package; they load each tool from the workspace that calls them.

## AGENTS.md and CLAUDE.md

Init writes the rules the agent reads into `AGENTS.md`, between two marker lines. The block holds the
shape's layout and "where code goes" sections, then the checks, the lock, the repair budget and what
linters cannot see. Every
path and rule in it comes from the shape's code. With several workspaces, the workspaces that use the
same guide share one pair of sections, whose headings name their folders, and one line above the
pairs says that each pair's paths start at those folders. Your own text stays outside the markers:

```text
created AGENTS.md: harness rules
updated AGENTS.md: harness rules appended, your text kept
updated AGENTS.md: harness rules replaced, your text kept
unchanged AGENTS.md: harness rules
```

The first is a project without the file, the second one with its own text. On a project with a
30-line `AGENTS.md` those 30 lines stayed as they were, and the block followed them. The third line
comes after a harness update changed a rule. The block is compared with every run of spaces and line
breaks counted as one, so your own Prettier may rewrap it.

The audit rule `agents-block` keeps the block current. A missing, broken or stale block fails the
audit, and with it the gate:

```text
AGENTS.md:1 agents-block — The harness rules in AGENTS.md are missing or out of date. Run: node tooling/harness/cli.ts init, then commit only AGENTS.md and CLAUDE.md; any other step init prints is the user's.
```

The agent may run init: plain `node tooling/harness/cli.ts init` passes the shell guard while the
harness is locked, and `AGENTS.md` is not locked; `init --force` is denied. That fixes the block. When
init also writes or prints something else, such as wiring a harness update adds, that part is yours,
as the message says. Init prints the Tailwind and shadcn steps only before the commit that adds the
harness, or for a workspace folder no commit has held yet.

Init leaves the file alone when its markers do not form one block, and says what to do:

```text
kept AGENTS.md: holds harness markers that do not form one block; remove the stray marker and rerun init
```

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Init creates `CLAUDE.md` with the one line
`@AGENTS.md`, which imports the other file. Init counts `@AGENTS.md` or `@./AGENTS.md` anywhere in the
text as that import, and a `CLAUDE.md` that is a link to `AGENTS.md` as the file itself. A `CLAUDE.md`
of your own without the import is kept, and its change becomes a printed step:

```text
kept CLAUDE.md: add the line @AGENTS.md so Claude Code reads the harness rules
  2. Make the change each kept file above asks for: CLAUDE.md, tsconfig.node.json
```

Until that line is in, Claude Code works without the harness's rules. Init checks only `CLAUDE.md` at
the root, not `.claude/CLAUDE.md` or a file in a subfolder.

Codex reads `AGENTS.md` itself, up to 32 KiB. Past that, init prints a note:

```text
AGENTS.md is 48307 bytes; Codex stops reading project instructions at 32 KiB (project_doc_max_bytes). Shorten the part outside the harness block.
```

The block sits at the end of the file, so the harness rules are the first part Codex leaves unread.
The note counts the root `AGENTS.md` only. Codex's AGENTS.md page calls the limit the combined size of
the files it reads, so an `AGENTS.md` in a subfolder may count too; with such files, keep the root file
well under 32 KiB.

## Your own ESLint config

A project's own ESLint, Prettier, Vitest, Knip or Playwright config is never replaced, even with
`--force`. The file stays where it is, init prints the lines that add the preset to it, and the file
is locked like init's own:

```js
import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";

export default defineConfig([...nextVitals, ...nextTs, ...harnessEslint({ root: import.meta.dirname, base: false })]);
```

A config that exports a variable has no array to add a spread to. Init then prints two lines
that replace its `export default`. They work for an array and for a single config object, and the
array has a name because Next's lint rules warn on an anonymous default export:

```js
const harnessConfig = [...[nextJsConfig].flat(), ...harnessEslint({ root: import.meta.dirname, toolsFrom: "@repo/eslint-config" })];
export default harnessConfig;
```

Init reads two things from a kept config, from its text and from the packages it imports:

- **The TypeScript base.** A config that brings `typescript-eslint` or `eslint-config-next`, as
  create-next-app's does, gets `base: false`: the preset adds only the harness's rule blocks, since
  ESLint refuses a plugin defined twice.
- **The Next rules.** A config that brings `@next/eslint-plugin-next` or `eslint-config-next` gets the
  preset's base without `next: true`.

The React hook rules need no line of their own. Your config, or `eslint-config-next`, may already
register `eslint-plugin-react-hooks` as `react-hooks`, and ESLint refuses a second copy under that name.
So the preset registers its copy as `harness-react-hooks`, sets `rules-of-hooks` and `exhaustive-deps`
there as errors, and switches off `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`, so each
finding is reported once. Your plugin's other rules stay as you set them. The plugin must be loadable
from the workspace: init's install line names it when it is not. The hook rules hold in next-modules and
package workspaces and in an Electron renderer, not under `e2e/`, `scripts/` and `tooling/`.

An imported package counts through its `package.json` in the workspace's `node_modules`; its
devDependencies count only when it is a workspace package. create-turbo's `@repo/eslint-config` brings
Next's plugin and no `typescript-eslint`, so its apps get the full base without `next`. For such a
package init also prints `toolsFrom: "@repo/eslint-config"`: a tool the workspace does not install
itself, such as `@eslint/js`, is loaded from that package, and init does not ask to install it. A copy
the workspace does install still wins.

**TypeScript 7.** It ships no JavaScript API, which `typescript-eslint` needs. Where a workspace
resolves TypeScript 7 or newer, init's install line adds
`"typescript@npm:@typescript/typescript6@^6.0.2"`: TypeScript 6 under the name `typescript`. That
package's binary is `tsc6`, so `tsc` stays the project's own.

**Turborepo.** With `--starter` and a `turbo.json` at the root, init prints one more step: declare
`NODE_ENV` in `globalEnv`, because the starter `env.ts` reads it. Init does not edit `turbo.json`.

A project's own Prettier config
is kept as it is, with its style.

## The preset check

The lock is what protects a project's lint config. The second line is a check, in CI and in Done when a
tool config, the workspace's `package.json` or `harness.config.ts` changed, that the preset is still
active. One Node process asks the workspace's own ESLint for the config of one freshly named path in
every folder and extension the shape allows code in. Every rule the preset sets on that path must hold as
an error with the harness's options. Otherwise a `preset-missing` finding names the rule and the path.
Two gaps no probe closes: the config file is code and can read the check's arguments, and a rule turned
off only for `.mts` or `.cts` files goes unseen while the shape denies those extensions.
