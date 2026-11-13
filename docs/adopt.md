---
title: Adopt it
nav_order: 5
---

# Adopt it

There are two ways in. A new project starts from this template. An existing project adds one folder,
`tooling/harness/`, and keeps everything it has.

## Pick your guide

| Your project                 | Guide                                      |
| ---------------------------- | ------------------------------------------ |
| Nothing yet                  | [A new project](new-project.md)            |
| Existing Next.js app         | [An existing Next.js project](next-app.md) |
| Turborepo or other monorepo  | [A monorepo](monorepo.md)                  |
| Electron app (electron-vite) | [An Electron project](electron.md)         |
| Vite single-page React app   | [A Vite single-page app](vite.md)          |
| Makerkit project             | [A Makerkit project](makerkit.md)          |

Each guide also starts from nothing: it names the command that creates such a project, and then the
numbered steps, as they were run on a fresh one. A Makerkit walkthrough is not written yet.
[Shared packages](packages.md) covers adding a package to a monorepo afterwards.

Start from a git repository with a commit and a clean working tree.
Every guide for an existing project follows the same three moves. Add the harness folder with
`git subtree`. Run `init`, which writes the wiring and prints the steps that are yours. Finish with
`pnpm run check`. Init installs nothing itself and never replaces a config you already have;
[What init writes](init.md) lists each file.

## Old code and the legacy list

An existing project breaks the rules on its first day. You do not fix all of it before you start.

You run `legacy init` once. It writes a legacy list: the files that have a finding today. Those
files are tolerated. New files are held to every rule, and an old file you touch must clear its
tool findings: types, lint, format and import boundaries. The list may only shrink, so the debt goes
down as work passes through the old code. `node tooling/harness/cli.ts legacy prune` takes the
files that have no finding left off the list. See
[the legacy list](monorepo.md#the-legacy-list).

An app without Tailwind and shadcn gets the `ui-stack` finding on its `package.json`. Run the
Tailwind and shadcn steps init prints before your first commit, or `legacy init` puts that
`package.json` on the list until you do.

## Let the agent in

- **Claude Code:** accept the workspace trust dialog. `.claude/settings.json` wires the hooks.
- **Codex:** trust the project's `.codex/` configuration and review the hooks in `/hooks`.

Init writes the harness's rules for the agent into `AGENTS.md`, below any text of your own, and
makes `CLAUDE.md` import that file for Claude Code. [What init writes](init.md#agentsmd-and-claudemd)
shows each case.

## Update the harness

```sh
git subtree pull --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
node tooling/harness/cli.ts init    # adds wiring the new version needs, refreshes the rules in AGENTS.md
```

Run both in your own terminal. `tooling/harness/` is locked for agents. Until init has run and its
`AGENTS.md` change is committed, the Done gate, the pre-push hook and CI fail with `agents-block`.

A version with the `ui-stack` rule also needs each app's Tailwind and shadcn setup before your next
push. The pre-push hook and CI fail with `ui-stack` on an app without it, and init prints no setup
steps for a project that is already adopted. Run the steps on the app's page:
[Next.js](next-app.md#8-set-up-shadcn), [Vite](vite.md#shadcn) or [Electron](electron.md#shadcn).
With a committed legacy list you may instead add the app's `package.json` to it yourself, after
`pnpm harness:unlock`. `legacy init` refuses while a list exists, and an entry the agent adds is
blocked as `legacy-append`.

## Before you commit to it

Read [Known limitations](limitations.md). The short version: it was tried on a handful of real
projects, all with Claude Code. The Codex hooks are covered by unit tests only.
