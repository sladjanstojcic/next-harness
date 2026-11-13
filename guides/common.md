## Checks and the lock

The rules above are enforced; a denial or a finding says where the code goes instead.

- Before a write, the hooks deny a path or name the layout does not take, `.env` files other than `.env.example` (with
  `env: "local"` in `harness.config.ts`, only the `.env*.local` files), `pnpm-lock.yaml` (edit `package.json` and run
  `pnpm install`), vendored files, applied migrations and named destructive or deploying shell commands.
- After a write, the file is formatted, its syntax linted and its path and content audited. After a shell command, the
  files it changed are audited.
- At the end of a turn the Done gate runs types, lint, the audit, import rules, unused code, duplicates and related
  tests on what changed since the prompt. A finding on a changed file or one that imports it blocks.
- Size limits: a file at most 250 lines, counting blanks and comments; a route's `page.tsx` at most 60; a folder at
  most 10 source files, not counting tests beside their source. Vendored, generated files are exempt.
- Run the full gate, the one CI and the pre-push hook run, with `pnpm check`.
- `pnpm run audit` runs the harness audit alone; `pnpm audit` is pnpm's vulnerability check.
- `pnpm exec vitest run <path>` runs one test file; run it in its workspace's folder.
- Tests sit beside their source as `<name>.test.ts(x)`. Keep unit tests deterministic: no real clock, randomness or
  network.
- On a fresh clone the hooks deny every call until `pnpm install --frozen-lockfile` has run.
- The harness is locked: `tooling/harness/`, the hook settings, `.githooks/`, `.github/`, the tool configs,
  `harness.config.ts`, its legacy list and the paths in its `locked` list.
- Only the user opens the lock: `pnpm harness:unlock`, run in their own terminal. Running it yourself is denied.
- When a rule or a block looks wrong, say so in the handoff with the block's id from `pnpm harness:blocks`; do not
  work around it.

## Repair budget

Each user prompt permits two repair attempts at the Done gate. An identical repeated failure ends repairs at once.
When repairs end, report what still fails. Never hide a failure, weaken a check, add an inline disable or claim that
an unrun check passed.

## What linters cannot see

- No comments that narrate code, no speculative options or abstractions, no mock data in production paths.
- Ask before adding a dependency.
- Keep the diff within the requested scope, preserve existing work, and explain limitations in the handoff.

Full rules: <https://sladjanstojcic.github.io/next-harness/>
