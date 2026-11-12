---
title: Home
nav_order: 1
---

# Next Harness

A guarded Next.js template for code that agents write.

Your Claude Code or Codex agent is told where code belongs, stopped before it writes a file in the
wrong place, checked after every edit, and checked again before it ends its turn.

```text
 agent writes a file              agent runs a command              agent says "done"
        │                                │                                │
   PreToolUse ── guard ──▶          PreToolUse ── snapshot             Stop
   "src/utils/x.ts? no:             PostToolUse ── audit what            │
    put it in a module"             the command changed             Done gate: types, lint,
        │                                │                          audit, boundaries, dead
   PostToolUse ── fast gate              │                          code, copies, related tests
   prettier · lint · audit               │                          ─ blocks, with the fix ─
        └────────────────────────────────┴────────────────────────────────┘
                              pre-push and CI: the same gate, in full
```

When the agent puts a file in the wrong place, the write does not happen. It gets this instead:

```text
src-shape: Put routes in src/app/, feature code in src/modules/<module>/, and cross-cutting
utilities in src/shared/lib/.
```

Then it writes the file where it belongs. You did not have to notice.

## New here? Read these in order

1. [What a harness is](what-is-a-harness.md): the idea, and what agents get wrong without one.
2. [What this one checks](what-it-checks.md): six families of rule, each with a real message.
3. [A working day](working-day.md): one task from the prompt to the push.
4. [Adopt it](adopt.md): start a new project, or add the harness to the one you have.

## Already using it?

- [Reference](reference.md): file classes, the lock, the block log, what is pinned.
- [What init writes](init.md), including how it works with your own ESLint config.
- [Known limitations](limitations.md).

The source is on [GitHub](https://github.com/sladjanstojcic/next-harness), under the MIT license.
