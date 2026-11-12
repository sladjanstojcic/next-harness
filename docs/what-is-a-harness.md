---
title: What a harness is
nav_order: 2
---

# What a harness is

A harness is the set of checks that runs around a coding agent while it works. It tells the agent
where code belongs before it writes, and it checks the result after. The agent does not choose
whether to follow it.

## Instructions are requests, hooks are rules

You can tell an agent how your project is organised. You write it in `AGENTS.md` or `CLAUDE.md`, and
the agent reads it at the start of a session. Most of the time it follows what it read.

Most of the time is the problem. An instruction is text in the agent's context, next to the task, the
code it has read and everything it has done so far. Late in a long session an instruction from the
start carries less weight. The agent does not refuse the rule. It writes the file where the file
seems to fit, and the rule is not what it is thinking about.

A hook is different. Claude Code and Codex both run a command of yours at fixed moments: before a
tool call, after it, and when the agent wants to end its turn. That command can refuse. A write
through the agent's file tools to the wrong place then fails, every time, with a message that says
where the file belongs.

So a rule with no exceptions belongs in a hook. An instruction is the right place for what a check
cannot judge: naming, taste, what to ask before doing.

## Guides before, sensors after

A harness has two kinds of part.

- **Guides** act before the agent writes. An index of what already exists, shown at session start,
  is a guide. So is a guard that refuses a path and names the right one.
- **Sensors** check after the agent has written. A formatter, a linter, a type checker, an audit of
  file sizes and a test run are sensors.

Both can be computational or inferential. A computational check is a program: it gives the same
answer every time and costs milliseconds or seconds. An inferential check is another model reading
the work. It can judge more, and it is slower, costs more and is sometimes wrong.

A harness leans on computational checks, because they are cheap enough to run on every change. The
earlier a check runs, the less the agent has built on top of the mistake.

```text
 before the write        after the write         before the turn ends
 ────────────────        ───────────────         ────────────────────
 guide: where does       sensor: format,         sensor: types, lint,
 this file belong?       lint, audit the file    boundaries, copies, tests
```

## What agents get wrong

Agents write code that works. What goes wrong is the shape of the code across many sessions.

- **Helper folders everywhere.** Each task needs a small function, and each session puts it in a new
  `utils/` or `helpers/` folder near the code it was working on. After a month there are twelve.
- **Files that only grow.** Adding to a file is easier than splitting it. A component passes a
  thousand lines one reasonable addition at a time.
- **The same function under three names.** The agent does not know a helper exists, so it writes it
  again. `formatPrice`, `formatMoney` and `toCurrency` now do the same thing, slightly differently.
- **Quieting the checker.** When a type does not fit, `any`, `as never` or `@ts-ignore` makes the
  error go away. So does a comment that disables a lint rule for one line.
- **"Done" too early.** The agent reports success while the type check or a test still fails.

None of these is a failure of intelligence. Each session sees a small part of the project and
optimises for the task in front of it. Shape is a property of the whole project, and no single
session is responsible for it.

## Why review is too late

Code review can catch all of this. In practice it catches some of it, late.

A reviewer reads a diff. A new `utils/` folder looks harmless in a diff. The thirteenth file in a
folder looks like one file. A copy of a function is invisible unless the reviewer remembers the
original. And by the time a person reads the change, the agent has built three more things on it.

Agents also produce more code than people review carefully. A rule that depends on a careful human
reading every change will be skipped on a busy day.

A harness moves these checks to the moment of writing. The agent is told while the fix is still one
file. Review is then left with what only a person can judge: whether the change is the right one.

## Where this template fits

Next Harness is one such harness, for Next.js projects. Its guides and sensors are a small
TypeScript program that the agent's hooks call.

- [What this one checks](what-it-checks.md) shows its rules, each with the message the agent gets.
- [A working day](working-day.md) follows one task from the prompt to the push.
- [Further reading](reading.md) lists the texts these ideas come from.
