import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { consumerRepo } from "./template-repo.ts";

const APP = "apps/dashboard";
const PRESETS = "../../tooling/harness/presets";

/** A monorepo as pnpm installs it: the tools sit in the workspace's node_modules, and the harness folder reaches none. */
function monorepo() {
  return consumerRepo(
    {
      "package.json": JSON.stringify({ name: "monorepo", type: "module" }),
      [`${APP}/package.json`]: JSON.stringify({ name: "dashboard", type: "module" }),
      [`${APP}/tsconfig.json`]: JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, module: "esnext", moduleResolution: "bundler" },
        include: ["src"],
      }),
      [`${APP}/eslint.config.ts`]: `import { harnessEslint } from "${PRESETS}/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname });\n`,
      [`${APP}/knip.config.ts`]: `import { harnessKnip } from "${PRESETS}/knip.ts";\n\nexport default harnessKnip();\n`,
      [`${APP}/vitest.config.ts`]: `import { harnessVitest } from "${PRESETS}/vitest.ts";\n\nexport default harnessVitest();\n`,
      [`${APP}/src/shared/lib/bad.ts`]: "export const unsafe: any = 1;\n",
    },
    APP,
  );
}

function tool(root: string, name: string, args: string[]) {
  const cwd = path.join(root, APP);
  const result = spawnSync(path.join(cwd, "node_modules/.bin", name), args, { cwd, encoding: "utf8", timeout: 90_000 });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("presets in a workspace whose tools the harness folder cannot reach", () => {
  it("load ESLint, its plugins, Knip and Vitest from the workspace that calls them", () => {
    const repo = monorepo();
    const lint = tool(repo.root, "eslint", ["src", "knip.config.ts", "--max-warnings", "0"]);
    expect(lint.output).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(lint.output).toContain("@typescript-eslint/no-explicit-any");
    expect(lint.output).not.toContain("knip.config.ts");
    expect(lint.status).toBe(1);
    const knip = tool(repo.root, "knip", []);
    expect(knip.output).not.toMatch(/ERR_MODULE_NOT_FOUND|Error loading/);
    const tests = tool(repo.root, "vitest", ["run"]);
    expect(tests.output).toContain("No test files found");
    expect(tests.status).toBe(0);
  }, 120_000);
});
