import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { HookEvent } from "./hooks/event.ts";
import type { Outcome } from "./hooks/respond.ts";
import { stateDir } from "./state/state-file.ts";

const LOG = "blocks.jsonl";
const block = z.object({
  type: z.literal("block"),
  id: z.string(),
  at: z.string(),
  session: z.string(),
  client: z.string(),
  event: z.string(),
  kind: z.string(),
  rules: z.array(z.string()),
  files: z.array(z.string()),
  text: z.string(),
});
const falseMark = z.object({ type: z.literal("false-block"), id: z.string(), at: z.string(), note: z.string() });
const entry = z.union([block, falseMark]);
type BlockRecord = z.infer<typeof block>;
export interface BlockSummary extends BlockRecord {
  falseBlock: { at: string; note: string } | null;
}

function logFile(root: string): string {
  return path.join(stateDir(root), LOG);
}

function append(root: string, value: BlockRecord | z.infer<typeof falseMark>): void {
  fs.appendFileSync(logFile(root), `${JSON.stringify(value)}\n`);
}

/** Every denial and block is kept under .git/harness/, so wrong blocks can be counted and marked. Allowed outcomes are not recorded. */
export function recordBlock(root: string, event: HookEvent, outcome: Outcome, now = new Date()): string | null {
  if (outcome.kind === "allow") return null;
  const findings = outcome.findings ?? [];
  const rules = outcome.guard !== undefined ? [outcome.guard] : [...new Set(findings.map((finding) => finding.rule))];
  const files = [...new Set(findings.map((finding) => finding.file).filter((file) => file !== ""))];
  const id = randomBytes(3).toString("hex");
  append(root, {
    type: "block",
    id,
    at: now.toISOString(),
    session: event.sessionId,
    client: event.client,
    event: event.event,
    kind: outcome.kind,
    rules,
    files,
    text: (outcome.reason ?? outcome.message ?? "").slice(0, 2_000),
  });
  return id;
}

export function readBlocks(root: string): BlockSummary[] {
  const file = logFile(root);
  if (!fs.existsSync(file)) return [];
  const records = new Map<string, BlockSummary>();
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (raw === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = entry.safeParse(value);
    if (!parsed.success) continue;
    if (parsed.data.type === "block") records.set(parsed.data.id, { ...parsed.data, falseBlock: null });
    else {
      const target = records.get(parsed.data.id);
      if (target) target.falseBlock = { at: parsed.data.at, note: parsed.data.note };
    }
  }
  return [...records.values()];
}

/** The user's judgement, recorded next to the block it corrects. Returns false when the id is unknown. */
export function markFalseBlock(root: string, id: string, note: string, now = new Date()): boolean {
  if (!readBlocks(root).some((record) => record.id === id)) return false;
  append(root, { type: "false-block", id, at: now.toISOString(), note });
  return true;
}

export function summarizeBlocks(root: string, last = 20): string {
  const blocks = readBlocks(root);
  if (blocks.length === 0) return "No blocks recorded yet.";
  const byRule = new Map<string, { blocks: number; falseBlocks: number }>();
  for (const record of blocks) {
    for (const rule of record.rules.length > 0 ? record.rules : ["(unknown)"]) {
      const row = byRule.get(rule) ?? { blocks: 0, falseBlocks: 0 };
      row.blocks += 1;
      if (record.falseBlock) row.falseBlocks += 1;
      byRule.set(rule, row);
    }
  }
  const table = [...byRule.entries()]
    .sort((left, right) => right[1].blocks - left[1].blocks)
    .map(([rule, row]) => `${String(row.blocks).padStart(6)} ${String(row.falseBlocks).padStart(6)}  ${rule}`);
  const recent = blocks
    .slice(-last)
    .map(
      (record) =>
        `${record.id}  ${record.at}  ${record.client}/${record.event}  ${record.kind}  ${record.rules.join(",")}  ${record.files.join(",")}${record.falseBlock ? `  FALSE: ${record.falseBlock.note}` : ""}`,
    );
  return [
    "blocks  false  rule",
    ...table,
    "",
    `Last ${String(recent.length)} of ${String(blocks.length)}. Mark a wrong one: pnpm harness:blocks --false <id> "why"`,
    ...recent,
  ].join("\n");
}
