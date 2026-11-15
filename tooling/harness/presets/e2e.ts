/** Where a root Next workspace keeps its browser tests; the Playwright preset and the CI browser step read it. */
export const E2E_TESTS = "e2e/**/*.test.ts";

/** The folders a Playwright run writes beside its tests: reports, traces with a copied trace viewer, and blob reports. */
export const PLAYWRIGHT_OUTPUT: readonly string[] = ["playwright-report", "test-results", "blob-report"];
