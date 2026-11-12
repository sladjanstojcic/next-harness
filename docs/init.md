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

## Your own ESLint config

A project's own ESLint, Prettier, Vitest, Knip or Playwright config is never replaced, even with
`--force`. The file stays where it is, init prints the two lines that add the preset to it, and the file
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
from the workspace: init's install line names it when it is not.

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
