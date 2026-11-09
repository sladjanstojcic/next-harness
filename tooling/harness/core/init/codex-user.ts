import fs from "node:fs";
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

const FEATURES_HEADER = /^[ \t]*\[features\][ \t]*(?:#.*)?$/m;
const HOOKS_LINE = /^[ \t]*hooks[ \t]*=[ \t]*([^#\n]*?)[ \t]*(?:#.*)?$/m;

function featuresTable(text: string): { start: number; end: number } | undefined {
  const header = FEATURES_HEADER.exec(text);
  if (header === null) return undefined;
  const start = header.index + header[0].length;
  const next = /^[ \t]*\[/m.exec(text.slice(start));
  return { start, end: next === null ? text.length : start + next.index };
}

/** Reads `hooks` inside the [features] table only, so a key of the same name in another table never counts. */
export function codexHooksSetting(text: string): "on" | "off" | "absent" {
  const table = featuresTable(text);
  const line = table === undefined ? null : HOOKS_LINE.exec(text.slice(table.start, table.end));
  if (line === null) return "absent";
  return line[1] === "true" ? "on" : "off";
}

/** Sets `hooks = true` in the [features] table of a config.toml text, adding the table when it is missing. */
export function withHooksFeature(text: string): string {
  if (codexHooksSetting(text) === "on") return text;
  const table = featuresTable(text);
  if (table === undefined) return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}\n[features]\nhooks = true\n`;
  const body = text.slice(table.start, table.end);
  const next = HOOKS_LINE.test(body) ? body.replace(HOOKS_LINE, "hooks = true") : `\nhooks = true${body}`;
  return `${text.slice(0, table.start)}${next}${text.slice(table.end)}`;
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
  const config = path.join(codexDir, "config.toml");
  const text = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "";
  const next = withHooksFeature(text);
  if (next !== text) fs.writeFileSync(config, next);
  return { file, added };
}
