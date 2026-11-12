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
| Makerkit project             | [A Makerkit project](makerkit.md)          |

Every guide for an existing project follows the same three moves. Add the harness folder with
`git subtree`. Run `init`, which writes the wiring and prints the steps that are yours. Finish with
`pnpm run check`. Init installs nothing itself and never replaces a config you already have;
[What init writes](init.md) lists each file.

## Old code and the legacy list

An existing project breaks the rules on its first day. You do not fix all of it before you start.

The harness writes a legacy list once: the files that have a finding today. Those files are
tolerated. New files and files you touch are held to every rule. The list may only shrink, so the
debt goes down as work passes through the old code. See
[the legacy list](monorepo.md#the-legacy-list).

## Let the agent in

- **Claude Code:** accept the workspace trust dialog. `.claude/settings.json` wires the hooks.
- **Codex:** trust the project's `.codex/` configuration and review the hooks in `/hooks`.

Init does not write an `AGENTS.md` into an adopting project. Copy the sections that apply from
[this template's file](https://github.com/sladjanstojcic/next-harness/blob/main/AGENTS.md).

## Update the harness

```sh
git subtree pull --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
node tooling/harness/cli.ts init    # adds wiring the new version needs; keeps what is already there
```

Run both in your own terminal. `tooling/harness/` is locked for agents.

## Before you commit to it

Read [Known limitations](limitations.md). The short version: it was tried on a handful of real
projects, all with Claude Code. The Codex hooks are covered by unit tests only.
