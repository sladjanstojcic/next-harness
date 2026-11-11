import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, type HarnessConfig } from "../config.ts";
import { toolWorkspaces } from "../tools/index.ts";
import { audit } from "./audit/audit.ts";
import type { Finding } from "./audit/finding.ts";
import { HARNESS_RULES, legacyList, readLegacy } from "./classes.ts";
import { analysisSteps, checkSteps } from "./gates/ci-steps.ts";
import { runInWorkspace } from "./gates/fast-gate.ts";
import type { Harness } from "./path-check.ts";
import { git, remoteDefault } from "./state/applied-refs.ts";
import { stateDir } from "./state/state-file.ts";

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

const paths = (output: string | null): string[] => (output ?? "").split("\0").filter((file) => file !== "");

/**
 * The legacy files nobody touched: the same as at the merge base with the remote default branch, or as in HEAD when the
 * repository has no remote. Their old tool findings are tolerated in CI; a changed or new file is held to the rules.
 * With a remote but no merge base, as in a shallow checkout, nothing can be told apart: one finding asks for the fetch.
 */
export function untouchedLegacy(gitRoot: string, legacy: ReadonlySet<string>): { files: Set<string>; findings: Finding[] } {
  if (legacy.size === 0) return { files: new Set(), findings: [] };
  const remote = remoteDefault(gitRoot);
  const base = remote === undefined ? null : git(gitRoot, ["merge-base", "HEAD", remote.commit]);
  if (base === null && (git(gitRoot, ["remote"]) ?? "") !== "") {
    const message =
      "The legacy list is judged against the merge base with the remote default branch, and this checkout does not hold it. Fetch the default branch with its history (`fetch-depth: 0` in actions/checkout, or `git fetch --unshallow origin`).";
    return { files: new Set(), findings: [{ rule: "legacy-base-failed", file: "", message }] };
  }
  const changed = new Set([
    ...paths(git(gitRoot, ["diff", "--name-only", "--no-renames", "-z", base ?? "HEAD"])),
    ...paths(git(gitRoot, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
  return { files: new Set([...legacy].filter((file) => !changed.has(file))), findings: [] };
}

/**
 * Writes the legacy list once: every file with a harness finding or a tool finding (format, lint, types, depcruise, knip,
 * jscpd) now, from the same per-file reports CI judges with. A tool that cannot run lists nothing, so it is named.
 */
export async function initLegacy(gitRoot: string, harness: Harness): Promise<string> {
  const legacy = harness.config.legacy;
  if (legacy === undefined) throw new Error(`${CONFIG_FILE} sets no legacy path; add \`legacy: "<path>.json"\` first.`);
  const target = path.join(gitRoot, legacy);
  if (fs.existsSync(target)) throw new Error(`${legacy} already exists; remove entries from it as files are fixed.`);
  const found = audit(gitRoot).filter((finding) => HARNESS_RULES.has(finding.rule));
  const output = fs.mkdtempSync(path.join(stateDir(gitRoot), "jscpd-"));
  try {
    for (const group of toolWorkspaces(gitRoot, harness.workspaces)) {
      const { format, lint, types } = checkSteps(group, true);
      for (const step of [format, lint, ...types, ...analysisSteps(gitRoot, harness, group, true, output)]) {
        if (!("skipped" in step)) found.push(...(await runInWorkspace(gitRoot, group.workspace.path, step)));
      }
    }
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
  const files = [...new Set(found.map((finding) => finding.file).filter((file) => file !== ""))].sort();
  const failed = found.filter((finding) => finding.file === "").map((finding) => `${finding.rule}: ${finding.message.split("\n")[0] ?? ""}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
  return [
    `Wrote ${legacy} with ${String(files.length)} files. Commit it; until then legacy-append is inert.`,
    ...(failed.length === 0 ? [] : [`These steps did not run to the end, so their findings are not on the list and will fail CI:`, ...failed]),
  ].join("\n");
}
