import path from "node:path";
import { classify, legacyInvalidFindings, readLegacy } from "../classes.ts";
import { INIT_FORCE_COMMAND, isLocked, lockReason, UNLOCK_COMMAND, unlocked } from "../lock.ts";
import { isIgnored } from "../state/git-ignore.ts";
import { checkPath, isVendoredIn, resolveHarness } from "../path-check.ts";
import type { HookEvent } from "./event.ts";
import { isNestedLintConfig, LINT_CONFIG_RULE, lintConfigReason } from "./lint-config-guard.ts";
import { isAppliedMigration, MIGRATION_RULE, migrationReason } from "./migration-guard.ts";
import { isInside, realPath, removesOutside } from "./shell.ts";
export interface Denial {
  guard: string;
  reason: string;
}
/** Option tokens a CLI skips while looking for its subcommand: `--debug`, `--workdir apps/web`, `-x a,b`. */
const OPTIONS = String.raw`(?:\s+-{1,2}[\w-]+(?:[=\s]\S+)?)*`;
const SUPABASE_CLI = String.raw`\bsupabase(?:@\S+)?\)?${OPTIONS}`;
const shellGuards = [
  {
    guard: "destructive-prisma",
    pattern:
      /\bprisma\s+(migrate\s+(reset|dev)\b|db\s+(execute|pull)\b|db\s+push\b[^;&|]*--(force-reset|accept-data-loss))|PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION/i,
    reason: "Run destructive migrations by the user's hand; schema changes belong in reviewed migrations, while prisma generate and non-force db push pass.",
  },
  {
    guard: "destructive-supabase",
    pattern: /\bsupabase\s+db\s+reset\b[^;&|\n]*--(project-ref|linked)\b/i,
    reason: "Reset only the local stack with supabase db reset; linked-project schema changes belong in reviewed migrations applied by the user.",
  },
  ...[
    { guard: "supabase-push", pattern: new RegExp(String.raw`${SUPABASE_CLI}\s+db${OPTIONS}\s+push\b`, "i") },
    { guard: "supabase-link", pattern: new RegExp(String.raw`${SUPABASE_CLI}\s+link(?![\w-])`, "i") },
    { guard: "supabase-migration-up", pattern: new RegExp(String.raw`${SUPABASE_CLI}\s+migration${OPTIONS}\s+up\b[^;&|\n]*--linked\b`, "i") },
    { guard: "supabase-deploy", pattern: /\b(?:pnpm|npm|yarn|bun|npx|turbo)\b[^;&|]*\bsupabase:deploy\b/i },
  ].map((guard) => ({
    ...guard,
    reason: "Applying schema changes to a linked project is the user's step; leave migrations committed and ask them to deploy.",
  })),
  {
    guard: "harness-telemetry",
    pattern: /\bblocks\b[^|&;\n]*--false\b/,
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
    if (INIT_FORCE_COMMAND.test(event.command) && !unlocked(root)) {
      return {
        guard: "harness-lock",
        reason: "`init --force` replaces locked harness wiring: ask the user to run it in their own terminal, or to unlock the harness first.",
      };
    }
    const unquoted = event.command
      .replace(/\\(.)/g, "$1")
      .replace(/\$(?=["'])/g, "")
      .replace(/["']/g, "");
    for (const guard of shellGuards) {
      if (guard.pattern.test(event.command) || guard.pattern.test(unquoted)) return { guard: guard.guard, reason: guard.reason };
    }
    if (removesOutside(event.command, event.cwd, root)) {
      return { guard: "rm-outside-repo", reason: "Remove files inside the checkout only; removals outside the repository or in .git belong to the user." };
    }
    return null;
  }
  const canonicalRoot = realPath(root);
  const harness = resolveHarness(canonicalRoot);
  const [invalid] = legacyInvalidFindings(canonicalRoot, harness.config);
  if (invalid !== undefined) throw new Error(invalid.message);
  const legacy = readLegacy(canonicalRoot, harness.config);
  const relativePath = (file: string): string | null => {
    const target = realPath(path.resolve(canonicalRoot, file));
    return isInside(canonicalRoot, target) ? path.relative(canonicalRoot, target).split(path.sep).join("/") : null;
  };
  const writePaths = new Set(event.writePaths.map(relativePath));
  for (const file of event.paths) {
    const relative = relativePath(file);
    if (relative === null) continue;
    const name = path.posix.basename(relative);
    if (harness.config.env === "local" ? /^\.env(?:\..*)?\.local$/.test(name) : /^\.env(\..*)?$/.test(name) && name !== ".env.example") {
      const destination = harness.config.env === "local" ? "the committed .env files without .local" : ".env.example";
      return { guard: "env-file-write", reason: `${relative} holds the user's secrets; agent-authored configuration belongs in ${destination}.` };
    }
    if (relative === "pnpm-lock.yaml")
      return { guard: "lockfile-write", reason: "Dependency edits belong in package.json; regenerate pnpm-lock.yaml with pnpm install." };
    if (isAppliedMigration(canonicalRoot, harness, relative)) return { guard: MIGRATION_RULE, reason: migrationReason(relative) };
    if (isNestedLintConfig(harness, relative)) return { guard: LINT_CONFIG_RULE, reason: lintConfigReason(harness, relative) };
    if (isVendoredIn(harness, relative)) {
      return { guard: "vendored-write", reason: "add primitives with `pnpm dlx shadcn add <name>`; customise in src/shared/components/" };
    }
    if (isLocked(relative, harness.config) && !unlocked(canonicalRoot)) return { guard: "harness-lock", reason: lockReason(relative) };
    if (writePaths.has(relative) && classify(relative, harness, legacy) === "owned") {
      const verdict = checkPath(relative, harness);
      if (!verdict.ok && !isIgnored(canonicalRoot, relative)) return { guard: "structure-write", reason: `${verdict.rule}: ${verdict.reason}` };
    }
  }
  return null;
}
