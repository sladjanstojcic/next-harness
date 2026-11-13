import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockIn, harnessBlock, sameBlock } from "../core/init/agents/agents-block.ts";
import { auditAgentsBlock } from "../core/init/agents/agents-rule.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");

describe("this repository's AGENTS.md", () => {
  it("stays within 200 lines, since a longer instruction file is followed less", () => {
    expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(200);
  });

  it("holds the block init writes and passes the agents-block rule", () => {
    const range = blockIn(text);
    if (typeof range === "string") throw new Error(`block ${range}`);
    expect(sameBlock(text.slice(range.start, range.end), harnessBlock(root))).toBe(true);
    expect(auditAgentsBlock(root)).toEqual([]);
  });
});
