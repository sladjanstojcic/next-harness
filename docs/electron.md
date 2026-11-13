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

Run on a fresh project from the official scaffold. It reached a passing check in thirteen steps from
the committed scaffold, with one file written and six edited by hand.

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
   machine) and run `pnpm install` again. A warning about peer dependencies, here and in step 6, is
   expected and needs no action.
5. `node tooling/harness/cli.ts init` again. It writes the wiring and prints thirteen steps, which are
   steps 6 to 13 here; step 9 holds six of them. It creates `AGENTS.md` with the harness's rules and a
   `CLAUDE.md` that imports it. It adds `src/shared/**/*` to the `include` of `tsconfig.node.json` and
   `tsconfig.web.json`, so the first contract file is type-checked. It also prints steps for a CI job;
   writing that workflow is optional and not one of the thirteen steps.
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

9. Set up shadcn: printed steps 4 to 9, shown under "shadcn" below.
10. `pnpm exec prettier --write eslint.config.mjs`, to put the edited file back in the project's style.
11. `node tooling/harness/cli.ts legacy init`. For the scaffold it lists eleven files: three in
    `.vscode/`, `src/main/index.ts`, `src/preload/index.ts` and `index.d.ts`, `App.tsx`, `main.tsx`,
    `components/Versions.tsx`, `tsconfig.node.json` and `tsconfig.web.json`.
12. `git add -A && git commit -m "Add the harness"`
13. `pnpm run check`. Ten steps, each ending in `passed`: prettier, eslint, eslint-preset, tsc, audit,
    depcruise, knip, jscpd, vitest and build. The old findings follow as a count per tool, the first
    few in full, and a line that says how many more there are.

## shadcn

The lint rule asks for shadcn's components in the renderer, and the audit rule `ui-stack` for
`components.json` and Tailwind, so both come before the first commit. Init prints six steps for them
and runs none. For the scaffold they read:

```text
  4. Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in src/renderer/src/assets/main.css, add tailwindcss() from "@tailwindcss/vite" to the renderer plugins in electron.vite.config.ts, and run pnpm add -D tailwindcss @tailwindcss/vite
  5. Map @renderer/ in tsconfig.json too, where shadcn reads aliases (init does not edit it): add "compilerOptions": { "paths": { "@renderer/*": ["./src/renderer/src/*"] } }
  6. Set up shadcn, whose components the lint rule then asks for (init does not run it); it recognises Vite only by a vite.config file, so the command gives it an empty one for the run: printf 'export default {}\n' > vite.config.ts && pnpm dlx shadcn@latest init -t vite -b base -p nova && rm vite.config.ts
  7. Delete the two files shadcn init wrote where the layout takes no code: rm src/renderer/src/components/ui/button.tsx src/renderer/src/lib/utils.ts
  8. Point shadcn at src/renderer/src/shared/, by setting "aliases" in components.json to: { "components": "@renderer/shared/components", "utils": "@renderer/shared/lib/utils", "ui": "@renderer/shared/ui", "lib": "@renderer/shared/lib", "hooks": "@renderer/shared/hooks" }
  9. Add the first component and the cn helper there, and format what shadcn wrote in the project's own style: pnpm dlx shadcn@latest add button utils && pnpm exec prettier --write src/renderer/src/assets/main.css src/renderer/src/shared/lib/utils.ts
```

shadcn takes a project for Vite only when a file named `vite.config.*` is at its top, and
electron-vite's is `electron.vite.config.ts`. So step 6 creates an empty `vite.config.ts` for the
run of `shadcn init` and deletes it afterwards. That run adds the theme to `main.css` and installs
`@base-ui/react` and the other packages the components import. `-b base` picks Base UI and `-p nova`
the preset this template uses, so shadcn asks nothing. The last step writes
`src/renderer/src/shared/ui/button.tsx`.

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
  project that reads the workspace's top (`tsconfig.node.json`), and `src/shared/**/*` to every project that
  does not read that folder yet. The first automation script, browser test or contract file is then
  type-checked and linted without a change to a locked file.
- **Gates.** ESLint, Prettier, tsc, Vitest, depcruise, knip and jscpd run as in a Next app. CI also runs
  `electron-vite build`. There is no Next type generation and no browser smoke test, and `next: true` is refused; packaging with
  electron-builder stays your step.
- **The lock** also covers `electron.vite.config.ts`, `electron-builder.yml` and every `tsconfig*.json`.
- **Init** keeps your ESLint, Prettier and Vitest configs. For a config that exports a call, such as
  `defineConfig(a, b)`, it prints the spread to add as the last argument:
  `...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false })`; for the scaffold it
  adds `toolsFrom`, as in step 7 above. It writes `knip.config.ts` and `.dependency-cruiser.json`, and
  takes `tooling/harness`, `harness.config.ts` and the configs that import a preset out of the project
  that reads the workspace's top (`tsconfig.node.json`). There are no starter files.
- Console output is allowed in a file named `log.ts` in a `src/main/` area folder, such as
  `src/main/logging/log.ts`, and nowhere else in the app. The lint message says so.
- jscpd writes its report to `node_modules/.cache/jscpd` here, so nothing new needs ignoring.
- **Backend packages.** A database or backend SDK such as `pg` or `@supabase/supabase-js` is imported in
  `src/main/` only; elsewhere the audit reports it as `backend-package`, unless the import is
  `import type`. The list and how to extend it are in [the reference](reference.md#shapes-and-backend-packages).

## The first feature with a channel

Run on the same project: a `notes` module in the renderer that asks the main process for a list. On
the scaffold this is more work than one channel. It touches five files of the legacy list, and a
legacy file you touch must clear its old lint, type and import findings. Three of them have such
findings: `src/main/index.ts`, `src/preload/index.ts` and `src/preload/index.d.ts`. Findings of the
harness's own rules on those files, such as the file name `App.tsx` or `sandbox: false`, stay listed
as pre-existing and do not block.

1. **Write the contract** in `src/shared/`: the channel name as a constant, and the types both sides
   use. The scaffold maps no `@shared/` alias; a relative import of `src/shared/` is allowed. Export
   only what another file imports, also for a type that only another type of the same file uses: knip
   reports it as `knip-types`, and the fix is to drop the word `export`.
2. **Write the handler** in a main area folder, such as `src/main/notes/register-notes-ipc.ts`, with
   `ipcMain.handle(NOTES_LIST_CHANNEL, ...)`. A test beside it is allowed, not required.
3. **Write the module** in `src/renderer/src/modules/notes/`: `index.ts`, the component in
   `components/`, and pure logic in `domain/` with a test beside each file.
4. **Clean `src/main/index.ts`**, which you touch to register the handler. Mark its four floating
   promises with `void`, and move its `console.log` into `src/main/logging/log.ts`. Its
   `sandbox: false` and `shell.openExternal` findings stay as legacy; clearing them is a separate
   change.
5. **Replace the scaffold's bridge.** `src/preload/index.ts` imports `@electron-toolkit/preload`, and
   a preload script may import only `electron` and `src/shared/`. Expose one `api` object of your own,
   typed in `src/shared/`, update `index.d.ts`, read `window.api` in `App.tsx` and `Versions.tsx`, and
   run `pnpm remove @electron-toolkit/preload`. `Versions.tsx` read the versions from that package:
   add a `versions` field to `api`, filled from `process.versions` in the preload. Drop the
   `process.contextIsolated` branch with its `@ts-ignore` lines and expose with `contextBridge` only.
   Neither the preload nor the renderer logs: let an error throw, or send it to main over a channel,
   as the lint message says.
   `ipcRenderer.invoke` returns `any`, and a cast is refused (`no-unsafe-type-assertion`): check the
   value with a guard function kept in `src/shared/`. For the
   scaffold's `'ping'`, either delete the button and its handler, or name the channel in `src/shared/`
   and add a `ping()` to your `api` object.
6. `pnpm run check`, then commit.
7. `node tooling/harness/cli.ts legacy prune`, in your own terminal, then commit the list. It takes the
   files you cleaned off the legacy list; in this run `src/preload/index.ts` and `index.d.ts`, two
   of eleven. From then on they are held to every rule.

If you run the check after steps 1 to 3, it fails on knip, because nothing imports the handler and
the module yet, and on tsc, because `window.api` is still `unknown`. Once you edit
`src/preload/index.ts` and keep its import, the message names the rule and the fix:

```text
src/preload/index.ts:2 no-restricted-imports — '@electron-toolkit/preload' import is restricted from
being used by a pattern. A preload script is the bridge and nothing more: it imports electron and the
contract in src/shared/ (Electron layout)
```

Not checked in this run: the app window was never opened, because the test machine has no screen.
The build passed and the built preload exposes the new channel.
