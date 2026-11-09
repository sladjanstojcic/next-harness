import { z } from "zod";
import { formatFindings } from "../audit/finding.ts";
import { decideStop, startTask, taskState } from "../gates/repair-budget.ts";
import { lockFindings } from "../lock.ts";
import { changedSince, snapshotTree } from "../state/snapshot.ts";
import { readState, sessionFile, writeState } from "../state/state-file.ts";
import type { HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";
import type { Outcome } from "./respond.ts";

export async function handleEvent(event: HookEvent, root: string): Promise<Outcome> {
  switch (event.event) {
    case "session-start": {
      const { codeIndex } = await import("../code-index.ts");
      return { kind: "allow", context: codeIndex(root) };
    }
    case "ignored":
      return { kind: "allow" };
    case "user-prompt": {
      startTask(root, event.sessionId);
      return { kind: "allow" };
    }
    case "pre-tool": {
      const denial = checkGuards(event, root);
      if (denial) return { kind: "deny", reason: denial.reason, guard: denial.guard };
      if (event.toolName === "Bash") writeState(root, sessionFile("shell", event.sessionId), { tree: snapshotTree(root) });
      return { kind: "allow" };
    }
    case "post-tool": {
      if (event.toolName === "Bash") {
        const shell = readState(root, sessionFile("shell", event.sessionId), z.object({ tree: z.string() }));
        if (!shell) return { kind: "allow" };
        const { auditChanged } = await import("../audit/audit.ts");
        const changed = changedSince(root, shell.tree);
        const findings = [...lockFindings(root, changed), ...auditChanged(root, changed)];
        return findings.length === 0 ? { kind: "allow" } : { kind: "block", reason: formatFindings(findings), findings };
      }
      const { fastGate } = await import("../gates/fast-gate.ts");
      const result = await fastGate(root, event.paths);
      return result.passed ? { kind: "allow" } : { kind: "block", reason: result.report, findings: result.findings };
    }
    case "stop": {
      const task = sessionFile("task", event.sessionId);
      const state = readState(root, task, taskState);
      if (!state) {
        startTask(root, event.sessionId);
        return { kind: "allow" };
      }
      const { doneGate } = await import("../gates/done-gate.ts");
      const result = await doneGate(root, changedSince(root, state.tree));
      const { verdict, next } = decideStop(state, result);
      writeState(root, task, next);
      if (verdict === "block") return { kind: "block", reason: result.report, findings: result.findings };
      if (verdict === "give-up")
        return { kind: "allow-unresolved", message: `Checks still failing after 2 repairs:\n${result.report}`, findings: result.findings };
      return { kind: "allow" };
    }
  }
}
