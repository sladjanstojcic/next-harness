import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAKERKIT_MIGRATION, makerkitRepo } from "../../testing/makerkit-repo.ts";
import type { RepoFixture } from "../../testing/temp-repo.ts";
import { doneGate } from "../gates/done-gate.ts";
import * as runner from "../gates/run-tool.ts";
import { readState, sessionFile, stateDir } from "../state/state-file.ts";
import { taskState } from "../gates/repair-budget.ts";
import { parseEvent, type HookEvent } from "./event.ts";
import { handleEvent } from "./handle.ts";
import { taskApplied } from "./migration-guard.ts";
import { pinAppliedRefs } from "../state/applied-refs.ts";

afterEach(() => vi.restoreAllMocks());

const JOURNAL = "apps/web/supabase/migrations/20261110120000_journal.sql";
const ORIGINAL = "create table public.accounts (id uuid primary key);\n";

const event = (root: string, hook: string, extra: Record<string, unknown> = {}): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: hook, ...extra }, root);
const bash = (root: string, command: string): HookEvent => event(root, "PreToolUse", { tool_name: "Bash", tool_input: { command } });
const edit = (root: string, file: string): HookEvent =>
  event(root, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: file, old_string: "x", new_string: "y" } });

const prompt = async (repo: RepoFixture) => handleEvent(event(repo.root, "UserPromptSubmit", { prompt: "go" }), repo.root);

/** A clone: the fixture commit is also the remote default branch, and a prompt started the task. */
async function clone(remote = true) {
  const repo = makerkitRepo();
  if (remote) repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await prompt(repo);
  return repo;
}

/** A clone of a real bare origin that main tracks, so a push moves origin/main. */
async function pushable() {
  const repo = makerkitRepo();
  const origin = path.join(path.dirname(repo.root), "origin.git");
  repo.git("init", "-q", "--bare", origin);
  repo.git("remote", "add", "origin", origin);
  repo.git("push", "-q", "-u", "origin", "main");
  await prompt(repo);
  return repo;
}

async function shell(repo: RepoFixture, command: string, change: () => void) {
  expect(await handleEvent(bash(repo.root, command), repo.root)).toEqual({ kind: "allow" });
  change();
  return handleEvent({ ...bash(repo.root, command), event: "post-tool" }, repo.root);
}

const migrationRules = (findings: { rule: string }[]) => findings.filter((finding) => finding.rule === "migration-applied");

async function stop(repo: RepoFixture) {
  vi.spyOn(runner, "runTool").mockResolvedValue([]);
  const task = readState(repo.root, sessionFile("task", "s"), taskState);
  if (!task) throw new Error("no task");
  const changed = repo.git("diff", "--name-only", task.tree).split("\n").filter(Boolean);
  const untracked = repo.git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return doneGate(repo.root, [...changed, ...untracked], taskApplied(repo.root, task));
}

describe("block 3ac7ae: restoring an applied migration is not a finding", () => {
  it.each([true, false])("allows git checkout -- <file> after a blocked shell edit (remote: %s)", async (remote) => {
    const repo = await clone(remote);
    const edited = await shell(repo, `sed -i '' s/create/alter/ ${MAKERKIT_MIGRATION}`, () => repo.write(MAKERKIT_MIGRATION, "alter table x;\n"));
    expect(edited).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
    const restored = await shell(repo, `git checkout -- ${MAKERKIT_MIGRATION}`, () => repo.git("checkout", "--", MAKERKIT_MIGRATION));
    expect(restored).toEqual({ kind: "allow" });
    expect(repo.read(MAKERKIT_MIGRATION)).toBe(ORIGINAL);
  });
});

describe("blocks ef3800, 32f9e2: the agent's own committed migration is not applied", () => {
  it.each([true, false])("edits, commits and edits again without a finding (remote: %s)", async (remote) => {
    const repo = await clone(remote);
    repo.write(JOURNAL, "create table public.journal (id uuid primary key);\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "journal");
    expect(await handleEvent(edit(repo.root, JOURNAL), repo.root)).toEqual({ kind: "allow" });
    const amended = await shell(repo, "sed -i x && git commit -am x", () => {
      repo.write(JOURNAL, "create table public.journal (id uuid primary key, body text);\n");
      repo.git("commit", "-q", "-am", "journal body");
    });
    expect(amended).toEqual({ kind: "allow" });
    expect(migrationRules((await stop(repo)).findings)).toEqual([]);
  });

  it("allows renaming and deleting the agent's own committed migration", async () => {
    const repo = await clone();
    repo.write(JOURNAL, "create table public.journal ();\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "journal");
    const renamed = JOURNAL.replace("journal", "journals");
    const moved = await shell(repo, "git mv a b && git commit -m x", () => {
      repo.git("mv", JOURNAL, renamed);
      repo.git("commit", "-q", "-m", "rename");
    });
    expect(moved).toEqual({ kind: "allow" });
    const removed = await shell(repo, "git rm x", () => repo.git("rm", "-q", renamed));
    expect(removed).toEqual({ kind: "allow" });
  });

  it("treats a migration pushed to the branch's upstream as applied from the next prompt on", async () => {
    const repo = await clone();
    repo.write(JOURNAL, "create table public.journal ();\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "journal");
    repo.git("remote", "add", "origin", "https://example.invalid/app.git");
    repo.git("update-ref", "refs/remotes/origin/feature", "HEAD");
    repo.git("config", "branch.main.remote", "origin");
    repo.git("config", "branch.main.merge", "refs/heads/feature");
    expect(await handleEvent(edit(repo.root, JOURNAL), repo.root)).toEqual({ kind: "allow" });
    await prompt(repo);
    expect(await handleEvent(edit(repo.root, JOURNAL), repo.root)).toMatchObject({ kind: "deny", guard: "migration-applied" });
  });
});

describe("an applied migration still blocks when its content changes", () => {
  it("blocks a commit in the same command and in the Done gate, with a remote", async () => {
    const repo = await clone();
    repo.git("commit", "-q", "--allow-empty", "-m", "ahead of origin");
    const committed = await shell(repo, "sed -i x && git commit -am x", () => {
      repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
      repo.git("commit", "-q", "-am", "x");
    });
    expect(committed).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
    expect(migrationRules((await stop(repo)).findings)).toEqual([expect.objectContaining({ file: MAKERKIT_MIGRATION })]);
  });

  it("blocks a migration the remote default branch holds even when HEAD lacks it", async () => {
    const repo = await clone();
    repo.git("rm", "-q", MAKERKIT_MIGRATION);
    repo.git("commit", "-q", "-m", "drop");
    expect(await handleEvent(edit(repo.root, MAKERKIT_MIGRATION), repo.root)).toMatchObject({ kind: "deny", guard: "migration-applied" });
  });

  it("blocks an edit committed and pushed in one command, in the hook and at Stop", async () => {
    const repo = await pushable();
    const pushed = await shell(repo, "sed -i x && git commit -qam x && git push -q origin main", () => {
      repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
      repo.git("commit", "-q", "-am", "x");
      repo.git("push", "-q", "origin", "main");
    });
    expect(pushed).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
    expect(migrationRules((await stop(repo)).findings)).toEqual([expect.objectContaining({ file: MAKERKIT_MIGRATION })]);
  });

  it("still reports at Stop an edit committed in one command and pushed to a new branch in a later one", async () => {
    const repo = await pushable();
    repo.git("switch", "-q", "-c", "feat");
    const committed = await shell(repo, "sed -i x && git commit -qam x", () => {
      repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
      repo.git("commit", "-q", "-am", "x");
    });
    expect(committed).toMatchObject({ kind: "block" });
    await shell(repo, "git push -q -u origin feat", () => repo.git("push", "-q", "-u", "origin", "feat"));
    expect(migrationRules((await stop(repo)).findings)).toEqual([expect.objectContaining({ file: MAKERKIT_MIGRATION })]);
  });

  it("names origin/main once and ignores a local branch as upstream", async () => {
    const repo = await pushable();
    repo.git("remote", "set-head", "origin", "main");
    expect(pinAppliedRefs(repo.root).label).toBe("origin/main");
    repo.git("switch", "-q", "--orphan", "empty");
    repo.git("commit", "-q", "--allow-empty", "-m", "empty");
    repo.git("switch", "-q", "main");
    repo.git("branch", "-q", "-u", "empty");
    for (const ref of ["refs/remotes/origin/main", "refs/remotes/origin/HEAD"]) repo.git("update-ref", "-d", ref);
    expect(pinAppliedRefs(repo.root)).toEqual({ commits: [], label: "" });
    await prompt(repo);
    expect(await handleEvent(edit(repo.root, MAKERKIT_MIGRATION), repo.root)).toMatchObject({ kind: "deny", guard: "migration-applied" });
  });
});

describe("review round 2: a destroyed task state still judges the turn", () => {
  const taskFile = (repo: RepoFixture): string => path.join(stateDir(repo.root), sessionFile("task", "s"));
  const stopHook = async (repo: RepoFixture) => {
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    return handleEvent(event(repo.root, "Stop"), repo.root);
  };
  const blocked: object = {
    kind: "block",
    findings: expect.arrayContaining([expect.objectContaining({ rule: "migration-applied", file: MAKERKIT_MIGRATION })]) as unknown,
  };

  it.each<[string, (repo: RepoFixture) => void]>([
    ["truncated", (repo) => fs.writeFileSync(taskFile(repo), "")],
    [
      "rewritten without its pins",
      (repo) => {
        const state = JSON.parse(fs.readFileSync(taskFile(repo), "utf8")) as Record<string, unknown>;
        delete state.applied;
        fs.writeFileSync(taskFile(repo), JSON.stringify(state));
      },
    ],
  ])("blocks an edit committed and pushed by a command that left the task state %s, after Bash and at Stop", async (_how, destroy) => {
    const repo = await pushable();
    const outcome = await shell(repo, "sh ./release.sh", () => {
      repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
      repo.git("commit", "-q", "-am", "x");
      repo.git("push", "-q", "origin", "main");
      destroy(repo);
    });
    expect(outcome).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
    expect(await stopHook(repo)).toMatchObject(blocked);
    expect(await stopHook(repo), "review round 3: the second Stop still reports").toMatchObject({
      kind: "allow-unresolved",
      findings: expect.arrayContaining([expect.objectContaining({ rule: "migration-applied", file: MAKERKIT_MIGRATION })]) as unknown,
    });
  });

  it("allows a Stop with no state on a clean tree, and blocks an unpushed bad commit with no state at all", async () => {
    const repo = await pushable();
    fs.rmSync(taskFile(repo));
    expect(await stopHook(repo)).toEqual({ kind: "allow" });
    expect(readState(repo.root, sessionFile("task", "s"), taskState)).not.toBeNull();
    fs.rmSync(taskFile(repo));
    repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
    repo.git("commit", "-q", "-am", "x");
    expect(await stopHook(repo)).toMatchObject(blocked);
  });
});

describe("review round 3: git replace cannot move a pinned commit", () => {
  it("blocks a pushed edit whose pinned commit was replaced in the same command, after Bash and at Stop", async () => {
    const repo = await pushable();
    const pinned = repo.git("rev-parse", "origin/main").trim();
    const outcome = await shell(repo, "sed -i x && git commit -qam x && git push -q origin main && git replace $OLD HEAD", () => {
      repo.write(MAKERKIT_MIGRATION, "alter table x;\n");
      repo.git("commit", "-q", "-am", "x");
      repo.git("push", "-q", "origin", "main");
      repo.git("replace", pinned, "HEAD");
    });
    expect(outcome).toMatchObject({ kind: "block", findings: [{ rule: "migration-applied", file: MAKERKIT_MIGRATION }] });
    expect(migrationRules((await stop(repo)).findings)).toEqual([expect.objectContaining({ file: MAKERKIT_MIGRATION })]);
  });
});
