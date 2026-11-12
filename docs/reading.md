# Further reading and references

Texts about harnesses and coding agents that were read in full and agree with how this template works.
Where one of them pulls in a different direction, the line says so.

- **[Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)** (Anthropic docs).
  Keep `CLAUDE.md` short and limited to what the agent cannot learn from the code; "if you keep adding
  emphasis to a `CLAUDE.md` line and Claude still misses it, that's a sign the line belongs in a hook";
  use `command` hooks for rules with zero exceptions, a `PreToolUse` hook to block edits, a `Stop` hook
  that runs the type check and blocks with exit code 2, and `deny` rules for secrets. That is this
  template's division between `AGENTS.md` and the harness. One limit to know: Claude Code ends the turn
  after eight consecutive Stop blocks with no tool call between them; the repair budget here stops at two.
- **[Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)**
  by Birgitta Böckeler (martinfowler.com, 2 April 2026; the
  [February memo](https://www.martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html)
  came first). A harness is guides that steer the agent before it acts and sensors that observe after;
  each is computational (tests, linters, type checkers, structural analysis) or inferential (instructions,
  AI review). "Computational sensors are cheap and fast enough to run on every change", module boundaries
  belong in a pre-commit or agent hook, and linter messages should carry the self-correction. Here the
  guard is the guide, the fast and Done gates are the sensors, and every message says where the code
  belongs. The article asks how to tell a quiet sensor from a missing one; the block log is this
  template's answer. It also treats agent-written rules as normal; here they need the unlock.
- **[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)**
  (Anthropic, 26 November 2025). Agents "mark features as done prematurely" and must self-verify; "it is
  unacceptable to remove or edit tests"; work on one feature at a time and leave the environment clean.
  Here the Done gate replaces the agent's own word, and `AGENTS.md` forbids weakening a check. The post
  is about autonomous multi-session work, broader than one turn in a repository.
- **[Harness design for long-running apps](https://www.anthropic.com/research/harness-design-long-running-apps)**
  (Anthropic, 24 March 2026). Separate the agent doing the work from the one judging it, because agents
  "skew positive when grading their own work"; use hard thresholds; "every component in a harness
  encodes an assumption about what the model can't do on its own", so prefer the simplest solution. The
  gates here are that separate judge, and the block log tests the assumption rule by rule. The post
  argues that an always-on evaluator becomes overhead for tasks within the model's reach; this template
  keeps the gates and measures false blocks instead.
- **[AGENTS.md](https://agents.md/)** (the convention). "A README for agents": setup commands, code style,
  testing instructions; the nearest file wins; it complements the human README. `AGENTS.md` here follows
  it, and `CLAUDE.md` points at it because Claude Code is not on that site's list of readers.

## References

The harness was built against these documents, at the versions [pinned in this template](reference.md#what-is-pinned).

- Claude Code hooks: [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
- Codex hooks, including user-level hooks: [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks)
- Next.js, where code runs and how it crosses the client boundary: [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [`next.config.ts`](https://nextjs.org/docs/app/api-reference/config/next-config-js); React [Server Functions](https://react.dev/reference/rsc/server-functions)
- Node 24 running TypeScript directly: [Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- ESLint flat configuration: [Configuration files](https://eslint.org/docs/latest/use/configure/configuration-files); typescript-eslint [typed linting](https://typescript-eslint.io/getting-started/typed-linting/) and [`no-unsafe-type-assertion`](https://typescript-eslint.io/rules/no-unsafe-type-assertion/)
- Import boundaries, dead code and copies: [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [knip](https://knip.dev), [jscpd](https://github.com/kucherenko/jscpd)
- Tests and formatting: [Vitest](https://vitest.dev), [Playwright](https://playwright.dev), [Prettier](https://prettier.io)
- Generated UI: [shadcn CLI](https://ui.shadcn.com/docs/cli)
- Git, for the tree snapshots and the worktree case: [racy-git](https://git-scm.com/docs/racy-git), [git worktree](https://git-scm.com/docs/git-worktree)
