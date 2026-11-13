import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../core/audit/audit.ts";
import { codeIndex } from "../core/code-index.ts";
import { expandWorkspaces, DEFAULT_CONFIG } from "../config.ts";
import { checkPath, isVendoredIn, resolveHarness } from "../core/path-check.ts";
import { harnessEslint } from "../presets/eslint.ts";
import { harnessKnipWorkspace } from "../presets/knip.ts";
import { makeRepo } from "../testing/temp-repo.ts";
import { eslintPreset, eslintPresetLines, expectedRules } from "../tools/eslint-preset.ts";
import { nextModules, nextModulesAtRoot } from "./next-modules.ts";
import { sourceProbes } from "./next-probes.ts";

const PAGE = "export default function Page() {\n  return null;\n}\n";
/** create-next-app without --src-dir, and no harness.config.ts. */
const rootLayout = (files: Record<string, string> = {}) => makeRepo({ "package.json": "{}\n", "app/page.tsx": PAGE, ...files }, { agents: true });
const sourceRootIn = (files: Record<string, string>) => expandWorkspaces(makeRepo(files).root, DEFAULT_CONFIG)[0]?.sourceRoot ?? "src/";

describe("the source root of a next-modules workspace", () => {
  it("is the workspace top only with app/ and no src/app/", () => {
    expect(sourceRootIn({ "app/page.tsx": PAGE })).toBe("");
    expect(sourceRootIn({ "app/page.tsx": PAGE, "src/lib/old.ts": "" })).toBe("");
    expect(sourceRootIn({ "app/page.tsx": PAGE, "src/app/page.tsx": PAGE })).toBe("src/");
    expect(sourceRootIn({ "src/app/page.tsx": PAGE })).toBe("src/");
    expect(sourceRootIn({ "package.json": "{}\n" })).toBe("src/");
    expect(sourceRootIn({ "modules/a/index.ts": "", "shared/lib/a.ts": "" })).toBe("src/");
  });
});

describe("next-modules paths without src/", () => {
  it.each([
    "app/layout.tsx",
    "app/globals.css",
    "app/reports/page.tsx",
    "app/(shop)/[id]/page.tsx",
    "app/api/orders/route.ts",
    "modules/billing/index.ts",
    "modules/billing/server.ts",
    "modules/billing/domain/price.ts",
    "modules/billing/domain/price.test.ts",
    "modules/billing/domain/tax/vat.ts",
    "modules/billing/actions/save-price-action.ts",
    "modules/billing/components/price-tag.tsx",
    "modules/.gitkeep",
    "shared/lib/env.ts",
    "shared/ui/button.tsx",
    "shared/components/nav/menu.tsx",
    "shared/hooks/use-toggle.ts",
    "proxy.ts",
    "instrumentation.ts",
    "instrumentation-client.ts",
    "next.config.ts",
    "eslint.config.mjs",
    "e2e/smoke.test.ts",
    "public/logo.svg",
    "scripts/seed.ts",
  ])("accepts %s", (file) => {
    expect(checkPath(file, resolveHarness(rootLayout().root))).toEqual({ ok: true });
  });

  it.each([
    ["utils/x.ts", "unknown-root"],
    ["lib/x.ts", "unknown-root"],
    ["components/x.tsx", "unknown-root"],
    ["middleware.ts", "unknown-root"],
    ["src/app/x/page.tsx", "unknown-root"],
    ["src/modules/billing/index.ts", "unknown-root"],
    ["src/proxy.ts", "unknown-root"],
    ["app/reports/helper.ts", "app-file"],
    ["app/Reports/page.tsx", "file-name"],
    ["modules/Billing/index.ts", "file-name"],
    ["modules/billing/utils/x.ts", "module-shape"],
    ["modules/billing/actions/save.ts", "module-shape"],
    ["modules/billing/domain/a/b/x.ts", "nesting"],
    ["modules/billing/domain/utils/x.ts", "generic-folder"],
    ["shared/x.ts", "shared-shape"],
    ["shared/lib/money/format.ts", "nesting"],
    ["shared/components/common/x.tsx", "generic-folder"],
    ["app/.secret.ts", "hidden-file"],
    ["modules/billing/x.js", "js-file"],
    ["modules", "src-shape"],
  ])("denies %s with %s, in words that name no src/ path", (file, rule) => {
    const verdict = checkPath(file, resolveHarness(rootLayout().root));
    expect(verdict).toMatchObject({ ok: false, rule });
    expect(verdict.ok ? "" : verdict.reason.replace("not in src/", "")).not.toContain("src/");
  });

  it("names the layout's own folders in each denial", () => {
    const reason = (file: string): string => {
      const verdict = checkPath(file, resolveHarness(rootLayout().root));
      return verdict.ok ? "" : verdict.reason;
    };
    expect(reason("src/app/x/page.tsx")).toContain("routes belong in app/, feature code in modules/<module>/");
    expect(reason("modules")).toBe("Put routes in app/, feature code in modules/<module>/, and cross-cutting utilities in shared/lib/.");
    expect(reason("modules/billing/domain/a/b/x.ts")).toContain("Split a new modules/<module>/ for more depth.");
    expect(reason("shared/x.ts")).toBe("Put shared code in shared/components/, lib/ or hooks/; generated primitives belong in shared/ui/.");
    expect(reason("app/Reports/page.tsx")).toBe(
      "Use kebab-case names in app/, modules/, shared/, tooling/, scripts/ or e2e/; Next route segments belong only in app/.",
    );
    expect(reason("modules/billing/x.js")).toContain("Use TypeScript (.ts/.tsx) in app/, modules/, shared/, tooling/ or scripts/");
  });

  it("keeps the three folders at the top denied in a project with src/app/, and src/ in one without", () => {
    const withSrc = resolveHarness(makeRepo({ "src/app/page.tsx": PAGE }).root);
    for (const file of ["app/reports/page.tsx", "modules/billing/index.ts", "shared/lib/x.ts", "proxy.ts"])
      expect(checkPath(file, withSrc), file).toMatchObject({ ok: false, rule: "unknown-root" });
    expect(checkPath("src/app/reports/page.tsx", withSrc)).toEqual({ ok: true });
    const empty = resolveHarness(makeRepo({ "package.json": "{}\n" }).root);
    expect(checkPath("app/page.tsx", empty)).toMatchObject({ ok: false, rule: "unknown-root" });
    expect(checkPath("src/app/page.tsx", empty)).toEqual({ ok: true });
  });
});

describe("next-modules content without src/", () => {
  const FILES = {
    "tsconfig.json": '{ "compilerOptions": { "strict": true, "paths": { "@/*": ["./*"] } } }\n',
    "next.config.ts": "export default { env: { A: process.env.A } };\n",
    "app/page.tsx": "export default function Page() {\n  return process.env.NAME;\n}\n",
    "shared/lib/env.ts": "export const env = process.env;\n",
    "shared/ui/button.tsx": "export const Button = () => process.env.X;\n",
    "modules/billing/server/get-prices.ts": "export const getPrices = () => [];\n",
    "modules/billing/server.ts": 'import "server-only";\nexport { getPrices } from "./server/get-prices";\n',
    "modules/billing/index.ts": 'export { getPrices } from "./server";\n',
    "modules/billing/domain/price.ts": '"use client";\nexport const price = 1;\n',
    "modules/billing/actions/save-price-action.ts": '"use server";\nexport async function savePrice() {}\n',
    "modules/billing/components/form.tsx": "export const Form = () => null;\n",
    "modules/cart/components/form.tsx": '"use client";\nimport { getPrices } from "@/modules/billing/server";\nexport const Form = () => getPrices();\n',
  };

  it("applies every content rule to the folders at the top, and none to the config files", () => {
    const repo = rootLayout(FILES);
    const findings = audit(repo.root);
    expect(findings.map(({ file, rule }) => `${file} ${rule}`).sort()).toEqual([
      "app/page.tsx env-access",
      "modules/billing/actions/save-price-action.ts use-server-placement",
      "modules/billing/components/form.tsx duplicate-file-name",
      "modules/billing/domain/price.ts domain-test",
      "modules/billing/domain/price.ts use-client-placement",
      "modules/billing/index.ts index-exports",
      "modules/billing/server/get-prices.ts server-only",
      "modules/cart/components/form.tsx client-imports-server",
      "modules/cart/components/form.tsx duplicate-file-name",
    ]);
    for (const { message, rule } of findings) expect(message, rule).not.toContain("src/");
    const message = (rule: string): string => findings.find((finding) => finding.rule === rule)?.message ?? "";
    expect(message("env-access")).toBe("Read and validate environment variables in shared/lib/env.ts; import its typed env value here.");
    expect(message("domain-test")).toBe("Put the domain rule's test beside it at modules/billing/domain/price.test.ts.");
    expect(message("use-server-placement")).toContain("modules/<module>/actions/<name>-action.ts and call defineAction from shared/lib/define-action.ts");
    expect(message("duplicate-file-name")).toContain("Move reusable code to shared/lib/ or shared/components/, or use module-specific names in modules/.");
    expect(isVendoredIn(resolveHarness(repo.root), "shared/ui/button.tsx")).toBe(true);
  });

  it("lists modules and shared helpers in the code index", () => {
    const index = codeIndex(rootLayout(FILES).root);
    expect(index).toContain("## billing\n\n- `index.ts`: `getPrices`\n- `server.ts`: `getPrices`\n- `actions/save-price-action.ts`: `savePrice`");
    expect(index).toContain("## shared/lib\n\n- `env.ts`: `env`");
  });
});

describe("the presets without src/", () => {
  const WORKSPACE = { path: "", shape: "next-modules", next: true, sourceRoot: "" } as const;

  it("probes the same folders at the top, none outside the layout", () => {
    const probes = eslintPreset("/repo", WORKSPACE, () => "n").command.slice(3);
    expect(probes).toEqual(sourceProbes("").map((probe) => probe.replaceAll("{name}", "n")));
    expect(probes.filter((probe) => probe.startsWith("src/"))).toEqual([]);
    expect(probes).toContain("modules/n/server/n.ts");
    expect(probes).toContain("scripts/n.ts");
    const harness = resolveHarness(rootLayout().root);
    for (const probe of probes) expect(checkPath(probe, harness), probe).not.toMatchObject({ rule: "unknown-root" });
  });

  it("expects the rules on those folders and prints the layout in the lines for a kept config", () => {
    const settings = (probe: string) => expectedRules(probe, "app-root");
    expect(settings("modules/a/server/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBeUndefined();
    expect(settings("modules/a/domain/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBe("error");
    expect(settings("src/modules/a/server/a.ts")["@typescript-eslint/no-unsafe-type-assertion"]).toBe("error");
    expect(settings("shared/lib/log.ts")["no-console"]).toBe("off");
    expect(settings("shared/lib/a.ts")["no-console"]).toBe("error");
    expect(eslintPresetLines(WORKSPACE, "export default [];\n")[1]).toBe('...harnessEslint({ root: import.meta.dirname, layout: "app-root", next: true }),');
  });

  it("leaves the generated backend types to ESLint's ignores in both Next layouts", () => {
    const template = path.resolve(import.meta.dirname, "../../..");
    const ignores = (layout: "app" | "app-root") =>
      harnessEslint({ root: template, layout }).flatMap((entry) =>
        Array.isArray(entry.ignores) ? entry.ignores.filter((glob): glob is string => typeof glob === "string") : [],
      );
    expect(ignores("app")).toEqual(expect.arrayContaining(["src/backend/*.types.ts", "src/backend/*-types.ts"]));
    expect(ignores("app-root")).toEqual(expect.arrayContaining(["backend/*.types.ts", "backend/*-types.ts"]));
  });

  it("gives knip the helpers and vendored code where they are", () => {
    const repo = rootLayout({ "shared/lib/env.ts": "export const env = {};\n", "shared/ui/button.tsx": "" });
    expect(harnessKnipWorkspace({ harness: "analyse" }, repo.root)).toMatchObject({ entry: ["shared/lib/env.ts"], ignore: ["shared/ui/**"] });
    const withBackend = rootLayout({ "shared/ui/button.tsx": "", "backend/client.ts": "" });
    expect(harnessKnipWorkspace({ harness: "analyse" }, withBackend.root).ignore).toEqual(["shared/ui/**", "backend/*.types.ts", "backend/*-types.ts"]);
  });
});

describe("the backend folder", () => {
  it.each([
    ["src/", nextModules],
    ["", nextModulesAtRoot],
  ])("holds the one client under %j and treats its generated types as vendored", (root, shape) => {
    expect(shape.checkPath(`${root}backend/client.ts`)).toEqual({ ok: true });
    expect(shape.checkPath(`${root}backend/db/client.ts`)).toMatchObject({ ok: false, rule: "nesting" });
    expect(shape.vendoredPattern?.test(`${root}backend/database.types.ts`)).toBe(true);
    expect(shape.vendoredPattern?.test(`${root}backend/client.ts`)).toBe(false);
    expect(shape.content.backend?.allowed.test(`${root}backend/client.ts`)).toBe(true);
    expect(shape.content.backend?.allowed.test(`${root}modules/ads/server/q.ts`)).toBe(false);
    expect(shape.content.backend?.scope).toEqual(shape.content.envScope);
  });

  it.each([
    ["src/", (files: Record<string, string>) => makeRepo({ "src/app/page.tsx": PAGE, ...files })],
    ["", rootLayout],
  ])("is in the environment and backend scope under %j, as the rest of the source is", (root, layout) => {
    const client = 'import PocketBase from "pocketbase";\n\nexport const client = new PocketBase(process.env.DB_URL);\n';
    const repo = layout({ [`${root}backend/client.ts`]: client, [`${root}modules/ads/server/rows.ts`]: `import "server-only";\n${client}` });
    const found = audit(repo.root).filter(({ rule }) => rule === "env-access" || rule === "backend-package");
    expect(found.map(({ file, rule }) => `${file} ${rule}`).sort()).toEqual([
      `${root}backend/client.ts env-access`,
      `${root}modules/ads/server/rows.ts backend-package`,
      `${root}modules/ads/server/rows.ts env-access`,
    ]);
  });

  it("is a vendored path through the harness in both layouts, and a top entry without src/", () => {
    const withSrc = resolveHarness(makeRepo({ "src/app/page.tsx": PAGE }).root);
    expect(isVendoredIn(withSrc, "src/backend/database.types.ts")).toBe(true);
    expect(isVendoredIn(withSrc, "src/backend/client.ts")).toBe(false);
    const atRoot = resolveHarness(rootLayout().root);
    expect(checkPath("backend/client.ts", atRoot)).toEqual({ ok: true });
    expect(isVendoredIn(atRoot, "backend/pocketbase-types.ts")).toBe(true);
    expect(nextModulesAtRoot.topEntries).toContain("backend");
  });
});
