import { z } from "zod";
import { snapshotTree } from "../state/snapshot.ts";
import { pruneSessionState, sessionFile, writeState } from "../state/state-file.ts";
import type { GateResult } from "./gate-result.ts";

export const taskState = z.object({ tree: z.string().min(1), attempts: z.number().int().min(0), lastReport: z.string().nullable() });
export type TaskState = z.infer<typeof taskState>;

export function startTask(root: string, sessionId: string): void {
  pruneSessionState(root);
  writeState(root, sessionFile("task", sessionId), { tree: snapshotTree(root), attempts: 0, lastReport: null } satisfies TaskState);
}

export function decideStop(state: TaskState, result: GateResult): { verdict: "pass" | "block" | "give-up"; next: TaskState } {
  if (result.passed) return { verdict: "pass", next: { ...state, attempts: 0, lastReport: null } };
  if (state.attempts >= 2 || result.report === state.lastReport) return { verdict: "give-up", next: state };
  return { verdict: "block", next: { ...state, attempts: state.attempts + 1, lastReport: result.report } };
}
