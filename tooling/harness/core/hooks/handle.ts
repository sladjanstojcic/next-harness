import { formatFindings, type Finding } from "../audit/finding.ts";
import { legacyInvalidFindings } from "../classes.ts";
import type { GateResult } from "../gates/gate-result.ts";
import { decideStop, shellState, startTask, taskState, type ShellState } from "../gates/repair-budget.ts";
import { shellLockFindings } from "../lock.ts";
import { resolveHarness } from "../path-check.ts";
import { changedSince, snapshotTree } from "../state/snapshot.ts";
import { readState, sessionFile, writeState } from "../state/state-file.ts";
import type { HookEvent } from "./event.ts";
import { checkGuards } from "./guards.ts";
import { lintConfigFindings } from "./lint-config-guard.ts";
import { migrationFindings, taskApplied } from "./migration-guard.ts";
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
      if (event.toolName === "Bash") {
        const task = readState(root, sessionFile("task", event.sessionId), taskState);
        writeState(root, sessionFile("shell", event.sessionId), { tree: snapshotTree(root), task } satisfies ShellState);
      }
      return { kind: "allow" };
    }
    case "post-tool": {
      if (event.toolName === "Bash") {
        const shell = readState(root, sessionFile("shell", event.sessionId), shellState);
        if (!shell) return { kind: "allow" };
        const changed = changedSince(root, shell.tree);
        const harness = resolveHarness(root);
        const { config } = harness;
        const findings: Finding[] = [
          ...shellLockFindings(root, changed, config),
          ...migrationFindings(root, harness, changed, () => taskApplied(root, shell.task)),
          ...lintConfigFindings(root, harness),
          ...legacyInvalidFindings(root, config),
        ];
        try {
          const { auditChanged } = await import("../audit/audit.ts");
          const { dropUnownedHarnessFindings } = await import("../classes.ts");
          findings.push(...dropUnownedHarnessFindings(root, auditChanged(root, changed)));
        } catch (error) {
          findings.push({ rule: "audit-failed", file: "", message: error instanceof Error ? error.message : String(error) });
        }
        return findings.length === 0 ? { kind: "allow" } : { kind: "block", reason: formatFindings(findings), findings };
      }
      const { fastGate } = await import("../gates/fast-gate.ts");
      const result = await fastGate(root, event.paths);
      return result.passed ? { kind: "allow" } : { kind: "block", reason: result.report, findings: result.findings };
    }
    case "stop": {
      const task = sessionFile("task", event.sessionId);
      const { doneGate } = await import("../gates/done-gate.ts");
      // A destroyed task file falls back to the copy the last shell command took: same baseline, pins and budget.
      let state = readState(root, task, taskState) ?? readState(root, sessionFile("shell", event.sessionId), shellState)?.task ?? null;
      let result: GateResult;
      if (state) result = await doneGate(root, changedSince(root, state.tree), taskApplied(root, state));
      else {
        // No task and no copy: the turn is still judged, over everything that differs from HEAD or its upstream.
        const { recoveryScope } = await import("../gates/recover-task.ts");
        const scope = recoveryScope(root);
        const recovered = scope.changed.length === 0 ? null : await doneGate(root, scope.changed, scope.applied);
        startTask(root, event.sessionId);
        state = readState(root, task, taskState);
        if (recovered === null || state === null) return { kind: "allow" };
        result = recovered;
      }
      const { verdict, next } = decideStop(state, result);
      writeState(root, task, next);
      if (verdict === "block") return { kind: "block", reason: result.report, findings: result.findings };
      if (verdict === "give-up")
        return { kind: "allow-unresolved", message: `Checks still failing after 2 repairs:\n${result.report}`, findings: result.findings };
      return { kind: "allow" };
    }
  }
}
