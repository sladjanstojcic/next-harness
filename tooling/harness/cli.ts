import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INSTALL_COMMAND =
  /^[ \t]*(?:cd[ \t]+[\w@./:=^~-]+[ \t]*&&[ \t]*)?(?:corepack[ \t]+)?(?:pnpm|npm)[ \t]+(?:install|i|ci)(?:[ \t]+--(?:frozen-lockfile|prefer-offline|offline|no-audit|no-fund|silent|ignore-scripts|loglevel=[a-z-]+|reporter=[a-z-]+))*[ \t]*$/;
const INSTALL_HINT = "Harness dependencies are missing: run `pnpm install --frozen-lockfile` and `pnpm run prepare` before other tool calls.";

function isMissingDependency(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
}

/** The harness's own file a failed import names, relative to the harness; undefined when a package is missing. */
function missingHarnessFile(error: Error): string | undefined {
  const target = /^Cannot find module '([^']+)'/.exec(error.message)?.[1];
  if (target === undefined || !path.isAbsolute(target)) return undefined;
  const relative = path.relative(import.meta.dirname, target);
  return relative.startsWith("..") || relative.split(path.sep).includes("node_modules") ? undefined : relative.split(path.sep).join("/");
}

function missingHint(error: unknown): string {
  const file = error instanceof Error ? missingHarnessFile(error) : undefined;
  if (file === undefined) return INSTALL_HINT;
  return `The harness cannot load: its file tooling/harness/${file} is missing, and an install does not bring it back. Restore or create that file (for example \`git checkout -- tooling/harness/${file}\`); every tool call is denied until then, so ask the user to do it in their own terminal.`;
}

function isInstallCommand(input: unknown): boolean {
  if (typeof input !== "object" || input === null || !("tool_name" in input) || input.tool_name !== "Bash" || !("tool_input" in input)) return false;
  const toolInput = input.tool_input;
  return (
    typeof toolInput === "object" &&
    toolInput !== null &&
    "command" in toolInput &&
    typeof toolInput.command === "string" &&
    INSTALL_COMMAND.test(toolInput.command)
  );
}

function gitRoot(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function resolveRoot(cwd: string): string {
  try {
    return gitRoot(cwd);
  } catch (error) {
    const segments = cwd.split(path.sep);
    const gitSegment = segments.lastIndexOf(".git");
    if (gitSegment <= 0) throw error;
    return gitRoot(segments.slice(0, gitSegment).join(path.sep) || path.sep);
  }
}

const [command, mode, ...paths] = process.argv.slice(2);
let preTool = false;
let input: unknown;
try {
  // Parse the event header before resolving the checkout so pre-tool errors fail closed.
  if (command === "hook") {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
    preTool = typeof input === "object" && input !== null && "hook_event_name" in input && input.hook_event_name === "PreToolUse";
  }
  const root = resolveRoot(process.cwd());
  if (command === "hook" || command === "check" || command === "audit") (await import("./config.ts")).loadConfig(root);
  if (command === "hook" && (mode === "claude" || mode === "codex")) {
    const { parseEvent } = await import("./core/hooks/event.ts");
    const { handleEvent } = await import("./core/hooks/handle.ts");
    const { renderResponse } = await import("./core/hooks/respond.ts");
    const { recordBlock } = await import("./core/telemetry.ts");
    const event = parseEvent(mode, input, root);
    const outcome = await handleEvent(event, root);
    recordBlock(root, event, outcome);
    const response = renderResponse(mode, event.event, outcome);
    process.stdout.write(response.stdout);
    process.stderr.write(response.stderr);
    process.exitCode = response.exitCode;
  } else if (command === "check" && (mode === "fast" || mode === "done" || mode === "ci")) {
    const result =
      mode === "ci"
        ? await (await import("./core/gates/ci-gate.ts")).ciGate(root)
        : mode === "fast"
          ? await (await import("./core/gates/fast-gate.ts")).fastGate(root, paths)
          : await (await import("./core/gates/done-gate.ts")).doneGate(root, paths);
    if (result.report) process.stdout.write(`${result.report}\n`);
    if (mode !== "ci" && paths.length === 0)
      process.stdout.write(`No files were given, so check ${mode} judged nothing; \`check ci\` judges the whole tree.\n`);
    process.exitCode = result.passed ? 0 : 1;
  } else if (command === "audit" && mode === undefined) {
    const { audit } = await import("./core/audit/audit.ts");
    const { formatFindings } = await import("./core/audit/finding.ts");
    const { PRE_EXISTING_HEADING, splitLegacy } = await import("./core/classes.ts");
    const { blocking, preExisting } = splitLegacy(root, audit(root));
    if (blocking.length > 0) process.stdout.write(`${formatFindings(blocking)}\n`);
    if (preExisting.length > 0) process.stdout.write(`${PRE_EXISTING_HEADING}\n${formatFindings(preExisting)}\n`);
    process.exitCode = blocking.length === 0 ? 0 : 1;
  } else if (command === "blocks" && (mode === undefined || mode === "--false")) {
    const { markFalseBlock, summarizeBlocks } = await import("./core/telemetry.ts");
    if (mode === undefined) process.stdout.write(`${summarizeBlocks(root)}\n`);
    else {
      const [id, ...note] = paths;
      if (id === undefined) throw new Error("Usage: blocks --false <id> [note…]");
      if (!markFalseBlock(root, id, note.join(" "))) throw new Error(`No block ${id}; run \`pnpm harness:blocks\` to list them.`);
      process.stdout.write(`Marked ${id} as a false block.\n`);
    }
  } else if (command === "legacy" && mode === "init" && paths.length === 0) {
    const { initLegacy } = await import("./core/legacy.ts");
    const { resolveHarness } = await import("./core/path-check.ts");
    process.stdout.write(`${await initLegacy(root, resolveHarness(root))}\n`);
  } else if (command === "upstream" && mode === "sync" && paths.length <= 1) {
    const { syncUpstream } = await import("./core/upstream.ts");
    const { loadConfig } = await import("./config.ts");
    process.stdout.write(`${syncUpstream(root, loadConfig(root), paths[0])}\n`);
  } else if (
    command === "init" &&
    [mode, ...paths].every((flag) => flag === undefined || flag === "--force" || flag === "--codex-user" || flag === "--starter")
  ) {
    const flags = [mode, ...paths].filter((flag) => flag !== undefined);
    // The rest of init needs the harness's own dependencies, which a fresh subtree does not have yet.
    const { bootstrapHarness } = await import("./core/init/bootstrap.ts");
    const bootstrap = bootstrapHarness(root, flags);
    if (!bootstrap.ready) process.stdout.write(`${bootstrap.report}\n`);
    else {
      const { initHarness } = await import("./core/init/init.ts");
      const result = initHarness(root, { force: flags.includes("--force"), starter: flags.includes("--starter") });
      process.stdout.write(`${result.report}\n`);
      if (result.ok && flags.includes("--codex-user")) {
        const { installCodexHooks } = await import("./core/init/codex-user.ts");
        const user = installCodexHooks(root, os.homedir());
        process.stdout.write(
          `Codex user hooks: ${String(user.added)} added in ${user.file}. They run only inside linked git worktrees; review them once in Codex with /hooks.\n`,
        );
      }
      process.exitCode = result.ok ? 0 : 1;
    }
  } else if ((command === "lock" || command === "unlock") && mode === undefined) {
    const { lock, unlock, UNLOCK_HOURS } = await import("./core/lock.ts");
    if (command === "unlock") {
      unlock(root);
      process.stdout.write(`Harness unlocked for ${String(UNLOCK_HOURS)} hours in ${root}. Run \`pnpm harness:lock\` when the change is done.\n`);
    } else {
      lock(root);
      process.stdout.write(`Harness locked in ${root}.\n`);
    }
  } else {
    throw new Error(
      "Usage: hook <claude|codex> | check <fast|done|ci> [paths…] | audit | blocks [--false <id> [note…]] | legacy init | upstream sync [<git ref>] | init [--force] [--codex-user] [--starter] | lock | unlock",
    );
  }
} catch (error) {
  if (command === "hook" && isMissingDependency(error)) {
    // A fresh clone has no node_modules yet: let the install through and tell the agent what to run first.
    const allowed = !preTool || isInstallCommand(input);
    if (!allowed || !preTool) process.stderr.write(`${missingHint(error)}\n`);
    process.exitCode = allowed ? 0 : 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = command === "hook" ? (preTool ? 2 : 0) : 1;
  }
}
