const CLAUDE_COMMAND = 'node "$CLAUDE_PROJECT_DIR/tooling/harness/cli.ts" hook claude';
const CODEX_COMMAND = 'node "$(git rev-parse --show-toplevel)/tooling/harness/cli.ts" hook codex';

function hooksBlock(command: string, editMatcher: string) {
  const run = (timeout?: number) => [{ type: "command", command, ...(timeout === undefined ? {} : { timeout }) }];
  return {
    SessionStart: [{ hooks: run() }],
    UserPromptSubmit: [{ hooks: run() }],
    PreToolUse: [
      { matcher: "Bash", hooks: run() },
      { matcher: editMatcher, hooks: run() },
    ],
    PostToolUse: [
      { matcher: "Bash", hooks: run(90) },
      { matcher: editMatcher, hooks: run(90) },
    ],
    Stop: [{ hooks: run(300) }],
  };
}

export const CLAUDE_HOOKS = hooksBlock(CLAUDE_COMMAND, "Edit|Write|NotebookEdit");
export const CODEX_HOOKS = hooksBlock(CODEX_COMMAND, "apply_patch");

export const CODEX_CONFIG = "[features]\nhooks = true\n";

export const HOOKS_PATH = ".githooks";

export const PRE_PUSH = `#!/bin/sh
# Call the harness directly, so a changed package.json script cannot weaken the gate.
exec node tooling/harness/cli.ts check ci
`;

export const PACKAGE_SCRIPTS: Readonly<Record<string, string>> = {
  audit: "node tooling/harness/cli.ts audit",
  check: "node tooling/harness/cli.ts check ci",
  "harness:blocks": "node tooling/harness/cli.ts blocks",
  "harness:lock": "node tooling/harness/cli.ts lock",
  "harness:unlock": "node tooling/harness/cli.ts unlock",
};

export const CI_STEPS = `CI is not written. Add these steps to a job in .github/workflows/ (Playwright only for a Next workspace at the root):
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: pnpm/action-setup@v6
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: node tooling/harness/cli.ts check ci`;
