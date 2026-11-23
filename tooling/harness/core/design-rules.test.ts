import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import { designRulesFile, hasInterface } from "./design-rules.ts";
import { resolveHarness } from "./path-check.ts";

const config = (workspaces: object[]): string => `export default ${JSON.stringify({ workspaces })};\n`;

describe("designRulesFile", () => {
  it("finds the root file, else docs/, else nothing", () => {
    expect(designRulesFile(makeRepo().root)).toBeUndefined();
    expect(designRulesFile(makeRepo({ "DESIGN_RULES.md": "# Rules\n" }).root)).toBe("DESIGN_RULES.md");
    expect(designRulesFile(makeRepo({ "docs/DESIGN_RULES.md": "# Rules\n" }).root)).toBe("docs/DESIGN_RULES.md");
  });

  it("takes the root file when both exist", () => {
    expect(designRulesFile(makeRepo({ "DESIGN_RULES.md": "# Root\n", "docs/DESIGN_RULES.md": "# Docs\n" }).root)).toBe("DESIGN_RULES.md");
  });

  it("counts a dangling link as present, so nothing is written through it", () => {
    const repo = makeRepo();
    fs.symlinkSync(path.join(repo.root, "missing.md"), path.join(repo.root, "DESIGN_RULES.md"));
    expect(designRulesFile(repo.root)).toBe("DESIGN_RULES.md");
  });

  it("looks at the repository root only, not inside a workspace", () => {
    const repo = makeRepo({ "harness.config.ts": config([{ path: "apps/web", shape: "next-modules" }]), "apps/web/DESIGN_RULES.md": "# Rules\n" });
    expect(designRulesFile(repo.root)).toBeUndefined();
  });
});

describe("hasInterface", () => {
  it("is true for a shape with shared/ui/ and for a workspace with components.json, and false otherwise", () => {
    const repo = makeRepo({
      "harness.config.ts": config([
        { path: "apps/web", shape: "next-modules" },
        { path: "packages/billing", shape: "package" },
        { path: "packages/widgets", shape: "package" },
      ]),
      "apps/web/package.json": "{}\n",
      "packages/billing/package.json": "{}\n",
      "packages/widgets/components.json": "{}\n",
    });
    const verdicts = Object.fromEntries(resolveHarness(repo.root).workspaces.map((workspace) => [workspace.path, hasInterface(repo.root, workspace)]));
    expect(verdicts).toEqual({ "apps/web": true, "packages/billing": false, "packages/widgets": true });
  });
});
