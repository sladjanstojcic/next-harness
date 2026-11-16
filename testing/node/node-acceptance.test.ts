import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../../core/audit/audit.ts";
import * as runner from "../../core/gates/run-tool.ts";
import { parseEvent } from "../../core/hooks/event.ts";
import { handleEvent } from "../../core/hooks/handle.ts";
import { nodeMonorepo, nodeProject } from "./node-repo.ts";
import type { RepoFixture } from "../temp-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LAYOUT = "(Node layout)";
const ADS = "src/modules/ads";
const JS_IMPORT = 'import { listAds } from "./data/ads.js";\n\nexport const list = listAds;\n';

/** The hooks as an agent session meets them. */
function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "node", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
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

describe("Ad API, a Node service in the node-service shape", () => {
  it("passes the audit as written", () => {
    expect(audit(fs.realpathSync(nodeProject().root))).toEqual([]);
  });

  it.each([
    [`${ADS}/components/ad-card.tsx`, "module-shape", "no UI"],
    ["src/app/routes/ads.ts", "app-file", "routes.ts"],
  ])("denies a write to %s", async (file, rule, advice) => {
    const outcome = await session(nodeProject()).before(file);
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(outcome.reason).toContain(advice);
    expect(outcome.reason).toContain(rule);
    expect(outcome.reason?.endsWith(LAYOUT), outcome.reason).toBe(true);
  });

  it("denies a write to the generated backend types, and allows one to a module's data/", async () => {
    expect(await session(nodeProject()).before("src/backend/database.types.ts")).toMatchObject({ kind: "deny", guard: "vendored-write" });
    expect(await session(nodeProject()).before(`${ADS}/data/ads.ts`)).toEqual({ kind: "allow" });
  });

  it("blocks an import Node cannot resolve as written", async () => {
    recordSteps();
    const outcome = await session(nodeProject()).write(`${ADS}/routes.ts`, JS_IMPORT);
    expect(outcome.kind).toBe("block");
    expect(outcome.findings?.map(({ rule }) => rule)).toEqual(["node-import"]);
    expect(outcome.reason).toContain("./data/ads.ts");
  });

  it("gives the session the backend client, the module's public API and shared/lib at its start", async () => {
    const context = (await session(nodeProject()).start()).context ?? "";
    expect(context).toContain("## src/backend\n\n- `client.ts`: `db`");
    expect(context).toContain("## ads\n\n- `index.ts`: `adsRoutes`, `Ad`");
    expect(context).toContain("## shared/lib\n\n- `env.ts`: `env`");
  });

  it("runs tsc, lint, the analysis and the tests at Stop, with no build and no Next type generation", async () => {
    const steps = recordSteps();
    const hooks = session(nodeProject());
    await hooks.prompt();
    expect(await hooks.write(`${ADS}/types.ts`, "export interface Ad {\n  id: string;\n}\n")).toEqual({ kind: "allow" });
    steps.length = 0;
    expect(await hooks.stop()).toEqual({ kind: "allow" });
    expect(steps.map((step) => step.split(":")[0])).toEqual(["tsc", "eslint", "depcruise", "knip", "jscpd", "vitest"]);
  });
});

describe("Ad API at apps/api beside a shared package", () => {
  it("passes the audit as written, and names the findings with their apps/api/ paths", () => {
    const repo = nodeMonorepo();
    const root = fs.realpathSync(repo.root);
    expect(audit(root)).toEqual([]);
    repo.write(`apps/api/${ADS}/routes.ts`, JS_IMPORT);
    repo.write("apps/api/src/lib/x.ts", "export const x = 1;\n");
    repo.write(`apps/api/${ADS}/data/doc.ts`, 'export { size } from "../../../../../../packages/doc/src/index.ts";\n');
    expect(audit(root).map(({ file, rule }) => `${file} ${rule}`)).toEqual([
      "apps/api/src/lib/x.ts src-shape",
      `apps/api/${ADS}/data/doc.ts package-boundary`,
      `apps/api/${ADS}/routes.ts node-import`,
    ]);
  });
});
