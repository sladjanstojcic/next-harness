# A Makerkit project

The kit's code stays the kit's. A file, `tooling/harness-upstream.json`, lists the kit's files. Every file
that is not on it is yours and gets the harness rules, so a new feature package or route is judged without
being named anywhere. The kit's `.oxlintrc.json`, `turbo.json` and other files are not edited by init, and
your kit updates merge as before.

```ts
import { defineHarness } from "./tooling/harness/config.ts";

export default defineHarness({
  workspaces: [
    { path: "apps/web", shape: "makerkit-app", next: true },
    { path: "packages/features/*", shape: "makerkit-feature" },
    { path: "apps/web/supabase", shape: "supabase" },
  ],
  upstream: "tooling/harness-upstream.json",
  legacy: "tooling/harness-legacy.json",
  env: "local",
  locked: [".oxlintrc.json", ".oxfmtrc.jsonc", "turbo.json", "tooling/typescript/base.json", "apps/web/next.config.mjs"],
});
```

- `upstream` names the list of kit files. Write it with
  `node tooling/harness/cli.ts upstream sync <git ref>`, where the ref is the kit's own branch, such as
  `upstream/main`, or the kit commit you last merged. It lists the tracked files that also exist in that
  ref. Run it again after each kit update, so the kit's new files join the list. The list is locked; an agent cannot add its own files.
- Without a ref the command lists every tracked file, and only while no list exists. Use that for a fresh
  kit clone that holds no code of yours yet.
- `owned` is optional here. A prefix in it claims a kit path you have taken over, so the rules apply there.
  Without an `upstream` list, `owned` works the old way: only the listed prefixes are yours.
- `legacy` is for a project that already holds your own code with findings; see [the legacy list](monorepo.md#the-legacy-list).
- `env: "local"` denies only `.env*.local`. The kit commits `.env`, `.env.development` and
  `.env.production`, and they stay writable.
- `locked` adds the kit's own configs to the lock, so an agent cannot loosen the kit's lint either.

The commands are the same as for [a monorepo](monorepo.md), plus the list: subtree add, config, init, install, init
again, `upstream sync`, then `legacy init` when the config names a legacy list. On a real
Makerkit app the list held 1454 kit files of 1691 tracked, the 62 files outside it and outside the
harness were the project's own, and the full gate took 9 seconds. Tracked folders of your own at the
repository root, such as a notes folder, need a line in `root.entries`.

What an agent meets in a Makerkit project:

- **In your paths:** the Makerkit layout (`_components/`, `_lib/server/`, `server/actions/`, `schema/`),
  size limits, no inline disables, package boundaries, and the harness's oxlint rules on top of the kit's.
- **In kit files:** no harness rule. An edit is allowed; a new file in a kit folder is yours and is judged.
  The kit's files do not count towards that folder's size limit. The kit's own type check, lint and tests still
  block when the changed file fails them.
- **In `supabase/`:** a migration that is already on the remote branch cannot be edited, deleted or moved.
  A new migration is allowed. `supabase db push`, `supabase link` and the `supabase:deploy` script are
  denied; applying a schema to a linked project is your step.

The kit's `pnpm format:fix` and `manypkg fix` leave `tooling/harness/` alone: init lists it in
`.prettierignore` and `.eslintignore`, and the harness's `package.json` declares no peers.
