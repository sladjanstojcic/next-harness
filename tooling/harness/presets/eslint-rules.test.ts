import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { harnessRuleBlocks } from "./eslint-rules.ts";

const LAYOUTS = ["app", "app-root", "package", "electron", "spa"] as const;
const ALIASES = { renderer: ["@/", "@renderer/"], contract: ["@shared/", "@contract/"], paths: {} };
const SNAPSHOT = path.join(import.meta.dirname, "../testing/fixtures/rule-blocks.json");

describe("the rule blocks of the layouts that existed before pocketbase", () => {
  const before: unknown = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const now = {
    ...Object.fromEntries(
      LAYOUTS.flatMap((layout) => [
        [layout, harnessRuleBlocks(layout)],
        [`${layout} with shadcn`, harnessRuleBlocks(layout, undefined, true)],
      ]),
    ),
    "electron with aliases": harnessRuleBlocks("electron", ALIASES),
  };

  it("stay exactly as they were", () => {
    expect(now).toEqual(before);
  });
});
