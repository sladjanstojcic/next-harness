---
title: What this one checks
nav_order: 3
---

# What this one checks

Six families of rule. Each one below has the rule, the reason for it, and the message the agent gets
when it breaks the rule. Every message says what to do instead, so the agent can correct itself.

The examples use a module named `billing`.

## One shape

Routes live in `src/app/`. Features live in `src/modules/<module>/`. Code used across features lives
in `src/shared/`. Nothing else goes under `src/`, and nothing new goes at the repository root.

Inside a module the folders are fixed too: `components/`, `server/`, `domain/` and `actions/`, with
`index.ts` and `server.ts` as its public entries. A folder named `utils`, `helpers`, `common` or
`misc` is refused wherever it appears.

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

## Limits

A file has at most 250 lines, counting blanks and comments. A page has at most 60. A folder has at
most 10 source files; tests beside their source do not count.

The numbers matter less than having them. A limit forces the split at the moment a file grows past
it, when the agent still knows what the two halves are.

```text
agent grows    src/app/invoices/page.tsx to 84 lines
harness says   thin-page: page.tsx has 84 lines (maximum 60); move UI into
               src/modules/<module>/components/ and import it through index.ts.
```

Generated code is exempt: the shadcn components in `src/shared/ui/` are not yours to split.

## Boundaries

Another module, or a route, uses a module only through `index.ts`, `server.ts` or an action file.
`shared/` never imports a module. Modules do not import each other in a circle. Code in `domain/` is
pure: no React, no I/O, and a test beside every file.

Boundaries are what let you change the inside of a module without reading the rest of the project.
An agent reaching into another module's internals removes that, one import at a time.

```text
agent imports  @/modules/billing/server/load-invoices from src/modules/reports/
harness says   module-public-api: Import another module through index.ts, server.ts or
               actions/<name>-action.ts; keep internal imports inside their own module.
```

## No copies, no workarounds

The same function may not exist under two names. Unused exports and files are reported. So are
pasted blocks. `any`, `as never`, `@ts-ignore` and comments that switch off a lint rule are errors.

Copies are how a project ends up with three slightly different price formatters. Workarounds are how
a failing check turns into a passing one without the problem being fixed.

```text
agent writes   formatMoney in src/modules/reports/domain/totals.ts
harness says   duplicate-export: formatMoney is
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
harness says   Use the shadcn component from src/shared/ui/ instead of a raw <button>; add a
               missing one with `pnpm dlx shadcn add button`. If shadcn has no component for
               this, say so in the handoff before building it by hand.
```

## The lock

The agent cannot edit the harness itself, the hook settings, the git hooks, the CI workflow or the
tool configs such as `tsconfig.json` and the ESLint config. Only you can open the lock, with
`pnpm harness:unlock` in your own terminal. It closes again after four hours.

A check the agent can edit is a check the agent can remove. The quickest way past a failing lint
rule is to delete the rule, and an agent under pressure to finish will find it.

```text
agent edits    tsconfig.json
harness says   harness-lock: tsconfig.json is part of the harness and is locked. Ask the user to
               run `pnpm harness:unlock` in their own terminal (valid 4 hours), make the change
               with them, then `pnpm harness:lock`.
```

The agent also cannot run the unlock itself. That command is refused when it comes from the agent.

## The complete rules

This page shows the families. The full statement, with every exception, is the file the agent itself
reads: [AGENTS.md](https://github.com/sladjanstojcic/next-harness/blob/main/AGENTS.md). Other kinds
of project have their own shape with the same ideas; see [Adopt it](adopt.md).
