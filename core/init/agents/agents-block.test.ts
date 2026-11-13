import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, type RepoFixture } from "../../../testing/temp-repo.ts";
import { agentsSizeNote, agentsStep, BLOCK_END, BLOCK_START, blockIn, claudeStep, harnessBlock, sameBlock } from "./agents-block.ts";

const TWO = 'export default { workspaces: [{ path: "apps/web", shape: "vite-spa" }, { path: "packages/*", shape: "package" }] };\n';
const count = (text: string, part: string): number => text.split(part).length - 1;

/** Makes a file unreadable for the test; the fixture's cleanup removes it either way. */
function unreadable(repo: RepoFixture, file: string): void {
  fs.chmodSync(path.join(repo.root, file), 0o000);
}

function run(repo: RepoFixture, step = agentsStep(repo.root)) {
  step.apply?.();
  return step;
}

describe("harnessBlock", () => {
  it("holds the root workspace's guide with its own headings and the common sections once", () => {
    const block = harnessBlock(makeRepo().root);
    expect(block.startsWith(`${BLOCK_START}\n\n## Architecture and why\n`)).toBe(true);
    expect(block.endsWith(`\n\n${BLOCK_END}`)).toBe(true);
    expect(count(block, "## Architecture and why")).toBe(1);
    expect(block).not.toContain("## Architecture and why:");
    expect(count(block, "## Checks and the lock")).toBe(1);
  });

  it("names each workspace in its headings, a /* entry without folders too", () => {
    const block = harnessBlock(makeRepo({ "harness.config.ts": TWO }).root);
    for (const heading of [
      "## Architecture and why: apps/web (vite-spa)\n",
      "## Where code goes: apps/web\n",
      "## Architecture and why: packages/* (package)\n",
      "## Where code goes: packages/*\n",
    ]) {
      expect(count(block, heading), heading).toBe(1);
    }
    for (const common of ["## Checks and the lock", "## Repair budget", "## What linters cannot see"]) expect(count(block, common), common).toBe(1);
    expect(count(block, "the paths in it start at each of those folders")).toBe(1);
    expect(harnessBlock(makeRepo().root)).not.toContain("the paths in it start at each of those folders");
  });

  it("shares one pair across the entries that use the same guide, headed by their paths", () => {
    const three =
      'export default { workspaces: [{ path: "apps/web", shape: "next-modules" }, { path: "apps/docs", shape: "next-modules" }, { path: "packages/*", shape: "package" }] };\n';
    const block = harnessBlock(makeRepo({ "harness.config.ts": three }).root);
    expect(count(block, "## Architecture and why")).toBe(2);
    expect(count(block, "## Architecture and why: apps/web, apps/docs (next-modules)\n")).toBe(1);
    expect(count(block, "## Where code goes: apps/web, apps/docs\n")).toBe(1);
  });
});

describe("blockIn", () => {
  it("ignores markers inside a code fence and finds one pair outside it", () => {
    expect(blockIn(`\`\`\`md\n${BLOCK_START}\n${BLOCK_END}\n\`\`\`\n`)).toBe("none");
    const text = `a\n${BLOCK_START}\nb\n${BLOCK_END}\nc\n`;
    const range = blockIn(text);
    expect(range).not.toBeTypeOf("string");
    if (typeof range !== "string") expect(text.slice(range.start, range.end)).toBe(`${BLOCK_START}\nb\n${BLOCK_END}`);
    expect(blockIn(`a\n${BLOCK_END}\n`)).toBe("broken");
    expect(blockIn(` ${BLOCK_START}\n`)).toBe("none");
  });
});

describe("agentsStep", () => {
  it("creates AGENTS.md, an empty one too, and a second apply changes nothing", () => {
    for (const files of [{}, { "AGENTS.md": "" }]) {
      const repo = makeRepo(files);
      expect(run(repo).status).toBe("created");
      expect(repo.read("AGENTS.md")).toBe(`${harnessBlock(repo.root)}\n`);
      const second = run(repo);
      expect(second.status).toBe("unchanged");
      expect(second.apply).toBeUndefined();
    }
  });

  for (const eol of ["\n", "\r\n"]) {
    const name = JSON.stringify(eol);
    it(`appends after one blank line and keeps ${name} line endings`, () => {
      for (const before of [`# Project${eol}${eol}Own rules.${eol}`, `# Project${eol}Own rules.`]) {
        const repo = makeRepo({ "AGENTS.md": before });
        const block = harnessBlock(repo.root).replaceAll("\n", eol);
        expect(run(repo).status).toBe("updated");
        const lead = before.endsWith(eol) ? `${before}${eol}` : `${before}${eol}${eol}`;
        expect(repo.read("AGENTS.md")).toBe(`${lead}${block}${eol}`);
        expect(run(repo).status).toBe("unchanged");
      }
    });

    it(`replaces a stale block in place with ${name} line endings and keeps both outer texts`, () => {
      const beforeText = `# Project${eol}${eol}`;
      const afterText = `${eol}${eol}## Own section${eol}Text.`;
      const repo = makeRepo({ "AGENTS.md": `${beforeText}${BLOCK_START}${eol}old${eol}${BLOCK_END}${afterText}` });
      const block = harnessBlock(repo.root).replaceAll("\n", eol);
      const step = run(repo);
      expect(step.status).toBe("updated");
      expect(step.detail).toContain("replaced");
      expect(repo.read("AGENTS.md")).toBe(`${beforeText}${block}${afterText}`);
      expect(run(repo).status).toBe("unchanged");
    });
  }

  it("appends when the only markers sit inside a code fence", () => {
    const before = `Example:\n\n\`\`\`md\n${BLOCK_START}\n${BLOCK_END}\n\`\`\`\n`;
    const repo = makeRepo({ "AGENTS.md": before });
    expect(run(repo).status).toBe("updated");
    expect(repo.read("AGENTS.md")).toBe(`${before}\n${harnessBlock(repo.root)}\n`);
  });

  it("keeps a file with a stray marker, and a folder, and does not throw", () => {
    const stray = makeRepo({ "AGENTS.md": `# Project\n\n${BLOCK_START}\n` });
    const step = agentsStep(stray.root);
    expect(step).toMatchObject({ status: "kept", todo: true });
    expect(step.detail).toContain("remove the stray marker and rerun init");
    expect(step.apply).toBeUndefined();

    const folder = makeRepo({ "AGENTS.md/notes.md": "x\n" });
    expect(agentsStep(folder.root)).toMatchObject({ status: "kept", todo: true });
    expect(agentsSizeNote(folder.root)).toEqual([]);
  });
});

describe("agentsStep on markers that form no block", () => {
  for (const [name, markers] of [
    ["a lone end marker", BLOCK_END],
    ["two blocks", `${BLOCK_START}\na\n${BLOCK_END}\n\n${BLOCK_START}\nb\n${BLOCK_END}`],
    ["an end marker before the start", `${BLOCK_END}\na\n${BLOCK_START}`],
  ]) {
    it(`keeps a file with ${name ?? ""} and leaves it untouched`, () => {
      const before = `# Project\n\n${markers ?? ""}\n`;
      const repo = makeRepo({ "AGENTS.md": before });
      const step = agentsStep(repo.root);
      expect(step).toMatchObject({ status: "kept", todo: true });
      expect(step.apply).toBeUndefined();
      expect(repo.read("AGENTS.md")).toBe(before);
    });
  }
});

describe("sameBlock", () => {
  it("sees a rewrapped, reindented block as unchanged and a changed word as an update", () => {
    const repo = makeRepo();
    const block = harnessBlock(repo.root);
    const reflowed = block.replace(/^- /m, "-   ").replace(/^(- \S+ \S+) /m, "$1\n  ");
    expect(reflowed).not.toBe(block);
    expect(sameBlock(reflowed, block)).toBe(true);
    repo.write("AGENTS.md", `${reflowed}\n`);
    expect(agentsStep(repo.root).status).toBe("unchanged");
    expect(repo.read("AGENTS.md")).toBe(`${reflowed}\n`);

    const changed = block.replace("## Repair budget\n\n", "## Repair budget\n\nChanged ");
    expect(sameBlock(changed, block)).toBe(false);
    repo.write("AGENTS.md", `${changed}\n`);
    expect(run(repo).status).toBe("updated");
    expect(repo.read("AGENTS.md")).toBe(`${block}\n`);
  });
});

describe("unreadable files", () => {
  it("keeps an unreadable AGENTS.md and CLAUDE.md with the error, and notes no size", () => {
    const repo = makeRepo({ "AGENTS.md": "# Project\n", "CLAUDE.md": "# Notes\n" });
    unreadable(repo, "AGENTS.md");
    unreadable(repo, "CLAUDE.md");
    const agents = agentsStep(repo.root);
    expect(agents).toMatchObject({ status: "kept", todo: true });
    expect(agents.detail).toBe("AGENTS.md cannot be read (EACCES); make it readable and rerun init");
    const claude = claudeStep(repo.root);
    expect(claude).toMatchObject({ status: "kept", todo: true });
    expect(claude.detail).toBe("CLAUDE.md cannot be read (EACCES); make it readable and rerun init");
    expect(agentsSizeNote(repo.root)).toEqual([]);
  });
});

describe("claudeStep", () => {
  it("creates the import, sees an existing one and asks for it otherwise", () => {
    const absent = makeRepo();
    expect(run(absent, claudeStep(absent.root)).status).toBe("created");
    expect(absent.read("CLAUDE.md")).toBe("@AGENTS.md\n");
    expect(claudeStep(makeRepo({ "CLAUDE.md": "# Notes\r\n@AGENTS.md\r\n" }).root).status).toBe("unchanged");
    expect(claudeStep(makeRepo({ "CLAUDE.md": "# Notes\n" }).root)).toEqual({
      target: "CLAUDE.md",
      status: "kept",
      detail: "add the line @AGENTS.md so Claude Code reads the harness rules",
      todo: true,
    });
  });
});

describe("agentsSizeNote", () => {
  it("says nothing under 32 KiB and names the size over it", () => {
    const small = makeRepo();
    expect(agentsSizeNote(small.root)).toEqual([]);
    const large = makeRepo({ "AGENTS.md": `${"x".repeat(40_000)}\n` });
    const bytes = Buffer.byteLength(`${"x".repeat(40_000)}\n\n${harnessBlock(large.root)}\n`);
    expect(agentsSizeNote(large.root)).toEqual([
      `AGENTS.md is ${String(bytes)} bytes; Codex stops reading project instructions at 32 KiB (project_doc_max_bytes). Shorten the part outside the harness block.`,
    ]);
    expect(fs.existsSync(path.join(small.root, "AGENTS.md"))).toBe(false);
  });
});
