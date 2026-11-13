## Architecture and why

Electron runs three programs with different powers: the main process has Node, the preload script is the bridge, and
the renderer is a web page. The closed layout keeps them apart, so a page never gets Node and there is one answer to
"where does this go?". Denials end with "(Electron layout)".

```text
electron.vite.config.ts, electron-builder.yml, components.json, tsconfig.json, .env.example
build/, resources/      packaging assets
e2e/                    browser tests
src/
  main/                 the Node main process
    index.ts            the entry, and nothing else at this level
    <area>/             one level of area folders (storage/, db/, ipc/): .ts files
  preload/              flat .ts files: the bridge only
  renderer/
    index.html
    src/
      main.tsx, app.tsx, *.d.ts, *.css
      assets/           images, fonts and CSS; no code
      modules/<module>/
        index.ts, types.ts, schemas.ts
        components/     feature UI; one optional area subfolder
        domain/         pure .ts, a test beside each file; one optional area subfolder
        hooks/          flat, use-<name>.ts(x)
      shared/
        ui/             generated shadcn primitives
        components/     composed shared UI; one optional area subfolder
        lib/            renderer helpers; flat
        hooks/          generic React hooks; flat
  shared/               the contract between the three: pure .ts, flat, one optional area folder
```

- The renderer imports no `electron`, no Node built-in and nothing from `src/main/` or `src/preload/`.
- `src/shared/` imports no Electron, Node or React and none of the other three. Main and preload import no renderer
  code and no React. Preload imports only `electron` and `src/shared/`.
- A renderer module has no `server.ts`, `server/` or `actions/`, and is used from outside only through its `index.ts`.
  Renderer `shared/` imports no module. No cycles.
- The aliases are the project's own `paths`: `@/` or `@renderer/` to `src/renderer/src/`, and `@shared/` to
  `src/shared/`. A relative import of `src/shared/` is allowed.
- Area folders are named after their area. `utils`, `helpers`, `common`, `misc`, `shared`, `lib`, `core`, `base`,
  `stuff`, `other` and `general` are denied as area names.
- Names are kebab-case in `src/`, `e2e/`, `tooling/` and `scripts/`; files in the renderer's `assets/` keep the names
  they ship with.
- Vendored, exempt from size limits, and denied to direct edits: `src/renderer/src/shared/ui/` and
  `src/renderer/src/shared/lib/utils.ts`.
- `electron.vite.config.ts`, `electron-builder.yml` and every `tsconfig*.json` are locked with the harness. The audit
  rule `preload-bundle` wants `build: { externalizeDeps: false }` in the `preload` section of
  `electron.vite.config.ts`, since a sandboxed preload script cannot load a package.

## Where code goes

- Need Node, files, a database or the network → put it in an area folder of `src/main/`, such as
  `src/main/storage/client.ts`. A backend package such as `pg` is imported in `src/main/` only, unless the import is
  `import type` (`backend-package`).
- Need the renderer to call the main process → name the channel as a constant in `src/shared/`, with the types both
  sides use; handle it in `src/main/<area>/` with `ipcMain.handle`, and expose it in `src/preload/` with
  `contextBridge`. A channel written as a string where it is used is `ipc-channel`; `ipcRenderer` or `contextBridge`
  outside `src/preload/` is `electron-bridge`.
- Need a screen or feature UI → put it in `src/renderer/src/modules/<module>/components/`, and read the main process
  through the API the preload exposes on `window`.
- Need a pure rule → put it in the module's `domain/` as `.ts`, with `<name>.test.ts` beside it. A rule both sides use
  goes in `src/shared/`.
- Need a hook for one module → put it in the module's `hooks/` as `use-<name>.ts(x)`; a generic hook goes in
  `src/renderer/src/shared/hooks/`.
- Need a renderer helper or composed component → put it in `src/renderer/src/shared/lib/` or `shared/components/`.
- Need environment values → read `process.env` in `src/main/` only, and pass the value on through the contract in
  `src/shared/`. Declare the names in `.env.example`.
- Need logging → console output belongs in a file named `log.ts` in a `src/main/` area folder, such as
  `src/main/logging/log.ts`. Preload and renderer do not log: let the error throw, or send it to main over a channel.
- Need to open a link in the browser → call `shell.openExternal` in one file named `open-external.ts` in a `src/main/`
  area folder (`src/main/links/open-external.ts`), which checks the address first.
- Need a window → keep `nodeIntegration`, `contextIsolation`, `sandbox`, `webSecurity`, `webviewTag` and
  `enableRemoteModule` at their safe defaults. `electron-security` reports each loosened one, a `<webview>` element
  and `@electron/remote`.
- Need UI → build it with Tailwind classes and the shadcn components in `src/renderer/src/shared/ui/`.
- Need a form control, table or dialog → use the shadcn component in `src/renderer/src/shared/ui/`, or add it with
  `pnpm dlx shadcn add <name>`, and customise it in `src/renderer/src/shared/components/`.
- `"use client"`, `"use server"` and `server-only` belong to Next and are reported here.
- Need a browser test → put it in `e2e/`. Need automation → put it in `scripts/`. Packaging assets go in `build/` or
  `resources/`.
