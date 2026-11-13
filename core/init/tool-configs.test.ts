import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../../testing/temp-repo.ts";
import { STARTER_HELPERS } from "../../shapes/next-probes.ts";
import { initHarness } from "./init.ts";

const template = path.resolve(import.meta.dirname, "../../../..");
const STARTER = path.resolve(import.meta.dirname, "../../presets/starter/next-modules");
const SMOKE = path.resolve(import.meta.dirname, "../../presets/starter/e2e/smoke.test.ts.txt");
const OFF = { force: false, starter: false };
const DASHBOARD_CONFIG = `export default {
  workspaces: [{ path: "apps/dashboard", shape: "next-modules", next: true }, { path: "supabase", shape: "supabase" }],
  root: { entries: ["apps", "supabase"] },
};
`;

function consumer(files: Record<string, string>) {
  const repo = makeRepo({ "package.json": '{\n  "name": "consumer"\n}\n', ...files });
  repo.git("config", "--unset", "core.hooksPath");
  return repo;
}

/** The thin configs init writes at a root Next workspace; its tsconfig.json leaves them out. */
const THIN = ["eslint.config.ts", "prettier.config.ts", "vitest.config.ts", "knip.config.ts", "playwright.config.ts"];

const exists = (root: string, file: string): boolean => fs.existsSync(path.join(root, file));

/** The numbered lines after init's "Next steps" heading. */
const nextSteps = (report: string): string[] => report.split("\n").slice(report.split("\n").indexOf("Next steps, in this order:") + 1);

describe("init tool configs", () => {
  it("writes this repository's own thin prettier and dependency-cruiser files at a root Next workspace, and an ESLint config that skips the harness", () => {
    const repo = consumer({});
    const result = initHarness(repo.root, OFF);
    expect(result.ok, result.report).toBe(true);
    for (const file of ["prettier.config.ts", "playwright.config.ts", ".dependency-cruiser.json"]) {
      expect(repo.read(file), file).toBe(fs.readFileSync(path.join(template, file), "utf8"));
    }
    expect(repo.read("eslint.config.ts")).toBe(fs.readFileSync(path.join(template, "eslint.config.ts"), "utf8").replace(', harness: "lint"', ""));
    expect(repo.read("vitest.config.ts")).toContain("harnessVitest()");
    expect(repo.read("knip.config.ts")).toContain("harnessKnip()");
    expect(repo.read(".gitignore")).toBe(".next/\ntest-results/\ntooling/harness/node_modules/\n");
    expect(repo.read(".prettierignore")).toBe(
      "pnpm-lock.yaml\nsrc/shared/ui\nsrc/backend/*.types.ts\nsrc/backend/*-types.ts\n.next\ntooling/harness\nharness.config.ts\n",
    );
    expect(exists(repo.root, "src/shared/lib/env.ts")).toBe(false);
    expect(exists(repo.root, "e2e/smoke.test.ts")).toBe(false);
    expect(result.report).not.toContain("Prettier is not installed");
    expect(nextSteps(result.report)).toEqual([
      expect.stringMatching(/^ {2}1\. Install the harness's tools \(init does not install\): pnpm add -D @eslint\/js@9\.39\.5 .*vitest@5\.1\.0$/),
      "  2. Make the change each kept file above asks for: tsconfig.json",
      '  3. Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in src/app/globals.css, add turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } } to the config in next.config.ts, and run pnpm add -D tailwindcss @tailwindcss/turbopack',
      "  4. Set up shadcn, whose components the lint rule then asks for (init does not run it): pnpm dlx shadcn@latest init -t next -b base -p nova",
      "  5. Delete the two files shadcn init wrote where the layout takes no code: rm src/components/ui/button.tsx src/lib/utils.ts",
      '  6. Point shadcn at src/shared/, by setting "aliases" in components.json to: { "components": "@/shared/components", "utils": "@/shared/lib/utils", "ui": "@/shared/ui", "lib": "@/shared/lib", "hooks": "@/shared/hooks" }',
      "  7. Add the first component and the cn helper there: pnpm dlx shadcn@latest add button utils",
      "  8. Format the app's own files once in the preset's style: pnpm exec prettier --write .",
      "  9. Install the smoke test's browser: pnpm exec playwright install chromium",
      '  10. Commit the result: git add -A && git commit -m "Add the harness"',
      "  11. Run the full gate: pnpm run check",
    ]);
  });

  it("finds the template's own configs already on the preset", () => {
    const files = [
      "eslint.config.ts",
      "prettier.config.ts",
      "vitest.config.ts",
      "knip.config.ts",
      "playwright.config.ts",
      ".dependency-cruiser.json",
      ".gitignore",
      ".prettierignore",
    ];
    const repo = consumer(Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(template, file), "utf8")])));
    const lines = initHarness(repo.root, OFF).report.split("\n");
    for (const file of files) expect(lines.find((line) => line.includes(` ${file}:`))).toMatch(/^unchanged /);
  });

  it("keeps a project's own configs even with --force and prints the lines that add the preset", () => {
    const own = {
      "eslint.config.mjs": "export default [];\n",
      ".prettierrc.json": "{}\n",
      "vitest.config.mts": "export default {};\n",
      "knip.json": "{}\n",
      "playwright.config.mjs": "export default {};\n",
    };
    const repo = consumer(own);
    const result = initHarness(repo.root, { force: true, starter: false });
    expect(result.ok, result.report).toBe(true);
    for (const [file, text] of Object.entries(own)) expect(repo.read(file)).toBe(text);
    for (const file of ["eslint.config.ts", "prettier.config.ts", "vitest.config.ts", "knip.config.ts", "playwright.config.ts"])
      expect(exists(repo.root, file), file).toBe(false);
    expect(result.report).toContain(
      [
        "kept eslint.config.mjs: your config stays; add the harness preset to it, the import at the top of the file, the spread as the last element of the exported array:",
        '    import { harnessEslint } from "./tooling/harness/presets/eslint.ts";',
        "    ...harnessEslint({ root: import.meta.dirname, next: true }),",
      ].join("\n"),
    );
    expect(result.report).toContain("kept .prettierrc.json: your config stays");
    expect(result.report).toContain("    export default mergeConfig(harnessVitest(), yourConfig);");
    expect(result.report).toContain("    export default defineConfig(harnessPlaywright(), yourConfig);");
    expect(result.report).toContain(
      'kept knip.json: your config stays; add the harness preset to it:\n    import { harnessKnip } from "./tooling/harness/presets/knip.ts";',
    );
  });

  it("adds .ts imports and the harness exclude to tsconfig.json, refusing a false setting without --force", () => {
    const added = consumer({ "tsconfig.json": '{\n  "compilerOptions": { "strict": true }\n}\n' });
    expect(initHarness(added.root, OFF).report).toContain(
      `updated tsconfig.json: compilerOptions.allowImportingTsExtensions: true, compilerOptions.paths "@/*": ["./src/*"], exclude tooling/harness, ${THIN.join(", ")}`,
    );
    expect(JSON.parse(added.read("tsconfig.json"))).toEqual({
      compilerOptions: { strict: true, allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } },
      exclude: ["node_modules", "tooling/harness", ...THIN],
    });
    const refused = consumer({ "tsconfig.json": JSON.stringify({ compilerOptions: { allowImportingTsExtensions: false } }) });
    expect(initHarness(refused.root, OFF).report).toContain(
      "conflict tsconfig.json: compilerOptions.allowImportingTsExtensions is false; --force sets it to true",
    );
    expect(initHarness(refused.root, { force: true, starter: false }).ok).toBe(true);
    expect(JSON.parse(refused.read("tsconfig.json"))).toEqual({
      compilerOptions: { allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] } },
      exclude: ["node_modules", "tooling/harness", ...THIN],
    });
  });

  it("keeps a tsconfig.json with comments and prints the settings to add by hand", () => {
    const text = '{\n  // create-next-app does not write comments; monorepo tsconfigs often do\n  "compilerOptions": {}\n}\n';
    const repo = consumer({ "tsconfig.json": text });
    const result = initHarness(repo.root, OFF);
    expect(result.ok, result.report).toBe(true);
    expect(result.report).toContain(
      `kept tsconfig.json: has comments or is not plain JSON; set by hand:\n    "compilerOptions": { "allowImportingTsExtensions": true }\n    "exclude": [..., "tooling/harness", ${THIN.map((name) => `"${name}"`).join(", ")}]`,
    );
    expect(repo.read("tsconfig.json")).toBe(text);
  });

  it("refuses other dependency-cruiser rules without --force", () => {
    const repo = consumer({ ".dependency-cruiser.json": '{ "forbidden": [] }\n' });
    const refused = initHarness(repo.root, OFF);
    expect(refused.ok).toBe(false);
    expect(refused.report).toContain("conflict .dependency-cruiser.json: holds other rules; --force replaces it with the harness preset");
    expect(exists(repo.root, "eslint.config.ts")).toBe(false);
    expect(initHarness(repo.root, { force: true, starter: false }).ok).toBe(true);
    expect(repo.read(".dependency-cruiser.json")).toBe(fs.readFileSync(path.join(template, ".dependency-cruiser.json"), "utf8"));
  });

  it("writes a nested workspace's configs, missing scripts and ignores in its folder, and none for supabase", () => {
    const repo = consumer({
      "harness.config.ts": DASHBOARD_CONFIG,
      ".gitignore": "/.next/\n",
      "apps/dashboard/package.json": JSON.stringify({ scripts: { lint: "next lint" } }),
      "supabase/config.toml": "\n",
    });
    const result = initHarness(repo.root, OFF);
    expect(result.ok, result.report).toBe(true);
    expect(repo.read("apps/dashboard/eslint.config.ts")).toBe(
      'import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";\n\nexport default harnessEslint({ root: import.meta.dirname, next: true });\n',
    );
    expect(repo.read("apps/dashboard/.dependency-cruiser.json")).toContain('"extends": "../../tooling/harness/presets/dependency-cruiser.json"');
    const scripts = (JSON.parse(repo.read("apps/dashboard/package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.lint).toBe("next lint");
    expect(scripts.jscpd).toBe("jscpd src --config ../../tooling/harness/presets/jscpd.json");
    expect(scripts.typecheck).toBe("next typegen && tsc --noEmit");
    expect(Object.keys((JSON.parse(repo.read("package.json")) as { scripts: object }).scripts)).toEqual([
      "prepare",
      "audit",
      "check",
      "harness:blocks",
      "harness:lock",
      "harness:unlock",
    ]);
    expect(repo.read("apps/dashboard/.gitignore")).toBe(".next/\ntest-results/\n");
    expect(repo.read(".gitignore")).toBe("/.next/\ntooling/harness/node_modules/\n");
    expect(repo.read("apps/dashboard/.prettierignore")).toBe("pnpm-lock.yaml\nsrc/shared/ui\nsrc/backend/*.types.ts\nsrc/backend/*-types.ts\n.next\n");
    expect(repo.read(".prettierignore")).toBe("tooling/harness\nharness.config.ts\n");
    expect(exists(repo.root, ".eslintignore")).toBe(false);
    expect(nextSteps(result.report).slice(1)).toEqual([
      "  2. Make the change each kept file above asks for: apps/dashboard/tsconfig.json",
      '  3. Add Tailwind, which shadcn styles its components with (init does not edit these files): put @import "tailwindcss"; first in apps/dashboard/src/app/globals.css, add turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } } to the config in apps/dashboard/next.config.ts, and run (cd apps/dashboard && pnpm add -D tailwindcss @tailwindcss/turbopack)',
      "  4. Set up shadcn, whose components the lint rule then asks for (init does not run it): (cd apps/dashboard && pnpm dlx shadcn@latest init -t next -b base -p nova)",
      "  5. Delete the two files shadcn init wrote where the layout takes no code: rm apps/dashboard/src/components/ui/button.tsx apps/dashboard/src/lib/utils.ts",
      '  6. Point shadcn at apps/dashboard/src/shared/, by setting "aliases" in apps/dashboard/components.json to: { "components": "@/shared/components", "utils": "@/shared/lib/utils", "ui": "@/shared/ui", "lib": "@/shared/lib", "hooks": "@/shared/hooks" }',
      "  7. Add the first component and the cn helper there: (cd apps/dashboard && pnpm dlx shadcn@latest add button utils)",
      "  8. Format the app's own files once in the preset's style: (cd apps/dashboard && pnpm exec prettier --write .)",
      '  9. Commit the result: git add -A && git commit -m "Add the harness"',
      "  10. Run the full gate: pnpm run check",
    ]);
    expect(nextSteps(result.report)[0]).toContain("cd apps/dashboard && pnpm add -D ");
    expect(exists(repo.root, "supabase/eslint.config.ts")).toBe(false);
    expect(exists(repo.root, "apps/dashboard/playwright.config.ts")).toBe(false);
    expect(exists(repo.root, "eslint.config.ts")).toBe(false);
  });

  it("copies the starter helpers with --starter, keeps a changed one, and the template holds the same files", () => {
    const repo = consumer({ "src/shared/lib/log.ts": "export const mine = 1;\n" });
    const result = initHarness(repo.root, { force: false, starter: true });
    expect(result.ok, result.report).toBe(true);
    expect(result.report).toContain("kept src/shared/lib/log.ts: your file stays");
    expect(repo.read("src/shared/lib/log.ts")).toBe("export const mine = 1;\n");
    const { dependencies } = JSON.parse(fs.readFileSync(path.join(template, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const runtime = `Install the runtime packages the starter files import: pnpm add zod@${dependencies.zod ?? ""} server-only@${dependencies["server-only"] ?? ""}`;
    expect(nextSteps(result.report)[1]).toBe(`  2. ${runtime}`);
    const declared = consumer({ "package.json": JSON.stringify({ name: "consumer", dependencies: { zod: "4.6.7" } }) });
    expect(nextSteps(initHarness(declared.root, { force: false, starter: true }).report)[1]).toBe(
      `  2. Install the runtime packages the starter files import: pnpm add server-only@${dependencies["server-only"] ?? ""}`,
    );
    const names = fs.readdirSync(STARTER).map((name) => name.replace(/\.txt$/, ""));
    expect(names.filter((name) => !name.endsWith(".test.ts")).sort()).toEqual([...STARTER_HELPERS].sort());
    expect(names.sort()).toEqual(
      fs
        .readdirSync(path.join(template, "src/shared/lib"))
        .filter((name) => name !== "utils.ts")
        .sort(),
    );
    for (const name of names) {
      const starter = fs.readFileSync(path.join(STARTER, `${name}.txt`), "utf8");
      expect(fs.readFileSync(path.join(template, "src/shared/lib", name), "utf8"), name).toBe(starter);
      if (name !== "log.ts") expect(repo.read(`src/shared/lib/${name}`), name).toBe(starter);
    }
    expect(fs.readFileSync(SMOKE, "utf8")).toBe(fs.readFileSync(path.join(template, "e2e/smoke.test.ts"), "utf8"));
    expect(repo.read("e2e/smoke.test.ts")).toBe(fs.readFileSync(SMOKE, "utf8"));
  });
});
