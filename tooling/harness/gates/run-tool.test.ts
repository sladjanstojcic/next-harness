import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import { runTool } from "./run-tool.ts";

afterEach(() => vi.unstubAllEnvs());

describe("tool runner", () => {
  it("turns a non-zero exit without parsed findings into a failure", async () => {
    const repo = makeRepo();
    const findings = await runTool(repo.root, { name: "probe", command: [process.execPath, "-e", "process.exit(3)"], findings: () => [] });
    expect(findings).toEqual([{ rule: "probe-failed", file: "", message: "" }]);
  });

  it("returns no findings for exit zero", async () => {
    const repo = makeRepo();
    expect(await runTool(repo.root, { name: "probe", command: [process.execPath, "-e", "process.exit(0)"], findings: () => [] })).toEqual([]);
  });

  it("passes stdout and the exit code to the parser without replacing parsed findings", async () => {
    const repo = makeRepo();
    const findings = await runTool(repo.root, {
      name: "probe",
      command: [process.execPath, "-e", "process.stdout.write('problem'); process.exit(3)"],
      findings: (stdout, code) => [{ rule: `parsed-${code}`, file: "a.ts", message: stdout }],
    });
    expect(findings).toEqual([{ rule: "parsed-3", file: "a.ts", message: "problem" }]);
  });

  it("caps fallback diagnostics at the first 40 lines including stderr", async () => {
    const repo = makeRepo();
    const findings = await runTool(repo.root, {
      name: "probe",
      command: [process.execPath, "-e", "process.stderr.write(Array.from({length: 45}, (_, i) => 'line ' + i).join('\\n')); process.exit(1)"],
      findings: () => [],
    });
    expect(findings[0]?.message.split("\n")).toHaveLength(40);
    expect(findings[0]?.message).toMatch(/^line 0\n/);
    expect(findings[0]?.message).toMatch(/\nline 39$/);
  });

  it("passes only the allowlisted environment with CI forced to 1", async () => {
    const repo = makeRepo();
    vi.stubEnv("HARNESS_TEST_SECRET", "fixture-only");
    vi.stubEnv("NODE_OPTIONS", "--trace-warnings");
    vi.stubEnv("CI", "0");
    vi.stubEnv("PATH", "/fixture/bin");
    vi.stubEnv("SMOKE_PORT", "43120");
    const findings = await runTool(repo.root, {
      name: "env",
      command: ["/usr/bin/env"],
      findings: (stdout) => [{ rule: "env", file: "", message: stdout }],
    });
    const environment = Object.fromEntries(
      (findings[0]?.message ?? "")
        .trim()
        .split("\n")
        .map((line) => {
          const equals = line.indexOf("=");
          return [line.slice(0, equals), line.slice(equals + 1)];
        }),
    );
    expect(environment).toMatchObject({ CI: "1", PATH: "/fixture/bin", SMOKE_PORT: "43120" });
    expect(environment).not.toHaveProperty("HARNESS_TEST_SECRET");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(Object.keys(environment).every((key) => ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "USER", "CI", "SMOKE_PORT"].includes(key))).toBe(true);
  });

  it("passes declared and public environment keys without loading example values", async () => {
    const repo = makeRepo({ ".env.example": 'APP_TOKEN=example\nexport APP_MODE="default"\nUNSET_VALUE=example\nCI=0\n' });
    vi.stubEnv("APP_TOKEN", "fixture-token");
    vi.stubEnv("APP_MODE", "fixture-mode");
    vi.stubEnv("UNDECLARED_TOKEN", "fixture-hidden");
    vi.stubEnv("NEXT_PUBLIC_FIXTURE", "public-fixture");
    vi.stubEnv("CI", "0");
    const findings = await runTool(repo.root, {
      name: "env",
      command: [
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify({ token: process.env.APP_TOKEN, mode: process.env.APP_MODE, hidden: process.env.UNDECLARED_TOKEN, public: process.env.NEXT_PUBLIC_FIXTURE, unset: process.env.UNSET_VALUE, ci: process.env.CI }))",
      ],
      findings: (stdout) => [{ rule: "env", file: "", message: stdout }],
    });
    expect(JSON.parse(findings[0]!.message)).toEqual({ token: "fixture-token", mode: "fixture-mode", public: "public-fixture", ci: "1" });
  });

  it("reports missing executables and parser errors instead of passing", async () => {
    const repo = makeRepo();
    const missing = await runTool(repo.root, { name: "missing", command: ["/nonexistent/harness-probe"], findings: () => [] });
    expect(missing[0]).toMatchObject({ rule: "missing-failed", file: "" });
    expect(missing[0]?.message).toContain("ENOENT");
    const malformed = await runTool(repo.root, {
      name: "parse",
      command: [process.execPath, "-e", "process.stdout.write('invalid-json')"],
      findings: (stdout) => {
        JSON.parse(stdout);
        return [];
      },
    });
    expect(malformed[0]).toMatchObject({ rule: "parse-failed", file: "" });
  });

  it("kills the whole process group on timeout, including a child holding stdout open", async () => {
    const repo = makeRepo();
    const findings = await runTool(repo.root, {
      name: "deadline",
      command: [process.execPath, "-e", "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});"],
      timeoutMs: 200,
      findings: () => [],
    });
    expect(findings[0]).toMatchObject({ rule: "deadline-failed", file: "" });
    expect(findings[0]?.message).toContain("timed out");
  }, 5_000);
});
