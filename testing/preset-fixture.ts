import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { runTool } from "../core/gates/run-tool.ts";
import { initHarness } from "../core/init/init.ts";
import { eslintPreset } from "../tools/eslint-preset.ts";
import type { Finding } from "../core/audit/finding.ts";
import { SOURCE_PROBES } from "../shapes/next-modules.ts";
import { consumerRepo } from "./template-repo.ts";

/** The files create-next-app 16.4.5 generates (`--typescript --eslint --app --src-dir --no-tailwind --use-pnpm`), but its lockfile and assets. */
export const CREATE_NEXT_APP: Readonly<Record<string, string>> = z
  .record(z.string(), z.string())
  .parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/create-next-app-16.4.5.json"), "utf8")));

/** pnpm's own lockfile style, which Prettier would rewrite (quotes, blank lines, flow mappings). */
const PNPM_LOCK =
  "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      next:\n        specifier: 16.4.5\n        version: 16.4.5\n\npackages:\n\n  '@next/env@16.4.5':\n    resolution: {integrity: sha512-x}\n";

/** create-next-app's own ESLint config, which init keeps. */
export const CNA_ESLINT = CREATE_NEXT_APP["eslint.config.mjs"] ?? "";

/** A create-next-app project without its ESLint config, so init writes the thin one. */
export const APP: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CREATE_NEXT_APP).filter(([file]) => file !== "eslint.config.mjs")),
  "pnpm-lock.yaml": PNPM_LOCK,
};

/** The same project as create-next-app writes it without --src-dir: app/ at the root and "@/*" on "./*". */
export const APP_WITHOUT_SRC: Record<string, string> = Object.fromEntries(
  Object.entries(APP).map(([file, text]) => [file.replace(/^src\//, ""), file === "tsconfig.json" ? text.replace('"./src/*"', '"./*"') : text]),
);

/** A kept config with the lines init printed for it: the import first, the spread as the last entry of the exported array. */
export function withPresetLines(config: string, report: string): string {
  const [importLine, spread] = report
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("harnessEslint"));
  if (importLine === undefined || spread === undefined) throw new Error(`init printed no ESLint lines:\n${report}`);
  const end = config.lastIndexOf("]");
  return `${importLine}\n${config.slice(0, end)}  ${spread}\n${config.slice(end)}`;
}

export function run(cwd: string, tool: string, args: string[]): { status: number | null; output: string } {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).stdout.trim();
  const result = spawnSync(path.join(root, "node_modules/.bin", tool), args, { cwd, encoding: "utf8", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

/** A consumer project after `init`, with the harness presets copied in and the template's node_modules. */
export function initialised(files: Record<string, string>, starter = false) {
  const repo = consumerRepo({ "package.json": JSON.stringify({ name: "consumer", type: "module" }), ...files });
  const result = initHarness(repo.root, { force: false, starter });
  expect(result.ok, result.report).toBe(true);
  return { ...repo, report: result.report };
}

export const ROOT_APP = { path: "", shape: "next-modules", next: true } as const;

/** Every presence-check finding of the workspace at the git root, its probes named by `token` when given. */
export async function presetFindings(root: string, token?: () => string): Promise<Finding[]> {
  return runTool(root, eslintPreset(root, ROOT_APP, token));
}

const PROBES = SOURCE_PROBES.map((template) => {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace("\\{name\\}", "(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)").replaceAll("\\{name\\}", "\\k<name>");
  return { pattern: new RegExp(`^${pattern}$`), normalised: template.replaceAll("{name}", "<probe>") };
});

/** Replaces each random probe path the config runner takes with its template, the name shown as `<probe>`. */
export function normaliseProbes(text: string): string {
  return text.replace(/(eslint-config-runner\.ts)((?:(?:", ?"| )[^\s",]+)+)/g, (_match: string, lead: string, probes: string) => {
    const named = probes.replace(/[^\s",]+/g, (probe) =>
      SOURCE_PROBES.includes(probe) ? probe : (PROBES.find(({ pattern }) => pattern.test(probe))?.normalised ?? probe),
    );
    return `${lead}${named}`;
  });
}
