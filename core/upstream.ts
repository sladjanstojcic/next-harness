import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE, type HarnessConfig } from "../config.ts";

const upstreamList = z.strictObject({ version: z.literal(1), files: z.array(z.string()) });

/**
 * The kit's files, when the config names an upstream list: every file not on it is the project's own. A missing or
 * invalid list grants nothing, so every file is judged; undefined when the config names no list.
 */
export function readUpstream(gitRoot: string, config: HarnessConfig): ReadonlySet<string> | undefined {
  if (config.upstream === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(gitRoot, config.upstream), "utf8"));
  } catch {
    return new Set();
  }
  const result = upstreamList.safeParse(parsed);
  return new Set(result.success ? result.data.files : []);
}

function listed(gitRoot: string, args: readonly string[]): string[] {
  const result = spawnSync("git", args, { cwd: gitRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter((file) => file !== "");
}

/**
 * Writes the upstream list. With a git ref, such as the kit's `upstream/main`: the tracked files that also exist in that
 * ref, so it can be repeated after every kit update. Without one, and only while no list exists: every tracked file.
 */
export function syncUpstream(gitRoot: string, config: HarnessConfig, ref: string | undefined): string {
  const upstream = config.upstream;
  if (upstream === undefined) throw new Error(`${CONFIG_FILE} sets no upstream path; add \`upstream: "<path>.json"\` first.`);
  const target = path.join(gitRoot, upstream);
  if (ref === undefined && fs.existsSync(target)) {
    throw new Error(
      `${upstream} already exists; name the kit's git ref to refresh it: upstream sync <ref>. Without a ref every file, also your own, would be listed.`,
    );
  }
  const tracked = listed(gitRoot, ["ls-files", "-z"]);
  const kit = ref === undefined ? undefined : new Set(listed(gitRoot, ["ls-tree", "-r", "--name-only", "-z", ref]));
  const files = tracked.filter((file) => file !== upstream && (kit === undefined || kit.has(file))).sort();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
  const source = ref === undefined ? "every tracked file" : `the tracked files that exist in ${ref}`;
  return `Wrote ${upstream} with ${String(files.length)} files (${source}). Every other file is the project's own. Commit it.`;
}
