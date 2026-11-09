import { describe, expect, it } from "vitest";
import { isLocked, lock, lockFindings, unlock, unlocked } from "./lock.ts";
import { makeRepo } from "./testing/temp-repo.ts";

const hour = 3_600_000;

describe("harness lock", () => {
  it.each([
    "tooling/harness/structure.ts",
    "tooling/harness/hooks/guards.ts",
    ".claude/settings.json",
    ".codex/hooks.json",
    ".codex/config.toml",
    ".githooks/pre-push",
    ".github/workflows/check.yml",
    "tsconfig.json",
    "eslint.config.ts",
    "vitest.config.ts",
    ".dependency-cruiser.json",
  ])("locks %s", (file) => {
    expect(isLocked(file)).toBe(true);
  });

  it.each([
    "src/modules/a/index.ts",
    "src/app/page.tsx",
    "tooling/other.ts",
    ".claude/settings.local.json",
    "docs/review-rubric.md",
    "scripts/rename.ts",
    ".env.example",
  ])("leaves %s open", (file) => {
    expect(isLocked(file)).toBe(false);
  });

  it("unlocks for four hours from the given time, then locks again", () => {
    const { root } = makeRepo();
    expect(unlocked(root, 1_000)).toBe(false);
    expect(unlock(root, 1_000)).toBe(1_000 + 4 * hour);
    expect(unlocked(root, 1_000 + 4 * hour - 1)).toBe(true);
    expect(unlocked(root, 1_000 + 4 * hour)).toBe(false);
    unlock(root, 1_000);
    lock(root);
    expect(unlocked(root, 1_000)).toBe(false);
    expect(() => lock(root)).not.toThrow();
  });

  it("reports changed locked files with the unlock instruction, and nothing while unlocked", () => {
    const { root } = makeRepo();
    const findings = lockFindings(root, ["tooling/harness/cli.ts", "src/modules/a/index.ts", ".github/workflows/check.yml"]);
    expect(findings.map((finding) => finding.file)).toEqual(["tooling/harness/cli.ts", ".github/workflows/check.yml"]);
    expect(findings[0]).toMatchObject({ rule: "harness-lock" });
    expect(findings[0]?.message).toContain("pnpm harness:unlock");
    unlock(root);
    expect(lockFindings(root, ["tooling/harness/cli.ts"])).toEqual([]);
  });

  it("does not report a locked file that a revert restored to its committed content", () => {
    const repo = makeRepo({ "tooling/harness/cli.ts": "export const a = 1;\n", "eslint.config.ts": "export default [];\n" });
    repo.write("tooling/harness/cli.ts", "export const a = 2;\n");
    expect(lockFindings(repo.root, ["tooling/harness/cli.ts"]).map((finding) => finding.file)).toEqual(["tooling/harness/cli.ts"]);
    repo.git("checkout", "--", "tooling/harness/cli.ts");
    expect(lockFindings(repo.root, ["tooling/harness/cli.ts"])).toEqual([]);
    repo.write("tooling/harness/new.ts", "export const b = 1;\n");
    repo.remove("eslint.config.ts");
    expect(lockFindings(repo.root, ["tooling/harness/new.ts", "eslint.config.ts"]).map((finding) => finding.file)).toEqual([
      "tooling/harness/new.ts",
      "eslint.config.ts",
    ]);
  });
});
