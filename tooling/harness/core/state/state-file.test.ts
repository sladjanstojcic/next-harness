import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { pruneSessionState, sessionFile, stateDir, writeState } from "./state-file.ts";

describe("per-session state files", () => {
  it("names task and shell state after the session and keeps the name file-safe", () => {
    expect(sessionFile("task", "abc123")).toBe("task-abc123.json");
    expect(sessionFile("shell", "thr_123")).toBe("shell-thr_123.json");
    expect(sessionFile("task", "../evil/../x y")).toBe("task-..-evil-..-x-y.json");
    expect(sessionFile("task", "")).toBe("task-default.json");
    expect(sessionFile("task", "a".repeat(100))).toHaveLength("task-.json".length + 64);
  });

  it("prunes session files older than a week and keeps everything else", () => {
    const { root } = makeRepo();
    writeState(root, sessionFile("task", "old"), { tree: "t" });
    writeState(root, sessionFile("shell", "old"), { tree: "t" });
    writeState(root, sessionFile("task", "new"), { tree: "t" });
    writeState(root, "unlock.json", { until: 1 });
    const week = 7 * 86_400_000;
    const old = new Date(1_000_000);
    for (const name of ["task-old.json", "shell-old.json"]) fs.utimesSync(path.join(stateDir(root), name), old, old);
    pruneSessionState(root, 1_000_000 + week + 1);
    expect(fs.readdirSync(stateDir(root)).sort()).toEqual(["task-new.json", "unlock.json"]);
  });
});
