import { describe, expect, it } from "vitest";
import { makerkitApp } from "../../shapes/makerkit/makerkit-app.ts";
import { nextModules } from "../../shapes/next-modules.ts";
import type { ContentProfile } from "../../shapes/shape.ts";
import { viteContent } from "../../shapes/vite/content.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { auditContent, auditSource, resolveTarget } from "./content-rules.ts";

describe("action builders", () => {
  it("recognises a chained defineAction call in the default shape", () => {
    const file = "src/modules/a/actions/save-a-action.ts";
    const repo = makeRepo({ [file]: '"use server";\nexport const save = defineAction.withSchema(schema).action(handler);\n' });
    expect(auditContent(repo.root, [file])).toEqual([]);
  });

  it("recognises a chained builder named by another profile", () => {
    const profile: ContentProfile = { ...nextModules.content, actionFile: /-server-actions\.ts$/, actionBuilders: ["authActionClient"] };
    const file = "app/home/_lib/server/save-server-actions.ts";
    const source = '"use server";\nexport const save = authActionClient.inputSchema(S).action(async () => {});\n';
    expect(auditSource(makeRepo().root, { file, path: file, profile }, source)).toEqual([]);
  });
});

describe("NEXT_PUBLIC_* reads", () => {
  const source = "export const url = process.env.NEXT_PUBLIC_SITE_URL;\n";

  it("stay env-access in next-modules, which has no publicEnvAllowed", () => {
    const file = "src/modules/a/components/x.tsx";
    expect(auditSource(makeRepo().root, { file, path: file, profile: nextModules.content }, source).map(({ rule }) => rule)).toEqual(["env-access"]);
  });

  it("stay env-access in vite-spa, where Vite exposes nothing as process.env", () => {
    const file = "src/modules/a/components/x.tsx";
    expect(auditSource(makeRepo().root, { file, path: file, profile: viteContent }, source).map(({ rule }) => rule)).toEqual(["env-access"]);
  });

  it("pass in a makerkit profile", () => {
    const file = "app/home/_components/x.tsx";
    expect(auditSource(makeRepo().root, { file, path: file, profile: makerkitApp.content }, source)).toEqual([]);
  });
});

describe("alias resolution", () => {
  it("picks the longest matching alias prefix whatever the key order", () => {
    const file = "app/home/_components/x.tsx";
    for (const aliases of [
      { "~/": "app/", "~/config/": "config/" },
      { "~/config/": "config/", "~/": "app/" },
    ]) {
      const profile: ContentProfile = { ...nextModules.content, aliases };
      expect(resolveTarget(profile, file, "~/config/app.config")).toBe("config/app.config");
      expect(resolveTarget(profile, file, "~/home/page")).toBe("app/home/page");
    }
  });
});

describe("type-only imports in client components", () => {
  const cases = [
    { profile: nextModules.content, file: "src/modules/a/components/x.tsx", target: "@/modules/a/server/load" },
    { profile: makerkitApp.content, file: "app/home/_components/x.tsx", target: "../_lib/server/load-user-workspace" },
  ];

  it.each(cases)("ignores erased imports of $target", ({ profile, file, target }) => {
    const root = makeRepo().root;
    for (const line of [`import type { W } from "${target}";`, `import { type W, type V } from "${target}";`]) {
      expect(auditSource(root, { file, path: file, profile }, `"use client";\n${line}\nexport const f = (w: W) => w;\n`)).toEqual([]);
    }
  });

  it.each(cases)("flags value imports of $target", ({ profile, file, target }) => {
    const root = makeRepo().root;
    for (const line of [`import { type W, load } from "${target}";`, `import load from "${target}";`]) {
      const findings = auditSource(root, { file, path: file, profile }, `"use client";\n${line}\nexport const f = load;\n`);
      expect(findings.map(({ rule }) => rule)).toEqual(["client-imports-server"]);
    }
  });
});
