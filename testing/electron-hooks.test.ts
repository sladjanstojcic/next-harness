import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { electronProject, DESK_APP } from "./electron-repo.ts";
import type { RepoFixture } from "./temp-repo.ts";

afterEach(() => vi.restoreAllMocks());

const LAYOUT = "(Electron layout)";
const R = "src/renderer/src";

function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "electron", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", input: Record<string, unknown>) => send(hook, { tool_name: "Write", tool_input: input });
  return {
    start: () => send("SessionStart", { source: "startup" }),
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    before: (file: string) => tool("PreToolUse", { file_path: file, content: "" }),
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

describe("the hooks in an electron-vite project (Desk App)", () => {
  it.each([
    [`${R}/utils/x.ts`, "src-shape"],
    ["src/main/helpers/x.ts", "generic-folder"],
    ["src/lib/x.ts", "src-shape"],
    ["src/main/storage/client.js", "js-file"],
    ["scripts/build.js", "js-file"],
    ["src/app/page.tsx", "src-shape"],
    [`${R}/modules/notes/server.ts`, "module-shape"],
  ])("deny a write to %s", async (file) => {
    const outcome = await session(electronProject(DESK_APP)).before(file);
    expect(outcome).toMatchObject({ kind: "deny", guard: "structure-write" });
    expect(outcome.reason?.endsWith(LAYOUT)).toBe(true);
  });

  it.each(["src/main/storage/client.ts", `${R}/modules/notes/domain/total.ts`, "src/shared/note.ts", "src/preload/api.ts", `${R}/assets/logo.svg`])(
    "allow a write to %s",
    async (file) => {
      expect(await session(electronProject(DESK_APP)).before(file)).toEqual({ kind: "allow" });
    },
  );

  it.each(["electron.vite.config.ts", "electron-builder.yml", "tsconfig.json", "tsconfig.node.json", "tsconfig.web.json", "eslint.config.mjs"])(
    "deny a write to the locked %s",
    async (file) => {
      const outcome = await session(electronProject(DESK_APP)).before(file);
      expect(outcome).toMatchObject({ kind: "deny", guard: "harness-lock" });
    },
  );

  it.each([
    [
      "electron-security",
      "src/main/window/create.ts",
      'import { BrowserWindow } from "electron";\n\nexport const create = () => new BrowserWindow({ webPreferences: { sandbox: false } });\n',
    ],
    [
      "electron-bridge",
      `${R}/modules/notes/components/ping.tsx`,
      "export const ping = (channel: string): void => window.electron.ipcRenderer.send(channel);\n",
    ],
    [
      "ipc-channel",
      "src/main/ipc/register.ts",
      'import { ipcMain } from "electron";\n\nexport const register = (): void => ipcMain.handle("note:send", () => 1);\n',
    ],
    ["use-server-placement", "src/main/storage/send.ts", '"use server";\n\nexport const send = 1;\n'],
    ["use-client-placement", `${R}/modules/notes/components/form.tsx`, '"use client";\n\nexport const form = 1;\n'],
    ["server-only", "src/main/db/client.ts", 'import "server-only";\n\nexport const client = 1;\n'],
    ["env-access", `${R}/shared/lib/storage-url.ts`, "export const storageUrl = process.env.STORAGE_URL;\n"],
  ])("block a write that breaks %s", async (rule, file, text) => {
    recordSteps();
    const outcome = await session(electronProject(DESK_APP)).write(file, text);
    expect(outcome.kind).toBe("block");
    expect(outcome.findings?.map((finding) => `${finding.file} ${finding.rule}`)).toEqual([`${file} ${rule}`]);
    expect(outcome.reason).toContain(LAYOUT);
  });

  it("give the session the contract's exports at its start", async () => {
    const outcome = await session(electronProject(DESK_APP)).start();
    const context = outcome.context ?? "";
    expect(context).toContain(
      "## src/shared (the contract between main, preload and renderer)\n\n- `notes.ts`: `NOTES_CHANNELS`, `Note`, `NotesBridge`, `isNoteList`",
    );
    expect(context).toContain("## notes\n\n- `index.ts`: `NoteList`");
    expect(context).not.toContain("badge");
    expect(context).not.toContain("countLabel");
  });

  it("run one tsc step over both projects at Stop and in CI, the build in CI, and no Next step", async () => {
    const repo = electronProject(DESK_APP);
    const steps = recordSteps();
    const hooks = session(repo);
    await hooks.prompt();
    expect(await hooks.write("src/shared/note.ts", "export interface Note {\n  total: string;\n}\n")).toEqual({ kind: "allow" });
    steps.length = 0;
    expect(await hooks.stop()).toEqual({ kind: "allow" });
    expect(steps.map((step) => step.split(":")[0])).toEqual(["tsc", "eslint", "depcruise", "knip", "jscpd", "vitest"]);
    expect(steps[0]).toBe("tsc: tsconfig.node.json tsconfig.web.json");

    steps.length = 0;
    await ciGate(repo.root);
    expect(steps.map((step) => step.split(":")[0])).toEqual(["prettier", "eslint", "eslint-preset", "tsc", "depcruise", "knip", "jscpd", "vitest", "build"]);
    expect(steps).toContain("tsc: tsconfig.node.json tsconfig.web.json");
    expect(steps.at(-1)).toMatch(/^build: .*\/repo\/node_modules\/\.bin\/electron-vite build$/);
  });
});
