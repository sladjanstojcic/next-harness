import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HookEvent } from "./hooks/event.ts";
import { stateDir } from "./state/state-file.ts";
import { markFalseBlock, readBlocks, recordBlock, summarizeBlocks } from "./telemetry.ts";
import { makeRepo } from "./testing/temp-repo.ts";

const at = new Date("2026-11-09T10:00:00.000Z");
const event = (root: string, name: HookEvent["event"] = "pre-tool"): HookEvent => ({
  client: "claude",
  event: name,
  sessionId: "s1",
  cwd: root,
  paths: [],
  writePaths: [],
});

describe("block telemetry", () => {
  it("records denials and blocks with their rules and files, never allows", () => {
    const { root } = makeRepo();
    expect(recordBlock(root, event(root), { kind: "allow" }, at)).toBeNull();
    const denied = recordBlock(root, event(root), { kind: "deny", reason: "src-shape: put it in a module", guard: "structure-write" }, at);
    const blocked = recordBlock(
      root,
      event(root, "stop"),
      {
        kind: "block",
        reason: "report",
        findings: [
          { rule: "max-lines", file: "src/modules/a/components/x.ts", message: "too long" },
          { rule: "tsc-failed", file: "", message: "tsc" },
        ],
      },
      at,
    );
    expect(denied).toMatch(/^[0-9a-f]{6}$/);
    expect(readBlocks(root)).toEqual([
      expect.objectContaining({
        id: denied,
        event: "pre-tool",
        kind: "deny",
        rules: ["structure-write"],
        files: [],
        text: "src-shape: put it in a module",
        falseBlock: null,
      }),
      expect.objectContaining({ id: blocked, event: "stop", kind: "block", rules: ["max-lines", "tsc-failed"], files: ["src/modules/a/components/x.ts"] }),
    ]);
  });

  it("marks a false block by id and ignores unknown ids and corrupt lines", () => {
    const { root } = makeRepo();
    const id = recordBlock(root, event(root), { kind: "deny", reason: "no", guard: "env-file-write" }, at);
    fs.appendFileSync(path.join(stateDir(root), "blocks.jsonl"), '{not json\n{"type":"other"}\n');
    expect(markFalseBlock(root, "nope", "unknown", at)).toBe(false);
    expect(markFalseBlock(root, id ?? "", "the file was .env.example.local, which is documentation", at)).toBe(true);
    expect(readBlocks(root)).toEqual([
      expect.objectContaining({ id, falseBlock: { at: at.toISOString(), note: "the file was .env.example.local, which is documentation" } }),
    ]);
  });

  it("summarizes blocks per rule with the false count and lists the recent ones", () => {
    const { root } = makeRepo();
    expect(summarizeBlocks(root)).toBe("No blocks recorded yet.");
    for (let index = 0; index < 3; index += 1) recordBlock(root, event(root), { kind: "deny", reason: "no", guard: "structure-write" }, at);
    const marked = recordBlock(
      root,
      event(root, "post-tool"),
      { kind: "block", reason: "r", findings: [{ rule: "thin-page", file: "src/app/page.tsx", message: "m" }] },
      at,
    );
    markFalseBlock(root, marked ?? "", "generated page", at);
    const summary = summarizeBlocks(root, 2);
    expect(summary).toContain("     3      0  structure-write");
    expect(summary).toContain("     1      1  thin-page");
    expect(summary).toContain("Last 2 of 4");
    expect(summary).toContain(`${marked ?? ""}  ${at.toISOString()}  claude/post-tool  block  thin-page  src/app/page.tsx  FALSE: generated page`);
  });
});
