import { afterEach, describe, expect, it, vi } from "vitest";
import { makerkitRepo } from "../../testing/makerkit-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { doneGate } from "../gates/done-gate.ts";
import * as runner from "../gates/run-tool.ts";
import { resolveHarness } from "../path-check.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";
import { handleEvent } from "./handle.ts";
import { isNestedLintConfig } from "./lint-config-guard.ts";

afterEach(() => vi.restoreAllMocks());

const fileEvent = (root: string, tool: string, file: string): HookEvent =>
  parseEvent(
    "claude",
    {
      session_id: "s",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: file, content: "{}", old_string: "{", new_string: "{ " },
    },
    root,
  );
const bash = (root: string, command: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root);

const NESTED = [
  "packages/features/.oxlintrc.json",
  "apps/web/.oxlintrc.json",
  "packages/features/accounts/.oxlintrc.json",
  "packages/features/journal/.oxlintrc.json",
  "packages/.oxlintrc.jsonc",
  "apps/web/app/.oxlintignore",
  "packages/features/accounts/src/.eslintignore",
  "apps/web/oxlint.config.ts",
  "packages/features/journal/oxlint.config.mjs",
];

describe("nested lint configs in a project with an oxc workspace", () => {
  it.each(NESTED)("denies writing %s, naming the root config", (file) => {
    const { root } = makerkitRepo();
    const denial = checkGuards(fileEvent(root, "Write", file), root);
    expect(denial?.guard).toBe("nested-lint-config");
    expect(denial?.reason).toBe(
      `${file} would replace the project's lint rules for its folder; they belong in the root .oxlintrc.json, which harness.config.ts should list in locked. Ask the user to change the root config instead.`,
    );
  });

  it("denies editing an existing nested config in a kit package", () => {
    const file = "packages/features/accounts/.oxlintrc.json";
    const { root } = makerkitRepo({ [file]: "{}\n" });
    expect(checkGuards(fileEvent(root, "Edit", file), root)?.guard).toBe("nested-lint-config");
  });

  it("leaves the root files to the lock and other names alone", () => {
    const { root } = makerkitRepo();
    for (const file of [".oxlintrc.json", ".eslintignore", "oxlint.config.ts"]) expect(checkGuards(fileEvent(root, "Write", file), root)).toBeNull();
    expect(checkGuards(fileEvent(root, "Write", "packages/features/accounts/oxlintrc.json"), root)).toBeNull();
    expect(checkGuards(fileEvent(root, "Write", "packages/features/accounts/.oxlintrc.json.bak"), root)).toBeNull();
  });

  it("is inert in a project without an oxc workspace", () => {
    const { root } = makeRepo();
    expect(isNestedLintConfig(resolveHarness(root), "apps/web/.oxlintrc.json")).toBe(false);
    expect(isNestedLintConfig(resolveHarness(makerkitRepo().root), "apps/web/.oxlintrc.json")).toBe(true);
  });

  it("blocks a nested config a shell command created, and Done reports it whatever the file's class", async () => {
    const repo = makerkitRepo();
    const event = bash(repo.root, "echo '{}' > packages/features/.oxlintrc.json");
    expect(await handleEvent(event, repo.root)).toEqual({ kind: "allow" });
    repo.write("packages/features/.oxlintrc.json", "{}\n");
    const after = await handleEvent({ ...event, event: "post-tool" }, repo.root);
    expect(after).toMatchObject({ kind: "block", findings: [{ rule: "nested-lint-config", file: "packages/features/.oxlintrc.json" }] });

    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    repo.write("packages/features/accounts/.eslintignore", "src\n");
    const result = await doneGate(repo.root, ["packages/features/.oxlintrc.json", "packages/features/accounts/.eslintignore"]);
    expect(result.passed).toBe(false);
    expect(result.findings.filter((finding) => finding.rule === "nested-lint-config").map((finding) => finding.file)).toEqual([
      "packages/features/.oxlintrc.json",
      "packages/features/accounts/.eslintignore",
    ]);
  });
});
