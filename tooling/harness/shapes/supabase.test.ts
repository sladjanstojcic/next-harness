import { describe, expect, it } from "vitest";
import { checkPath, resolveHarness } from "../core/path-check.ts";
import { makerkitRepo } from "../testing/makerkit-repo.ts";
import { makeRepo } from "../testing/temp-repo.ts";

const SUPABASE = "apps/web/supabase";

describe("supabase shape", () => {
  const harness = resolveHarness(makerkitRepo().root);
  const verdict = (file: string) => checkPath(`${SUPABASE}/${file}`, harness);

  it.each([
    "config.toml",
    "seed.sql",
    "README.md",
    "README-access.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "migrations/20221215192558_schema.sql",
    "migrations/20260529130000_restrict_mfa_billing_customers_nonces.sql",
    "migrations/.gitkeep",
    "schemas/00-privileges.sql",
    "schemas/21-profiles-and-modules.sql",
    "seeds/00-oxy-sequences.sql",
    "tests/database/00000-makerkit-helpers.sql",
    "tests/database/access-attacks.test.sql",
    "volume/access-volume.sql",
    "templates/confirm-email.html",
    "templates/static/logo.png",
    "functions/send-email/index.ts",
    "functions/_shared/cors.ts",
    "snippets/report.sql",
    ".branches/_current_branch",
    ".temp/cli-latest",
  ])("accepts %s", (file) => {
    expect(verdict(file)).toEqual({ ok: true });
  });

  it.each([
    ["migrations/schema.sql", "module-shape"],
    ["migrations/2022121519_schema.sql", "module-shape"],
    ["migrations/20221215192558_Schema.sql", "module-shape"],
    ["migrations/20221215192558_schema.ts", "module-shape"],
    ["migrations/old/20221215192558_schema.sql", "module-shape"],
    ["schemas/privileges.sql", "module-shape"],
    ["schemas/1-privileges.sql", "module-shape"],
    ["schemas/00_privileges.sql", "module-shape"],
    ["tests/access.test.sql", "nesting"],
    ["tests/database/Access.test.sql", "file-name"],
    ["tests/database/nested/access.test.sql", "file-name"],
    ["seeds/sub/x.sql", "file-name"],
    ["volume/Volume.sql", "file-name"],
    ["migrations/.env", "hidden-file"],
    ["README.txt", "unknown-root"],
    ["notes.md", "unknown-root"],
    ["helpers/x.sql", "unknown-root"],
    ["functions/send-email/index.js", "js-file"],
  ])("denies %s with %s", (file, rule) => {
    expect(verdict(file)).toMatchObject({ ok: false, rule });
  });

  it("names the supabase command in the migration denial", () => {
    expect(verdict("migrations/schema.sql")).toEqual({
      ok: false,
      rule: "module-shape",
      reason: "Name migrations <14-digit timestamp>_<name>.sql; create them with supabase migration new <name>.",
    });
  });

  it("judges a root supabase workspace the same way", () => {
    const { root } = makeRepo({
      "harness.config.ts": 'export default { workspaces: [{ path: "supabase", shape: "supabase" }], root: { entries: ["supabase"] } };\n',
    });
    const plint = resolveHarness(root);
    expect(checkPath("supabase/migrations/20240101000000_init.sql", plint)).toEqual({ ok: true });
    expect(checkPath("supabase/migrations/init.sql", plint)).toMatchObject({ ok: false, rule: "module-shape" });
  });
});
