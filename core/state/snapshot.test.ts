import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeRepo } from "../../testing/temp-repo.ts";
import { changedSince, snapshotTree } from "./snapshot.ts";
import { readState, stateDir, writeState } from "./state-file.ts";

describe("working-tree snapshots", () => {
  it("snapshots an empty repository with no commits and a space in its parent path", () => {
    const repo = makeRepo();
    repo.git("update-ref", "-d", "HEAD");
    fs.rmSync(path.join(repo.root, ".git/index"));
    expect(path.dirname(repo.root)).toContain(" ");
    expect(snapshotTree(repo.root)).toMatch(/^[a-f0-9]{40}$/);
    expect(repo.git("symbolic-ref", "HEAD").trim()).toBe("refs/heads/main");
    expect(fs.existsSync(path.join(repo.root, ".git/index"))).toBe(false);
  });

  it("includes new untracked files and returns no paths when unchanged", () => {
    const repo = makeRepo();
    const tree = snapshotTree(repo.root);
    expect(changedSince(repo.root, tree)).toEqual([]);
    repo.write("src/a.ts", "export const a = 1;\n");
    expect(changedSince(repo.root, tree)).toEqual(["src/a.ts"]);
    expect(changedSince(repo.root, snapshotTree(repo.root))).toEqual([]);
  });

  it("ignores build output while retaining tracked files that later match an ignore", () => {
    const repo = makeRepo({ "src/a.ts": "one", ".gitignore": ".next/\n" });
    const tree = snapshotTree(repo.root);
    repo.write(".next/x", "ignored");
    expect(changedSince(repo.root, tree)).toEqual([]);
    repo.write(".gitignore", ".next/\nsrc/a.ts\n");
    repo.write("src/a.ts", "two");
    expect(changedSince(repo.root, tree)).toEqual([".gitignore", "src/a.ts"]);
  });

  it("detects a same-size edit whose mtime equals the index's, as git's racy-clean check does", () => {
    const repo = makeRepo({ "src/a.ts": "export const limit = 1;\n" });
    // On Linux a write in the same clock tick as the commit leaves mtime and ctime equal; utimes cannot
    // replay the ctime part, so the test asks git to judge by mtime alone, as it would in that tick.
    repo.git("config", "core.trustctime", "false");
    const file = path.join(repo.root, "src/a.ts");
    const index = path.join(repo.root, ".git/index");
    const tick = fs.statSync(file).mtime;
    const tree = snapshotTree(repo.root);
    repo.write(file, "export const limit = 2;\n");
    fs.utimesSync(file, tick, tick);
    fs.utimesSync(index, tick, tick);
    expect(changedSince(repo.root, tree)).toEqual(["src/a.ts"]);
  });

  it("reports edits, deletions and unusual names sorted without changing the real index", () => {
    const repo = makeRepo({ "src/z.ts": "old", "src/deleted.ts": "delete" });
    repo.write("src/z.ts", "staged");
    repo.git("add", "src/z.ts");
    const index = fs.readFileSync(path.join(repo.root, ".git/index"));
    const tree = snapshotTree(repo.root);
    repo.write("src/z.ts", "unstaged");
    repo.remove("src/deleted.ts");
    repo.write("src/a space\nü.ts", "new");
    expect(changedSince(repo.root, tree)).toEqual(["src/a space\nü.ts", "src/deleted.ts", "src/z.ts"]);
    expect(fs.readFileSync(path.join(repo.root, ".git/index"))).toEqual(index);
    expect(fs.readdirSync(stateDir(repo.root))).toEqual([]);
  });
});

describe("validated state files", () => {
  const schema = z.object({ tree: z.string() });

  it("round-trips state outside the working tree and rejects corrupt or mistyped state", () => {
    const repo = makeRepo();
    const tree = snapshotTree(repo.root);
    expect(readState(repo.root, "task.json", schema)).toBeNull();
    writeState(repo.root, "task.json", { tree: "snapshot" });
    expect(readState(repo.root, "task.json", schema)).toEqual({ tree: "snapshot" });
    expect(changedSince(repo.root, tree)).toEqual([]);
    writeState(repo.root, "task.json", { tree: 1 });
    expect(readState(repo.root, "task.json", schema)).toBeNull();
    fs.writeFileSync(path.join(stateDir(repo.root), "task.json"), "{");
    expect(readState(repo.root, "task.json", schema)).toBeNull();
    expect(() => writeState(repo.root, "../escape", {})).toThrow();
  });

  it("keeps linked-worktree state separate and snapshots that worktree", () => {
    const repo = makeRepo();
    const linked = path.join(path.dirname(repo.root), "linked");
    repo.git("worktree", "add", "-q", "-b", "linked", linked);
    writeState(repo.root, "task.json", { tree: "main" });
    writeState(linked, "task.json", { tree: "linked" });
    expect(stateDir(linked)).not.toBe(stateDir(repo.root));
    expect(readState(repo.root, "task.json", schema)).toEqual({ tree: "main" });
    expect(readState(linked, "task.json", schema)).toEqual({ tree: "linked" });
    const tree = snapshotTree(linked);
    fs.writeFileSync(path.join(linked, "a.ts"), "new");
    expect(changedSince(linked, tree)).toEqual(["a.ts"]);
  });
});
