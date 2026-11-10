import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";

const STATE_REASON =
  "The harness keeps its own state in .git/harness; read it through the harness CLI (`pnpm harness:blocks`) and leave the files to the hooks.";

const bash = (root: string, command: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root);
const write = (root: string, tool: string, file: string): HookEvent =>
  parseEvent(
    "claude",
    {
      session_id: "s",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: file, notebook_path: file, content: "{}", old_string: "x", new_string: "y" },
    },
    root,
  );

describe("the harness state folder is the harness's own", () => {
  it.each([
    ": > .git/harness/task-s.json",
    "echo '{}' > .git/harness/task-s.json",
    "mv .git/harness/task-s.json task.bak",
    `python3 -c "import os; os.remove('.git/harness/task-s.json')"`,
    `node -e "require('fs').unlinkSync('.git/harness/task-s.json')"`,
    `node -e "const fs=require('fs'),p=require('path');fs.writeFileSync(p.join('.git','harness','task-s.json'),'{}')"`,
    "cat .git/harness/blocks.jsonl",
    "grep -i 'supabase-link' .git/harness/blocks.jsonl",
    'cat "$(git rev-parse --git-path harness)/blocks.jsonl"',
    String.raw`type .git\harness\blocks.jsonl`,
    `python3 -c 'import shutil; shutil.rmtree(".git" + "harness")'`,
    `git commit -m "$(cat <<'EOF'\nstate in .git/harness\nEOF\n)"`,
  ])("denies %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(bash(root, command), root)).toEqual({ guard: "harness-state", reason: STATE_REASON });
  });

  it.each([
    "pnpm harness:blocks",
    "node tooling/harness/cli.ts blocks",
    "node tooling/harness/cli.ts check done",
    "git status",
    "cat .github/workflows/check.yml",
    "grep -rn harness .gitignore",
    "cat tooling/harness/core/lock.ts",
  ])("allows %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(bash(root, command), root)).toBeNull();
  });

  it.each([
    'git commit -m "docs: the harness keeps its state in .git/harness"',
    'hc run t2yw "read .git/harness/blocks.jsonl and report"',
    'hc send t2yw "task state lives in .git/harness now"',
    'gh pr create --title x --body "Stop reads .git/harness/task-s.json when it exists"',
    'echo "state lives in .git/harness" >> notes.md',
  ])("review round 3: allows prose in a quoted argument: %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(bash(root, command), root)).toBeNull();
  });

  it.each([
    'echo "ignored folders: .git, harness, dist"',
    "tar -czf out.tgz --exclude=.git, harness",
    "git clone https://example.invalid/tools.git/harness",
    "ls ../other.git/harness",
    "git check-ignore -v .git/harness-notes.md",
  ])("review round 3: allows the look-alike %s", (command) => {
    const { root } = makeRepo();
    expect(checkGuards(bash(root, command), root)).toBeNull();
  });

  it.each(["Write", "Edit", "NotebookEdit"])("denies %s under .git/ and leaves .github/ and .gitignore to the other guards", (tool) => {
    const { root } = makeRepo();
    for (const file of [".git/harness/task-s.json", ".git/config", ".git/hooks/pre-push"]) {
      expect(checkGuards(write(root, tool, file), root), file).toEqual({
        guard: "git-dir-write",
        reason: `${file} belongs to git and the harness; change the repository through git commands.`,
      });
    }
    for (const file of [".gitignore", "docs/.git-notes.md"]) expect(checkGuards(write(root, tool, file), root)?.guard, file).not.toBe("git-dir-write");
  });
});
