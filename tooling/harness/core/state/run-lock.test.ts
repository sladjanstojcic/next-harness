import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { withGateLock } from "./run-lock.ts";
import { stateDir } from "./state-file.ts";

const deadPid = 4_194_303;

describe("gate lock", () => {
  it("runs the gates one after another and removes its lock afterwards", async () => {
    const { root } = makeRepo();
    const order: string[] = [];
    const slow = withGateLock(root, async () => {
      order.push("first start");
      await new Promise((resolve) => setTimeout(resolve, 150));
      order.push("first end");
      return 1;
    });
    const fast = withGateLock(
      root,
      async () => {
        order.push("second start");
        return 2;
      },
      { pollMs: 10 },
    );
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(order).toEqual(["first start", "first end", "second start"]);
    expect(fs.existsSync(path.join(stateDir(root), "gate.lock"))).toBe(false);
  });

  it("replaces a lock whose holder is dead, corrupt or abandoned", async () => {
    const { root } = makeRepo();
    const file = path.join(stateDir(root), "gate.lock");
    for (const stale of [JSON.stringify({ pid: deadPid, at: 5_000 }), "{", JSON.stringify({ pid: process.pid, at: 0 })]) {
      fs.writeFileSync(file, stale);
      expect(await withGateLock(root, () => Promise.resolve("ran"), { now: () => 1_000_000, staleMs: 100, pollMs: 1 })).toBe("ran");
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  it("takes over a live lock once the wait is exhausted", async () => {
    const { root } = makeRepo();
    const file = path.join(stateDir(root), "gate.lock");
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: 10 }));
    let clock = 10;
    const now = (): number => {
      clock += 60;
      return clock;
    };
    expect(await withGateLock(root, () => Promise.resolve("took over"), { now, waitMs: 100, staleMs: 10_000, pollMs: 1 })).toBe("took over");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("releases the lock when the gate throws", async () => {
    const { root } = makeRepo();
    await expect(withGateLock(root, () => Promise.reject(new Error("gate failed")))).rejects.toThrow("gate failed");
    expect(fs.existsSync(path.join(stateDir(root), "gate.lock"))).toBe(false);
  });
});
