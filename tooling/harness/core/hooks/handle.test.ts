import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as runner from "../gates/run-tool.ts";
import { taskState } from "../gates/repair-budget.ts";
import { unlock } from "../lock.ts";
import { readState, sessionFile, writeState } from "../state/state-file.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { parseEvent, type Client } from "./event.ts";
import { handleEvent } from "./handle.ts";
import { renderResponse } from "./respond.ts";

afterEach(() => vi.restoreAllMocks());
const taskFile = (client: Client): string => sessionFile("task", client === "codex" ? "thr_123" : "abc123");
function event(root: string, name: string, client: Client = "claude", extra: Record<string, unknown> = {}) {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", client, `${name}.json`), "utf8"));
  return parseEvent(client, { ...z.record(z.string(), z.unknown()).parse(raw), cwd: root, ...extra }, root);
}

describe("handleEvent", () => {
  it.each<Client>(["claude", "codex"])("starts a task on a %s user prompt", async (client) => {
    const repo = makeRepo();
    expect(await handleEvent(event(repo.root, "user-prompt-submit", client), repo.root)).toEqual({ kind: "allow" });
    const saved = readState(repo.root, taskFile(client), taskState)!;
    expect(saved).toMatchObject({ attempts: 0, lastReport: null });
    expect(saved.tree).toMatch(/^[a-f0-9]+$/);
  });

  it("denies a Write into src/utils with placement guidance", async () => {
    const repo = makeRepo();
    const outcome = await handleEvent(
      event(repo.root, "pre-tool-edit", "claude", {
        tool_name: "Write",
        tool_input: { file_path: "src/utils/x.ts" },
      }),
      repo.root,
    );
    expect(outcome.kind).toBe("deny");
    expect(outcome.reason).toContain("src-shape");
    expect(outcome.reason).toContain("src/shared/lib/");
  });

  it("blocks a Bash change to a locked harness file until the user unlocks", async () => {
    const repo = makeRepo({ "tooling/harness/structure.ts": "export const limit = 1;\n" });
    const bash = event(repo.root, "pre-tool-bash", "claude", { tool_input: { command: "sed -i '' s/1/2/ tooling/harness/structure.ts" } });
    await handleEvent(bash, repo.root);
    repo.write("tooling/harness/structure.ts", "export const limit = 2;\n");
    const outcome = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("harness-lock");
    expect(outcome.reason).toContain("pnpm harness:unlock");
    unlock(repo.root);
    await handleEvent(bash, repo.root);
    repo.write("tooling/harness/structure.ts", "export const limit = 3;\n");
    expect(await handleEvent({ ...bash, event: "post-tool" }, repo.root)).toEqual({ kind: "allow" });
  });

  it("keeps shell snapshots per session, so a parallel agent's command does not hide this agent's changes", async () => {
    const repo = makeRepo();
    const mine = event(repo.root, "pre-tool-bash", "claude", { tool_input: { command: "echo > src/helpers/mine.ts" } });
    const theirs = event(repo.root, "pre-tool-bash", "claude", { session_id: "other", tool_input: { command: "ls" } });
    await handleEvent(mine, repo.root);
    repo.write("src/helpers/mine.ts", "\n");
    await handleEvent(theirs, repo.root);
    const outcome = await handleEvent({ ...mine, event: "post-tool" }, repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("src/helpers/mine.ts");
    expect(await handleEvent({ ...theirs, event: "post-tool" }, repo.root)).toEqual({ kind: "allow" });
  });

  it("audits Bash changes without running a formatter or linter", async () => {
    const repo = makeRepo({ "src/shared/lib/old.ts": "export const old=1" });
    const run = vi.spyOn(runner, "runTool");
    const bash = event(repo.root, "pre-tool-bash", "claude", { tool_input: { command: "mkdir -p src/helpers && echo > src/helpers/x.ts" } });
    expect(await handleEvent(bash, repo.root)).toEqual({ kind: "allow" });
    expect(readState(repo.root, sessionFile("shell", "abc123"), z.object({ tree: z.string() }))).not.toBeNull();
    repo.write("src/helpers/x.ts", "\n");
    repo.write("src/shared/lib/raw.ts", "export const raw={a:1}");
    const outcome = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("src-shape");
    expect(repo.read("src/shared/lib/raw.ts")).toBe("export const raw={a:1}");
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["move", "delete"])("audits a Bash %s and still reports an invalid destination", async (operation) => {
    const source = "src/modules/a/server/get-a.ts";
    const repo = makeRepo({ [source]: 'import "server-only"; export const value = 1;' });
    const bash = event(repo.root, "pre-tool-bash", "claude", { tool_input: { command: "mv src/modules/a/server/get-a.ts src/utils/get-a.ts" } });
    await handleEvent(bash, repo.root);
    repo.write("src/utils/get-a.ts", operation === "move" ? repo.read(source) : "export const value = 1;");
    repo.remove(source);
    const outcome = await handleEvent({ ...bash, event: "post-tool" }, repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("src/utils/get-a.ts:1 src-shape");
  });

  it("runs Fast on file edits and returns its remaining findings", async () => {
    const repo = makeRepo({ "src/shared/lib/x.ts": "export type Value = any;\n" });
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "eslint" ? [{ rule: "@typescript-eslint/no-explicit-any", file: "src/shared/lib/x.ts", message: "Unexpected any." }] : [],
    );
    const outcome = await handleEvent(event(repo.root, "post-tool", "claude", { tool_input: { file_path: "src/shared/lib/x.ts" } }), repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("no-explicit-any");
  });

  it("starts a missing task on Stop, then allows an unchanged tree without tools", async () => {
    const repo = makeRepo();
    const run = vi.spyOn(runner, "runTool");
    const stop = event(repo.root, "stop");
    expect(await handleEvent(stop, repo.root)).toEqual({ kind: "allow" });
    expect(await handleEvent(stop, repo.root)).toEqual({ kind: "allow" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each<Client>(["claude", "codex"])("blocks once, then gives up on identical reports for %s", async (client) => {
    const repo = makeRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    await handleEvent(event(repo.root, "user-prompt-submit", client), repo.root);
    repo.write("src/helpers/x.ts", "\n");
    const stop = event(repo.root, "stop", client);
    const first = await handleEvent(stop, repo.root);
    expect(first.kind).toBe("block");
    const saved = readState(repo.root, taskFile(client), taskState)!;
    expect(saved).toMatchObject({ attempts: 1, lastReport: first.reason });
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await handleEvent(stop, repo.root);
      expect(outcome).toMatchObject({ kind: "allow-unresolved", message: `Checks still failing after 2 repairs:\n${first.reason}` });
      expect(JSON.parse(renderResponse(client, "stop", outcome).stdout)).toMatchObject({ systemMessage: outcome.message });
      expect(readState(repo.root, taskFile(client), taskState)).toEqual(saved);
    }
  });

  it.each<Client>(["claude", "codex"])("reports the third distinct failure and ends the turn for %s", async (client) => {
    const repo = makeRepo();
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    await handleEvent(event(repo.root, "user-prompt-submit", client), repo.root);
    const stop = event(repo.root, "stop", client);
    for (const name of ["first", "second"]) {
      repo.write(`src/helpers/${name}.ts`, "\n");
      const outcome = await handleEvent(stop, repo.root);
      expect(outcome.kind).toBe("block");
      expect(outcome.reason).toContain(`src/helpers/${name}.ts`);
    }
    const saved = readState(repo.root, taskFile(client), taskState)!;
    expect(saved.attempts).toBe(2);
    repo.write("src/helpers/third.ts", "\n");
    const outcome = await handleEvent(stop, repo.root);
    expect(outcome.kind).toBe("allow-unresolved");
    expect(outcome.message).toContain("Checks still failing after 2 repairs:");
    expect(outcome.message).toContain("src/helpers/third.ts");
    expect(outcome.message).toContain("src/shared/lib/");
    expect(readState(repo.root, taskFile(client), taskState)).toEqual(saved);
    const response = renderResponse(client, "stop", outcome);
    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual(client === "codex" ? { continue: true, systemMessage: outcome.message } : { systemMessage: outcome.message });
  });

  it("resets repairs on every real Codex user prompt, even text matching the last report", async () => {
    const client: Client = "codex";
    const repo = makeRepo();
    await handleEvent(event(repo.root, "user-prompt-submit", "codex"), repo.root);
    const original = readState(repo.root, taskFile(client), taskState)!;
    const repairing = { ...original, attempts: 1, lastReport: "fix this report" };
    writeState(repo.root, taskFile(client), repairing);
    repo.write("src/shared/lib/x.ts", "export const value = 1;\n");
    await handleEvent(event(repo.root, "user-prompt-submit", "codex", { prompt: "fix this report" }), repo.root);
    expect(readState(repo.root, taskFile(client), taskState)).toMatchObject({ attempts: 0, lastReport: null });
    await handleEvent(event(repo.root, "user-prompt-submit", "codex", { prompt: "new task" }), repo.root);
    const next = readState(repo.root, taskFile(client), taskState)!;
    expect(next).toMatchObject({ attempts: 0, lastReport: null });
    expect(next.tree).not.toBe(original.tree);
  });

  it.each<Client>(["claude", "codex"])("delivers the public code index to %s at session start", async (client) => {
    const repo = makeRepo({ "src/modules/orders/index.ts": 'export { OrderList } from "./components/order-list";' });
    const outcome = await handleEvent(event(repo.root, "session-start", client), repo.root);
    expect(outcome.kind).toBe("allow");
    expect(outcome.context).toContain("## orders");
    expect(outcome.context).toContain("OrderList");
    expect(JSON.parse(renderResponse(client, "session-start", outcome).stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: outcome.context },
    });
  });
});
