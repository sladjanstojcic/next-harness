import path from "node:path";
import { isLocked, lockReason, UNLOCK_COMMAND, unlocked } from "../lock.ts";
import { isIgnored } from "../state/git-ignore.ts";
import { checkPath, isVendored } from "../structure.ts";
import type { HookEvent } from "./event.ts";
import { isInside, realPath, removesOutside } from "./shell.ts";
export interface Denial {
  guard: string;
  reason: string;
}
const shellGuards = [
  {
    guard: "destructive-prisma",
    pattern:
      /\bprisma\s+(migrate\s+(reset|dev)\b|db\s+(execute|pull)\b|db\s+push\b[^;&|]*--(force-reset|accept-data-loss))|PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION/i,
    reason: "Run destructive migrations by the user's hand; schema changes belong in reviewed migrations, while prisma generate and non-force db push pass.",
  },
  {
    guard: "destructive-supabase",
    pattern: /\bsupabase\s+db\s+reset\b[^;&|]*--(project-ref|linked)\b/i,
    reason: "Reset only the local stack with supabase db reset; linked-project schema changes belong in reviewed migrations applied by the user.",
  },
  {
    guard: "harness-telemetry",
    pattern: /\bblocks\b[^|&;]*--false\b/,
    reason: "Marking a false block is the user's judgement: name the wrong block in your handoff and let them run `pnpm harness:blocks --false <id>`.",
  },
  {
    guard: "git-force-push",
    pattern:
      /\bgit(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*\s+push\b[^;&|]*(\s-[a-z]*f[a-z]*(?=\s|$)|--force(-with-lease|-if-includes)?\b|\s\+\S)/i,
    reason: "Push normally; history rewrites belong in the user's own Git workflow.",
  },
];

export function checkGuards(event: HookEvent, root: string): Denial | null {
  if (event.event !== "pre-tool") return null;
  if (event.command !== undefined) {
    if (UNLOCK_COMMAND.test(event.command)) {
      return { guard: "harness-lock", reason: "Unlocking the harness is the user's step: ask them to run `pnpm harness:unlock` in their own terminal." };
    }
    for (const guard of shellGuards) {
      if (guard.pattern.test(event.command)) return { guard: guard.guard, reason: guard.reason };
    }
    if (removesOutside(event.command, event.cwd, root)) {
      return { guard: "rm-outside-repo", reason: "Remove files inside the checkout only; removals outside the repository or in .git belong to the user." };
    }
    return null;
  }
  const canonicalRoot = realPath(root);
  const relativePath = (file: string): string | null => {
    const target = realPath(path.resolve(canonicalRoot, file));
    return isInside(canonicalRoot, target) ? path.relative(canonicalRoot, target).split(path.sep).join("/") : null;
  };
  const writePaths = new Set(event.writePaths.map(relativePath));
  for (const file of event.paths) {
    const relative = relativePath(file);
    if (relative === null) continue;
    const name = path.posix.basename(relative);
    if (/^\.env(\..*)?$/.test(name) && name !== ".env.example") {
      return { guard: "env-file-write", reason: `${relative} holds the user's secrets; agent-authored configuration belongs in .env.example.` };
    }
    if (relative === "pnpm-lock.yaml")
      return { guard: "lockfile-write", reason: "Dependency edits belong in package.json; regenerate pnpm-lock.yaml with pnpm install." };
    if (isVendored(relative)) {
      return { guard: "vendored-write", reason: "add primitives with `pnpm dlx shadcn add <name>`; customise in src/shared/components/" };
    }
    if (isLocked(relative) && !unlocked(canonicalRoot)) return { guard: "harness-lock", reason: lockReason(relative) };
    if (writePaths.has(relative)) {
      const verdict = checkPath(relative);
      if (!verdict.ok && !isIgnored(canonicalRoot, relative)) return { guard: "structure-write", reason: `${verdict.rule}: ${verdict.reason}` };
    }
  }
  return null;
}
