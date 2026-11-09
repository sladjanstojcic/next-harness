import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Use the package's server entry in tests without changing React's resolution conditions.
    alias: { "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
    include: ["src/**/*.test.{ts,tsx}", "tooling/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // Most tests spawn git, Node or the real tools; the 5 s default fails them on a loaded machine.
    testTimeout: 30_000,
  },
});
