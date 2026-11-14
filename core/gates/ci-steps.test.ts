import { describe, expect, it } from "vitest";
import { resolveHarness } from "../path-check.ts";
import { PB, pocketbaseRepo } from "../../testing/pocketbase/pocketbase-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { toolWorkspaces } from "../../tools/index.ts";
import { testStep } from "./ci-steps.ts";

const E2E = "apps/e2e";

function stepOf(root: string, workspacePath: string) {
  const group = toolWorkspaces(root, resolveHarness(root).workspaces).find(({ workspace }) => workspace.path === workspacePath);
  if (group === undefined) throw new Error(`no tool workspace at ${workspacePath}`);
  return testStep(root, group);
}

const withTest = `export default {
  workspaces: [
    { path: ".", shape: "next-modules", next: true },
    { path: "pocketbase", shape: "pocketbase", test: "test:pocketbase" },
  ],
  root: { entries: ["pocketbase"] },
};
`;

describe("testStep", () => {
  it("skips a pocketbase workspace without a test script", () => {
    expect(stepOf(pocketbaseRepo().root, PB)).toEqual({ name: "test", skipped: "no test script" });
  });

  it("runs a pocketbase workspace's own test script", () => {
    const step = stepOf(pocketbaseRepo({ "harness.config.ts": withTest }).root, PB);
    expect("command" in step ? step.command.at(-1) : step).toBe("test:pocketbase");
  });

  it("keeps Vitest for an e2e workspace without a test script", () => {
    const repo = makeRepo({
      "harness.config.ts": `export default { workspaces: [{ path: "apps/web", shape: "makerkit-app", next: true }, { path: "${E2E}", shape: "e2e" }], root: { entries: ["apps"] } };\n`,
      "apps/web/package.json": "{}\n",
      [`${E2E}/package.json`]: "{}\n",
    });
    expect(stepOf(repo.root, E2E)).toMatchObject({ name: "vitest" });
  });
});
