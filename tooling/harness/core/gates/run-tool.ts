import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { Finding } from "../audit/finding.ts";

export interface ToolStep {
  name: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  findings(stdout: string, exitCode: number): Finding[];
  /** One line for a failure the tool's own output explains at length, such as a missing config; undefined keeps that output. */
  explain?(output: string): string | undefined;
}

interface Execution {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function childEnvironment(root: string): NodeJS.ProcessEnv {
  const example = join(root, ".env.example");
  const declared = existsSync(example) ? Object.keys(parseEnv(readFileSync(example, "utf8"))) : [];
  const keys = new Set([
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TZ",
    "USER",
    "SMOKE_PORT",
    ...declared,
    ...Object.keys(process.env).filter((key) => key.startsWith("NEXT_PUBLIC_")),
  ]);
  // Start from the typed process environment and keep only the allowlist, so no cast is needed for spawn.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
  for (const key of Object.keys(env)) {
    if (key !== "CI" && !keys.has(key)) delete env[key];
  }
  return env;
}

// Port of 0.2.2 run/exec: argv only, an allowlisted environment and a process-group deadline.
function execute(root: string, step: ToolStep): Promise<Execution> {
  return new Promise((resolve) => {
    const [file, ...args] = step.command;
    if (!file) {
      resolve({ code: null, stdout: "", stderr: "empty command", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(file, args, { cwd: step.cwd ?? root, env: childEnvironment(root), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, step.timeoutMs ?? 120_000);
    const finish = (result: Execution): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish({ code: null, stdout, stderr: `${stderr}${error.message}\n`, timedOut }));
    child.on("close", (code) => finish({ code: timedOut ? null : code, stdout, stderr, timedOut }));
  });
}

export async function runTool(root: string, step: ToolStep): Promise<Finding[]> {
  const result = await execute(root, step);
  let output = result.stdout + result.stderr;
  if (result.timedOut) output = `Tool timed out after ${step.timeoutMs ?? 120_000} ms.\n${output}`;
  const failure = (): Finding[] => [
    { rule: `${step.name}-failed`, file: "", message: step.explain?.(output) ?? output.split(/\r?\n/).slice(0, 40).join("\n") },
  ];
  if (result.code === null) return failure();
  try {
    const findings = step.findings(result.stdout, result.code);
    return findings.length > 0 || result.code === 0 ? findings : failure();
  } catch (error) {
    // A tool that died before it printed its report says why on stderr: that line leads, not the parser's.
    const lines = result.code === 0 ? [] : result.stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
    const cause = lines.find((line) => /^\s*\w*Error\b/.test(line)) ?? lines[0];
    output = `${cause === undefined ? "" : `${cause.trim()}\n`}Cannot parse ${step.name} output: ${error instanceof Error ? error.message : String(error)}\n${output}`;
    return failure();
  }
}
