import { describe, expect, it } from "vitest";
import type { GateResult } from "./gate-result.ts";
import { decideStop, startTask, taskState } from "./repair-budget.ts";
import { readState, sessionFile } from "../state/state-file.ts";
import { changedSince } from "../state/snapshot.ts";
import { makeRepo } from "../testing/temp-repo.ts";

const failure: GateResult = { passed: false, findings: [], preExisting: [], report: "broken" };
const state = { tree: "tree", attempts: 0, lastReport: null };

describe("repair budget", () => {
  it("snapshots the current tree and resets repairs for a new task", () => {
    const repo = makeRepo();
    repo.write("src/shared/lib/value.ts", "export const value = 1;\n");
    startTask(repo.root, "s");
    const saved = readState(repo.root, sessionFile("task", "s"), taskState)!;
    expect(saved).toMatchObject({ attempts: 0, lastReport: null });
    expect(changedSince(repo.root, saved.tree)).toEqual([]);
  });

  it("clears the budget and last report on pass", () => {
    expect(decideStop({ ...state, attempts: 2, lastReport: "broken" }, { ...failure, passed: true })).toEqual({
      verdict: "pass",
      next: state,
    });
  });

  it("records each new failure and allows exactly two repairs", () => {
    const first = decideStop(state, failure);
    expect(first).toEqual({ verdict: "block", next: { ...state, attempts: 1, lastReport: "broken" } });
    const second = decideStop(first.next, { ...failure, report: "different" });
    expect(second).toEqual({ verdict: "block", next: { ...state, attempts: 2, lastReport: "different" } });
    expect(decideStop(second.next, { ...failure, report: "third" })).toEqual({ verdict: "give-up", next: second.next });
  });

  it("gives up on an identical failure and preserves the state on subsequent stops", () => {
    const previous = { ...state, attempts: 1, lastReport: "broken" };
    expect(decideStop(previous, failure)).toEqual({ verdict: "give-up", next: previous });
    expect(decideStop(previous, failure)).toEqual({ verdict: "give-up", next: previous });
  });
});
