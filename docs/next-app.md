---
title: An existing Next.js project
nav_order: 2
parent: Adopt it
---

# An existing Next.js project

For a single app at the repository root, such as `create-next-app` output, with or without a `src/`
folder. No config file is needed: the whole repository is one `next-modules` workspace.

Without `--src-dir`, create-next-app puts `app/` at the root, and Next.js ignores `src/app/` while it
exists. The harness then keeps the same shape one level up: routes in `app/`, features in
`modules/<module>/`, shared code in `shared/`. It reads this from git: `app/` holds a file git lists and
`src/app/` holds none. Nothing is configured, and an empty folder does not switch the layout.

```sh
git subtree add --prefix=tooling/harness https://github.com/sladjanstojcic/next-harness.git harness --squash
node tooling/harness/cli.ts init --starter   # first run: lists tooling/harness as a workspace package, then stops
pnpm install
node tooling/harness/cli.ts init --starter   # second run: writes the wiring, prints the next steps
```

Then do the printed steps in order. On a real `create-next-app` project there were seven:

1. Install the harness's tools with the printed `pnpm add -D` line. Init installs nothing itself.
2. Install `zod` and `server-only`, which the starter files import.
3. Change each config the project already had as init prints: an import at the top, and two lines in
   place of its `export default`. Your `eslint.config.mjs` stays where it is and imports the harness's
   rules; see [your own ESLint config](init.md#your-own-eslint-config).
4. `pnpm exec prettier --write .`, once, to format the app in the preset's style.
5. `pnpm exec playwright install chromium`, for the smoke test.
6. `git add -A && git commit -m "Add the harness"`.
7. `pnpm run check`, the full gate.

`--starter` copies the `shared/lib/` helpers that the content rules point at, under `src/` or beside
`app/`, and `e2e/smoke.test.ts`.
Code that does not fit the shape yet shows up in step 7. Move it, or give the project a legacy list as
[a monorepo](monorepo.md#the-legacy-list) does.
