import fs from "node:fs";
import path from "node:path";
import { isWorkspaceFolder } from "../../../config.ts";
import { guideName, readGuide } from "../../../guides/guides.ts";
import { resolveHarness } from "../../path-check.ts";
import { writer, type Step } from "../files.ts";

export const BLOCK_START = "<!-- harness:start — written by `node tooling/harness/cli.ts init`; edit outside this block -->";
export const BLOCK_END = "<!-- harness:end -->";

const AGENTS = "AGENTS.md";
const CLAUDE = "CLAUDE.md";
const IMPORT = "@AGENTS.md";
/** Codex's default project_doc_max_bytes: it reads no further into the project's instruction files. */
const CODEX_LIMIT = 32 * 1024;

/** One guide pair per configured workspace; with several, the headings name the workspace each pair is about. */
export function harnessBlock(root: string): string {
  const harness = resolveHarness(root);
  const entries = harness.config.workspaces;
  const pairs = entries.map((entry) => {
    // A next-modules entry takes its layout from the folders it covers; a `/*` entry covering none uses src/.
    const covered = harness.workspaces.find((workspace) => isWorkspaceFolder(entry, workspace.path));
    const guide = readGuide(guideName({ shape: entry.shape, ...(covered?.sourceRoot === undefined ? {} : { sourceRoot: covered.sourceRoot }) }));
    if (entries.length === 1) return guide;
    const where = entry.path.replace(/^\.\/?$/, "") === "" ? "." : entry.path;
    return guide
      .replace(/^## Architecture and why$/m, `## Architecture and why: ${where} (${entry.shape})`)
      .replace(/^## Where code goes$/m, `## Where code goes: ${where}`);
  });
  return [BLOCK_START, ...pairs, readGuide("common"), BLOCK_END].join("\n\n");
}

/** The block's character range, both markers included; a marker counts only at the start of a line outside a code fence. */
export function blockIn(text: string): { start: number; end: number } | "none" | "broken" {
  const starts: number[] = [];
  const ends: number[] = [];
  let fence: string | undefined;
  let offset = 0;
  for (const line of text.split("\n")) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (opener !== undefined && (fence === undefined || (opener[0] === fence[0] && opener.length >= fence.length))) {
      fence = fence === undefined ? opener : undefined;
    } else if (fence === undefined && line.startsWith("<!-- harness:start")) starts.push(offset);
    else if (fence === undefined && line.startsWith(BLOCK_END)) ends.push(offset + BLOCK_END.length);
    offset += line.length + 1;
  }
  if (starts.length === 0 && ends.length === 0) return "none";
  const [start] = starts;
  const [end] = ends;
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end < start) return "broken";
  return { start, end };
}

/** The text AGENTS.md holds after the step, or why init leaves it alone. */
function nextAgents(root: string): { before: string; after: string; range: ReturnType<typeof blockIn> } | { problem: string } {
  const file = path.join(root, AGENTS);
  let before = "";
  if (fs.existsSync(file)) {
    if (!fs.statSync(file).isFile()) return { problem: "is not a file; make it one and rerun init" };
    before = fs.readFileSync(file, "utf8");
  }
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const block = harnessBlock(root).replaceAll("\n", eol);
  if (before === "") return { before, after: `${block}${eol}`, range: "none" };
  const range = blockIn(before);
  if (range === "broken") return { problem: "holds a harness marker without its pair; remove the stray marker and rerun init" };
  if (range === "none") return { before, after: `${before}${before.endsWith(eol) ? eol : `${eol}${eol}`}${block}${eol}`, range };
  return { before, after: `${before.slice(0, range.start)}${block}${before.slice(range.end)}`, range };
}

export function agentsStep(root: string): Step {
  const next = nextAgents(root);
  if ("problem" in next) return { target: AGENTS, status: "kept", detail: next.problem, todo: true };
  const apply = writer(path.join(root, AGENTS), next.after);
  if (next.before === "") return { target: AGENTS, status: "created", detail: "harness rules", apply };
  if (next.range === "none") return { target: AGENTS, status: "updated", detail: "harness rules appended, your text kept", apply };
  if (next.after === next.before) return { target: AGENTS, status: "unchanged", detail: "harness rules" };
  return { target: AGENTS, status: "updated", detail: "harness rules replaced, your text kept", apply };
}

/** Claude Code reads CLAUDE.md, not AGENTS.md: the import line brings the harness rules in. */
export function claudeStep(root: string): Step {
  const file = path.join(root, CLAUDE);
  if (!fs.existsSync(file)) return { target: CLAUDE, status: "created", detail: `imports ${AGENTS}`, apply: writer(file, `${IMPORT}\n`) };
  if (fs.statSync(file).isFile() && fs.readFileSync(file, "utf8").split(/\r?\n/).includes(IMPORT)) {
    return { target: CLAUDE, status: "unchanged", detail: `imports ${AGENTS}` };
  }
  return { target: CLAUDE, status: "kept", detail: `add the line ${IMPORT} so Claude Code reads the harness rules`, todo: true };
}

export function agentsSizeNote(root: string): string[] {
  const next = nextAgents(root);
  const file = path.join(root, AGENTS);
  const kept = fs.existsSync(file) && fs.statSync(file).isFile() ? fs.statSync(file).size : 0;
  const bytes = "problem" in next ? kept : Buffer.byteLength(next.after);
  if (bytes <= CODEX_LIMIT) return [];
  return [
    `${AGENTS} is ${String(bytes)} bytes; Codex stops reading project instructions at 32 KiB (project_doc_max_bytes). Shorten the part outside the harness block.`,
  ];
}
