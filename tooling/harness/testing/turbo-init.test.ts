import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { runTool } from "../core/gates/run-tool.ts";
import { initHarness } from "../core/init/init.ts";
import { initLegacy } from "../core/legacy.ts";
import { resolveHarness } from "../core/path-check.ts";
import { bringsOwnBase, bringsOwnNext, eslintPreset, eslintPresetLines } from "../tools/eslint-preset.ts";
import { placeStep } from "../tools/tool-set.ts";
import { run } from "./preset-fixture.ts";
import { adoptedTurbo, TURBO_APP_LINE, TURBO_PRESET, TURBO_UI_LINE, turboProject } from "./turbo-adopted.ts";
import { TURBO_LEGACY, TURBO_LEGACY_FILES } from "./turbo-repo.ts";

const APP = { path: "apps/web", shape: "next-modules", next: true, sourceRoot: "" } as const;
const UI = { path: "packages/ui", shape: "package", next: false } as const;

describe("init --starter in a create-turbo project, then its printed steps", () => {
  it("prints lines a config that exports a name can take, with base: false read through the workspace package", () => {
    const repo = turboProject();
    const dir = path.join(repo.root, APP.path);
    // The config package brings Next's plugin and no typescript-eslint: the base is the preset's, without `next`.
    expect([bringsOwnBase(dir), bringsOwnNext(dir)]).toEqual([false, true]);
    expect(eslintPresetLines(APP, repo.read("apps/web/eslint.config.js"), dir)).toEqual([TURBO_PRESET, TURBO_APP_LINE]);
    const { report } = initHarness(repo.root, { force: false, starter: true });
    expect(report).toContain(
      `kept apps/web/eslint.config.js: your config stays; add the harness preset to it, the import at the top of the file, the second line in place of \`export default nextJsConfig\`:\n    ${TURBO_PRESET}\n    ${TURBO_APP_LINE}`,
    );
    expect(report).toContain(`the second line in place of \`export default config\`:\n    ${TURBO_PRESET}\n    ${TURBO_UI_LINE}`);
    expect(report).not.toMatch(/pnpm add -D [^\n]*(?:eslint-config-next|@eslint\/js)/);
    expect(report).toContain('Declare NODE_ENV in "globalEnv" of turbo.json, because the starter shared/lib/env.ts reads it');
    // Every step that gives a command ends with it: nothing a copied line would hand to the shell as prose.
    const steps = report.split("\n").filter((line) => /^ {2}\d+\. /.test(line) && /: (?:\(?cd |pnpm |node |git )/.test(line));
    expect(steps.length).toBeGreaterThan(3);
    for (const step of steps) expect(step.slice(step.indexOf(": ") + 2), step).not.toMatch(/[a-z"] \((?!cd )/);
    expect(report).toContain('updated apps/web/tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths "@/*": ["./*"]');
    expect(report).not.toContain("updated packages/ui/tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths");
  });

  it("leaves a project whose tools pass on every file init wrote: legacy init lists only what create-turbo wrote", async () => {
    const repo = adoptedTurbo();

    for (const workspace of [APP, UI]) {
      const dir = path.join(repo.root, workspace.path);
      const step = placeStep(repo.root, workspace.path, eslintPreset(dir, workspace));
      expect("finding" in step ? step.finding : await runTool(repo.root, step), workspace.path).toEqual([]);
    }
    const tests = run(path.join(repo.root, APP.path), "vitest", ["run"]);
    expect(tests.status, tests.output).toBe(0);
    expect(stripVTControlCharacters(tests.output)).toMatch(/Test Files +5 passed/);

    const written = (finding: { file: string }): boolean => !TURBO_LEGACY_FILES.includes(finding.file);
    expect(audit(repo.root).filter(written)).toEqual([]);
    const outcome = await initLegacy(repo.root, resolveHarness(repo.root));
    expect(outcome).not.toContain("did not run to the end");
    const listed = (JSON.parse(fs.readFileSync(path.join(repo.root, TURBO_LEGACY), "utf8")) as { files: string[] }).files;
    expect(listed).toEqual([...TURBO_LEGACY_FILES].sort());
  }, 600_000);
});
