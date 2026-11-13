import { describe, expect, it } from "vitest";
import { declaresTailwind } from "./tailwind.ts";

describe("declaresTailwind", () => {
  it.each([
    [{ devDependencies: { tailwindcss: "4.3.4" } }, true],
    [{ dependencies: { tailwindcss: "4.3.4" } }, true],
    [{ dependencies: { "@tailwindcss/vite": "4.3.4" } }, false],
    [{ devDependencies: { "@tailwindcss/turbopack": "4.3.4", "tailwind-merge": "3.0.0" } }, false],
    [{ peerDependencies: { tailwindcss: "4.3.4" } }, false],
    [{}, false],
    [undefined, false],
    [["tailwindcss"], false],
  ])("%j → %s", (manifest, expected) => {
    expect(declaresTailwind(manifest)).toBe(expected);
  });
});
