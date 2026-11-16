---
title: A Node service
nav_order: 7
parent: Adopt it
---

# A Node service

A long-running HTTP service, such as an API built with [Hono](https://hono.dev), runs its TypeScript
source directly with Node 24: Node strips the types, and there is no build step. It has its own shape,
`node-service`. The shape gives it what the app shapes have: a closed folder layout, import
boundaries, content rules, size limits and the same gates. It names no framework; Fastify or
`node:http` fit the same folders. The config file is required; the shape is never detected.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: "apps/api", shape: "node-service" },
    { path: "packages/*", shape: "package" },
  ],
  root: { entries: ["apps", "packages"] },
});
```

## Adopt it, step by step

Run on a pnpm monorepo with Node 24.19.0 and pnpm 12.4.2: a service in `apps/api` on Hono 4 and
`@hono/node-server` 1, beside a package in `packages/doc` whose `exports` point at its `.ts` source.
The service imports that package by name. It reached a passing check in nine steps, without a legacy
list.

**Before you start.** Each workspace lists `typescript` itself: the harness runs `tsc` from the
workspace's folder. The service's `package.json` has `"type": "module"` and
`"imports": { "#/*": "./src/*" }`, and its `tsconfig.json` the options Node runs TypeScript with:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "esnext",
    "module": "nodenext",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Commit, so the tree is clean.

1. Add the harness folder:

   ```sh
   git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
   ```

   The run copied the folder from this repository's branch instead, as a commit of its own.

2. Write `harness.config.ts` at the root, as above.
3. `node tooling/harness/cli.ts init`. It stops:

   ```text
   updated pnpm-workspace.yaml: packages tooling/harness added, the rest kept
   The harness's own dependencies (typescript, zod) are not installed. Next steps:
     1. pnpm install
     2. node tooling/harness/cli.ts init
   ```

4. `pnpm install`.
5. `node tooling/harness/cli.ts init` again. It writes each workspace's tool configs and prints five
   steps, which are steps 6 to 9 here. For the service it writes `vitest.config.ts` with
   `harnessVitest({ integration: false })`, a `.gitignore` with `*.tsbuildinfo`, and adds
   `allowImportingTsExtensions` to `tsconfig.json` where it is missing.
6. Run the two printed `pnpm add -D` lines, one per workspace. Copy them from your terminal; they name
   exact versions.
7. Format the workspaces once in the preset's style, as printed:
   `(cd apps/api && pnpm exec prettier --write .); (cd packages/doc && pnpm exec prettier --write .)`
8. `git add -A && git commit -m "Add the harness"`
9. `pnpm run check`. Seventeen steps, each ending in `passed`: for the service prettier, eslint,
   eslint-preset, tsc, depcruise, knip, jscpd and vitest, the same for the package, and the audit.
   There is no build step.

A service folder that is not set up for Node yet gets two more printed steps, before the format step:

```text
Make Node load src/ as ES modules and resolve #/ to it (init does not edit apps/api/package.json): add "type": "module" and "imports": {"#/*":"./src/*"}
Set the compiler options Node runs TypeScript with (init does not edit them in apps/api/tsconfig.json): "module": "nodenext", "noEmit": true, "erasableSyntaxOnly": true, "verbatimModuleSyntax": true
```

Each lists only what is missing.

## The service

`src/main.ts` starts the server and stops it on `SIGTERM`. It listens on `0.0.0.0`, which a container
platform such as Coolify needs:

```ts
import { serve } from "@hono/node-server";
import { createApp } from "#/app/app.ts";
import { env } from "#/shared/lib/env.ts";
import { log } from "#/shared/lib/log.ts";

const server = serve({ fetch: createApp().fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  log.info(`listening on ${info.address}:${String(info.port)}`);
});

process.on("SIGTERM", () => {
  server.close();
});
```

`src/app/app.ts` builds the app and mounts each module's routes, one line each, so the URL map is
one file. A test calls `createApp().request("/health")` without opening a port:

```ts
import { Hono } from "hono";
import { adsRoutes } from "#/modules/ads/index.ts";
import { log } from "#/shared/lib/log.ts";

export function createApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.text("ok"));
  app.route("/ads", adsRoutes);
  app.onError((error, c) => {
    log.error("request failed", error);
    return c.json({ message: "Something went wrong. Try again." }, 500);
  });
  return app;
}
```

`src/modules/ads/routes.ts` exports `adsRoutes`, a `new Hono()` with its handlers:
each parses the input, calls the module's `domain/` or `data/`, and answers.

`src/shared/lib/env.ts` is the one file that reads `process.env`, validated with Zod. A backend
client goes in `src/backend/`, created with values from `env`. Create an AI SDK provider there too,
with its key from `env`: a provider created without one reads `process.env` inside `node_modules`,
where no rule sees it.

## The shape

```text
package.json, tsconfig*.json, Dockerfile, Dockerfile.dockerignore, .env.example, the tool configs
src/
  main.ts                entry; worker.ts, an optional second entry
  app/app.ts             createApp(): middleware, error handler, one mount per module
  modules/<module>/
    index.ts, routes.ts, types.ts, schemas.ts
    domain/              pure .ts, a test beside each file, one optional area subfolder
    data/                I/O: backend and model calls, rendering, files; one optional area subfolder
  backend/               the clients and their generated types; flat .ts
  shared/lib/            env.ts, log.ts, cross-cutting helpers; flat
```

- **Paths.** No `.tsx`, `components/`, `hooks/`, `server/` or `actions/`: a service renders no UI.
  `src/app/` takes `app.ts` and its test only. The generated types in `src/backend/` (`*.types.ts`,
  `*-types.ts`) are vendored. Every denial ends with "(Node layout)":

  ```text
  apps/api/src/modules/ads/components/card.ts:1 module-shape — A service renders no UI, so a module has no components/ or hooks/: logic belongs in domain/ and data/ (Node layout)
  ```

- **Imports.** A relative or `#/` import names its `.ts` file, since Node resolves the path as
  written and tsc accepts `./x.js` (`node-import`). An `@/` import is reported: Node applies no
  tsconfig `paths`. A relative import stays inside `src/`; another workspace is imported by name.

  ```text
  apps/api/src/modules/ads/routes.ts:2 node-import — Name the file with its .ts extension (./data/ads.ts): Node runs the TypeScript source and resolves the path exactly as written (Node layout)
  ```

- **Boundaries.** `src/backend/` is imported only from a module's `data/`, and with `import type`
  anywhere. `src/shared/` imports no module, app or backend. A module is used from outside only
  through `index.ts`. No Node built-in in `src/app/`, in a module's `routes.ts`, `index.ts`,
  `types.ts` or `schemas.ts`, or in `domain/`. No React, no cycles. The ESLint preset
  (`layout: "service"`) and a dependency-cruiser preset both hold these.

- **Content rules.** `process.env` only in `src/shared/lib/env.ts` (`env-access`); `import.meta.env`,
  `"use server"`, `"use client"` and `server-only` are reported. Console output belongs in
  `src/shared/lib/log.ts`. `app.ts` and each `routes.ts` stay at most 80 lines (`thin-route`). A
  backend package such as `@supabase/supabase-js` is imported only in `src/backend/`.
- **tsconfig.** `tsconfig-strict` and `tsconfig-node` judge `tsconfig.json` with what it extends: the
  options shown above, and no `paths`. With `erasableSyntaxOnly`, tsc reports an `enum` or a
  parameter property, which Node cannot strip.
- **The lock** covers every `tsconfig*.json` of the workspace, beside the tool configs. The
  `Dockerfile` stays open.

## Integration tests

A test that needs a running backend is named `<name>.int.test.ts`. The gates leave it out, and
`test-determinism` leaves its clock and network alone. Run it with a config of your own, which the
layout takes at the workspace top:

```ts
// vitest.int.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["src/**/*.int.test.ts"], environment: "node" } });
```

With the script `"test:int": "vitest run --config vitest.int.config.ts"`, `pnpm run test:int` ran
the one integration test, and `vitest run` the two unit tests without it.

## A container image

Node does not strip types in files under `node_modules`. `pnpm deploy` copies a workspace package
there, so a service that imports a package's `.ts` source fails in such an image. Keep the workspace
layout instead. This `apps/api/Dockerfile` was built with the repository root as context
(`docker build -f apps/api/Dockerfile .`), and the container answered `/health`:

```dockerfile
FROM node:24.19.0-alpine
RUN npm install --global pnpm@12.4.2
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/doc/package.json packages/doc/
COPY tooling/harness/package.json tooling/harness/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@trial/api..."
COPY packages/doc/src packages/doc/src
COPY apps/api/src apps/api/src
WORKDIR /repo/apps/api
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "src/main.ts"]
```

`apps/api/Dockerfile.dockerignore` holds `**/node_modules` and `.git`. `--ignore-scripts` is needed:
the root `prepare` script init adds runs `git config`, and the image has no git. A dependency whose
install script fetches a native binary, such as `canvas`, then needs `pnpm rebuild <name>` after the
install. In a Turborepo, `turbo prune <app> --docker` gives the same layout with less to copy; it was
not run here.

## Limits

- There is no boot check. An import that tsc resolves and Node does not, beyond a missing `.ts`
  extension, is found only when the service starts.
- A backend package that is neither built in nor in `backendPackages` is not seen.

More in [Known limitations](limitations.md).
