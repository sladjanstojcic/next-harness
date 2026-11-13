import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_LEGACY, DASHBOARD_LEGACY_FILES, dashboardRepo } from "../../../testing/dashboard-repo.ts";
import { makeRepo } from "../../../testing/temp-repo.ts";
import { doneGate } from "../../gates/done-gate.ts";
import * as runner from "../../gates/run-tool.ts";
import { agentsStep, BLOCK_END, BLOCK_START, harnessBlock } from "./agents-block.ts";
import { auditAgentsBlock } from "./agents-rule.ts";

afterEach(() => vi.restoreAllMocks());

const STALE = [
  {
    rule: "agents-block",
    file: "AGENTS.md",
    message:
      "The harness rules in AGENTS.md are missing or out of date. Run: node tooling/harness/cli.ts init, then commit only AGENTS.md and CLAUDE.md; any other step init prints is the user's.",
  },
];

describe("auditAgentsBlock", () => {
  it("reports a missing file, a file without a block and a stray marker", () => {
    expect(auditAgentsBlock(makeRepo().root)).toEqual(STALE);
    expect(auditAgentsBlock(makeRepo({ "AGENTS.md": "# Project\n" }).root)).toEqual(STALE);
    expect(auditAgentsBlock(makeRepo({ "AGENTS.md": `# Project\n\n${BLOCK_START}\n` }).root)).toEqual(STALE);
  });

  it("passes a current block whatever the text around it, with either line ending", () => {
    const repo = makeRepo();
    const block = harnessBlock(repo.root);
    repo.write("AGENTS.md", `${block}\n`);
    expect(auditAgentsBlock(repo.root)).toEqual([]);
    repo.write("AGENTS.md", `# Changed project\n\nOwn rules.\n\n${block}\n\n## After\nMore.\n`);
    expect(auditAgentsBlock(repo.root)).toEqual([]);
    repo.write("AGENTS.md", `# Project\r\n\r\n${block.replaceAll("\n", "\r\n")}\r\n`);
    expect(auditAgentsBlock(repo.root)).toEqual([]);
  });

  it("passes a block a project's Prettier reflowed, and reports one changed character", () => {
    const repo = makeRepo();
    const block = harnessBlock(repo.root);
    const reflowed = block.replace(/^- /m, "-   ").replace(/^(- \S+ \S+) /m, "$1\n  ");
    expect(reflowed).not.toBe(block);
    repo.write("AGENTS.md", `${reflowed}\n`);
    expect(auditAgentsBlock(repo.root)).toEqual([]);
    const inside = block.indexOf("\n", BLOCK_START.length + 2) + 1;
    const changed = `${block.slice(0, inside)}${block[inside] === "x" ? "y" : "x"}${block.slice(inside + 1)}`;
    expect(changed.endsWith(BLOCK_END)).toBe(true);
    repo.write("AGENTS.md", `${changed}\n`);
    expect(auditAgentsBlock(repo.root)).toEqual(STALE);
  });

  it("is cleared by init's step", () => {
    const repo = makeRepo({ "AGENTS.md": `# Project\n\n${BLOCK_START}\nold\n${BLOCK_END}\n` });
    expect(auditAgentsBlock(repo.root)).toEqual(STALE);
    agentsStep(repo.root).apply?.();
    expect(auditAgentsBlock(repo.root)).toEqual([]);
  });
});

describe("agents-block in the Done gate", () => {
  it("blocks a stale block in a turn that did not touch AGENTS.md, even when it is on the legacy list", async () => {
    const repo = dashboardRepo();
    repo.write(DASHBOARD_LEGACY, `${JSON.stringify({ version: 1, files: [...DASHBOARD_LEGACY_FILES, "AGENTS.md"] }, null, 2)}\n`);
    repo.write("AGENTS.md", `# Project\n\n${BLOCK_START}\nold\n${BLOCK_END}\n`);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "stale block");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await doneGate(repo.root, ["apps/dashboard/src/modules/usage/index.ts"]);
    expect(result.passed).toBe(false);
    expect(result.findings.map(({ file, rule }) => `${file} ${rule}`)).toEqual(["AGENTS.md agents-block"]);
  });
});
