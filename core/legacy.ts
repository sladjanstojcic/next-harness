import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, type HarnessConfig } from "../config.ts";
import { audit } from "./audit/audit.ts";
import type { Finding } from "./audit/finding.ts";
import { HARNESS_RULES, legacyList, readLegacy } from "./classes.ts";

function committedList(gitRoot: string, legacy: string): Set<string> | undefined {
  const shown = spawnSync("git", ["show", `HEAD:${legacy}`], { cwd: gitRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (shown.status !== 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(shown.stdout);
  } catch {
    return undefined;
  }
  const result = legacyList.safeParse(parsed);
  return result.success ? new Set(result.data.files) : undefined;
}

/** The legacy list only shrinks: an entry absent from its committed version blocks. Inert until the list is committed. */
export function legacyAppendFindings(gitRoot: string, config: HarnessConfig): Finding[] {
  const legacy = config.legacy;
  if (legacy === undefined) return [];
  const committed = committedList(gitRoot, legacy);
  if (committed === undefined) return [];
  return [...readLegacy(gitRoot, config)]
    .filter((file) => !committed.has(file))
    .map((file): Finding => ({
      rule: "legacy-append",
      file: legacy,
      message: `${file} was added to ${legacy}; the legacy list only shrinks. Fix that file's findings instead of listing it.`,
    }));
}

export function initLegacy(gitRoot: string, config: HarnessConfig): string {
  const legacy = config.legacy;
  if (legacy === undefined) throw new Error(`${CONFIG_FILE} sets no legacy path; add \`legacy: "<path>.json"\` first.`);
  const target = path.join(gitRoot, legacy);
  if (fs.existsSync(target)) throw new Error(`${legacy} already exists; remove entries from it as files are fixed.`);
  const files = [
    ...new Set(
      audit(gitRoot)
        .filter((finding) => finding.file !== "" && HARNESS_RULES.has(finding.rule))
        .map((finding) => finding.file),
    ),
  ].sort();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
  return `Wrote ${legacy} with ${String(files.length)} files. Commit it; until then legacy-append is inert.`;
}
