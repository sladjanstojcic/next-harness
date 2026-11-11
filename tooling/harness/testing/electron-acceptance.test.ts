import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../core/audit/finding.ts";
import { ciGate } from "../core/gates/ci-gate.ts";
import { analysisSteps } from "../core/gates/ci-steps.ts";
import { runInWorkspace } from "../core/gates/fast-gate.ts";
import { runTool } from "../core/gates/run-tool.ts";
import { parseEvent } from "../core/hooks/event.ts";
import { handleEvent } from "../core/hooks/handle.ts";
import { initHarness } from "../core/init/init.ts";
import { initLegacy } from "../core/legacy.ts";
import { resolveHarness } from "../core/path-check.ts";
import { stateDir } from "../core/state/state-file.ts";
import { eslintPreset } from "../tools/eslint-preset.ts";
import { toolWorkspaces } from "../tools/index.ts";
import { adoptedElectron, commitAll, ELECTRON_LEGACY, ELECTRON_LEGACY_CONFIG, electronProject, DESK_APP } from "./electron-repo.ts";
import { run } from "./preset-fixture.ts";
import type { RepoFixture } from "./temp-repo.ts";

const R = "src/renderer/src";
const TASKS = `${R}/modules/tasks`;
const TOTAL = "export const total = (net: number, tax: number): number => net + tax;\n";
const TOTAL_TEST =
  'import { expect, it } from "vitest";\nimport { total } from "./total";\n\nit("adds the tax", () => {\n  expect(total(100, 17)).toBe(117);\n});\n';
const LONG = 600_000;

/** The hooks as an agent session meets them, with the real tools behind them. */
function session(repo: RepoFixture) {
  const send = (hook: string, extra: Record<string, unknown> = {}) =>
    handleEvent(parseEvent("claude", { session_id: "electron", cwd: repo.root, hook_event_name: hook, ...extra }, repo.root), repo.root);
  const tool = (hook: "PreToolUse" | "PostToolUse", input: Record<string, unknown>) => send(hook, { tool_name: "Write", tool_input: input });
  return {
    prompt: () => send("UserPromptSubmit", { prompt: "go" }),
    stop: () => send("Stop", { stop_hook_active: false }),
    async write(file: string, text: string) {
      const input = { file_path: path.join(repo.root, file), content: text };
      const pre = await tool("PreToolUse", input);
      if (pre.kind !== "allow") return pre;
      repo.write(file, text);
      return tool("PostToolUse", input);
    },
  };
}

/** depcruise, knip and jscpd as CI with a legacy list and `legacy init` run them, with the real tools. */
async function analyse(repoRoot: string): Promise<Finding[]> {
  const root = fs.realpathSync(repoRoot);
  const harness = resolveHarness(root);
  const [group] = toolWorkspaces(root, harness.workspaces);
  if (group === undefined) throw new Error("the workspace runs no tools");
  const output = fs.mkdtempSync(path.join(stateDir(root), "jscpd-"));
  const findings: Finding[] = [];
  for (const step of analysisSteps(root, harness, group, true, output)) if (!("skipped" in step)) findings.push(...(await runInWorkspace(root, "", step)));
  return findings;
}

describe("Desk App, an electron-vite project in the shape's layout, adopted with init", () => {
  it(
    "keeps the project's own configs, prints lines that go in as they are, and passes the CI gate after its printed steps",
    async () => {
      const repo = adoptedElectron(DESK_APP);
      expect(repo.report).toContain(
        [
          "updated package.json: scripts prepare, depcruise, knip, jscpd, audit, check, harness:blocks, harness:lock, harness:unlock",
          "kept eslint.config.mjs: your config stays; add the harness preset to it, the import at the top of the file, the spread as the last argument of the exported call:",
          '    import { harnessEslint } from "./tooling/harness/presets/eslint.ts";',
          '    ...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false }),',
          "kept .prettierrc.yaml: your config stays as it is",
          "kept vitest.config.ts: your config stays as it is",
          "created knip.config.ts: harness preset",
          "created .dependency-cruiser.json: harness preset",
          "updated tsconfig.node.json: exclude tooling/harness, harness.config.ts, eslint.config.mjs, knip.config.ts",
          "updated .gitignore: *.tsbuildinfo",
        ].join("\n"),
      );
      expect(repo.report).toContain("Run the full gate: pnpm run check");
      expect(repo.report).not.toContain("playwright install chromium");
      expect(repo.report).not.toContain("tsconfig.json:");
      expect(repo.read("knip.config.ts")).toContain("export default harnessKnipElectron()");
      expect(repo.read(".dependency-cruiser.json")).toContain("presets/dependency-cruiser-electron.json");
      expect(repo.read("tsconfig.json")).toBe(DESK_APP["tsconfig.json"]);
      expect(repo.read("vitest.config.ts")).toBe(DESK_APP["vitest.config.ts"]);
      const scripts = (JSON.parse(repo.read("package.json")) as { scripts: Record<string, string> }).scripts;
      expect(scripts).toMatchObject({
        check: "node tooling/harness/cli.ts check ci",
        typecheck: "npm run typecheck:node && npm run typecheck:web",
        depcruise: "depcruise src --config .dependency-cruiser.json",
        jscpd: "jscpd src --config ./tooling/harness/presets/jscpd.json --output node_modules/.cache/jscpd",
      });
      commitAll(repo);

      const result = await ciGate(fs.realpathSync(repo.root));
      expect(result.report.split("\n")).toEqual(
        ["prettier", "eslint", "eslint-preset", "tsc", "audit", "depcruise", "knip", "jscpd", "vitest", "build"].map((step) => `${step}: passed`),
      );
      expect(result.passed).toBe(true);
      // The stub of the build that is not installed here ran in the project folder.
      expect(fs.existsSync(path.join(repo.root, "out/main/index.js"))).toBe(true);
      expect(repo.git("status", "--porcelain")).toBe("");
    },
    LONG,
  );

  it(
    "reports the preset as missing until the printed lines are in the project's ESLint config",
    async () => {
      const repo = electronProject(DESK_APP);
      const root = fs.realpathSync(repo.root);
      const findings = await runTool(root, eslintPreset(root, { path: "", shape: "electron-vite", next: false }));
      expect(findings.length).toBeGreaterThan(0);
      expect(new Set(findings.map(({ rule }) => rule))).toEqual(new Set(["preset-missing"]));
      const message = findings.find((finding) => finding.message.startsWith("no-restricted-imports"))?.message ?? "";
      expect(message).toContain("put the first line at the top and the second as the last argument of the exported call");
      expect(message).toContain('  ...harnessEslint({ root: import.meta.dirname, layout: "electron", base: false }),');
    },
    LONG,
  );

  it(
    "has nothing for a legacy list, and --starter says the shape has no starter files",
    async () => {
      const repo = adoptedElectron(DESK_APP, ELECTRON_LEGACY_CONFIG);
      const root = fs.realpathSync(repo.root);
      expect(await initLegacy(root, resolveHarness(root))).toContain(`Wrote ${ELECTRON_LEGACY} with 0 files.`);
      expect(JSON.parse(repo.read(ELECTRON_LEGACY))).toEqual({ version: 1, files: [] });

      const plain = electronProject(DESK_APP);
      const { report } = initHarness(plain.root, { force: true, starter: true });
      expect(report).toContain("unchanged src: --starter writes nothing here: the electron-vite shape has no starter files");
      expect(report).not.toContain(": starter file");
      expect(fs.existsSync(path.join(plain.root, `${R}/shared/lib/env.ts`))).toBe(false);
    },
    LONG,
  );

  it(
    "finds each boundary with the real dependency-cruiser, and the ones ESLint can express with the real ESLint",
    async () => {
      const repo = adoptedElectron(DESK_APP);
      commitAll(repo);
      expect(await analyse(repo.root)).toEqual([]);
      const format = "export const format = (value: number): string => String(value);\n";
      // The project declares its aliases in the two referenced projects only, as the official scaffold does.
      expect(DESK_APP["tsconfig.json"]).not.toContain("paths");
      const files: Record<string, string> = {
        [`${TASKS}/components/bad-view.tsx`]:
          'import { readFileSync } from "node:fs";\nimport { ipcRenderer } from "electron";\nimport { store } from "../../../../../main/storage/client";\nimport { countLabel } from "@renderer/modules/notes/domain/count";\n\nexport const view = [readFileSync, ipcRenderer, store, countLabel];\n',
        "src/main/storage/client.ts":
          'import { createElement } from "react";\nimport { App } from "../../renderer/src/app";\nimport { format } from "@renderer/shared/lib/format";\n\nexport const store = [createElement, App, format];\n',
        "src/shared/bad.ts":
          'import { join } from "node:path";\nimport { app } from "electron";\nimport { App } from "../renderer/src/app";\nimport { format } from "@renderer/shared/lib/format";\n\nexport const bad = [join, app, App, format];\n',
        "src/preload/bad.ts":
          'import { join } from "node:path";\nimport { store } from "../main/storage/client";\nimport { format } from "@renderer/shared/lib/format";\n\nexport const bad = [join, store, format];\n',
        [`${R}/app.tsx`]: 'import { countLabel } from "@renderer/modules/notes/domain/count";\n\nexport const App = countLabel;\n',
        [`${R}/shared/lib/format.ts`]: format,
        [`${R}/shared/lib/bad.ts`]: 'import { total } from "@renderer/modules/tasks";\n\nexport const bad = total;\n',
        [`${TASKS}/index.ts`]: 'export { total } from "./domain/total";\n',
        [`${TASKS}/domain/total.ts`]: 'import { second } from "./second";\n\nexport const total = (): number => second() + 1;\n',
        [`${TASKS}/domain/second.ts`]:
          'import { useState } from "react";\nimport { total } from "./total";\n\nexport const second = (): number => (useState.length > 9 ? total() : 0);\n',
      };
      for (const [file, text] of Object.entries(files)) repo.write(file, text);

      const cruised = (await analyse(repo.root)).filter(({ rule }) => !rule.startsWith("knip-") && rule !== "jscpd").map(({ rule, file }) => `${rule} ${file}`);
      expect(cruised.filter((entry) => entry.startsWith(`no-circular ${TASKS}/domain/`)).length).toBeGreaterThan(0);
      const count = (entry: string): number => cruised.filter((found) => found === entry).length;
      expect(Object.fromEntries([...new Set(cruised)].filter((entry) => !entry.startsWith("no-circular")).map((entry) => [entry, count(entry)]))).toEqual({
        "contract-pure-core src/shared/bad.ts": 1,
        // Electron, the renderer by a relative path, and the renderer through its alias.
        "contract-pure-path src/shared/bad.ts": 3,
        [`domain-pure-path ${TASKS}/domain/second.ts`]: 1,
        // React, the renderer by a relative path and through its alias; from preload, through the alias.
        "main-no-renderer src/main/storage/client.ts": 3,
        "main-no-renderer src/preload/bad.ts": 1,
        // A module's internals through the alias, from another module and from app.tsx.
        [`module-public-api ${TASKS}/components/bad-view.tsx`]: 1,
        [`module-public-api ${R}/app.tsx`]: 1,
        "preload-bridge-only src/preload/bad.ts": 3,
        [`renderer-no-electron ${TASKS}/components/bad-view.tsx`]: 1,
        [`renderer-no-node ${TASKS}/components/bad-view.tsx`]: 1,
        [`renderer-own-code ${TASKS}/components/bad-view.tsx`]: 1,
        [`shared-not-modules ${R}/shared/lib/bad.ts`]: 1,
      });

      // ESLint reads the specifier as written: packages and the project's own aliases, never a relative path.
      const lint = run(repo.root, "eslint", ["--format", "json", "--", ...Object.keys(files)]);
      const results = JSON.parse(lint.output.slice(lint.output.indexOf("["))) as { filePath: string; messages: { ruleId: string; message: string }[] }[];
      const restricted = Object.fromEntries(
        results.map(({ filePath, messages }) => [
          path.relative(fs.realpathSync(repo.root), filePath),
          messages.filter(({ ruleId }) => ruleId === "no-restricted-imports").map(({ message }) => /^'([^']+)'/.exec(message)?.[1]),
        ]),
      );
      expect(restricted).toEqual({
        [`${TASKS}/components/bad-view.tsx`]: ["node:fs", "electron"],
        "src/main/storage/client.ts": ["react", "@renderer/shared/lib/format"],
        "src/shared/bad.ts": ["node:path", "electron", "@renderer/shared/lib/format"],
        "src/preload/bad.ts": ["node:path", "@renderer/shared/lib/format"],
        [`${R}/app.tsx`]: [],
        [`${R}/shared/lib/format.ts`]: [],
        [`${R}/shared/lib/bad.ts`]: ["@renderer/modules/tasks"],
        [`${TASKS}/index.ts`]: [],
        [`${TASKS}/domain/total.ts`]: [],
        [`${TASKS}/domain/second.ts`]: ["react"],
      });
      const messages = results.flatMap((result) => result.messages.filter(({ ruleId }) => ruleId === "no-restricted-imports"));
      expect(messages.every(({ message }) => message.includes("(Electron layout)"))).toBe(true);
    },
    LONG,
  );

  it(
    "blocks a domain file without its test at Stop with the real tools behind the hooks, and passes once the test exists",
    async () => {
      const repo = adoptedElectron(DESK_APP);
      commitAll(repo);
      const hooks = session(repo);
      await hooks.prompt();
      expect(await hooks.write(`${TASKS}/domain/total.ts`, TOTAL)).toEqual({ kind: "allow" });
      expect(await hooks.write(`${TASKS}/index.ts`, 'export { total } from "./domain/total";\n')).toEqual({ kind: "allow" });
      const app = repo
        .read(`${R}/app.tsx`)
        .replace("import { Badge }", "import { total } from '@renderer/modules/tasks'\nimport { Badge }")
        .replace("<NoteList />", "<p>{total(100, 17)}</p>\n      <NoteList />");
      expect(await hooks.write(`${R}/app.tsx`, app)).toEqual({ kind: "allow" });
      const stop = await hooks.stop();
      expect(stop.findings?.map(({ file, rule }) => `${file} ${rule}`)).toEqual([`${TASKS}/domain/total.ts domain-test`]);
      expect(stop.kind).toBe("block");
      expect(stop.findings?.[0]?.message).toContain(`${TASKS}/domain/total.test.ts (Electron layout)`);
      expect(await hooks.write(`${TASKS}/domain/total.test.ts`, TOTAL_TEST)).toEqual({ kind: "allow" });
      expect(await hooks.stop()).toEqual({ kind: "allow" });
      // The per-project build info `tsc --incremental` writes is ignored, so the turn leaves only its own files.
      expect(repo.git("status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([` M ${R}/app.tsx`, `?? ${R}/modules/tasks/`]);
    },
    LONG,
  );
});
