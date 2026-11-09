# Working in next-harness

## What this repository is

A guarded Next.js template, with no product, authentication or database on `main`.
Use Node 24 and pnpm 12.4.2. Dependencies are pinned exactly. Harness code runs as
TypeScript directly through Node; it follows the same rules as application code.

## Architecture and why

```text
src/
  app/                       routes and Next special files; thin composition
  modules/<module>/
    index.ts                 client-safe named exports
    server.ts                server-only named exports
    actions/*-action.ts      public Server Actions, first statement "use server"
    components/              feature UI; one optional area subfolder
    server/                  internal queries and I/O; one optional area subfolder
    domain/                  pure rules with colocated tests; one optional area subfolder
    schemas.ts               Zod schemas
    types.ts                 module types
  shared/
    ui/                      generated shadcn primitives
    components/              composed shared UI; one optional area subfolder
    lib/                     cross-cutting infrastructure; flat
    hooks/                   generic React hooks; flat
tooling/harness/             guards, audit, gates, state and their tests
scripts/                     repository automation
e2e/                         Playwright browser tests
docs/                        review guidance
```

The closed shape prevents helper folders from becoming parallel architectures.
`tooling/harness/structure.ts` defines allowed roots, names and limits for both the
pre-write guard and audit; change that source of truth when a rule must change.

- Use kebab-case file and folder names in `src/`, `tooling/`, `scripts/` and `e2e/`.
  Next route segments are exceptions. Names in docs, public assets and tool config
  folders follow their tools' conventions, including SKILL.md and CODEOWNERS.
- Root config may include `.mcp.json`, `.npmrc`, `.nvmrc`, `.node-version`,
  `.editorconfig`, `.gitattributes`, `LICENSE` and `CHANGELOG.md`. Deployment files
  such as `vercel.json`, `Dockerfile` and `.vscode/` require a deliberate addition
  to `structure.ts` before use.
- Keep files at most 250 lines, including blanks and comments; pages at most 60.
- Keep folders at most 10 source files. Colocated `*.test.ts(x)` files do not count.
- Components, server and domain permit one level of area folders named after the
  area (`server/documents/`, `domain/pricing/`); generic names such as `utils/`,
  `helpers/`, `common/` or `misc/` are denied. Keep actions, shared lib and hooks flat.
  Split a module when responsibility warrants it and report why.
- Use TypeScript everywhere. A tool unable to read TS config needs an explicit
  `JS_EXCEPTIONS` entry in `structure.ts`.
- `shared/` must never depend on modules. Module dependencies must have no cycles.
  Domain code has no React or I/O dependencies and has a test beside each file.
- Generated `shared/ui/` and `shared/lib/utils.ts` are vendored and exempt from size
  limits. Use the shadcn CLI to generate primitives; put custom code in shared/components.
- `proxy.ts`, `instrumentation.ts` and `instrumentation-client.ts` may live beside app/.
  Keep other non-route code out of app/.

## Where code goes

- Need a route → put it in `src/app/`, composing module public APIs.
- Need feature UI → put it in `src/modules/<module>/components/`.
- Need a pure business rule → put it in the module's `domain/` with its test.
- Need a query or I/O → put it in the module's `server/`, with `import "server-only"`.
- Need a mutation callable from a client → put it in `actions/<name>-action.ts`,
  start with `"use server"`, and build it with `shared/lib/define-action.ts`.
- Need a cross-cutting helper → reuse or add it in `src/shared/lib/`.
- Need environment values → validate them in `src/shared/lib/env.ts` with Zod and
  declare their names in `.env.example`. The tool runner passes those shell/CI
  values and every `NEXT_PUBLIC_*` variable, plus its base allowlist in
  `tooling/harness/gates/run-tool.ts`; extend `.env.example` for product variables.
- Need user-facing errors → use `UserError` from `shared/lib/user-error.ts`.
- Need formatting or logging → reuse `shared/lib/format.ts` or `shared/lib/log.ts`.
- Need a generic hook or composed component → use `shared/hooks/` or `shared/components/`.
- Need automation → put it in `scripts/`; harness mechanics belong in `tooling/harness/`.

Tests sit beside their source. Keep unit tests deterministic: no real clock,
randomness or network. Browser smoke tests belong in e2e/.

## Three module public entry points

Other modules and routes import only through `index.ts`, `server.ts`, or
`actions/<name>-action.ts`. List exports by name; never use `export *`.

`index.ts` is client-safe: types, schemas and client components. It must not import
server code or actions. `server.ts` imports `server-only` and exposes queries and
server components. Client components cannot import it or a module's server/ files.

Import Server Actions directly from their `"use server"` action file, never through
index.ts. Next.js pulls a Client Component's imports into its client bundle, while
a dedicated `"use server"` file exposes callable Server Actions across that boundary.
Read the installed guides on server/client components and updating data before
changing these boundaries. SessionStart supplies a code index of public exports,
action files and shared/lib; reuse these before creating helpers.

## Checks and when they run

- PreToolUse blocks disallowed paths, direct secret/lockfile/vendor edits, and named
  destructive shell operations. Denials explain where code belongs.
- PostToolUse on a file runs the fast gate: Prettier writes, syntax lint and the path
  and content audit of that file. Typed ESLint rules and duplicate-export detection run
  in Done and CI. After Bash, only the path and content audit runs on the files changed
  since the pre-command snapshot.
- On a fresh clone without `node_modules`, the hooks deny every tool call except the
  dependency install and say so; run `pnpm install --frozen-lockfile` first.
- Stop runs the Done gate on changes since the user prompt: Next type generation,
  types, lint, audit, imports, unused code, duplicates and related tests. Findings
  outside the blocking scope are reported separately; changed files and affected
  importers block. Scope alone does not prove when a finding was introduced.
- `pnpm check` runs the CI gate: format check, full typed lint, Next type generation,
  types, audit, depcruise, knip, jscpd, all unit tests, production build and browser
  smoke. Every step runs and all failures are reported. Pre-push and GitHub Actions
  call the same gate directly (`node tooling/harness/cli.ts check ci`), so a changed
  package script cannot weaken it. Run `pnpm run prepare` after installation to enable
  `.githooks/`; do not rely on an install rerun invoking lifecycle scripts.
- The harness is locked: `tooling/harness/`, the hook settings, `.githooks/`, `.github/`
  and the tool configs (`tsconfig.json`, `next.config.ts`, ESLint, Prettier, knip, Vitest,
  Playwright, dependency-cruiser, jscpd) cannot be edited, by tool or by shell, until the
  user runs `pnpm harness:unlock` in their own terminal (valid four hours; `pnpm
harness:lock` ends it). Running the unlock yourself is denied. When a harness rule is
  wrong, say so in the handoff instead of working around it.
- Every denial and block is logged under `.git/harness/blocks.jsonl`. `pnpm harness:blocks`
  lists them per rule with a false-block count; marking one false is the user's judgement
  (`pnpm harness:blocks --false <id> "why"`) and is denied to agents. Name a block you
  believe was wrong in your handoff, with its id.
- Task and shell snapshots are kept per agent session, and the Done gate takes a lock
  under `.git/harness/` so parallel agents in one checkout run it one at a time.
- The harness audit command is **`pnpm run audit`**. `pnpm audit` is pnpm's dependency
  vulnerability command and does not run this script.
- Run focused tests while iterating; run the full gate before handing off a branch.
  Review code against `docs/review-rubric.md` as well as automated checks.

Claude Code project hooks require accepting workspace trust. In Codex, trust the
project's `.codex/` configuration and review hooks via `/hooks`; edited hook
definitions require renewed trust. See the official [Claude Code hooks](https://code.claude.com/docs/en/hooks)
and [Codex hooks](https://developers.openai.com/codex/hooks) documentation.

Linked-worktree limitation observed with Codex CLI 0.166.0: project hooks in a
linked worktree were absent from `/hooks`, while the same configuration in a trusted
standalone clone loaded all seven hooks. Codex also loads user-level hooks from
`~/.codex/hooks.json`, in untrusted projects too, so `pnpm codex:hooks` installs the
same hooks there with a command that runs only when `.git` is a file (a linked
worktree) and steps aside everywhere else. Review them once in `/hooks`.

## Repair budget

Each user prompt permits two repair attempts. An identical repeated failure ends
repairs immediately. Each UserPromptSubmit starts a new budget. In the verified
Codex CLI 0.166.0 flow, Stop continuations do not emit UserPromptSubmit and keep
the current budget. When repairs end, report what still fails; never hide failures, weaken
checks, add inline disables, or claim an unrun check passed.

## Next.js documentation

Before writing Next.js code, read the relevant version-matched guide in
`node_modules/next/dist/docs/`. APIs and conventions may differ from remembered
versions. Heed deprecations. This instruction belongs to this repository;
`agentRules: false` disables Next's generated instruction block. Development browser
warnings and errors are forwarded to the terminal through `logging.browserToTerminal`.

## What linters cannot see

Do not add comments that narrate code, speculative options or abstractions, or mock
data in production paths. Ask before adding a dependency. Keep the diff within the
requested scope, preserve existing work, and explain limitations in the handoff.
