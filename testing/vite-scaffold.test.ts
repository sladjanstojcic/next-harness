import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initHarness } from "../core/init/init.ts";
import { consumerRepo } from "./template-repo.ts";

/**
 * What `pnpm create vite --template react-ts` 9.3.4 writes: package.json, the three tsconfigs, vite.config.ts, .gitignore
 * and .oxlintrc.json are the template's own text; the other files are listed empty.
 */
const SCAFFOLD = z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/create-vite-9.3.4.json"), "utf8")));

const config = (at: string): string => `export default {\n  workspaces: [{ path: "${at}", shape: "vite-spa" }],\n};\n`;

/** The scaffold with strict type checking, the `@/` alias and no oxlint config: the three hand steps are done. */
function finished(files: Readonly<Record<string, string>>): Record<string, string> {
  const strict = (text: string): string => text.replace('"compilerOptions": {', '"compilerOptions": {\n    "strict": true,');
  const done: Record<string, string> = {
    ...files,
    "tsconfig.app.json": strict(files["tsconfig.app.json"] ?? "").replace('"strict": true,', '"strict": true,\n    "paths": { "@/*": ["./src/*"] },'),
    "tsconfig.node.json": strict(files["tsconfig.node.json"] ?? ""),
  };
  delete done[".oxlintrc.json"];
  return done;
}

/** The scaffold in a folder of the repository, with a root package.json when that folder is not the root. */
function project(at: string, files: Readonly<Record<string, string>>) {
  const prefix = at === "." ? "" : `${at}/`;
  const placed = Object.fromEntries(Object.entries(files).map(([file, text]) => [`${prefix}${file}`, text]));
  const root = at === "." ? {} : { "package.json": '{\n  "name": "repo",\n  "private": true\n}\n' };
  return consumerRepo({ ...root, ...placed, "harness.config.ts": config(at) });
}

const strictLine = (file: string): string =>
  `Turn strict type checking on (init does not edit ${file}, which has comments): add "strict": true to its compilerOptions`;
const oxlintLine = (prefix: string, remove: string, script = true): string =>
  `Remove the template's oxlint, which the ESLint preset replaces: delete ${prefix}.oxlintrc.json${script ? `, set the "lint" script in ${prefix}package.json to eslint . --max-warnings 0,` : ""} and run ${remove}`;
const aliasLine = (prefix: string): string =>
  `Map @/ to src/ (init does not edit these files): add "paths": { "@/*": ["./src/*"] } to compilerOptions of ${prefix}tsconfig.app.json, and resolve: { tsconfigPaths: true } to ${prefix}vite.config.ts`;
const count = (report: string, line: string): number => report.split("\n").filter((each) => each.endsWith(line)).length;

describe("init in a create-vite react-ts project (vite-spa)", () => {
  for (const [at, remove] of [
    [".", "pnpm remove oxlint"],
    ["apps/web", "(cd apps/web && pnpm remove oxlint)"],
  ] as const) {
    const prefix = at === "." ? "" : `${at}/`;

    it(`writes the vite-spa configs and prints the hand steps, in ${at}`, () => {
      const repo = project(at, SCAFFOLD);
      const { report, ok } = initHarness(repo.root, { force: false, starter: false });
      expect(ok, report).toBe(true);
      expect(repo.read(`${prefix}eslint.config.ts`)).toContain('layout: "spa"');
      expect(repo.read(`${prefix}knip.config.ts`)).toContain("harnessKnipVite");
      expect(repo.read(`${prefix}.dependency-cruiser.json`)).toContain("dependency-cruiser-vite.json");
      const vitest = repo.read(`${prefix}vitest.config.ts`);
      expect(vitest).toContain('import viteConfig from "./vite.config.ts";');
      expect(vitest).toContain("mergeConfig(viteConfig, harnessVitest())");
      // The template's .gitignore ignores dist already; only the build info is new.
      expect(report).toContain(`updated ${prefix}.gitignore: *.tsbuildinfo\n`);
      expect(repo.read(`${prefix}.gitignore`).match(/^\/?dist\/?$/gm)).toEqual(["dist"]);
      const scripts = z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(repo.read(`${prefix}package.json`))).scripts;
      expect(scripts.typecheck).toBe("tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json");
      expect(count(report, strictLine(`${prefix}tsconfig.app.json`)), report).toBe(1);
      expect(count(report, strictLine(`${prefix}tsconfig.node.json`)), report).toBe(1);
      expect(count(report, oxlintLine(prefix, remove)), report).toBe(1);
      expect(count(report, aliasLine(prefix)), report).toBe(1);
    });

    it(`prints none of the hand steps once they are done, in ${at}`, () => {
      const repo = project(at, finished(SCAFFOLD));
      const { report, ok } = initHarness(repo.root, { force: false, starter: false });
      expect(ok, report).toBe(true);
      expect(report).not.toContain("Turn strict type checking on");
      expect(report).not.toContain("Remove the template's oxlint");
      expect(report).not.toContain("Map @/ to src/");
    });
  }

  it("adds both the build output and the build info to an empty .gitignore", () => {
    const repo = project(".", { ...SCAFFOLD, ".gitignore": "" });
    const { report, ok } = initHarness(repo.root, { force: false, starter: false });
    expect(ok, report).toBe(true);
    expect(report).toContain("created .gitignore: dist/, *.tsbuildinfo, tooling/harness/node_modules/\n");
  });

  it("leaves a lint script that is not the template's oxlint out of the oxlint step", () => {
    const own = (SCAFFOLD["package.json"] ?? "").replace('"lint": "oxlint"', '"lint": "oxlint --deny-warnings src"');
    const repo = project(".", { ...SCAFFOLD, "package.json": own });
    const { report, ok } = initHarness(repo.root, { force: false, starter: false });
    expect(ok, report).toBe(true);
    expect(count(report, oxlintLine("", "pnpm remove oxlint", false)), report).toBe(1);
    expect(report).not.toContain('set the "lint" script');
    // Init still does not rewrite a script the project has.
    expect(repo.read("package.json")).toContain('"lint": "oxlint --deny-warnings src"');
  });

  it("writes no starter files into a vite-spa workspace", () => {
    const repo = project(".", SCAFFOLD);
    const { report } = initHarness(repo.root, { force: false, starter: true });
    expect(report).toContain("unchanged src: --starter writes nothing here: the vite-spa shape has no starter files");
  });
});
