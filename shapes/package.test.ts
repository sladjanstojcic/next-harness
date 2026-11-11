import { describe, expect, it } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { classify, readLegacy, splitLegacy } from "../core/classes.ts";
import { codeIndex } from "../core/code-index.ts";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { doubleCast, harnessRuleBlocks, workarounds } from "../presets/eslint-rules.ts";
import { TURBO_LEGACY_FILES, turboRepo } from "../testing/turbo-repo.ts";
import { eslintPreset, eslintPresetLines, expectedRules } from "../tools/eslint-preset.ts";
import { PACKAGE_PROBES } from "./package.ts";

const PKG = "packages/billing";
const LAYOUT = "(package layout)";
const WORKSPACE = { path: PKG, shape: "package", next: false } as const;

const findingsOf = (root: string, files: string[]) =>
  audit(root)
    .filter(({ file }) => files.includes(file))
    .map(({ file, rule, message }) => ({ file, rule, message }));

describe("package paths", () => {
  it.each([
    "package.json",
    "tsconfig.json",
    "README.md",
    "AGENTS.md",
    "eslint.config.ts",
    "eslint.config.mjs",
    "vitest.config.ts",
    ".prettierignore",
    ".gitignore",
    "react-library.json",
    "CHANGELOG.md",
    "src/index.ts",
    "src/server.ts",
    "src/schemas.ts",
    "src/types.ts",
    "src/types.test.ts",
    "src/.gitkeep",
    "src/components/price-tag.tsx",
    "src/components/format-price.ts",
    "src/components/invoices/invoice-row.tsx",
    "src/server/get-prices.ts",
    "src/server/stripe/client.ts",
    "src/domain/price.ts",
    "src/domain/price.test.ts",
    "src/domain/tax/vat.ts",
    "src/hooks/use-price.ts",
    "src/hooks/use-price.tsx",
    "src/hooks/use-price.test.tsx",
    "src/lib/money.ts",
  ])("accepts %s", (file) => {
    expect(checkPath(`${PKG}/${file}`, resolveHarness(turboRepo().root))).toEqual({ ok: true });
  });

  it.each([
    ["src/utils/x.ts", "module-shape"],
    ["src/helpers/x.ts", "module-shape"],
    ["src/x.ts", "module-shape"],
    ["src/button.tsx", "module-shape"],
    ["src/actions/save-price-action.ts", "module-shape"],
    ["src/components/a/b/x.tsx", "nesting"],
    ["src/hooks/prices/use-price.ts", "nesting"],
    ["src/lib/money/format.ts", "nesting"],
    ["src/domain/utils/x.ts", "generic-folder"],
    ["src/server/helpers/x.ts", "generic-folder"],
    ["src/components/PriceTag.tsx", "file-name"],
    ["src/domain/Tax/vat.ts", "file-name"],
    ["src/hooks/price.ts", "file-name"],
    ["src/lib/x.js", "js-file"],
    ["src/components/x.jsx", "js-file"],
    ["src/domain/tax.tsx", "file-name"],
    ["src/domain/tax/vat.test.tsx", "file-name"],
    ["src/.secret.ts", "hidden-file"],
    ["helpers.js", "unknown-root"],
    ["index.mjs", "unknown-root"],
    ["legacy.cjs", "unknown-root"],
    ["lib/x.ts", "unknown-root"],
    ["scripts/build.js", "unknown-root"],
    ["index.ts", "unknown-root"],
    ["build.tsx", "unknown-root"],
    ["notes.txt", "unknown-root"],
  ])("denies %s with %s and the package layout", (file, rule) => {
    const verdict = checkPath(`${PKG}/${file}`, resolveHarness(turboRepo().root));
    expect(verdict).toMatchObject({ ok: false, rule });
    expect(verdict.ok ? "" : verdict.reason.endsWith(LAYOUT)).toBe(true);
  });

  it("denies JavaScript in a package without src/ too, and tolerates only what the legacy list names", () => {
    const repo = turboRepo();
    const harness = resolveHarness(repo.root);
    for (const file of ["rules.js", "index.mjs", "legacy.cjs"]) {
      const verdict = checkPath(`packages/eslint-config/${file}`, harness);
      expect(verdict, file).toMatchObject({ ok: false, rule: "unknown-root" });
      expect(verdict.ok ? "" : verdict.reason).toContain("no JavaScript");
    }
    expect(checkPath("packages/newlogic/index.js", resolveHarness(repo.root, ["packages/newlogic/index.js"]))).toMatchObject({ ok: false });
    for (const file of ["eslint.config.mjs", "base.json", "README.md"])
      expect(checkPath(`packages/eslint-config/${file}`, harness), file).toEqual({ ok: true });
    const legacy = readLegacy(repo.root, harness.config);
    expect(new Set(TURBO_LEGACY_FILES.map((file) => classify(file, harness, legacy)))).toEqual(new Set(["legacy"]));
    expect(classify("packages/eslint-config/rules.js", harness, legacy)).toBe("owned");
    const old = splitLegacy(repo.root, audit(repo.root)).preExisting.filter(({ file }) => file.startsWith("packages/eslint-config/"));
    expect(old.map(({ file, rule }) => `${file} ${rule}`)).toEqual(
      ["base.js", "next.js", "react-internal.js"].map((file) => `packages/eslint-config/${file} unknown-root`),
    );
  });

  it("sends Server Actions to the app's module", () => {
    const verdict = checkPath(`${PKG}/src/actions/save-price-action.ts`, resolveHarness(turboRepo().root));
    expect(verdict.ok ? "" : verdict.reason).toContain("apps/<app>/src/modules/<module>/actions/<name>-action.ts");
    expect(verdict.ok ? "" : verdict.reason).toContain("this package's server.ts");
  });

  it("judges a package that does not exist yet, and leaves the app its own shape", () => {
    const repo = turboRepo();
    const file = "packages/invoices/src/helpers/x.ts";
    expect(checkPath(file, resolveHarness(repo.root, [file]))).toMatchObject({ ok: false, rule: "module-shape" });
    expect(checkPath("apps/web/modules/billing/utils/x.ts", resolveHarness(repo.root))).toMatchObject({ ok: false, rule: "module-shape" });
    expect(checkPath("apps/web/base.js", resolveHarness(repo.root))).toMatchObject({ ok: false, rule: "unknown-root" });
  });
});

describe("package content", () => {
  it("reports each content rule with the package layout", () => {
    const repo = turboRepo({
      [`${PKG}/src/server/get-prices.ts`]: "export const getPrices = () => [];\n",
      [`${PKG}/src/server/save-price.ts`]: '"use server";\nimport "server-only";\nexport async function savePrice() {}\n',
      [`${PKG}/src/lib/widget.ts`]: '"use client";\nexport const widget = 1;\n',
      [`${PKG}/src/components/price-tag.tsx`]: '"use client";\nimport { getPrices } from "../server";\nexport const PriceTag = () => getPrices();\n',
      [`${PKG}/src/index.ts`]: 'export { getPrices } from "./server.js";\n',
      [`${PKG}/src/domain/price.ts`]: "export const price = process.env.PRICE;\n",
      [`${PKG}/src/lib/money.ts`]: 'import { cn } from "../../../ui/src/cn";\nexport const money = cn;\n',
      [`${PKG}/src/lib/beside.ts`]:
        'import { anything } from "../../helpers.js";\nimport pkg from "../../package.json";\nexport const beside = [anything, pkg];\n',
      [`${PKG}/src/components/price-list.tsx`]: '"use client";\nimport { getPrices } from "../server.js";\nexport const PriceList = () => getPrices();\n',
      [`${PKG}/src/schemas.ts`]: 'import { z } from "zod";\nimport type { Price } from "./types";\nexport const schema = z.custom<Price>();\n',
    });
    const files = [
      "server/get-prices.ts",
      "server/save-price.ts",
      "lib/widget.ts",
      "components/price-tag.tsx",
      "components/price-list.tsx",
      "index.ts",
      "domain/price.ts",
      "lib/money.ts",
      "lib/beside.ts",
      "schemas.ts",
    ];
    const findings = findingsOf(
      repo.root,
      files.map((file) => `${PKG}/src/${file}`),
    );
    expect(findings.map(({ file, rule }) => `${file.slice(PKG.length + 5)} ${rule}`).sort()).toEqual([
      "components/price-list.tsx client-imports-server",
      "components/price-tag.tsx client-imports-server",
      "domain/price.ts domain-test",
      "domain/price.ts env-access",
      "index.ts index-exports",
      "lib/beside.ts package-boundary",
      "lib/beside.ts package-boundary",
      "lib/money.ts package-boundary",
      "lib/widget.ts use-client-placement",
      "server/get-prices.ts server-only",
      "server/save-price.ts use-server-placement",
    ]);
    for (const { message, rule } of findings) expect(message.endsWith(LAYOUT), rule).toBe(true);
    expect(findings.find(({ rule }) => rule === "env-access")?.message).toContain("the app's src/shared/lib/env.ts");
    expect(findings.find(({ rule }) => rule === "use-server-placement")?.message).toContain("Server Actions live in the app's module");
  });

  it("accepts a package that follows the layout", () => {
    const repo = turboRepo({
      [`${PKG}/src/domain/price.ts`]: "export const double = (cents: number) => cents * 2;\n",
      [`${PKG}/src/domain/price.test.ts`]:
        'import { expect, it } from "vitest";\nimport { double } from "./price";\nit("doubles", () => expect(double(1)).toBe(2));\n',
      [`${PKG}/src/components/price-tag.tsx`]: '"use client";\nimport { double } from "../domain/price";\nexport const PriceTag = () => double(1);\n',
      [`${PKG}/vitest.config.ts`]: 'import { harnessVitest } from "../../tooling/harness/presets/vitest.ts";\n\nexport default harnessVitest();\n',
    });
    const files = ["src/domain/price.ts", "src/components/price-tag.tsx", "src/server.ts", "src/index.ts", "vitest.config.ts"];
    expect(
      findingsOf(
        repo.root,
        files.map((file) => `${PKG}/${file}`),
      ),
    ).toEqual([]);
  });

  it("lists each package's public entries in the code index", () => {
    const index = codeIndex(turboRepo().root);
    expect(index).toContain("# packages/billing\n\n- `src/index.ts`: `Price`\n- `src/server.ts`: `getPrices`");
    expect(index).toContain("# packages/eslint-config\n");
    expect(index).not.toContain("button.tsx");
  });
});

describe("the package ESLint preset", () => {
  it("probes each folder and extension, an area level, a test and the entry files", () => {
    expect(PACKAGE_PROBES.map((probe) => probe.replaceAll("{name}", "N"))).toEqual([
      "src/components/N.ts",
      "src/components/N.tsx",
      "src/server/N.ts",
      "src/domain/N.ts",
      "src/components/N/N.tsx",
      "src/server/N/N.ts",
      "src/domain/N/N.ts",
      "src/domain/N.test.ts",
      "src/hooks/use-N.ts",
      "src/hooks/use-N.tsx",
      "src/lib/N.ts",
      "src/index.ts",
      "src/server.ts",
      "src/schemas.ts",
      "src/types.ts",
    ]);
    const probes = eslintPreset("/repo/packages/billing", WORKSPACE, () => "n").command.slice(3);
    expect(probes).toEqual(PACKAGE_PROBES.map((probe) => probe.replaceAll("{name}", "n")));
    const harness = resolveHarness(turboRepo().root);
    for (const probe of probes) expect(checkPath(`${PKG}/${probe}`, harness), probe).toEqual({ ok: true });
  });

  it("holds the general rules everywhere, allows adapter casts in src/server/ and keeps src/domain/ pure", () => {
    const settings = (probe: string) => expectedRules(probe, "package");
    const selectors = (rule: unknown) => (Array.isArray(rule) ? rule.slice(1).map((entry: { selector: string }) => entry.selector) : []);
    expect(settings("src/lib/a.ts")["@typescript-eslint/no-explicit-any"]).toBe("error");
    expect(selectors(settings("src/lib/a.ts")["no-restricted-syntax"])).toEqual(selectors(["error", ...workarounds, doubleCast]));
    expect(settings("src/lib/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBe("error");
    expect(settings("src/server/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBeUndefined();
    expect(settings("src/server.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBe("error");
    expect(settings("src/domain/a.ts")["no-restricted-imports"]).toBeDefined();
    expect(settings("src/domain/a/a.ts")["no-restricted-imports"]).toBeDefined();
    expect(settings("src/domain/a.test.ts")["no-restricted-imports"]).toBeUndefined();
    expect(settings("src/components/a.tsx")["no-restricted-imports"]).toBeUndefined();
    expect(expectedRules("src/domain/a.ts")["no-restricted-imports"]).toBeUndefined();
    expect(JSON.stringify(harnessRuleBlocks("package"))).not.toContain("src/modules");
  });

  it("prints the package layout in the lines for a kept config", () => {
    expect(eslintPresetLines(WORKSPACE, "export default [];\n")).toEqual([
      'import { harnessEslint } from "../../tooling/harness/presets/eslint.ts";',
      '...harnessEslint({ root: import.meta.dirname, layout: "package" }),',
    ]);
    expect(eslintPresetLines(WORKSPACE, 'import tseslint from "typescript-eslint";\n')[1]).toContain('layout: "package", base: false');
  });
});
