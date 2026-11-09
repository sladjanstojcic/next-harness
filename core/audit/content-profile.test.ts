import { describe, expect, it } from "vitest";
import { nextModules } from "../../shapes/next-modules.ts";
import type { ContentProfile } from "../../shapes/shape.ts";
import { makeRepo } from "../../testing/temp-repo.ts";
import { auditContent, auditSource } from "./content-rules.ts";

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
