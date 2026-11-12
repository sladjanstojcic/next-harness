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

The official scaffold (`pnpm create @quick-start/electron`) predates this layout. Give it a legacy list
(`legacy: "tooling/harness-legacy.json"`) and run `legacy init`: it lists `App.tsx` and
`components/Versions.tsx`, the main and preload scripts, `.vscode/`, the two tsconfig projects whose
base turns `noImplicitAny` off, and `electron.vite.config.ts` with its empty preload section. New code is then held to the shape while those files stay where they are.
