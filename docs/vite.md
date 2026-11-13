---
title: A Vite single-page app
nav_order: 6
parent: Adopt it
---

# A Vite single-page app

A React app built with [Vite](https://vite.dev) runs wholly in the browser and has no server of its
own. It has its own shape, `vite-spa`. The shape gives it what a Next.js project has: a closed folder
layout, import boundaries, content rules, size limits and the same gates. The config file is required
here; the shape is never detected.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [{ path: ".", shape: "vite-spa" }],
});
```

## Adopt it, step by step

Run on a fresh project from create-vite 9.3.4 (`react-ts`), with Vite 8.3.8, React Router 8.5.1 and
TypeScript 7.0.2. It reached a passing check in eighteen steps, without a legacy list.

**Before you start.** Create the app, add the router and commit:

```sh
pnpm create vite@9.3.4 my-app --template react-ts --no-interactive
cd my-app && git init -b main && pnpm install && pnpm add react-router@8
git add -A && git commit -m "Scaffold"
```

1. Add the harness folder. You should see `Added dir 'tooling/harness'`.

   ```sh
   git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
   ```

2. Write `harness.config.ts` at the root, as above. Write it after step 1, which needs a clean tree.
3. `node tooling/harness/cli.ts init`, without `--starter`: this shape has no starter files. It stops:

   ```text
   created pnpm-workspace.yaml: packages tooling/harness
   The harness's own dependencies (zod) are not installed. Next steps:
     1. pnpm install
     2. node tooling/harness/cli.ts init
   ```

4. `pnpm install`.
5. `node tooling/harness/cli.ts init` again. It writes the wiring and prints fourteen steps, which are
   steps 6 to 15 here; step 12 holds five of them. It creates `AGENTS.md` with the harness's rules, 116
   lines here, and a `CLAUDE.md` that imports it. It also prints steps for a CI job; that workflow is
   optional.
6. Run the printed `pnpm add -D` line. Copy it from your terminal; it names exact versions. The template
   has TypeScript 7, whose JavaScript API typescript-eslint cannot use. So the line ends with two aliases,
   and the step explains them:

   ```text
   "typescript@npm:@typescript/typescript6@^6.0.2" typescript-native@npm:typescript@7.0.2
   ```

   The first installs TypeScript 6 under the name `typescript`. The second keeps TypeScript 7 under the
   name `typescript-native`, so `tsc` stays the project's own: `pnpm exec tsc -v` prints `Version 7.0.2`.
   The second alias is printed only when no folder above the workspace holds a TypeScript.

7. Make the change init asks of `tsconfig.node.json`, which has comments, so init does not edit it:

   ```text
   kept tsconfig.node.json: has comments or is not plain JSON; set by hand:
       "exclude": [..., "tooling/harness", "harness.config.ts", "eslint.config.ts", "prettier.config.ts", "vitest.config.ts", "knip.config.ts"]
   ```

   The template has no `exclude` there, so add the key with these names and drop the `...`.

8. Add `"strict": true` to `compilerOptions` in `tsconfig.app.json`.
9. Add `"strict": true` to `compilerOptions` in `tsconfig.node.json`.
10. Remove the template's oxlint, which the ESLint preset replaces: delete `.oxlintrc.json`, set the
    `lint` script in `package.json` to `eslint . --max-warnings 0`, and run `pnpm remove oxlint`.
11. Map `@/` to `src/`. Add `"paths": { "@/*": ["./src/*"] }` to `compilerOptions` in
    `tsconfig.app.json` and `tsconfig.json`, and `resolve: { tsconfigPaths: true }` to the config in
    `vite.config.ts`. shadcn reads the alias from the root `tsconfig.json`.
12. Set up shadcn: printed steps 7 to 11, shown under "shadcn" below.
13. `pnpm exec prettier --write .`, to put the app's own files in the preset's style once. On the
    template it rewrote seven files, among them what shadcn wrote.
14. `git add -A && git commit -m "Add the harness"`
15. `pnpm run check`. It fails, on the template's own code only; seven of ten steps pass. ESLint reports
    the `!` in `src/main.tsx` and the raw `<button>` in `src/App.tsx`, knip reports `react-router` as
    an unused dependency, and the audit reports the template's names:

    ```text
    src/App.css:1 file-name — Use kebab-case file and folder names in src/, e2e/, tooling/ and scripts/; [param] and (group) folders belong only in src/app/ (Vite layout)
    src/App.tsx:1 file-name — Use kebab-case file and folder names in src/, e2e/, tooling/ and scripts/; [param] and (group) folders belong only in src/app/ (Vite layout)
    ```

16. Replace the template's `App.tsx` with routes: `git rm src/App.tsx src/App.css`, then write the three
    files below.
17. `git add -A && git commit -m "Routes in src/app"`
18. `pnpm run check`. Ten steps, each ending in `passed`: prettier, eslint, eslint-preset, tsc, audit,
    depcruise, knip, jscpd, vitest and build. `vite build` writes `dist/`.

`src/app/router.tsx` holds the whole route tree:

```tsx
import { createBrowserRouter } from "react-router";
import Page from "./page";

export const router = createBrowserRouter([{ path: "/", Component: Page }]);
```

`src/app/page.tsx`:

```tsx
export default function Page() {
  return <h1>Ads</h1>;
}
```

`src/main.tsx` mounts the router. It checks for `#root` instead of the template's `!`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "@/app/router";
import "./index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

## shadcn

The lint rule asks for shadcn's components in place of a raw `button` or `input`, and the audit rule
`ui-stack` for `components.json`. Tailwind is not checked, but shadcn needs it, so both come before the
first commit. Init prints five steps for them and runs none:

```text
  7. Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in src/index.css, add tailwindcss() from "@tailwindcss/vite" to the plugins in vite.config.ts, and run pnpm add -D tailwindcss @tailwindcss/vite
  8. Set up shadcn, whose components the lint rule then asks for (init does not run it): pnpm dlx shadcn@latest init -t vite -b base -p nova
  9. Delete the two files shadcn init wrote where the layout takes no code: rm src/components/ui/button.tsx src/lib/utils.ts
  10. Point shadcn at src/shared/, by setting "aliases" in components.json to: { "components": "@/shared/components", "utils": "@/shared/lib/utils", "ui": "@/shared/ui", "lib": "@/shared/lib", "hooks": "@/shared/hooks" }
  11. Add the first component and the cn helper there: pnpm dlx shadcn@latest add button utils
```

`-b base` picks Base UI and `-p nova` the preset this template uses, so shadcn asks nothing. The last
step writes `src/shared/ui/button.tsx` and `src/shared/lib/utils.ts`. In a workspace below the root,
such as `apps/web`, each command is printed inside `(cd apps/web && ...)` and each path from the root;
that form ran as printed too. The full check there then fails at jscpd, a
[known limitation](limitations.md) unrelated to shadcn.

## The shape

```text
index.html, vite.config.ts, components.json, every tsconfig*.json, the tool configs, .env.example
public/                    static files
e2e/                       browser tests, kebab-case
src/
  main.tsx, *.d.ts, *.css  the entry mounts the router
  assets/                  images, fonts and CSS; no code
  app/
    router.tsx             the whole route tree (createBrowserRouter)
    page.tsx, layout.tsx, error.tsx, not-found.tsx
    <segment>/, [param]/, (group)/   one folder per route: those four files and nested routes
  modules/<module>/
    index.ts, types.ts, schemas.ts
    components/            one optional area subfolder
    domain/                pure .ts, a test beside each file, one optional area subfolder
    hooks/                 flat, use-<name>.ts(x)
    data/                  calls to the backend; .ts, one optional area subfolder
  backend/                 the backend client and the generated types; flat .ts
  shared/                  ui/ (generated shadcn), components/, lib/, hooks/
```

- A module has one public entry, `index.ts`, which may export data functions. It has no `server.ts`,
  `server/` or `actions/`: the app has no server. Every denial ends with "(Vite layout)".
- `src/shared/ui/`, `src/shared/lib/utils.ts` and the generated types in `src/backend/` (`*.types.ts`,
  `*-types.ts`, such as `database.types.ts` or `pocketbase-types.ts`) are vendored. They pass the size
  limit, and the Write tool does not edit them: regenerate them through the shell.
- **Boundaries.** `src/backend/` is imported only from a module's `data/`, and with `import type` in a
  module and in `src/app/`, since a type holds no connection. `src/backend/` imports no module, route or
  React. `src/shared/` imports no module, route or backend. `domain/` imports no React, and from the
  backend only its types. A module is used from outside only through `index.ts`. No Node built-in
  anywhere under `src/`, and no cycles.
  The ESLint preset (`layout: "spa"`) and a dependency-cruiser preset both hold these.
- **Content rules.** `import.meta.env` is read only in `src/shared/lib/env.ts`, which validates it
  with Zod (`env-access`). `process.env` under `src/` is reported, since Vite gives the browser none.
  `"use server"`, `"use client"` and `server-only` are reported: they belong to Next. Console output
  belongs in `src/shared/lib/log.ts`. A page keeps the 60-line limit, and a domain file its test.
- **Gates.** ESLint, Prettier, tsc, Vitest, depcruise, knip and jscpd, and `vite build` in CI. There is
  no Next type generation and no browser smoke test, and `next: true` is refused. The tsc step checks
  each project the root `tsconfig.json` refers to, and `tsconfig-strict` judges each. Init's
  `vitest.config.ts` merges `vite.config.ts`, and runs only `src/**/*.test.{ts,tsx}`. knip's hints for
  `src/main.tsx` and `vite.config.ts` do not fail the step.
- **The lock** also covers `vite.config.ts` and every `tsconfig*.json`. `index.html` stays open.

## A backend

Run on the same project with PocketBase, after `pnpm add zod pocketbase`. The client lives in
`src/backend/`, a module calls it from `data/`, and the environment is read in one file:

```ts
// src/shared/lib/env.ts
import { z } from "zod";

export const env = z.object({ VITE_POCKETBASE_URL: z.url() }).parse(import.meta.env);

// src/backend/client.ts
import PocketBase from "pocketbase";
import { env } from "@/shared/lib/env";

export const pb = new PocketBase(env.VITE_POCKETBASE_URL);
```

`src/modules/ads/data/list-ads.ts` imports `pb` from `@/backend/client` and the row type with
`import type`. Declare the variable's name in `.env.example`. Every `VITE_*` value is public: Vite
writes it into the built bundle. A service key never gets that prefix; it belongs to the backend.

A component that imports the package itself is reported, and the check fails (`backend-package`):

```text
src/modules/ads/components/ad-list.tsx:1 backend-package — Import a backend package only in src/backend/, which holds the one client; elsewhere import that client, or the package's types with "import type" (Vite layout)
```

The rule knows a built-in list of packages: `@supabase/`, `pocketbase`, `appwrite`, `node-appwrite`,
`convex`, `@prisma/`, `drizzle-orm`, `pg`, `postgres`, `mysql2`, `mongodb`, `mongoose`,
`better-sqlite3`, `@libsql/client`, `@neondatabase/serverless`, `redis`, `ioredis` and `@upstash/`. A
backend package not on it is not seen until you add it to `backendPackages` in `harness.config.ts`,
such as `backendPackages: ["firebase"]`. An entry is a package name, whose subpaths match too, or a
scope ending in `/`. A type-only import, a test file and code outside `src/` pass.

## Limits

- A backend package that is neither built in nor in `backendPackages` is not seen.
- `env-access` sees `import.meta.env`, `import.meta["env"]` and `const { env } = import.meta`, not an
  alias such as `const m = import.meta; m.env`.
- Init's `vitest.config.ts` merges a `vite.config.ts` that exports an object, as create-vite writes it.
  A config written as a function, such as `defineConfig(({ mode }) => ...)`, fails with "Cannot merge
  config in form of callback": call that function in `vitest.config.ts` by hand.
- Where two workspaces cover the same folder, a config there is locked when either workspace's shape
  locks it, not only the shape of the workspace the folder belongs to.

More in [Known limitations](limitations.md).
