import { describe, expect, it } from "vitest";
import { toolsOf } from "./shape-names.ts";

describe("toolsOf", () => {
  it.each([
    ["makerkit-app", undefined, "oxc"],
    ["makerkit-feature", undefined, "oxc"],
    ["next-modules", "oxc", "oxc"],
    ["next-modules", undefined, "eslint-prettier"],
    ["supabase", undefined, "eslint-prettier"],
  ] as const)("gives an e2e workspace beside a %s workspace with tools %s the %s tool set", (shape, tools, expected) => {
    const other = { shape, ...(tools === undefined ? {} : { tools }) };
    const e2e = { shape: "e2e" } as const;
    expect(toolsOf(e2e, [other, e2e])).toBe(expected);
  });

  it("keeps an e2e workspace's own tools beside a Makerkit app", () => {
    const e2e = { shape: "e2e", tools: "eslint-prettier" } as const;
    expect(toolsOf(e2e, [{ shape: "makerkit-app" }, e2e])).toBe("eslint-prettier");
  });

  it("gives any other shape its own default, whatever the other workspaces use", () => {
    expect(toolsOf({ shape: "pocketbase" }, [{ shape: "makerkit-app" }])).toBe("eslint-prettier");
  });
});
