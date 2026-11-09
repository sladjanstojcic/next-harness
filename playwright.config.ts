import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SMOKE_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Set SMOKE_PORT to a valid port for the e2e/ smoke server.");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testMatch: "e2e/**/*.test.ts",
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
