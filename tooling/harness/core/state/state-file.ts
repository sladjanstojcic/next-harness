import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

export function stateDir(root: string): string {
  const gitPath = execFileSync("git", ["rev-parse", "--git-path", "harness"], { cwd: root, encoding: "utf8" }).trim();
  const directory = path.resolve(root, gitPath);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function statePath(root: string, name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error("State files belong directly in the repository's Git harness directory.");
  return path.join(stateDir(root), name);
}

export function readState<T>(root: string, name: string, schema: z.ZodType<T>): T | null {
  const file = statePath(root, name);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function writeState(root: string, name: string, value: unknown): void {
  fs.writeFileSync(statePath(root, name), `${JSON.stringify(value)}\n`);
}

/** Task and shell snapshots are kept per agent session, so parallel agents in one checkout never read each other's state. */
export function sessionFile(kind: "task" | "shell", sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  return `${kind}-${safe === "" ? "default" : safe}.json`;
}

export function pruneSessionState(root: string, now = Date.now(), maxAgeMs = 7 * 86_400_000): void {
  const directory = stateDir(root);
  for (const name of fs.readdirSync(directory)) {
    if (!/^(?:task|shell)-.*\.json$/.test(name)) continue;
    const file = path.join(directory, name);
    if (now - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
  }
}
