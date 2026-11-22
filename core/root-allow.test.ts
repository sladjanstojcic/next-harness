import { describe, expect, it } from "vitest";
import { makeRepo } from "../testing/temp-repo.ts";
import { checkPath, resolveHarness } from "./path-check.ts";

const config = (root: string): string =>
  `export default { workspaces: [{ path: "apps/web", shape: "next-modules" }, { path: "packages/features/*", shape: "makerkit-feature" }]${root} };\n`;
const withAllow = resolveHarness(
  makeRepo({
    "harness.config.ts": config(', root: { allow: ["packages/email-templates/src/locales/bs/*.json"] }'),
    "packages/features/auth/package.json": "{}",
  }).root,
);
const without = resolveHarness(makeRepo({ "harness.config.ts": config(""), "packages/features/auth/package.json": "{}" }).root);

describe("root.allow", () => {
  it("lets a file the glob names pass the unknown-root check", () => {
    expect(checkPath("packages/email-templates/src/locales/bs/common.json", withAllow)).toEqual({ ok: true });
  });

  it.each([
    "packages/email-templates/src/locales/de/common.json",
    "packages/email-templates/src/locales/bs/common.ts",
    "packages/email-templates/src/index.ts",
    "packages/other/src/locales/bs/common.json",
    "packages/README.md",
  ])("still denies %s beside the allowed path", (file) => {
    expect(checkPath(file, withAllow)).toEqual(expect.objectContaining({ rule: "unknown-root" }));
  });

  it("keeps every other path rule on an allowed file", () => {
    const harness = resolveHarness(makeRepo({ "harness.config.ts": config(', root: { allow: ["packages/email-templates/src/locales/bs/*"] }') }).root);
    expect(checkPath("packages/email-templates/src/locales/bs/common.js", harness)).toEqual(expect.objectContaining({ rule: "js-file" }));
  });

  it("does not reach into a workspace, whose own layout decides", () => {
    const harness = resolveHarness(
      makeRepo({ "harness.config.ts": config(', root: { allow: ["packages/features/auth/extra/*"] }'), "packages/features/auth/package.json": "{}" }).root,
    );
    expect(checkPath("packages/features/auth/extra/x.json", harness)).toMatchObject({ ok: false });
  });

  it("changes nothing without the field", () => {
    expect(checkPath("packages/email-templates/src/locales/bs/common.json", without)).toEqual(expect.objectContaining({ rule: "unknown-root" }));
  });
});
