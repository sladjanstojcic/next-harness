import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../core/audit/audit.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import type { RepoFixture } from "./temp-repo.ts";
import { viteMonorepo, viteProject } from "./vite-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LAYOUT = "(Vite layout)";
const ADS = "src/modules/ads";
const POCKETBASE_VIEW = 'import PocketBase from "pocketbase";\n\nexport const client = new PocketBase("http://127.0.0.1:8090");\n';

/** The hooks as an agent session meets them. */
function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "vite", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", input: Record<string, unknown>) => send(hook, { tool_name: "Write", tool_input: input });
  return {
    start: () => send("SessionStart", { source: "startup" }),
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (file: string) => tool("PreToolUse", { file_path: path.join(repo.root, file), content: "" }),
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", input);
    },
  };
}

/** Every tool step the gates start, as its name and the command's last words, with the runner stubbed to find nothing. */
function recordSteps(): string[] {
  const steps: string[] = [];
  vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
    steps.push(`${step.name}: ${step.command.slice(-2).join(" ")}`);
    return [];
  });
  return steps;
}

describe("Ad Studio, a Vite single-page app in the vite-spa shape", () => {
  it("passes the audit as written", () => {
    expect(audit(fs.realpathSync(viteProject().root))).toEqual([]);
  });

  it.each([
    [`${ADS}/server/q.ts`, "module-shape", "data/"],
    ["src/app/ads/list.tsx", "app-file", "src/app/"],
  ])("denies a write to %s", async (file, rule, advice) => {
    const outcome = await session(viteProject()).before(file);
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(outcome.reason).toContain(advice);
    expect(outcome.reason?.endsWith(LAYOUT), outcome.reason).toBe(true);
    expect(outcome.reason).toContain(rule);
  });

  it("denies a write to the generated backend types", async () => {
    const outcome = await session(viteProject()).before("src/backend/database.types.ts");
    expect(outcome).toEqual({
      kind: "deny",
      guard: "vendored-write",
      reason: "regenerate src/backend/database.types.ts with the backend's CLI; keep your own types in a module's types.ts",
    });
  });

  it("allows a write to a module's data/", async () => {
    expect(await session(viteProject()).before(`${ADS}/data/ads.ts`)).toEqual({ kind: "allow" });
  });

  it("blocks a component that opens a backend connection itself", async () => {
    recordSteps();
    const file = `${ADS}/components/direct.tsx`;
    const outcome = await session(viteProject()).write(file, POCKETBASE_VIEW);
    expect(outcome.kind).toBe("block");
    expect(outcome.findings?.map((finding) => `${finding.file} ${finding.rule}`)).toEqual([`${file} backend-package`]);
    expect(outcome.reason).toContain(LAYOUT);
  });

  it("gives the session the backend client, the module's public API and shared/lib at its start", async () => {
    const context = (await session(viteProject()).start()).context ?? "";
    expect(context).toContain("## src/backend\n\n- `client.ts`: `pb`");
    expect(context).toContain("## ads\n\n- `index.ts`: `AdList`, `Ad`");
    expect(context).toContain("## shared/lib\n\n- `env.ts`: `env`");
  });

  it("runs tsc once per project at Stop and no Next type generation", async () => {
    const repo = viteProject();
    const steps = recordSteps();
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(`${ADS}/types.ts`, "export interface Ad {\n  id: string;\n  title: string;\n}\n")).toEqual({ kind: "allow" });
    steps.length = 0;
    expect(await hooks.stop()).toEqual({ kind: "allow" });
    expect(steps.map((step) => step.split(":")[0])).toEqual(["tsc", "eslint", "depcruise", "knip", "jscpd", "vitest"]);
    expect(steps[0]).toBe("tsc: tsconfig.app.json tsconfig.node.json");
  });
});

describe("Ad Studio at apps/web beside a supabase workspace", () => {
  it("passes the audit as written, and names the findings with their apps/web/ paths", async () => {
    const repo = viteMonorepo();
    const root = fs.realpathSync(repo.root);
    expect(audit(root)).toEqual([]);
    repo.write(`apps/web/${ADS}/components/direct.tsx`, POCKETBASE_VIEW);
    repo.write("apps/web/src/lib/x.ts", "export const x = 1;\n");
    expect(audit(root).map(({ file, rule }) => `${file} ${rule}`)).toEqual([
      "apps/web/src/lib/x.ts src-shape",
      `apps/web/${ADS}/components/direct.tsx backend-package`,
    ]);
    recordSteps();
    const outcome = await session(repo).write(`apps/web/${ADS}/components/other.tsx`, POCKETBASE_VIEW);
    expect(outcome.kind).toBe("block");
    expect(outcome.findings?.map((finding) => `${finding.file} ${finding.rule}`)).toEqual([`apps/web/${ADS}/components/other.tsx backend-package`]);
  });
});
