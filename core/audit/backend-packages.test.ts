import { describe, expect, it } from "vitest";
import type { ContentProfile } from "../../shapes/shape.ts";
import { ts } from "../../tools/typescript.ts";
import { BACKEND_PACKAGES, backendPackageFindings, isBackendPackage } from "./backend-packages.ts";

const plain: ContentProfile = {
  actionBuilders: [],
  aliases: {},
  messages: {
    serverOnly: "",
    useServer: "",
    useClient: "",
    clientImportsServer: "",
    indexExports: "",
    thinPage: "",
    domainTest: "",
    envAccess: "",
    errorText: "",
  },
};
const profile: ContentProfile = { ...plain, backend: { scope: /^src\//, allowed: /^src\/backend\//, message: "M" } };

function findings(path: string, text: string, added: readonly string[] = []) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return backendPackageFindings({ file: path, path, profile }, source, [...BACKEND_PACKAGES, ...added]);
}

describe("isBackendPackage", () => {
  it.each(["pg", "pg/lib/x", "firebase/firestore", "@supabase/ssr", "@supabase/supabase-js", "pocketbase"])("lists %s", (name) => {
    expect(isBackendPackage(name, BACKEND_PACKAGES)).toBe(true);
  });

  it.each(["pg-format", "postgres-array", "firebase-tools", "react", "./pg", "@/backend/client"])("does not list %s", (name) => {
    expect(isBackendPackage(name, BACKEND_PACKAGES)).toBe(false);
  });
});

describe("backendPackageFindings", () => {
  it("reports a static, dynamic, require and re-export import outside the folder", () => {
    for (const text of [
      'import PocketBase from "pocketbase";',
      'const m = await import("pocketbase");',
      'const m = require("pocketbase");',
      'export { default } from "pocketbase";',
    ])
      expect(findings("src/modules/ads/components/list.tsx", text)).toMatchObject([{ rule: "backend-package", line: 1, message: "M" }]);
  });

  it("passes the backend folder, tests, type-only imports and files outside the scope", () => {
    expect(findings("src/backend/client.ts", 'import PocketBase from "pocketbase";')).toEqual([]);
    expect(findings("src/modules/ads/data/ads.test.ts", 'import PocketBase from "pocketbase";')).toEqual([]);
    expect(findings("src/modules/ads/types.ts", 'import type { Database } from "@supabase/supabase-js";')).toEqual([]);
    expect(findings("src/modules/ads/types.ts", 'export type { Database } from "@supabase/supabase-js";')).toEqual([]);
    expect(findings("scripts/seed.ts", 'import PocketBase from "pocketbase";')).toEqual([]);
  });

  it("reports a mixed value and type import", () => {
    expect(findings("src/modules/ads/types.ts", 'import { createClient, type Database } from "@supabase/supabase-js";')).toHaveLength(1);
  });

  it("takes packages added in the config", () => {
    expect(findings("src/app/page.tsx", 'import x from "my-sdk";', ["my-sdk"])).toHaveLength(1);
  });

  it("reports nothing for a profile without a backend folder", () => {
    const source = ts.createSourceFile("src/a.ts", 'import PocketBase from "pocketbase";', ts.ScriptTarget.Latest, true);
    expect(backendPackageFindings({ file: "src/a.ts", path: "src/a.ts", profile: plain }, source, BACKEND_PACKAGES)).toEqual([]);
  });
});
