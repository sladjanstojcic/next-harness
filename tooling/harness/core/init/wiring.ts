import fs from "node:fs";
import path from "node:path";

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

/** The root "prepare" script: installs run it, so a fresh clone gets the pre-push hook without running init. */
export const PREPARE = `git config core.hooksPath ${HOOKS_PATH}`;

export const PACKAGE_SCRIPTS: Readonly<Record<string, string>> = {
  audit: "node tooling/harness/cli.ts audit",
  check: "node tooling/harness/cli.ts check ci",
  "harness:blocks": "node tooling/harness/cli.ts blocks",
  "harness:lock": "node tooling/harness/cli.ts lock",
  "harness:unlock": "node tooling/harness/cli.ts unlock",
};

/** The lint script a workspace gets when it has none. */
export const LINT_SCRIPT = "eslint . --max-warnings 0";

/** With a legacy list CI compares with the remote default branch, which a shallow checkout does not hold. */
/** `browsers` is the browser install for the smoke test, which runs only where the gates build a Next app. */
const ciSteps = (legacy: boolean, browsers?: string): string => `CI is not written. Add these steps to a job in .github/workflows/:
      - uses: actions/checkout@v7${legacy ? "\n        with:\n          fetch-depth: 0" : ""}
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: pnpm/action-setup@v6
      - run: pnpm install --frozen-lockfile${browsers === undefined ? "" : `\n      - run: ${browsers}`}
      - run: node tooling/harness/cli.ts check ci`;

const WORKFLOWS = ".github/workflows";
const GATE_COMMAND = "cli.ts check ci";

/** The first workflow that runs the full gate, by the command the steps above end with. */
function gateWorkflow(root: string): string | undefined {
  try {
    return fs
      .readdirSync(path.join(root, WORKFLOWS))
      .sort()
      .find((name) => /\.ya?ml$/.test(name) && fs.readFileSync(path.join(root, WORKFLOWS, name), "utf8").includes(GATE_COMMAND));
  } catch {
    return undefined;
  }
}

/** Init never writes CI: it prints the steps until a workflow runs the gate, and names that workflow from then on. */
export function ciReport(root: string, legacy: boolean, browsers?: string): string {
  const workflow = gateWorkflow(root);
  return workflow === undefined ? ciSteps(legacy, browsers) : `unchanged ${WORKFLOWS}/${workflow}: runs the CI gate`;
}
