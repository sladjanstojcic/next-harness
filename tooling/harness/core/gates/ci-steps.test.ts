import { describe, expect, it } from "vitest";
import { resolveHarness } from "../path-check.ts";
import { PB, POCKETBASE_PROJECT, pocketbaseRepo } from "../../testing/pocketbase/pocketbase-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { toolWorkspaces } from "../../tools/index.ts";
import { checkSteps, testStep } from "./ci-steps.ts";

const E2E = "apps/e2e";

function groupOf(root: string, workspacePath: string) {
  const group = toolWorkspaces(root, resolveHarness(root).workspaces).find(({ workspace }) => workspace.path === workspacePath);
  if (group === undefined) throw new Error(`no tool workspace at ${workspacePath}`);
  return group;
}

const stepOf = (root: string, workspacePath: string) => testStep(root, groupOf(root, workspacePath));
const VENDORED = "types/pocketbase-0.40.5.d.ts";

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

describe("checkSteps", () => {
  it("leaves a pocketbase workspace's vendored declarations out of the format check and the lint", () => {
    const repo = pocketbaseRepo({ [`${PB}/${VENDORED}`]: "declare const $app: unknown;\n", [`${PB}/types/own.d.ts`]: "export {};\n" });
    for (const perFile of [false, true]) {
      const { format, lint } = checkSteps(groupOf(repo.root, PB), perFile);
      const command = "command" in format ? format.command : [];
      expect(command).not.toContain(VENDORED);
      expect(command).toContain("types/own.d.ts");
      expect(lint.command.slice(-2)).toEqual(["--ignore-pattern", VENDORED]);
    }
  });

  it("runs no format check where every source file is vendored, so oxfmt cannot fall back to the whole folder", () => {
    const repo = makeRepo({
      "harness.config.ts": POCKETBASE_PROJECT["harness.config.ts"] ?? "",
      [`${PB}/tsconfig.json`]: '{ "compilerOptions": { "strict": true } }\n',
      [`${PB}/${VENDORED}`]: "declare const $app: unknown;\n",
    });
    for (const perFile of [false, true]) {
      expect(checkSteps(groupOf(repo.root, PB), perFile).format).toEqual({ name: "oxfmt", skipped: "no source files" });
    }
  });

  it("lints an e2e workspace with no ignore pattern", () => {
    const repo = makeRepo({
      "harness.config.ts": `export default { workspaces: [{ path: "apps/web", shape: "makerkit-app", next: true }, { path: "${E2E}", shape: "e2e" }], root: { entries: ["apps"] } };\n`,
      "apps/web/package.json": "{}\n",
      [`${E2E}/package.json`]: "{}\n",
    });
    expect(checkSteps(groupOf(repo.root, E2E), false).lint.command).not.toContain("--ignore-pattern");
  });
});
