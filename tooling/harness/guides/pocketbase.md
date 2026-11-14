## Architecture and why

The server side of a PocketBase backend, in TypeScript; the project's own build emits the JavaScript PocketBase
loads. Its folders are fixed, so the VM finds every entry and migrations run in order. Most denials end with
"(PocketBase layout)".

```text
pb_hooks/
  <name>.pb.ts          entry files PocketBase loads; flat, kebab-case
  <area>/<name>.ts      code an entry requires; one level of area folders
pb_migrations/<digits>_<name>.ts   flat; they run in file-name order
shared/<name>.ts        pure values and types the hooks and the app both read; flat
types/                  the vendored pocketbase-<version>.d.ts and your own declarations; flat
tests/<suite>/<name>.test.ts   tests against a running PocketBase
tsconfig.json, package.json, README.md
```

- An entry has no top-level `import` or `export`: PocketBase runs it as a script, not a module. Take types from
  `import("...")` type expressions or from `types/`.
- In an entry, `require(...)` sits inside a handler: a handler does not see a value required at the top of the file.
- `shared/` has no `require`, no PocketBase globals (`$app`, `$http`, `$os` and the rest) and no Node built-ins, so
  both the VM and the app can load it.
- A migration the branch's upstream or the remote default branch held when the prompt arrived is applied: it cannot be
  edited, deleted or moved, by tool or by shell. Without a remote, every migration in the tree when the prompt arrived
  counts as applied.
- Rewriting the migration history is the user's step: `pocketbase migrate down` and `pocketbase migrate history-sync`
  are denied.
- `types/pocketbase*.d.ts` is vendored: denied to direct edits and exempt from size limits. `pb_migrations/` has no
  folder-size limit.
- The type check uses this folder's own `tsconfig.json`. The tests run in the gates only when the workspace names a
  `test` package script in `harness.config.ts`. Lint-disable and `@ts-` comments are reported.

## Where code goes

- Need a route or an event hook → add an entry `pb_hooks/<name>.pb.ts` and `require` its code from `pb_hooks/<area>/`.
- Need a schema change → add a new migration in `pb_migrations/`; never change an applied one.
- Need a value the app reads too → put it in `shared/<name>.ts`.
- Need a declaration → put it in `types/<name>.d.ts`; the vendored file comes from the PocketBase release.
- Need a test → put it in `tests/<suite>/<name>.test.ts`.
- Need to log → use $app.logger(); console is denied by the lint pass.
