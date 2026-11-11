import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HARNESS_PACKAGE, managerCommands } from "./bootstrap.ts";
import { codexHooksSetting, withHooksFeature } from "./codex-user.ts";
import { compareHooks, hooksBlock, mergeHooks, type HooksBlock } from "./hooks-merge.ts";
import { indentOf, isObject, readJson, scriptsStep, writer, type JsonObject, type Step } from "./files.ts";
import { resolveHarness, type Harness } from "../path-check.ts";
import { ALL_TOOL_CONFIG_NAMES } from "../../shapes/tool-config-names.ts";
import { bin } from "../../tools/tool-set.ts";
import { gitignoreStep, HARNESS_MODULES, rootIgnoreSteps } from "./ignore-files.ts";
import { peerInstall, starterInstall } from "./peers.ts";
import { runsOwnTests, toolConfigSteps, toolScripts, usesPrettierPreset } from "./tool-configs.ts";
import { CONFIG_FILE, isConfigOnly, type WorkspaceEntry } from "../../config.ts";
import { ciSteps, CLAUDE_HOOKS, CODEX_CONFIG, CODEX_HOOKS, HOOKS_PATH, PACKAGE_SCRIPTS, PRE_PUSH, PREPARE } from "./wiring.ts";

function hooksStep(root: string, label: string, wanted: HooksBlock, force: boolean): Step {
  const file = path.join(root, label);
  const current = readJson(file, label);
  const write = (value: JsonObject) => writer(file, `${JSON.stringify(value, null, current === undefined ? 2 : indentOf(file))}\n`);
  if (current === undefined) return { target: label, status: "created", detail: "hooks", apply: write({ hooks: wanted }) };
  if (current.hooks === undefined)
    return { target: label, status: "updated", detail: "hooks added, other keys kept", apply: write({ ...current, hooks: wanted }) };
  const parsed = hooksBlock.safeParse(current.hooks);
  if (!parsed.success) throw new Error(`${label} holds a hooks block init cannot read: ${parsed.error.message}`);
  const { differing, hasHarness, kept } = compareHooks(parsed.data, wanted);
  const others = `${String(kept)} other hook ${kept === 1 ? "entry" : "entries"}`;
  if (differing.length === 0) return { target: label, status: "unchanged", detail: kept === 0 ? "hooks" : `hooks, ${others}` };
  const apply = write({ ...current, hooks: mergeHooks(parsed.data, wanted) });
  const events = differing.join(", ");
  if (!hasHarness) return { target: label, status: "updated", detail: `harness hooks added, ${others} kept`, apply };
  if (!force)
    return {
      target: label,
      status: "conflict",
      detail: `harness hooks differ in ${events}; --force replaces them there and keeps ${others}`,
    };
  return { target: label, status: "updated", detail: `harness hooks replaced in ${events}, ${others} kept`, apply };
}

function codexConfigStep(root: string, force: boolean): Step {
  const label = ".codex/config.toml";
  const file = path.join(root, label);
  if (!fs.existsSync(file)) return { target: label, status: "created", detail: "[features] hooks = true", apply: writer(file, CODEX_CONFIG) };
  const text = fs.readFileSync(file, "utf8");
  const setting = codexHooksSetting(text);
  if (setting === "on") return { target: label, status: "unchanged", detail: "[features] hooks = true" };
  if (setting === "off" && !force) return { target: label, status: "conflict", detail: "[features] sets hooks to another value; --force sets it to true" };
  return { target: label, status: "updated", detail: "[features] hooks = true, other settings kept", apply: writer(file, withHooksFeature(text)) };
}

function prePushStep(root: string, force: boolean): Step {
  const label = `${HOOKS_PATH}/pre-push`;
  const file = path.join(root, label);
  const apply = writer(file, PRE_PUSH, 0o755);
  if (!fs.existsSync(file)) return { target: label, status: "created", detail: "runs the CI gate", apply };
  if (fs.readFileSync(file, "utf8") !== PRE_PUSH) {
    if (!force) return { target: label, status: "conflict", detail: "holds a different hook; --force replaces it" };
    return { target: label, status: "updated", detail: "replaced", apply };
  }
  if ((fs.statSync(file).mode & 0o111) === 0) return { target: label, status: "updated", detail: "made executable", apply };
  return { target: label, status: "unchanged", detail: "runs the CI gate" };
}

function hooksPathStep(root: string, force: boolean): Step {
  const label = "git config core.hooksPath";
  const read = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (read.status !== 0 && read.status !== 1) throw new Error(`git config core.hooksPath cannot be read: ${read.stderr.trim()}`);
  const current = read.stdout.trim();
  const apply = () => {
    const result = spawnSync("git", ["config", "--local", "core.hooksPath", HOOKS_PATH], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git config core.hooksPath failed: ${result.stderr.trim()}`);
  };
  if (current === HOOKS_PATH) return { target: label, status: "unchanged", detail: HOOKS_PATH };
  if (current === "") return { target: label, status: "created", detail: HOOKS_PATH, apply };
  if (!force) return { target: label, status: "conflict", detail: `is ${current}; --force sets it to ${HOOKS_PATH}` };
  return { target: label, status: "updated", detail: `${current} replaced by ${HOOKS_PATH}`, apply };
}

/**
 * The project's Prettier formats what init wrote: JSON.stringify spreads short arrays over lines, and the thin configs
 * are in the harness's style, not the project's. A file with no Prettier in reach is left for the next steps' format run.
 */
function formatWritten(root: string, files: string[]): string[] {
  const byBinary = new Map<string, string[]>();
  for (const file of files) {
    const prettier = bin(path.join(root, path.dirname(file)), "prettier", root);
    if (prettier !== undefined) byBinary.set(prettier, [...(byBinary.get(prettier) ?? []), file]);
  }
  const formatted = [...byBinary.values()].flat();
  if (formatted.length === 0) return [];
  for (const [prettier, own] of byBinary) {
    // From the folder that installs Prettier: a config names its plugins bare, and Prettier resolves them from where it runs.
    const cwd = path.resolve(prettier, "../../..");
    const result = spawnSync(prettier, ["--write", ...own.map((file) => path.relative(cwd, path.join(root, file)))], { cwd, encoding: "utf8" });
    if (result.status !== 0) return [`prettier --write failed: ${(result.stderr || result.stdout).trim()}; run prettier --write ${formatted.join(" ")}`];
  }
  return [`formatted ${formatted.join(", ")} with prettier`];
}

/** A JSON file init wrote, or a TypeScript tool config it created. */
const isFormatted = (target: string): boolean =>
  target.endsWith(".json") || (target.endsWith(".ts") && ALL_TOOL_CONFIG_NAMES.includes(path.posix.basename(target)));

/** Whether the root "prepare" script, which installs run on a fresh clone, points git at the harness's hooks. */
function preparesHooks(root: string): boolean {
  const scripts = readJson(path.join(root, "package.json"), "package.json")?.scripts;
  const prepare = isObject(scripts) ? scripts.prepare : undefined;
  return typeof prepare === "string" && prepare.includes(PREPARE);
}

/** The config line that makes the gates run a workspace's own test script; the config file is the user's to edit. */
function ownTestsItem(harness: Harness, workspace: WorkspaceEntry): string {
  const where = workspace.path === "" ? "." : workspace.path;
  const create = harness.configured
    ? ""
    : ` (no ${CONFIG_FILE} yet: export default defineHarness({ workspaces: [{ path: ".", shape: "next-modules", next: true, test: "test" }] }))`;
  return `Run this workspace's own tests in the gates instead of Vitest: add test: "test" to the "${where}" workspace in ${CONFIG_FILE}${create}`;
}

/** One numbered list of what the user runs after init, in the order that works: tools before the files that need them. */
function nextSteps(root: string, harness: Harness, workspaces: readonly WorkspaceEntry[], steps: readonly Step[], starter: boolean): string[] {
  const todo = steps.filter((step) => step.todo === true).map((step) => step.target);
  const { exec, run } = managerCommands(root);
  const inFolder = (workspace: WorkspaceEntry, command: string): string => (workspace.path === "" ? command : `(cd ${workspace.path} && ${command})`);
  const format = workspaces.filter((workspace) => usesPrettierPreset(root, workspace)).map((workspace) => inFolder(workspace, `${exec} prettier --write .`));
  // A workspace with its own style is not reformatted; only the kept files the user has just edited are.
  const edited = workspaces
    .filter((workspace) => !usesPrettierPreset(root, workspace))
    .flatMap((workspace) => {
      const prefix = workspace.path === "" ? "" : `${workspace.path}/`;
      const own = todo.filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/")).map((file) => file.slice(prefix.length));
      return own.length === 0 ? [] : [inFolder(workspace, `${exec} prettier --write ${own.join(" ")}`)];
    });
  const { legacy } = harness.config;
  const ownTests = workspaces.filter((workspace) => workspace.test === undefined && runsOwnTests(root, workspace) !== undefined);
  const items = [
    ...workspaces
      .flatMap((workspace) => peerInstall(root, harness.config, workspace) ?? [])
      .map((command) => `Install the harness's tools (init does not install): ${command}`),
    ...(starter ? workspaces.filter((workspace) => workspace.shape === "next-modules") : [])
      .flatMap((workspace) => starterInstall(root, workspace) ?? [])
      .map((command) => `Install the runtime packages the starter files import: ${command}`),
    ...(todo.length === 0 ? [] : [`Make the change each kept file above asks for: ${todo.join(", ")}`]),
    ...ownTests.map((workspace) => ownTestsItem(harness, workspace)),
    ...(preparesHooks(root) ? [] : [`Add to the root package.json "prepare" script, so a fresh clone gets the pre-push hook: ${PREPARE}`]),
    ...(format.length === 0 ? [] : [`Format the app's own files once in the preset's style: ${format.join("; ")}`]),
    ...(edited.length === 0 ? [] : [`Format the kept files you edited, in the project's own style: ${edited.join("; ")}`]),
    ...(workspaces.some((workspace) => workspace.path === "" && workspace.next)
      ? [`Install the smoke test's browser: ${exec} playwright install chromium`]
      : []),
    ...(legacy === undefined || fs.existsSync(path.join(root, legacy))
      ? []
      : [`List the files with findings today, which the gates then tolerate until someone touches them: node ${HARNESS_PACKAGE}/cli.ts legacy init`]),
    'Commit the result: git add -A && git commit -m "Add the harness"',
    `Run the full gate: ${run} check`,
  ];
  return ["Next steps, in this order:", ...items.map((item, index) => `  ${String(index + 1)}. ${item}`)];
}

export interface InitOptions {
  force: boolean;
  /** Copies the next-modules helper files the content rules point at into each next-modules workspace. */
  starter: boolean;
}

/**
 * Writes the harness wiring every consumer shares and each eslint-prettier workspace's tool configs, but a config-only package's; nothing is written
 * while a step conflicts and force is off. The git config step applies first, so a git failure precedes any file write.
 */
export function initHarness(root: string, { force, starter }: InitOptions): { report: string; ok: boolean } {
  const harness = resolveHarness(root);
  const all = harness.workspaces;
  const workspaces = all.filter((workspace) => workspace.tools === "eslint-prettier" && !isConfigOnly(root, workspace));
  const atRoot = workspaces.find((workspace) => workspace.path === "");
  const steps = [
    hooksPathStep(root, force),
    hooksStep(root, ".claude/settings.json", CLAUDE_HOOKS, force),
    hooksStep(root, ".codex/hooks.json", CODEX_HOOKS, force),
    codexConfigStep(root, force),
    prePushStep(root, force),
    scriptsStep(root, "package.json", PACKAGE_SCRIPTS, { prepare: PREPARE, ...(atRoot === undefined ? {} : toolScripts(atRoot)) }, force),
    ...(atRoot === undefined ? [gitignoreStep(root, "", [HARNESS_MODULES])] : []),
    ...workspaces.flatMap((workspace) => [
      ...(workspace.path === "" ? [] : [scriptsStep(root, `${workspace.path}/package.json`, {}, toolScripts(workspace), force)]),
      ...toolConfigSteps(root, workspace, force, starter),
    ]),
    ...rootIgnoreSteps(root, all),
  ];
  const lines = steps.map((step) => `${step.status} ${step.target}: ${step.detail}`);
  if (steps.some((step) => step.status === "conflict")) {
    return { report: [...lines, "Nothing was written. Rerun with --force to replace the conflicting wiring."].join("\n"), ok: false };
  }
  for (const step of steps) step.apply?.();
  const formatted = formatWritten(
    root,
    steps.filter((step) => step.apply !== undefined && isFormatted(step.target)).map((step) => step.target),
  );
  return {
    report: [...lines, ...formatted, ciSteps(harness.config.legacy !== undefined), ...nextSteps(root, harness, workspaces, steps, starter)].join("\n"),
    ok: true,
  };
}
