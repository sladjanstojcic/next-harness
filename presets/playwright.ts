import { E2E_TESTS } from "./e2e.ts";
import { call, member, toolLoader } from "./load-tool.ts";

/** Playwright for a root Next workspace, run from its folder: the browser tests in e2e/ against `next start` on SMOKE_PORT. */
export function harnessPlaywright(dir = process.cwd()): unknown {
  const playwright = toolLoader(dir)("@playwright/test");
  const port = Number(process.env.SMOKE_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Set SMOKE_PORT to a valid port for the e2e/ smoke server.");
  const baseURL = `http://127.0.0.1:${port}`;
  return call(member(playwright, "defineConfig"), [
    {
      testMatch: E2E_TESTS,
      forbidOnly: Boolean(process.env.CI),
      reporter: "list",
      use: { baseURL, trace: "retain-on-failure" },
      projects: [{ name: "chromium", use: member(member(playwright, "devices"), "Desktop Chrome") }],
      webServer: {
        command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    },
  ]);
}
