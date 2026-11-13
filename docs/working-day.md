---
title: A working day
nav_order: 4
---

# A working day

One task, from the prompt to the push. The task: "add a monthly total to the invoices page".

## When each check runs

| Moment           | What runs                                                                          | Takes    |
| ---------------- | ---------------------------------------------------------------------------------- | -------- |
| Session start    | An index of every module's public exports, so the agent reuses before it writes    | one read |
| Before a write   | Guards: structure, `.env*` files, the lockfile, generated UI, the harness lock     | ms       |
| Before a command | Guards: force push, `rm` outside the checkout, destructive migrations, deploys     | ms       |
| After a write    | Fast check: Prettier, syntax-level lint, path and content audit of that file       | ≈ 1–2 s  |
| After a command  | Audit of whatever the command created or changed                                   | ≈ 1 s    |
| Agent says done  | Done check: types, typed lint, audit, boundaries, dead code, copies, related tests | seconds  |
| Pre-push and CI  | The full check: all of the above on every file, all tests, `next build`, smoke     | minutes  |

## 1. The session starts

Before your prompt, the agent receives a code index: the public exports of every module and of
`shared/lib/`. It now knows that `formatNumber` exists in `shared/lib/format.ts` without having
opened the file. In a workspace with `components.json`, an "Interface" section follows: build the
interface from the shadcn components and layouts.

## 2. A write is refused

The agent needs a function that sums invoices by month. It tries to put it in
`src/utils/monthly-total.ts`. The guard refuses before the file exists:

```text
src-shape: Put routes in src/app/, feature code in src/modules/<module>/, and cross-cutting
utilities in src/shared/lib/.
```

The agent reads the message and writes `src/modules/billing/domain/monthly-total.ts` instead, with
`monthly-total.test.ts` beside it. You did not have to notice or say anything.

## 3. Each edit is checked

After every write the fast check runs on that one file. Prettier formats it. A syntax-level lint and
the audit look at it. If the page file has grown past 60 lines, the agent hears about it now, one
or two seconds after the edit, and moves the new markup into a component.

Shell commands are covered too. When the agent runs a generator or a codemod, the audit looks at
every file the command created or changed.

## 4. The agent says it is done

This is the check that matters most. When the agent tries to end its turn, the Done check runs on
what changed since your prompt: types, lint with type information, the audit, module boundaries,
unused code, copies and the tests related to the changed files.

If something fails, the turn does not end. The agent gets the findings and goes back to work. Say it
imported `load-invoices` straight from the module's `server/` folder into the page: it is told to go
through `server.ts`, and it fixes the import.

Files changed in this turn block. Older problems elsewhere are reported and do not block.

## 5. Two repairs, then a report

The agent gets two repair attempts per prompt. If the same failure comes back unchanged, repairs
stop at once. After that the harness lets the turn end and shows you what still fails:

```text
Checks still failing after 2 repairs:
```

followed by the findings. This is on purpose. An agent that keeps trying will, sooner or later, make
the check pass in a way you do not want. Two attempts is enough for an honest fix.

## 6. You push

The pre-push hook runs the full check: every file, every test, a production build and a browser
smoke test. CI runs the same command. A package script cannot weaken it, because the hook and the
workflow call the harness directly.

## Your part

Four commands cover a normal day:

```sh
pnpm check                 # the full check; what pre-push and CI run
pnpm run audit             # the harness audit alone
pnpm harness:blocks        # every denial and block, per rule
pnpm harness:unlock        # open the harness for four hours; pnpm harness:lock closes it
```

Note that the audit is `pnpm run audit`. Plain `pnpm audit` is pnpm's own command for dependency
vulnerabilities.

**Read the block log now and then.** Every refusal is recorded. `pnpm harness:blocks` lists them per
rule. A rule that mostly stops good code is a bug in the harness, not in the agent. You can mark
such a block as false, with a reason:

```sh
pnpm harness:blocks --false <id> "why this was good code"
```

Only you can do that. The agent is asked to name the block in its report instead.

**Unlock when a rule must change.** Changing a limit, a tool config or the harness itself is your
decision. Run `pnpm harness:unlock` in your own terminal, make the change together with the agent,
and run `pnpm harness:lock` when you are done.

**Read the report.** When a turn ends with failing checks, the harness shows you which. That is the harness
working: you learn about the problem at the end of the turn, not in review a day later.

## What it does not do

It does not judge whether the change is the right one, or whether the code is good inside a
well-placed file. That is still review, by you or by another agent, with the
[review rubric](review-rubric.md). The rest is in [Known limitations](limitations.md).

Next: [Adopt it](adopt.md).
