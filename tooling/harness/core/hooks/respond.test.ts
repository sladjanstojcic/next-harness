import { describe, expect, it } from "vitest";
import { renderResponse } from "./respond.ts";
import type { Client } from "./event.ts";

describe.each<Client>(["claude", "codex"])("%s responses", (client) => {
  it("denies a tool with exit 2 and a reason on stderr", () => {
    expect(renderResponse(client, "pre-tool", { kind: "deny", reason: "Use src/modules/." })).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "Use src/modules/.\n",
    });
  });
  it("blocks stopping using the decision JSON", () => {
    expect(renderResponse(client, "stop", { kind: "block", reason: "Fix the findings." })).toEqual({
      exitCode: 0,
      stdout: '{"decision":"block","reason":"Fix the findings."}',
      stderr: "",
    });
  });
  it("adds session context using the documented envelope", () => {
    expect(renderResponse(client, "session-start", { kind: "allow", context: "Code index" })).toEqual({
      exitCode: 0,
      stdout: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Code index"}}',
      stderr: "",
    });
  });
  it("allows unresolved findings while surfacing a warning", () => {
    expect(renderResponse(client, "stop", { kind: "allow-unresolved", message: "Still failing" })).toEqual({
      exitCode: 0,
      stdout: client === "codex" ? '{"continue":true,"systemMessage":"Still failing"}' : '{"systemMessage":"Still failing"}',
      stderr: "",
    });
  });
  it("allows ordinary events silently", () => {
    expect(renderResponse(client, "user-prompt", { kind: "allow" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(renderResponse(client, "ignored", { kind: "allow" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });
});

it("allows a Codex stop with explicit continue JSON", () => {
  expect(renderResponse("codex", "stop", { kind: "allow" })).toEqual({ exitCode: 0, stdout: '{"continue":true}', stderr: "" });
});
it("allows a Claude stop silently", () => {
  expect(renderResponse("claude", "stop", { kind: "allow" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});
it("returns Codex post-tool findings as additional context", () => {
  expect(renderResponse("codex", "post-tool", { kind: "block", reason: "Use src/modules/." })).toEqual({
    exitCode: 0,
    stdout: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Use src/modules/."}}',
    stderr: "",
  });
});
it("returns Claude post-tool findings on stderr", () => {
  expect(renderResponse("claude", "post-tool", { kind: "block", reason: "Use src/modules/." })).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: "Use src/modules/.\n",
  });
});
