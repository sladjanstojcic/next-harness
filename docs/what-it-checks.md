---
title: What this one checks
nav_order: 3
---

# What this one checks

Six families of rule. Each one below has the rule, the reason for it, and the message the agent gets
when it breaks the rule. Every message says what to do instead, so the agent can correct itself.

The examples use a module named `billing`. In a project without `src/`, read every path on this page
without the `src/` prefix.

## One shape

Routes live in `src/app/`. Features live in `src/modules/<module>/`. Code used across features lives
in `src/shared/`. Nothing else goes under `src/`, and nothing new goes at the repository root.

Inside a module the folders are fixed too: `components/`, `server/`, `domain/` and `actions/`, with
`index.ts` and `server.ts` as its public entries. A module needs an entry only once something outside
it imports it. An optional, flat `src/backend/` holds the connection to a database or hosted backend:
the client and the types its CLI generates. A folder named `utils`, `helpers`, `common` or
`misc` is refused wherever it appears. Area folders go one level deep; past that, the agent splits a
new module when the responsibility warrants it, and says why in its report.

A closed shape means there is one answer to "where does this go?". Without it, every helper folder
becomes a second architecture beside the first.

```text
agent writes   src/utils/format-price.ts
harness says   src-shape: Put routes in src/app/, feature code in src/modules/<module>/, and
               cross-cutting utilities in src/shared/lib/.

agent writes   src/modules/billing/domain/utils/tax.ts
harness says   generic-folder: Name the domain/ subfolder after its area (e.g. pricing/,
               documents/); code shared across modules belongs in src/shared/lib/.
```

This check runs before the write. The file is never created.

The checks below run after the write, so their findings name the file and line first:
`file:line rule — message`.

## Limits

A file has at most 250 lines, counting blanks and comments. A page has at most 60. A folder has at
most 10 source files; tests beside their source do not count.

The numbers matter less than having them. A limit forces the split at the moment a file grows past
it, when the agent still knows what the two halves are.

```text
agent grows    src/app/invoices/page.tsx to 84 lines
harness says   src/app/invoices/page.tsx:1 thin-page — page.tsx has 84 lines (maximum 60); move
               UI into src/modules/<module>/components/ and import it through index.ts.
```

Generated code is exempt: the shadcn components in `src/shared/ui/` are not yours to split.

## Boundaries

Another module, or a route, uses a module only through `index.ts`, `server.ts` or an action file.
`shared/` never imports a module. Modules do not import each other in a circle. Code in `domain/` is
pure: no React, no I/O, and a test beside every file.

Boundaries are what let you change the inside of a module without reading the rest of the project.
An agent reaching into another module's internals removes that, one import at a time. Boundaries are
checked when the agent says it is done, and again before a push.

```text
agent imports  billing's server/load-invoices.ts from the reports module
harness says   src/modules/reports/server/monthly-report.ts:1 module-public-api —
               src/modules/reports/server/monthly-report.ts →
               src/modules/billing/server/load-invoices.ts. Import another module through
               index.ts, server.ts or actions/<name>-action.ts; keep internal imports inside
               their own module.
```

A backend package, such as `@supabase/supabase-js` or `pg`, is imported only in `src/backend/`.
Everything else imports that one client, or the package's types with `import type`. Otherwise every
module opens its own connection, with its own settings.

```text
agent imports  @supabase/supabase-js in src/modules/billing/server/load-invoices.ts
harness says   src/modules/billing/server/load-invoices.ts:1 backend-package — Import a backend
               package only in src/backend/, which holds the one client; elsewhere import that
               client, or the package's types with "import type".
```

## No copies, no workarounds

The same function body may not exist under two names. Unused exports and files are reported. So are
pasted blocks. `any`, `as never`, `@ts-ignore` and comments that switch off a lint rule are errors.

Copies are how a project ends up with one price formatter in three modules. The copy check runs when
the agent says it is done. Workarounds are how
a failing check turns into a passing one without the problem being fixed.

```text
agent writes   formatMoney in src/modules/reports/domain/totals.ts, with the body of formatPrice
harness says   src/modules/reports/domain/totals.ts:12 duplicate-export — formatMoney is
               src/modules/billing/domain/format-price.ts#formatPrice under another name. Reuse
               that export; put cross-module logic in src/shared/lib/ or src/shared/components/.
```

At session start the agent also gets an index of every module's public exports. That is the guide
for this rule: it sees what exists before it writes.

## React and shadcn

The React hook rules are errors, not warnings. In a project set up for shadcn, a raw `<button>`,
`<input>`, `<select>`, `<textarea>`, `<label>`, `<table>` or `<dialog>` outside the generated
`shared/ui/` is reported.

Without this an agent hand-styles a look-alike of a component the project already has, and the
interface drifts apart one button at a time.

```text
agent writes   <button className="rounded px-3 py-2">Save</button>
harness says   src/modules/billing/components/save-bar.tsx:14 no-restricted-syntax — Use the
               shadcn component from src/shared/ui/ instead of a raw <button>; add a missing one
               with `pnpm dlx shadcn add button`. If shadcn has no component for this, say so in
               the handoff before building it by hand.
```

Every app is built with TypeScript, Tailwind and shadcn. The full audit, which Done, the pre-push
hook and CI run, reports a Next, Vite or Electron app without shadcn's `components.json` at its top.
Without that file the rule above is off, so an app that skipped the setup would pass every check.
Tailwind is set up by init's steps and not checked: `package.json` shows that the package is listed,
not that it is used, and shadcn cannot be set up without it.

```text
agent adds     apps/admin/, a Next app, without the shadcn setup
harness says   apps/admin/package.json:1 ui-stack — This app has no components.json: every app is
               built with TypeScript, Tailwind and shadcn. Set shadcn up with the steps on
               https://sladjanstojcic.github.io/next-harness/next-app.html; they change locked
               tool configs, so the user unlocks first.
```

## The lock

The agent cannot edit the harness itself, the hook settings, the git hooks, the CI workflow or the
tool configs such as `tsconfig.json` and the ESLint config. Only you can open the lock, with
`pnpm harness:unlock` in your own terminal. It closes again after four hours.

A check the agent can edit is a check the agent can remove. The quickest way past a failing lint
rule is to delete the rule, and an agent under pressure to finish will find it.

```text
agent edits    tsconfig.json
harness says   tsconfig.json is part of the harness and is locked. Ask the user to run
               `pnpm harness:unlock` in their own terminal (valid 4 hours), make the change with
               them, then `pnpm harness:lock`.
```

The agent also cannot run the unlock itself. That command is refused when it comes from the agent.

## The complete rules

This page shows the families. The rules as the agent reads them are in
[AGENTS.md](https://github.com/sladjanstojcic/next-harness/blob/main/AGENTS.md); the details are in
[harness.config.ts](configuration.md) and [Guards and gates](gates.md). Other kinds of project have
their own shape with the same ideas; see [Adopt it](adopt.md).
