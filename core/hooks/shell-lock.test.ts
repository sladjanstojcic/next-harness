import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { unlock } from "../lock.ts";
import { sessionFile, writeState } from "../state/state-file.ts";
import { makeRepo, type RepoFixture } from "../../testing/temp-repo.ts";
import { parseEvent } from "./event.ts";
import { handleEvent } from "./handle.ts";

const CONFIG = "eslint.config.ts";
const remotes: string[] = [];
afterEach(() => {
  for (const folder of remotes.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function bashEvent(root: string) {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "claude", "pre-tool-bash.json"), "utf8"));
  return parseEvent("claude", { ...z.record(z.string(), z.unknown()).parse(raw), cwd: root, tool_input: { command: "git status" } }, root);
}

/** The locked files one shell command is reported for: the hook runs before and after `command`. */
async function lockedBy(repo: RepoFixture, command: () => void): Promise<string[]> {
  const bash = bashEvent(repo.root);
  await handleEvent(bash, repo.root);
  command();
  const outcome = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
  return (outcome.findings ?? []).filter((finding) => finding.rule === "harness-lock").map((finding) => finding.file);
}

function repoWithBranch(): RepoFixture {
  const repo = makeRepo({ [CONFIG]: "export default [];\n", "README.md": "a\n" });
  repo.git("checkout", "-qb", "other");
  repo.write(CONFIG, "export default [2];\n");
  repo.git("commit", "-qam", "Other harness version");
  repo.git("checkout", "-q", "main");
  return repo;
}

const editAndCommit = (repo: RepoFixture) => (): void => {
  repo.write(CONFIG, "export default [9];\n");
  repo.git("commit", "-qam", "Edit the lint config");
};

describe("the shell lock check after a command that moves HEAD", () => {
  it("reports a locked file only when the command edits it, committed or not, never when it brings in existing commits", async () => {
    const repo = repoWithBranch();
    const base = repo.git("rev-parse", "HEAD").trim();
    const steps: [string, () => void, string[]][] = [
      ["switch to a branch with another committed version", () => repo.git("checkout", "-q", "other"), []],
      ["switch back", () => repo.git("checkout", "-q", "main"), []],
      ["fast-forward merge of that branch", () => repo.git("merge", "-q", "--ff-only", "other"), []],
      ["reset --hard to the commit before the merge", () => repo.git("reset", "-q", "--hard", "HEAD~1"), []],
      ["edit and commit in one command", editAndCommit(repo), [CONFIG]],
      ["undo that with reset --hard HEAD~1", () => repo.git("reset", "-q", "--hard", "HEAD~1"), []],
      ["edit and commit again", editAndCommit(repo), [CONFIG]],
      ["undo that with git revert, a new commit that changes the file", () => repo.git("revert", "--no-edit", "HEAD"), [CONFIG]],
    ];
    for (const [name, command, expected] of steps) expect(await lockedBy(repo, command), name).toEqual(expected);
    repo.write(CONFIG, "export default [7];\n");
    expect(await lockedBy(repo, () => repo.git("stash", "-q")), "stash").toEqual([]);
    expect(await lockedBy(repo, () => repo.git("stash", "pop", "-q")), "stash pop").toEqual([CONFIG]);
    expect(await lockedBy(repo, () => repo.git("checkout", "--", CONFIG)), "checkout --").toEqual([]);
    repo.git("checkout", "-qb", "feature", base);
    repo.write("README.md", "b\n");
    repo.git("commit", "-qam", "Feature work");
    expect(await lockedBy(repo, () => repo.git("rebase", "-q", "other")), "rebase onto a newer harness").toEqual([]);
    expect(await lockedBy(repo, () => repo.write("README.md", "c\n")), "nothing locked").toEqual([]);
  });

  it("passes a real pull that merges a harness change from a bare remote into a diverged branch", async () => {
    const repo = makeRepo({ [CONFIG]: "export default [];\n", "README.md": "a\n" });
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "harness-remote-"));
    remotes.push(parent);
    const bare = path.join(parent, "origin.git");
    const teammate = path.join(parent, "teammate");
    repo.git("clone", "-q", "--bare", repo.root, bare);
    repo.git("remote", "add", "origin", bare);
    repo.git("fetch", "-q", "origin");
    repo.git("branch", "-q", "--set-upstream-to=origin/main");
    repo.git("clone", "-q", bare, teammate);
    fs.writeFileSync(path.join(teammate, CONFIG), "export default [3];\n");
    repo.git("-C", teammate, "-c", "user.name=Teammate", "-c", "user.email=teammate@example.invalid", "commit", "-qam", "Update the harness");
    repo.git("-C", teammate, "push", "-q", "origin", "main");
    repo.write("README.md", "local\n");
    repo.git("commit", "-qam", "Local work");
    expect(await lockedBy(repo, () => repo.git("pull", "-q", "--no-rebase", "--no-edit"))).toEqual([]);
    expect(repo.read(CONFIG)).toBe("export default [3];\n");
    expect(repo.git("rev-list", "--count", "--merges", "HEAD").trim()).toBe("1");
  });

  it("names each file a command committed, and keeps the formatter message for uncommitted changes", async () => {
    const files = ["a", "b", "c", "d"].map((name) => `tooling/harness/${name}.ts`);
    const repo = makeRepo(Object.fromEntries(files.map((file) => [file, "export const value = 1;\n"])));
    const edit = (): void => {
      for (const file of files) repo.write(file, "export const value = 2;\n");
    };
    const bash = bashEvent(repo.root);
    await handleEvent(bash, repo.root);
    edit();
    const uncommitted = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
    expect(uncommitted.findings?.map((finding) => finding.file)).toEqual(["tooling/harness"]);
    expect(uncommitted.reason).toContain("a formatter or codemod touched them");
    repo.git("checkout", "--", "tooling/harness");
    await handleEvent(bash, repo.root);
    edit();
    repo.git("commit", "-qam", "Edit the harness");
    const committed = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
    expect(committed.findings?.map((finding) => finding.file)).toEqual(files);
    expect(committed.reason).not.toContain("formatter");
  });

  it("allows every case while unlocked", async () => {
    const repo = repoWithBranch();
    unlock(repo.root);
    expect(await lockedBy(repo, editAndCommit(repo))).toEqual([]);
    expect(await lockedBy(repo, () => repo.git("revert", "--no-edit", "HEAD"))).toEqual([]);
  });

  it("judges a shell state written without the HEAD and ref tips by the HEAD after the command", async () => {
    const repo = repoWithBranch();
    const bash = bashEvent(repo.root);
    await handleEvent(bash, repo.root);
    const { snapshotTree } = await import("../state/snapshot.ts");
    writeState(repo.root, sessionFile("shell", "abc123"), { tree: snapshotTree(repo.root), task: null });
    repo.git("checkout", "-q", "other");
    expect((await handleEvent({ ...bash, event: "post-tool" }, repo.root)).kind).toBe("allow");
    await handleEvent(bash, repo.root);
    writeState(repo.root, sessionFile("shell", "abc123"), { tree: snapshotTree(repo.root), task: null });
    repo.write(CONFIG, "export default [5];\n");
    expect((await handleEvent({ ...bash, event: "post-tool" }, repo.root)).findings?.map((finding) => finding.file)).toEqual([CONFIG]);
  });
});
