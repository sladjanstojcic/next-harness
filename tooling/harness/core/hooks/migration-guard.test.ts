import { afterEach, describe, expect, it, vi } from "vitest";
import { MAKERKIT_MIGRATION, makerkitRepo } from "../../testing/makerkit-repo.ts";
import { doneGate } from "../gates/done-gate.ts";
import * as runner from "../gates/run-tool.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";
import { handleEvent } from "./handle.ts";

afterEach(() => vi.restoreAllMocks());

const NEW_MIGRATION = "apps/web/supabase/migrations/20261109120000_add_journal.sql";
const reason = (label: string): string =>
  `${MAKERKIT_MIGRATION} is in ${label} and may be applied; restore it with git checkout and add a new migration with supabase migration new <name> instead of editing it.`;
const REASON = reason("HEAD");

const fileEvent = (root: string, tool: string, file: string): HookEvent =>
  parseEvent(
    "claude",
    {
      session_id: "s",
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: file, notebook_path: file, content: "", old_string: "x", new_string: "y" },
    },
    root,
  );
const patchEvent = (root: string, body: string): HookEvent =>
  parseEvent(
    "codex",
    { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` } },
    root,
  );
const bash = (root: string, command: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root);

describe("migration guard before a write", () => {
  it.each(["Write", "Edit", "NotebookEdit"])("denies %s on a committed migration", (tool) => {
    const { root } = makerkitRepo();
    expect(checkGuards(fileEvent(root, tool, MAKERKIT_MIGRATION), root)).toEqual({ guard: "migration-applied", reason: REASON });
  });

  it.each([
    ["an update", `*** Update File: ${MAKERKIT_MIGRATION}\n@@\n-create\n+alter`],
    ["a delete", `*** Delete File: ${MAKERKIT_MIGRATION}`],
    ["a move", `*** Update File: ${MAKERKIT_MIGRATION}\n*** Move to: ${NEW_MIGRATION}\n@@\n-create\n+create`],
  ])("denies %s through apply_patch", (_name, body) => {
    const { root } = makerkitRepo();
    expect(checkGuards(patchEvent(root, body), root)?.guard).toBe("migration-applied");
  });

  it("allows a new migration by Write and by apply_patch", () => {
    const { root } = makerkitRepo();
    expect(checkGuards(fileEvent(root, "Write", NEW_MIGRATION), root)).toBeNull();
    expect(checkGuards(patchEvent(root, `*** Add File: ${NEW_MIGRATION}\n+create table journal ();`), root)).toBeNull();
  });

  it("allows edits to a migration not yet committed", () => {
    const { root, write } = makerkitRepo();
    write(NEW_MIGRATION, "create table journal ();\n");
    expect(checkGuards(fileEvent(root, "Edit", NEW_MIGRATION), root)).toBeNull();
  });

  it("judges kit-owned migrations too: the guard ignores path classes", () => {
    const { root } = makerkitRepo({
      "harness.config.ts": `export default { workspaces: [{ path: "apps/web/supabase", shape: "supabase" }], owned: ["src/"], root: { entries: ["apps", "packages"] } };\n`,
    });
    expect(checkGuards(fileEvent(root, "Edit", MAKERKIT_MIGRATION), root)?.guard).toBe("migration-applied");
  });

  it("leaves migrations alone without a supabase workspace", () => {
    const { root } = makerkitRepo({
      "harness.config.ts": `export default { workspaces: [{ path: "apps/web", shape: "makerkit-app" }], root: { entries: ["apps", "packages"] } };\n`,
    });
    expect(checkGuards(fileEvent(root, "Edit", MAKERKIT_MIGRATION), root)).toBeNull();
  });
});

describe("migration guard after a shell command", () => {
  async function afterShell(
    change: (repo: ReturnType<typeof makerkitRepo>) => void,
    command: string,
    before: (repo: ReturnType<typeof makerkitRepo>) => void = () => undefined,
  ) {
    const repo = makerkitRepo();
    await handleEvent(parseEvent("claude", { session_id: "s", cwd: repo.root, hook_event_name: "UserPromptSubmit", prompt: "go" }, repo.root), repo.root);
    before(repo);
    const event = bash(repo.root, command);
    expect(await handleEvent(event, repo.root)).toEqual({ kind: "allow" });
    change(repo);
    return handleEvent({ ...event, event: "post-tool" }, repo.root);
  }

  it.each<[string, (repo: ReturnType<typeof makerkitRepo>) => void]>([
    ["sed -i", (repo) => repo.write(MAKERKIT_MIGRATION, "alter table public.accounts add column x int;\n")],
    ["rm", (repo) => repo.remove(MAKERKIT_MIGRATION)],
    [
      "mv",
      (repo) => {
        repo.write(NEW_MIGRATION, repo.read(MAKERKIT_MIGRATION));
        repo.remove(MAKERKIT_MIGRATION);
      },
    ],
  ])("blocks a committed migration changed by %s", async (command, change) => {
    const outcome = await afterShell(change, `${command} ${MAKERKIT_MIGRATION}`);
    expect(outcome).toMatchObject({
      kind: "block",
      findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION, message: reason("the tree this task started from") }],
    });
  });

  it.each<[string, (repo: ReturnType<typeof makerkitRepo>) => void]>([
    [
      "sed -i x && git add -A && git commit -m x",
      (repo) => {
        repo.write(MAKERKIT_MIGRATION, "alter table public.accounts add column x int;\n");
        repo.git("add", "-A");
        repo.git("commit", "-q", "-m", "x");
      },
    ],
    [
      "sed -i x && git commit -a --amend --no-edit",
      (repo) => {
        repo.write(MAKERKIT_MIGRATION, "alter table public.accounts add column x int;\n");
        repo.git("commit", "-q", "-a", "--amend", "--no-edit");
      },
    ],
    [
      "git rm x && git commit -m x",
      (repo) => {
        repo.git("rm", "-q", MAKERKIT_MIGRATION);
        repo.git("commit", "-q", "-m", "x");
      },
    ],
  ])("blocks a migration edit committed in the same command: %s", async (command, change) => {
    const outcome = await afterShell(change, command);
    expect(outcome).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
  });

  it("allows a shell edit of a migration written this turn and never committed", async () => {
    const outcome = await afterShell(
      (repo) => repo.write(NEW_MIGRATION, "create table journal (id int);\n"),
      "sed -i x",
      (repo) => repo.write(NEW_MIGRATION, "create table journal ();\n"),
    );
    expect(outcome).toEqual({ kind: "allow" });
  });

  it("allows a new migration and a reverted edit", async () => {
    expect(await afterShell((repo) => repo.write(NEW_MIGRATION, "create table journal ();\n"), "touch x")).toEqual({ kind: "allow" });
    const reverted = await afterShell((repo) => {
      const text = repo.read(MAKERKIT_MIGRATION);
      repo.write(MAKERKIT_MIGRATION, "changed\n");
      repo.write(MAKERKIT_MIGRATION, text);
    }, "touch x");
    expect(reverted).toEqual({ kind: "allow" });
  });
});

describe("migration guard in the Done gate", () => {
  it("blocks a changed committed migration whatever its class", async () => {
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const { root, write } = makerkitRepo({
      "harness.config.ts": `export default { workspaces: [{ path: "apps/web/supabase", shape: "supabase" }], owned: ["src/"], root: { entries: ["apps", "packages"] } };\n`,
    });
    write(MAKERKIT_MIGRATION, "drop table public.accounts;\n");
    write(NEW_MIGRATION, "create table journal ();\n");
    const result = await doneGate(root, [MAKERKIT_MIGRATION, NEW_MIGRATION]);
    const migrations = result.findings.filter((finding) => finding.rule === "migration-applied");
    expect(migrations).toEqual([{ rule: "migration-applied", file: MAKERKIT_MIGRATION, message: REASON }]);
    expect(result.passed).toBe(false);
  });
});
