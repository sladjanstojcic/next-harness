import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { MAKERKIT_KIT_ROUTE, MAKERKIT_MIGRATION, MAKERKIT_ROUTE, makerkitRepo } from "./makerkit-repo.ts";

afterEach(() => vi.restoreAllMocks());

const BRIEF_CONFIG = `export default {
  workspaces: [
    { path: "apps/web", shape: "makerkit-app", next: true, tools: "oxc" },
    { path: "packages/features/*", shape: "makerkit-feature", tools: "oxc" },
    { path: "apps/web/supabase", shape: "supabase" },
  ],
  owned: ["packages/features/journal/", "${MAKERKIT_ROUTE}/", "apps/web/supabase/"],
  locked: [".oxlintrc.json", ".oxfmtrc.jsonc", "turbo.json", "tooling/typescript/base.json", "apps/web/next.config.mjs"],
  root: { entries: ["apps", "packages", "tooling", "turbo.json", ".oxlintrc.json", ".oxfmtrc.jsonc"] },
  env: "local",
};
`;

const NEW_MIGRATION = "apps/web/supabase/migrations/20261109120000_add_journal.sql";
const OWNED_SERVICE = "packages/features/journal/src/server/services/journal.service.ts";
const OWNED_PAGE = `${MAKERKIT_ROUTE}/page.tsx`;

function briefRepo() {
  const repo = makerkitRepo({
    "harness.config.ts": BRIEF_CONFIG,
    ".gitignore": "node_modules/\n.env*.local\n",
    ".oxlintrc.json": "{}\n",
    "turbo.json": "{}\n",
    "node_modules/.bin/oxlint": "",
    "node_modules/.bin/oxfmt": "",
    "node_modules/.bin/tsc": "",
    "apps/web/node_modules/.bin/next": "",
  });
  return { ...repo, real: fs.realpathSync(repo.root) };
}

type Repo = ReturnType<typeof briefRepo>;

function session(repo: Repo) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "acceptance", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", name: string, input: Record<string, unknown>) => send(hook, { tool_name: name, tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (name: string, input: Record<string, unknown>) => tool("PreToolUse", name, input),
    after: (name: string, input: Record<string, unknown>) => tool("PostToolUse", name, input),
    /** PreToolUse, the write itself when allowed, then PostToolUse. */
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", "Write", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", "Write", input);
    },
  };
}

interface Step {
  name: string;
  cwd: string;
  command: string;
}

function recordSteps(repo: Repo): Step[] {
  const steps: Step[] = [];
  const local = (arg: string): string => (arg.startsWith(`${repo.real}/`) ? path.relative(repo.real, arg) : arg);
  vi.spyOn(runner, "runTool").mockImplementation(async (root, step) => {
    steps.push({ name: step.name, cwd: local(step.cwd ?? root) || ".", command: step.command.map(local).join(" ") });
    return [];
  });
  return steps;
}

describe("Makerkit acceptance with the brief's config (oxy-app in miniature)", () => {
  it("lets a kit file change, even one breaking owned rules, through every hook", async () => {
    const repo = briefRepo();
    recordSteps(repo);
    const hooks = session(repo);
    await hooks.prompt();
    const longPage = `export default function Page() {\n${"  void 0;\n".repeat(70)}  return null;\n}\n`;
    expect(await hooks.write(`${MAKERKIT_KIT_ROUTE}/page.tsx`, longPage)).toEqual({ kind: "allow" });
    expect(await hooks.write(`${MAKERKIT_KIT_ROUTE}/helpers/format.ts`, "export const format = 1;\n")).toEqual({ kind: "allow" });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it.each([
    [`${MAKERKIT_ROUTE}/_helpers/format.ts`, "structure-write"],
    ["packages/features/journal/src/utils/format.ts", "structure-write"],
  ])("denies the owned path %s with a Makerkit location", async (file, guard) => {
    const hooks = session(briefRepo());
    const outcome = await hooks.before("Write", { file_path: file, content: "" });
    expect(outcome).toMatchObject({ kind: "deny", guard });
    expect(outcome.kind === "deny" ? outcome.reason : "").toContain("(Makerkit layout)");
  });

  it("denies secret env files and allows the committed ones", async () => {
    const hooks = session(briefRepo());
    expect(await hooks.before("Write", { file_path: ".env.local", content: "" })).toMatchObject({ kind: "deny", guard: "env-file-write" });
    expect(await hooks.before("Edit", { file_path: "apps/web/.env.production.local", old_string: "a", new_string: "b" })).toMatchObject({
      kind: "deny",
      guard: "env-file-write",
    });
    expect(await hooks.before("Edit", { file_path: "apps/web/.env.development", old_string: "a", new_string: "b" })).toEqual({ kind: "allow" });
  });

  it.each([
    ["supabase db push", "supabase-push"],
    ["pnpm --filter web supabase:deploy", "supabase-deploy"],
    ["cd apps/web && supabase link --project-ref $SUPABASE_PROJECT_REF", "supabase-link"],
  ])("denies %s", async (command, guard) => {
    const hooks = session(briefRepo());
    expect(await hooks.before("Bash", { command })).toMatchObject({ kind: "deny", guard });
  });

  it("allows a new migration and denies an edit to a committed one", async () => {
    const repo = briefRepo();
    recordSteps(repo);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(NEW_MIGRATION, "create table public.journal (id uuid primary key);\n")).toEqual({ kind: "allow" });
    expect(await hooks.before("Edit", { file_path: MAKERKIT_MIGRATION, old_string: "create", new_string: "alter" })).toMatchObject({
      kind: "deny",
      guard: "migration-applied",
    });
    expect(await hooks.stop()).toEqual({ kind: "allow" });
  });

  it("keeps the brief's locked files locked", async () => {
    const hooks = session(briefRepo());
    for (const file of [".oxlintrc.json", "apps/web/next.config.mjs", "harness.config.ts"])
      expect(await hooks.before("Edit", { file_path: file, old_string: "{", new_string: "{ " })).toMatchObject({ kind: "deny", guard: "harness-lock" });
  });

  it("runs the oxc steps per workspace at Stop, without a build, Playwright or analysis", async () => {
    const repo = briefRepo();
    const steps = recordSteps(repo);
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write(OWNED_PAGE, "export default function Page() {\n  return null;\n}\n")).toEqual({ kind: "allow" });
    expect(await hooks.write(OWNED_SERVICE, 'import "server-only";\n\nexport function createJournalService() {\n  return {};\n}\n')).toEqual({
      kind: "allow",
    });
    steps.length = 0;
    expect(await hooks.stop()).toEqual({ kind: "allow" });
    expect(steps).toEqual([
      { name: "next", cwd: "apps/web", command: "apps/web/node_modules/.bin/next typegen" },
      { name: "tsc", cwd: "apps/web", command: "node_modules/.bin/tsc --noEmit --pretty false" },
      {
        name: "oxlint",
        cwd: "apps/web",
        command: "node_modules/.bin/oxlint -f json --no-error-on-unmatched-pattern app/[locale]/home/[account]/journal/page.tsx",
      },
      { name: "tsc", cwd: "packages/features/journal", command: "node_modules/.bin/tsc --noEmit --pretty false" },
      {
        name: "oxlint",
        cwd: "packages/features/journal",
        command: "node_modules/.bin/oxlint -f json --no-error-on-unmatched-pattern src/server/services/journal.service.ts",
      },
    ]);
  });
});
