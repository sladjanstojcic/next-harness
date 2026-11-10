import { describe, expect, it } from "vitest";
import { makeRepo } from "./temp-repo.ts";
import { harnessKnip, harnessKnipWorkspace } from "../presets/knip.ts";

const PACKAGE = JSON.stringify({ dependencies: { "server-only": "0.0.1" }, devDependencies: { "@eslint/js": "9.39.5", eslint: "9.39.5" } });

describe("the knip preset", () => {
  it("lists only the entries, ignores and dependencies a project has", () => {
    const repo = makeRepo({ "package.json": PACKAGE, "src/shared/lib/env.ts": "export const env = {};\n" });
    expect(harnessKnip(repo.root)).toEqual({
      next: true,
      entry: ["src/shared/lib/env.ts"],
      ignore: ["tooling/harness/**"],
      ignoreDependencies: ["server-only", "@eslint/js"],
    });
  });

  it("gives its settings to the root workspace where the harness is a workspace package", () => {
    const repo = makeRepo({ "package.json": PACKAGE, "pnpm-workspace.yaml": "packages:\n  - tooling/harness\n", "src/shared/ui/button.tsx": "" });
    expect(harnessKnip(repo.root)).toEqual({
      ignoreWorkspaces: ["tooling/harness"],
      workspaces: { ".": { next: true, entry: [], ignore: ["src/shared/ui/**"], ignoreDependencies: ["server-only", "@eslint/js"] } },
    });
  });

  it("leaves the harness and its preset tools to analysis in the harness's own repository", () => {
    const repo = makeRepo({ "package.json": PACKAGE });
    expect(harnessKnipWorkspace({ harness: "analyse" }, repo.root)).toEqual({ next: true, entry: [], ignore: [], ignoreDependencies: ["server-only"] });
  });
});
