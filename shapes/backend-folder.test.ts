import { describe, expect, it } from "vitest";
import { backendProfile, checkBackendFolder, GENERATED_TYPES } from "./backend-folder.ts";
import { packageShape } from "./package.ts";

const LAYOUT = "(Test layout)";
const check = (...inside: string[]) => checkBackendFolder(inside, "src/backend/", LAYOUT);

describe("checkBackendFolder", () => {
  it.each([["client.ts"], ["client.test.ts"], ["database.types.ts"], ["pocketbase-types.ts"]])("accepts %s", (file) => {
    expect(check(file)).toEqual({ ok: true });
  });

  it("denies a subfolder, naming the folder and the layout", () => {
    const verdict = check("db", "client.ts");
    expect(verdict).toMatchObject({ ok: false, rule: "nesting" });
    expect(verdict.ok ? "" : verdict.reason).toContain("src/backend/");
    expect(verdict.ok ? "" : verdict.reason.endsWith(LAYOUT)).toBe(true);
  });

  it("denies a name that is not kebab-case", () => {
    expect(check("Client.ts")).toMatchObject({ ok: false, rule: "file-name" });
  });

  it.each([["client.tsx"], ["client.js"], ["schema.sql"]])("denies %s", (file) => {
    const verdict = check(file);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.reason.endsWith(LAYOUT)).toBe(true);
  });
});

describe("GENERATED_TYPES", () => {
  it("matches the generated database types of the backend kits", () => {
    expect(GENERATED_TYPES.test("database.types.ts")).toBe(true);
    expect(GENERATED_TYPES.test("pocketbase-types.ts")).toBe(true);
    expect(GENERATED_TYPES.test("client.ts")).toBe(false);
    expect(GENERATED_TYPES.test("types.ts")).toBe(false);
  });
});

describe("backendProfile", () => {
  it("names where the client lives and ends with the layout", () => {
    expect(backendProfile(/^src\//, /^src\/backend\//, "src/backend/", LAYOUT)).toEqual({
      scope: /^src\//,
      allowed: /^src\/backend\//,
      message: `Import a backend package only in src/backend/, which holds the one client; elsewhere import that client, or the package's types with "import type" ${LAYOUT}`,
    });
  });
});

describe("the package shape's backend profile", () => {
  it("allows backend packages in src/server/ and judges the rest of src/", () => {
    const backend = packageShape.content.backend;
    expect(backend?.allowed.test("src/server/db.ts")).toBe(true);
    expect(backend?.scope.test("src/components/x.tsx")).toBe(true);
    expect(backend?.allowed.test("src/components/x.tsx")).toBe(false);
    expect(backend?.message.endsWith("(package layout)")).toBe(true);
  });
});
