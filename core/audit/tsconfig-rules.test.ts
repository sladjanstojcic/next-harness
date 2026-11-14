import { describe, expect, it } from "vitest";
import { pocketbaseRepo } from "../../testing/pocketbase/pocketbase-repo.ts";
import { auditTsconfigs } from "./tsconfig-rules.ts";

describe("auditTsconfigs", () => {
  it("judges a pocketbase workspace's tsconfig.json", () => {
    const repo = pocketbaseRepo({ "pocketbase/tsconfig.json": '{ "compilerOptions": { "strict": false } }\n' });
    expect(auditTsconfigs(repo.root).map(({ rule, file }) => `${rule} ${file}`)).toEqual(["tsconfig-strict pocketbase/tsconfig.json"]);
  });
});
