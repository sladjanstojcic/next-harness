import { describe, expect, it } from "vitest";
import { makeRepo } from "../tooling/harness/testing/temp-repo.ts";
import { rename } from "./rename.ts";

function fixture() {
  return makeRepo({
    "package.json": JSON.stringify({ name: "template", private: true, scripts: { dev: "next dev", start: "next start" } }),
    "src/app/layout.tsx": 'export const metadata: Metadata = {\n  title: "Create Next App",\n  description: "Keep this",\n};\n',
    "README.md": "# Template\n\nKeep these instructions.\n",
  });
}

describe("rename", () => {
  it("updates the package, dev port, metadata and README heading while preserving other content", () => {
    const repo = fixture();
    rename(repo.root, { name: "orders-app", port: 3100, title: "Orders" });
    expect(JSON.parse(repo.read("package.json"))).toEqual({ name: "orders-app", private: true, scripts: { dev: "next dev -p 3100", start: "next start" } });
    expect(Object.keys(JSON.parse(repo.read("package.json")) as Record<string, unknown>)).toEqual(["name", "private", "scripts"]);
    expect(repo.read("src/app/layout.tsx")).toContain('title: "Orders"');
    expect(repo.read("src/app/layout.tsx")).toContain('description: "Orders"');
    expect(repo.read("README.md")).toBe("# Orders\n\nKeep these instructions.\n");
  });

  it("escapes quoted titles and treats replacement metacharacters literally", () => {
    const repo = fixture();
    rename(repo.root, { name: "orders", port: 3100, title: 'Orders "today" $&' });
    expect(repo.read("src/app/layout.tsx")).toContain('title: "Orders \\"today\\" $&"');
    expect(repo.read("src/app/layout.tsx")).toContain('description: "Orders \\"today\\" $&"');
    expect(repo.read("README.md")).toContain('# Orders "today" $&\n');
  });

  it("rejects invalid ports before writing files", () => {
    const repo = fixture();
    const before = repo.read("package.json");
    expect(() => rename(repo.root, { name: "orders", port: 0, title: "Orders" })).toThrow();
    expect(repo.read("package.json")).toBe(before);
  });
});
