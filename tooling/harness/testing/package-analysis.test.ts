import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../core/audit/finding.ts";
import { analysisSteps } from "../core/gates/ci-steps.ts";
import { runInWorkspace } from "../core/gates/fast-gate.ts";
import { importedFromPackage } from "../core/package-usage.ts";
import { resolveHarness } from "../core/path-check.ts";
import { stateDir } from "../core/state/state-file.ts";
import { toolWorkspaces } from "../tools/index.ts";
import { adoptedTurbo } from "./turbo-adopted.ts";
import { turboRepo } from "./turbo-repo.ts";

const BILLING = "packages/billing";
const copied = (name: string): string =>
  `export function ${name}(cents: number, rate: number): number {\n  const gross = cents * rate;\n  const rounded = Math.round(gross);\n  const capped = Math.min(rounded, 1_000_000);\n  const floored = Math.max(capped, 0);\n  const fee = floored > 500 ? 25 : 10;\n  const total = floored + fee;\n  const half = Math.floor(total / 2);\n  const rest = total - half;\n  return half > rest ? half : rest;\n}\n`;

/** depcruise, knip and jscpd of one workspace, as CI with a legacy list and `legacy init` run them, with the real tools. */
async function analyse(repoRoot: string, workspacePath: string): Promise<Finding[]> {
  // The gates work on the real path; jscpd reports real paths, and the temp folder is a symlink on macOS.
  const root = fs.realpathSync(repoRoot);
  const harness = resolveHarness(root);
  const group = toolWorkspaces(root, harness.workspaces).find(({ workspace }) => workspace.path === workspacePath);
  if (group === undefined) throw new Error(`${workspacePath} runs no tools`);
  const output = fs.mkdtempSync(path.join(stateDir(root), "jscpd-"));
  const findings: Finding[] = [];
  for (const step of analysisSteps(root, harness, group, true, output)) {
    if (!("skipped" in step)) findings.push(...(await runInWorkspace(root, workspacePath, step)));
  }
  return findings;
}

describe("dependency-cruiser, knip and jscpd in a package (create-turbo in miniature)", () => {
  it("find nothing in the package as adopted, then a cycle, an impure domain file, an unused public export and copied code", async () => {
    const repo = adoptedTurbo();
    expect(repo.report).toContain("created packages/billing/knip.config.ts: harness preset");
    expect(repo.read(`${BILLING}/knip.config.ts`)).toContain("export default harnessKnipPackage();");
    expect(repo.read(`${BILLING}/.dependency-cruiser.json`)).toContain("presets/dependency-cruiser-package.json");
    expect((JSON.parse(repo.read(`${BILLING}/package.json`)) as { scripts: Record<string, string> }).scripts).toMatchObject({
      depcruise: "depcruise src --config .dependency-cruiser.json",
      knip: "knip",
      jscpd: "jscpd src --config ../../tooling/harness/presets/jscpd.json",
    });
    expect(fs.existsSync(path.join(repo.root, "packages/eslint-config/knip.config.ts"))).toBe(false);
    expect(await analyse(repo.root, BILLING)).toEqual([]);

    const write = (file: string, text: string): void => repo.write(`${BILLING}/src/${file}`, text);
    write("lib/first.ts", 'import { second } from "./second.ts";\n\nexport const first = (): number => second() + 1;\n');
    write("lib/second.ts", 'import { first } from "./first.ts";\n\nexport const second = (): number => (Math.random() > 2 ? first() : 0);\n');
    write("domain/stored.ts", 'import { readFileSync } from "node:fs";\n\nexport const stored = (file: string): string => readFileSync(file, "utf8");\n');
    write("components/price-tag.ts", 'import { rows } from "../server/rows.ts";\n\nexport const priceTag = (): number => rows().length;\n');
    write("server/rows.ts", 'import "server-only";\n\nexport const rows = (): number[] => [];\n');
    write("lib/copy-one.ts", copied("priceOne"));
    write("lib/copy-two.ts", copied("priceTwo"));
    const index = `export type Price = { cents: number };\nexport { first } from "./lib/first.ts";\nexport { stored } from "./domain/stored.ts";\nexport { priceTag } from "./components/price-tag.ts";\nexport { priceOne } from "./lib/copy-one.ts";\nexport { priceTwo } from "./lib/copy-two.ts";\n`;
    write("index.ts", index);
    repo.write("apps/web/modules/pricing/index.ts", 'export { first, priceOne, priceTwo, stored } from "@repo/billing";\n');

    const findings = await analyse(repo.root, BILLING);
    const found = findings.map(({ rule, file }) => `${rule} ${file.slice(BILLING.length + 1)}`);
    expect(found).toEqual(
      expect.arrayContaining(["domain-pure-core src/domain/stored.ts", "server-public-api src/components/price-tag.ts", "index-client-safe src/index.ts"]),
    );
    expect(found.filter((entry) => entry.startsWith("no-circular")).length).toBeGreaterThan(0);
    expect(found.filter((entry) => entry.startsWith("jscpd")).sort()).toEqual(["jscpd src/lib/copy-one.ts", "jscpd src/lib/copy-two.ts"]);
    // Price, first, stored and the two copies are imported by apps/web; priceTag is public and nobody imports it.
    const unused = findings
      .filter(({ rule }) => rule.startsWith("knip-"))
      .map(({ file, message }) => `${file.slice(BILLING.length + 1)} ${message.split(". ")[0] ?? ""}`);
    expect(unused.sort()).toEqual(["src/components/price-tag.ts unused export priceTag", "src/index.ts unused export priceTag"]);
  }, 600_000);

  it("reads what other workspaces import from a package's entries, by name, through its exports", () => {
    const repo = turboRepo({
      "apps/docs/modules/a/index.ts": 'import * as billing from "@repo/billing/server";\nexport const a = billing;\n',
      "apps/docs/modules/b/index.ts": 'export { Button as B } from "@repo/ui/button";\nconst card = import("@repo/ui/card");\nexport const b = card;\n',
      "packages/billing/src/lib/self.ts": 'import type { Price } from "@repo/billing";\nexport type Self = Price;\n',
    });
    const used = (workspace: string) => Object.fromEntries([...importedFromPackage(repo.root, workspace)].map(([file, names]) => [file, [...names].sort()]));
    expect(used(BILLING)).toEqual({ "src/index.ts": ["Price"], "src/server.ts": ["*", "getPrices"] });
    expect(used("packages/ui")).toEqual({ "src/button.tsx": ["Button"], "src/card.tsx": ["*"] });
    expect(used("packages/typescript-config")).toEqual({});
  });
});
