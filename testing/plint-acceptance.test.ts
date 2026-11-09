import { afterEach, describe, expect, it, vi } from "vitest";
import { PRE_EXISTING_HEADING } from "../core/classes.ts";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { PLINT_LEGACY, PLINT_LEGACY_FILES, PLINT_MIGRATION, plintRepo } from "./plint-repo.ts";
import type { RepoFixture } from "./temp-repo.ts";

afterEach(() => vi.restoreAllMocks());

const [LEGACY_UTIL, LEGACY_CHART] = PLINT_LEGACY_FILES;
const NEW_MIGRATION = "supabase/migrations/20261109120000_add_tenants.sql";

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "plint", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", name: string, input: Record<string, unknown>) => send(hook, { tool_name: name, tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (name: string, input: Record<string, unknown>) => tool("PreToolUse", name, input),
    /** PreToolUse snapshots the tree, `change` stands in for the command, PostToolUse audits what changed. */
    async shell(command: string, change: () => void) {
      const pre = await tool("PreToolUse", "Bash", { command });
      if (pre.kind !== "allow") return pre;
      change();
      return tool("PostToolUse", "Bash", { command });
    },
  };
}

describe("plint-control-plane dry run (next-modules dashboard, root Supabase, legacy ratchet)", () => {
  it("reports the two legacy files as pre-existing in CI and passes", async () => {
    const repo = plintRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(repo.root);
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.preExisting.map(({ file, rule }) => `${file} ${rule}`).sort()).toEqual([`${LEGACY_CHART} file-name`, `${LEGACY_UTIL} src-shape`]);
    expect(result.report).toContain(PRE_EXISTING_HEADING);
  });

  it("lets an agent edit a legacy file and reports its findings as pre-existing at Stop", async () => {
    const repo = plintRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    const edit = () => repo.write(LEGACY_UTIL, "export const formatDate = (value: Date) => value.toISOString().slice(0, 10);\n");
    expect(await hooks.shell(`sed -i '' 's/x/y/' ${LEGACY_UTIL}`, edit)).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it("blocks a new violation in the dashboard, by Write and by shell", async () => {
    const repo = plintRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    const denied = await hooks.before("Write", { file_path: "apps/dashboard/src/utils/format-money.ts", content: "" });
    expect(denied).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(denied.kind === "deny" ? denied.reason : "").toContain("src/shared/lib/");
    const blocked = await hooks.shell("cp a b", () => repo.write("apps/dashboard/src/utils/format-money.ts", "export const formatMoney = 1;\n"));
    expect(blocked).toMatchObject({ kind: "block", findings: [{ rule: "src-shape", file: "apps/dashboard/src/utils/format-money.ts" }] });
    const stop = await hooks.stop();
    expect(stop.kind).toBe("block");
    expect(stop.findings?.map(({ file, rule }) => `${file} ${rule}`)).toEqual(["apps/dashboard/src/utils/format-money.ts src-shape"]);
  });

  it("refuses to grow the legacy list", async () => {
    const repo = plintRepo();
    const hooks = session(repo);
    expect(await hooks.before("Edit", { file_path: PLINT_LEGACY, old_string: "[", new_string: "[ " })).toMatchObject({
      kind: "deny",
      guard: "harness-lock",
    });
  });

  it("holds the supabase/migrations rules at the root", async () => {
    const repo = plintRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.before("Write", { file_path: NEW_MIGRATION, content: "" })).toEqual({ kind: "allow" });
    expect(await hooks.before("Write", { file_path: "supabase/migrations/add_tenants.sql", content: "" })).toMatchObject({
      kind: "deny",
      guard: "structure-write",
    });
    expect(await hooks.before("Edit", { file_path: PLINT_MIGRATION, old_string: "create", new_string: "drop" })).toMatchObject({
      kind: "deny",
      guard: "migration-applied",
    });
    expect(await hooks.shell(`rm ${PLINT_MIGRATION}`, () => repo.remove(PLINT_MIGRATION))).toMatchObject({
      kind: "block",
      findings: [{ rule: "migration-applied", file: PLINT_MIGRATION }],
    });
    expect(await hooks.before("Bash", { command: "supabase db push" })).toMatchObject({ kind: "deny", guard: "supabase-push" });
  });
});
