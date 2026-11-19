import { describe, expect, it } from "vitest";
import { e2eEnv, e2eSupabaseConfig, portCount } from "./e2e-database.ts";

const TOML = `project_id = "shop"

[api]
enabled = true
port = 54321
external_url = "https://dev.example.ts.net:54321"

[db]
port = 54322
shadow_port = 54320

[inbucket]
port = 54324
smtp_port = 54325

[edge_runtime]
inspector_port = 8083

[auth]
site_url = "http://127.0.0.1:3000"
`;

describe("e2eSupabaseConfig", () => {
  it("gives the test stack its own project id and a free port for every port line", () => {
    expect(portCount(TOML)).toBe(6);
    const config = e2eSupabaseConfig(TOML, [40001, 40002, 40003, 40004, 40005, 40006]);
    expect(config).toContain('project_id = "shop-e2e"');
    expect([...config.matchAll(/port = (\d+)/g)].map((match) => match[1])).toEqual(["40001", "40002", "40003", "40004", "40005", "40006"]);
  });

  it("drops the external URL, so the CLI checks the API on its local address", () => {
    const config = e2eSupabaseConfig(TOML, [1, 2, 3, 4, 5, 6]);
    expect(config).not.toContain("external_url");
    expect(config).toContain('site_url = "http://127.0.0.1:3000"');
  });

  it("refuses fewer ports than the config has port lines", () => {
    expect(() => e2eSupabaseConfig(TOML, [1, 2])).toThrow("needs 6 ports, got 2");
  });
});

describe("e2eEnv", () => {
  const status = { API_URL: "http://127.0.0.1:40001", ANON_KEY: "anon", DB_URL: "postgresql://postgres:postgres@127.0.0.1:40002/postgres" };

  it("names each value as the project maps it", () => {
    expect(e2eEnv(status, { SUPABASE_URL: "API_URL", SUPABASE_ANON_KEY: "ANON_KEY", DATABASE_URL: "DB_URL" })).toEqual({
      SUPABASE_URL: "http://127.0.0.1:40001",
      SUPABASE_ANON_KEY: "anon",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:40002/postgres",
    });
  });

  it("says which status key is missing", () => {
    expect(() => e2eEnv(status, { SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY" })).toThrow(
      "supabase status gives no SERVICE_ROLE_KEY for SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(() => e2eEnv("not json object", { SUPABASE_URL: "API_URL" })).toThrow("gives no API_URL");
  });
});
