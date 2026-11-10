import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventError, parseEvent, type Client, type HookEvent } from "./event.ts";

const fixture = (client: Client, name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", client, `${name}.json`), "utf8"));
const base = { session_id: "s", cwd: "/repo", hook_event_name: "PreToolUse" };

// New prompt fixtures: https://code.claude.com/docs/en/hooks#userpromptsubmit
// and https://developers.openai.com/codex/hooks (UserPromptSubmit).
// Notebook input: https://code.claude.com/docs/en/agent-sdk/typescript#notebookedit
const cases: [Client, string, Partial<HookEvent>][] = [
  ["claude", "session-start", { event: "session-start", paths: [], writePaths: [] }],
  ["claude", "user-prompt-submit", { event: "user-prompt", paths: [], writePaths: [] }],
  ["claude", "pre-tool-edit", { event: "pre-tool", paths: [".env.local"], writePaths: [".env.local"] }],
  ["claude", "pre-tool-bash", { event: "pre-tool", command: "git push --force origin main", paths: [], writePaths: [] }],
  ["claude", "post-tool", { event: "post-tool", paths: ["src/example.ts"], writePaths: ["src/example.ts"] }],
  ["claude", "stop", { event: "stop", paths: [], writePaths: [] }],
  ["claude", "pre-tool-notebook-edit", { event: "pre-tool", paths: ["docs/analysis.ipynb"], writePaths: ["docs/analysis.ipynb"] }],
  ["codex", "session-start", { event: "session-start", paths: [], writePaths: [] }],
  ["codex", "user-prompt-submit", { event: "user-prompt", paths: [], writePaths: [] }],
  ["codex", "pre-tool-bash", { event: "pre-tool", command: "prisma migrate reset", paths: [], writePaths: [] }],
  [
    "codex",
    "pre-tool-apply-patch",
    {
      event: "pre-tool",
      paths: ["src/example.ts", "src/answer.ts", ".env.local"],
      writePaths: ["src/answer.ts", ".env.local"],
    },
  ],
  ["codex", "post-tool", { event: "post-tool", paths: ["src/example.ts"], writePaths: ["src/example.ts"] }],
  ["codex", "stop", { event: "stop", paths: [], writePaths: [] }],
];

describe("parseEvent", () => {
  it.each(["repair report", undefined, 42, null])("tolerates user prompt metadata %s", (prompt) => {
    const parsed = parseEvent("codex", { ...base, hook_event_name: "UserPromptSubmit", prompt }, "/repo");
    expect(parsed).toMatchObject({ event: "user-prompt" });
    expect(parsed.prompt).toBe(typeof prompt === "string" ? prompt : undefined);
  });

  it.each<Client>(["claude", "codex"])("ignores unused SessionStart source metadata for %s", (client) => {
    const raw = { ...base, hook_event_name: "SessionStart", source: "something-new" };
    expect(parseEvent(client, raw, "/repo").event).toBe("session-start");
  });

  it.each<Client>(["claude", "codex"])("ignores unused Stop activity metadata for %s", (client) => {
    const raw = { ...base, hook_event_name: "Stop", stop_hook_active: "already-continuing" };
    expect(parseEvent(client, raw, "/repo").event).toBe("stop");
  });

  it.each(cases)("parses %s %s", (client, name, expected) => {
    expect(parseEvent(client, fixture(client, name), "/repo")).toMatchObject({
      ...expected,
      client,
      cwd: "/repo",
      sessionId: client === "claude" ? "abc123" : "thr_123",
    });
  });

  it.each([
    ["/repo/src/shared/lib/x.ts", "src/shared/lib/x.ts"],
    ["/etc/hosts", "/etc/hosts"],
    ["/repo-other/x", "/repo-other/x"],
    ["../../outside.ts", "/outside.ts"],
    ["../shared/lib/x.ts", "shared/lib/x.ts"],
    ["./shared/lib/x.ts", "src/shared/lib/x.ts"],
  ])("normalizes %s relative to root, resolving relative paths from cwd", (file, expected) => {
    const result = parseEvent("claude", { ...base, cwd: "/repo/src", tool_name: "Write", tool_input: { file_path: file } }, "/repo");
    expect(result.paths).toEqual([expected]);
    expect(result.writePaths).toEqual([expected]);
  });

  it.each(["Notification", "PostToolBatch", "SubagentStop", "toString"])("ignores the unrelated event %s", (name) => {
    expect(parseEvent("claude", { hook_event_name: name }, "/repo").event).toBe("ignored");
  });

  it.each(["Read", "MultiEdit", "mcp__fs__read"])("ignores the unrelated tool %s", (tool) => {
    expect(parseEvent("claude", { ...base, tool_name: tool, tool_input: {} }, "/repo").event).toBe("ignored");
  });

  it.each([
    ["Edit", {}, "tool_input.file_path"],
    ["Write", { file_path: 3 }, "tool_input.file_path"],
    ["NotebookEdit", {}, "tool_input.notebook_path"],
    ["Bash", { command: 3 }, "tool_input.command"],
    ["apply_patch", { command: "*** Begin Patch\n*** End Patch" }, "tool_input.command (patch)"],
  ])("fails closed for malformed %s", (tool, input, field) => {
    expect(() => parseEvent("claude", { ...base, tool_name: tool, tool_input: input }, "/repo")).toThrow(EventError);
    try {
      parseEvent("claude", { ...base, tool_name: tool, tool_input: input }, "/repo");
    } catch (error) {
      expect(error).toMatchObject({ fields: [field] });
    }
  });

  it("reports malformed envelope fields without leaking input values", () => {
    expect(() => parseEvent("codex", { ...base, session_id: 1, cwd: "secret-relative-path" }, "/repo")).toThrow(
      "hook event: missing or mistyped session_id, cwd",
    );
  });
});
