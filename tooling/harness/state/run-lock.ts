import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "./state-file.ts";

const lockState = z.object({ pid: z.number().int(), at: z.number() });
export interface LockOptions {
  /** How long to wait for a live holder before taking the lock over. */
  waitMs?: number;
  /** A holder older than this is treated as abandoned even if its process is alive. */
  staleMs?: number;
  pollMs?: number;
  now?: () => number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(file: string): z.infer<typeof lockState> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const parsed = lockState.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Serializes the gates that write shared files (Next type generation, incremental tsc) when several
 * agents work in one checkout. A dead, corrupt or abandoned lock is removed; a live one is awaited.
 */
export async function withGateLock<T>(root: string, run: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const { waitMs = 300_000, staleMs = 600_000, pollMs = 100, now = Date.now } = options;
  const file = path.join(stateDir(root), "gate.lock");
  const started = now();
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now() }), { flag: "wx" });
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const holder = readLock(file);
    if (holder === null || !alive(holder.pid) || now() - holder.at > staleMs || now() - started > waitMs) {
      fs.rmSync(file, { force: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await run();
  } finally {
    if (readLock(file)?.pid === process.pid) fs.rmSync(file, { force: true });
  }
}
