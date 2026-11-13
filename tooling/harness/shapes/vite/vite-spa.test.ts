import { describe, expect, it } from "vitest";
import { codeIndex } from "../../core/code-index.ts";
import { checkPath, isVendoredIn, resolveHarness } from "../../core/path-check.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { shapeOf } from "../index.ts";
import type { PathRule } from "../shape.ts";
import { VITE_LAYOUT } from "./content.ts";
import { VITE_PROBES, viteSpa } from "./vite-spa.ts";

const CONFIG = 'export default { workspaces: [{ path: ".", shape: "vite-spa" }] };\n';
const atRoot = () => resolveHarness(makeRepo({ "harness.config.ts": CONFIG }).root);

const allowed = [
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "components.json",
  "eslint.config.ts",
  "src/main.tsx",
  "src/vite-env.d.ts",
  "src/index.css",
  "src/assets/Logo.svg",
  "src/app/router.tsx",
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/error.tsx",
  "src/app/not-found.tsx",
  "src/app/ads/page.tsx",
  "src/app/ads/[id]/page.tsx",
  "src/app/(auth)/login/layout.tsx",
  "src/modules/ads/index.ts",
  "src/modules/ads/types.ts",
  "src/modules/ads/schemas.ts",
  "src/modules/ads/components/ad-card.tsx",
  "src/modules/ads/components/editor/toolbar.tsx",
  "src/modules/ads/domain/pricing.ts",
  "src/modules/ads/domain/pricing.test.ts",
  "src/modules/ads/hooks/use-ads.ts",
  "src/modules/ads/data/ads.ts",
  "src/modules/ads/data/drafts/save.ts",
  "src/backend/client.ts",
  "src/backend/database.types.ts",
  "src/shared/ui/button.tsx",
  "src/shared/lib/env.ts",
  "src/shared/components/page-header.tsx",
  "src/shared/hooks/use-media.ts",
  "e2e/smoke.test.ts",
  "public/favicon.svg",
];

const denied: [string, PathRule][] = [
  ["src/App.tsx", "file-name"],
  ["src/app/ads/ad-list.tsx", "app-file"],
  ["src/app/ads/page.ts", "app-file"],
  ["src/app/router.ts", "app-file"],
  ["src/app/@modal/page.tsx", "file-name"],
  ["src/app/(.)photo/page.tsx", "file-name"],
  ["src/modules/ads/server.ts", "module-shape"],
  ["src/modules/ads/server/q.ts", "module-shape"],
  ["src/modules/ads/actions/save-action.ts", "module-shape"],
  ["src/modules/ads/data/ads.tsx", "file-name"],
  ["src/modules/ads/data/a/b/c.ts", "nesting"],
  ["src/modules/ads/data/utils/x.ts", "generic-folder"],
  ["src/modules/ads/hooks/ads.ts", "file-name"],
  ["src/modules/ads/domain/view.tsx", "file-name"],
  ["src/backend/db/client.ts", "nesting"],
  ["src/services/api.ts", "src-shape"],
  ["src/assets/helper.ts", "src-shape"],
  ["src/shared/utils/x.ts", "shared-shape"],
];

describe("vite-spa paths", () => {
  it.each(allowed)("accepts %s", (file) => {
    expect(checkPath(file, atRoot())).toEqual({ ok: true });
  });

  it.each(denied)("denies %s as %s", (file, rule) => {
    const verdict = checkPath(file, atRoot());
    expect(verdict).toMatchObject({ ok: false, rule });
    expect(verdict.ok ? "" : verdict.reason.endsWith(VITE_LAYOUT)).toBe(true);
  });

  it("points a module's server code to data/", () => {
    const harness = atRoot();
    for (const file of ["src/modules/ads/server.ts", "src/modules/ads/server/q.ts", "src/modules/ads/actions/save-action.ts"]) {
      const verdict = checkPath(file, harness);
      expect(verdict.ok ? "" : verdict.reason, file).toContain("data/");
    }
  });

  it("lets every probe path through, so the preset check judges only paths the shape allows", () => {
    const harness = atRoot();
    for (const probe of VITE_PROBES) expect(checkPath(probe.replaceAll("{name}", "a-1"), harness), probe).toEqual({ ok: true });
  });

  it("is the shape named vite-spa, with generated code vendored and modules as the same-name scope", () => {
    const harness = atRoot();
    expect(shapeOf("vite-spa")).toBe(viteSpa);
    expect(isVendoredIn(harness, "src/backend/database.types.ts")).toBe(true);
    expect(isVendoredIn(harness, "src/backend/pocketbase-types.ts")).toBe(true);
    expect(isVendoredIn(harness, "src/shared/ui/button.tsx")).toBe(true);
    expect(isVendoredIn(harness, "src/shared/lib/utils.ts")).toBe(true);
    expect(isVendoredIn(harness, "src/backend/client.ts")).toBe(false);
    expect(isVendoredIn(harness, "src/modules/ads/types.ts")).toBe(false);
    expect(viteSpa.sameNameScope("src/modules/ads/data/ads.ts")).toBe("ads");
    expect(viteSpa.sameNameScope("src/modules/ads/index.ts")).toBeUndefined();
  });
});

describe("the code index of a vite-spa workspace", () => {
  it("lists src/backend/, each module's index.ts and src/shared/lib/", () => {
    const repo = makeRepo({
      "harness.config.ts": CONFIG,
      "src/backend/client.ts": "export const backend = {};\n",
      "src/backend/client.test.ts": "export const ignored = 1;\n",
      "src/modules/ads/index.ts": 'export { AdCard } from "./components/ad-card";\n',
      "src/modules/ads/data/ads.ts": "export const hidden = 1;\n",
      "src/shared/lib/money.ts": "export const formatMoney = (value: number): string => String(value);\n",
    });
    const index = codeIndex(repo.root);
    expect(index).toContain("## src/backend\n\n- `client.ts`: `backend`");
    expect(index).toContain("## ads\n\n- `index.ts`: `AdCard`");
    expect(index).toContain("## shared/lib\n\n- `money.ts`: `formatMoney`");
    expect(index).not.toContain("hidden");
    expect(index).not.toContain("ignored");
  });
});
