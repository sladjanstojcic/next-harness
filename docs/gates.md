---
title: Guards and gates
nav_order: 5
parent: Reference
---

# Guards and gates

The checks run at five moments; [A working day](working-day.md) walks through them on one task. This
page holds the details an agent or a maintainer needs when one of them refuses.

## Before a write or a command

The PreToolUse hook blocks disallowed paths, direct edits of secrets, the lockfile and vendored files,
committed migrations, and named destructive or deploying shell operations. Each denial explains where
the code belongs instead.

## After a write or a command

- After a file write, PostToolUse runs the fast gate: Prettier writes, syntax lint, and the path and
  content audit of that file.
- Typed ESLint rules and duplicate-export detection run in Done and CI, not here.
- After a shell command, only the path and content audit runs, on the files changed since the snapshot
  taken before the command.

## When the agent says it is done

Stop runs the Done gate on the changes since the user's prompt: Next type generation, types, lint, the
preset check, the audit, imports, unused code, duplicates and related tests.

- Changed files and the files that import them block.
- Findings outside that scope are reported separately and do not block.
- Scope alone does not prove when a finding was introduced.
- Task and shell snapshots are kept per agent session. The Done gate takes a lock under
  `.git/harness/`, so parallel agents in one checkout run it one at a time; see
  [parallel agents](reference.md#parallel-agents).

## Before a push and in CI

`pnpm check` runs the CI gate: format check, full typed lint, preset check, Next type generation,
types, audit, depcruise, knip, jscpd, all unit tests, the production build and the browser smoke test.
Every step runs, and all failures are reported.

Pre-push and GitHub Actions call the same gate directly, as `node tooling/harness/cli.ts check ci`, so
a changed package script cannot weaken it. Run `pnpm run prepare` after an install to enable
`.githooks/`; do not rely on an install rerun invoking lifecycle scripts.

## A fresh clone

On a fresh clone without `node_modules`, the hooks deny every tool call except the dependency install,
and say so. Run `pnpm install --frozen-lockfile` first.

- Only a lone `pnpm` or `npm` `install`, `i` or `ci` passes, optionally after `cd <dir> &&` or
  `corepack`, with a short list of flags such as `--frozen-lockfile`.
- Package names, chained commands, pipes, redirects and substitutions are denied.
- When the missing module is one of the harness's own files, the denial names that file instead. An
  install does not bring it back, so the user restores or creates it.
- During a harness change, create a new file before any file imports it.

## The repair budget

Each user prompt permits two repair attempts at the Done gate. An identical repeated failure ends
repairs at once, and each new prompt starts a new budget. In the verified Codex CLI 0.166.0 flow, Stop
continuations do not emit UserPromptSubmit, the prompt event, and keep the current budget.

## The root and names

`tooling/harness/core/root-layout.ts` defines what may sit at the repository root.

- Root config may include `.mcp.json`, `.npmrc`, `.nvmrc`, `.node-version`, `.editorconfig`,
  `.gitattributes`, `LICENSE` and `CHANGELOG.md`.
- Deployment files such as `vercel.json`, `Dockerfile` and `.vscode/` need a deliberate addition to
  `core/root-layout.ts`, or to `root.entries` in `harness.config.ts`, before use.
- TypeScript is used everywhere. A tool unable to read a TypeScript config needs an entry in
  `JS_EXCEPTIONS` in `core/root-layout.ts`, or in `root.jsExceptions` in `harness.config.ts`.
- File and folder names are kebab-case in `src/`, `tooling/`, `scripts/` and `e2e/`. Next route
  segments are the exception. Names in docs, public assets and tool config folders follow their tools'
  conventions, such as `SKILL.md` and `CODEOWNERS`.

## Hooks in Claude Code and Codex

Claude Code project hooks require accepting workspace trust. In Codex, trust the project's `.codex/`
configuration and review the hooks in `/hooks`; edited hook definitions require renewed trust. See the
official [Claude Code hooks](https://code.claude.com/docs/en/hooks) and
[Codex hooks](https://developers.openai.com/codex/hooks) documentation.

With Codex CLI 0.166.0, project hooks in a linked worktree were absent from `/hooks`, while the same
configuration in a trusted standalone clone loaded all seven hooks. Codex also loads user-level hooks
from `~/.codex/hooks.json`, in untrusted projects too. So `pnpm codex:hooks` installs the same hooks
there, with a command that runs only when `.git` is a file, as in a linked worktree, and steps aside
everywhere else. Review them once in `/hooks`.
