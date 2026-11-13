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
const IMPORT_TOKEN = /(?:^|\s)@(?:\.\/)?AGENTS\.md(?=\s|$)/m;
/** Codex's default project_doc_max_bytes: it reads no further into the project's instruction files. */
const CODEX_LIMIT = 32 * 1024;

/** Said once above several guide pairs, whose trees and paths are written from the workspace folder. */
const PER_WORKSPACE = "Each pair of sections below is about the workspaces its headings name; the paths in it start at each of those folders.";

/** One guide pair per guide the configured workspaces use; with several, the headings name the workspaces each pair is about. */
export function harnessBlock(root: string): string {
  const harness = resolveHarness(root);
  const entries = harness.config.workspaces;
  const groups = new Map<string, { shape: string; paths: string[] }>();
  for (const entry of entries) {
    // A next-modules entry takes its layout from the folders it covers; a `/*` entry covering none uses src/.
    const covered = harness.workspaces.find((workspace) => isWorkspaceFolder(entry, workspace.path));
    const name = guideName({ shape: entry.shape, ...(covered?.sourceRoot === undefined ? {} : { sourceRoot: covered.sourceRoot }) });
    const where = entry.path.replace(/^\.\/?$/, "") === "" ? "." : entry.path;
    const group = groups.get(name) ?? { shape: entry.shape, paths: [] };
    groups.set(name, { ...group, paths: [...group.paths, where] });
  }
  const pairs = [...groups].map(([name, { shape, paths }]) => {
    const guide = readGuide(name);
    if (entries.length === 1) return guide;
    const where = paths.join(", ");
    return guide
      .replace(/^## Architecture and why$/m, `## Architecture and why: ${where} (${shape})`)
      .replace(/^## Where code goes$/m, `## Where code goes: ${where}`);
  });
  return [BLOCK_START, ...(entries.length === 1 ? [] : [PER_WORKSPACE]), ...pairs, readGuide("common"), BLOCK_END].join("\n\n");
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

/** Whether two blocks say the same: a project's own Prettier may rewrap lines or reindent lists inside the block. */
export function sameBlock(a: string, b: string): boolean {
  const words = (text: string): string => text.replace(/\s+/g, " ").trim();
  return words(a) === words(b);
}

/** A file's text, undefined when it is absent, or why it cannot be read. */
function readFile(file: string): string | undefined | { problem: string } {
  try {
    if (!fs.existsSync(file)) return undefined;
    if (!fs.statSync(file).isFile()) return { problem: "is not a file; make it one and rerun init" };
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : String(error);
    return { problem: `${path.basename(file)} cannot be read (${reason}); make it readable and rerun init` };
  }
}

/** The text AGENTS.md holds after the step, or why init leaves it alone and the size it keeps, when known. */
function nextAgents(root: string): { before: string; after: string; range: ReturnType<typeof blockIn> } | { problem: string; bytes?: number } {
  const read = readFile(path.join(root, AGENTS));
  if (typeof read === "object") return read;
  const before = read ?? "";
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const block = harnessBlock(root).replaceAll("\n", eol);
  if (before === "") return { before, after: `${block}${eol}`, range: "none" };
  const range = blockIn(before);
  if (range === "broken") {
    const problem = "holds harness markers that do not form one block; remove the stray marker and rerun init";
    return { problem, bytes: Buffer.byteLength(before) };
  }
  if (range === "none") return { before, after: `${before}${before.endsWith(eol) ? eol : `${eol}${eol}`}${block}${eol}`, range };
  if (sameBlock(before.slice(range.start, range.end), block)) return { before, after: before, range };
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

function realPath(file: string): string | undefined {
  try {
    return fs.realpathSync(file);
  } catch {
    return undefined;
  }
}

/** Claude Code reads CLAUDE.md, not AGENTS.md: the import line brings the harness rules in. */
export function claudeStep(root: string): Step {
  const file = path.join(root, CLAUDE);
  const read = readFile(file);
  if (read === undefined) return { target: CLAUDE, status: "created", detail: `imports ${AGENTS}`, apply: writer(file, `${IMPORT}\n`) };
  if (typeof read === "object") return { target: CLAUDE, status: "kept", detail: read.problem, todo: true };
  // Claude Code takes an @ import anywhere in the text, with or without ./; a link to AGENTS.md is the file itself.
  if (IMPORT_TOKEN.test(read)) return { target: CLAUDE, status: "unchanged", detail: `imports ${AGENTS}` };
  if (fs.realpathSync(file) === realPath(path.join(root, AGENTS))) return { target: CLAUDE, status: "unchanged", detail: `links to ${AGENTS}` };
  return { target: CLAUDE, status: "kept", detail: `add the line ${IMPORT} so Claude Code reads the harness rules`, todo: true };
}

export function agentsSizeNote(root: string): string[] {
  const next = nextAgents(root);
  const bytes = "problem" in next ? (next.bytes ?? 0) : Buffer.byteLength(next.after);
  if (bytes <= CODEX_LIMIT) return [];
  return [
    `${AGENTS} is ${String(bytes)} bytes; Codex stops reading project instructions at 32 KiB (project_doc_max_bytes). Shorten the part outside the harness block.`,
  ];
}
