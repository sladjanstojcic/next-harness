---
title: A new project
nav_order: 1
parent: Adopt it
---

# A new project

Start from this template when you have no code yet. You need Node 24 and pnpm.

## 1. Clone and install

```sh
git clone https://github.com/sladjanstojcic/next-harness.git my-product && cd my-product
pnpm install --frozen-lockfile
```

The install must come first. Until `node_modules` exists, the hooks refuse every agent tool call
except the install itself, and say so.

## 2. Enable the pre-push hook

```sh
pnpm run prepare
```

This points git at the `.githooks/` folder. From now on `git push` runs the full check first. Do not
rely on the install to do this for you; run it once by hand.

## 3. Give the project its name

```sh
pnpm rename --name my-product --port 3100 --title "My Product"
```

The script changes three files and nothing else:

- `package.json` gets the name, and its `dev` script becomes `next dev -p 3100`.
- `src/app/layout.tsx` gets the title in its metadata.
- `README.md` gets the title as its first heading.

## 4. Install the test browser and start

```sh
pnpm exec playwright install chromium
pnpm dev
```

The app answers on the port you chose. No secrets are needed; `.env.example` documents the starting
environment.

## 5. Check that everything holds

```sh
pnpm check
```

Every step should pass on a fresh clone: format, lint, types, audit, boundaries, unused code, copies,
unit tests, the production build and the browser smoke test. This is the same command the pre-push
hook and CI run.

## 6. Let the agent in

- **Claude Code:** accept the workspace trust dialog. `.claude/settings.json` wires the hooks.
- **Codex:** trust the project's `.codex/` configuration and review the hooks in `/hooks`. In a
  linked git worktree Codex skips project hooks, so run `pnpm codex:hooks` once to install them at
  user level.

`AGENTS.md` at the root is what the agent reads: the shape, where each kind of code goes and when
the checks run. Edit it as your product grows.

## A first test

Ask the agent for something small, such as "add a `billing` module with a function that formats a
price". Watch where the files land: `src/modules/billing/domain/`, with a test beside the function.
Then run `pnpm harness:blocks` to see whether anything was refused on the way.

Next: [A working day](working-day.md).
