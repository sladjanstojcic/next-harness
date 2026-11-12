---
title: An Electron project
nav_order: 5
parent: Adopt it
---

# An Electron project

A desktop app built with [electron-vite](https://electron-vite.org) has its own shape, `electron-vite`.
Electron runs three programs with different powers, and the shape keeps them apart. The config file is
required here; the shape is never detected.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [{ path: ".", shape: "electron-vite" }],
});
```

## Adopt it, step by step

Run on a fresh project from the official scaffold. It reached a passing check in twelve steps from
the committed scaffold, with one file written and three edited by hand.

**Before you start.** The project is a git repository with a commit and a clean tree. Starting from
nothing? Create and commit the app first:

```sh
pnpm create @quick-start/electron my-app --template react-ts --skip
cd my-app && git init -b main && git add -A && git commit -m "Scaffold"
```

The scaffold does not make a repository, and you do not need to install yet: step 4 does it.

1. Add the harness folder:

   ```sh
   git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
   ```

2. Write `harness.config.ts` at the root. The scaffold predates this layout, so give it a legacy list:

   ```ts
   import { defineHarness } from "./tooling/harness/config.ts";

   export default defineHarness({
     workspaces: [{ path: ".", shape: "electron-vite" }],
     legacy: "tooling/harness-legacy.json",
   });
   ```

3. `node tooling/harness/cli.ts init`, without `--starter`: this shape has no starter files. It creates
   `pnpm-workspace.yaml` with `tooling/harness` in it, prints the next two steps, and stops.
4. `pnpm install`. On pnpm 11 or newer it stops at `ERR_PNPM_IGNORED_BUILDS` for
   `electron-winstaller`. pnpm has written that key under `allowBuilds` in `pnpm-workspace.yaml` with a
   placeholder text. Replace the text with `false` (`true` if you build Windows installers on this
   machine) and run `pnpm install` again.
5. `node tooling/harness/cli.ts init` again. It writes the wiring and prints seven steps, which are
   steps 6 to 12 here. It also prints steps for a CI job. Writing that workflow is optional and
   not one of the twelve steps; if you do, leave its Playwright line out, since an Electron project has
   no browser smoke test.
6. Run the printed `pnpm add -D` line. Copy it from your terminal; it names exact versions.
7. In `eslint.config.mjs`, add the printed import, and the printed spread as the last argument of
   `defineConfig(...)`, after a comma. For the scaffold the line is:

   ```js
   ...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false, toolsFrom: "@electron-toolkit/eslint-config-ts" }),
   ```

8. In `electron.vite.config.ts`, change `preload: {},` to:

   ```ts
   preload: { build: { externalizeDeps: false } },
   ```

   The reason is under "Preload bundle" below.

9. `pnpm exec prettier --write eslint.config.mjs`, to put the edited file back in the project's style.
10. `node tooling/harness/cli.ts legacy init`. For the scaffold it lists eleven files: three in
    `.vscode/`, `src/main/index.ts`, `src/preload/index.ts` and `index.d.ts`, `App.tsx`, `main.tsx`,
    `components/Versions.tsx`, `tsconfig.node.json` and `tsconfig.web.json`.
11. `git add -A && git commit -m "Add the harness"`
12. `pnpm run check`. Ten steps, each ending in `passed`: prettier, eslint, eslint-preset, tsc, audit,
    depcruise, knip, jscpd, vitest and build. The old findings follow as a count per tool, the first
    few in full, and a line that says how many more there are.

## The shape

```text
electron.vite.config.ts, electron-builder.yml, components.json, tsconfig*.json, the tool configs,
build/ and resources/ (packaging assets), e2e/
src/
  main/                    the Node main process
    index.ts               the entry, and nothing else at this level
    <area>/                one level of area folders (storage/, db/, ipc/): .ts files, tests beside them
  preload/                 flat .ts files: the bridge only
  renderer/
    index.html
    src/
      main.tsx, app.tsx, *.d.ts, *.css
      assets/              images, fonts and CSS; no code
      modules/<module>/    index.ts, types.ts, schemas.ts; components/, domain/, hooks/
      shared/              ui/ (generated shadcn), components/, lib/, hooks/
  shared/                  the contract between the three: pure .ts, flat, one optional area folder
```

- A renderer module follows the rules of a Next module without the server: no `server.ts`, `server/` or
  `actions/`, and flat `hooks/` named `use-<name>.ts(x)`. The aliases are the project's own: whatever
  its tsconfig projects map to `src/renderer/src/` (`@/` or `@renderer/`) and to `src/shared/`
  (`@shared/`). Every denial ends with "(Electron layout)".
- **Boundaries.** The renderer imports no `electron`, no Node built-in and nothing from `main/` or
  `preload/`. `src/shared/` imports no Electron, Node or React and none of the other three. Main and
  preload import no renderer code and no React. Preload imports only `electron` and `src/shared/`. Both
  the ESLint preset (`layout: "electron"`) and a dependency-cruiser preset hold these, so a changed
  ESLint config does not remove them. ESLint judges packages and aliases; dependency-cruiser resolves
  every import, a relative one too, and alone holds cycles and a renderer module used only through its
  `index.ts`. It gets the aliases of `tsconfig.json` and of every project that file refers to, since
  the scaffold keeps `paths` in `tsconfig.web.json`.
- **Content rules.** `electron-security` reports `nodeIntegration: true`, `contextIsolation: false`,
  `sandbox: false`, `webSecurity: false`, `webviewTag: true` and `enableRemoteModule: true` in `src/main/`
  and `src/shared/`, as an object property or as an assignment (`prefs.sandbox = false`); a `<webview>`
  element in the renderer; an import of `@electron/remote` in any file; and `shell.openExternal` with an
  address that is not a plain string, which lets page content start any program registered for a
  protocol. That call belongs in one file that checks the address first, named `open-external.ts` in a
  `src/main/` area folder (`src/main/links/open-external.ts`). Test files are not read, but for the
  import. `electron-bridge` reports
  `ipcRenderer` or `contextBridge` outside `src/preload/`. `ipc-channel` reports a channel written where
  it is used: a string, a template or a concatenation, or a constant of the same file that holds one, as
  the first argument of `ipcMain.handle/handleOnce/on/once`, `ipcRenderer.invoke/send/sendSync/on/once`
  and `webContents.send`. Name channels once in `src/shared/`.
  `"use server"`, `"use client"` and `server-only` are reported everywhere, and `process.env` is read in
  `src/main/` only.
- **Preload bundle.** A sandboxed preload script cannot load a package, and electron-vite leaves every
  package in `dependencies` outside the main and preload bundles. A contract in `src/shared/` that
  imports zod then leaves the window without its bridge, while every other check passes. The audit rule
  `preload-bundle` reads `electron.vite.config.ts` and wants this in it, written literally; it also
  reports `externalizeDepsPlugin()` in the preload section's `plugins`. Init prints the line as a step and
  does not edit the file.

  ```ts
  preload: { build: { externalizeDeps: false } },
  ```

- **Type check.** The project's `tsconfig.json` names no files and refers to `tsconfig.node.json` and
  `tsconfig.web.json`. The tsc step runs `tsc --noEmit -p` for each project it refers to, and the audit
  judges the strictness of each of them. `*.tsbuildinfo` is git-ignored by init, since `tsc` writes one
  beside each composite project. Init adds `scripts/**/*.ts` and `e2e/**/*.ts` to the `include` of the
  project that reads the workspace's top (`tsconfig.node.json`), so the first automation script or browser
  test is type-checked and linted without a change to a locked file.
- **Gates.** ESLint, Prettier, tsc, Vitest, depcruise, knip and jscpd run as in a Next app. CI also runs
  `electron-vite build`. There is no Next type generation and no browser smoke test; packaging with
  electron-builder stays your step.
- **The lock** also covers `electron.vite.config.ts`, `electron-builder.yml` and every `tsconfig*.json`.
- **Init** keeps your ESLint, Prettier and Vitest configs. For a config that exports a call, such as
  `defineConfig(a, b)`, it prints the spread to add as the last argument:
  `...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false })`. It writes
  `knip.config.ts` and `.dependency-cruiser.json`, and takes `harness.config.ts` and the configs that
  import a preset out of the project whose `include` reaches `*.config.ts`. There are no starter files.
- Console output is allowed in a file named `log.ts` in a `src/main/` area folder, such as
  `src/main/logging/log.ts`, and nowhere else in the app. The lint message says so.
- jscpd writes its report to `node_modules/.cache/jscpd` here, so nothing new needs ignoring.

## The first feature with a channel

Run on the same project: a `notes` module in the renderer that asks the main process for a list. On
the scaffold this is more work than one channel. It touches seven files of the legacy list, and a
legacy file you touch must clear its old lint, type and import findings. Three of them have such
findings: `src/main/index.ts`, `src/preload/index.ts` and `src/preload/index.d.ts`. Findings of the
harness's own rules on those files, such as the file name `App.tsx` or `sandbox: false`, stay listed
as pre-existing and do not block.

1. **Let both tsconfig projects read `src/shared/`.** Add `"src/shared/**/*"` to `include` in
   `tsconfig.node.json` and in `tsconfig.web.json`. The scaffold's projects do not read that folder,
   and the first contract file fails with `TS6307` and an ESLint parsing error otherwise. Both files
   are locked for agents, so this step is yours.
2. **Write the contract** in `src/shared/`: the channel name as a constant, and the types both sides
   use. The scaffold maps no `@shared/` alias; a relative import of `src/shared/` is allowed. Export
   only what another file imports: knip reports an unused exported type.
3. **Write the handler** in a main area folder, such as `src/main/notes/register-notes-ipc.ts`, with
   `ipcMain.handle(NOTES_LIST_CHANNEL, ...)`. A test beside it is allowed, not required.
4. **Write the module** in `src/renderer/src/modules/notes/`: `index.ts`, the component in
   `components/`, and pure logic in `domain/` with a test beside each file.
5. **Clean `src/main/index.ts`**, which you touch to register the handler. Mark its four floating
   promises with `void`, and move its `console.log` into `src/main/logging/log.ts`. Its
   `sandbox: false` and `shell.openExternal` findings stay as legacy; clearing them is a separate
   change.
6. **Replace the scaffold's bridge.** `src/preload/index.ts` imports `@electron-toolkit/preload`, and
   a preload script may import only `electron` and `src/shared/`. Expose one `api` object of your own,
   typed in `src/shared/`, update `index.d.ts`, read `window.api` in `App.tsx` and `Versions.tsx`, and
   run `pnpm remove @electron-toolkit/preload`. Drop the `process.contextIsolated` branch with its
   `@ts-ignore` lines and expose with `contextBridge` only. The preload does not log: let an error
   throw. `ipcRenderer.invoke` returns `any`, and a cast is refused
   (`no-unsafe-type-assertion`): check the value with a guard function kept in `src/shared/`. For the
   scaffold's `'ping'`, either delete the button and its handler, or name the channel in `src/shared/`
   and add a `ping()` to your `api` object.
7. `pnpm run check`, then commit.

If you run the check before steps 5 and 6, the messages name the rule and the fix, for example:

```text
src/preload/index.ts:2 no-restricted-imports — '@electron-toolkit/preload' import is restricted from
being used by a pattern. A preload script is the bridge and nothing more: it imports electron and the
contract in src/shared/ (Electron layout)
```

Not checked in this run: the app window was never opened, because the test machine has no screen.
The build passed and the built preload exposes the new channel.
