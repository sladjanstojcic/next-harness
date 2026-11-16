import { describe, expect, it } from "vitest";
import { codeIndex } from "../../core/code-index.ts";
import { checkPath, isVendoredIn, resolveHarness } from "../../core/path-check.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { shapeOf } from "../index.ts";
import type { PathRule } from "../shape.ts";
import { NODE_LAYOUT } from "./source-rules.ts";
import { NODE_PROBES, nodeService } from "./node-service.ts";

const API = "apps/api";
const CONFIG = `export default { workspaces: [{ path: "${API}", shape: "node-service" }], root: { entries: ["apps"] } };\n`;
const harness = () => resolveHarness(makeRepo({ "harness.config.ts": CONFIG }).root);

const allowed = [
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "Dockerfile",
  "Dockerfile.dockerignore",
  "vitest.config.ts",
  "vitest.int.config.ts",
  "eslint.config.ts",
  ".env.example",
  "README.md",
  "src/main.ts",
  "src/worker.ts",
  "src/app/app.ts",
  "src/app/app.test.ts",
  "src/modules/ads/index.ts",
  "src/modules/ads/types.ts",
  "src/modules/ads/schemas.ts",
  "src/modules/ads/routes.ts",
  "src/modules/ads/routes.test.ts",
  "src/modules/ads/routes.int.test.ts",
  "src/modules/ads/domain/price.ts",
  "src/modules/ads/domain/price.test.ts",
  "src/modules/ads/domain/budget/split.ts",
  "src/modules/ads/data/ads.ts",
  "src/modules/ads/data/ads.int.test.ts",
  "src/modules/ads/data/render/frame.ts",
  "src/backend/client.ts",
  "src/backend/database.types.ts",
  "src/shared/lib/env.ts",
  "src/shared/lib/log.ts",
];

const denied: [string, PathRule][] = [
  ["index.html", "unknown-root"],
  ["public/logo.svg", "unknown-root"],
  ["src/index.ts", "src-shape"],
  ["src/server.tsx", "src-shape"],
  ["src/routes/ads.ts", "src-shape"],
  ["src/app/router.ts", "app-file"],
  ["src/app/ads/route.ts", "app-file"],
  ["src/modules/ads/server.ts", "module-shape"],
  ["src/modules/ads/server/query.ts", "module-shape"],
  ["src/modules/ads/actions/save-action.ts", "module-shape"],
  ["src/modules/ads/components/ad-card.tsx", "module-shape"],
  ["src/modules/ads/hooks/use-ads.ts", "module-shape"],
  ["src/modules/ads/routes/list.ts", "module-shape"],
  ["src/modules/ads/data/ads.tsx", "file-name"],
  ["src/modules/ads/data/a/b/c.ts", "nesting"],
  ["src/modules/ads/data/utils/x.ts", "generic-folder"],
  ["src/modules/Ads/index.ts", "file-name"],
  ["src/backend/db/client.ts", "nesting"],
  ["src/shared/components/x.ts", "shared-shape"],
  ["src/shared/hooks/use-x.ts", "shared-shape"],
  ["src/shared/lib/area/x.ts", "nesting"],
];

describe("the node-service shape's paths", () => {
  it.each(allowed)("allows %s", (file) => {
    expect(checkPath(`${API}/${file}`, harness())).toEqual({ ok: true });
  });

  it.each(denied)("denies %s as %s, in the Node layout's words", (file, rule) => {
    const verdict = checkPath(`${API}/${file}`, harness());
    expect(verdict).toMatchObject({ ok: false, rule });
    if (!verdict.ok) expect(verdict.reason.endsWith(NODE_LAYOUT), verdict.reason).toBe(true);
  });

  it("sends server code and UI to the right place", () => {
    const reason = (file: string): string => {
      const verdict = checkPath(`${API}/${file}`, harness());
      return verdict.ok ? "" : verdict.reason;
    };
    expect(reason("src/modules/ads/server/query.ts")).toContain("data/");
    expect(reason("src/modules/ads/components/ad-card.tsx")).toContain("no UI");
    expect(reason("src/app/router.ts")).toContain("routes.ts");
  });

  it("vendors the generated backend types only", () => {
    expect(isVendoredIn(harness(), `${API}/src/backend/database.types.ts`)).toBe(true);
    expect(isVendoredIn(harness(), `${API}/src/backend/client.ts`)).toBe(false);
  });

  it("is the shape the config names, with probes the shape allows", () => {
    expect(shapeOf("node-service")).toBe(nodeService);
    for (const probe of NODE_PROBES) expect(checkPath(`${API}/${probe.replaceAll("{name}", "probe")}`, harness()), probe).toEqual({ ok: true });
  });

  it("indexes the backend, each module's public entry and shared/lib", () => {
    const repo = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: ".", shape: "node-service" }] };\n',
      "src/backend/client.ts": "export const db = {};\n",
      "src/modules/ads/index.ts": 'export { ads } from "./routes.ts";\n',
      "src/shared/lib/env.ts": "export const env = {};\n",
    });
    const text = codeIndex(repo.root);
    expect(text).toContain("## src/backend\n\n- `client.ts`: `db`");
    expect(text).toContain("## ads\n\n- `index.ts`: `ads`");
    expect(text).toContain("## shared/lib\n\n- `env.ts`: `env`");
  });
});
