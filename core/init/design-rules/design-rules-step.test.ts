import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, type RepoFixture } from "../../../testing/temp-repo.ts";
import { classify } from "../../classes.ts";
import { isLocked } from "../../lock.ts";
import { resolveHarness } from "../../path-check.ts";
import { initHarness } from "../init.ts";
import { designRulesSteps } from "./design-rules-step.ts";

const DEFAULT_RULES = fs.readFileSync(path.resolve(import.meta.dirname, "../../../presets/design-rules.md"), "utf8");
const OWN = "# Our design rules\n\nRounded corners only.\n";
const PACKAGE_ONLY = 'export default { workspaces: [{ path: "packages/billing", shape: "package" }] };\n';

const steps = (repo: RepoFixture) => designRulesSteps(repo.root, resolveHarness(repo.root).workspaces);

function consumer(files: Record<string, string>): RepoFixture {
  const repo = makeRepo({ "package.json": '{ "name": "consumer" }\n', ...files });
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

describe("design rules step", () => {
  it("writes the default design rules at the root when the project has none", () => {
    const repo = makeRepo();
    const [step] = steps(repo);
    expect(step).toMatchObject({ target: "DESIGN_RULES.md", status: "created", detail: "default design rules" });
    step?.apply?.();
    expect(repo.read("DESIGN_RULES.md")).toBe(DEFAULT_RULES);
    expect(steps(repo)).toEqual([{ target: "DESIGN_RULES.md", status: "unchanged", detail: "default design rules" }]);
  });

  it("takes the default with Windows line endings as unchanged", () => {
    const repo = makeRepo({ "DESIGN_RULES.md": DEFAULT_RULES.replace(/\n/g, "\r\n") });
    expect(steps(repo)).toEqual([{ target: "DESIGN_RULES.md", status: "unchanged", detail: "default design rules" }]);
  });

  it.each([
    ["DESIGN_RULES.md", OWN],
    ["DESIGN_RULES.md", ""],
    ["docs/DESIGN_RULES.md", OWN],
  ])("keeps the project's own %s and writes no second file", (file, text) => {
    const repo = makeRepo({ [file]: text });
    expect(steps(repo)).toEqual([{ target: file, status: "kept", detail: "your design rules stay" }]);
  });

  it("reports the root file when both exist", () => {
    const repo = makeRepo({ "DESIGN_RULES.md": OWN, "docs/DESIGN_RULES.md": OWN });
    expect(steps(repo)).toEqual([{ target: "DESIGN_RULES.md", status: "kept", detail: "your design rules stay" }]);
  });

  it("reports a path it cannot read and leaves it alone: a folder, a dangling link", () => {
    const folder = makeRepo({ "DESIGN_RULES.md/notes.md": OWN });
    expect(steps(folder)).toEqual([{ target: "DESIGN_RULES.md", status: "kept", detail: "cannot be read (EISDIR); init leaves it alone" }]);
    const linked = makeRepo();
    fs.symlinkSync(path.join(linked.root, "missing.md"), path.join(linked.root, "DESIGN_RULES.md"));
    expect(steps(linked)).toEqual([{ target: "DESIGN_RULES.md", status: "kept", detail: "cannot be read (ENOENT); init leaves it alone" }]);
    expect(fs.existsSync(path.join(linked.root, "missing.md"))).toBe(false);
  });

  it("writes nothing in a project whose workspaces have no interface", () => {
    expect(steps(makeRepo({ "harness.config.ts": PACKAGE_ONLY, "packages/billing/package.json": "{}\n" }))).toEqual([]);
    const withShadcn = makeRepo({ "harness.config.ts": PACKAGE_ONLY, "packages/billing/components.json": "{}\n" });
    expect(steps(withShadcn)).toMatchObject([{ target: "DESIGN_RULES.md", status: "created" }]);
  });

  it("is written by init", () => {
    const fresh = consumer({});
    expect(initHarness(fresh.root, { force: false, starter: false }).report).toContain("created DESIGN_RULES.md: default design rules");
    expect(fresh.read("DESIGN_RULES.md")).toBe(DEFAULT_RULES);
  });

  it("is never replaced by init, even with --force", () => {
    const own = consumer({ "DESIGN_RULES.md": OWN });
    expect(initHarness(own.root, { force: true, starter: false }).report).toContain("kept DESIGN_RULES.md: your design rules stay");
    expect(own.read("DESIGN_RULES.md")).toBe(OWN);
  });

  it("lets init continue past a path it cannot read", () => {
    const folder = consumer({ "DESIGN_RULES.md/notes.md": OWN });
    const result = initHarness(folder.root, { force: false, starter: false });
    expect(result.ok).toBe(true);
    expect(result.report).toContain("kept DESIGN_RULES.md: cannot be read (EISDIR); init leaves it alone");
    expect(result.report).toContain("created AGENTS.md: harness rules");
  });

  it("stays the user's file: neither locked nor vendored", () => {
    const harness = resolveHarness(makeRepo().root);
    for (const file of ["DESIGN_RULES.md", "docs/DESIGN_RULES.md"]) {
      expect(isLocked(file), file).toBe(false);
      expect(classify(file, harness, new Set()), file).not.toBe("vendored");
    }
  });
});
