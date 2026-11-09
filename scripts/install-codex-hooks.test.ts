import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../tooling/harness/testing/temp-repo.ts";
import { installCodexHooks, WORKTREE_COMMAND } from "./install-codex-hooks.ts";

const projectHooks = {
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "node x hook codex", timeout: 300 }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node x hook codex" }] }],
  },
};

function home(root: string, files: Record<string, string> = {}): string {
  const directory = path.join(root, "home");
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

describe("install-codex-hooks", () => {
  it("adds a worktree-only hook per project entry, enables the feature, and is idempotent", () => {
    const repo = makeRepo({ ".codex/hooks.json": JSON.stringify(projectHooks) });
    const directory = home(repo.root);
    expect(installCodexHooks(repo.root, directory)).toEqual({ file: path.join(directory, ".codex/hooks.json"), added: 2 });
    const written = JSON.parse(fs.readFileSync(path.join(directory, ".codex/hooks.json"), "utf8")) as unknown;
    expect(written).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: WORKTREE_COMMAND, timeout: 300 }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: WORKTREE_COMMAND }] }],
      },
    });
    expect(fs.readFileSync(path.join(directory, ".codex/config.toml"), "utf8")).toBe("\n[features]\nhooks = true\n");
    expect(installCodexHooks(repo.root, directory).added).toBe(0);
  });

  it("keeps the user's existing hooks and an existing [features] table", () => {
    const repo = makeRepo({ ".codex/hooks.json": JSON.stringify(projectHooks) });
    const directory = home(repo.root, {
      ".codex/hooks.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }),
      ".codex/config.toml": 'model = "gpt"\n\n[features]\nother = true\n',
    });
    expect(installCodexHooks(repo.root, directory).added).toBe(2);
    const written = JSON.parse(fs.readFileSync(path.join(directory, ".codex/hooks.json"), "utf8")) as unknown;
    expect(written).toMatchObject({ hooks: { Stop: [{ hooks: [{ command: "say done" }] }, { hooks: [{ command: WORKTREE_COMMAND }] }] } });
    expect(fs.readFileSync(path.join(directory, ".codex/config.toml"), "utf8")).toBe('model = "gpt"\n\n[features]\nhooks = true\nother = true\n');
  });

  it("steps aside outside linked worktrees: the command requires .git to be a file", () => {
    expect(WORKTREE_COMMAND).toContain('[ -f "$r/.git" ]');
    expect(WORKTREE_COMMAND.endsWith("|| exit 0")).toBe(true);
  });
});
