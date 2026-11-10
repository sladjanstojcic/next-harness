import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ciGate } from "../core/gates/ci-gate.ts";
import * as runner from "../core/gates/run-tool.ts";
import { initHarness } from "../core/init/init.ts";
import { withPresetLines } from "./preset-fixture.ts";
import { consumerRepo } from "./template-repo.ts";

afterEach(() => vi.restoreAllMocks());

const APP = "apps/dashboard";
const LEGACY = "tooling/harness-legacy.json";
const CONFIG = `export default {
  workspaces: [{ path: "${APP}", shape: "next-modules", next: true, test: "test" }],
  root: { entries: ["apps"] },
  legacy: "${LEGACY}",
};
`;
/** The project's own ESLint config, not in its own Prettier style, as the dashboard's was before the adoption. */
const OWN_ESLINT = "import nextTs from 'eslint-config-next/typescript';\nexport default [\n  ...nextTs,\n];\n";

describe("the adoption commit in a repository whose remote default branch predates it", () => {
  it("passes the format step: init formats what it writes in the project's style and prints the step for the kept file the user edits", async () => {
    const repo = consumerRepo(
      {
        "harness.config.ts": CONFIG,
        ".gitignore": "node_modules/\n",
        "package.json": '{ "name": "monorepo" }\n',
        [`${APP}/package.json`]: '{ "name": "dashboard", "type": "module", "scripts": { "test": "node --test" } }\n',
        [`${APP}/.prettierrc`]: '{ "semi": false }\n',
        [`${APP}/tsconfig.json`]: '{ "compilerOptions": { "strict": true }, "include": ["**/*.ts"] }\n',
        [`${APP}/eslint.config.mjs`]: OWN_ESLINT,
      },
      APP,
    );
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "next harness-origin-"));
    try {
      repo.git("init", "-q", "--bare", remote);
      repo.git("remote", "add", "origin", remote);
      repo.git("push", "-q", "origin", "main");
      const { report, ok } = initHarness(repo.root, { force: false, starter: false });
      expect(ok, report).toBe(true);
      expect(report).toMatch(/\nformatted .*apps\/dashboard\/knip\.config\.ts.* with prettier\n/);
      expect(repo.read(`${APP}/knip.config.ts`)).toBe('import { harnessKnip } from "../../tooling/harness/presets/knip.ts"\n\nexport default harnessKnip()\n');
      const step = `Format the kept files you edited, in the project's own style: (cd ${APP} && pnpm exec prettier --write eslint.config.mjs)`;
      expect(report).toContain(step);
      expect(report.indexOf(step)).toBeLessThan(report.indexOf("Commit the result"));

      repo.write(`${APP}/eslint.config.mjs`, withPresetLines(OWN_ESLINT, report));
      const prettier = path.join(repo.root, APP, "node_modules/.bin/prettier");
      const format = { name: "format", command: [prettier, "--write", "eslint.config.mjs"], cwd: path.join(repo.root, APP), findings: () => [] };
      expect(await runner.runTool(repo.root, format)).toEqual([]);
      const adopted = [`${APP}/eslint.config.mjs`, `${APP}/knip.config.ts`, `${APP}/tsconfig.json`, `${APP}/package.json`];
      repo.write(LEGACY, `${JSON.stringify({ version: 1, files: adopted })}\n`);
      repo.git("add", "-A");
      repo.git("commit", "-qm", "Add the harness");

      const run = runner.runTool;
      vi.spyOn(runner, "runTool").mockImplementation(async (root, tool) => (tool.name === "prettier" ? run(root, tool) : []));
      const result = await ciGate(repo.root);
      expect(result.report).toContain(`prettier (${APP}): passed`);
      expect(result.findings.filter(({ rule }) => rule.startsWith("prettier"))).toEqual([]);
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  }, 120_000);
});
