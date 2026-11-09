import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const hook = z.object({ type: z.literal("command"), command: z.string(), timeout: z.number().optional() });
const entry = z.object({ matcher: z.string().optional(), hooks: z.array(hook) });
const hooksFile = z.object({ hooks: z.record(z.string(), z.array(entry)) });

/**
 * Codex loads a project's .codex/hooks.json in a trusted standalone clone but not in a linked git worktree
 * (observed with Codex CLI 0.166.0). A user-level hook fills that gap and steps aside everywhere else:
 * it runs only where .git is a file, which is what marks a linked worktree.
 */
export const WORKTREE_COMMAND =
  'r=$(git rev-parse --show-toplevel 2>/dev/null) && [ -f "$r/.git" ] && [ -f "$r/tooling/harness/cli.ts" ] && exec node "$r/tooling/harness/cli.ts" hook codex || exit 0';

function readHooks(file: string): z.infer<typeof hooksFile> {
  if (!fs.existsSync(file)) return { hooks: {} };
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return hooksFile.parse(value);
}

function enableHooksFeature(file: string): void {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^\s*hooks\s*=\s*true\s*$/m.test(text)) return;
  const next = /^\[features\]\s*$/m.test(text)
    ? text.replace(/^\[features\]\s*$/m, "[features]\nhooks = true")
    : `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}\n[features]\nhooks = true\n`;
  fs.writeFileSync(file, next);
}

export function installCodexHooks(root: string, home: string): { file: string; added: number } {
  const project = readHooks(path.join(root, ".codex/hooks.json"));
  const codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const file = path.join(codexDir, "hooks.json");
  const user = readHooks(file);
  let added = 0;
  for (const [event, entries] of Object.entries(project.hooks)) {
    const current = user.hooks[event] ?? [];
    for (const item of entries) {
      const present = current.some((candidate) => candidate.matcher === item.matcher && candidate.hooks.some((h) => h.command === WORKTREE_COMMAND));
      if (present) continue;
      current.push({ ...item, hooks: item.hooks.map((h) => ({ ...h, command: WORKTREE_COMMAND })) });
      added += 1;
    }
    user.hooks[event] = current;
  }
  fs.writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
  enableHooksFeature(path.join(codexDir, "config.toml"));
  return { file, added };
}

if (import.meta.main) {
  const result = installCodexHooks(process.cwd(), os.homedir());
  console.log(
    `Codex user hooks: ${String(result.added)} added in ${result.file}. They run only inside linked git worktrees; review them once in Codex with /hooks.`,
  );
}
