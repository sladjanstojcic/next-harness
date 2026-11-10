import { managerCommands } from "../core/init/bootstrap.ts";
import type { ToolStep } from "../core/gates/run-tool.ts";

const TAIL_LINES = 40;

/**
 * A workspace's own test script, run whole through the project's package manager in the workspace folder; the shell only
 * joins the two output streams. A failing run is one finding with the end of the output, where test runners print the failures.
 */
export function testScript(root: string, dir: string, script: string): ToolStep {
  return {
    name: "test",
    command: ["/bin/sh", "-c", 'exec "$@" 2>&1', "sh", ...managerCommands(root).run.split(" "), script],
    cwd: dir,
    timeoutMs: 600_000,
    findings: (stdout, exitCode) => {
      if (exitCode === 0) return [];
      const lines = stdout.trimEnd().split(/\r?\n/);
      const message = `The "${script}" script exited with ${String(exitCode)}. Its last lines:\n${lines.slice(-TAIL_LINES).join("\n")}`;
      return [{ rule: "test-failed", file: "", message }];
    },
  };
}
