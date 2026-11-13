import { describe, expect, it } from "vitest";
import { isLocked } from "../lock.ts";

describe("tool config locks", () => {
  const config = {
    workspaces: [
      { path: "apps/*", shape: "next-modules" as const },
      { path: "packages/kit", shape: "makerkit-feature" as const },
    ],
  };

  it("locks the written tool configs in each eslint-prettier workspace, and nowhere else", () => {
    expect(isLocked("apps/dashboard/eslint.config.ts", config)).toBe(true);
    expect(isLocked("apps/web/.dependency-cruiser.json", config)).toBe(true);
    expect(isLocked("apps/web/vitest.config.ts", config)).toBe(true);
    expect(isLocked("apps/web/tsconfig.json", config)).toBe(true);
    expect(isLocked("apps/web/.prettierignore", config)).toBe(true);
    expect(isLocked("packages/kit/.prettierignore", config)).toBe(false);
    expect(isLocked("packages/kit/tsconfig.json", config)).toBe(false);
    expect(isLocked("apps/web/src/eslint.config.ts", config)).toBe(false);
    expect(isLocked("packages/kit/eslint.config.ts", config)).toBe(false);
    expect(isLocked("apps/dashboard/eslint.config.ts")).toBe(false);
    expect(isLocked("eslint.config.ts")).toBe(true);
    for (const own of ["eslint.config.mjs", ".prettierrc", ".prettierrc.json", "vitest.config.mts", "knip.json", "playwright.config.mjs"]) {
      expect(isLocked(own), own).toBe(true);
      expect(isLocked(`apps/web/${own}`, config), own).toBe(true);
      expect(isLocked(`packages/kit/${own}`, config), own).toBe(false);
    }
  });
});
