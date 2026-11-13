import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auditor from "../audit/audit.ts";
import { SOURCE_PROBES } from "../../shapes/next-probes.ts";
import { normaliseProbes } from "../../testing/preset-fixture.ts";
import { CONFIG_RUNNER } from "../../tools/eslint-preset.ts";
import { makerkitRepo } from "../../testing/makerkit-repo.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { ciGate } from "./ci-gate.ts";
import * as runner from "./run-tool.ts";

afterEach(() => vi.restoreAllMocks());

const SMOKE = { "e2e/smoke.test.ts": "" };

describe("CI gate", () => {
  it("runs all checks in order with full typed lint even after middle failures", async () => {
    const repo = makeRepo({ ...SMOKE, "src/utils/date.ts": "export const today = 1;", "tooling/scripts/seed.ts": "" });
    const calls: string[] = [];
    const audit = vi.spyOn(auditor, "audit");
    audit.mockImplementation((root) => {
      calls.push("audit");
      return [{ rule: "src-shape", file: path.relative(root, path.join(root, "src/utils/date.ts")), message: "Put utilities in src/shared/lib/." }];
    });
    const run = vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      calls.push(normaliseProbes([path.basename(step.command[0] ?? ""), ...step.command.slice(1)].join(" ")));
      return step.name === "knip" ? [{ rule: "knip-failed", file: "", message: "Unused exports" }] : [];
    });
    const result = await ciGate(repo.root);
    expect(calls).toEqual([
      "prettier --check .",
      "eslint . --max-warnings 0",
      ["node", CONFIG_RUNNER, path.join(repo.root, "node_modules/.bin/eslint"), ...SOURCE_PROBES.map((probe) => probe.replaceAll("{name}", "<probe>"))].join(
        " ",
      ),
      "next typegen",
      "tsc --noEmit",
      "audit",
      "depcruise src --config .dependency-cruiser.json",
      "knip",
      "jscpd src tooling --config ./tooling/harness/presets/jscpd.json",
      "vitest run",
      "next build",
      "playwright test",
    ]);
    expect(run.mock.calls.every(([, step]) => !step.command.some((arg) => arg.includes("HARNESS_FAST_LINT")))).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.preExisting).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["src-shape", "knip-failed"]);
    expect(result.report).toContain("src/shared/lib/");
    expect(result.report).toContain("Unused exports");
    expect(result.report).toContain("playwright: passed");
  });

  it("reports every successful step", async () => {
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(makeRepo(SMOKE, { agents: true }).root);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.report.match(/: passed/g)).toHaveLength(12);
  });

  it("reports an audit exception and still reaches the browser step", async () => {
    vi.spyOn(auditor, "audit").mockImplementation(() => {
      throw new Error("Cannot read source");
    });
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(makeRepo(SMOKE).root);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("Cannot read source");
    expect(result.report).toContain("playwright: passed");
  });

  it("skips the browser step when the root Next workspace has no e2e/**/*.test.ts", async () => {
    const run = vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const result = await ciGate(makeRepo({ "e2e/helpers.ts": "" }, { agents: true }).root);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("build: passed\nplaywright: skipped");
    expect(run.mock.calls.some(([, step]) => step.name === "playwright")).toBe(false);
  });

  it("takes the footer from the findings' shape and drops it when they span shapes", async () => {
    const NEXT_FOOTER = "Fix application code in src/modules/ or src/shared/";
    const app = "apps/web/lib/x.ts";
    const feature = "packages/features/journal/src/shared/x.ts";
    const audit = vi.spyOn(auditor, "audit");
    vi.spyOn(runner, "runTool").mockResolvedValue([]);
    const repo = makerkitRepo();
    audit.mockReturnValue([{ rule: "max-lines", file: app, message: "Too long." }]);
    const auditSection = (report: string): string => report.split("audit: failed\n")[1]?.split(/\n\S+(?: \(\S+\))?: (?:passed|failed|skipped)/)[0] ?? "";
    const one = auditSection((await ciGate(repo.root)).report);
    expect(one).not.toContain(NEXT_FOOTER);
    expect(one).toContain("Fix app code in app/, components/, config/ and lib/, and feature code in packages/features/ (Makerkit layout).");
    audit.mockReturnValue([
      { rule: "max-lines", file: app, message: "Too long." },
      { rule: "max-lines", file: feature, message: "Too long." },
    ]);
    expect(auditSection((await ciGate(repo.root)).report)).toBe(`${app}:1 max-lines — Too long.\n${feature}:1 max-lines — Too long.`);
    audit.mockReturnValue([{ rule: "src-shape", file: "src/utils/x.ts", message: "Move it." }]);
    expect(auditSection((await ciGate(makeRepo(SMOKE).root)).report)).toContain(NEXT_FOOTER);
  });

  it("builds a vite-spa workspace with vite in its folder, an electron-vite one with electron-vite, and runs no Next step", async () => {
    const bins = ["prettier", "eslint", "tsc", "depcruise", "knip", "jscpd", "vitest", "vite", "electron-vite"];
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: "apps/web", shape: "vite-spa" }, { path: "apps/desk", shape: "electron-vite" }] };\n',
      "apps/web/src/main.tsx": "",
      "apps/desk/src/main/index.ts": "",
      ...Object.fromEntries(bins.map((tool) => [`node_modules/.bin/${tool}`, ""])),
    });
    const steps: string[] = [];
    vi.spyOn(runner, "runTool").mockImplementation(async (_root, step) => {
      steps.push(
        `${step.name}: ${[path.basename(step.command[0] ?? ""), ...step.command.slice(1)].join(" ")} in ${path.relative(repo.root, step.cwd ?? repo.root)}`,
      );
      return [];
    });
    await ciGate(repo.root);
    expect(steps.filter((step) => step.startsWith("build"))).toEqual(["build: vite build in apps/web", "build: electron-vite build in apps/desk"]);
    expect(steps.filter((step) => /^(typegen|next|playwright)\b/.test(step))).toEqual([]);
  });
});
