import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { harnessRuleBlocks } from "./eslint-rules.ts";

const LAYOUTS = ["app", "app-root", "package", "electron", "spa"] as const;
const ALIASES = { renderer: ["@/", "@renderer/"], contract: ["@shared/", "@contract/"], paths: {} };

/** The sha256 of each layout's JSON-encoded rule blocks, computed from the code at 5602b2b, before the pocketbase layout. */
const BEFORE: Record<string, string> = {
  app: "090203077e29437684c7168107426c830417987d60889ca61ae5101d66d9d3ad",
  "app with shadcn": "77e31d301ee1f255549c7a78419df80941f2105adde840b763fc589bd1fc38db",
  "app-root": "cd66b323ebf06ba900912fb497d1fa797d1f35212035d841d56673a7e68979f2",
  "app-root with shadcn": "f3c9f0bd253e765a26f9ed30581f575d234a87678efd980f3a9a86c19603833e",
  package: "a14c8af1a7b4c5e93787029c59cbb85ec7e8ec1ea9b4409299fcbc50bfab042d",
  "package with shadcn": "a14c8af1a7b4c5e93787029c59cbb85ec7e8ec1ea9b4409299fcbc50bfab042d",
  electron: "503aa67a20bd9ca21c3425dc794f940993cabf9baf0db72785232f74088e92cf",
  "electron with shadcn": "b1421ccf117506127782f7318b054c3dd0d5a8b38367303103e3270e5d4b8695",
  spa: "8e347b605c62122e18bb95d053e436478e8420a5449182f11515e249ec5d8c76",
  "spa with shadcn": "18dc443eb909cbe6d2d57ce2fee998409031d0fa51f1e0a38545ba052d47fa64",
  "electron with aliases": "83a5a7d828cea75a99d1169b8fb1e0a04fec2645616abedfc4eff6613a51ddd8",
};

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("the rule blocks of the layouts that existed before pocketbase", () => {
  const now: Record<string, string> = {
    ...Object.fromEntries(
      LAYOUTS.flatMap((layout) => [
        [layout, sha(harnessRuleBlocks(layout))],
        [`${layout} with shadcn`, sha(harnessRuleBlocks(layout, undefined, true))],
      ]),
    ),
    "electron with aliases": sha(harnessRuleBlocks("electron", ALIASES)),
  };

  it.each(Object.keys(BEFORE))("%s stays exactly as it was", (layout) => {
    expect(now[layout], `the rule blocks of ${layout} changed`).toBe(BEFORE[layout]);
  });

  it("covers every case it hashes", () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
  });
});
