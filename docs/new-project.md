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

The clone still points at the template and carries its history. Before your first push, point it at
your own repository:

```sh
git remote set-url origin <your repository>
```

For a clean history instead, run `rm -rf .git && git init`, and repeat step 2 afterwards.

## 2. Enable the pre-push hook

```sh
pnpm run prepare
```

This points git at the `.githooks/` folder. From now on `git push` runs the full check first. pnpm
usually runs `prepare` during the install, as you may have seen above. Running it by hand costs
nothing and covers an install done with `--ignore-scripts`.

## 3. Give the project its name

```sh
pnpm rename --name my-product --port 3100 --title "My Product"
```

The script changes three files and nothing else:

- `package.json` gets the name, and its `dev` script becomes `next dev -p 3100`.
- `src/app/layout.tsx` gets the title as its metadata title and description.
- `README.md` gets the title as its first heading.

It prints nothing when it succeeds; `git status` shows the three files.

Still yours to change by hand, because they describe the template and not your product: the heading
in `src/app/page.tsx`, the body of `README.md`, the name in `LICENSE`, the first section of
`AGENTS.md`, and the `docs/` folder. That folder is the harness's own documentation site; delete it or
replace it with your own.

## 4. Install the test browser and start

```sh
pnpm exec playwright install chromium
pnpm dev
```

The browser install prints nothing when that browser is already downloaded. Open
`http://localhost:3100` to see the app on the port you chose, then stop the server with Ctrl-C before
the next step. No secrets are needed; `.env.example` documents the starting environment.

## 5. Check that everything holds

```sh
pnpm check
```

Every step should pass on a fresh clone: format, lint, types, audit, boundaries, unused code, copies,
unit tests, the production build and the browser smoke test. This is the same command the pre-push
hook and CI run.

Expect several minutes and no output until it finishes. Most of that time is the harness running its
own tests; on a four-core server the whole check took about seven minutes.

If a step fails before you have changed anything, the template is at fault, not you. Look at the
Check badge in the README, and run the failing step on its own to see the cause, for example
`pnpm test` for vitest. Each step is also a script in `package.json`.

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
