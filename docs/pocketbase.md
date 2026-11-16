---
title: A PocketBase backend
nav_order: 7
parent: Adopt it
---

# A PocketBase backend

The hooks and migrations of a [PocketBase](https://pocketbase.io) backend can sit in a folder beside a
Next.js app, in TypeScript that the project's own `tsc` build turns into the JavaScript PocketBase
loads. The folder's shape, `pocketbase`, gives it a closed layout, a lock on applied migrations and two
checks for what PocketBase requires of an entry file. It is switched on in `harness.config.ts`, never
detected. The harness does not build the hooks, start PocketBase or install it.

The steps below were run on macOS on Apple silicon, on a fresh create-next-app 16.4.6 project with
`src/` whose twelve steps of [An existing Next.js project](next-app.md) had passed, with the
PocketBase 0.40.5 binary for darwin arm64. The full check then passed sixteen steps and skipped the
PocketBase test step. An earlier run, on Linux, checked the folder with oxlint and oxfmt.

## The layout

```text
pocketbase/
  pb_hooks/
    <name>.pb.ts          entry files PocketBase loads; flat, kebab-case
    <area>/<name>.ts      code an entry requires; one level of area folders
  pb_migrations/<digits>_<name>.ts   flat; they run in file-name order
  shared/<name>.ts        pure values and types the hooks and the app both read; flat
  types/                  the vendored pocketbase-<version>.d.ts and your own declarations; flat
  tests/<suite>/<name>.test.ts   tests against a running PocketBase
  tsconfig.json, package.json, README.md, .gitignore
```

- Area folders are named after their area (`sessions/`); `utils`, `lib` and the like are denied.
  `pb_migrations/` has no folder-size limit; the vendored `types/pocketbase*.d.ts` has none at all and
  is denied to direct edits.
- `shared/` has no `require`, no PocketBase globals (`$app`, `$os` and the rest) and no Node built-ins,
  so PocketBase and the app can both load it. The app imports nothing else from the folder, and the
  folder nothing from outside it but its tool configs' presets: `pb-boundary`. Ignored `pb_data/` is not judged.

## Before you start

The app passes `pnpm run check`. You have the PocketBase binary from the official release, outside the
repository; the run kept it in `../bin/`, beside the project:

```sh
curl -sSfLO https://github.com/pocketbase/pocketbase/releases/download/v0.40.5/pocketbase_0.40.5_darwin_arm64.zip
curl -sSfLO https://github.com/pocketbase/pocketbase/releases/download/v0.40.5/checksums.txt
grep darwin_arm64.zip checksums.txt | shasum -a 256 -c -
unzip pocketbase_0.40.5_darwin_arm64.zip
```

The check prints `pocketbase_0.40.5_darwin_arm64.zip: OK`. On Linux the zip is `linux_amd64` and the
check `sha256sum -c -`. The zip holds no declarations file.

## 1. Add the workspace to harness.config.ts

Init does not print this step: it sees the folder only once this entry exists. `root.entries` lets the
folder sit at the repository root.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: ".", shape: "next-modules", next: true },
    { path: "pocketbase", shape: "pocketbase" },
  ],
  root: { entries: ["pocketbase"] },
});
```

`harness.config.ts` is locked, creating it too: write it yourself, or with the agent after
`pnpm harness:unlock`. The folder gets ESLint and Prettier; `tools: "oxc"` gives it oxlint and oxfmt.

## 2. Run init

```sh
node tooling/harness/cli.ts init
```

It writes the folder's `eslint.config.ts`, `prettier.config.ts` and `.prettierignore`, and names the
folder in the root's `.prettierignore`. Its first four numbered steps are the folder's, sections 3 to 5 here; 5 holds two:

```text
  1. Install the harness's tools (init does not install): (cd pocketbase && pnpm add -D @eslint/js@9.39.5 jiti@2.7.0)
  2. Give pocketbase/ its own tsconfig.json with "strict": true, "moduleDetection": "legacy" and the folders pb_hooks, pb_migrations, shared and types in "include" (init does not write it).
  3. Copy pb_data/types.d.ts, which PocketBase writes at its first serve, to pocketbase/types/pocketbase-<version>.d.ts.
  4. Declare require for the hooks in pocketbase/types/require.d.ts: declare function require<T = unknown>(path: string): T;
```

The other four are the app's own. Each step is printed only while it is still needed: init run again
once the folder is set up prints only the app's four.

## 3. Install the folder's tools

Run the line init printed; it names exact versions. The folder has no `package.json`, so pnpm used the
root's: in the run both packages went into its `devDependencies`, saved without a range, and no
`pocketbase/package.json` appeared. The folder's ESLint finds them there.

## 4. Give the folder its tsconfig.json and .gitignore

`pocketbase/tsconfig.json`, as run:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleDetection": "legacy",
    "strict": true,
    "skipLibCheck": true,
    "types": [],
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["pb_hooks", "pb_migrations", "shared", "types"]
}
```

`moduleDetection: "legacy"` keeps an entry without `import` or `export` a script, as PocketBase runs it.
`module: "commonjs"` emits the `exports.name = …` form that PocketBase's `require` reads. `"types": []`
keeps the app's `@types/node` out. The harness type-checks the folder with this file, and the audit rule
`tsconfig-strict` holds it to `strict: true`. `pocketbase/.gitignore` holds `pb_data/` and `dist/`.

## 5. Vendor the declarations

PocketBase writes its declarations to `pb_data/types.d.ts` the first time it starts. In `pocketbase/`:

```sh
../../bin/pocketbase serve --dir pb_data --http 127.0.0.1:28090
```

It prints `Server started at http://127.0.0.1:28090`. Stop it with Ctrl+C, copy the file with
`cp pb_data/types.d.ts types/pocketbase-0.40.5.d.ts`, and delete `pb_data/`. Serve before step 6:
this serve reads `pb_hooks/`, where it cannot run an entry still in TypeScript. The file had 24,850
lines and declares no `require`, so `types/require.d.ts` holds the declaration init printed.

## 6. Write an entry, the code it requires, and a migration

`pb_hooks/greetings.pb.ts` is the entry. Its `require` sits inside the handler, typed by its argument:

```ts
routerAdd("GET", "/api/greetings/{name}", (event) => {
  const { greeting } = require<typeof import("./greetings/greeting.js")>(`${__hooks}/greetings/greeting.js`);
  event.json(200, { message: greeting(event.request?.pathValue("name") ?? "") });
});
```

`pb_hooks/greetings/greeting.ts` exports `greeting(name: string): string`, which returns
`` `Hello, ${name}!` ``. `pb_migrations/1763100000_create_notes.ts` creates a collection:

```ts
migrate(
  (app) => {
    const notes = new Collection({ type: "base", name: "notes" });
    notes.fields.add(new TextField({ name: "title", required: true }));
    app.save(notes);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("notes"));
  },
);
```

## 7. Build and start PocketBase

In `pocketbase/`:

```sh
pnpm exec tsc -p tsconfig.json
../../bin/pocketbase serve --dir pb_data --hooksDir dist/pb_hooks --migrationsDir dist/pb_migrations --http 127.0.0.1:28090
```

The build writes the three files to `dist/` in the same folders. With the server up:

```text
$ curl -s http://127.0.0.1:28090/api/greetings/harness
{"message":"Hello, harness!"}
$ curl -s http://127.0.0.1:28090/api/collections/notes/records
{"data":{},"message":"Only superusers can perform this action.","status":403}
```

The 403 shows the migration ran: a collection that does not exist answers 404. Stop the server.

## 8. Format the folder's sources

Run the line init printed: `(cd pocketbase && pnpm exec prettier --write .)`. It skips the vendored
declarations, which the folder's `.prettierignore` names, and the gitignored `dist/` and `pb_data/`;
in the run it changed nothing. The root's Prettier leaves the folder alone.

## 9. Leave the folder out of the app's type check

create-next-app's `tsconfig.json` includes `**/*.ts`, so the app's own `tsc` also checks `pocketbase/`,
with the app's settings and the ignored `pb_data/types.d.ts`. Add `"pocketbase"` to its `exclude`
list. Init does not do this; `tsconfig.json` is locked, so make the change yourself or after the unlock.

## 10. Commit and run the full check

```sh
git add -A && git commit -m "Add the PocketBase backend"
node tooling/harness/cli.ts check ci
```

The folder's steps sit between the app's `tsc` and `audit`, its test step after `vitest`; all other
steps passed. The folder's ESLint leaves `dist/` and `pb_data/` alone:

```text
prettier (pocketbase): passed
eslint (pocketbase): passed
eslint-preset (pocketbase): passed
tsc (pocketbase): passed
test (pocketbase): skipped (no test script)
```

## The two entry rules

PocketBase runs an entry as a script, and each handler in its own VM. The compiler accepts both
mistakes below; PocketBase does not. A top-level `export` in an entry is `pb-entry-module`:

```text
pocketbase/pb_hooks/greetings.pb.ts:1 pb-entry-module — PocketBase loads an entry as a script, not a module: move this into pb_hooks/<area>/ and require it inside the handler; take types through import("...") expressions or ambient declarations in types/ (PocketBase layout).
```

Built and served anyway, PocketBase does not start:
`failed to execute greetings.pb.js: - ReferenceError: exports is not defined`.

A `require` at the top of an entry is `pb-require-scope`:

```text
pocketbase/pb_hooks/greetings.pb.ts:1 pb-require-scope — Call require() inside the handler: PocketBase runs each handler in its own VM, where a value from the file's top level does not exist (PocketBase layout).
```

Built and served anyway, the server starts, and the route answers 400 with
`ReferenceError: greeting is not defined` in the log.

## The lock, denied commands and tests

- A migration the branch's upstream or the remote default branch held when the prompt arrived is
  applied: it cannot be edited, deleted or moved, by tool or by shell. Add a new one instead. The
  rules are those of [the Supabase lock](configuration.md#shapes-without-a-page-of-their-own).
- Rewriting the migration history is your step: `pocketbase migrate down` and
  `pocketbase migrate history-sync` are denied in every project. `migrate up`, `migrate create`,
  `migrate collections`, `serve` and `superuser` stay allowed.
- Tests against a running PocketBase go in `tests/<suite>/<name>.test.ts`. They run in the gates only
  when the workspace entry names a package script, such as `test: "test:pocketbase"`; without it the
  step is skipped. The test step has a twenty-minute limit.

Not run: tests with a `test` script, `shared/`, an agent session in the project, PocketBase on
Windows, and this tool set on Linux; [Known limitations](limitations.md) has the details.
