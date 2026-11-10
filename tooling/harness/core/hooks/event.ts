import path from "node:path";
import { z } from "zod";
import { patchPaths } from "./patch-paths.ts";
import { isInside, realPath } from "./shell.ts";

export type Client = "claude" | "codex";
export type EventName = "session-start" | "user-prompt" | "pre-tool" | "post-tool" | "stop" | "ignored";
export interface HookEvent {
  client: Client;
  event: EventName;
  sessionId: string;
  cwd: string;
  toolName?: string;
  command?: string;
  prompt?: string;
  paths: string[];
  writePaths: string[];
}
export class EventError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`hook event: missing or mistyped ${fields.join(", ")}`);
    this.name = "EventError";
    this.fields = fields;
  }
}
const envelope = z.object({
  session_id: z.string().min(1),
  cwd: z.string().refine((value) => path.isAbsolute(value)),
  hook_event_name: z.string(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  prompt: z.unknown().optional(),
});
const commandInput = z.object({ command: z.string().min(1) });
const fileInput = z.object({ file_path: z.string().min(1) });
const notebookInput = z.object({ notebook_path: z.string().min(1) });
const events = new Map<string, EventName>([
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt"],
  ["PreToolUse", "pre-tool"],
  ["PostToolUse", "post-tool"],
  ["PostToolUseFailure", "post-tool"],
  ["Stop", "stop"],
]);

function parse<T>(schema: z.ZodType<T>, input: unknown, prefix = ""): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new EventError(result.error.issues.map((issue) => `${prefix}${issue.path.map(String).join(".") || "(root)"}`));
  }
  return result.data;
}

export function parseEvent(client: Client, input: unknown, root: string): HookEvent {
  const header = parse(z.object({ hook_event_name: z.string() }), input);
  const event = events.get(header.hook_event_name);
  const ignored: HookEvent = { client, event: "ignored", sessionId: "", cwd: root, paths: [], writePaths: [] };
  if (event === undefined) return ignored;
  const raw = parse(envelope, input);
  const base: HookEvent = { ...ignored, sessionId: raw.session_id, cwd: raw.cwd };
  if (event === "user-prompt") return { ...base, event, ...(typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}) };
  if (event === "session-start" || event === "stop") return { ...base, event };
  const toolName = raw.tool_name ?? "";
  if (toolName === "Bash") {
    const { command } = parse(commandInput, raw.tool_input, "tool_input.");
    return { ...base, event, toolName, command };
  }
  const canonicalRoot = realPath(path.resolve(root));
  const normalize = (file: string): string => {
    const absolute = path.resolve(raw.cwd, file);
    const target = realPath(absolute);
    return isInside(canonicalRoot, target) ? path.relative(canonicalRoot, target).split(path.sep).join("/") : absolute;
  };
  if (toolName === "apply_patch") {
    const { command } = parse(commandInput, raw.tool_input, "tool_input.");
    let operations;
    try {
      operations = patchPaths(command);
    } catch {
      throw new EventError(["tool_input.command (patch)"]);
    }
    return {
      ...base,
      event,
      toolName,
      paths: [...new Set(operations.map((entry) => normalize(entry.path)))],
      writePaths: [...new Set(operations.filter((entry) => ["add", "update", "move-to"].includes(entry.op)).map((entry) => normalize(entry.path)))],
    };
  }
  let file: string;
  if (toolName === "NotebookEdit") file = parse(notebookInput, raw.tool_input, "tool_input.").notebook_path;
  else if (toolName === "Write" || toolName === "Edit") file = parse(fileInput, raw.tool_input, "tool_input.").file_path;
  else return base;
  const paths = [normalize(file)];
  return { ...base, event, toolName, paths, writePaths: [...paths] };
}
