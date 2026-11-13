import fs from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditChanged } from "../core/audit/audit.ts";
import { doneGate } from "../core/gates/done-gate.ts";
import { fastGate } from "../core/gates/fast-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { parseEvent, type Client } from "../core/hooks/event.ts";
import { checkGuards } from "../core/hooks/guards.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { checkPath } from "../core/path-check.ts";
import { COMMANDS, GATE_SEEDS, PATHS, PRE_EXISTING_SEEDS } from "./decision-inputs.ts";
import { normaliseProbes } from "./preset-fixture.ts";
import { templateRepo } from "./template-repo.ts";

afterEach(() => vi.restoreAllMocks());

const SNAPSHOT = path.join(import.meta.dirname, "decision-corpus.json");
const FIXTURES = path.join(import.meta.dirname, "../core/hooks/fixtures");

/** A harness path in another case: the same file where the filesystem folds case, another path where it does not. */
const CASE_VARIANT = "tooling/Harness/x.ts";

function guarded(build: () => ReturnType<typeof checkGuards>): unknown {
  try {
    return build();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function writes(root: string) {
  const envelope = (tool: string, input: Record<string, string>) =>
    parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }, root);
  return Object.fromEntries(
    PATHS.filter((file) => file !== CASE_VARIANT).map((file) => [
      file,
      {
        write: guarded(() => checkGuards(envelope("Write", { file_path: file, content: "" }), root)),
        edit: guarded(() => checkGuards(envelope("Edit", { file_path: file, old_string: "x", new_string: "y" }), root)),
        patch: guarded(() =>
          checkGuards(
            parseEvent(
              "codex",
              {
                session_id: "s",
                cwd: root,
                hook_event_name: "PreToolUse",
                tool_name: "apply_patch",
                tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` },
              },
              root,
            ),
            root,
          ),
        ),
      },
    ]),
  );
}

function commands(root: string) {
  return Object.fromEntries(
    COMMANDS.map((command) => [
      command,
      guarded(() =>
        checkGuards(
          parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, root),
          root,
        ),
      ),
    ]),
  );
}

function summary({ kind, guard, reason, context, message }: Awaited<ReturnType<typeof handleEvent>>) {
  return { kind, guard, reason, context, message };
}

async function events(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const client of ["claude", "codex"] satisfies Client[]) {
    for (const name of fs.readdirSync(path.join(FIXTURES, client)).sort()) {
      const { root } = templateRepo();
      const text = fs.readFileSync(path.join(FIXTURES, client, name), "utf8").replace(/"\/repo(?=[/"])/g, `"${root}`);
      const raw: unknown = JSON.parse(text);
      result[`${client}/${name}`] = normalize(summary(await handleEvent(parseEvent(client, raw, root), root)), root);
    }
  }
  const { root, write } = templateRepo();
  const bash = parseEvent(
    "claude",
    { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "touch src/utils/z.ts" } },
    root,
  );
  const pre = summary(await handleEvent(bash, root));
  write("src/utils/z.ts", "export const z = 1;\n");
  const post = summary(await handleEvent({ ...bash, event: "post-tool" }, root));
  result["claude/post-bash"] = normalize({ pre, post }, root);
  return result;
}

function seededRepo() {
  const repo = templateRepo(PRE_EXISTING_SEEDS, { stack: true });
  const seeds: Record<string, string> = { ...GATE_SEEDS, "tsconfig.json": `${repo.read("tsconfig.json")}\n` };
  for (const [file, text] of Object.entries(seeds)) repo.write(file, text);
  return { root: repo.root, changed: Object.keys(seeds).sort() };
}

function normalize(value: unknown, root: string): unknown {
  const real = fs.realpathSync(root);
  const text = normaliseProbes(
    JSON.stringify(value ?? null)
      .replaceAll(real, "<root>")
      .replaceAll(root, "<root>")
      .replace(/jscpd-[A-Za-z0-9]+/g, "jscpd-<tmp>"),
  );
  return JSON.parse(text);
}

describe("decision corpus", () => {
  it("matches the recorded decisions", async () => {
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const steps = () => {
      const called = run.mock.calls.map(([, step]) => ({ name: step.name, command: step.command, timeoutMs: step.timeoutMs }));
      run.mockClear();
      return called;
    };
    const guardRepo = templateRepo();
    const gates = seededRepo();
    const result = {
      paths: Object.fromEntries(PATHS.map((file) => [file, checkPath(file)])),
      writes: normalize(writes(guardRepo.root), guardRepo.root),
      commands: normalize(commands(guardRepo.root), guardRepo.root),
      events: await events(),
      eventSteps: steps(),
      gates: normalize(
        {
          auditChanged: auditChanged(gates.root, gates.changed),
          fastGate: await fastGate(gates.root, gates.changed),
          fastSteps: steps(),
          doneGate: await doneGate(gates.root, gates.changed),
          doneSteps: steps(),
        },
        gates.root,
      ),
    };
    const text = await format(JSON.stringify(result), { ...(await resolveConfig(SNAPSHOT)), filepath: SNAPSHOT });
    await expect(text).toMatchFileSnapshot(SNAPSHOT);
  }, 300_000);

  it("denies a harness path written in another case on every filesystem", () => {
    expect(PATHS).toContain(CASE_VARIANT);
    const { root } = templateRepo();
    const event = parseEvent(
      "claude",
      { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: CASE_VARIANT, content: "" } },
      root,
    );
    const folds = fs.existsSync(path.join(root, "tooling/Harness"));
    // Where case folds it is the locked harness folder itself; elsewhere it is a new folder with a name the shape refuses.
    expect(checkGuards(event, root)?.guard).toBe(folds ? "harness-lock" : "structure-write");
  });
});
