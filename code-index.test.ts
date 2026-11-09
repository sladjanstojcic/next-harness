import { describe, expect, it } from "vitest";
import { codeIndex } from "./code-index.ts";
import { makeRepo } from "./testing/temp-repo.ts";

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
});
