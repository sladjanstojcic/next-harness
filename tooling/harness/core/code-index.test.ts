import { describe, expect, it } from "vitest";
import { codeIndex } from "./code-index.ts";
import { makeRepo } from "../testing/temp-repo.ts";

describe("code index", () => {
  it("lists public exports, action files and shared helpers without module internals or tests", () => {
    const repo = makeRepo({
      "src/modules/orders/index.ts": 'export { OrderList, type Order as PublicOrder } from "./components/order-list";',
      "src/modules/orders/server.ts": 'import "server-only";\nexport async function getOrders() {}',
      "src/modules/orders/actions/save-order-action.ts": '"use server";\nexport const saveOrder = () => {};',
      "src/modules/orders/components/private.ts": "export const privateValue = 1;",
      "src/shared/lib/format.ts": "export function formatDate() {}\nexport type DateStyle = string;\nexport interface FormatOptions {}",
      "src/shared/lib/format.test.ts": "export const testHelper = 1;",
      "src/shared/lib/user-error.ts": "export class UserError extends Error {}",
    });
    const result = codeIndex(repo.root);
    for (const text of [
      "## orders",
      "index.ts",
      "OrderList",
      "PublicOrder",
      "server.ts",
      "getOrders",
      "actions/save-order-action.ts",
      "## shared/lib",
      "format.ts",
      "formatDate",
      "DateStyle",
      "FormatOptions",
      "UserError",
    ]) {
      expect(result).toContain(text);
    }
    expect(result).not.toContain("privateValue");
    expect(result).not.toContain("testHelper");
  });

  it.each([
    ["export abstract class Repository {}", "`Repository`"],
    ["export enum OrderStatus { Open, Closed }", "`OrderStatus`"],
    ["export let currentOrder = 1;", "`currentOrder`"],
    ["const first = 1; const second = 2; export { first, second };", "`first`, `second`"],
    ["type Internal = string; const value = 1; export { type Internal as Public, value as publicValue };", "`Public`, `publicValue`"],
  ])("indexes public declarations and local export lists: %s", (source, names) => {
    const repo = makeRepo({ "src/modules/orders/index.ts": source });
    expect(codeIndex(repo.root)).toContain(`- \`index.ts\`: ${names}\n`);
  });

  it("caps a large index at 8192 UTF-8 bytes and ends with a truncation note", () => {
    const source = Array.from({ length: 1000 }, (_, index) => `export const export${index} = 1;`).join("\n");
    expect(Buffer.byteLength(source)).toBeGreaterThan(20_000);
    const repo = makeRepo({ "src/modules/žž-orders/index.ts": source });
    const result = codeIndex(repo.root);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(8192);
    expect(result).toMatch(/\[Code index truncated at 8 KB\. Read module public files for the remaining exports\.\]\n$/);
    expect(result).not.toContain("�");
  });

  it("handles the template with no modules or shared files", () => {
    expect(codeIndex(makeRepo().root)).toContain("## shared/lib");
  });

  const SHARED = { "src/shared/lib/format.ts": "export const f = 1;\n" };
  const SHADCN = { ...SHARED, "components.json": "{}\n" };
  const section = (index: string): string[] => {
    const lines = index.split("\n");
    const start = lines.indexOf("## Interface");
    const end = lines.findIndex((line, at) => at > start && line.startsWith("## "));
    return start === -1 ? [] : lines.slice(start, end === -1 ? undefined : end).filter((line) => line !== "");
  };

  it("stays byte-equal in a workspace without components.json", () => {
    const expected =
      "# Code index\n\nReuse these public APIs before adding code. Module internals stay inside their module.\n\n## shared/lib\n\n- `format.ts`: `f`\n";
    expect(codeIndex(makeRepo(SHARED).root)).toBe(expected);
    const withForms = { ...SHARED, "package.json": '{ "dependencies": { "react-hook-form": "7.0.0" } }\n' };
    expect(codeIndex(makeRepo(withForms).root)).toBe(expected);
  });

  it("adds the interface guidance before the exports of a workspace with components.json, in at most ten lines", () => {
    const index = codeIndex(makeRepo(SHADCN).root);
    expect(index).toContain("their module.\n\n## Interface\n\n");
    expect(index.indexOf("## Interface")).toBeLessThan(index.indexOf("## shared/lib"));
    expect(index).toContain("\n\n## shared/lib\n\n- `format.ts`: `f`\n");
    const lines = section(index);
    expect(lines.length).toBeLessThanOrEqual(10);
    const text = lines.join("\n");
    for (const part of [
      "shadcn components in `src/shared/ui/`",
      "layouts and blocks (sidebar, page header, cards), unless the task says otherwise",
      "A mockup decides what is on a screen and what it says; shadcn decides how it looks.",
      "Do not hand-style a look-alike of a component shadcn has, and keep a component's own variants and spacing.",
      "say so in the handoff before building it by hand",
      "If the skills `shadcn` and `vercel-react-best-practices` are available in this session, load them before UI work.",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain("react-hook-form");
  });

  it.each(["dependencies", "devDependencies"])("names the form stack when react-hook-form is in the workspace's %s", (group) => {
    const repo = makeRepo({ ...SHADCN, "package.json": JSON.stringify({ [group]: { "react-hook-form": "7.0.0" } }) });
    const lines = section(codeIndex(repo.root));
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.join("\n")).toContain(
      "A client form uses `react-hook-form` with the shadcn field components and a Zod schema from the module's `schemas.ts`.",
    );
  });

  it("names the layout's own folder, per workspace, and says nothing where the shape has no shared/ui/", () => {
    const atTop = codeIndex(makeRepo({ "app/page.tsx": "export default function Page() { return null; }\n", "components.json": "{}\n" }).root);
    expect(atTop).toContain("shadcn components in `shared/ui/`");
    const config = {
      workspaces: [
        { path: "apps/web", shape: "next-modules" },
        { path: "apps/desk", shape: "electron-vite" },
        { path: "apps/site", shape: "next-modules" },
        { path: "packages/billing", shape: "package" },
      ],
    };
    const index = codeIndex(
      makeRepo({
        "harness.config.ts": `export default ${JSON.stringify(config)};\n`,
        "apps/web/components.json": "{}\n",
        "apps/desk/components.json": "{}\n",
        "apps/site/package.json": "{}\n",
        "packages/billing/components.json": "{}\n",
        "packages/billing/src/index.ts": "export const b = 1;\n",
      }).root,
    );
    expect(index.match(/## Interface/g)).toHaveLength(2);
    expect(index).toContain("# apps/web\n\n## Interface\n\n");
    expect(index).toContain("# apps/desk\n\n## Interface\n\n");
    expect(index).toContain("shadcn components in `src/renderer/src/shared/ui/`");
    expect(index).not.toContain("# apps/site\n\n## Interface");
    expect(index).not.toContain("# packages/billing\n\n## Interface");
  });
});
