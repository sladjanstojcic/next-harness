import type { Finding } from "../audit/finding.ts";
import type { Client, EventName } from "./event.ts";
export interface Outcome {
  kind: "allow" | "deny" | "block" | "allow-unresolved";
  reason?: string;
  message?: string;
  context?: string;
  /** Which guard denied, for the block log. */
  guard?: string;
  /** Which findings blocked, for the block log. */
  findings?: Finding[];
}
interface NativeResponse {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}
function context(hookEventName: string, additionalContext: string): NativeResponse {
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }), stderr: "" };
}

export function renderResponse(client: Client, event: EventName, outcome: Outcome): NativeResponse {
  const reason = outcome.reason ?? "";
  switch (outcome.kind) {
    case "deny":
      return { exitCode: 2, stdout: "", stderr: `${reason}\n` };
    case "block":
      if (event === "stop") return { exitCode: 0, stdout: JSON.stringify({ decision: "block", reason }), stderr: "" };
      if (event === "post-tool" && client === "codex") return context("PostToolUse", reason);
      return { exitCode: 2, stdout: "", stderr: `${reason}\n` };
    case "allow-unresolved": {
      const systemMessage = outcome.message ?? "unresolved";
      const body = client === "codex" && event === "stop" ? { continue: true, systemMessage } : { systemMessage };
      return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
    }
    case "allow":
      if (event === "session-start" && outcome.context !== undefined) return context("SessionStart", outcome.context);
      return { exitCode: 0, stdout: client === "codex" && event === "stop" ? JSON.stringify({ continue: true }) : "", stderr: "" };
  }
}
