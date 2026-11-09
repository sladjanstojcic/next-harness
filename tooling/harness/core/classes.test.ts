import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { auditChanged } from "./audit/audit.ts";
import { classify, legacyInvalidFindings, readLegacy } from "./classes.ts";
import { doneGate } from "./gates/done-gate.ts";
import * as runner from "./gates/run-tool.ts";
import { parseEvent, type HookEvent } from "./hooks/event.ts";
import { checkGuards } from "./hooks/guards.ts";
import { handleEvent } from "./hooks/handle.ts";
import { initLegacy, legacyAppendFindings } from "./legacy.ts";
import { resolveHarness } from "./path-check.ts";

afterEach(() => vi.restoreAllMocks());

const LEGACY = "tooling/harness-legacy.json";
const CONFIG = `export default { workspaces: [{ path: ".", shape: "next-modules" }], owned: ["src/modules/mine/"], legacy: "${LEGACY}" };\n`;
const list = (files: string[]): string => `${JSON.stringify({ version: 1, files })}\n`;

function configuredRepo(files: Record<string, string> = {}) {
  return makeRepo({ "harness.config.ts": CONFIG, ...files });
}

const writeEvent = (root: string, file: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "" } }, root);

const bashEvent = (root: string, hook: "PreToolUse" | "PostToolUse", command: string): HookEvent =>
  parseEvent("claude", { session_id: "s", cwd: root, hook_event_name: hook, tool_name: "Bash", tool_input: { command } }, root);

describe("path classes", () => {
  it("classifies owned, upstream, vendored and legacy files", () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/utils/x.ts"]) });
    const harness = resolveHarness(repo.root);
    const legacy = readLegacy(repo.root, harness.config);
    expect(classify("src/modules/mine/x.ts", harness, legacy)).toBe("owned");
    expect(classify("src/modules/kit/x.ts", harness, legacy)).toBe("upstream");
    expect(classify("src/shared/ui/b.tsx", harness, legacy)).toBe("vendored");
    expect(classify("src/utils/x.ts", harness, legacy)).toBe("legacy");
  });

  it("treats every file as owned and nothing as legacy without a config", () => {
    const repo = makeRepo();
    const harness = resolveHarness(repo.root);
    expect(readLegacy(repo.root, harness.config)).toEqual(new Set());
    expect(classify("src/modules/kit/x.ts", harness, new Set())).toBe("owned");
  });

  it("grants nothing for an invalid legacy list and reports it", () => {
    const repo = configuredRepo({ [LEGACY]: "{" });
    const config = loadConfig(repo.root);
    expect(readLegacy(repo.root, config)).toEqual(new Set());
    expect(legacyInvalidFindings(repo.root, config).map(({ rule, file }) => `${file} ${rule}`)).toEqual([`${LEGACY} legacy-invalid`]);
  });

  it("runs no harness rules on upstream files", () => {
    const repo = configuredRepo({ "src/modules/kit/helpers/x.ts": "export {};\n", "src/modules/mine/helpers/x.ts": "export {};\n" });
    expect(auditChanged(repo.root, ["src/modules/kit/helpers/x.ts"])).toEqual([]);
    expect(auditChanged(repo.root, ["src/modules/mine/helpers/x.ts"])).toContainEqual(
      expect.objectContaining({ rule: "module-shape", file: "src/modules/mine/helpers/x.ts" }),
    );
  });
});

describe("guards with path classes", () => {
  it("denies structure only on owned paths and keeps the lock for config, legacy and harness files", () => {
    const repo = configuredRepo();
    expect(checkGuards(writeEvent(repo.root, "src/modules/kit/helpers/x.ts"), repo.root)).toBeNull();
    expect(checkGuards(writeEvent(repo.root, "src/modules/mine/helpers/x.ts"), repo.root)?.guard).toBe("structure-write");
    expect(checkGuards(writeEvent(repo.root, "tooling/harness/x.ts"), repo.root)?.guard).toBe("harness-lock");
    expect(checkGuards(writeEvent(repo.root, "harness.config.ts"), repo.root)?.guard).toBe("harness-lock");
    expect(checkGuards(writeEvent(repo.root, LEGACY), repo.root)?.guard).toBe("harness-lock");
  });

  it("leaves structure to the legacy list for a listed path", () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/utils/x.ts"]) });
    expect(checkGuards(writeEvent(repo.root, "src/utils/x.ts"), repo.root)).toBeNull();
  });

  it("blocks a shell write that breaks the legacy list, in post-Bash, Done and PreToolUse", async () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/modules/mine/helpers/x.ts"]), "src/modules/mine/helpers/x.ts": "export {};\n" });
    const command = `echo '{' > ${LEGACY}`;
    expect(await handleEvent(bashEvent(repo.root, "PreToolUse", command), repo.root)).toEqual({ kind: "allow" });
    repo.write(LEGACY, "{\n");
    const outcome = await handleEvent(bashEvent(repo.root, "PostToolUse", command), repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("harness-lock");
    expect(outcome.reason).toContain("legacy-invalid");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const done = await doneGate(repo.root, ["src/modules/mine/helpers/x.ts", LEGACY]);
    expect(done.passed).toBe(false);
    expect(done.findings.map(({ rule }) => rule)).toEqual(expect.arrayContaining(["harness-lock", "legacy-invalid", "module-shape"]));
    expect(() => checkGuards(writeEvent(repo.root, "src/utils/y.ts"), repo.root)).toThrow(`${LEGACY} is not a valid legacy list`);
  });

  it("blocks a shell edit to an unowned harness file with harness-lock", async () => {
    const repo = configuredRepo();
    const command = "echo > tooling/harness/x.ts";
    expect(await handleEvent(bashEvent(repo.root, "PreToolUse", command), repo.root)).toEqual({ kind: "allow" });
    repo.write("tooling/harness/x.ts", "export {};\n");
    const outcome = await handleEvent(bashEvent(repo.root, "PostToolUse", command), repo.root);
    expect(outcome.kind).toBe("block");
    expect(outcome.reason).toContain("harness-lock");
  });

  it("reports no harness rule for a shell edit to a legacy file", async () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/utils/x.ts"]), "src/utils/x.ts": "export {};\n" });
    const command = "echo >> src/utils/x.ts";
    await handleEvent(bashEvent(repo.root, "PreToolUse", command), repo.root);
    repo.write("src/utils/x.ts", "export const x = 1;\n");
    expect(await handleEvent(bashEvent(repo.root, "PostToolUse", command), repo.root)).toEqual({ kind: "allow" });
  });
});

describe("Done gate with path classes", () => {
  const tsc = (file: string) =>
    vi
      .spyOn(runner, "runTool")
      .mockImplementation(async (_root, step) =>
        step.name === "tsc" ? [{ rule: "TS2322", file, line: 1, message: "Type 'string' is not assignable to type 'number'." }] : [],
      );

  it("blocks a crashed tool in a configured repo", async () => {
    const repo = configuredRepo({ "src/modules/kit/a.ts": "export {};\n" });
    repo.write("src/modules/kit/a.ts", "export const a = 1;\n");
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) =>
      step.name === "tsc" ? [{ rule: "tsc-failed", file: "", message: "error TS5083: Cannot read file." }] : [],
    );
    const result = await doneGate(repo.root, ["src/modules/kit/a.ts"]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "tsc-failed" }));
  });

  it("blocks a tool finding on a changed upstream file", async () => {
    const repo = configuredRepo({ "src/modules/kit/a.ts": "export {};\n" });
    repo.write("src/modules/kit/a.ts", "export const a: number = 'x';\n");
    tsc("src/modules/kit/a.ts");
    const result = await doneGate(repo.root, ["src/modules/kit/a.ts"]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "TS2322", file: "src/modules/kit/a.ts" }));
  });

  it("drops a tool finding on an unchanged upstream file", async () => {
    const repo = configuredRepo({ "src/modules/kit/b.ts": "export {};\n", "src/modules/mine/index.ts": "export {};\n" });
    repo.write("src/modules/mine/index.ts", "export const mine = 1;\n");
    tsc("src/modules/kit/b.ts");
    const result = await doneGate(repo.root, ["src/modules/mine/index.ts"]);
    expect(result.passed).toBe(true);
    expect([...result.findings, ...result.preExisting]).toEqual([]);
  });

  it("reports harness rules on a changed legacy file as pre-existing", async () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/utils/x.ts"]), "src/utils/x.ts": "export {};\n" });
    repo.write("src/utils/x.ts", "export const x = 1;\n");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await doneGate(repo.root, ["src/utils/x.ts"]);
    expect(result.passed).toBe(true);
    expect(result.preExisting).toContainEqual(expect.objectContaining({ rule: "src-shape", file: "src/utils/x.ts" }));
  });
});

describe("legacy list", () => {
  it("blocks entries added after the list was committed", () => {
    const repo = configuredRepo({ [LEGACY]: list(["src/utils/x.ts"]) });
    repo.write(LEGACY, list(["src/utils/x.ts", "src/utils/y.ts"]));
    const findings = legacyAppendFindings(repo.root, loadConfig(repo.root));
    expect(findings.map(({ rule, file }) => `${file} ${rule}`)).toEqual([`${LEGACY} legacy-append`]);
    expect(findings[0]?.message).toContain("src/utils/y.ts");
    repo.write(LEGACY, list([]));
    expect(legacyAppendFindings(repo.root, loadConfig(repo.root))).toEqual([]);
  });

  it("is inert while the list is not in HEAD, and without a legacy setting", () => {
    const repo = configuredRepo();
    repo.write(LEGACY, list(["src/utils/x.ts"]));
    expect(legacyAppendFindings(repo.root, loadConfig(repo.root))).toEqual([]);
    expect(legacyAppendFindings(makeRepo().root, loadConfig(makeRepo().root))).toEqual([]);
  });

  it("writes the list once from the audit and refuses a second time", () => {
    const repo = configuredRepo({ "src/modules/mine/helpers/x.ts": "export {};\n", "src/modules/kit/helpers/y.ts": "export {};\n" });
    const config = loadConfig(repo.root);
    expect(initLegacy(repo.root, config)).toBe(`Wrote ${LEGACY} with 1 files. Commit it; until then legacy-append is inert.`);
    expect(JSON.parse(repo.read(LEGACY))).toEqual({ version: 1, files: ["src/modules/mine/helpers/x.ts"] });
    expect(() => initLegacy(repo.root, config)).toThrow("already exists");
    expect(() => initLegacy(repo.root, { workspaces: config.workspaces })).toThrow("legacy");
  });
});
